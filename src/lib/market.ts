export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];
export const SYMBOL = "BTCUSDT";
export const MAX_CANDLES = 1000;
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface Tick { candle: Candle; eventTime: number }
export function isInterval(value: unknown): value is Interval {
  return typeof value === "string" && INTERVALS.some(i => i === value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
  return value as Record<string, unknown>;
}
function numeric(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) throw new Error("Invalid number");
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Non-finite number");
  return n;
}
export function candle(time: unknown, o: unknown, h: unknown, l: unknown, c: unknown, v: unknown): Candle {
  const result = { time: numeric(time), open: numeric(o), high: numeric(h), low: numeric(l), close: numeric(c), volume: numeric(v) };
  if (!Number.isSafeInteger(result.time) || result.time <= 0 || result.low <= 0 || result.volume < 0 ||
      result.high < Math.max(result.open, result.close, result.low) || result.low > Math.min(result.open, result.close)) throw new Error("Invalid candle");
  return result;
}
export function parseHistory(value: unknown): Candle[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CANDLES) throw new Error("Invalid history");
  return mergeCandles([], value.map(row => {
    if (!Array.isArray(row) || row.length < 6) throw new Error("Invalid row");
    return candle(numeric(row[0]) / 1000, row[1], row[2], row[3], row[4], row[5]);
  }));
}
export function parseSnapshot(value: unknown): Candle[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CANDLES) throw new Error("Invalid snapshot");
  return mergeCandles([], value.map(item => { const r = record(item); return candle(r.time, r.open, r.high, r.low, r.close, r.volume); }));
}
export function parseTick(raw: string, interval: Interval): Tick {
  const event = record(JSON.parse(raw)); const k = record(event.k);
  if (event.e !== "kline" || event.s !== SYMBOL || k.s !== SYMBOL || k.i !== interval) throw new Error("Unexpected stream");
  return { eventTime: numeric(event.E), candle: candle(numeric(k.t) / 1000, k.o, k.h, k.l, k.c, k.v) };
}
export function mergeCandles(base: Candle[], updates: Candle[]): Candle[] {
  const map = new Map(base.map(c => [c.time, c]));
  for (const c of updates) map.set(c.time, c);
  return [...map.values()].sort((a,b) => a.time-b.time).slice(-MAX_CANDLES);
}
export function sma(data: Candle[], period = 50): {time: number; value: number}[] {
  if (!Number.isInteger(period) || period < 1) throw new Error("Invalid period");
  let sum = 0; const result: {time: number; value: number}[] = [];
  data.forEach((c, i) => { sum += c.close; if (i >= period) sum -= data[i-period].close;
    if (i >= period-1) result.push({time: c.time, value: sum/period}); });
  return result;
}
