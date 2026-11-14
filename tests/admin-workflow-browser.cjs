// Functional browser checks only: all assets/services are fulfilled in memory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.resolve(process.execPath,'../../node_modules/playwright')));}
(async()=>{
 const root=path.resolve(__dirname,'..'),origin='http://localhost:49189',chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
 const browser=await chromium.launch(fs.existsSync(chrome)?{headless:true,executablePath:chrome}:{headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin===origin){const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep))return route.abort();let body=fs.readFileSync(file,'utf8');if(file.endsWith('.html'))body=body.replace('</head>','<style>.hidden{display:none!important}</style></head>');return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript',body});}
   return route.fulfill({contentType:'text/javascript',body:url.href.includes('supabase-js')?'window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null},error:{name:"AuthSessionMissingError"}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({})}})};':''});
  });
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof easycallExportLogs==='function'&&!document.body.classList.contains('auth-restoring'));
  await page.evaluate(()=>{
   document.getElementById('login-view').classList.add('hidden');document.getElementById('admin-view').classList.remove('hidden');
   verifiedIdentity={role:'admin',uid:'admin-test',campId:'camp01'};currentAdminId='camp01';localStorage.setItem('easycall_role','admin');
   campsList=[{campId:'camp01',name:'검증 캠프'}];agentsList=[];campSettingsMap.camp01={globalStopped:true};
   window.switchAdminTab('stats');
  });
  assert.deepEqual(await page.locator('.ec-admin-tabs button').allTextContents(),['현황','연락처','전화담당자','대본','통화기록','설정']);
  assert.equal(await page.locator('#btn-toggle-camp-call').isVisible(),true);
  await page.locator('#admin-tab-scripts-btn').click();await page.locator('#scenario-step-1').fill('메뉴를 옮겨도 남아 있어야 하는 대본');
  await page.locator('#admin-tab-contacts-btn').click();assert.equal(await page.locator('#csv-file-input').isVisible(),true);assert.equal(await page.locator('#scenario-step-1').isVisible(),false);
  await page.locator('#admin-tab-agents-btn').click();assert.equal(await page.locator('#btn-register-tablet').isVisible(),true);
  await page.locator('#admin-tab-config-btn').click();assert.equal(await page.locator('#allowed-start-time').isVisible(),true);assert.equal(await page.locator('#scenario-step-1').isVisible(),false);
  await page.locator('#admin-tab-scripts-btn').click();assert.equal(await page.locator('#scenario-step-1').inputValue(),'메뉴를 옮겨도 남아 있어야 하는 대본');
  // Dirty inputs must retain their original version after a background refresh.
  await page.evaluate(async()=>{
   stateRevisions.set('STATE_camp01','old');
   sbClient={rpc:async name=>({data:name==='easycall_read_state'?[{store_key:'MASTER_META',payload:{campsList:[{campId:'camp01'}],agentsList:[]},updated_at:'new'},{store_key:'STATE_camp01',payload:{config:{globalStopped:true}},updated_at:'new'}]:{items:[],total:0}})};
   window.easycallLoadLists=async()=>({voters:[],logs:[]});await pullStateFromSupabase();
  });
  assert.equal(await page.evaluate(()=>stateRevisions.get('STATE_camp01')),'old');
  await page.locator('#admin-tab-scripts-btn').press('ArrowRight');assert.equal(await page.locator('#admin-tab-logs-btn').getAttribute('aria-selected'),'true');
  await page.evaluate(()=>{
   window.exportRequests=[];window.exportBytes=[];window.exportClosed=false;window.exportAborted=false;
   window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async x=>window.exportBytes.push([...x]),close:async()=>window.exportClosed=true,abort:async()=>window.exportAborted=true})});
   sbClient={rpc:async(name,args)=>{window.exportRequests.push({name,args});return {data:{items:[{memo:'=1+1',voter_name:'홍길동'}],done:true,cursor:null,asOf:'2026-11-14T00:00:00Z'}};}};
  });
  await page.locator('#log-export-from').fill('2026-11-01');await page.locator('#log-export-through').fill('2026-11-14');
  await page.locator('button[onclick="exportCallLogsToCsv(\'POSITIVE_ONLY\')"]').click();
  await page.waitForFunction(()=>document.getElementById('log-export-status').textContent.includes('완료'));
  assert.equal(await page.evaluate(()=>window.exportClosed),true);
  assert.deepEqual(await page.evaluate(()=>window.exportRequests[0].args),{p_camp_id:'camp01',p_positive:true,p_from:'2026-11-01',p_through:'2026-11-14',p_cursor:null,p_as_of:null});
  assert.match(await page.evaluate(()=>new TextDecoder().decode(new Uint8Array(window.exportBytes.flat()))),/'=1\+1/);
  // The cancel button must abort an in-flight file, not publish a partial CSV.
  await page.evaluate(()=>{window.exportClosed=false;window.exportAborted=false;sbClient.rpc=()=>new Promise(resolve=>window.finishExport=resolve);});
  await page.locator('button[onclick="exportCallLogsToCsv(\'ALL\')"]').click();await page.waitForFunction(()=>typeof window.finishExport==='function');
  assert.equal(await page.locator('#log-export-from').isDisabled(),true);await page.locator('#log-export-cancel').click();
  await page.waitForFunction(()=>document.getElementById('log-export-status').textContent.includes('취소했습니다'));
  await page.evaluate(()=>window.finishExport({data:{items:[],done:true,asOf:'2026-11-14T00:00:00Z'}}));
  assert.equal(await page.evaluate(()=>window.exportClosed),false);assert.equal(await page.evaluate(()=>window.exportAborted),true);assert.equal(await page.locator('#log-export-from').isDisabled(),false);
  await page.evaluate(()=>{
   document.getElementById('admin-view').classList.add('hidden');document.getElementById('super-view').classList.remove('hidden');verifiedIdentity={role:'super',uid:'root'};localStorage.setItem('easycall_role','super');
   campsList=[{campId:'camp01',name:'검증 캠프',region:'서울 중구',candidate:'테스트',tablets:2,registeredCount:1,contractAmount:100000,paidAmount:30000,outstandingAmount:70000,approved:true,effectiveStatus:'ready'}];renderSuperCampsTable();
  });
  assert.equal(await page.locator('#super-camps-body [data-camp-action="approval"]').count(),0);
  assert.equal(await page.locator('#super-camps-body [data-camp-action="quota-up"]').count(),0);
  await page.locator('#super-camps-body button').filter({hasText:'상세 관리'}).click();
  assert.equal(await page.locator('#camp-detail-actions [data-camp-action="approval"]').isVisible(),true);
  assert.match(await page.locator('#camp-detail-actions').innerText(),/70,000/);
  await page.locator('[data-close-dialog="camp-edit-dialog"]').click();
  assert.deepEqual(errors,[]);console.log('PASS: six admin menus, retained edits and revision, keyboard navigation, export filters, CSV safety, cancellation and super administrator detail actions. All services mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
