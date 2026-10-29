/** In-memory one-shot crossing evaluator. Persistence/delivery belong to the worker. */
export type Direction = "crosses_above" | "crosses_below";
export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  direction: Direction;
  threshold: number;
}
export interface PriceTick {
  symbol: string;
  sequence: number;
  price: number;
}
export interface AlertEvent {
  alertId: string;
  userId: string;
  symbol: string;
  sequence: number;
  price: number;
  threshold: number;
  direction: Direction;
}
interface Bucket {
  above: PriceAlert[];
  below: PriceAlert[];
  last?: PriceTick;
}
function upperBound(items: PriceAlert[], price: number) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid].threshold <= price) low = mid + 1;
    else high = mid;
  }
  return low;
}
function lowerBound(items: PriceAlert[], price: number) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid].threshold < price) low = mid + 1;
    else high = mid;
  }
  return low;
}
export class AlertEngine {
  private readonly symbols = new Map<string, Bucket>();
  private readonly alerts = new Map<string, PriceAlert>();
  constructor(private readonly capacity = 100000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid capacity");
  }
  has(id: string): boolean {
    return this.alerts.has(id);
  }
  add(alert: PriceAlert): void {
    if (
      !alert.id ||
      !alert.userId ||
      !alert.symbol ||
      !Number.isFinite(alert.threshold) ||
      alert.threshold <= 0 ||
      !["crosses_above", "crosses_below"].includes(alert.direction)
    )
      throw new Error("Invalid alert");
    if (this.alerts.has(alert.id)) throw new Error("Duplicate alert ID");
    if (this.alerts.size >= this.capacity) throw new Error("Alert capacity exceeded");
    const copy = { ...alert };
    const bucket = this.symbols.get(alert.symbol) ?? { above: [], below: [] };
    const list = alert.direction === "crosses_above" ? bucket.above : bucket.below;
    list.splice(upperBound(list, alert.threshold), 0, copy);
    this.symbols.set(alert.symbol, bucket);
    this.alerts.set(alert.id, copy);
  }
  remove(id: string): boolean {
    const alert = this.alerts.get(id);
    if (!alert) return false;
    const bucket = this.symbols.get(alert.symbol)!;
    const list = alert.direction === "crosses_above" ? bucket.above : bucket.below;
    const start = lowerBound(list, alert.threshold);
    let i = start;
    while (i < list.length && list[i].threshold === alert.threshold && list[i].id !== id) i++;
    if (list[i]?.id === id) list.splice(i, 1);
    this.alerts.delete(id);
    if (!bucket.above.length && !bucket.below.length) this.symbols.delete(alert.symbol);
    return true;
  }
  resetBaseline(symbol: string): void {
    const bucket = this.symbols.get(symbol);
    if (bucket) bucket.last = undefined;
  }
  evaluate(tick: PriceTick): AlertEvent[] {
    if (!Number.isFinite(tick.price) || tick.price <= 0 || !Number.isSafeInteger(tick.sequence) || tick.sequence < 0)
      throw new Error("Invalid price tick");
    const bucket = this.symbols.get(tick.symbol);
    if (!bucket) return [];
    const previous = bucket.last;
    if (previous && tick.sequence <= previous.sequence) return [];
    bucket.last = { ...tick };
    if (!previous || previous.price === tick.price) return [];
    const rising = tick.price > previous.price;
    const list = rising ? bucket.above : bucket.below;
    const from = rising ? lowerBound(list, previous.price) : upperBound(list, tick.price);
    const to = rising ? lowerBound(list, tick.price) : upperBound(list, previous.price);
    const triggered = list.splice(from, to - from);
    for (const alert of triggered) this.alerts.delete(alert.id);
    if (!bucket.above.length && !bucket.below.length) this.symbols.delete(tick.symbol);
    return triggered.map((alert) => ({
      alertId: alert.id,
      userId: alert.userId,
      symbol: tick.symbol,
      sequence: tick.sequence,
      price: tick.price,
      threshold: alert.threshold,
      direction: alert.direction,
    }));
  }
  get size(): number {
    return this.alerts.size;
  }
}
