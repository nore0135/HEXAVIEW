"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeries,
  LineStyle,
  UTCTimestamp,
} from "lightweight-charts";
import { INTERVALS, Interval, sma } from "@/lib/market";
import { useMarketStream } from "@/hooks/use-market-stream";
import { WorkspacePanel, ChartState, AlertItem } from "./workspace-panel";
import { ScriptEditor } from "./script-editor";
import { parseHexaScript, evaluateHexaScript } from "@/lib/hexascript";

export function HexaChart() {
  const [state, setState] = useState<ChartState>({
    schemaVersion: 1,
    symbol: "BTCUSDT",
    interval: "1m",
    showSma: false,
    script: "",
  });
  const [lastPrice, setLastPrice] = useState<number | undefined>(undefined);
  const [activeAlerts, setActiveAlerts] = useState<AlertItem[]>([]);

  return (
    <>
      <WorkspacePanel
        state={state}
        onLoad={setState}
        currentPrice={lastPrice}
        onAlertsChange={setActiveAlerts}
      />
      <ChartSession
        key={state.interval}
        interval={state.interval}
        changeInterval={(i) => setState((s) => ({ ...s, interval: i }))}
        showSma={state.showSma}
        toggleSma={() => setState((s) => ({ ...s, showSma: !s.showSma }))}
        script={state.script ?? ""}
        onScriptChange={(script) => setState((s) => ({ ...s, script }))}
        activeAlerts={activeAlerts}
        onPriceUpdate={setLastPrice}
      />
    </>
  );
}

function ChartSession({
  interval,
  changeInterval,
  showSma,
  toggleSma,
  script,
  onScriptChange,
  activeAlerts,
  onPriceUpdate,
}: {
  interval: Interval;
  changeInterval: (i: Interval) => void;
  showSma: boolean;
  toggleSma: () => void;
  script: string;
  onScriptChange: (s: string) => void;
  activeAlerts: AlertItem[];
  onPriceUpdate: (price?: number) => void;
}) {
  const program = useMemo(() => {
    try {
      return script ? parseHexaScript(script) : null;
    } catch {
      return null;
    }
  }, [script]);
  const scriptSeries = useRef<ISeriesApi<"Line">[]>([]);
  const alertLines = useRef<IPriceLine[]>([]);
  const scriptColors = ["#38bdf8", "#fbbf24", "#f472b6", "#a3e635"];
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const average = useRef<ISeriesApi<"Line"> | null>(null);
  const rendered = useRef({ revision: -1, first: -1 });
  const { candles, status, error, revision, updatedAt } = useMarketStream(interval);

  const last = candles.at(-1);

  useEffect(() => {
    onPriceUpdate(last?.close);
  }, [last?.close, onPriceUpdate]);

  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#10151e" },
        textColor: "#8b9bb0",
        attributionLogo: true,
      },
      grid: { vertLines: { color: "#1a2331" }, horzLines: { color: "#1a2331" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#273344", rightOffset: 5 },
      rightPriceScale: { borderColor: "#273344" },
      crosshair: { vertLine: { color: "#38bdf8" }, horzLine: { color: "#38bdf8" } },
    });
    const candleSeries = api.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    const smaSeries = api.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "SMA 50",
    });
    chart.current = api;
    price.current = candleSeries;
    average.current = smaSeries;
    return () => {
      api.remove();
      chart.current = null;
      price.current = null;
      average.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candles.length || !price.current || !average.current || !chart.current) return;
    const previous = rendered.current;
    const reset = previous.revision !== revision || previous.first !== candles[0].time;
    if (reset) {
      const range = chart.current.timeScale().getVisibleRange();
      price.current.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
      if (previous.revision === -1)
        chart.current.timeScale().setVisibleLogicalRange({
          from: Math.max(0, candles.length - 110),
          to: candles.length + 5,
        });
      else if (range) chart.current.timeScale().setVisibleRange(range);
    } else {
      const latest = candles[candles.length - 1];
      price.current.update({ ...latest, time: latest.time as UTCTimestamp });
    }
    const values = sma(candles).map((v) => ({ ...v, time: v.time as UTCTimestamp }));
    if (reset) average.current.setData(values);
    else if (values.length) average.current.update(values[values.length - 1]);
    rendered.current = { revision, first: candles[0].time };
  }, [candles, revision]);

  useEffect(() => {
    average.current?.applyOptions({ visible: showSma });
  }, [showSma]);

  useEffect(() => {
    const series = price.current;
    if (!series) return;
    for (const line of alertLines.current) {
      series.removePriceLine(line);
    }
    alertLines.current = activeAlerts.map((alert) =>
      series.createPriceLine({
        price: Number(alert.threshold),
        color: alert.direction === "crosses_above" ? "#10b981" : "#f43f5e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `ALERT ${alert.direction === "crosses_above" ? "↑" : "↓"}`,
      }),
    );
  }, [activeAlerts]);

  useEffect(() => {
    const api = chart.current;
    if (!api) return;
    const lines =
      program?.body.map((node, i) =>
        api.addSeries(LineSeries, {
          color: scriptColors[i],
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          title: `${node.kind} ${node.period}`,
        }),
      ) ?? [];
    scriptSeries.current = lines;
    return () => {
      scriptSeries.current = [];
      if (chart.current === api) for (const line of lines) api.removeSeries(line);
    };
  }, [program]);

  useEffect(() => {
    if (!program) return;
    const plots = evaluateHexaScript(program, candles);
    plots.forEach((plot, i) =>
      scriptSeries.current[i]?.setData(
        plot.points.map((point) => ({ ...point, time: point.time as UTCTimestamp })),
      ),
    );
  }, [program, candles]);

  function zoom(factor: number) {
    const scale = chart.current?.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const width = Math.max(10, Math.min(2000, (range.to - range.from) * factor));
    scale.setVisibleLogicalRange({ from: range.to - width, to: range.to });
  }

  const format = (value?: number) =>
    value?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "-";

  return (
    <>
      <section
        className="overflow-hidden rounded-2xl border border-slate-800 bg-[#10151e]"
        aria-label="BTC USDT candlestick chart"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 p-5">
          <div>
            <h2 className="text-xl font-semibold">
              BTC <span className="text-slate-500">/ USDT</span>
            </h2>
            <p className="mt-1 text-xs text-slate-400">BINANCE · SPOT · {interval} · UTC</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{format(last?.close)}</div>
            <div
              role="status"
              className={status === "live" ? "text-xs text-emerald-400" : "text-xs text-amber-300"}
            >
              {status.toUpperCase()}
            </div>
          </div>
        </div>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3"
          role="toolbar"
          aria-label="Chart controls"
        >
          {INTERVALS.map((item) => (
            <button key={item} aria-pressed={interval === item} onClick={() => changeInterval(item)}>
              {item}
            </button>
          ))}
          <span className="mx-1 h-5 border-l border-slate-700" />
          <button aria-pressed={showSma} onClick={toggleSma}>
            SMA 50
          </button>
          <div className="ml-auto flex gap-2">
            <button aria-label="Zoom in" onClick={() => zoom(0.8)}>
              +
            </button>
            <button aria-label="Zoom out" onClick={() => zoom(1.25)}>
              -
            </button>
            <button onClick={() => chart.current?.timeScale().fitContent()}>Fit</button>
            <button onClick={() => chart.current?.timeScale().scrollToRealTime()}>Latest</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 pt-3 text-xs text-slate-400 tabular-nums">
          <span>O {format(last?.open)}</span>
          <span>H {format(last?.high)}</span>
          <span>L {format(last?.low)}</span>
          <span>C {format(last?.close)}</span>
          <span>Vol {format(last?.volume)} BTC</span>
        </div>
        {error && (
          <p role="alert" className="mx-4 mt-3 rounded-lg bg-amber-950/50 p-3 text-sm text-amber-200">
            {error}
          </p>
        )}
        {program && (
          <div className="flex flex-wrap gap-4 px-5 py-2 text-xs">
            {program.body.map((node, i) => (
              <span key={`${node.kind}-${node.period}`} style={{ color: scriptColors[i] }}>
                {node.kind} {node.period} ({candles.length} bars)
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <div ref={container} className="h-[55vh] min-h-[320px] w-full sm:h-[62vh]" />
          {!candles.length && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">
              {error ? "Waiting for market data..." : "Synchronizing candles..."}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 px-5 py-3 text-xs text-slate-500">
          <span>Scroll to zoom · Drag to pan · SMA in purple · Alert lines dashed</span>
          <span>
            {updatedAt
              ? `Last tick ${new Date(updatedAt).toISOString().slice(11, 19)} UTC`
              : "Awaiting stream"}
          </span>
        </div>
      </section>
      <ScriptEditor
        source={script}
        onApply={(nextScript) => onScriptChange(nextScript)}
        onRemove={() => onScriptChange("")}
      />
    </>
  );
}
