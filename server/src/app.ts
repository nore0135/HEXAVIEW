import Fastify, { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Pool } from "pg";
import { ZodError } from "zod";
import {
  credentials,
  registration,
  workspace,
  updateWorkspace,
  createAlert,
  uuid,
  outboxId,
} from "./schema.js";
import { hashPassword, verifyPassword, newToken, tokenHash } from "./security.js";
import type { AlertController } from "./alert-worker.js";
import type { Direction } from "./alert-engine.js";

interface User {
  id: string;
  email: string;
  password_hash: string;
}

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

export async function createApp(pool: Pool, origins: string[], alertController?: AlertController) {
  const app = Fastify({
    bodyLimit: 120000,
    logger: { redact: ["req.headers.authorization", "req.headers.cookie"] },
    trustProxy: true,
  });
  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "Invalid request",
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    const e = error as Error & { statusCode?: number; code?: string };
    if (e.code === "23505") return reply.code(409).send({ error: "Account or handle unavailable" });
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    if (status === 500) req.log.error({ err: error }, "Request failed");
    return reply.code(status).send({ error: status === 500 ? "Internal server error" : e.message });
  });

  const dummy = await hashPassword(newToken());

  async function authenticate(req: FastifyRequest) {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) fail(401, "Authentication required");
    const token = authorization.slice(7);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(401, "Invalid session");
    const result = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()",
      [tokenHash(token)],
    );
    if (!result.rows[0]) fail(401, "Session expired or invalid");
    return { userId: result.rows[0].user_id, hash: tokenHash(token) };
  }

  async function session(userId: string) {
    const token = newToken();
    const result = await pool.query<{ expires_at: Date }>(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours') RETURNING expires_at",
      [tokenHash(token), userId],
    );
    return { token, expiresAt: result.rows[0].expires_at };
  }

  const authLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", alertsEnabled: Boolean(alertController) };
  });

  app.post("/auth/register", { config: authLimit }, async (req, reply) => {
    const input = registration.parse(req.body);
    const password = await hashPassword(input.password);
    const client = await pool.connect();
    let id: string;
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id",
        [input.email, password],
      );
      id = result.rows[0].id;
      await client.query(
        "INSERT INTO social_profiles(user_id,handle,display_name) VALUES($1,$2,$3)",
        [id, input.handle, input.displayName],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return reply.code(201).send({ user: { id, email: input.email }, ...(await session(id)) });
  });

  app.post("/auth/login", { config: authLimit }, async (req) => {
    const input = credentials.parse(req.body);
    const result = await pool.query<User>(
      "SELECT id,email,password_hash FROM users WHERE email=$1",
      [input.email],
    );
    const user = result.rows[0];
    const valid = await verifyPassword(input.password, user?.password_hash ?? dummy);
    if (!user || !valid) fail(401, "Invalid email or password");
    return { user: { id: user.id, email: user.email }, ...(await session(user.id)) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const auth = await authenticate(req);
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [auth.hash]);
    return reply.code(204).send();
  });

  app.get("/auth/me", async (req) => {
    const { userId } = await authenticate(req);
    const result = await pool.query(
      "SELECT u.id,u.email,p.handle,p.display_name FROM users u JOIN social_profiles p ON p.user_id=u.id WHERE u.id=$1",
      [userId],
    );
    return result.rows[0];
  });

  app.get("/workspaces", async (req) => {
    const { userId } = await authenticate(req);
    return (
      await pool.query(
        "SELECT id,name,version,updated_at FROM chart_workspaces WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",
        [userId],
      )
    ).rows;
  });

  app.post("/workspaces", async (req, reply) => {
    const { userId } = await authenticate(req);
    const input = workspace.parse(req.body);
    return reply.code(201).send(
      (
        await pool.query(
          "INSERT INTO chart_workspaces(user_id,name,state) VALUES($1,$2,$3) RETURNING id,name,state,version,updated_at",
          [userId, input.name, input.state],
        )
      ).rows[0],
    );
  });

  app.get<{ Params: { id: string } }>("/workspaces/:id", async (req) => {
    const { userId } = await authenticate(req);
    const id = uuid.parse(req.params.id);
    const result = await pool.query(
      "SELECT id,name,state,version,updated_at FROM chart_workspaces WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
    if (!result.rows[0]) fail(404, "Workspace not found");
    return result.rows[0];
  });

  app.put<{ Params: { id: string } }>("/workspaces/:id", async (req) => {
    const { userId } = await authenticate(req);
    const id = uuid.parse(req.params.id);
    const input = updateWorkspace.parse(req.body);
    const result = await pool.query(
      "UPDATE chart_workspaces SET name=$3,state=$4,version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND version=$5 RETURNING id,name,state,version,updated_at",
      [id, userId, input.name, input.state, input.version],
    );
    if (!result.rows[0]) {
      const found = await pool.query(
        "SELECT 1 FROM chart_workspaces WHERE id=$1 AND user_id=$2",
        [id, userId],
      );
      fail(
        found.rowCount ? 409 : 404,
        found.rowCount ? "Workspace changed; reload before saving" : "Workspace not found",
      );
    }
    return result.rows[0];
  });

  app.delete<{ Params: { id: string } }>("/workspaces/:id", async (req, reply) => {
    const { userId } = await authenticate(req);
    const id = uuid.parse(req.params.id);
    const result = await pool.query(
      "DELETE FROM chart_workspaces WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
    if (!result.rowCount) fail(404, "Workspace not found");
    return reply.code(204).send();
  });

  app.get("/alerts", async (req) => {
    const { userId } = await authenticate(req);
    const result = await pool.query(
      "SELECT id,venue,symbol,direction,threshold::float8 AS threshold,status,version,created_at,triggered_at FROM price_alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [userId],
    );
    return result.rows;
  });

  app.post("/alerts", async (req, reply) => {
    const { userId } = await authenticate(req);
    const input = createAlert.parse(req.body);
    const countResult = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM price_alerts WHERE user_id=$1 AND status='active'",
      [userId],
    );
    if (Number(countResult.rows[0]?.count ?? 0) >= 50) {
      fail(409, "Maximum of 50 active price alerts reached");
    }
    const result = await pool.query<{
      id: string;
      venue: string;
      symbol: string;
      direction: Direction;
      threshold: number;
      status: string;
      version: number;
      created_at: Date;
      triggered_at: Date | null;
    }>(
      "INSERT INTO price_alerts(user_id,venue,symbol,direction,threshold) VALUES($1,$2,$3,$4,$5) RETURNING id,venue,symbol,direction,threshold::float8 AS threshold,status,version,created_at,triggered_at",
      [userId, input.venue, input.symbol, input.direction, input.threshold],
    );
    const created = result.rows[0];
    alertController?.registerAlert({
      id: created.id,
      userId,
      symbol: created.symbol,
      direction: created.direction,
      threshold: Number(created.threshold),
    });
    return reply.code(201).send(created);
  });

  app.delete<{ Params: { id: string } }>("/alerts/:id", async (req, reply) => {
    const { userId } = await authenticate(req);
    const id = uuid.parse(req.params.id);
    const result = await pool.query(
      "DELETE FROM price_alerts WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
    if (!result.rowCount) fail(404, "Alert not found");
    alertController?.cancelAlert(id);
    return reply.code(204).send();
  });

  app.get("/alerts/outbox", async (req) => {
    const { userId } = await authenticate(req);
    const result = await pool.query(
      "SELECT id,alert_id,source_sequence,payload,created_at,delivered_at FROM alert_outbox WHERE user_id=$1 AND delivered_at IS NULL ORDER BY id ASC LIMIT 50",
      [userId],
    );
    return result.rows;
  });

  app.post<{ Params: { id: string } }>("/alerts/outbox/:id/ack", async (req, reply) => {
    const { userId } = await authenticate(req);
    const id = outboxId.parse(req.params.id);
    const result = await pool.query(
      "UPDATE alert_outbox SET delivered_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, userId],
    );
    if (!result.rowCount) fail(404, "Notification not found");
    return reply.code(204).send();
  });

  return app;
}
