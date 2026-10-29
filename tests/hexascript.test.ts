import {test} from "node:test";
import assert from "node:assert/strict";
import {parseHexaScript,evaluateHexaScript} from "../src/lib/hexascript";
const bars=[1,2,3,4,5].map((close,i)=>({time:i+1,close}));
test("parser creates a typed AST with comments and case-insensitive commands",()=>{
 assert.deepEqual(parseHexaScript("# trend\ncalculate sma 3").body,[{type:"Indicator",kind:"SMA",period:3,line:2}]);
});
test("parser rejects executable code, invalid periods, duplicates and resource excess",()=>{
 for(const code of ["", "alert(1)","calculate SMA 0","calculate EMA 501","calculate SMA 2.5","calculate SMA 2\ncalculate SMA 2","calculate SMA 1\ncalculate SMA 2\ncalculate SMA 3\ncalculate SMA 4\ncalculate SMA 5","x".repeat(2049)])assert.throws(()=>parseHexaScript(code));
});
test("SMA and EMA seed from a complete window",()=>{
 const plots=evaluateHexaScript(parseHexaScript("calculate SMA 3\ncalculate EMA 3"),bars);
 assert.deepEqual(plots[0].points,[{time:3,value:2},{time:4,value:3},{time:5,value:4}]);assert.deepEqual(plots[1].points,plots[0].points);
 assert.deepEqual(evaluateHexaScript(parseHexaScript("calculate SMA 50"),bars)[0].points,[]);
});
test("EMA reacts to current candle updates without accumulating previous evaluations",()=>{
 const program=parseHexaScript("calculate EMA 3");const changed=[...bars.slice(0,-1),{time:5,close:9}];
 assert.equal(evaluateHexaScript(program,changed)[0].points.at(-1)?.value,6);
 assert.equal(evaluateHexaScript(program,bars)[0].points.at(-1)?.value,4);
});
test("evaluator rejects unordered, nonfinite and oversized data",()=>{
 const p=parseHexaScript("calculate SMA 1");for(const data of [[{time:1,close:NaN}],[{time:2,close:1},{time:1,close:2}],Array.from({length:1001},(_,i)=>({time:i+1,close:1}))])assert.throws(()=>evaluateHexaScript(p,data));
});
