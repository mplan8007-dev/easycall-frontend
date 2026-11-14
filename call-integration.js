import './agent-common-password.js';
import './admin-navigation.js';
import './log-export-ui.js';
import './responsive-layout.js';
import './voter-import-ui.js';
import {transport,sipSettings,destination,waitMilliseconds,measuredSeconds,SipPhone} from './call-transport.mjs';
const $=id=>document.getElementById(id),cfg=()=>getCampConfig(getActiveCampId()),actor=()=>verifiedIdentity?[verifiedIdentity.uid,verifiedIdentity.role,verifiedIdentity.campId,verifiedIdentity.agentId].join(':'):'';
const agent=()=>verifiedIdentity?.role==='agent';
let dialing=false,armed=false,autoTimer=null,started=null,ticker=null,callActor='',callId='',lastConfig='',lastActor='',modulePromise=null;
const settings=document.createElement('div');settings.id='phone-admin-settings';settings.innerHTML=`<style>.phone-box,.phone-box *{box-sizing:border-box}.phone-box{border:1px solid #94a3b8;border-radius:12px;padding:12px;margin:12px 0;background:#f8fafc;color:#0f172a}.phone-box label{display:block;font-weight:700;margin:8px 0 4px}.phone-box input,.phone-box select{width:100%;padding:8px;border:1px solid #94a3b8;border-radius:8px;background:white;color:#0f172a}.phone-box button{padding:10px;margin:4px;background:#334155;color:white;border-radius:8px}.phone-box p{font-size:13px;line-height:1.6;margin:8px 0}.phone-hidden{display:none!important}#phone-dialog,#phone-policy-dialog{position:fixed;inset:0;background:#020617cc;z-index:10080;display:flex;align-items:center;justify-content:center;padding:16px}#phone-dialog .phone-box,#phone-policy-dialog>.phone-box{max-width:580px;width:100%;max-height:90vh;overflow:auto}#phone-state{font-weight:700}#phone-status{white-space:pre-wrap}</style>
<section class="phone-box"><h3>통화 회선 선택</h3><label for="phone-transport">사용할 통화 방식</label><select id="phone-transport"><option value="smartphone">일반 스마트폰 · 유심 / 전화 앱</option><option value="sip">SIP 인터넷전화 · 브라우저 통화</option></select><p id="phone-admin-help"></p>
<div id="phone-sip-settings" class="phone-hidden"><label for="phone-wss">SIP 서버 주소 (WSS)</label><input id="phone-wss" placeholder="wss://pbx.example.com/ws" autocomplete="off"><label for="phone-domain">SIP 도메인</label><input id="phone-domain" placeholder="pbx.example.com" autocomplete="off"><label for="phone-stun">STUN 서버 (필요한 경우)</label><input id="phone-stun" placeholder="stun:stun.example.com:3478" autocomplete="off"><p>회선 제공업체의 WebRTC 지원 서버 정보를 입력하세요. 요원별 SIP 비밀번호는 공유 설정에 저장하지 않고 각 기기에서 연결할 때 입력합니다.</p></div></section>`;
const policyDialog=document.createElement('section');policyDialog.id='phone-policy-dialog';policyDialog.className='phone-hidden';policyDialog.setAttribute('role','dialog');policyDialog.setAttribute('aria-modal','true');policyDialog.setAttribute('aria-label','캠프 통화 방식 설정');policyDialog.innerHTML='<div class="phone-box"><h3>캠프 통화 방식 설정 · 최고관리자</h3><p id="phone-policy-camp"></p><div id="phone-policy-fields"></div><p id="phone-policy-message" role="status"></p><button type="button" id="phone-policy-save">통화 방식 저장</button><button type="button" id="phone-policy-reload">다시 불러오기</button><button type="button" id="phone-policy-close">닫기</button></div>';document.body.append(policyDialog);$('phone-policy-fields').append(settings);
const policyButton=document.createElement('button');policyButton.type='button';policyButton.id='phone-policy-open';policyButton.textContent='통화 방식 설정 (스마트폰 / SIP)';policyButton.className='px-3 py-2 rounded-lg bg-indigo-700 text-white font-bold';$('camp-edit-context').after(policyButton);
const campReadOnly=document.createElement('p');campReadOnly.id='phone-admin-readonly';campReadOnly.className='phone-box';$('setting-dial-mode').closest('.grid').before(campReadOnly);
const bar=document.createElement('section');bar.id='phone-agent';bar.className='phone-box';bar.innerHTML=`<h3 id="phone-mode-title">일반 스마트폰 통화</h3><p id="phone-help"></p><p id="phone-state" role="status"></p><p id="phone-status" role="status" aria-live="polite"></p><div id="phone-sip-actions" class="phone-hidden"><button type="button" id="phone-connect">SIP 회선 연결</button><button type="button" id="phone-disconnect">회선 연결 해제</button><button type="button" id="phone-auto">연속 발신 시작</button><button type="button" id="phone-audio-play">통화 음성 재생</button><audio id="phone-audio" autoplay playsinline></audio></div><div id="phone-native-duration"><label for="phone-duration">실제 통화시간 (초 · 선택 입력)</label><input id="phone-duration" type="number" min="0" max="86400" value="0"><p>전화 앱에서 확인한 실제 통화시간을 입력하세요. 입력하지 않으면 0초로 기록합니다.</p></div>`;
$('call-idle-state').parentElement.before(bar);
const dialog=document.createElement('section');dialog.id='phone-dialog';dialog.className='phone-hidden';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','SIP 회선 연결');dialog.innerHTML=`<form id="phone-connect-form" class="phone-box"><h3>SIP 회선 연결</h3><p id="phone-destination"></p><p>이지콜 로그인 계정과 별도로 발급받은 SIP 회선 계정을 입력하세요. 비밀번호는 이 연결에만 사용하며 브라우저 저장소에 저장하지 않습니다.</p><label for="phone-sip-user">SIP 내선 ID</label><input id="phone-sip-user" autocomplete="off" required><label for="phone-sip-password">SIP 회선 비밀번호</label><input id="phone-sip-password" type="password" autocomplete="off" required><details><summary>네트워크 연결 설정 (TURN 필요 시)</summary><label for="phone-turn">TURN 서버 주소</label><input id="phone-turn" placeholder="turns:turn.example.com:5349"><label for="phone-turn-user">TURN 사용자</label><input id="phone-turn-user" autocomplete="off"><label for="phone-turn-password">TURN 비밀번호</label><input id="phone-turn-password" type="password" autocomplete="off"></details><p id="phone-connect-message" role="alert"></p><button type="submit" id="phone-connect-submit">연결하기</button><button type="button" id="phone-connect-close">닫기</button></form>`;document.body.append(dialog);
function message(s){$('phone-status').textContent=s;}
function stopAuto(text=''){armed=false;clearTimeout(autoTimer);autoTimer=null;if(text)message(text);$('phone-auto').textContent='연속 발신 시작';}
function stopClock(){clearInterval(ticker);ticker=null;if(started!==null)currentCallSeconds=measuredSeconds(started,performance.now());started=null;$('call-timer-display').textContent=formatDuration(currentCallSeconds);}
function ended(){stopClock();dialing=false;$('call-active-state').classList.add('hidden');$('call-idle-state').classList.remove('hidden');message('통화가 종료됐습니다. 결과를 선택하고 저장하세요.');sync();}
async function library(){if(window.SIP?.Web?.SimpleUser)return window.SIP.Web.SimpleUser;if(!modulePromise)modulePromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('./vendor/sip-0.21.2.min.js',import.meta.url).href;s.dataset.license=new URL('./vendor/SIP.js-LICENSE.md',import.meta.url).href;s.onload=()=>window.SIP?.Web?.SimpleUser?resolve(window.SIP.Web.SimpleUser):reject(Error('SIP 모듈을 불러오지 못했습니다.'));s.onerror=()=>reject(Error('SIP 모듈을 불러오지 못했습니다.'));document.head.append(s);}).catch(e=>{modulePromise=null;throw e;});return modulePromise;}
const phone=new SipPhone((server,options)=>new window.SIP.Web.SimpleUser(server,options),{
 onState:state=>{$('phone-state').textContent=({offline:'SIP 회선 미연결',connecting:'SIP 회선 연결 중',ready:'SIP 회선 연결 완료',calling:'상대방 응답 대기 중',active:'SIP 통화 중'})[state]||state;if(state==='offline'){stopClock();stopAuto('SIP 연결이 해제됐습니다. 회선을 다시 연결하세요.');}},
 onAnswered:()=>{if(started!==null||!agent()||actor()!==callActor||activeClaim?.callId!==callId)return;started=performance.now();currentCallSeconds=0;$('call-state-label').textContent='SIP 통화 중';ticker=setInterval(()=>{if(started!==null){currentCallSeconds=measuredSeconds(started,performance.now());$('call-timer-display').textContent=formatDuration(currentCallSeconds);}},250);$('phone-audio').play().catch(()=>message('음성을 듣기 위해 통화 음성 재생을 눌러 주세요.'));},
 onEnded:()=>{if(actor()===callActor&&activeClaim?.callId===callId)ended();}
});
function fingerprint(){const c=cfg();return JSON.stringify([transport(c),c.sipWss,c.sipDomain,c.sipStun]);}
function clearCredentials(){$('phone-sip-password').value='';$('phone-turn-password').value='';}
let policyCamp='',policyRevision=null,policyBusy=false,policyTicket=0;
const superUser=()=>verifiedIdentity?.role==='super'&&!sessionStorage.getItem('easycall_master_impersonator');
function renderPolicy(){const sip=$('phone-transport').value==='sip';$('phone-sip-settings').classList.toggle('phone-hidden',!sip);$('phone-admin-help').textContent=sip?'SIP 방식은 별도 WebRTC 회선 계정이 필요합니다. 요원이 회선을 연결한 뒤 통화합니다.':'스마트폰 유심과 기본 전화 앱을 사용합니다. 실제 발신은 매번 요원이 터치합니다.';}
function renderAdmin(){const c=cfg(),sip=transport(c)==='sip',label=sip?(c.sipWss&&c.sipDomain?'SIP 인터넷전화':'SIP 인터넷전화 · 회선 설정 대기'):'일반 스마트폰';$('phone-admin-readonly').textContent='최고관리자가 지정한 통화 방식: '+label+'. 회선 방식 변경은 최고관리자에게 요청하세요.';const badge=$('admin-call-transport-badge');if(badge)badge.textContent='📞 현재 통화 방식: '+label;policyButton.classList.toggle('phone-hidden',!superUser());if(!superUser()){policyTicket++;policyDialog.classList.add('phone-hidden');}}
async function policyLoad(){if(!superUser()||!policyCamp)return;const ticket=++policyTicket,who=actor();policyBusy=true;$('phone-policy-save').disabled=true;$('phone-policy-message').textContent='설정을 불러오는 중입니다.';try{const {data,error}=await sbClient.rpc('easycall_call_transport_get',{p_camp:policyCamp});if(ticket!==policyTicket||actor()!==who)return;if(error||!data?.config)throw Error('통화 설정을 불러오지 못했습니다. 서버 반영 상태를 확인하세요.');policyRevision=data.revision;const c=data.config;$('phone-transport').value=transport(c);$('phone-wss').value=c.sipWss||'';$('phone-domain').value=c.sipDomain||'';$('phone-stun').value=c.sipStun||'';renderPolicy();$('phone-policy-message').textContent='';}catch(e){if(ticket===policyTicket)$('phone-policy-message').textContent=e.message;policyRevision=null;}finally{if(ticket===policyTicket){policyBusy=false;$('phone-policy-save').disabled=!policyRevision;}}}
window.openCampCallTransport=async id=>{if(!superUser())return;policyCamp=id;policyRevision=null;$('phone-policy-camp').textContent=(campsList.find(c=>c.campId===id)?.name||'캠프')+' / '+id;policyDialog.classList.remove('phone-hidden');await policyLoad();};
policyButton.onclick=()=>window.openCampCallTransport($('camp-edit-context').textContent.split(' · ')[0].trim());
$('phone-policy-close').onclick=()=>{if(policyBusy)return;policyTicket++;policyDialog.classList.add('phone-hidden');};
$('phone-policy-reload').onclick=()=>{if(!policyBusy)void policyLoad();};
settings.addEventListener('input',renderPolicy);
$('phone-policy-save').onclick=async()=>{
 if(!superUser()||policyBusy||!policyRevision)return;
 const who=actor(),ticket=policyTicket,cid=policyCamp,next={callTransport:$('phone-transport').value,sipWss:$('phone-wss').value.trim(),sipDomain:$('phone-domain').value.trim(),sipStun:$('phone-stun').value.trim()};
 try{if(next.callTransport==='sip')sipSettings(next);}catch(e){$('phone-policy-message').textContent=e.message;return;}
 policyBusy=true;$('phone-policy-save').disabled=true;$('phone-policy-message').textContent='저장 중입니다.';
 try{const {data,error}=await sbClient.rpc('easycall_call_transport_set',{p_camp:cid,p_config:next,p_expected_revision:policyRevision});if(ticket!==policyTicket||actor()!==who)return;if(error||!data?.config)throw Error('저장 실패: 설정이 변경됐을 수 있습니다. 다시 불러온 뒤 시도하세요.');policyRevision=data.revision;Object.assign(getCampConfig(cid),data.config);$('phone-policy-message').textContent='통화 방식을 저장했습니다. 캠프에 반영됩니다.';sync();}
 catch(e){if(ticket===policyTicket)$('phone-policy-message').textContent=e.message;}
 finally{if(ticket===policyTicket){policyBusy=false;$('phone-policy-save').disabled=false;}}
};
function sync(){
 renderAdmin();const c=cfg(),sip=transport(c)==='sip',a=actor(),f=fingerprint();
 if(lastActor!==a||lastConfig!==f){lastActor=a;lastConfig=f;stopAuto();clearCredentials();dialog.classList.add('phone-hidden');if(phone.user||phone.connecting){stopClock();dialing=false;void phone.disconnect();$('call-active-state').classList.add('hidden');$('call-idle-state').classList.remove('hidden');}}
 if(!agent()||c.globalStopped||isAgentOnBreak||document.hidden||navigator.onLine===false||c.dialMode!=='auto')stopAuto();
 $('phone-mode-title').textContent=sip?'SIP 인터넷전화':'일반 스마트폰 통화';
 $('phone-help').textContent=sip?'회선을 연결한 뒤 발신하세요. 통화 종료를 감지하며, 결과를 저장해야 다음 대상으로 진행합니다.':'발신 버튼을 누르면 스마트폰 전화 앱이 열립니다. 통화 후 이지콜로 돌아와 결과를 입력하세요. 자동 발신·종료 감지는 지원하지 않습니다.';
 $('phone-sip-actions').classList.toggle('phone-hidden',!sip);$('phone-native-duration').classList.toggle('phone-hidden',sip);$('btn-native-tel').classList.toggle('hidden',sip);
 if(!sip)$('phone-state').textContent='스마트폰 유심 / 기본 전화 앱 사용';
 $('btn-dial-action').textContent=!activeClaim?'통화 대상 준비':sip?'SIP 회선으로 발신':'스마트폰 전화 앱으로 발신';
 $('phone-auto').classList.toggle('phone-hidden',!sip||c.dialMode!=='auto');
 $('btn-dial-action').disabled=!permitted()||phone.active||dialing;
 $('btn-save-next').disabled=!activeClaim||isSavingResult||recoveryBlocked||phone.active||dialing;
 const step=$('agent-workflow-state');if(step)step.textContent=recoveryBlocked?'업무 상태 확인이 필요합니다. 임시 입력은 유지됩니다.':isSavingResult?'결과 저장 중입니다.':phone.active?'통화 중 · 통화를 종료한 뒤 결과를 저장하세요.':!activeClaim?'1. 통화 대상 준비를 눌러 시작하세요.':activeClaim.started?'3. 통화 결과를 선택하고 저장하세요.':'2. 대상을 확인하고 전화하기를 누르세요.';
 $('btn-save-next').textContent=isSavingResult?'결과 저장 중…':sip&&armed&&c.dialMode==='auto'?'결과 저장 · 다음 번호 자동 발신':'결과 저장 · 다음 대상 준비';
}
$('phone-connect').onclick=()=>{if(!agent())return;try{const s=sipSettings(cfg());$('phone-destination').textContent='연결 서버: '+s.wss+' / 도메인: '+s.domain;$('phone-connect-message').textContent='';dialog.classList.remove('phone-hidden');$('phone-sip-user').focus();}catch(e){message(e.message+' 캠프 관리자에게 문의하세요.');}};
$('phone-connect-close').onclick=()=>{clearCredentials();dialog.classList.add('phone-hidden');};
dialog.addEventListener('keydown',e=>{if(e.key==='Escape')$('phone-connect-close').click();});
$('phone-connect-form').onsubmit=async e=>{
 e.preventDefault();if(!agent()||transport(cfg())!=='sip'||phone.connecting)return;
 const who=actor(),f=fingerprint(),config={...cfg()},credentials={username:$('phone-sip-user').value,password:$('phone-sip-password').value,audio:$('phone-audio'),turnUrl:$('phone-turn').value.trim(),turnUser:$('phone-turn-user').value,turnPassword:$('phone-turn-password').value};
 clearCredentials();$('phone-connect-submit').disabled=true;$('phone-connect-message').textContent='회선을 연결하고 있습니다.';
 try{if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw Error('HTTPS 접속과 WebRTC·마이크를 지원하는 브라우저가 필요합니다.');await library();if(actor()!==who||fingerprint()!==f)throw Error('로그인 또는 회선 설정이 변경됐습니다.');await phone.connect(config,credentials);if(actor()!==who||fingerprint()!==f){await phone.disconnect();return;}dialog.classList.add('phone-hidden');message('SIP 연결 완료. 발신 버튼 또는 연속 발신 시작을 누르세요.');}
 catch(err){$('phone-connect-message').textContent=err.message;}finally{credentials.password='';credentials.turnPassword='';$('phone-connect-submit').disabled=false;}
};
$('phone-disconnect').onclick=async()=>{if(phone.active&&phone.ready){message('먼저 통화를 종료한 뒤 회선 연결을 해제하세요.');return;}const interrupted=phone.active;stopAuto();await phone.disconnect();if(interrupted){ended();message('끊어진 회선을 정리했습니다. 실제 통화 상태를 확인하고 결과를 저장하세요.');}};
$('phone-audio-play').onclick=()=>$('phone-audio').play().catch(()=>message('음성 재생에 실패했습니다. 기기의 소리 설정을 확인하세요.'));
function permitted(){return agent()&&!recoveryBlocked&&!isAgentOnBreak&&!isSavingResult&&!checkAgentGlobalStopBanner()&&navigator.onLine!==false;}
window.easycallPlaceCall=async function(launch=true){
 if(!launch||dialing||phone.active)return;if(!permitted()){stopAuto('현재 발신할 수 없습니다. 업무 상태와 네트워크를 확인하세요.');return;}
 const c=cfg(),sip=transport(c)==='sip',who=actor(),claim=activeClaim,signature=fingerprint();
 if(!claim){await loadCurrentVoterToDialer(true);sync();message(activeClaim?'대상을 확인하고 발신 버튼을 눌러 주세요.':'배정 가능한 대상이 없습니다. 명부와 업무 상태를 확인하세요.');return;}
 if(sip&&!phone.ready){stopAuto('먼저 SIP 회선을 연결하세요.');return;}
 let uri;try{uri=destination(claim.voter.phone,sip?sipSettings(c).domain:undefined);}catch(e){stopAuto(e.message);return;}
 dialing=true;callActor=who;callId=claim.callId;
 try{
  const {error}=await sbClient.rpc('easycall_authorize_call',{p_camp_id:getActiveCampId(),p_voter_id:claim.voterId});
  if(error)throw Error('발신 권한 또는 배정이 만료됐습니다.');
  if(actor()!==who||activeClaim!==claim||fingerprint()!==signature||!permitted())throw Error('발신 조건이 변경됐습니다. 다시 확인하세요.');
  claim.started=true;persistAgentDraft();
  currentCallSeconds=0;$('phone-duration').value='0';stopClock();started=null;
  if(sip){await phone.call(uri);if(!phone.active){dialing=false;return;}$('call-state-label').textContent=started!==null?'SIP 통화 중':'상대방 응답 대기 중';}
  else{window.location.href=uri;$('call-state-label').textContent='전화 앱 통화 후 결과를 입력하세요.';$('call-timer-display').textContent='시간 수동 입력';}
  $('call-idle-state').classList.add('hidden');$('call-active-state').classList.remove('hidden');
  message(sip?'SIP 발신 요청을 보냈습니다.':'전화 앱에서 통화한 뒤 돌아와 통화 완료를 눌러 주세요.');
 }catch(e){stopAuto(e.message);}finally{dialing=false;sync();}
};
window.endCallSimulation=async function(){if(transport(cfg())==='sip'){if(phone.active){try{await phone.hangup();}catch{message('통화 종료 요청에 실패했습니다. 회선 상태를 확인하세요.');}}}else{ended();message('전화 앱에서 실제 통화를 종료했는지 확인한 뒤 결과를 저장하세요.');}};
const oldSave=window.saveResultToStorage;window.saveResultToStorage=async function(...args){
 if(phone.active||dialing){message('통화를 종료한 뒤 결과를 저장하세요.');return;}
 if(transport(cfg())==='smartphone')currentCallSeconds=Math.min(86400,Math.max(0,Math.floor(Number($('phone-duration').value)||0)));
 const old=activeClaim,who=actor();await oldSave(...args);sync();
 if(old&&actor()===who&&activeClaim!==old){$('phone-duration').value='0';started=null;if(armed&&activeClaim&&cfg().dialMode==='auto'&&transport(cfg())==='sip'&&phone.ready){clearTimeout(autoTimer);const target=activeClaim,signature=fingerprint();message('결과 저장 완료. 다음 번호 발신을 대기합니다.');autoTimer=setTimeout(()=>{autoTimer=null;if(armed&&actor()===who&&activeClaim===target&&fingerprint()===signature&&!document.hidden)void window.easycallPlaceCall(true);else stopAuto();},waitMilliseconds(cfg().waitSecs));}}
};
$('phone-auto').onclick=()=>{if(armed){stopAuto('연속 발신을 중지했습니다.');return;}if(!permitted()||transport(cfg())!=='sip'||cfg().dialMode!=='auto'||!phone.ready){message('SIP 회선 연결과 업무 상태를 먼저 확인하세요.');return;}armed=true;$('phone-auto').textContent='연속 발신 중지';void window.easycallPlaceCall(true);};
const oldRefresh=window.refreshActiveRoleUI;window.refreshActiveRoleUI=function(...args){const result=oldRefresh(...args);sync();return result;};
const oldLogout=window.handleLogout;window.handleLogout=async function(...args){if(!await prepareAgentLogout())return;stopAuto();stopClock();clearCredentials();policyTicket++;policyDialog.classList.add('phone-hidden');dialog.classList.add('phone-hidden');await phone.disconnect();dialing=false;if(agent()&&activeClaim&&sbClient){try{await sbClient.rpc('easycall_release_unstarted_claim',{p_camp_id:getActiveCampId(),p_voter_id:activeClaim.voterId});}catch{}}return oldLogout(...args);};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAuto('다른 화면으로 이동해 연속 발신을 중지했습니다.');});
window.addEventListener('offline',()=>stopAuto('네트워크 연결이 끊겨 연속 발신을 중지했습니다.'));
window.addEventListener('pagehide',()=>{stopAuto();clearCredentials();stopClock();void phone.disconnect();});
sync();
