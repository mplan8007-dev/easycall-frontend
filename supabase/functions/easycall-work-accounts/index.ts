import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { accountKey, cleanBatch, temporaryPassword, validatePassword } from '../_shared/work-account.mjs';
import { validateCommonPassword, sealCommonPassword, openCommonPassword } from '../_shared/common-password.mjs';
import { finishPasswordChange } from '../_shared/password-change.mjs';
import { updateCredential } from '../_shared/credential-update.mjs';
const origins=new Set(['https://easycall-frontend.vercel.app','https://mplan8007-dev.github.io']);
Deno.serve(async(request:Request)=>{
 const origin=request.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://easycall-frontend.vercel.app','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-easycall-session','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store',Vary:'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST'||!origins.has(origin))return reply({error:'허용되지 않은 요청입니다.'},403);
 try{
  if(Number(request.headers.get('content-length')||0)>40000)return reply({error:'입력량이 너무 큽니다.'},413);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const caller=createClient(url,key,{...options,global:{headers:{Authorization:request.headers.get('authorization')||''}}});
  const {data:identity,error:identityError}=await caller.auth.getUser();
  if(identityError||!identity.user)return reply({error:'다시 로그인하세요.'},401);
  const body=await request.json();
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,options);
  const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await caller.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;};
  const serviceSecret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceRpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;};
  const commonSecret=async(campId:string)=>await serviceRpc('easycall_agent_common_secret',{p_camp:campId});
  const acquireAgentPassword=async(campId:string)=>{
   const state=await rpc('easycall_agent_common_state',{p_camp:campId});
   if(!state.configured)throw Error('먼저 홍보요원 공통 비밀번호를 설정하고 전체 적용을 완료하세요.');
   if(!state.ready)throw Error('공통 비밀번호 전체 적용을 먼저 완료하세요.');
   const held=await serviceRpc('easycall_agent_common_issue',{p_camp:campId,p_version:state.version});
   try{return {...held,password:await openCommonPassword(held.ciphertext,serviceSecret,campId,held.version)};}
   catch(e){await serviceRpc('easycall_agent_common_release',{p_camp:campId,p_version:held.version,p_lease:held.lease,p_user:null});throw e;}
  };
  if(String(body.action||'').startsWith('agent-common-')){
   const campId=accountKey(body.campId,'policy').campId;
   let state=await rpc('easycall_agent_common_state',{p_camp:campId});
   if(body.action==='agent-common-status')return reply({state});
   if(body.action==='agent-common-set'){
    const password=validateCommonPassword(body.password),version=crypto.randomUUID();
    if(state.configured&&state.ready){
     if(state.version!==(body.expectedVersion||null))throw Error('설정이 변경됐습니다. 새로고침하세요.');
     const previous=await commonSecret(campId);
     try{if(await openCommonPassword(previous.ciphertext,serviceSecret,campId,previous.version)===password)return reply({state});}catch{/* A ready policy can be replaced after encryption key rotation. */}
    }
    const cipher=await sealCommonPassword(password,serviceSecret,campId,version);
    state=await rpc('easycall_agent_common_begin',{p_camp:campId,p_cipher:cipher,p_version:version,p_expected:body.expectedVersion||null});
    return reply({state});
   }
   if(!state.configured||state.version!==body.version)throw Error('공통 비밀번호 설정이 변경됐습니다. 새로고침하세요.');
   if(body.action==='agent-common-retry'){state=await rpc('easycall_agent_common_retry',{p_camp:campId,p_version:body.version});return reply({state});}
   if(body.action==='agent-common-read'){
    if(!state.ready)throw Error('전체 적용을 먼저 완료하세요.');
    const saved=await commonSecret(campId);
    if(saved.version!==state.version)throw Error('설정이 변경됐습니다. 새로고침하세요.');
    return reply({state,password:await openCommonPassword(saved.ciphertext,serviceSecret,campId,saved.version)});
   }
   if(body.action==='agent-common-apply'){
    const saved=await commonSecret(campId);
    if(saved.version!==state.version)throw Error('설정이 변경됐습니다. 새로고침하세요.');
    const password=await openCommonPassword(saved.ciphertext,serviceSecret,campId,saved.version);
    const batch=await serviceRpc('easycall_agent_common_claim',{p_camp:campId,p_version:state.version});
    if(batch.busy)return reply({state,busy:true});
    for(const uid of batch.users){
     try{
      // Reject unexpected targets; never report a manager as successfully updated.
      await updateCredential({admin,actorId:identity.user.id,userId:uid,password,path:'agent_common',expected:{campId,role:'agent'}});
      await serviceRpc('easycall_agent_common_finish',{p_camp:campId,p_version:state.version,p_user:uid,p_lease:batch.lease,p_success:true});
     }catch{
      await serviceRpc('easycall_agent_common_finish',{p_camp:campId,p_version:state.version,p_user:uid,p_lease:batch.lease,p_success:false});
     }
    }
    state=await rpc('easycall_agent_common_state',{p_camp:campId});return reply({state});
   }
   throw Error('지원하지 않는 공통 비밀번호 작업입니다.');
  }
  if(body.action==='change-password'){
   const user=identity.user,m=user.app_metadata;
   if(m.easycall_work_status!=='active'||!m.easycall_login_id)return reply({error:'업무용 계정 상태를 확인하세요.'},403);
   if(m.easycall_role==='agent'&&await commonSecret(m.camp_id))return reply({error:'홍보요원은 캠프 공통 비밀번호를 사용합니다. 변경은 캠프 관리자에게 요청하세요.'},403);
   validatePassword(body.newPassword,body.currentPassword);
   const assurance=await caller.auth.mfa.getAuthenticatorAssuranceLevel();
   if(assurance.error||(assurance.data?.nextLevel==='aal2'&&assurance.data?.currentLevel!=='aal2'))return reply({error:'2단계 인증을 먼저 완료하세요.'},403);
   const verifier=createClient(url,key,options);
   const verified=await verifier.auth.signInWithPassword({email:user.email!,password:body.currentPassword});
   if(verified.error||verified.data.user?.id!==user.id)return reply({error:'현재 비밀번호를 확인하세요.'},403);
   // Re-read live state after password verification; never reactivate a disabled user.
   const latest=await admin.auth.admin.getUserById(user.id);
   if(latest.error||latest.data.user?.app_metadata.easycall_work_status!=='active')return reply({error:'사용 중지된 계정입니다.'},403);
   return reply(await finishPasswordChange({admin,verifier,user,password:body.newPassword}));
  }
  if(body.action==='create'){
   const rows=cleanBatch(body.rows),results=[];
   for(const row of rows){
    let uid:string|undefined,held:any=null;
    try{
     const args={p_camp:row.campId,p_login:row.loginId,p_role:row.role};
     const context=await rpc('easycall_work_account_context',args);
     if(context.userId)throw Error('이미 발급된 ID입니다. 비밀번호 초기화를 사용하세요.');
     if(row.role==='agent')held=await acquireAgentPassword(row.campId);
     const password=held?held.password:temporaryPassword();
     const created=await admin.auth.admin.createUser({email:context.email,password,email_confirm:true,app_metadata:{easycall_role:row.role,camp_id:row.campId,agent_id:row.role==='agent'?row.loginId:null,easycall_login_id:row.loginId,easycall_work_status:'pending',easycall_must_change:true,...(held?{easycall_agent_common_version:held.version}:{}),easycall_created_by:identity.user.id,easycall_work_profile:{alias:row.alias,phone:row.phone}}});
     if(created.error||!created.data.user)throw Error('계정을 생성하지 못했습니다. 중복 ID와 서버 설정을 확인하세요.');
     uid=created.data.user.id;
     await rpc('easycall_work_account_activate',{...args,p_user:uid,p_alias:row.alias,p_phone:row.phone});
     if(held){await serviceRpc('easycall_agent_common_release',{p_camp:row.campId,p_version:held.version,p_lease:held.lease,p_user:uid});held=null;}
     results.push({...row,success:true,password,commonPassword:row.role==='agent'});
    }catch(error){
     // Do not delete a possibly activated account when its acknowledgement was lost.
     // A pending account is denied business access; an authorized reset can resume it.
     results.push({...row,success:false,error:error instanceof Error?error.message:'발급 실패',reviewPending:Boolean(uid)});
    }finally{if(held)try{await serviceRpc('easycall_agent_common_release',{p_camp:row.campId,p_version:held.version,p_lease:held.lease,p_user:null});}catch{/* Lease expires; do not expose ciphertext or credentials. */}}
   }
   return reply({results});
  }
  const target=accountKey(body.campId,body.loginId),role=body.role;
  const args={p_camp:target.campId,p_login:target.loginId,p_role:role};
  if(!['admin','agent'].includes(role))throw Error('역할을 확인하세요.');
  if(['disable','enable'].includes(body.action)){await rpc('easycall_work_account_state',{...args,p_state:body.action==='disable'?'disabled':'active'});return reply({success:true});}
  if(body.action==='reset'){
   let held:any=null;
   try{
   const context=await rpc('easycall_work_account_context',args);
   if(role==='agent')held=await acquireAgentPassword(target.campId);
   if(context.metadata?.easycall_work_status==='pending'){
    const profile=context.metadata.easycall_work_profile;
    if(!profile)throw Error('발급 정보가 부족합니다. 최고관리자에게 문의하세요.');
    await rpc('easycall_work_account_activate',{...args,p_user:context.userId,p_alias:profile.alias,p_phone:profile.phone});
   }
   // This also blocks existing sessions before changing the credential.
   const targetState=await rpc('easycall_work_account_state',{...args,p_state:'reset'});
   const password=held?held.password:temporaryPassword();
   const audit=await updateCredential({admin,actorId:identity.user.id,userId:targetState.userId,password,path:'admin_reset',expected:{campId:target.campId,role,loginId:target.loginId}});
   if(held){await serviceRpc('easycall_agent_common_release',{p_camp:target.campId,p_version:held.version,p_lease:held.lease,p_user:targetState.userId});held=null;}
   return reply({success:true,password,commonPassword:role==='agent',auditPending:audit.auditPending,requestId:audit.requestId});
   }finally{if(held)try{await serviceRpc('easycall_agent_common_release',{p_camp:target.campId,p_version:held.version,p_lease:held.lease,p_user:null});}catch{/* Lease expires safely. */}}
  }
  return reply({error:'지원하지 않는 작업입니다.'},400);
 }catch(error){return reply({error:error instanceof Error?error.message:'계정 처리 실패'},400);}
});
