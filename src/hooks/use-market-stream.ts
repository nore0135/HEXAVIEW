"use client";
import { useEffect, useState } from "react";
import { Candle, Interval, mergeCandles, parseHistory, parseTick, Tick } from "@/lib/market";
export type StreamStatus = "connecting" | "syncing" | "live" | "reconnecting";
export interface MarketState { candles: Candle[]; status: StreamStatus; error: string | null; revision: number; updatedAt: number | null }
const initial: MarketState = {candles: [], status: "connecting", error: null, revision: 0, updatedAt: null};
export function useMarketStream(interval: Interval) {
  const [state, setState] = useState<MarketState>(initial);
  useEffect(() => {
    let stopped = false, attempt = 0;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let abort: AbortController | undefined;
    setState(initial);
    function connect() {
      if (stopped) return;
      const current = new WebSocket(`wss://data-stream.binance.vision/ws/btcusdt@kline_${interval}`);
      socket = current;
      let ready = false, lastMessage = Date.now(), latestEvent = -1;
      const pending = new Map<number, Tick>();
      const active = () => !stopped && socket === current && current.readyState === WebSocket.OPEN;
      setState(s => ({...s, status: attempt ? "reconnecting" : "connecting"}));
      watchdog = setInterval(() => { if (Date.now()-lastMessage > 20000) current.close(); }, 5000);
      current.onopen = async () => {
        if (!active()) return;
        abort = new AbortController();
        const controller = abort;
        const timeout = setTimeout(() => controller.abort(), 12000);
        setState(s => ({...s, status: "syncing"}));
        try {
          // Open the socket first. Buffer updates while REST history is in flight.
          const response = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=1000`, {signal: controller.signal, cache: "no-store"});
          if (!response.ok) throw new Error("History unavailable. Retrying; check provider access.");
          const history = parseHistory(await response.json());
          if (!active()) return;
          const ticks = [...pending.values()].sort((a,b) => a.eventTime-b.eventTime);
          // REST can be newer than buffered events for the current candle. Volume
          // is cumulative within a kline; never replace it with an older snapshot.
          const byTime = new Map(history.map(c => [c.time,c]));
          const fresh = ticks.filter(t => !byTime.has(t.candle.time) || t.candle.volume >= byTime.get(t.candle.time)!.volume);
          latestEvent = ticks.at(-1)?.eventTime ?? -1;
          const candles = mergeCandles(history, fresh.map(t => t.candle));
          ready = true; pending.clear(); attempt = 0;
          setState(s => ({candles, status: ticks.length ? "live" : "syncing", error: null, revision: s.revision+1, updatedAt: ticks.at(-1)?.eventTime ?? null}));
        } catch (error) {
          if (!active()) return;
          setState(s => ({...s, error: error instanceof Error ? error.message : "History unavailable"}));
          current.close();
        } finally { clearTimeout(timeout); }
      };
      current.onmessage = event => {
        if (!active() || typeof event.data !== "string") return;
        try {
          const tick = parseTick(event.data, interval); lastMessage = Date.now();
          if (!ready) {
            const previous = pending.get(tick.candle.time);
            if (!previous || tick.eventTime >= previous.eventTime) pending.set(tick.candle.time, tick);
            if (pending.size > 1000) current.close();
            return;
          }
          if (tick.eventTime < latestEvent) return;
          latestEvent = tick.eventTime;
          setState(s => {
            const last = s.candles.at(-1);
            if (last && (tick.candle.time < last.time || (tick.candle.time === last.time && tick.candle.volume < last.volume))) return s;
            return {...s, candles: mergeCandles(s.candles, [tick.candle]), status: "live", error: null, updatedAt: tick.eventTime};
          });
        } catch { /* Ignore malformed or unrelated messages without poisoning the chart. */ }
      };
      current.onerror = () => current.close();
      current.onclose = () => {
        clearInterval(watchdog); abort?.abort();
        if (stopped || socket !== current) return;
        setState(s => ({...s, status: "reconnecting", error: s.error ?? "Connection interrupted. Retrying automatically."}));
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.8 + Math.random()*0.4);
        timer = setTimeout(connect, delay);
      };
    }
    connect();
    return () => { stopped = true; clearTimeout(timer); clearInterval(watchdog); abort?.abort(); socket?.close(); };
  }, [interval]);
  return state;
}
