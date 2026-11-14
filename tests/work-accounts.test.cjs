const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const mod=()=>import('../supabase/functions/_shared/work-account.mjs');
for(const name of ['easycall-work-accounts','easycall-admin-invite']){
 test(name+' permits browser session preflight without relaxing authentication',async()=>{
  const fixture=require('./edge-cors-handler.cjs')(name),origin='https://easycall-frontend.vercel.app';
  const r=await fixture.handler(new Request('https://fixture.invalid/',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization,apikey,content-type,x-client-info,x-easycall-session'}}));
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);
  const allowed=r.headers.get('access-control-allow-headers').split(',').map(x=>x.trim());
  for(const h of ['authorization','apikey','content-type','x-client-info','x-easycall-session'])assert.ok(allowed.includes(h),h);
  assert.equal(fixture.authCalls(),0);
  const denied=await fixture.handler(new Request('https://fixture.invalid/',{method:'POST',headers:{origin},body:'{}'}));
  assert.ok([401,403].includes(denied.status));assert.equal(fixture.authCalls(),1);
  const foreign=await fixture.handler(new Request('https://fixture.invalid/',{method:'POST',headers:{origin:'https://untrusted.invalid'},body:'{}'}));
  assert.equal(foreign.status,403);assert.notEqual(foreign.headers.get('access-control-allow-origin'),'https://untrusted.invalid');assert.equal(fixture.authCalls(),1);
 });
}
test('camp-scoped usernames normalize and map without real email',async()=>{const m=await mod();assert.deepEqual(m.accountKey(' CAMP01 ',' USER_01 '),{campId:'camp01',loginId:'user_01'});const expected=crypto.createHash('sha256').update('camp01:user_01').digest('hex')+'@login.easycall.invalid';assert.equal(await m.accountAddress('CAMP01','USER_01'),expected);assert.notEqual(await m.accountAddress('camp02','user_01'),expected);});
test('malformed identity and privilege escalation are rejected',async()=>{const m=await mod();for(const id of ['', 'x@y.com','../x','홍보1','a'.repeat(33)])assert.throws(()=>m.accountKey('camp01',id));assert.throws(()=>m.cleanBatch([{campId:'camp01',loginId:'a',role:'super'}]));assert.throws(()=>m.cleanBatch([{campId:'camp01',loginId:'a',role:'agent',phone:'123'}]));});
test('bulk validation catches duplicates across batch boundaries before any issuance',async()=>{const m=await mod();const rows=Array.from({length:2000},(_,i)=>({campId:'camp01',loginId:'u'+i,role:'agent',phone:'0419301001'}));assert.equal(m.cleanLargeBatch(rows).length,2000);rows[1999].loginId=rows[0].loginId;assert.throws(()=>m.cleanLargeBatch(rows));assert.throws(()=>m.cleanBatch(rows.slice(0,26)));});
test('temporary passwords are six digits with leading zeroes; permanent passwords require change',async()=>{const m=await mod();for(let i=0;i<1000;i++)assert.match(m.temporaryPassword(),/^[0-9]{6}$/);assert.throws(()=>m.validatePassword('12345'));assert.doesNotThrow(()=>m.validatePassword('123456','654321'));assert.throws(()=>m.validatePassword('123456','123456'));assert.throws(()=>m.validatePassword('a'.repeat(129)));assert.throws(()=>m.validatePassword('long-password','long-password'));assert.doesNotThrow(()=>m.validatePassword('new-long-password','123456'));const original=crypto.webcrypto.getRandomValues,samples=[4294967295,7,999999];try{crypto.webcrypto.getRandomValues=function(out){out[0]=samples.shift();return out;};assert.equal(m.temporaryPassword(),'000007');assert.equal(m.temporaryPassword(),'999999');assert.equal(samples.length,0);}finally{crypto.webcrypto.getRandomValues=original;}});
