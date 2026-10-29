import { HexaChart } from "@/components/hexa-chart";
export default function Home() {
 return <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8">
  <header className="mb-8 flex items-center justify-between gap-4"><a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`} className="text-2xl font-bold tracking-tight"><span className="mr-2 text-violet-400">⬡</span>HexaView</a><span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">PHASE 03 · MARKET WORKSPACE</span></header>
  <div className="mb-5"><p className="text-xs font-semibold tracking-[0.2em] text-violet-400">THE MARKET, IN FOCUS</p><h1 className="mt-2 text-3xl font-semibold">Chart workspace</h1><p className="mt-2 text-sm text-slate-400">Live price action. A clear perspective.</p></div>
  <HexaChart/>
  <footer className="mt-5 flex flex-wrap justify-between gap-3 text-xs text-slate-500"><span>Public market data · No account or API key required</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView Lightweight Charts™</a></footer>
 </main>;
}
