const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{let body=fs.readFileSync(file);if(file.endsWith('call-integration.js'))body=String(body).replace('const oldLogout=window.handleLogout;','const oldLogout=async()=>{window.__loggedOut=true};');res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(body);}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin))return route.continue();if(url.includes('supabase-js'))return route.fulfill({contentType:'text/javascript',body:"window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({})}})};"});return route.fulfill({contentType:'text/javascript',body:''});});
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof window.easycallPlaceCall==='function'&&typeof window.easycallRefreshImportHistory==='function');
  assert.equal(await page.locator('#voter-import-mode').inputValue(),'replace');
  await page.evaluate(()=>{
   verifiedIdentity={role:'admin',uid:'admin',campId:'camp01'};currentAdminId='camp01';localStorage.setItem('easycall_role','admin');
   document.getElementById('login-view').classList.add('hidden');document.getElementById('admin-view').classList.remove('hidden');
   window.__runs=[];window.__requests=[];window.__reject=false;pullStateFromSupabase=async()=>{};updateVoterQueueStatusText=()=>{};
   sbClient={rpc:async(name,args)=>{window.__requests.push({name,args});if(name==='easycall_import_history')return {data:window.__runs};if(name==='easycall_import_voters'){const result=window.__reject?{success:false,error:'배정 중인 대상이 있어 전체 교체를 중단했습니다.'}:{success:true,inserted:4,duplicates:4,blocked:0,total:8};Object.assign(result,{filename:args.p_filename,mode:args.p_mode,createdAt:new Date().toISOString()});window.__runs.unshift(result);return {data:result};}return {data:null};}};
  });
  const csv=Buffer.from('voter_name,phone,dong\n'+Array.from({length:8},(_,i)=>'Fixture '+i+',0000000000'+i+',Test').join('\n'));
  await page.locator('#voter-import-mode').selectOption('append');await page.locator('#csv-file-input').setInputFiles({name:'eight.csv',mimeType:'text/csv',buffer:csv});
  await page.waitForFunction(()=>document.getElementById('upload-status').textContent.includes('서버 전체 8건'));
  assert.match(await page.locator('#voter-history-body').innerText(),/신규 4.*중복 4/);
  assert.equal(await page.evaluate(()=>window.__requests.find(r=>r.name==='easycall_import_voters').args.p_mode),'append');
  await page.evaluate(()=>window.__reject=true);await page.locator('#voter-import-mode').selectOption('replace');await page.locator('#csv-file-input').setInputFiles({name:'blocked.csv',mimeType:'text/csv',buffer:csv});
  await page.waitForFunction(()=>document.getElementById('upload-status').textContent.includes('업로드 실패'));
  assert.match(await page.locator('#voter-history-body').innerText(),/실패.*배정 중/);
  await page.evaluate(()=>{
   verifiedIdentity={role:'agent',uid:'a1',campId:'camp01',agentId:'agent01'};currentAgentId='agent01';localStorage.setItem('easycall_role','agent');
   campsList=[{campId:'camp01',name:'Fixture',tablets:15}];agentsList=[{campId:'camp01',agentId:'agent01',alias:'Fixture'}];campSettingsMap.camp01={nightLock:false,globalStopped:false,callTransport:'smartphone'};activeClaim=null;isEnterpriseRpcAvailable=true;
   window.__claims=0;window.__authorizations=0;window.__release=null;
   sbClient={rpc:async(name,args)=>{if(name==='easycall_claim_voter'){window.__claims++;return {data:[{voter_id:'fictional-voter',name:'Fixture',phone:'00000000000',last_result:'READY'}]};}if(name==='easycall_authorize_call')window.__authorizations++;if(name==='easycall_release_unstarted_claim')window.__release=args;return {data:null};}};
   initAgentView();
  });
  assert.equal(await page.evaluate(()=>window.__claims),0,'Login must not reserve a contact');
  await page.evaluate(()=>easycallPlaceCall(true));assert.equal(await page.evaluate(()=>window.__claims),1);assert.equal(await page.evaluate(()=>window.__authorizations),0,'Preparing must not dial');
  await page.evaluate(()=>handleLogout());assert.equal(await page.evaluate(()=>window.__release.p_voter_id),'fictional-voter');assert.equal(await page.evaluate(()=>window.__loggedOut),true);
  assert.deepEqual(errors,[]);console.log('PASS: replacement default, append totals, durable failure history, no login claim, prepare without dial, scoped logout release.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
