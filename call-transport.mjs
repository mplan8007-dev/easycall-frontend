export function transport(config={}){return config.callTransport==='sip'?'sip':'smartphone';}
export function sipSettings(config={}){
 const wss=String(config.sipWss||'').trim(),domain=String(config.sipDomain||'').trim();
 let u;try{u=new URL(wss);}catch{throw Error('SIP 서버 주소를 wss:// 형식으로 입력하세요.');}
 if(u.protocol!=='wss:'||u.username||u.password||u.hash||u.search)throw Error('SIP 서버는 계정 정보나 쿼리가 없는 wss:// 주소를 사용하세요.');
 if(!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[0-9]{1,5})?$/.test(domain))throw Error('SIP 도메인을 확인하세요. 예: pbx.example.com');
 const ice=String(config.sipStun||'').trim();
 if(ice&&!/^stuns?:[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(ice))throw Error('STUN 주소를 확인하세요. 예: stun:stun.example.com:3478');
 return {wss:u.href,domain,iceServers:ice?[{urls:ice}]:[]};
}
export function destination(phone,domain){const n=String(phone||'').replace(/[ ()-]/g,'');if(!/^\+?[0-9]{3,15}$/.test(n))throw Error('발신 전화번호 형식을 확인하세요.');return domain?'sip:'+n+'@'+domain:'tel:'+n;}
export function sipAccount(user){const u=String(user||'').trim();if(!/^[a-zA-Z0-9_.+-]{1,80}$/.test(u))throw Error('SIP 내선 ID를 확인하세요.');return u;}
export function waitMilliseconds(value){return Math.min(60,Math.max(1,Number(value)||2))*1000;}
export function measuredSeconds(start,now){return start===null?0:Math.max(0,Math.floor((now-start)/1000));}
export class SipPhone{
 constructor(factory,{onState=()=>{},onAnswered=()=>{},onEnded=()=>{},registrationTimeout=20000}={}){this.factory=factory;this.onState=onState;this.onAnswered=onAnswered;this.onEnded=onEnded;this.timeout=registrationTimeout;this.user=null;this.generation=0;this.ready=false;this.active=false;this.connecting=false;}
 async connect(config,credentials){if(this.pendingConnect||this.active)throw Error('통화 또는 연결 처리 중입니다.');this.pendingConnect=true;try{return await this._connect(config,credentials);}finally{this.pendingConnect=false;}}
 async _connect(config,{username,password,audio,turnUrl='',turnUser='',turnPassword=''}){
  if(this.active||this.connecting)throw Error('통화 또는 연결 처리 중입니다.');await this.disconnect();
  const settings=sipSettings(config),account=sipAccount(username);
  if(!password)throw Error('SIP 비밀번호를 입력하세요.');
  if(turnUrl&&!/^turns?:[a-zA-Z0-9.-]+(?::[0-9]{1,5})?(?:\?transport=(?:udp|tcp))?$/.test(turnUrl))throw Error('TURN 주소를 확인하세요.');
  if(turnUrl&&(!turnUser||!turnPassword))throw Error('TURN 사용자와 비밀번호를 입력하세요.');
  const iceServers=[...settings.iceServers,...(turnUrl?[{urls:turnUrl,username:turnUser,credential:turnPassword}]:[])],ticket=++this.generation;
  this.connecting=true;this.onState('connecting');
  let timer,resolveRegistered,rejectRegistered;
  const registered=new Promise((resolve,reject)=>{resolveRegistered=resolve;rejectRegistered=reject;timer=setTimeout(()=>reject(Error('SIP 등록 응답이 없습니다. 서버와 계정을 확인하세요.')),this.timeout);});
  // A connection failure may happen before register() is awaited.
  registered.catch(()=>{});this.cancelRegistration=rejectRegistered;
  const current=()=>ticket===this.generation;
  try{
   this.user=this.factory(settings.wss,{aor:'sip:'+account+'@'+settings.domain,media:{constraints:{audio:true,video:false},remote:{audio}},
    reconnectionAttempts:0,userAgentOptions:{authorizationUsername:account,authorizationPassword:password,logBuiltinEnabled:false,logLevel:'error',sessionDescriptionHandlerFactoryOptions:{peerConnectionConfiguration:{iceServers}}},
    delegate:{
     onRegistered:()=>{if(current()){this.ready=true;resolveRegistered();this.onState('ready');}},
     onUnregistered:()=>{if(current()){this.ready=false;this.onState('offline');rejectRegistered(Error('SIP 등록이 해제됐습니다.'));}},
     onServerDisconnect:()=>{if(current()){this.ready=false;this.onState('offline');rejectRegistered(Error('SIP 연결이 끊겼습니다.'));}},
     onCallAnswered:()=>{if(current()&&this.active){this.onState('active');this.onAnswered();}},
     onCallHangup:()=>{if(current()&&this.active){this.active=false;this.onState(this.ready?'ready':'offline');this.onEnded();}},
     onCallReceived:()=>{if(current())void this.user?.decline().catch(()=>{});}
    }});
   await this.user.connect();if(!current())throw Error('연결이 취소됐습니다.');await this.user.register();await registered;
   if(!current())throw Error('연결이 취소됐습니다.');
  }catch{if(current())await this.disconnect();throw Error('SIP 연결 실패: 서버 주소·회선 계정·네트워크를 확인하세요.');}
  finally{clearTimeout(timer);if(this.cancelRegistration===rejectRegistered)this.cancelRegistration=null;if(current())this.connecting=false;}
 }
 async call(uri){if(!this.ready||!this.user)throw Error('먼저 SIP 회선을 연결하세요.');if(this.active)throw Error('이미 발신 또는 통화 중입니다.');this.active=true;this.onState('calling');try{await this.user.call(uri);}catch{if(this.active){this.active=false;this.onEnded();}this.onState(this.ready?'ready':'offline');throw Error('SIP 발신에 실패했습니다.');}}
 async hangup(){if(this.active&&this.user)await this.user.hangup();}
 async disconnect(){this.cancelRegistration?.(Error('연결을 취소했습니다.'));this.cancelRegistration=null;const user=this.user;this.generation++;this.user=null;this.ready=false;this.active=false;this.connecting=false;this.onState('offline');if(user){try{await user.disconnect();}catch{/* Do not retain or log credentials. */}}}
}

