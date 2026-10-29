import { test } from "node:test";
import assert from "node:assert/strict";
import { candle, mergeCandles, parseHistory, parseTick, sma, MAX_CANDLES } from "../src/lib/market";
const bar = (time: number, close = 2) => candle(time,2,4,1,close,10);
test("history converts milliseconds and sorts/deduplicates", () => {
 assert.deepEqual(parseHistory([[2000,"2","4","1","3","10"],[1000,"2","4","1","2","10"]]).map(c => c.time), [1,2]);
});
test("candle rejects invalid OHLC and NaN", () => {
 assert.throws(() => candle(1, 2, 1, 1, 3, 10)); assert.throws(() => candle(1,2,4,1,"NaN",10));
});
test("updates replace the current bar, append the next, and bound memory", () => {
 const base = Array.from({length: MAX_CANDLES}, (_,i) => bar(i+1));
 const merged = mergeCandles(base,[bar(1000,3),bar(1001)]);
 assert.equal(merged.length,MAX_CANDLES); assert.equal(merged[0].time,2); assert.equal(merged.at(-2)?.close,3);
});
test("SMA uses only a complete trailing window and reflects current candle changes", () => {
 assert.deepEqual(sma([bar(1,1),bar(2,2),bar(3,3)],2), [{time:2,value:1.5},{time:3,value:2.5}]);
 assert.deepEqual(sma([bar(1)],50),[]);
});
test("stream validates symbol and interval", () => {
 const event = {e:"kline", E:1000,s:"BTCUSDT",k:{s:"BTCUSDT",i:"1m",t:1000,o:"2",h:"4",l:"1",c:"3",v:"10"}};
 assert.equal(parseTick(JSON.stringify(event),"1m").candle.close,3);
 assert.throws(() => parseTick(JSON.stringify(event),"5m"));
});
