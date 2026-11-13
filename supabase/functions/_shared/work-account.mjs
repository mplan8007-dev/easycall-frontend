export function accountKey(campId, loginId) {
  const camp=String(campId||'').trim().toLowerCase(), login=String(loginId||'').trim().toLowerCase();
  if(!/^[a-z0-9_-]{1,64}$/.test(camp)||!/^[a-z0-9_-]{1,32}$/.test(login)) throw Error('캠프 ID는 64자, 사용자 ID는 32자 이내의 영문·숫자·밑줄·하이픈으로 입력하세요.');
  return {campId:camp,loginId:login};
}
export async function accountAddress(campId,loginId) {
  const k=accountKey(campId,loginId), bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(k.campId+':'+k.loginId));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')+'@login.easycall.invalid';
}
export function temporaryPassword() { return Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join(''); }
export function cleanLargeBatch(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>2000)throw Error('1~2,000개 계정을 입력하세요.');
 const all=[];for(let i=0;i<rows.length;i+=25)all.push(...cleanBatch(rows.slice(i,i+25)));
 const keys=new Set();for(const r of all){const key=r.campId+':'+r.loginId;if(keys.has(key))throw Error('목록 전체에 중복 사용자 ID가 있습니다.');keys.add(key);}return all;
}
export function validatePassword(password,previous='') {
  if(typeof password!=='string'||password.length<12||password.length>128||password===previous)throw Error('기존 비밀번호와 다른 12~128자의 비밀번호를 입력하세요.');
}
export function cleanBatch(rows) {
  if(!Array.isArray(rows)||rows.length<1||rows.length>25)throw Error('한 번에 1~25개 계정을 처리할 수 있습니다.');
  const keys=new Set();
  return rows.map(r=>{const k=accountKey(r.campId,r.loginId),key=k.campId+':'+k.loginId;if(keys.has(key))throw Error('중복 사용자 ID입니다.');keys.add(key);
    if(!['admin','agent'].includes(r.role))throw Error('계정 역할이 올바르지 않습니다.');
    const alias=String(r.alias||k.loginId).trim(),phone=String(r.phone||'').replace(/[^0-9]/g,'');
    if(alias.length>80||(r.role==='agent'&&!/^0[0-9]{8,10}$/.test(phone)))throw Error('요원명과 배정 전화번호를 확인하세요.');
    return {...k,role:r.role,alias,phone};});
}
