import './agent-accounts.js';
import {temporaryPassword} from './supabase/functions/_shared/work-account.mjs';
const $=id=>document.getElementById(id),host=$('agent-accounts');let state=null,camp='',busy=false,token=0;
const card=document.createElement('section');card.id='gc-card';card.className='ga-note';card.innerHTML=`<div class="ga-flex"><div><h3>홍보요원 공통 비밀번호</h3><p id="gc-status" role="status">설정을 확인하는 중입니다.</p></div><div><button id="gc-open">공통 비밀번호 설정 · 전체 적용</button><button id="gc-reveal">공통 비밀번호 확인</button><button id="gc-refresh">상태 새로고침</button></div></div>
<div id="gc-settings" class="ga-hidden"><p>기존 홍보요원과 앞으로 발급할 요원에게 같은 비밀번호를 사용합니다. 캠프 관리자·최고관리자의 비밀번호는 바뀌지 않습니다. 사용 중지된 요원은 중지 상태를 유지합니다.</p><label for="gc-password">설정할 공통 비밀번호 (숫자 6자리)</label><input id="gc-password" type="password" maxlength="6" inputmode="numeric" autocomplete="new-password"><button id="gc-generate">숫자 6자리 자동 생성</button><label><input id="gc-show" type="checkbox" style="width:auto"> 입력한 비밀번호 표시</label><button id="gc-apply" class="ga-primary">이 비밀번호로 기존·신규 요원 모두 통일</button><button id="gc-cancel">취소</button></div>
<div id="gc-secret-panel" class="ga-hidden"><label for="gc-secret">현재 캠프 공통 비밀번호</label><input id="gc-secret" readonly type="text" autocomplete="off"><button id="gc-copy">공통 비밀번호 복사</button><button id="gc-hide">숨기기</button></div>
<button id="gc-resume" class="ga-hidden ga-primary">남은 계정 적용 계속하기</button><button id="gc-retry" class="ga-hidden">실패 계정 다시 적용</button><p id="gc-message" class="ga-warning" role="status" aria-live="polite"></p>`;
$('ga-capacity').after(card);
function hideSecret(){$('gc-secret').value='';$('gc-secret-panel').classList.add('ga-hidden');}
function clear(){token++;state=null;camp='';busy=false;hideSecret();$('gc-password').value='';$('gc-password').type='password';$('gc-show').checked=false;$('gc-settings').classList.add('ga-hidden');$('gc-message').textContent='';}
const msg=s=>{$('gc-message').textContent=s;};
async function api(action,extra={}){const {data,error}=await sbClient.functions.invoke('easycall-work-accounts',{body:{action,campId:camp,...extra}});if(error)throw Error('서버 응답을 확인하지 못했습니다. 상태 새로고침으로 적용 결과를 확인하세요.');if(data?.error)throw Error(data.error);return data;}
function render(){
 $('gc-status').textContent=!state?'설정을 불러오지 못했습니다. 상태 새로고침을 누르세요.':!state.configured?'아직 미설정 · 계정 발급 전 공통 비밀번호를 설정해 주세요.':state.ready?'공통 비밀번호 사용 중 · 기존·신규 홍보요원 모두 같은 비밀번호를 사용합니다.':'전체 '+state.total+'명 중 '+state.done+'명 완료 · 남음 '+state.pending+'명 · 처리 중 '+state.processing+'명 · 실패 '+state.failed+'명';
 $('gc-open').disabled=busy||!!(state?.configured&&!state.ready);$('gc-reveal').disabled=busy||!state?.ready;
 $('gc-resume').classList.toggle('ga-hidden',!state?.configured||state.ready);$('gc-retry').classList.toggle('ga-hidden',!state?.failed);$('gc-resume').disabled=busy;$('gc-retry').disabled=busy;
}
async function refresh(){const ticket=token,cid=camp;if(!cid)return;try{const data=await api('agent-common-status');if(ticket!==token||camp!==cid)return;state=data.state;render();}catch(e){state=null;render();msg(e.message);}}
async function run(retry=false){if(busy||!state?.configured)return;const ticket=token;busy=true;window.easycallAgentCommonBusy(true);hideSecret();msg('공통 비밀번호를 적용하는 중입니다. 창을 닫지 마세요.');try{
 if(retry){const r=await api('agent-common-retry',{version:state.version});state=r.state;}
 let limit=Math.ceil(Number(state.total||0)/25)+2;
 while(ticket===token&&!state.ready&&limit-->0){const data=await api('agent-common-apply',{version:state.version});if(ticket!==token)return;state=data.state;render();if(data.busy){msg('처리 중인 작업이 있습니다. 잠시 후 상태 새로고침으로 확인하세요.');return;}if(!state.pending)break;}
 if(ticket===token)msg(state.ready?'전체 적용을 완료했습니다. 신규 발급도 이 공통 비밀번호를 사용합니다.':state.failed?'일부 계정 적용에 실패했습니다. 실패 계정 다시 적용을 눌러 주세요.':'남은 계정 적용을 계속하거나 잠시 후 상태를 확인하세요.');
 }catch(e){if(ticket===token)msg(e.message);}finally{if(ticket===token){busy=false;window.easycallAgentCommonBusy(false);render();}}
}
const originalOpen=window.openAgentAccounts;
window.openAgentAccounts=async function(...args){if(busy)return;await originalOpen(...args);if(host.classList.contains('ga-hidden'))return;clear();camp=window.easycallAgentAccountContext().campId;await refresh();};
window.easycallCommonAgentPassword=async function(cid){if(cid!==camp)throw Error('캠프를 다시 선택하세요.');const ticket=token;const status=await api('agent-common-status');if(ticket!==token||cid!==camp)throw Error('캠프를 다시 선택하세요.');state=status.state;render();if(!state?.ready)throw Error('공통 비밀번호 전체 적용을 먼저 완료하세요.');const result=await api('agent-common-read',{version:state.version});if(ticket!==token||cid!==camp)throw Error('캠프를 다시 선택하세요.');return result.password;};
$('gc-open').onclick=()=>{if(busy)return;hideSecret();$('gc-settings').classList.remove('ga-hidden');$('gc-password').focus();};
$('gc-generate').onclick=()=>{if(busy)return;$('gc-password').value=temporaryPassword();msg('숫자 6자리를 생성했습니다. 필요하면 “입력한 비밀번호 표시”로 확인하세요.');};
$('gc-show').onchange=()=>{$('gc-password').type=$('gc-show').checked?'text':'password';};
$('gc-cancel').onclick=()=>{$('gc-password').value='';$('gc-settings').classList.add('ga-hidden');msg('');};
$('gc-apply').onclick=async()=>{if(busy)return;const password=$('gc-password').value;if(!/^\d{6}$/.test(password)){msg('공통 비밀번호는 숫자 6자리로 입력하세요.');return;}
 if(!confirm('이 캠프의 기존 홍보요원 전체와 신규 계정을 공통 비밀번호로 통일합니다. 기존 요원은 다시 로그인해야 하며, 관리자 비밀번호와 사용 중지 상태는 유지됩니다. 적용할까요?'))return;
 const ticket=token;busy=true;window.easycallAgentCommonBusy(true);msg('공통 비밀번호 설정을 저장하는 중입니다.');
 try{const result=await api('agent-common-set',{password,expectedVersion:state?.version||null});if(ticket!==token)return;state=result.state;$('gc-password').value='';$('gc-settings').classList.add('ga-hidden');busy=false;window.easycallAgentCommonBusy(false);await run();}
 catch(e){if(ticket===token)msg(e.message);}finally{if(ticket===token){busy=false;window.easycallAgentCommonBusy(false);render();}}
};
$('gc-refresh').onclick=async()=>{if(busy)return;hideSecret();msg('');await refresh();};
$('gc-resume').onclick=()=>run();$('gc-retry').onclick=()=>run(true);
$('gc-reveal').onclick=async()=>{if(busy)return;try{$('gc-secret').value=await window.easycallCommonAgentPassword(camp);$('gc-secret-panel').classList.remove('ga-hidden');}catch(e){msg(e.message);}};
$('gc-hide').onclick=hideSecret;
$('gc-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('gc-secret').value);msg('공통 비밀번호를 복사했습니다. 해당 캠프 요원에게만 전달하세요.');}catch{$('gc-secret').focus();$('gc-secret').select();msg('비밀번호를 선택했습니다. 직접 복사해 주세요.');}};
host.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||card.contains(b))return;if(['ga-bulk','ga-issue'].includes(b.id)||['issue','reset'].includes(b.dataset.gaAction)){if(!state?.ready){e.preventDefault();e.stopImmediatePropagation();msg('먼저 공통 비밀번호 설정과 기존 계정 전체 적용을 완료하세요.');card.scrollIntoView({block:'nearest'});}}},true);
const oldLogout=window.handleLogout;window.handleLogout=async function(...args){clear();return oldLogout(...args);};
new MutationObserver(()=>{if(host.classList.contains('ga-hidden'))clear();}).observe(host,{attributes:true,attributeFilter:['class']});
