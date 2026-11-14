const test=require('node:test'),assert=require('node:assert/strict');
const helper=import('../supabase/functions/_shared/credential-update.mjs');
function setup({role='agent',camp='camp01',fail}={}){
 const calls=[],user={id:'u1',app_metadata:{easycall_role:role,camp_id:camp,easycall_login_id:'agent01',easycall_work_status:'active'}};
 const admin={auth:{admin:{getUserById:async()=>({data:{user}}),updateUserById:async(id,args)=>{
  calls.push(['change',id,args]);if(fail==='transport')throw Error('secret provider message');
  return {error:fail==='reject'?{status:422,message:'secret'}:fail==='server'?{status:500,message:'secret'}:null};
 }}},rpc:async(name,args)=>{calls.push([name,args]);return {error:fail===name?Error('sensitive message'):null};}};
 return {admin,actorId:'manager',userId:'u1',password:'fictional-secret',path:'agent_common',expected:{campId:'camp01',role:'agent'},calls,user};
}
test('durable intent precedes credential write and records exact actor/target/path without secrets',async()=>{
 const x=setup(),r=await (await helper).updateCredential(x);
 assert.equal(r.auditPending,false);assert.deepEqual(x.calls.map(c=>c[0]),['easycall_credential_audit_begin','change','easycall_credential_audit_finish']);
 assert.equal(x.calls[0][1].p_actor,'manager');assert.equal(x.calls[0][1].p_user,'u1');assert.equal(x.calls[0][1].p_path,'agent_common');
 assert.equal(x.calls[2][1].p_outcome,'succeeded');assert.equal(x.calls[0][1].p_request,x.calls[2][1].p_request);
 assert.ok(!JSON.stringify([x.calls[0],x.calls[2]]).includes(x.password));
});
for(const opts of [{role:'admin'},{role:'super'},{camp:'camp02'}])test('common password refuses changed target '+JSON.stringify(opts),async()=>{
 const x=setup(opts);await assert.rejects((await helper).updateCredential(x));assert.deepEqual(x.calls,[]);
});
test('spoofed expectation cannot allow common password to overwrite administrator',async()=>{
 const x=setup({role:'admin'});x.expected.role='admin';await assert.rejects((await helper).updateCredential(x));assert.deepEqual(x.calls,[]);
});
test('self change requires same active account',async()=>{
 for(const status of ['active','disabled']){const x=setup();x.path='self_change';x.user.app_metadata.easycall_work_status=status;if(status==='disabled')x.actorId=x.userId;
 await assert.rejects((await helper).updateCredential(x));assert.deepEqual(x.calls,[]);}
});
test('reset refuses changed login mapping',async()=>{const x=setup();x.path='admin_reset';x.expected.loginId='different';await assert.rejects((await helper).updateCredential(x));assert.deepEqual(x.calls,[]);});
test('unavailable audit storage prevents credential mutation',async()=>{
 const x=setup({fail:'easycall_credential_audit_begin'});await assert.rejects((await helper).updateCredential(x),/변경하지 않았/);assert.equal(x.calls.length,1);
});
for(const [fail,outcome] of [['reject','rejected'],['server','unknown'],['transport','unknown']])test(fail+' is recorded without leaking provider error or retrying',async()=>{
 const x=setup({fail});await assert.rejects((await helper).updateCredential(x),e=>!e.message.includes('secret')&&e.message.includes('확인 번호'));
 assert.equal(x.calls.at(-1)[1].p_outcome,outcome);assert.equal(x.calls.filter(c=>c[0]==='change').length,1);
});
test('lost audit acknowledgement after success does not falsely report password failure',async()=>{
 const x=setup({fail:'easycall_credential_audit_finish'});const original=console.error,logs=[];
 try{console.error=line=>logs.push(line);const r=await (await helper).updateCredential(x);assert.equal(r.auditPending,true);assert.equal(logs.length,1);assert.ok(!logs[0].includes(x.password));}
 finally{console.error=original;}
});
