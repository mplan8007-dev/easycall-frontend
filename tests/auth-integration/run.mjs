import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {updateCredential} from '../../supabase/functions/_shared/credential-update.mjs';
const envFile='tests/auth-integration/.env',compose=['compose','--env-file',envFile,'-f','tests/auth-integration/compose.yaml'];
if(process.argv.includes('--prepare')){
 fs.writeFileSync(envFile,'AUTH_TEST_DB_PASSWORD='+crypto.randomBytes(24).toString('hex')+'\nAUTH_TEST_JWT_SECRET='+crypto.randomBytes(40).toString('hex')+'\n',{mode:0o600});
 console.log('Prepared isolated Auth fixture. No production credentials used.');process.exit(0);
}
const secret=fs.readFileSync(envFile,'utf8').match(/^AUTH_TEST_JWT_SECRET=(.+)$/m)[1];
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const unsigned=b64({alg:'HS256',typ:'JWT'})+'.'+b64({role:'service_role',exp:Math.floor(Date.now()/1000)+3600});
const token=unsigned+'.'+crypto.createHmac('sha256',secret).update(unsigned).digest('base64url');
const base='http://127.0.0.1:54331';
async function api(path,body,method='POST',bearer=token){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+bearer},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
 const data=await r.json();return {data,error:r.ok?null:{status:r.status}};
}
function sql(statement){return execFileSync('docker',[...compose,'exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','easycall_auth_test','-tAc',statement],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}if(i===59)throw Error('Isolated Auth failed to start');await new Promise(r=>setTimeout(r,1000));}
sql(fs.readFileSync('supabase/migrations/20261114_credential_audit.sql','utf8'));
const create=async(role,login,password)=>{
 const r=await api('/admin/users',{email:login+'@example.invalid',password,email_confirm:true,app_metadata:{easycall_role:role,camp_id:'fixture',easycall_login_id:login,easycall_work_status:'active'}});
 assert.equal(r.error,null,'fixture creation');return r.data;
};
const oldPassword='Fixture-old-'+crypto.randomUUID(),newPassword='Fixture-new-'+crypto.randomUUID();
const manager=await create('admin','manager',oldPassword),agent=await create('agent','agent',oldPassword);
const login=async(u,p)=>{const r=await api('/token?grant_type=password',{email:u.email,password:p});assert.equal(r.error,null,'password login');assert.equal(r.data.user.id,u.id);return r.data;};
const count=u=>Number(sql('select count(*) from easycall_private_v2.credential_changes where user_id='+quote(u.id)+'::uuid'));
const before=count(manager);let session=await login(manager,oldPassword);
assert.equal(count(manager),before,'ordinary login cannot fabricate a credential change');
const refresh=await api('/token?grant_type=refresh_token',{refresh_token:session.refresh_token});assert.equal(refresh.error,null);assert.equal(count(manager),before,'refresh cannot fabricate a credential change');
const admin={auth:{admin:{getUserById:async id=>{const r=await api('/admin/users/'+id,undefined,'GET');return {data:{user:r.data},error:r.error};},updateUserById:async(id,args)=>api('/admin/users/'+id,args,'PUT')}},rpc:async(name,args)=>{
 try{if(name==='easycall_credential_audit_begin')sql('select public.easycall_credential_audit_begin('+[args.p_request,args.p_actor,args.p_user,args.p_path,args.p_camp,args.p_role].map(quote).join(',')+')');
 else if(name==='easycall_credential_audit_finish')sql('select public.easycall_credential_audit_finish('+[args.p_request,args.p_outcome].map(quote).join(',')+')');else throw Error('Unknown fixture RPC');return {error:null};}catch{return {error:{message:'fixture RPC failed'}};}
}};
const params={admin,actorId:manager.id,userId:manager.id,password:newPassword,path:'self_change',expected:{campId:'fixture',role:'admin',loginId:'manager'}};
const changed=await updateCredential(params);assert.equal(changed.auditPending,false);assert.equal(count(manager),before+1);
assert.ok((await api('/token?grant_type=password',{email:manager.email,password:oldPassword})).error,'old password must fail');await login(manager,newPassword);
await assert.rejects(updateCredential({...params,path:'agent_common',expected:{campId:'fixture',role:'agent'}}));await login(manager,newPassword);assert.equal(count(manager),before+1);
await updateCredential({...params,userId:agent.id,path:'agent_common',expected:{campId:'fixture',role:'agent'}});await login(agent,newPassword);await login(manager,newPassword);assert.equal(count(manager),before+1);
const supervisor=await create('super','supervisor',oldPassword);
const resetPassword='Fixture-reset-'+crypto.randomUUID();await updateCredential({...params,actorId:supervisor.id,password:resetPassword,path:'admin_reset'});await login(manager,resetPassword);assert.equal(count(manager),before+2);
// A direct Auth API change (outside the application helper) must still be observable.
assert.equal((await api('/admin/users/'+manager.id,{password:newPassword},'PUT')).error,null);await login(manager,newPassword);assert.equal(count(manager),before+3);
assert.equal(sql("select count(*) from easycall_private_v2.credential_requests where outcome='succeeded'"),'3');
console.log('PASS: real isolated GoTrue login, refresh, self change, reset, common-password admin isolation and direct Auth observation. Passwords/tokens omitted.');
