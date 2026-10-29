"use client";
import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, IChartApi, ISeriesApi, LineSeries, UTCTimestamp } from "lightweight-charts";
import { INTERVALS, Interval, sma } from "@/lib/market";
import { useMarketStream } from "@/hooks/use-market-stream";
import {WorkspacePanel, ChartState} from "./workspace-panel";
export function HexaChart() {
  const [state,setState]=useState<ChartState>({schemaVersion:1,symbol:"BTCUSDT",interval:"1m",showSma:false});
  return <><WorkspacePanel state={state} onLoad={setState}/><ChartSession key={state.interval} interval={state.interval} changeInterval={interval=>setState(s=>({...s,interval}))} showSma={state.showSma} toggleSma={()=>setState(s=>({...s,showSma:!s.showSma}))}/></>;
}
function ChartSession({interval, changeInterval, showSma, toggleSma}: {interval: Interval; changeInterval: (value: Interval) => void; showSma:boolean; toggleSma:()=>void}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const average = useRef<ISeriesApi<"Line"> | null>(null);
  const rendered = useRef({revision: -1, first: -1});
  const {candles, status, error, revision, updatedAt} = useMarketStream(interval);
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, {
      autoSize: true,
      layout: {background: {type: ColorType.Solid, color: "#10151e"}, textColor: "#8b9bb0", attributionLogo: true},
      grid: {vertLines: {color: "#1a2331"}, horzLines: {color: "#1a2331"}},
      timeScale: {timeVisible: true, secondsVisible: false, borderColor: "#273344", rightOffset: 5},
      rightPriceScale: {borderColor: "#273344"},
    });
    chart.current = api;
    price.current = api.addSeries(CandlestickSeries, {upColor: "#34d399", downColor: "#fb7185", wickUpColor: "#34d399", wickDownColor: "#fb7185", borderVisible: false});
    average.current = api.addSeries(LineSeries, {color: "#a78bfa", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, visible: false});
    return () => { api.remove(); chart.current = null; price.current = null; average.current = null; rendered.current = {revision: -1, first: -1}; };
  }, []);
  useEffect(() => {
    if (!candles.length || !price.current || !average.current || !chart.current) return;
    const previous = rendered.current;
    const reset = previous.revision !== revision || previous.first !== candles[0].time;
    if (reset) {
      const range = chart.current.timeScale().getVisibleRange();
      price.current.setData(candles.map(c => ({...c, time: c.time as UTCTimestamp})));
      if (previous.revision === -1) chart.current.timeScale().setVisibleLogicalRange({from: Math.max(0, candles.length-110), to: candles.length+5});
      else if (range) chart.current.timeScale().setVisibleRange(range);
    } else {
      const last = candles[candles.length-1];
      price.current.update({...last, time: last.time as UTCTimestamp});
    }
    // Bounded to 1,000 bars. A reset updates the full line; live ticks only update its tail.
    const values = sma(candles).map(v => ({...v, time: v.time as UTCTimestamp}));
    if (reset) average.current.setData(values);
    else if (values.length) average.current.update(values[values.length-1]);
    rendered.current = {revision, first: candles[0].time};
  }, [candles, revision]);
  useEffect(() => { average.current?.applyOptions({visible: showSma}); }, [showSma]);
  function zoom(factor: number) {
    const scale = chart.current?.timeScale(); const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const width = Math.max(10, Math.min(2000, (range.to-range.from)*factor));
    scale.setVisibleLogicalRange({from: range.to-width, to: range.to});
  }
  const last = candles.at(-1);
  const format = (value?: number) => value?.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2}) ?? "—";
  return <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#10151e]" aria-label="BTC USDT candlestick chart">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 p-5">
      <div><h2 className="text-xl font-semibold">BTC <span className="text-slate-500">/ USDT</span></h2><p className="mt-1 text-xs text-slate-400">BINANCE · SPOT · {interval} · UTC</p></div>
      <div className="text-right"><div className="text-2xl font-semibold tabular-nums">{format(last?.close)}</div><div role="status" className={status === "live" ? "text-xs text-emerald-400" : "text-xs text-amber-300"}>{status.toUpperCase()}</div></div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3" role="toolbar" aria-label="Chart controls">
      {INTERVALS.map(item => <button key={item} aria-pressed={interval === item} onClick={() => changeInterval(item)}>{item}</button>)}
      <span className="mx-1 h-5 border-l border-slate-700"/>
      <button aria-pressed={showSma} onClick={toggleSma}>SMA 50</button>
      <div className="ml-auto flex gap-2"><button aria-label="Zoom in" onClick={() => zoom(0.8)}>+</button><button aria-label="Zoom out" onClick={() => zoom(1.25)}>−</button><button onClick={() => chart.current?.timeScale().fitContent()}>Fit</button><button onClick={() => chart.current?.timeScale().scrollToRealTime()}>Latest</button></div>
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 pt-3 text-xs text-slate-400 tabular-nums"><span>O {format(last?.open)}</span><span>H {format(last?.high)}</span><span>L {format(last?.low)}</span><span>C {format(last?.close)}</span><span>Vol {format(last?.volume)} BTC</span></div>
    {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-amber-950/50 p-3 text-sm text-amber-200">{error}</p>}
    <div className="relative"><div ref={container} className="h-[55vh] min-h-[320px] w-full sm:h-[62vh]"/>{!candles.length && <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">{error ? "Waiting for market data…" : "Synchronizing candles…"}</div>}</div>
    <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 px-5 py-3 text-xs text-slate-500"><span>Scroll to zoom · Drag to pan · SMA in purple</span><span>{updatedAt ? `Last tick ${new Date(updatedAt).toISOString().slice(11,19)} UTC` : "Awaiting stream"}</span></div>
  </section>;
}
