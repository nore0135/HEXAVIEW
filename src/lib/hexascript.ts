/** HexaScript v1: a bounded declarative DSL; never executes JavaScript. */
export interface IndicatorNode {type:"Indicator";kind:"SMA"|"EMA";period:number;line:number}
export interface Program {type:"Program";version:1;body:IndicatorNode[]}
export interface PriceBar {time:number;close:number}
export interface Plot {label:string;points:{time:number;value:number}[]}
export const MAX_SOURCE=2048;
export const MAX_PLOTS=4;
export const MAX_BARS=1000;
export class ScriptError extends Error {
 constructor(public readonly line:number,message:string){super(`Line ${line}: ${message}`);this.name="ScriptError";}
}
export function parseHexaScript(source:string):Program {
 if(source.length>MAX_SOURCE)throw new ScriptError(1,`Script exceeds ${MAX_SOURCE} characters`);
 const body:IndicatorNode[]=[];
 source.split(/\r?\n/).forEach((raw,index)=>{
  const text=raw.split("#",1)[0].trim();if(!text)return;
  const tokens=text.split(/\s+/);
  if(tokens.length!==3||tokens[0].toLowerCase()!=="calculate")throw new ScriptError(index+1,"Expected: calculate SMA 50 (or calculate EMA 20)");
  const kind=tokens[1].toUpperCase();
  if(kind!=="SMA"&&kind!=="EMA")throw new ScriptError(index+1,"Supported indicators: SMA, EMA");
  if(!/^[0-9]+$/.test(tokens[2]))throw new ScriptError(index+1,"Period must be an integer from 1 to 500");
  const period=Number(tokens[2]);
  if(period<1||period>500)throw new ScriptError(index+1,"Period must be from 1 to 500");
  if(body.length===MAX_PLOTS)throw new ScriptError(index+1,`At most ${MAX_PLOTS} indicators are supported`);
  if(body.some(node=>node.kind===kind&&node.period===period))throw new ScriptError(index+1,"Duplicate indicator");
  body.push({type:"Indicator",kind,period,line:index+1});
 });
 if(!body.length)throw new ScriptError(1,"Add at least one calculate statement");
 return {type:"Program",version:1,body};
}
export function evaluateHexaScript(program:Program,bars:readonly PriceBar[]):Plot[] {
 if(program.type!=="Program"||program.version!==1||program.body.length<1||program.body.length>MAX_PLOTS)throw new Error("Invalid program");
 if(bars.length>MAX_BARS)throw new Error(`At most ${MAX_BARS} bars are supported`);
 for(let i=0;i<bars.length;i++)if(!Number.isFinite(bars[i].close)||!Number.isSafeInteger(bars[i].time)||bars[i].time<=0||(i>0&&bars[i].time<=bars[i-1].time))throw new Error("Expected finite prices and strictly increasing timestamps");
 return program.body.map(node=>{
  if(node.type!=="Indicator"||!['SMA','EMA'].includes(node.kind)||!Number.isInteger(node.period)||node.period<1||node.period>500)throw new Error("Invalid indicator AST");
  const points:Plot['points']=[];let sum=0;let previous:number|undefined;
  for(let i=0;i<bars.length;i++){
   sum+=bars[i].close;if(i>=node.period)sum-=bars[i-node.period].close;
   if(i<node.period-1)continue;
   // EMA starts with a complete SMA seed, never a partial-window estimate.
   const value=node.kind==="SMA"||previous===undefined?sum/node.period:bars[i].close*(2/(node.period+1))+previous*(1-2/(node.period+1));
   if(!Number.isFinite(value))throw new Error("Indicator overflow");
   points.push({time:bars[i].time,value});previous=value;
  }
  return {label:`${node.kind} ${node.period}`,points};
 });
}
