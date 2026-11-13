import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { accountKey, cleanBatch, temporaryPassword, validatePassword } from '../_shared/work-account.mjs';
const origins=new Set(['https://easycall-frontend.vercel.app','https://mplan8007-dev.github.io']);
Deno.serve(async(request:Request)=>{
 const origin=request.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://easycall-frontend.vercel.app','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store',Vary:'Origin'};
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
  if(body.action==='change-password'){
   const user=identity.user,m=user.app_metadata;
   if(m.easycall_work_status!=='active'||!m.easycall_login_id)return reply({error:'업무용 계정 상태를 확인하세요.'},403);
   validatePassword(body.newPassword,body.currentPassword);
   const assurance=await caller.auth.mfa.getAuthenticatorAssuranceLevel();
   if(assurance.error||(assurance.data?.nextLevel==='aal2'&&assurance.data?.currentLevel!=='aal2'))return reply({error:'2단계 인증을 먼저 완료하세요.'},403);
   const verifier=createClient(url,key,options);
   const verified=await verifier.auth.signInWithPassword({email:user.email!,password:body.currentPassword});
   if(verified.error||verified.data.user?.id!==user.id)return reply({error:'현재 비밀번호를 확인하세요.'},403);
   // Re-read live state after password verification; never reactivate a disabled user.
   const latest=await admin.auth.admin.getUserById(user.id);
   if(latest.error||latest.data.user?.app_metadata.easycall_work_status!=='active')return reply({error:'사용 중지된 계정입니다.'},403);
   const changed=await admin.auth.admin.updateUserById(user.id,{password:body.newPassword});
   if(changed.error)throw Error('비밀번호 변경에 실패했습니다.');
   if(!verified.data.session)throw Error('재인증 세션을 확인할 수 없습니다.');
   const revoked=await admin.auth.admin.signOut(verified.data.session.access_token,'others');
   if(revoked.error)throw Error('다른 로그인 세션을 종료하지 못했습니다. 다시 시도하세요.');
   const complete=await admin.rpc('easycall_work_password_complete',{p_user:user.id});
   if(complete.error)throw Error('비밀번호는 변경됐지만 계정 상태 확인이 필요합니다. 관리자에게 문의하세요.');
   const session=await verifier.auth.refreshSession();
   if(session.error||!session.data.session)throw Error('비밀번호가 변경됐습니다. 새 비밀번호로 다시 로그인하세요.');
   return reply({success:true,session:{access_token:session.data.session.access_token,refresh_token:session.data.session.refresh_token}});
  }
  if(body.action==='create'){
   const rows=cleanBatch(body.rows),results=[];
   for(const row of rows){
    let uid:string|undefined;
    try{
     const args={p_camp:row.campId,p_login:row.loginId,p_role:row.role};
     const context=await rpc('easycall_work_account_context',args);
     if(context.userId)throw Error('이미 발급된 ID입니다. 비밀번호 초기화를 사용하세요.');
     const password=temporaryPassword();
     const created=await admin.auth.admin.createUser({email:context.email,password,email_confirm:true,app_metadata:{easycall_role:row.role,camp_id:row.campId,agent_id:row.role==='agent'?row.loginId:null,easycall_login_id:row.loginId,easycall_work_status:'pending',easycall_must_change:true,easycall_created_by:identity.user.id,easycall_work_profile:{alias:row.alias,phone:row.phone}}});
     if(created.error||!created.data.user)throw Error('계정을 생성하지 못했습니다. 중복 ID와 서버 설정을 확인하세요.');
     uid=created.data.user.id;
     await rpc('easycall_work_account_activate',{...args,p_user:uid,p_alias:row.alias,p_phone:row.phone});
     results.push({...row,success:true,password});
    }catch(error){
     // Do not delete a possibly activated account when its acknowledgement was lost.
     // A pending account is denied business access; an authorized reset can resume it.
     results.push({...row,success:false,error:error instanceof Error?error.message:'발급 실패',reviewPending:Boolean(uid)});
    }
   }
   return reply({results});
  }
  const target=accountKey(body.campId,body.loginId),role=body.role;
  const args={p_camp:target.campId,p_login:target.loginId,p_role:role};
  if(!['admin','agent'].includes(role))throw Error('역할을 확인하세요.');
  if(['disable','enable'].includes(body.action)){await rpc('easycall_work_account_state',{...args,p_state:body.action==='disable'?'disabled':'active'});return reply({success:true});}
  if(body.action==='reset'){
   const context=await rpc('easycall_work_account_context',args);
   if(context.metadata?.easycall_work_status==='pending'){
    const profile=context.metadata.easycall_work_profile;
    if(!profile)throw Error('발급 정보가 부족합니다. 최고관리자에게 문의하세요.');
    await rpc('easycall_work_account_activate',{...args,p_user:context.userId,p_alias:profile.alias,p_phone:profile.phone});
   }
   // This also blocks existing sessions before changing the credential.
   const targetState=await rpc('easycall_work_account_state',{...args,p_state:'reset'});
   const password=temporaryPassword();
   const changed=await admin.auth.admin.updateUserById(targetState.userId,{password});
   if(changed.error)throw Error('초기화 실패. 계정은 비밀번호 변경 대기 상태입니다. 다시 초기화하세요.');
   return reply({success:true,password});
  }
  return reply({error:'지원하지 않는 작업입니다.'},400);
 }catch(error){return reply({error:error instanceof Error?error.message:'계정 처리 실패'},400);}
});
