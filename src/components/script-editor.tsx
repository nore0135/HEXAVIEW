"use client";
import {useState} from "react";
import {MAX_SOURCE,parseHexaScript} from "@/lib/hexascript";
export function ScriptEditor({source,onApply,onRemove}:{source:string;onApply:(source:string)=>void;onRemove:()=>void}) {
 const [draft,setDraft]=useState(source||"calculate SMA 50\ncalculate EMA 20");
 const [error,setError]=useState("");const [message,setMessage]=useState("");
 return <section className="mt-4 rounded-2xl border border-slate-800 bg-[#10151e] p-5" aria-label="HexaScript editor">
 <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">HexaScript <span className="ml-2 text-xs text-violet-400">v1</span></h2><p className="mt-1 text-xs text-slate-400">Plot SMA and EMA from candle closes. Up to four indicators, periods 1–500.</p></div><span className="text-xs text-slate-500">Runs in your browser</span></div>
 <label htmlFor="hexascript" className="sr-only">Indicator script</label>
 <textarea id="hexascript" spellCheck={false} maxLength={MAX_SOURCE} value={draft} onChange={e=>{setDraft(e.target.value);setError("");setMessage("");}} rows={4} className="w-full rounded-lg border border-slate-700 bg-[#090e16] p-3 font-mono text-sm text-emerald-200"/>
 <div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>{try{const ast=parseHexaScript(draft);onApply(draft);setError("");setMessage(`Applied ${ast.body.length} indicator${ast.body.length===1?"":"s"}. Lines appear after enough candles are available.`);}catch(e){setError(e instanceof Error?e.message:"Invalid script");setMessage("");}}}>Run script</button><button onClick={()=>{onRemove();setMessage("Script plots removed.");setError("");}}>Remove plots</button><span className="self-center text-xs text-slate-500">Use # for comments · Existing plots stay until a valid script is applied</span></div>
 {error&&<p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}{message&&<p role="status" className="mt-3 text-xs text-slate-400">{message}</p>}
 </section>;
}
