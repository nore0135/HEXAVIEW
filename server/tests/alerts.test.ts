import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { AlertEngine, PriceAlert } from "../src/alert-engine.js";
import { AlertWorker } from "../src/alert-worker.js";

const alert = (
  id: string,
  threshold: number,
  direction: PriceAlert["direction"] = "crosses_above",
): PriceAlert => ({ id, userId: "owner", symbol: "BTCUSDT", threshold, direction });
const tick = (sequence: number, price: number) => ({ symbol: "BTCUSDT", sequence, price });

test("crossings fire once, exact touches wait, first sample only sets baseline", () => {
  const e = new AlertEngine();
  e.add(alert("a", 100));
  assert.deepEqual(e.evaluate(tick(1, 90)), []);
  assert.deepEqual(e.evaluate(tick(2, 100)), []);
  assert.equal(e.evaluate(tick(3, 101))[0].alertId, "a");
  assert.deepEqual(e.evaluate(tick(4, 102)), []);
  assert.equal(e.size, 0);
});

test("AlertWorker syncs active alerts and persists triggered events to alert_outbox", async () => {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      return {
        rows: [
          {
            id: "alert-1",
            user_id: "user-1",
            symbol: "BTCUSDT",
            direction: "crosses_above",
            threshold: "90000",
          },
        ],
        rowCount: 1,
      };
    },
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ id: "alert-1" }], rowCount: 1 };
      },
      release: () => {},
    }),
  } as unknown as Pool;

  const worker = new AlertWorker(pool);
  const synced = await worker.syncActiveAlerts();
  assert.equal(synced, 1);
  assert.equal((await worker.evaluateTick({ symbol: "BTCUSDT", sequence: 1, price: 89500 })).length, 0);
  const events = await worker.evaluateTick({ symbol: "BTCUSDT", sequence: 2, price: 90100 });
  assert.equal(events.length, 1);
  assert.equal(events[0].alertId, "alert-1");
  assert.equal(queries.some((q) => q.includes("INSERT INTO alert_outbox")), true);
});

test("worker retains a failed crossing for retry without requiring another crossing", async () => {
  let fail = true;
  let inserts = 0;
  const pool = {connect:async()=>({
    query:async(sql:string)=>{
      if(sql.includes('INSERT INTO alert_outbox')) {if(fail)throw new Error('Database unavailable');inserts++;}
      return {rows:[{id:'a'}],rowCount:1};
    },release:()=>{},
  })} as unknown as Pool;
  const worker=new AlertWorker(pool);worker.registerAlert(alert('a',100));
  await worker.evaluateTick(tick(1,90));
  await assert.rejects(worker.evaluateTick(tick(2,110)),/Database unavailable/);
  fail=false;
  const recovered=await worker.flushPending();
  assert.equal(recovered.length,1);assert.equal(recovered[0].price,110);assert.equal(inserts,1);
  assert.deepEqual(await worker.flushPending(),[]);
});
test("cancelled database rule does not emit a notification",async()=>{
 let inserts=0;
 const pool={connect:async()=>({query:async(sql:string)=>{if(sql.includes('INSERT INTO'))inserts++;return {rows:[],rowCount:0};},release:()=>{}})} as unknown as Pool;
 const worker=new AlertWorker(pool);worker.registerAlert(alert('a',100));await worker.evaluateTick(tick(1,90));
 assert.deepEqual(await worker.evaluateTick(tick(2,110)),[]);assert.equal(inserts,0);
});
