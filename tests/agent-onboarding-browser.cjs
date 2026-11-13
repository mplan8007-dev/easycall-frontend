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

  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.evaluate(()=>{
   verifiedIdentity={role:'admin',campId:'camp01',uid:'manager'};
   campsList=[{campId:'camp01',name:'등록 검증 캠프'}];
   window.__accounts=[{loginId:'agent01',name:'기존 요원',phone:'0419301001',hasAccount:false,status:'unissued'}];
   window.__calls=[];window.__ready=true;window.__quota=10;window.__fail=false;
   sbClient={rpc:async()=>({data:{campId:'camp01',limit:10,registered:window.__accounts.length,remaining:window.__quota,reservedIds:['agent0001',...window.__accounts.map(r=>r.loginId)],accounts:window.__accounts.map(r=>({...r}))}}),
    functions:{invoke:async(name,{body})=>{
     if(body.action.startsWith('agent-common-'))return {data:{state:{configured:window.__ready,ready:window.__ready,version:'v1',total:0,done:0,pending:0,processing:0,failed:0},password:'000123'}};
     window.__calls.push(body);
     if(window.__fail)throw Error('mock connection lost');
     const results=body.rows.map(r=>{
      let old=window.__accounts.find(a=>a.loginId===r.loginId);
      if(old?.hasAccount)return {...r,success:false,error:'Already registered'};
      if(old){old.hasAccount=true;old.status='active';}
      else window.__accounts.push({name:r.alias,phone:r.phone,loginId:r.loginId,hasAccount:true,status:'active'});
      return {...r,success:true,password:'000123'};
     });return {data:{results}};
    }}};
   openAgentAccounts();
  });
  await page.waitForFunction(()=>document.getElementById('gc-status').textContent.includes('사용 중'));
  assert.match(await page.locator('#ga-prepare-existing').innerText(),/1명/);
  // Existing devices retain their IDs and need no second preview screen.
  await page.locator('#ga-prepare-existing').click();
  await page.waitForFunction(()=>document.getElementById('ga-progress').textContent.includes('발급 완료 1명'));
  assert.equal(await page.evaluate(()=>window.__calls[0].rows[0].loginId),'agent01');
  await page.locator('#ga-results-back').click();
  assert.equal(await page.locator('#ga-prepare-existing').isVisible(),false);
  await page.locator('#ga-list [data-ga-action="guide"]').click();
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/camp01/);
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/agent01/);
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/000123/);
  // Name/phone only; automatic ID skips reserved agent0001.
  await page.locator('#ga-single').click();
  await page.locator('#ga-single-name').fill('새 요원');
  await page.locator('#ga-single-phone').fill('041-930-1002');
  await page.locator('#ga-single-submit').click();
  await page.waitForFunction(()=>document.getElementById('ga-progress').textContent.includes('발급 완료 1명'));
  assert.equal(await page.evaluate(()=>window.__calls[1].rows[0].loginId),'agent0002');
  assert.equal(await page.evaluate(()=>window.__calls[1].rows[0].phone),'0419301002');
  assert.equal(await page.evaluate(()=>window.__calls[1].rows[0].campId),'camp01');
  await page.locator('#ga-results-back').click();
  // Re-adding the same person does not create a second account.
  await page.locator('#ga-single').click();await page.locator('#ga-single-name').fill('새 요원');await page.locator('#ga-single-phone').fill('0419301002');await page.locator('#ga-single-submit').click();
  await page.waitForFunction(()=>document.getElementById('ga-message').textContent.includes('이미 등록된'));
  assert.equal(await page.evaluate(()=>window.__calls.length),2);
  // Quota is checked against fresh server state.
  await page.evaluate(()=>window.__quota=0);await page.locator('#ga-single-name').fill('초과 요원');await page.locator('#ga-single-phone').fill('0419301003');await page.locator('#ga-single-submit').click();
  await page.waitForFunction(()=>document.getElementById('ga-message').textContent.includes('등록 가능 인원'));
  assert.equal(await page.evaluate(()=>window.__calls.length),2);
  // Failure stays visibly incomplete and does not invent a successful login.
  await page.evaluate(()=>{window.__quota=5;window.__fail=true;});await page.locator('#ga-single-submit').click();
  await page.waitForFunction(()=>document.getElementById('ga-progress').textContent.includes('확인 필요 1명'));
  assert.equal(await page.locator('#ga-results [data-ga-result]').count(),0);
  await page.locator('#ga-results-back').click();await page.locator('#ga-close').click();
  // The old registration button opens the same unified flow.
  assert.equal(await page.locator('#agent-id-input').count(),0);
  await page.evaluate(()=>{window.__fail=false;createAgentAccount();});
  await page.waitForFunction(()=>!document.getElementById('ga-single-panel').classList.contains('ga-hidden'));
  assert.equal(await page.locator('#ga-single-name').inputValue(),'');
  await page.locator('#ga-close').click();
  // An unset common password blocks both entry points before creating users.
  await page.evaluate(()=>{window.__ready=false;openAgentAccounts();});
  await page.waitForFunction(()=>document.getElementById('gc-status').textContent.includes('미설정'));
  const before=await page.evaluate(()=>window.__calls.length);
  await page.locator('#ga-single').click();
  assert.equal(await page.locator('#ga-single-panel').isVisible(),false);
  assert.equal(await page.locator('#gc-settings').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__calls.length),before);
  assert.deepEqual(errors,[]);
  console.log('PASS: unified registration, existing ID preparation, one-click login guide copy, fresh quota/duplicate checks, failure visibility and common-password gating. External services mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
