import './runtime-scaling.js';
import {accountKey,accountAddress,cleanLargeBatch,validatePassword} from './supabase/functions/_shared/work-account.mjs';

const $=id=>document.getElementById(id);
const legacyLogin=window.handleInstantLogin,legacyActivate=window.activateVerifiedUser;
let busy=false,pendingUser=null,issued=[];
const inputClass='w-full rounded-lg border border-slate-600 bg-slate-800 p-2 text-white';
function message(id,text){$(id).textContent=text;}
function modal(id,title,content){const box=document.createElement('section');box.id=id;box.className='hidden fixed inset-0 z-[10040] bg-slate-950/90 flex items-center justify-center p-4';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);box.innerHTML=`<div class="max-w-2xl w-full max-h-[90vh] overflow-auto bg-slate-900 text-white rounded-2xl p-6 space-y-3"><h3 class="text-xl font-bold">${title}</h3>${content}</div>`;document.body.append(box);}
async function request(body){if(!sbClient)throw Error('서버 연결을 확인하세요.');const {data,error}=await sbClient.functions.invoke('easycall-work-accounts',{body});if(error)throw Error('계정 서버에 연결하지 못했습니다. 발급 결과가 불확실하면 같은 ID를 확인하고 초기화를 사용하세요.');if(data?.error)throw Error(data.error);return data;}
function canManage(){return verifiedIdentity&&['super','admin'].includes(verifiedIdentity.role)&&!sessionStorage.getItem('easycall_master_impersonator');}
function show(id){$(id).classList.remove('hidden');}
function hide(id){$(id).classList.add('hidden');}
const campField=document.createElement('div');campField.className='space-y-1';campField.innerHTML=`<label for="work-login-camp" class="block text-xs text-slate-400">캠프 ID (이메일 로그인은 비워두세요)</label><input id="work-login-camp" class="${inputClass}" placeholder="예: camp01" autocomplete="organization"><p class="text-xs text-slate-400">업무용 계정은 캠프 ID와 사용자 ID를 입력하세요. 기존 이메일 계정도 사용할 수 있습니다.</p>`;
$('login-id').closest('div').before(campField);$('login-id').placeholder='사용자 ID 또는 기존 이메일';
const loginLabel=$('login-id').closest('div').querySelector('label');if(loginLabel)loginLabel.textContent='사용자 ID 또는 기존 이메일';
window.handleInstantLogin=async function(){
 if(busy)return;const id=$('login-id').value.trim();if(id.includes('@'))return legacyLogin();
 busy=true;
 try{const k=accountKey($('work-login-camp').value,id);$('login-id').value=await accountAddress(k.campId,k.loginId);await legacyLogin();}
 catch(e){showToast(e.message);}finally{$('login-id').value=id;busy=false;}
};
modal('work-password-dialog','비밀번호 변경 (선택)',`
<p class="text-sm text-slate-300">지금 변경하거나 나중에 변경할 수 있습니다. 임시 비밀번호로도 업무를 시작할 수 있습니다.</p>
<label class="block">현재 비밀번호<input id="work-current-password" type="password" autocomplete="current-password" class="${inputClass}"></label>
<label class="block">새 비밀번호 (6자 이상)<input id="work-new-password" type="password" minlength="6" maxlength="128" autocomplete="new-password" class="${inputClass}"></label>
<label class="block">새 비밀번호 확인<input id="work-confirm-password" type="password" autocomplete="new-password" class="${inputClass}"></label>
<label class="block">인증 앱 코드 (이미 2단계 인증을 등록한 계정만)<input id="work-change-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="${inputClass}"></label>
<p id="work-password-message" role="status" class="text-amber-200"></p><button id="work-password-save" class="bg-indigo-600 px-4 py-2 rounded-lg">비밀번호 변경</button><button id="work-password-skip" class="px-4 py-2 bg-slate-700 rounded-lg">나중에 변경 · 업무 시작</button><button id="work-password-cancel" class="px-4 py-2">로그아웃</button>`);
function passwordReminderKey(user){return 'easycall_password_deferred:'+user.id+':'+(user.app_metadata?.easycall_auth_version||'initial');}
function reminderDeferred(user){try{return localStorage.getItem(passwordReminderKey(user))==='yes';}catch{return false;}}
function deferReminder(user){try{localStorage.setItem(passwordReminderKey(user),'yes');}catch{}}
window.activateVerifiedUser=async function(user){
 if(user?.app_metadata?.easycall_must_change&&!reminderDeferred(user)){pendingUser=user;show('work-password-dialog');return;}
 return legacyActivate(user);
};
$('work-password-save').onclick=async()=>{
 if(busy||!pendingUser)return;busy=true;$('work-password-save').disabled=true;
 try{const password=$('work-new-password').value,current=$('work-current-password').value;validatePassword(password,current);if(password!==$('work-confirm-password').value)throw Error('새 비밀번호 확인이 일치하지 않습니다.');
  const assurance=await sbClient.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)throw assurance.error;
  if(assurance.data?.nextLevel==='aal2'&&assurance.data?.currentLevel!=='aal2'){
   const code=$('work-change-otp').value.trim();if(!/^\d{6}$/.test(code))throw Error('등록된 인증 앱의 6자리 코드를 입력하세요.');
   const factors=await sbClient.auth.mfa.listFactors();if(factors.error)throw factors.error;const factor=factors.data.totp.find(f=>f.status==='verified');if(!factor)throw Error('등록된 인증 앱을 확인하세요.');
   const verified=await sbClient.auth.mfa.challengeAndVerify({factorId:factor.id,code});if(verified.error)throw verified.error;
  }
  const changed=await request({action:'change-password',currentPassword:current,newPassword:password});
  if(!changed.session)throw Error('새 비밀번호로 다시 로그인하세요.');
  const refreshed=await sbClient.auth.setSession(changed.session);if(refreshed.error)throw refreshed.error;
  const {data,error}=await sbClient.auth.getUser();if(error||data.user?.id!==pendingUser.id)throw Error('다시 로그인하세요.');
  for(const id of ['work-current-password','work-new-password','work-confirm-password','work-change-otp'])$(id).value='';
  pendingUser=null;hide('work-password-dialog');await legacyActivate(data.user);
 }catch(e){message('work-password-message',e.message);}finally{busy=false;$('work-password-save').disabled=false;}
};
$('work-password-skip').onclick=async()=>{if(busy||!pendingUser)return;busy=true;try{const user=pendingUser;hide('work-password-dialog');await legacyActivate(user);deferReminder(user);pendingUser=null;for(const id of ['work-current-password','work-new-password','work-confirm-password','work-change-otp'])$(id).value='';message('work-password-message','');}catch(e){show('work-password-dialog');message('work-password-message',e.message||'로그인 상태를 확인하세요.');}finally{busy=false;}};
window.openWorkPasswordChange=async function(){const {data,error}=await sbClient.auth.getUser();if(error||!data?.user){showToast('다시 로그인하세요.');return;}pendingUser=data.user;message('work-password-message','');show('work-password-dialog');};
const originalSaveMyPassword=window.saveMyPassword;
window.saveMyPassword=async function(){const {data}=await sbClient.auth.getUser();if(data?.user?.app_metadata?.easycall_login_id){hide('my-account-dialog');await window.openWorkPasswordChange();return;}return originalSaveMyPassword();};
const previousLogout=window.handleLogout;
window.handleLogout=async function(...args){pendingUser=null;hide('work-password-dialog');for(const id of ['work-current-password','work-new-password','work-confirm-password','work-change-otp'])$(id).value='';message('work-password-message','');return previousLogout(...args);};
$('work-password-cancel').onclick=()=>window.handleLogout();
modal('work-accounts-dialog','업무용 계정 발급·관리',`
<p class="text-sm text-slate-300">최고관리자는 캠프 관리자와 홍보요원을, 캠프 관리자는 자기 캠프 홍보요원을 발급할 수 있습니다. 기존 이메일 계정은 이 화면에서 변경하지 않습니다.</p>
<label class="block">캠프 ID<input id="work-account-camp" class="${inputClass}"></label>
<label class="block">계정 구분<select id="work-account-role" class="${inputClass}"><option value="agent">홍보요원</option><option value="admin">캠프 관리자</option></select></label>
<label class="block">계정 목록 (사용자ID,요원명,배정전화번호)<textarea id="work-account-rows" rows="5" class="${inputClass}" placeholder="tab001,김홍보,0419301001"></textarea></label>
<p class="text-xs text-slate-300">엑셀의 3개 열을 복사해 붙여넣거나 쉼표로 구분하세요. 최대 2,000명을 25명씩 나눠 처리합니다. 캠프 관리자는 ID와 이름만 입력해도 됩니다. 홍보요원은 등록 단말 수 한도를 적용합니다.</p>
<button id="work-account-create" class="bg-indigo-600 px-4 py-2 rounded-lg">목록 검증 후 계정 발급</button>
<hr class="border-slate-700"><label class="block">초기화·중지할 사용자 ID<input id="work-account-target" class="${inputClass}"></label>
<div class="flex flex-wrap gap-2"><button id="work-account-reset" class="bg-amber-700 px-3 py-2 rounded-lg">임시 비밀번호 재발급</button><button id="work-account-disable" class="bg-rose-700 px-3 py-2 rounded-lg">사용 중지</button><button id="work-account-enable" class="bg-emerald-700 px-3 py-2 rounded-lg">사용 재개</button></div>
<p id="work-account-message" role="status" class="text-sm text-amber-200 whitespace-pre-wrap"></p>
<pre id="work-account-result" class="text-xs whitespace-pre-wrap max-h-48 overflow-auto"></pre>
<button id="work-account-download" class="hidden bg-slate-700 px-4 py-2 rounded-lg">발급 명세 CSV 저장</button>
<p class="text-xs text-slate-400">임시 비밀번호는 이 화면에서만 확인할 수 있습니다. 저장한 명세는 담당자에게만 전달하고 배부 후 삭제하세요.</p>
<button id="work-account-close" class="px-4 py-2 bg-slate-700 rounded-lg">닫기</button>`);
const emailButton=document.createElement('button');emailButton.textContent='기존 이메일 계정 관리';emailButton.className='px-4 py-2 text-sm bg-slate-800 rounded-lg';emailButton.onclick=()=>{if(busy||verifiedIdentity?.role!=='super')return;if(issued.length&&!confirm('발급 명세를 저장하셨습니까?'))return;const camp=$('work-account-camp').value;clearResults();hide('work-accounts-dialog');window.openEmailCampAccount?.(camp);};$('work-account-close').after(emailButton);
window.openWorkAccounts=function(campId){if(!canManage()){showToast('본인 관리자 계정으로 접속하세요.');return;}clearResults();$('work-account-camp').value=typeof campId==='string'?campId:verifiedIdentity.campId||'';$('work-account-camp').disabled=verifiedIdentity.role!=='super';$('work-account-role').value=verifiedIdentity.role==='super'&&typeof campId==='string'?'admin':'agent';$('work-account-role').disabled=verifiedIdentity.role!=='super';emailButton.classList.toggle('hidden',verifiedIdentity.role!=='super');show('work-accounts-dialog');};
for(const view of ['super-view','admin-view']){const host=$(view)?.querySelector('header')||$(view);if(host){const b=document.createElement('button');b.textContent='업무용 계정 발급·관리';b.className='m-2 px-4 py-2 bg-indigo-700 text-white rounded-xl text-sm';b.onclick=window.openWorkAccounts;host.prepend(b);}}
function clearResults(){issued=[];message('work-account-result','');message('work-account-message','');$('work-account-download').classList.add('hidden');}
function showResults(results){issued=results.filter(r=>r.success&&r.password);$('work-account-result').textContent=results.map(r=>r.success?`${r.campId} / ${r.loginId} · 임시 비밀번호: ${r.password}`:`${r.loginId} · 실패: ${r.error}${r.reviewPending?' (관리자 확인 필요)':''}`).join('\n');$('work-account-download').classList.toggle('hidden',!issued.length);}
async function manage(action){if(busy||!canManage())return;if(issued.length&&!confirm('앞선 발급 명세를 저장하셨습니까? 계속하면 현재 표시가 지워집니다.'))return;
 let payload;
 try{const k=accountKey($('work-account-camp').value,$('work-account-target').value||'validation'),role=$('work-account-role').value;
  if(action==='create'){const rows=$('work-account-rows').value.trim().split(/\r?\n/).filter(Boolean).map(line=>{const parts=line.split(/[\t,]/);if(parts.length>3)throw Error('행마다 최대 3개 열을 입력하세요.');return {campId:k.campId,role,loginId:parts[0],alias:parts[1],phone:parts[2]};});payload={action,rows:cleanLargeBatch(rows)};}
  else payload={action,...accountKey(k.campId,$('work-account-target').value),role};
 }catch(e){message('work-account-message',e.message);return;}
 if(!confirm(action==='create'?`${payload.rows.length}개 계정을 ${payload.rows[0].campId} 캠프에 발급합니다. 진행할까요?`:`${payload.campId} / ${payload.loginId} 계정을 ${action==='reset'?'초기화':action==='disable'?'중지':'재개'}합니다. 진행할까요?`))return;
 busy=true;clearResults();message('work-account-message','서버 처리 중입니다. 창을 닫거나 다시 발급하지 마세요.');
 try{let data;
  if(action==='create'){const results=[];for(let i=0;i<payload.rows.length;i+=25){const part=await request({action,rows:payload.rows.slice(i,i+25)});if(!Array.isArray(part.results))throw Error('발급 응답을 확인할 수 없습니다. 이미 발급된 명세를 저장하세요.');results.push(...part.results);showResults(results);message('work-account-message',`${results.length} / ${payload.rows.length}명 처리 중`);if(i+25<payload.rows.length)await new Promise(r=>setTimeout(r,500));}data={results};}
  else data=await request(payload);
  if(data.results)showResults(data.results);else if(data.password)showResults([{...payload,success:true,password:data.password}]);message('work-account-message',data.results?`성공 ${data.results.filter(r=>r.success).length} / 실패 ${data.results.filter(r=>!r.success).length}`:'처리 완료');}
 catch(e){message('work-account-message',e.message);}finally{busy=false;}
}
for(const action of ['create','reset','disable','enable'])$('work-account-'+action).onclick=()=>manage(action);
$('work-account-close').onclick=()=>{if(busy)return;if(issued.length&&!confirm('명세를 저장하거나 배부하셨습니까? 닫으면 임시 비밀번호 표시가 지워집니다.'))return;clearResults();hide('work-accounts-dialog');};
$('work-account-download').onclick=()=>{if(!issued.length)return;const cell=x=>{let value=String(x??'');if(/^[=+@-]/.test(value))value="'"+value;return '"'+value.replace(/"/g,'""')+'"';};const rows=[['캠프ID','사용자ID','계정구분','임시비밀번호'],...issued.map(r=>[r.campId,r.loginId,r.role,r.password])];const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='easycall-account-issuance.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
