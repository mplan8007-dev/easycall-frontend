const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('opening a message uses message authorization and does not mark a call',async()=>{
 const html=fs.readFileSync(__dirname+'/../index.html','utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const ctx=vm.createContext({console,document:{getElementById(){return {}},querySelectorAll(){return []},addEventListener(){}},
  localStorage:{getItem(){return null}},sessionStorage:{getItem(){return null}},location:{},
  setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){},addEventListener(){},navigator:{},Date,Intl,Blob,URL,alert(){},confirm(){return true}});
 vm.runInContext('window=globalThis',ctx);vm.runInContext(script,ctx);
 vm.runInContext(`requests=[]; verifiedIdentity={role:'agent',campId:'c1'}; activeClaim={voterId:'v1'};
 getActiveCampId=()=> 'c1'; getCampVoters=()=>[{id:'v1',phone:'01012345678',name:'Test'}];currentVoterIdx=0;
 getCampConfig=()=>({dncPhones:[],smsTemplate:'hello'});checkAgentGlobalStopBanner=()=>false;showToast=()=>{};
 sbClient={rpc:async(name,args)=>{requests.push({name,args});return {error:null}}};`,ctx);
 await vm.runInContext('sendCallbackSmsToVoter()',ctx);
 assert.equal(ctx.requests.length,1);assert.equal(ctx.requests[0].name,'easycall_authorize_message');
 assert.match(ctx.location.href,/^sms:01012345678/);
});

