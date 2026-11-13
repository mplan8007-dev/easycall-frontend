const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.resolve(process.execPath,'../../node_modules/playwright')));}
(async()=>{
 const root=path.resolve(__dirname,'..'),shots=path.join(__dirname,'responsive-shots');fs.mkdirSync(shots,{recursive:true});
 assert.ok(fs.existsSync(path.join(__dirname,'responsive-generated.css')),'Compile the test Tailwind baseline before layout checks.');
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{let body=fs.readFileSync(file);const ext=path.extname(file);res.setHeader('Content-Type',ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'text/javascript; charset=utf-8');if(ext==='.html')body=String(body).replace('<style>','<link rel="stylesheet" href="/tests/responsive-generated.css"><style>');res.end(body);}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync']});
 try{
  const page=await browser.newPage(),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin))return route.continue();network.push(u);if(u.includes('supabase-js'))return route.fulfill({contentType:'text/javascript',body:`window.__mockAuth={getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({})};window.supabase={createClient:()=>({auth:window.__mockAuth})};`});return route.fulfill({contentType:u.includes('.css')?'text/css':'text/javascript',body:''});});
  const sizes=[[320,568],[390,844],[768,1024],[1024,768],[1440,900],[844,390]];
  async function screenshot(name){await page.screenshot({path:path.join(shots,name+'.png'),fullPage:false});}
  async function noOverflow(label){
   const result=await page.evaluate(()=>{
    const w=document.documentElement.clientWidth;const nodes=Array.from(document.querySelectorAll('button,input,select,textarea,nav,h1,h2,[role="dialog"]>div')).filter(e=>{if(!e.getClientRects().length)return false;const scroll=e.closest('.ec-table-scroll');return !(w>=640&&scroll&&scroll.scrollWidth>scroll.clientWidth+1);});
    return {doc:document.documentElement.scrollWidth,width:w,outside:nodes.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left< -1||r.right>w+1);}).slice(0,10).map(e=>({id:e.id,tag:e.tagName,text:e.textContent.slice(0,50),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))};
   });if(result.doc>result.width+1||result.outside.length)await screenshot('failure-'+label.replace(/[^a-zA-Z0-9-]/g,'-'));assert.ok(result.doc<=result.width+1,label+' document overflow '+JSON.stringify(result));assert.deepEqual(result.outside,[],label+' controls outside viewport');
  }
  for(const [width,height] of sizes){
   await page.setViewportSize({width,height});await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof window.openAgentAccounts==='function'&&document.querySelector('#phone-agent'));
   await noOverflow('login '+width+'x'+height);if(width===390)await screenshot('login-phone');
   await page.evaluate(()=>{
    document.getElementById('login-view').classList.add('hidden');document.getElementById('agent-view').classList.remove('hidden');
    verifiedIdentity={role:'agent',uid:'test',campId:'camp01',agentId:'agent01'};currentAgentId='agent01';localStorage.setItem('easycall_role','agent');
    campsList=[{campId:'camp01',name:'반응형 검증 캠프',tablets:15}];agentsList=[{campId:'camp01',agentId:'agent01',alias:'테스트 홍보요원'}];campSettingsMap.camp01={nightLock:false,callTransport:'smartphone',dialMode:'manual'};
    document.getElementById('voter-name').textContent='화면 테스트 홍보 대상';document.getElementById('voter-phone').textContent='010-1234-5678';
    document.getElementById('agent-header-device-badge').textContent='테스트 홍보요원 · 010-1234-5678';
    refreshActiveRoleUI();
   });
   await noOverflow('agent '+width+'x'+height);
   if(width<1200||height<=740){
    const rects=await page.evaluate(()=>({a:document.getElementById('ec-call-panel').getBoundingClientRect().toJSON(),b:document.getElementById('ec-result-panel').getBoundingClientRect().toJSON()}));
    assert.ok(rects.b.top>=rects.a.bottom-1,'Call/result panels must stack');
    await page.locator('.ec-jump-nav a[href="#ec-result-panel"]').click();await page.locator('#memo-input').fill('입력한 메모가 화면 회전 후에도 유지됩니다.');
    await page.locator('#btn-status-SUPPORT').click();
    const save=await page.locator('#btn-save-next').boundingBox();assert.ok(save.height>=44);
    if(width===390)await screenshot('agent-result-phone');
    await page.locator('.ec-jump-nav a[href="#ec-call-panel"]').click();if(width===390||width===768)await screenshot('agent-call-'+width);
    await page.setViewportSize({width:height,height:width});assert.equal(await page.locator('#memo-input').inputValue(),'입력한 메모가 화면 회전 후에도 유지됩니다.');await page.setViewportSize({width,height});
   }else{
    const r=await page.evaluate(()=>[document.getElementById('ec-call-panel').getBoundingClientRect().top,document.getElementById('ec-result-panel').getBoundingClientRect().top]);assert.ok(Math.abs(r[0]-r[1])<2);
   }
   await page.evaluate(()=>{
    document.getElementById('agent-view').classList.add('hidden');document.getElementById('admin-view').classList.remove('hidden');verifiedIdentity={role:'admin',uid:'manager',campId:'camp01'};currentAdminId='camp01';localStorage.setItem('easycall_role','admin');renderStatsAndCharts=()=>{};renderAdminLogsTable=()=>{};refreshActiveRoleUI();
   });
   await page.evaluate(async()=>{
    window.__listRequests=[];sbClient={rpc:async(name,args)=>{window.__listRequests.push({name,args});return {data:name==='easycall_camp_counts'?{voters:{total:4,ready:4,callback:0},logs:{total:0},groups:[],agents:[]}:{items:Array.from({length:4},(_,i)=>({voter_id:'fixture-'+i,camp_id:'camp01',name:'명부 검증 '+(i+1),phone:'0000000000'+i,dong:'검증 지역',last_result:'READY',last_memo:''})),total:4}}}};
    await easycallLoadLists('camp01');
   });
   assert.equal(await page.locator('#admin-voters-tbody tr').count(),4);
   assert.match(await page.locator('#admin-voters-page').innerText(),/4건/);
   await page.locator('#admin-voter-search').fill('검증');
   await page.waitForFunction(()=>window.__listRequests.some(r=>r.name==='easycall_list_page'&&r.args.p_query==='검증'));
   if(width===390){await page.locator('#admin-voter-list').scrollIntoViewIfNeeded();await screenshot('admin-voter-list-phone');await page.evaluate(()=>document.getElementById('admin-view').scrollTo(0,0));}
   await noOverflow('admin '+width+'x'+height);if(width===390)await screenshot('admin-phone');
   await page.evaluate(()=>{
    document.getElementById('admin-view').classList.add('hidden');document.getElementById('super-view').classList.remove('hidden');verifiedIdentity={role:'super',uid:'root'};localStorage.setItem('easycall_role','super');
    campsList=[{campId:'camp01',name:'반응형 캠프',candidate:'테스트 후보',region:'서울특별시 중구',party:'무소속',electionStage:'본선',electionType:'국회의원',staff:'테스트 담당자',manager:'테스트 관리자',tablets:15,registeredCount:1,voterCount:100,callCount:1,effectiveStatus:'ready',adminLoginId:'manager01',contractAmount:1000000,paidAmount:0}];renderSuperCampsTable();
   });
   await page.waitForFunction(()=>document.querySelector('#super-camps-body td[data-label]'));
   await noOverflow('super '+width+'x'+height);
   if(width<640){assert.equal(await page.locator('#super-camps-body tr').first().evaluate(e=>getComputedStyle(e).display),'grid');assert.ok(await page.locator('#super-camps-body td[data-label]').count()>0);}
   if(width===390)await screenshot('super-phone');
   await page.evaluate(()=>{
    verifiedIdentity={role:'admin',uid:'manager',campId:'camp01'};sbClient={rpc:async()=>({data:{campId:'camp01',limit:15,registered:1,remaining:14,reservedIds:['agent01'],accounts:[{loginId:'agent01',name:'테스트 홍보요원',phone:'01012345678',hasAccount:false,status:'unissued'}]}}),functions:{invoke:async()=>({data:{state:{configured:true,ready:true,version:'test',total:0,done:0,pending:0,processing:0,failed:0}}})}};return openAgentAccounts();
   });
   await noOverflow('agent accounts '+width+'x'+height);if(width===390)await screenshot('accounts-phone');
   await page.locator('#ga-single').click();await page.locator('#ga-single-name').fill('작성 중 이름');await noOverflow('single modal '+width+'x'+height);assert.equal(await page.locator('#ga-single-name').inputValue(),'작성 중 이름');
   await page.locator('#ga-close').click();
  }
  assert.deepEqual(errors,[]);console.log('PASS: six phone/tablet/desktop sizes, role pages, mobile table cards, account dialogs, touch targets, panel navigation and rotation draft preservation. All external page requests mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
