import './agent-common-password.js';
import {transport,sipSettings,destination,waitMilliseconds,measuredSeconds,SipPhone} from './call-transport.mjs';
const $=id=>document.getElementById(id),cfg=()=>getCampConfig(getActiveCampId()),actor=()=>verifiedIdentity?[verifiedIdentity.uid,verifiedIdentity.role,verifiedIdentity.campId,verifiedIdentity.agentId].join(':'):'';
const agent=()=>verifiedIdentity?.role==='agent';
let dialing=false,armed=false,autoTimer=null,started=null,ticker=null,callActor='',callId='',lastConfig='',lastActor='',settingsCamp='',dirty=false,settingsVersion='',modulePromise=null;
const settings=document.createElement('div');settings.id='phone-admin-settings';settings.innerHTML=`<style>.phone-box,.phone-box *{box-sizing:border-box}.phone-box{border:1px solid #94a3b8;border-radius:12px;padding:12px;margin:12px 0;background:#f8fafc;color:#0f172a}.phone-box label{display:block;font-weight:700;margin:8px 0 4px}.phone-box input,.phone-box select{width:100%;padding:8px;border:1px solid #94a3b8;border-radius:8px;background:white;color:#0f172a}.phone-box button{padding:10px;margin:4px;background:#334155;color:white;border-radius:8px}.phone-box p{font-size:13px;line-height:1.6;margin:8px 0}.phone-hidden{display:none!important}#phone-dialog{position:fixed;inset:0;background:#020617cc;z-index:10080;display:flex;align-items:center;justify-content:center;padding:16px}#phone-dialog .phone-box{max-width:580px;width:100%;max-height:90vh;overflow:auto}#phone-state{font-weight:700}#phone-status{white-space:pre-wrap}</style>
<section class="phone-box"><h3>통화 회선 선택</h3><label for="phone-transport">사용할 통화 방식</label><select id="phone-transport"><option value="smartphone">일반 스마트폰 · 유심 / 전화 앱</option><option value="sip">SIP 인터넷전화 · 브라우저 통화</option></select><p id="phone-admin-help"></p>
<div id="phone-sip-settings" class="phone-hidden"><label for="phone-wss">SIP 서버 주소 (WSS)</label><input id="phone-wss" placeholder="wss://pbx.example.com/ws" autocomplete="off"><label for="phone-domain">SIP 도메인</label><input id="phone-domain" placeholder="pbx.example.com" autocomplete="off"><label for="phone-stun">STUN 서버 (필요한 경우)</label><input id="phone-stun" placeholder="stun:stun.example.com:3478" autocomplete="off"><p>회선 제공업체의 WebRTC 지원 서버 정보를 입력하세요. 요원별 SIP 비밀번호는 공유 설정에 저장하지 않고 각 기기에서 연결할 때 입력합니다.</p></div></section>`;
$('setting-dial-mode').closest('.grid').before(settings);
const bar=document.createElement('section');bar.id='phone-agent';bar.className='phone-box';bar.innerHTML=`<h3 id="phone-mode-title">일반 스마트폰 통화</h3><p id="phone-help"></p><p id="phone-state" role="status"></p><p id="phone-status" role="status" aria-live="polite"></p><div id="phone-sip-actions" class="phone-hidden"><button type="button" id="phone-connect">SIP 회선 연결</button><button type="button" id="phone-disconnect">회선 연결 해제</button><button type="button" id="phone-auto">연속 발신 시작</button><button type="button" id="phone-audio-play">통화 음성 재생</button><audio id="phone-audio" autoplay playsinline></audio></div><div id="phone-native-duration"><label for="phone-duration">실제 통화시간 (초 · 선택 입력)</label><input id="phone-duration" type="number" min="0" max="86400" value="0"><p>전화 앱에서 확인한 실제 통화시간을 입력하세요. 입력하지 않으면 0초로 기록합니다.</p></div>`;
$('call-idle-state').parentElement.before(bar);
const dialog=document.createElement('section');dialog.id='phone-dialog';dialog.className='phone-hidden';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','SIP 회선 연결');dialog.innerHTML=`<form id="phone-connect-form" class="phone-box"><h3>SIP 회선 연결</h3><p id="phone-destination"></p><p>이지콜 로그인 계정과 별도로 발급받은 SIP 회선 계정을 입력하세요. 비밀번호는 이 연결에만 사용하며 브라우저 저장소에 저장하지 않습니다.</p><label for="phone-sip-user">SIP 내선 ID</label><input id="phone-sip-user" autocomplete="off" required><label for="phone-sip-password">SIP 회선 비밀번호</label><input id="phone-sip-password" type="password" autocomplete="off" required><details><summary>네트워크 연결 설정 (TURN 필요 시)</summary><label for="phone-turn">TURN 서버 주소</label><input id="phone-turn" placeholder="turns:turn.example.com:5349"><label for="phone-turn-user">TURN 사용자</label><input id="phone-turn-user" autocomplete="off"><label for="phone-turn-password">TURN 비밀번호</label><input id="phone-turn-password" type="password" autocomplete="off"></details><p id="phone-connect-message" role="alert"></p><button type="submit" id="phone-connect-submit">연결하기</button><button type="button" id="phone-connect-close">닫기</button></form>`;document.body.append(dialog);
function message(s){$('phone-status').textContent=s;}
function stopAuto(text=''){armed=false;clearTimeout(autoTimer);autoTimer=null;if(text)message(text);$('phone-auto').textContent='연속 발신 시작';}
function stopClock(){clearInterval(ticker);ticker=null;if(started!==null)currentCallSeconds=measuredSeconds(started,performance.now());started=null;$('call-timer-display').textContent=formatDuration(currentCallSeconds);}
function ended(){stopClock();dialing=false;$('call-active-state').classList.add('hidden');$('call-idle-state').classList.remove('hidden');message('통화가 종료됐습니다. 결과를 선택하고 저장하세요.');}
async function library(){if(window.SIP?.Web?.SimpleUser)return window.SIP.Web.SimpleUser;if(!modulePromise)modulePromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./vendor/sip-0.21.2.min.js';s.onload=()=>window.SIP?.Web?.SimpleUser?resolve(window.SIP.Web.SimpleUser):reject(Error('SIP 모듈을 불러오지 못했습니다.'));s.onerror=()=>reject(Error('SIP 모듈을 불러오지 못했습니다.'));document.head.append(s);}).catch(e=>{modulePromise=null;throw e;});return modulePromise;}
const phone=new SipPhone((server,options)=>new window.SIP.Web.SimpleUser(server,options),{
 onState:state=>{$('phone-state').textContent=({offline:'SIP 회선 미연결',connecting:'SIP 회선 연결 중',ready:'SIP 회선 연결 완료',calling:'상대방 응답 대기 중',active:'SIP 통화 중'})[state]||state;if(state==='offline'){stopClock();stopAuto('SIP 연결이 해제됐습니다. 회선을 다시 연결하세요.');}},
 onAnswered:()=>{if(started!==null||!agent()||actor()!==callActor||activeClaim?.callId!==callId)return;started=performance.now();currentCallSeconds=0;$('call-state-label').textContent='SIP 통화 중';ticker=setInterval(()=>{if(started!==null){currentCallSeconds=measuredSeconds(started,performance.now());$('call-timer-display').textContent=formatDuration(currentCallSeconds);}},250);$('phone-audio').play().catch(()=>message('음성을 듣기 위해 통화 음성 재생을 눌러 주세요.'));},
 onEnded:()=>{if(actor()===callActor&&activeClaim?.callId===callId)ended();}
});
function fingerprint(){const c=cfg();return JSON.stringify([transport(c),c.sipWss,c.sipDomain,c.sipStun]);}
function clearCredentials(){$('phone-sip-password').value='';$('phone-turn-password').value='';}
function renderAdmin(){
 const cid=getActiveCampId(),c=cfg(),version=JSON.stringify([transport(c),c.sipWss,c.sipDomain,c.sipStun]);
 if(settingsCamp!==cid||(!dirty&&version!==settingsVersion)){settingsCamp=cid;settingsVersion=version;dirty=false;$('phone-transport').value=transport(c);$('phone-wss').value=c.sipWss||'';$('phone-domain').value=c.sipDomain||'';$('phone-stun').value=c.sipStun||'';}
 const sip=$('phone-transport').value==='sip';$('phone-sip-settings').classList.toggle('phone-hidden',!sip);
 $('phone-admin-help').textContent=sip?'SIP는 브라우저에서 통화합니다. 자동 연결을 선택하면 요원이 연속 발신을 시작한 뒤, 결과 저장 후 다음 번호로 발신합니다.':'스마트폰은 발신 버튼으로 전화 앱을 엽니다. 자동 연결을 선택해도 실제 발신은 매번 요원이 터치해야 합니다.';
}
function sync(){
 renderAdmin();const c=cfg(),sip=transport(c)==='sip',a=actor(),f=fingerprint();
 if(lastActor!==a||lastConfig!==f){lastActor=a;lastConfig=f;stopAuto();clearCredentials();dialog.classList.add('phone-hidden');if(phone.user||phone.connecting){stopClock();dialing=false;void phone.disconnect();$('call-active-state').classList.add('hidden');$('call-idle-state').classList.remove('hidden');}}
 if(!agent()||c.globalStopped||isAgentOnBreak||document.hidden||navigator.onLine===false||c.dialMode!=='auto')stopAuto();
 $('phone-mode-title').textContent=sip?'SIP 인터넷전화':'일반 스마트폰 통화';
 $('phone-help').textContent=sip?'회선을 연결한 뒤 발신하세요. 통화 종료를 감지하며, 결과를 저장해야 다음 대상으로 진행합니다.':'발신 버튼을 누르면 스마트폰 전화 앱이 열립니다. 통화 후 이지콜로 돌아와 결과를 입력하세요. 자동 발신·종료 감지는 지원하지 않습니다.';
 $('phone-sip-actions').classList.toggle('phone-hidden',!sip);$('phone-native-duration').classList.toggle('phone-hidden',sip);$('btn-native-tel').classList.toggle('hidden',sip);
 if(!sip)$('phone-state').textContent='스마트폰 유심 / 기본 전화 앱 사용';
 $('btn-dial-action').textContent=sip?'SIP 회선으로 발신':'스마트폰 전화 앱으로 발신';
 $('phone-auto').classList.toggle('phone-hidden',!sip||c.dialMode!=='auto');
 $('btn-save-next').textContent=sip&&c.dialMode==='auto'?'결과 저장 · 다음 번호 자동 발신':'결과 저장 · 다음 대상 준비';
}
settings.addEventListener('input',()=>{dirty=true;renderAdmin();});
window.saveDialSettings=async function(){
 if(!verifiedIdentity||!['admin','super'].includes(verifiedIdentity.role)||sessionStorage.getItem('easycall_master_impersonator')){showToast('캠프 관리자 계정으로 로그인하세요.');return;}
 const c=cfg(),next={callTransport:$('phone-transport').value,sipWss:$('phone-wss').value.trim(),sipDomain:$('phone-domain').value.trim(),sipStun:$('phone-stun').value.trim()};
 try{if(next.callTransport==='sip')sipSettings(next);}catch(e){showToast(e.message);return;}
 const old={...c};Object.assign(c,next,{dialMode:$('setting-dial-mode').value,waitSecs:$('setting-wait-secs').value,dailyGoal:$('setting-daily-goal').value||'250'});
 if(!await savePersistentData(getActiveCampId())){Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,old);showToast('설정 저장에 실패했습니다. 다시 시도하세요.');return;}dirty=false;sync();showToast('통화 방식과 연결 설정을 저장했습니다.');
};
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
function permitted(){return agent()&&!isAgentOnBreak&&!isSavingResult&&!checkAgentGlobalStopBanner()&&navigator.onLine!==false;}
window.easycallPlaceCall=async function(launch=true){
 if(!launch||dialing||phone.active)return;if(!permitted()){stopAuto('현재 발신할 수 없습니다. 업무 상태와 네트워크를 확인하세요.');return;}
 const c=cfg(),sip=transport(c)==='sip',who=actor(),claim=activeClaim,signature=fingerprint();
 if(!claim){await loadCurrentVoterToDialer(true);message('대상을 확인하고 발신 버튼을 눌러 주세요.');return;}
 if(sip&&!phone.ready){stopAuto('먼저 SIP 회선을 연결하세요.');return;}
 let uri;try{uri=destination(claim.voter.phone,sip?sipSettings(c).domain:undefined);}catch(e){stopAuto(e.message);return;}
 dialing=true;callActor=who;callId=claim.callId;
 try{
  const {error}=await sbClient.rpc('easycall_authorize_call',{p_camp_id:getActiveCampId(),p_voter_id:claim.voterId});
  if(error)throw Error('발신 권한 또는 배정이 만료됐습니다.');
  if(actor()!==who||activeClaim!==claim||fingerprint()!==signature||!permitted())throw Error('발신 조건이 변경됐습니다. 다시 확인하세요.');
  currentCallSeconds=0;$('phone-duration').value='0';stopClock();started=null;
  if(sip){await phone.call(uri);if(!phone.active){dialing=false;return;}$('call-state-label').textContent=started!==null?'SIP 통화 중':'상대방 응답 대기 중';}
  else{window.location.href=uri;$('call-state-label').textContent='전화 앱 통화 후 결과를 입력하세요.';$('call-timer-display').textContent='시간 수동 입력';}
  $('call-idle-state').classList.add('hidden');$('call-active-state').classList.remove('hidden');
  message(sip?'SIP 발신 요청을 보냈습니다.':'전화 앱에서 통화한 뒤 돌아와 통화 완료를 눌러 주세요.');
 }catch(e){stopAuto(e.message);}finally{dialing=false;}
};
window.endCallSimulation=async function(){if(transport(cfg())==='sip'){if(phone.active){try{await phone.hangup();}catch{message('통화 종료 요청에 실패했습니다. 회선 상태를 확인하세요.');}}}else{ended();message('전화 앱에서 실제 통화를 종료했는지 확인한 뒤 결과를 저장하세요.');}};
const oldSave=window.saveResultToStorage;window.saveResultToStorage=async function(...args){
 if(phone.active||dialing){message('통화를 종료한 뒤 결과를 저장하세요.');return;}
 if(transport(cfg())==='smartphone')currentCallSeconds=Math.min(86400,Math.max(0,Math.floor(Number($('phone-duration').value)||0)));
 const old=activeClaim,who=actor();await oldSave(...args);
 if(old&&actor()===who&&activeClaim!==old){$('phone-duration').value='0';started=null;if(armed&&activeClaim&&cfg().dialMode==='auto'&&transport(cfg())==='sip'&&phone.ready){clearTimeout(autoTimer);const target=activeClaim,signature=fingerprint();message('결과 저장 완료. 다음 번호 발신을 대기합니다.');autoTimer=setTimeout(()=>{autoTimer=null;if(armed&&actor()===who&&activeClaim===target&&fingerprint()===signature&&!document.hidden)void window.easycallPlaceCall(true);else stopAuto();},waitMilliseconds(cfg().waitSecs));}}
};
$('phone-auto').onclick=()=>{if(armed){stopAuto('연속 발신을 중지했습니다.');return;}if(!permitted()||transport(cfg())!=='sip'||cfg().dialMode!=='auto'||!phone.ready){message('SIP 회선 연결과 업무 상태를 먼저 확인하세요.');return;}armed=true;$('phone-auto').textContent='연속 발신 중지';void window.easycallPlaceCall(true);};
const oldRefresh=window.refreshActiveRoleUI;window.refreshActiveRoleUI=function(...args){const result=oldRefresh(...args);sync();return result;};
const oldLogout=window.handleLogout;window.handleLogout=async function(...args){stopAuto();stopClock();clearCredentials();dialog.classList.add('phone-hidden');await phone.disconnect();dialing=false;return oldLogout(...args);};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAuto('다른 화면으로 이동해 연속 발신을 중지했습니다.');});
window.addEventListener('offline',()=>stopAuto('네트워크 연결이 끊겨 연속 발신을 중지했습니다.'));
window.addEventListener('pagehide',()=>{stopAuto();clearCredentials();stopClock();void phone.disconnect();});
sync();
