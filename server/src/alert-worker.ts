import type { Pool } from "pg";
import { AlertEngine, AlertEvent, Direction, PriceAlert, PriceTick } from "./alert-engine.js";

export interface AlertController {
  registerAlert(alert: PriceAlert): void;
  cancelAlert(id: string): boolean;
  evaluateTick(tick: PriceTick): Promise<AlertEvent[]>;
  syncActiveAlerts(): Promise<number>;
}

interface ActiveAlertRow {
  id: string;
  user_id: string;
  symbol: string;
  direction: Direction;
  threshold: string | number;
}

export class AlertWorker implements AlertController {
  public readonly engine: AlertEngine;
  private stopped = true;
  private socket: WebSocket | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private syncTimer?: ReturnType<typeof setInterval>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private sequence = 1;
  private readonly pending = new Map<string, AlertEvent>();
  private flushing: Promise<AlertEvent[]> | null = null;

  constructor(
    private readonly pool: Pool,
    capacity = 100000,
    private readonly wsUrl = "wss://data-stream.binance.vision/ws/btcusdt@aggTrade",
    private readonly restUrl = "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
  ) {
    this.engine = new AlertEngine(capacity);
  }

  registerAlert(alert: PriceAlert): void {
    if (!this.engine.has(alert.id) && !this.pending.has(alert.id)) {
      this.engine.add(alert);
    }
  }

  cancelAlert(id: string): boolean {
    return this.engine.remove(id);
  }

  async syncActiveAlerts(): Promise<number> {
    const result = await this.pool.query<ActiveAlertRow>(
      "SELECT id, user_id, symbol, direction, threshold FROM price_alerts WHERE status = 'active' LIMIT 50000",
    );
    let added = 0;
    for (const row of result.rows) {
      if (!this.engine.has(row.id) && !this.pending.has(row.id)) {
        const threshold = Number(row.threshold);
        if (Number.isFinite(threshold) && threshold > 0) {
          this.engine.add({
            id: row.id,
            userId: row.user_id,
            symbol: row.symbol,
            direction: row.direction,
            threshold,
          });
          added++;
        }
      }
    }
    return added;
  }

  async evaluateTick(tick: PriceTick): Promise<AlertEvent[]> {
    for (const event of this.engine.evaluate(tick)) this.pending.set(event.alertId, event);
    return this.flushPending();
  }

  /** Retain candidates until commit succeeds; a database outage must not erase a crossing. */
  async flushPending(): Promise<AlertEvent[]> {
    if (this.flushing) return this.flushing;
    this.flushing = this.persistPending();
    try { return await this.flushing; } finally { this.flushing = null; }
  }

  private async persistPending(): Promise<AlertEvent[]> {
    const committed: AlertEvent[] = [];
    // Snapshot bounds each flush so continuous ticks cannot monopolize the connection pool.
    for (const event of [...this.pending.values()]) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query(
          "UPDATE price_alerts SET status = 'triggered', triggered_at = now(), version = version + 1 WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING id",
          [event.alertId, event.userId],
        );
        if (updated.rowCount) {
          await client.query(
            `INSERT INTO alert_outbox (alert_id, user_id, source_sequence, payload)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (alert_id) DO NOTHING`,
            [event.alertId, event.userId, event.sequence, JSON.stringify({
              alertId:event.alertId,symbol:event.symbol,direction:event.direction,
              threshold:event.threshold,price:event.price,triggeredAt:new Date().toISOString(),
            })],
          );
        }
        await client.query("COMMIT");
        this.pending.delete(event.alertId);
        // A cancellation or another worker can win the database race.
        if (updated.rowCount) committed.push(event);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    return committed;
  }

  async start(syncIntervalMs = 30000, restPollIntervalMs = 10000): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.syncActiveAlerts();

    this.syncTimer = setInterval(() => {
      void this.flushPending().then(() => this.syncActiveAlerts()).catch(error => console.error("Alert synchronization failed", error));
    }, syncIntervalMs);

    this.pollTimer = setInterval(() => {
      void this.pollRestPrice().catch(() => {});
    }, restPollIntervalMs);

    this.connectStream();
  }

  private async pollRestPrice(): Promise<void> {
    if (this.stopped || this.engine.size === 0) return;
    const response = await fetch(this.restUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const data = (await response.json()) as { symbol?: string; price?: string };
    const price = Number(data.price);
    if (data.symbol === "BTCUSDT" && Number.isFinite(price) && price > 0) {
      await this.evaluateTick({ symbol: "BTCUSDT", sequence: this.sequence++, price });
    }
  }

  private connectStream(attempt = 0): void {
    if (this.stopped || typeof WebSocket === "undefined") return;
    try {
      const ws = new WebSocket(this.wsUrl);
      this.socket = ws;

      ws.onmessage = (event) => {
        if (this.stopped || typeof event.data !== "string") return;
        try {
          const payload = JSON.parse(event.data) as { s?: string; p?: string };
          const price = Number(payload.p);
          if (payload.s === "BTCUSDT" && Number.isFinite(price) && price > 0) {
            const seq = this.sequence++;
            void this.evaluateTick({ symbol: "BTCUSDT", sequence: seq, price }).catch(error => console.error("Alert persistence failed; retry pending", error));
          }
        } catch {}
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };

      ws.onclose = () => {
        if (this.stopped || this.socket !== ws) return;
        this.engine.resetBaseline("BTCUSDT");
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        this.reconnectTimer = setTimeout(() => this.connectStream(attempt + 1), delay);
      };
    } catch {
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
      this.reconnectTimer = setTimeout(() => this.connectStream(attempt + 1), delay);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
  }
}
