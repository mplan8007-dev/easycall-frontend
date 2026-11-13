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
  await page.addStyleTag({content:'.hidden{display:none!important}'});
  await page.evaluate(()=>{verifiedIdentity={role:'super',uid:'owner'};campsList=[{campId:'camp01',name:'Camp One'},{campId:'camp02',name:'Camp Two'}];window.__actions=[];window.__list=[{loginId:'manager01',name:'<img src=x>',status:'active',mustChange:true}];sbClient={rpc:async(name,args)=>{window.__read=args;return {data:window.__list};},functions:{invoke:async(name,{body})=>{window.__actions.push(body);if(body.action==='disable'||body.action==='enable'){window.__list[0].status=body.action==='disable'?'disabled':'active';return {data:{success:true}};}if(body.action==='reset')return {data:{success:true,password:'000123'}};return {data:{results:[{...body.rows[0],success:true,password:'012345'}]}};}}};openCampAdminAccounts('camp01');});
  await page.waitForFunction(()=>document.getElementById('ca-rows').textContent.includes('manager01'));
  assert.equal(await page.locator('#ca-rows img').count(),0);assert.match(await page.locator('#ca-context').innerText(),/camp01/);
  await page.getByRole('button',{name:'사용 중지',exact:true}).click();assert.match(await page.locator('#ca-confirm-text').innerText(),/manager01/);await page.locator('#ca-confirm').click();
  await page.waitForFunction(()=>document.getElementById('ca-rows').textContent.includes('사용 재개'));await page.getByRole('button',{name:'사용 재개',exact:true}).click();await page.locator('#ca-confirm').click();
  await page.waitForFunction(()=>document.getElementById('ca-rows').textContent.includes('사용 중지'));
  await page.getByRole('button',{name:'비밀번호 재발급',exact:true}).click();await page.locator('#ca-confirm').click();await page.waitForFunction(()=>document.getElementById('ca-delivery').value.includes('000123'));
  assert.match(await page.locator('#ca-delivery').inputValue(),/캠프 ID: camp01/);assert.match(await page.locator('#ca-delivery').inputValue(),/로그인 ID: manager01/);
  await page.locator('#ca-result-back').click();assert.equal(await page.locator('#ca-delivery').inputValue(),'');
  await page.locator('#ca-add').click();await page.locator('#ca-name').fill('Kim');await page.locator('#ca-login').fill('bad@id');await page.locator('#ca-create').click();assert.match(await page.locator('#ca-login-error').innerText(),/1~32/);
  await page.locator('#ca-login').fill('manager02');await page.locator('#ca-create').click();await page.waitForFunction(()=>document.getElementById('ca-delivery').value.includes('012345'));
  assert.equal(await page.evaluate(()=>window.__actions.filter(a=>a.action==='create').length),1);assert.equal(await page.evaluate(()=>window.__actions.at(-1).rows[0].role),'admin');assert.equal(await page.evaluate(()=>window.__actions.at(-1).rows[0].campId),'camp01');
  await page.locator('#ca-close').click();assert.equal(await page.locator('#ca-delivery').inputValue(),'');assert.equal(await page.locator('#camp-admin-accounts').isVisible(),false);
  await page.evaluate(()=>{window.__list=[];openCampAdminAccounts('camp02');});await page.waitForFunction(()=>document.getElementById('ca-rows').textContent.includes('등록된 관리자가 없습니다'));
  await page.locator('#ca-close').click();await page.evaluate(()=>{verifiedIdentity={role:'admin',campId:'camp01'};openCampAdminAccounts('camp02');});assert.equal(await page.locator('#camp-admin-accounts').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: camp administrator list, escaped names, create validation, scoped issuance, reset, disable, resume and secret clearing. External services mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
