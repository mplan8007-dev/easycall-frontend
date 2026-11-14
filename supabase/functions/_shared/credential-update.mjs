// Only call after endpoint authorization. Never log credentials, provider errors or tokens.
export async function updateCredential({admin,actorId,userId,password,path,expected}) {
 if(!['self_change','admin_reset','agent_common'].includes(path)||!actorId||!userId||
    !expected?.campId||!['admin','agent','super'].includes(expected.role))throw Error('비밀번호 변경 대상 정보가 부족합니다.');
 const latest=await admin.auth.admin.getUserById(userId),user=latest.data?.user,m=user?.app_metadata;
 if(latest.error||user?.id!==userId||m?.camp_id!==expected.campId||m?.easycall_role!==expected.role||
    (expected.loginId!==undefined&&m?.easycall_login_id!==expected.loginId)||
    (path==='agent_common'&&m?.easycall_role!=='agent')||
    (path==='self_change'&&(actorId!==userId||m?.easycall_work_status!=='active')))
  throw Error('계정 정보가 변경됐습니다. 새로고침 후 대상을 다시 확인하세요.');
 const requestId=crypto.randomUUID();
 const args={p_request:requestId,p_actor:actorId,p_user:userId,p_path:path,p_camp:expected.campId,p_role:expected.role};
 const started=await admin.rpc('easycall_credential_audit_begin',args);
 if(started.error)throw Error('변경 기록을 준비하지 못해 비밀번호를 변경하지 않았습니다. 관리자에게 문의하세요.');
 const finish=async outcome=>{
  try{const r=await admin.rpc('easycall_credential_audit_finish',{p_request:requestId,p_outcome:outcome});if(!r.error)return true;}catch{/* Pending intent remains durable. */}
  console.error(JSON.stringify({event:'credential_audit_pending',requestId,outcome}));return false;
 };
 let changed;
 try{changed=await admin.auth.admin.updateUserById(userId,{password});}
 catch{await finish('unknown');throw Error('비밀번호 변경 결과를 확인하지 못했습니다. 재시도 전에 관리자에게 문의하세요. 확인 번호: '+requestId);}
 if(changed.error){
  // Timeouts and server errors do not prove the write was rolled back.
  const status=Number(changed.error.status),rejected=status>=400&&status<500&&status!==408;
  await finish(rejected?'rejected':'unknown');
  throw Error((rejected?'비밀번호 변경 요청이 거절됐습니다.':'비밀번호 변경 결과를 확인하지 못했습니다. 재시도 전에 관리자에게 문의하세요.')+' 확인 번호: '+requestId);
 }
 const recorded=await finish('succeeded');
 return {requestId,auditPending:!recorded};
}
