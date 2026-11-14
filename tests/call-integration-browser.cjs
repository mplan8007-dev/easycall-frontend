const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.resolve(process.execPath,'../../node_modules/playwright')));}
(async()=>{
 const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const body=fs.readFileSync(file.endsWith(path.sep)?file+'index.html':file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(body);}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';const browser=await chromium.launch(fs.existsSync(chrome)?{headless:true,executablePath:chrome}:{headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin))return route.continue();if(url.includes('supabase-js'))return route.fulfill({contentType:'text/javascript',body:`window.__mockAuth={getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({})};window.supabase={createClient:()=>({auth:window.__mockAuth})};`});return route.fulfill({contentType:'text/javascript',body:''});});
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof window.openWorkAccounts==='function');

  await page.waitForFunction(()=>typeof window.easycallPlaceCall==='function');
  await page.evaluate(()=>{
   verifiedIdentity={role:'agent',campId:'camp01',agentId:'agent01',uid:'tester'};localStorage.setItem('easycall_role','agent');currentAgentId='agent01';currentAdminId='camp01';isAgentOnBreak=false;
   campsList=[{campId:'camp01',name:'Mock camp'}];agentsList=[{agentId:'agent01',campId:'camp01',alias:'Mock agent'}];campSettingsMap.camp01={callTransport:'smartphone',dialMode:'auto',waitSecs:'1',nightLock:false,globalStopped:false};
   window.__claimIndex=1;window.__auth=0;window.__saved=[];window.__failSave=false;window.__deny=false;window.__sipCalls=[];window.__disconnects=0;
   const v={id:'1',campId:'camp01',name:'Test',phone:'01012345678',lastResult:'READY'};votersList=[v];activeClaim={voterId:v.id,callId:'call-1',voter:v};currentVoterIdx=0;
   sbClient={rpc:async(name,args)=>{
    if(name==='easycall_authorize_call'){window.__auth++;return window.__deny?{error:{message:'stopped'}}:{data:null};}
    if(name==='easycall_complete_call'){if(window.__failSave)return {error:{message:'offline'}};window.__saved.push(args.p_entry);window.__claimIndex++;return {data:{...args.p_entry,created_at:new Date().toISOString()}};}
    if(name==='easycall_claim_voter')return {data:[{voter_id:String(window.__claimIndex),claim_call_id:'claim-'+window.__claimIndex,name:'Test',phone:'01012345678',last_result:'READY'}]};
    return {data:null};
   }};isEnterpriseRpcAvailable=true;refreshActiveRoleUI();
  });
  await page.evaluate(()=>startCallSimulation(false));
  assert.match(await page.locator('#phone-help').innerText(),/전화 앱/);assert.equal(await page.evaluate(()=>currentCallSeconds),0);
  await page.locator('#phone-duration').fill('12');await page.evaluate(()=>{selectSupportStatus('SUPPORT');return saveResultToStorage('SUPPORT');});
  assert.equal(await page.evaluate(()=>window.__saved[0].duration_seconds),12);
  await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__auth),0);
  await page.evaluate(()=>{
   Object.assign(campSettingsMap.camp01,{callTransport:'sip',sipWss:'wss://pbx.example.com/ws',sipDomain:'pbx.example.com'});
   window.SIP={Web:{SimpleUser:class{
    constructor(server,options){window.__sipOptions=options;this.options=options;}
    async connect(){} async register(){this.options.delegate.onRegistered();}
    async disconnect(){window.__disconnects++;} async call(uri){window.__sipCalls.push(uri);}
    async hangup(){this.options.delegate.onCallHangup();} async decline(){}
   }}};refreshActiveRoleUI();
  });
  await page.locator('#phone-connect').click();await page.locator('#phone-sip-user').fill('1001');await page.locator('#phone-sip-password').fill('fake-sip-password');await page.locator('#phone-connect-submit').click();
  await page.waitForFunction(()=>document.getElementById('phone-state').textContent.includes('연결 완료'));
  assert.equal(await page.locator('#phone-sip-password').inputValue(),'');assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>String(v).includes('fake-sip-password'))),false);
  await page.locator('#phone-auto').click();await page.waitForFunction(()=>window.__sipCalls.length===1);
  assert.equal(await page.evaluate(()=>window.__sipCalls[0]),'sip:01012345678@pbx.example.com');assert.equal(await page.evaluate(()=>currentCallSeconds),0);
  await page.evaluate(()=>{selectSupportStatus('SUPPORT');return saveResultToStorage('SUPPORT');});assert.equal(await page.evaluate(()=>window.__saved.length),1);
  await page.evaluate(()=>window.__sipOptions.delegate.onCallAnswered());await page.waitForTimeout(1100);await page.evaluate(()=>endCallSimulation());assert.ok(await page.evaluate(()=>currentCallSeconds)>=1);
  await page.evaluate(()=>{window.__failSave=true;selectSupportStatus('SUPPORT');return saveResultToStorage('SUPPORT');});
  await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__sipCalls.length),1);
  await page.evaluate(()=>{window.__failSave=false;return saveResultToStorage('SUPPORT');});await page.waitForFunction(()=>window.__sipCalls.length===2);
  await page.evaluate(()=>endCallSimulation());await page.evaluate(()=>{selectSupportStatus('SUPPORT');return saveResultToStorage('SUPPORT');});
  await page.locator('#phone-auto').click();await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__sipCalls.length),2);
  await page.evaluate(()=>{campSettingsMap.camp01.globalStopped=false;window.__deny=true;return startCallSimulation(true);});assert.equal(await page.evaluate(()=>window.__sipCalls.length),2);
  await page.evaluate(()=>{campSettingsMap.camp01.callTransport='smartphone';refreshActiveRoleUI();});assert.equal(await page.locator('#phone-sip-actions').isVisible(),false);assert.ok(await page.evaluate(()=>window.__disconnects)>=1);
  // Camp managers see the assigned mode but cannot open or change the policy.
  await page.evaluate(()=>{verifiedIdentity={role:'admin',campId:'camp01',uid:'manager'};localStorage.setItem('easycall_role','admin');renderStatsAndCharts=()=>{};renderAdminLogsTable=()=>{};refreshActiveRoleUI();});
  assert.equal(await page.locator('#phone-policy-open').isVisible(),false);
  await page.evaluate(()=>openCampCallTransport('camp01'));assert.equal(await page.locator('#phone-policy-dialog').isVisible(),false);
  assert.match(await page.locator('#phone-admin-readonly').innerText(),/최고관리자/);
  assert.match(await page.locator('#admin-call-transport-badge').innerText(),/현재 통화 방식: 일반 스마트폰/);
  await page.evaluate(()=>{Object.assign(campSettingsMap.camp01,{callTransport:'sip',sipWss:'',sipDomain:''});refreshActiveRoleUI();});
  assert.match(await page.locator('#admin-call-transport-badge').innerText(),/SIP 인터넷전화 · 회선 설정 대기/);
  await page.evaluate(()=>{Object.assign(campSettingsMap.camp01,{sipWss:'wss://pbx.example.com/ws',sipDomain:'pbx.example.com'});refreshActiveRoleUI();});
  assert.match(await page.locator('#admin-call-transport-badge').innerText(),/현재 통화 방식: SIP 인터넷전화/);
  // Super administrators select the transport per camp with revision protection.
  await page.evaluate(()=>{
   verifiedIdentity={role:'super',uid:'root'};localStorage.setItem('easycall_role','super');renderSuperCampsTable=()=>{};window.__configSaves=0;window.__saveConfigOK=true;window.__policy={revision:'r1',config:{callTransport:'smartphone',sipWss:'',sipDomain:'',sipStun:''}};
   const rpc=sbClient.rpc;sbClient.rpc=async(name,args)=>{
    if(name==='easycall_call_transport_get')return {data:{campId:args.p_camp,...window.__policy}};
    if(name==='easycall_call_transport_set'){window.__configSaves++;if(!window.__saveConfigOK)return {error:{message:'conflict'}};window.__policy={revision:'r'+(window.__configSaves+1),config:{...args.p_config}};return {data:{campId:args.p_camp,...window.__policy}};}return rpc(name,args);
   };refreshActiveRoleUI();document.getElementById('camp-edit-context').textContent='camp01 · Test';
  });
  await page.locator('#phone-policy-open').click();await page.waitForFunction(()=>!document.getElementById('phone-policy-save').disabled);
  await page.locator('#phone-transport').selectOption('sip');await page.locator('#phone-wss').fill('ws://pbx.example.com/ws');await page.locator('#phone-domain').fill('pbx.example.com');await page.locator('#phone-policy-save').click();
  assert.equal(await page.evaluate(()=>window.__configSaves),0);
  await page.locator('#phone-wss').fill('wss://pbx.example.com/ws');await page.locator('#phone-policy-save').click();
  await page.waitForFunction(()=>document.getElementById('phone-policy-message').textContent.includes('저장했습니다'));
  assert.equal(await page.evaluate(()=>window.__configSaves),1);assert.equal(await page.evaluate(()=>campSettingsMap.camp01.callTransport),'sip');
  if(process.env.CALL_UI_SCREENSHOT)await page.locator('#phone-policy-dialog').screenshot({path:process.env.CALL_UI_SCREENSHOT});
  await page.evaluate(()=>window.__saveConfigOK=false);await page.locator('#phone-transport').selectOption('smartphone');await page.locator('#phone-policy-save').click();
  await page.waitForFunction(()=>document.getElementById('phone-policy-message').textContent.includes('저장 실패'));
  assert.equal(await page.evaluate(()=>campSettingsMap.camp01.callTransport),'sip');await page.locator('#phone-policy-close').click();
  await page.evaluate(()=>{verifiedIdentity={role:'agent',campId:'camp01',agentId:'agent01',uid:'tester'};localStorage.setItem('easycall_role','agent');campSettingsMap.camp01.callTransport='smartphone';refreshActiveRoleUI();});
  await page.evaluate(()=>{window.__deny=false;return startCallSimulation(true);});assert.match(await page.locator('#call-state-label').innerText(),/전화 앱/);
  assert.deepEqual(errors,[]);
  console.log('PASS: smartphone timing, SIP registration/answer/end, secret clearing, save-gated auto loop, cancellation and authorization denial. External services mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

