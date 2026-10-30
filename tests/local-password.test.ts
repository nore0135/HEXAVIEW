import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashLocalPassword,verifyLocalPassword} from '../src/lib/local-password';
test('browser password verifier uses random salts and rejects incorrect passwords',async()=>{
 const a=await hashLocalPassword('long-password');const b=await hashLocalPassword('long-password');
 assert.notEqual(a,b);assert.equal((await verifyLocalPassword('long-password',a)).valid,true);assert.equal((await verifyLocalPassword('wrong',a)).valid,false);
});
test('old accounts can migrate after successful login; malformed verifiers fail',async()=>{
 assert.deepEqual(await verifyLocalPassword('old-password',btoa('hexaview:old-password')),{valid:true,upgrade:true});
 assert.equal((await verifyLocalPassword('wrong',btoa('hexaview:old-password'))).valid,false);
 assert.equal((await verifyLocalPassword('x','pbkdf2-sha256$600000$bad$bad')).valid,false);
});
