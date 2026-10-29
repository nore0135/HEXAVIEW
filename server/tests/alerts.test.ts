import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AlertEngine,PriceAlert} from '../src/alert-engine.js';
const alert=(id:string,threshold:number,direction:PriceAlert['direction']='crosses_above'):PriceAlert=>({id,userId:'owner',symbol:'BTCUSDT',threshold,direction});
const tick=(sequence:number,price:number)=>({symbol:'BTCUSDT',sequence,price});
test('crossings fire once, exact touches wait, first sample only sets baseline',()=>{
 const e=new AlertEngine();e.add(alert('a',100));assert.deepEqual(e.evaluate(tick(1,90)),[]);assert.deepEqual(e.evaluate(tick(2,100)),[]);assert.equal(e.evaluate(tick(3,101))[0].alertId,'a');assert.deepEqual(e.evaluate(tick(4,102)),[]);assert.equal(e.size,0);
});
test('downward crossings and duplicate/stale events',()=>{
 const e=new AlertEngine();e.add(alert('b',100,'crosses_below'));e.evaluate(tick(10,110));assert.deepEqual(e.evaluate(tick(9,90)),[]);assert.deepEqual(e.evaluate(tick(10,90)),[]);assert.equal(e.evaluate(tick(11,90)).length,1);
});
test('large move selects all crossed thresholds but not untouched or opposite-direction alerts',()=>{
 const e=new AlertEngine();for(let i=1;i<=10000;i++)e.add(alert(String(i),i));e.add(alert('down',5000,'crosses_below'));e.evaluate(tick(1,4500));assert.equal(e.evaluate(tick(2,5500)).length,1000);assert.equal(e.size,9001);
});
test('cancellation, symbol isolation and baseline reset',()=>{
 const e=new AlertEngine();e.add(alert('a',100));assert.equal(e.remove('a'),true);assert.equal(e.remove('a'),false);e.add(alert('b',100));e.evaluate(tick(1,90));assert.deepEqual(e.evaluate({symbol:'OTHER',sequence:2,price:110}),[]);e.resetBaseline('BTCUSDT');assert.deepEqual(e.evaluate(tick(3,110)),[]);
});
test('capacity, duplicate IDs and malformed ticks are rejected',()=>{
 const e=new AlertEngine(1);e.add(alert('a',100));assert.throws(()=>e.add(alert('a',100)));assert.throws(()=>e.add(alert('b',100)));assert.throws(()=>e.evaluate(tick(1,NaN)));
});
