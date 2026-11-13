const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const mod=()=>import('../call-transport.mjs');
const config={callTransport:'sip',sipWss:'wss://pbx.example.com/ws',sipDomain:'pbx.example.com',sipStun:'stun:stun.example.com:3478'};
test('default transport is smartphone; SIP endpoints and dialing numbers are validated',async()=>{
 const m=await mod();assert.equal(m.transport({}),'smartphone');assert.equal(m.transport(config),'sip');
 assert.equal(m.destination('010-1234-5678'),'tel:01012345678');assert.equal(m.destination('+82 10 1234 5678',config.sipDomain),'sip:+821012345678@pbx.example.com');
 for(const p of ['0101234;foo','123@evil','javascript:alert(1)','*21#'])assert.throws(()=>m.destination(p));
 for(const sipWss of ['ws://pbx.example.com','https://pbx.example.com','wss://a:b@pbx.example.com','wss://pbx.example.com/?token=secret'])assert.throws(()=>m.sipSettings({...config,sipWss}));
 assert.throws(()=>m.sipSettings({...config,sipDomain:'pbx.example.com@evil'}));assert.throws(()=>m.sipAccount('alice@evil'));assert.equal(m.measuredSeconds(null,50000),0);assert.equal(m.measuredSeconds(1000,4500),3);
});
test('pinned official bundle exposes the documented Web.SimpleUser API',()=>{
 const sip=require('../vendor/sip-0.21.2.min.js');assert.equal(typeof sip.Web.SimpleUser,'function');
 for(const name of ['connect','register','call','hangup','disconnect','decline'])assert.equal(typeof sip.Web.SimpleUser.prototype[name],'function',name);
});
test('SIP registration waits for acknowledgement, calls serialize and answer/hangup are event based',async()=>{
 const {SipPhone}=await mod();let options,answered=0,ended=0,disconnects=0;
 const phone=new SipPhone((server,o)=>{assert.equal(server,config.sipWss);options=o;return {connect:async()=>{},register:async()=>{queueMicrotask(()=>o.delegate.onRegistered());},call:async uri=>{assert.equal(uri,'sip:01012345678@pbx.example.com');},hangup:async()=>o.delegate.onCallHangup(),disconnect:async()=>{disconnects++;}};},{onAnswered:()=>answered++,onEnded:()=>ended++});
 await phone.connect(config,{username:'1001',password:'fake-sip-only-password',audio:{}});
 assert.equal(phone.ready,true);assert.equal(options.userAgentOptions.logBuiltinEnabled,false);assert.equal(options.media.constraints.video,false);
 await phone.call('sip:01012345678@pbx.example.com');await assert.rejects(phone.call('sip:01012345678@pbx.example.com'));assert.equal(answered,0);
 options.delegate.onCallAnswered();assert.equal(answered,1);await phone.hangup();assert.equal(ended,1);assert.equal(phone.active,false);
 await phone.disconnect();options.delegate.onRegistered();options.delegate.onCallAnswered();assert.equal(phone.ready,false);assert.equal(answered,1);assert.equal(disconnects,1);
});
test('registration failure/timeout cannot appear ready and cleans up the user',async()=>{
 const {SipPhone}=await mod();let closed=0;const phone=new SipPhone(()=>({connect:async()=>{},register:async()=>{},disconnect:async()=>{closed++;}}),{registrationTimeout:10});
 await assert.rejects(phone.connect(config,{username:'1001',password:'fake-only',audio:{}}));assert.equal(phone.ready,false);assert.equal(phone.user,null);assert.equal(closed,1);
 await assert.rejects(phone.call('sip:1001@pbx.example.com'));
});

test('pending registration cancels promptly and rejects overlapping connects',async()=>{
 const {SipPhone}=await mod();let options;
 const phone=new SipPhone((server,o)=>{options=o;return {connect:async()=>{},register:async()=>{},disconnect:async()=>{}};});
 const pending=phone.connect(config,{username:'1001',password:'fake-only',audio:{}});
 await new Promise(r=>setImmediate(r));
 await assert.rejects(phone.connect(config,{username:'1001',password:'fake-only',audio:{}}));
 await phone.disconnect();await assert.rejects(pending);options.delegate.onRegistered();assert.equal(phone.ready,false);assert.equal(phone.user,null);
});
