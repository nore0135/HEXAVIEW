"use client";
import {useState} from "react";
import {parseHexaScript} from "@/lib/hexascript";
import {Interval,isInterval} from "@/lib/market";
export interface ChartState {schemaVersion:1;symbol:"BTCUSDT";interval:Interval;showSma:boolean;script?:string}
interface Saved {id:string;name:string;version:number}
const api=(process.env.NEXT_PUBLIC_API_URL??"").replace(/\/$/,"");
export function WorkspacePanel({state,onLoad}:{state:ChartState;onLoad:(state:ChartState)=>void}) {
 const [token,setToken]=useState("");const [email,setEmail]=useState("");const [password,setPassword]=useState("");
 const [handle,setHandle]=useState("");const [register,setRegister]=useState(false);const [name,setName]=useState("My workspace");
 const [saved,setSaved]=useState<Saved[]>([]);const [selected,setSelected]=useState<Saved|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 async function request(path:string,method="GET",body?:unknown,session=token):Promise<unknown> {
  const response=await fetch(`${api}${path}`,{method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(session?{Authorization:`Bearer ${session}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  if(response.status===401){setToken("");setSaved([]);setSelected(null);}
  if(!response.ok){const data=await response.json().catch(()=>({error:"API unavailable"}));throw new Error(data.error??"Request failed");}
  return response.status===204?null:response.json();
 }
 async function run(action:()=>Promise<void>){setBusy(true);setMessage("");try{await action();}catch(e){setMessage(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}}
 async function list(session=token){setSaved(await request("/workspaces","GET",undefined,session) as Saved[]);}
 if(!api)return <p className="mb-4 text-sm text-slate-400">Chart mode · Connect the backend to enable accounts and saved workspaces.</p>;
 return <section className="mb-4 rounded-xl border border-slate-800 p-4" aria-label="Saved workspaces"><fieldset disabled={busy} className="flex flex-wrap items-center gap-2">
 {!token?<form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void run(async()=>{
 const result=await request(register?"/auth/register":"/auth/login","POST",{email,password,...(register?{handle,displayName:handle}:{})}) as {token:string};
 setToken(result.token);setPassword("");await list(result.token);setMessage("Signed in for one hour. Reloading the page signs you out locally.");
 });}}>
 <input aria-label="Email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/>
 <input aria-label="Password" type="password" autoComplete={register?"new-password":"current-password"} minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/>
 {register&&<input aria-label="Handle" placeholder="handle" pattern="[a-z0-9_]{3,30}" required value={handle} onChange={e=>setHandle(e.target.value)}/>}
 <button type="submit">{register?"Create account":"Sign in"}</button><button type="button" onClick={()=>setRegister(v=>!v)}>{register?"Use existing account":"Register"}</button>
 </form>:<>
 <input aria-label="Workspace name" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/>
 <button onClick={()=>void run(async()=>{const result=await request("/workspaces","POST",{name,state}) as Saved;setSelected(result);await list();setMessage("Saved as new workspace.");})}>Save new</button>
 <button disabled={!selected} onClick={()=>void run(async()=>{if(!selected)return;const result=await request(`/workspaces/${selected.id}`,"PUT",{name,state,version:selected.version}) as Saved;setSelected(result);await list();setMessage("Workspace updated.");})}>Update loaded</button>
 <select aria-label="Load workspace" value={selected?.id??""} onChange={e=>{const id=e.target.value;if(!id){setSelected(null);return;}void run(async()=>{
 const item=await request(`/workspaces/${id}`) as Saved & {state:ChartState};
 if(item.state.schemaVersion!==1||item.state.symbol!=="BTCUSDT"||!isInterval(item.state.interval)||typeof item.state.showSma!=="boolean")throw new Error("Unsupported saved layout");
 if(item.state.script){parseHexaScript(item.state.script);}
 setSelected(item);setName(item.name);onLoad(item.state);setMessage("Workspace loaded.");});}}><option value="">Load workspace…</option>{saved.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
 <button onClick={()=>void run(async()=>{await request("/auth/logout","POST");setToken("");setSelected(null);setSaved([]);setMessage("Signed out.");})}>Sign out</button>
 </>}
 </fieldset><p role="status" className="mt-2 text-xs text-slate-400">{busy?"Working…":message}</p></section>;
}
