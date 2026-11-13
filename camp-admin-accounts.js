import './work-accounts.js';
const $=id=>document.getElementById(id),esc=s=>escapeHTML(String(s??''));
const cls='w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-white';
const button='rounded-xl px-4 py-2 bg-slate-700 text-white';
const box=document.createElement('section');
box.id='camp-admin-accounts';box.className='hidden fixed inset-0 z-[10050] bg-slate-950/90 flex items-center justify-center p-4';
box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','ca-title');
box.innerHTML=`<div class="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-2xl bg-slate-900 text-white p-6 space-y-4">
<div class="flex justify-between gap-4"><div><h2 id="ca-title" class="text-xl font-bold">캠프 관리자 계정 관리</h2><p id="ca-context" class="text-slate-300 mt-1"></p></div><button id="ca-close" class="${button}">닫기</button></div>
<div id="ca-picker"><label for="ca-camp">관리할 캠프</label><select id="ca-camp" class="${cls}"></select></div>
<p id="ca-message" role="status" aria-live="polite" class="text-amber-200 whitespace-pre-wrap"></p>
<div id="ca-list-panel"><div class="flex flex-wrap justify-between gap-2"><p>관리자를 선택해 로그인 안내, 비밀번호, 접속 상태를 관리하세요.</p><button id="ca-add" class="rounded-xl px-4 py-2 bg-indigo-600">+ 관리자 추가</button></div>
<div class="overflow-x-auto mt-4"><table class="w-full text-sm text-left"><thead><tr class="border-b border-slate-700"><th class="p-3">로그인 ID / 이름</th><th class="p-3">계정 상태</th><th class="p-3">관리</th></tr></thead><tbody id="ca-rows"></tbody></table></div>
<button id="ca-refresh" class="${button} mt-3">목록 새로고침</button><button id="ca-email" class="${button} mt-3">기존 이메일 계정 관리</button></div>
<form id="ca-add-panel" class="hidden space-y-3"><h3 class="font-bold text-lg">관리자 추가</h3><p class="text-slate-300">선택한 캠프의 관리자 계정을 만듭니다. 이메일은 필요 없습니다.</p>
<label class="block" for="ca-name">관리자 이름</label><input id="ca-name" maxlength="80" required class="${cls}" placeholder="예: 김관리"><p id="ca-name-error" class="text-rose-300" role="alert"></p>
<label class="block" for="ca-login">사용할 로그인 ID</label><input id="ca-login" maxlength="32" required autocomplete="off" class="${cls}" placeholder="예: manager01"><p class="text-xs text-slate-300">영문, 숫자, 밑줄, 하이픈만 사용합니다. 캠프 ID와는 다릅니다.</p><p id="ca-login-error" class="text-rose-300" role="alert"></p>
<button id="ca-create" type="submit" class="rounded-xl px-4 py-2 bg-indigo-600">계정 만들기</button><button type="button" id="ca-cancel-add" class="${button}">목록으로</button></form>
<div id="ca-confirm-panel" class="hidden space-y-4"><h3 id="ca-confirm-title" class="font-bold text-lg"></h3><p id="ca-confirm-text" class="whitespace-pre-wrap"></p><button id="ca-confirm" class="rounded-xl px-4 py-2 bg-indigo-600">확인</button><button id="ca-cancel-action" class="${button}">취소</button></div>
<div id="ca-result-panel" class="hidden space-y-3"><h3 id="ca-result-title" class="font-bold text-lg">로그인 안내</h3><p class="text-slate-300">아래 내용을 해당 관리자에게 개인 메시지로 전달하세요.</p><textarea id="ca-delivery" readonly rows="8" class="${cls}" aria-label="관리자에게 전달할 로그인 안내"></textarea><p id="ca-secret-note" class="text-amber-200">임시 비밀번호는 이 화면을 닫으면 다시 조회할 수 없습니다. 비밀번호 변경은 선택사항입니다.</p><button id="ca-copy" class="rounded-xl px-4 py-2 bg-indigo-600">전달 안내 복사</button><button id="ca-result-back" class="${button}">목록으로</button></div>
</div>`;document.body.append(box);
let campId='',rows=[],busy=false,secret=false,selected=null,version=0,returnFocus=null;
const allowed=()=>verifiedIdentity?.role==='super'&&!sessionStorage.getItem('easycall_master_impersonator');
function say(s){$('ca-message').textContent=s;}
function panel(name){for(const n of ['list','add','confirm','result'])$('ca-'+n+'-panel').classList.toggle('hidden',n!==name);}
function wipe(){secret=false;$('ca-delivery').value='';}
function leaveSecret(){return !secret||confirm('임시 비밀번호가 포함된 안내를 저장하거나 전달하셨습니까? 목록으로 돌아가면 비밀번호 표시가 사라집니다.');}
function lock(value){busy=value;for(const el of box.querySelectorAll('button,input,select'))el.disabled=value;}
async function invoke(body){const {data,error}=await sbClient.functions.invoke('easycall-work-accounts',{body});if(error)throw Error('서버 응답을 확인하지 못했습니다. 목록을 새로고침해 발급 여부를 확인하세요.');if(data?.error)throw Error(data.error);return data;}
function draw(){
 $('ca-rows').innerHTML=rows.map((r,i)=>{const work=!!r.loginId,status=r.status==='disabled'?'사용 중지':r.status==='pending'?'발급 확인 필요':'사용 중';
 const act=(a,label)=>`<button type="button" data-ca-action="${a}" data-ca-index="${i}" class="rounded-lg px-3 py-2 bg-slate-700 m-1">${label}</button>`;
 return `<tr class="border-b border-slate-800"><td class="p-3 break-all"><strong>${esc(r.loginId||r.email)}</strong><div class="text-slate-400 mt-1">${esc(r.name)}</div></td><td class="p-3"><span class="${r.status==='disabled'?'text-rose-300':'text-emerald-300'}">${status}</span>${r.mustChange?'<div class="text-xs text-amber-200 mt-1">임시 비밀번호 사용 중</div>':''}${!work?'<div class="text-xs text-slate-400">이메일 계정</div>':''}</td><td class="p-2">${act('guide','로그인 안내')}${work?act('reset','비밀번호 재발급')+(r.status==='pending'?'':act(r.status==='disabled'?'enable':'disable',r.status==='disabled'?'사용 재개':'사용 중지')):act('email','이메일 계정 관리')}</td></tr>`;}).join('')||'<tr><td colspan="3" class="p-6 text-center text-slate-300">등록된 관리자가 없습니다. 위의 “관리자 추가”를 눌러 첫 계정을 만드세요.</td></tr>';
}
async function refresh(){const ticket=++version,cid=campId;lock(true);say('관리자 목록을 불러오는 중입니다.');try{const {data,error}=await sbClient.rpc('easycall_admin_accounts',{p_camp:cid});if(error)throw Error('관리자 목록을 불러오지 못했습니다. 목록 새로고침으로 다시 시도하세요.');if(ticket!==version||!allowed())return;rows=data||[];draw();say('');}catch(e){if(ticket===version){rows=[];$('ca-rows').innerHTML='';say(e.message);}}finally{if(ticket===version)lock(false);}}
function context(){const c=campsList.find(c=>c.campId===campId);$('ca-context').textContent=(c?.name||campId)+' · 캠프 ID: '+campId;}
window.openCampAdminAccounts=async function(id){
 if(!allowed()){showToast('최고관리자로 로그인해 주세요.');return;}if(busy||!leaveSecret())return;
 returnFocus=document.activeElement;wipe();selected=null;campId=typeof id==='string'?id:(campsList[0]?.campId||'');
 $('ca-camp').innerHTML=campsList.map(c=>`<option value="${esc(c.campId)}">${esc(c.name)} (${esc(c.campId)})</option>`).join('');$('ca-camp').value=campId;
 $('ca-picker').classList.toggle('hidden',typeof id==='string');context();panel('list');box.classList.remove('hidden');
 if(!campId){say('먼저 캠프를 등록해 주세요.');$('ca-add').disabled=true;return;}await refresh();$('ca-close').focus();
};
$('ca-camp').onchange=async()=>{if(busy||!leaveSecret()){$('ca-camp').value=campId;return;}wipe();campId=$('ca-camp').value;context();panel('list');await refresh();};
function close(){if(busy||!leaveSecret())return;wipe();version++;rows=[];selected=null;box.classList.add('hidden');returnFocus?.focus?.();}
$('ca-close').onclick=close;
$('ca-refresh').onclick=refresh;
$('ca-add').onclick=()=>{wipe();say('');$('ca-name').value='';$('ca-login').value='';$('ca-name-error').textContent='';$('ca-login-error').textContent='';panel('add');$('ca-name').focus();};
$('ca-cancel-add').onclick=()=>{panel('list');say('');};
function email(){if(busy||!leaveSecret())return;wipe();box.classList.add('hidden');window.openEmailCampAccount(campId);}
$('ca-email').onclick=email;
function delivery(row,password){wipe();secret=!!password;$('ca-result-title').textContent=password?'계정 발급 완료 · 로그인 안내':'로그인 안내';$('ca-delivery').value=['이지콜 관리자 계정 안내','접속 주소: '+location.origin+location.pathname,'캠프 ID: '+campId,'로그인 ID: '+(row.loginId||row.email),...(password?['임시 비밀번호: '+password,'비밀번호는 로그인 후 원할 때 변경할 수 있습니다.']:['비밀번호는 기존에 전달받은 값을 사용하세요.','비밀번호를 모르면 관리자에게 재발급을 요청하세요.'])].join('\n');$('ca-secret-note').classList.toggle('hidden',!password);panel('result');say('');}
$('ca-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('ca-delivery').value);say('로그인 안내를 복사했습니다. 해당 관리자에게 개인 메시지로 전달하세요.');}catch{say('자동 복사를 사용할 수 없습니다. 아래 안내를 선택해 직접 복사하세요.');$('ca-delivery').focus();$('ca-delivery').select();}};
$('ca-result-back').onclick=async()=>{if(busy||!leaveSecret())return;wipe();panel('list');await refresh();};
$('ca-rows').onclick=e=>{const b=e.target.closest('[data-ca-action]');if(!b||busy)return;const r=rows[Number(b.dataset.caIndex)];if(!r)return;const action=b.dataset.caAction;
 if(action==='guide'){delivery(r);return;}if(action==='email'){email();return;}selected={action,row:r};panel('confirm');say('');
 const title=action==='reset'?'임시 비밀번호 재발급':action==='disable'?'관리자 사용 중지':'관리자 사용 재개';
 $('ca-confirm-title').textContent=title;$('ca-confirm-text').textContent='대상: '+r.name+' / 로그인 ID: '+r.loginId+'\n캠프 ID: '+campId+'\n\n'+(action==='reset'?'기존 비밀번호는 사용할 수 없게 됩니다. 새 6자리 임시 비밀번호를 해당 관리자에게 전달해야 합니다.':action==='disable'?'이 관리자의 캠프 업무 접근을 차단합니다. 다시 사용하려면 “사용 재개”를 누르세요.':'이 관리자의 캠프 업무 접근을 다시 허용합니다.');$('ca-confirm').textContent=title;
};
$('ca-cancel-action').onclick=()=>{selected=null;panel('list');say('');};
$('ca-confirm').onclick=async()=>{if(busy||!selected||!allowed())return;const target=selected;lock(true);say('처리 중입니다. 잠시 기다려 주세요.');try{const data=await invoke({action:target.action,campId,loginId:target.row.loginId,role:'admin'});if(!allowed()||box.classList.contains('hidden'))return;if(target.action==='reset'){if(!data.password)throw Error('비밀번호 응답이 없습니다. 관리자 목록을 확인하세요.');delivery(target.row,data.password);}else{panel('list');await refresh();say(target.action==='disable'?'사용을 중지했습니다.':'사용을 재개했습니다.');}}catch(e){panel('list');say(e.message);}finally{selected=null;lock(false);}};
$('ca-add-panel').onsubmit=async e=>{e.preventDefault();if(busy||!allowed())return;const name=$('ca-name').value.trim(),login=$('ca-login').value.trim().toLowerCase();$('ca-name-error').textContent=name?'':'관리자 이름을 입력하세요.';$('ca-login-error').textContent=/^[a-z0-9_-]{1,32}$/.test(login)?'':'로그인 ID는 영문·숫자·밑줄·하이픈 1~32자로 입력하세요.';if(!name||!/^[a-z0-9_-]{1,32}$/.test(login))return;if(rows.some(r=>r.loginId===login)){$('ca-login-error').textContent='이미 발급된 ID입니다. 목록에서 비밀번호 재발급을 선택하세요.';return;}
 lock(true);say('계정을 발급하는 중입니다. 중복으로 누르지 마세요.');
 try{const data=await invoke({action:'create',rows:[{campId,role:'admin',loginId:login,alias:name,phone:''}]});if(!allowed()||box.classList.contains('hidden'))return;const r=data.results?.[0];if(!r?.success||!r.password)throw Error(r?.error||'발급 응답을 확인할 수 없습니다. 목록 새로고침으로 확인하세요.');delivery({loginId:login,name},r.password);}catch(e){say(e.message);}finally{lock(false);}
};
const bulk=window.openWorkAccounts;
window.openWorkAccounts=function(id){if(verifiedIdentity?.role==='super')return window.openCampAdminAccounts(id);return bulk(id);};
for(const b of document.querySelectorAll('#super-view button'))if(b.textContent==='업무용 계정 발급·관리'){b.textContent='캠프 관리자 계정 관리';b.onclick=()=>window.openCampAdminAccounts();}
const superHeader=$('super-view')?.querySelector('header')||$('super-view');
if(superHeader){const b=document.createElement('button');b.textContent='전화담당자 대량 발급';b.className='m-2 px-4 py-2 rounded-xl bg-slate-700 text-white text-sm';b.onclick=()=>bulk();superHeader.append(b);}
const logout=window.handleLogout;window.handleLogout=async function(...args){wipe();version++;box.classList.add('hidden');rows=[];selected=null;return logout(...args);};
box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const controls=Array.from(box.querySelectorAll('button,input,select,textarea')).filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
