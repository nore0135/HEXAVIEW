import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { hashPassword, verifyPassword, newToken, tokenHash } from "../src/security.js";
import { chartState, createAlert } from "../src/schema.js";
import type { AlertController } from "../src/alert-worker.js";
import type { PriceAlert } from "../src/alert-engine.js";

test("password verification and opaque session hashing", async () => {
  const hash = await hashPassword("a-very-long-password");
  assert.equal(await verifyPassword("a-very-long-password", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
  assert.equal(newToken().length, 43);
  assert.equal(tokenHash("a").length, 64);
});

test("layout and alert schemas reject unsupported symbols and invalid thresholds", () => {
  const state = { schemaVersion: 1, symbol: "BTCUSDT", interval: "1m", showSma: false };
  assert.equal(chartState.safeParse(state).success, true);
  assert.equal(chartState.safeParse({ ...state, symbol: "UNKNOWN" }).success, false);
  assert.equal(chartState.safeParse({ ...state, unknownField: "execute" }).success, false);
  assert.equal(
    createAlert.safeParse({ direction: "crosses_above", threshold: 95000 }).success,
    true,
  );
  assert.equal(
    createAlert.safeParse({ direction: "crosses_above", threshold: -10 }).success,
    false,
  );
});

test("unauthenticated requests never query private workspace or alert data", async () => {
  let queries = 0;
  const pool = {
    query: async () => {
      queries++;
      return { rows: [] };
    },
  } as unknown as Pool;
  const app = await createApp(pool, ["https://example.github.io"]);
  try {
    const wsRes = await app.inject({ method: "GET", url: "/workspaces" });
    assert.equal(wsRes.statusCode, 401);
    const alertRes = await app.inject({ method: "GET", url: "/alerts" });
    assert.equal(alertRes.statusCode, 401);
    assert.equal(queries, 0);
  } finally {
    await app.close();
  }
});

test("POST /alerts registers alert with AlertController and DELETE /alerts/:id cancels it", async () => {
  const registered: PriceAlert[] = [];
  const cancelled: string[] = [];
  const controller: AlertController = {
    registerAlert: (a) => registered.push(a),
    cancelAlert: (id) => {
      cancelled.push(id);
      return true;
    },
    evaluateTick: async () => [],
    syncActiveAlerts: async () => 0,
  };
  const alertId = "00000000-0000-4000-8000-000000000099";
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("FROM sessions")) return { rows: [{ user_id: "owner-a" }], rowCount: 1 };
      if (sql.includes("SELECT count(*)")) return { rows: [{ count: "0" }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO price_alerts"))
        return {
          rows: [
            {
              id: alertId,
              venue: "BINANCE",
              symbol: "BTCUSDT",
              direction: "crosses_above",
              threshold: 92500,
              status: "active",
              version: 1,
              created_at: new Date(),
              triggered_at: null,
            },
          ],
          rowCount: 1,
        };
      if (sql.startsWith("DELETE FROM price_alerts")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  const app = await createApp(pool, ["https://example.github.io"], controller);
  const bearer = `Bearer ${newToken()}`;
  try {
    const createRes = await app.inject({
      method: "POST",
      url: "/alerts",
      headers: { authorization: bearer },
      payload: { direction: "crosses_above", threshold: 92500 },
    });
    assert.equal(createRes.statusCode, 201);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].id, alertId);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/alerts/${alertId}`,
      headers: { authorization: bearer },
    });
    assert.equal(deleteRes.statusCode, 204);
    assert.deepEqual(cancelled, [alertId]);
  } finally {
    await app.close();
  }
});
