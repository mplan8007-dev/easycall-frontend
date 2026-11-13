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
  await page.evaluate(()=>{window.__calls=[];sbClient={auth:{signInWithPassword:async args=>{window.__calls.push(args);return {data:{user:{id:'test-user',app_metadata:{easycall_must_change:true}}}}},signOut:async()=>({})}};});
  await page.locator('#work-login-camp').fill(' CAMP01 ');await page.locator('#login-id').fill('Worker01');await page.locator('#login-pw').fill('fictional-temporary-password');await page.locator('#login-pw').press('Enter');
  await page.waitForFunction(()=>!document.getElementById('work-password-dialog').classList.contains('hidden'));
  assert.match(await page.evaluate(()=>window.__calls[0].email),/^[0-9a-f]{64}@login\.easycall\.invalid$/);
  assert.equal(await page.locator('#login-id').inputValue(),'Worker01');
  await page.evaluate(()=>{document.getElementById('work-password-dialog').classList.add('hidden');verifiedIdentity={role:'admin',campId:'camp01',uid:'manager'};sbClient={functions:{invoke:async(name,{body})=>{window.__bulk=body;return {data:{results:body.rows.map((row,i)=>({...row,success:i===0,password:i===0?'a'.repeat(48):undefined,error:i?'試験: capacity exceeded':undefined}))}}}}};openWorkAccounts();});
  assert.equal(await page.locator('#work-account-camp').isDisabled(),true);assert.equal(await page.locator('#work-account-role').isDisabled(),true);
  await page.locator('#work-account-rows').fill('a,<img src=x onerror=alert(1)>,0419301001\nb,Worker B,0419301002');
  await page.locator('#work-account-create').click();await page.waitForFunction(()=>document.getElementById('work-account-message').textContent.includes('실패 1'));
  assert.equal(await page.locator('#work-account-result img').count(),0);assert.equal(await page.locator('#work-account-download').getAttribute('class').then(c=>c.includes('hidden')),false);
  assert.equal(await page.evaluate(()=>window.__bulk.rows[0].campId),'camp01');assert.deepEqual(errors,[]);
  console.log('PASS: browser ID login, mandatory first password screen, camp-scoped registration, partial results and escaped text. External services mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
