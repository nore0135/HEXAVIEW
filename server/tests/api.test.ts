import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {createApp} from '../src/app.js';
import {hashPassword,verifyPassword,newToken,tokenHash} from '../src/security.js';
import {chartState} from '../src/schema.js';
test('password verification and opaque session hashing',async()=>{
 const hash=await hashPassword('a-very-long-password');assert.equal(await verifyPassword('a-very-long-password',hash),true);assert.equal(await verifyPassword('wrong-password',hash),false);assert.equal(newToken().length,43);assert.equal(tokenHash('a').length,64);
});
test('layout schema rejects unsupported symbols and unknown state fields',()=>{
 const state={schemaVersion:1,symbol:'BTCUSDT',interval:'1m',showSma:false};assert.equal(chartState.safeParse(state).success,true);assert.equal(chartState.safeParse({...state,symbol:'UNKNOWN'}).success,false);assert.equal(chartState.safeParse({...state,script:'execute'}).success,false);
});
test('unauthenticated requests never query private workspace data',async()=>{
 let queries=0;const pool={query:async()=>{queries++;return {rows:[]};}} as unknown as Pool;
 const app=await createApp(pool,['https://example.github.io']);
 try {const response=await app.inject({method:'GET',url:'/workspaces'});assert.equal(response.statusCode,401);assert.equal(queries,0);}finally{await app.close();}
});
test('workspace lookup is owner-scoped and missing access returns 404',async()=>{
 const calls:{sql:string;params:unknown[]}[]=[];
 const pool={query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return sql.includes('FROM sessions')?{rows:[{user_id:'owner-a'}],rowCount:1}:{rows:[],rowCount:0};}} as unknown as Pool;
 const app=await createApp(pool,['https://example.github.io']);
 try {const response=await app.inject({method:'GET',url:'/workspaces/00000000-0000-4000-8000-000000000001',headers:{authorization:`Bearer ${newToken()}`}});assert.equal(response.statusCode,404);assert.match(calls[1].sql,/user_id=\$2/);assert.equal(calls[1].params[1],'owner-a');}finally{await app.close();}
});
test('optimistic write conflict returns 409',async()=>{
 const pool={query:async(sql:string)=>sql.includes('FROM sessions')?{rows:[{user_id:'owner-a'}],rowCount:1}:sql.startsWith('UPDATE')?{rows:[],rowCount:0}:{rows:[{}],rowCount:1}} as unknown as Pool;
 const app=await createApp(pool,['https://example.github.io']);
 try {const response=await app.inject({method:'PUT',url:'/workspaces/00000000-0000-4000-8000-000000000001',headers:{authorization:`Bearer ${newToken()}`},payload:{name:'Layout',state:{schemaVersion:1,symbol:'BTCUSDT',interval:'1m',showSma:false},version:1}});assert.equal(response.statusCode,409);}finally{await app.close();}
});
