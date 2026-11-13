// Runs only after current-password and MFA verification on the server.
export async function finishPasswordChange({admin,verifier,user,password}) {
 const changed=await admin.auth.admin.updateUserById(user.id,{password});
 if(changed.error)throw Error('비밀번호 변경에 실패했습니다.');
 const relogin=message=>({success:true,reloginRequired:true,message});
 // Updating a password may invalidate the verifier's old refresh session.
 // Rotate application metadata first, then sign in with the new password.
 try {
 const complete=await admin.rpc('easycall_work_password_complete',{p_user:user.id});
 if(complete.error)return relogin('비밀번호는 변경됐지만 계정 상태 확인이 필요합니다. 관리자에게 문의하세요.');
 const fresh=await verifier.auth.signInWithPassword({email:user.email,password});
 if(fresh.error||fresh.data?.user?.id!==user.id||!fresh.data?.session)return relogin('비밀번호가 변경됐습니다. 새 비밀번호로 다시 로그인하세요.');
 const session=fresh.data.session;
 const revoked=await admin.auth.admin.signOut(session.access_token,'others');
 if(revoked.error)return relogin('비밀번호가 변경됐습니다. 다른 로그인 세션 종료를 확인하지 못했습니다. 새 비밀번호로 다시 로그인하세요.');
 return {success:true,session:{access_token:session.access_token,refresh_token:session.refresh_token}};
 } catch { return relogin('비밀번호가 변경됐습니다. 후속 처리 결과를 확인하지 못했습니다. 새 비밀번호로 다시 로그인하세요.'); }
}
