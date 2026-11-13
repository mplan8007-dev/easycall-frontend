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
  await page.evaluate(()=>{verifiedIdentity={role:'admin',campId:'camp01',uid:'manager'};campsList=[{campId:'camp01',name:'Our Camp'}];window.__policy={configured:false,ready:false,version:null,total:0,done:0,pending:0,processing:0,failed:0};window.__events=[];window.__attempt=0;sbClient={rpc:async()=>({data:{campId:'camp01',limit:10,registered:0,remaining:10,reservedIds:[],accounts:[]}}),functions:{invoke:async(name,{body})=>{window.__events.push(body.action);if(body.action==='agent-common-set'){window.__set=body;window.__policy={configured:true,ready:false,version:'v1',total:2,done:0,pending:2,processing:0,failed:0};}if(body.action==='agent-common-retry')window.__policy={...window.__policy,pending:1,failed:0};if(body.action==='agent-common-apply'){window.__attempt++;window.__policy=window.__attempt===1?{...window.__policy,done:1,pending:0,failed:1}:{...window.__policy,done:2,pending:0,failed:0,ready:true};}return {data:{state:window.__policy,...(body.action==='agent-common-read'?{password:'654321'}:{})}};}}};openAgentAccounts();});
  await page.waitForFunction(()=>document.getElementById('gc-status').textContent.includes('미설정'));
  if(process.env.COMMON_UI_SCREENSHOT)await page.screenshot({path:process.env.COMMON_UI_SCREENSHOT});
  await page.locator('#ga-bulk').click();assert.match(await page.locator('#gc-message').innerText(),/먼저/);assert.equal(await page.locator('#ga-input-panel').isVisible(),false);
  await page.locator('#gc-open').click();await page.locator('#gc-password').fill('1234');await page.locator('#gc-apply').click();assert.match(await page.locator('#gc-message').innerText(),/6자리/);
  await page.locator('#gc-password').fill('654321');await page.locator('#gc-apply').click();await page.waitForFunction(()=>document.getElementById('gc-message').textContent.includes('일부 계정'));
  assert.equal(await page.evaluate(()=>window.__set.password),'654321');assert.equal(await page.evaluate(()=>window.__set.expectedVersion),null);assert.equal(await page.locator('#gc-password').inputValue(),'');assert.equal(await page.locator('#gc-open').isDisabled(),true);
  await page.locator('#gc-retry').click();await page.waitForFunction(()=>document.getElementById('gc-message').textContent.includes('전체 적용을 완료'));
  await page.locator('#gc-reveal').click();await page.waitForFunction(()=>document.getElementById('gc-secret').value==='654321');assert.equal(await page.evaluate(()=>Object.values(localStorage).some(x=>String(x).includes('654321'))),false);
  await page.locator('#ga-bulk').click();assert.equal(await page.locator('#ga-input-panel').isVisible(),true);await page.locator('#ga-close').click();assert.equal(await page.locator('#gc-secret').inputValue(),'');
  assert.deepEqual(errors,[]);
  console.log('PASS: common-password configuration, batch application, failed-account retry, readback, issuance gating and secret clearing. External services mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
