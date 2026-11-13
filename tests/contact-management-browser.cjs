const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=String(body).replace('</head>','<style>.hidden{display:none!important}</style></head>');res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(body);}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync']});
 try{
  const page=await browser.newPage(),errors=[];let confirmDelete=false;page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='confirm'&&!confirmDelete?d.dismiss():d.accept());
  await page.route('**/*',r=>{const url=r.request().url();if(url.startsWith(origin))return r.continue();if(url.includes('supabase-js'))return r.fulfill({contentType:'text/javascript',body:"window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({})}})};"});return r.fulfill({contentType:'text/javascript',body:''});});
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof easycallLoadLists==='function'&&!document.body.classList.contains('auth-restoring'));
  await page.evaluate(async()=>{
   verifiedIdentity={role:'admin',uid:'fixture-admin',campId:'camp01'};currentAdminId='camp01';localStorage.setItem('easycall_role','admin');
   document.getElementById('login-view').classList.add('hidden');document.getElementById('admin-view').classList.remove('hidden');
   window.__rows=Array.from({length:4},(_,i)=>({voter_id:'v'+(i+1),camp_id:'camp01',name:i===0?'<img src=x>':'Fixture '+(i+1),phone:'0000000000'+(i+1),dong:'Test',last_result:i===2?'REJECT':'READY',last_memo:'Memo',updated_at:'2026-11-13T00:00:00.00000'+i+'Z',locked_by:i===3?'device1':null}));
   window.__requests=[];window.__stale=false;
   sbClient={rpc:async(name,args)=>{
    window.__requests.push({name,args});
    if(name==='easycall_admin_voter_page'){let rows=window.__rows.filter(r=>(!args.p_status||r.last_result===args.p_status)&&(!args.p_query||(r.name+' '+r.phone+' '+r.dong).includes(args.p_query)));return {data:{items:rows.slice(args.p_offset,args.p_offset+50),total:rows.length}};}
    if(name==='easycall_camp_counts')return {data:{voters:{total:window.__rows.length,ready:2,callback:0},logs:{total:0},groups:[],agents:[]}};
    if(name==='easycall_admin_update_voter'){if(window.__stale)return {error:{message:'다른 작업으로 변경된 연락처입니다. 목록을 새로고침하세요.'}};const r=window.__rows.find(r=>r.voter_id===args.p_voter_id);Object.assign(r,{...args.p_patch,last_memo:args.p_patch.memo,updated_at:'2026-11-13T01:00:00Z'});return {data:{success:true,updated:1}};}
    if(name==='easycall_admin_delete_voters'){window.__rows=window.__rows.filter(r=>!args.p_rows.some(x=>x.voter_id===r.voter_id));return {data:{success:true,deleted:args.p_rows.length}};}
    return {data:{items:[],total:0}};
   }};
   await easycallLoadLists('camp01');
  });
  const rows=page.locator('#admin-voters-tbody tr');
  assert.equal(await rows.count(),4);assert.equal(await page.locator('#admin-voters-tbody img').count(),0);
  assert.equal(await rows.nth(3).getByRole('button',{name:'수정',exact:true}).isDisabled(),true);
  await rows.nth(0).getByRole('button',{name:'수정',exact:true}).click();await page.locator('#contact-edit-phone').fill('bad');await page.locator('#contact-edit-save').click();assert.match(await page.locator('#contact-edit-error').innerText(),/전화번호/);assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.name==='easycall_admin_update_voter').length),0);
  await page.locator('#contact-edit-phone').fill('000-0000-0011');await page.locator('#contact-edit-name').fill('Edited');await page.locator('#contact-edit-memo').fill('Updated memo');await page.locator('#contact-edit-save').click();
  await page.waitForFunction(()=>document.getElementById('admin-voters-result').textContent.includes('1건 수정'));assert.equal(await page.locator('#contact-editor').isVisible(),false);assert.match(await rows.nth(0).innerText(),/Edited.*00000000011/);
  assert.equal(await page.evaluate(()=>window.__requests.find(r=>r.name==='easycall_admin_update_voter').args.p_expected_updated_at),'2026-11-13T00:00:00.000000Z');
  await page.evaluate(()=>window.__stale=true);await rows.nth(1).getByRole('button',{name:'수정',exact:true}).click();await page.locator('#contact-edit-save').click();await page.waitForFunction(()=>document.getElementById('contact-edit-error').textContent.includes('변경된 연락처'));assert.equal(await page.locator('#contact-editor').isVisible(),true);await page.locator('#contact-edit-cancel').click();
  await page.locator('#admin-voter-status').selectOption('REJECT');await page.waitForFunction(()=>document.querySelectorAll('#admin-voters-tbody tr').length===1);assert.match(await rows.nth(0).innerText(),/수신거부/);
  await page.locator('#admin-voter-status').selectOption('');await page.waitForFunction(()=>document.querySelectorAll('#admin-voters-tbody tr').length===4);
  await page.locator('#admin-voter-search').fill('Edited');await page.waitForFunction(()=>document.querySelectorAll('#admin-voters-tbody tr').length===1);assert.match(await rows.nth(0).innerText(),/Edited/);
  await page.locator('#admin-voter-search').fill('');await page.waitForFunction(()=>document.querySelectorAll('#admin-voters-tbody tr').length===4);
  await rows.nth(2).getByRole('button',{name:'삭제',exact:true}).click();assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.name==='easycall_admin_delete_voters').length),0,'Cancel must not delete');
  confirmDelete=true;await rows.nth(2).getByRole('button',{name:'삭제',exact:true}).click();await page.waitForFunction(()=>document.getElementById('admin-voters-result').textContent.includes('1건 삭제'));
  await page.locator('#admin-voters-select-all').check();assert.match(await page.locator('#admin-voters-selected').innerText(),/^2건/);
  await page.locator('#admin-voters-delete-selected').click();await page.waitForFunction(()=>document.getElementById('admin-voters-result').textContent.includes('2건 삭제'));await page.waitForFunction(()=>document.querySelectorAll('#admin-voters-tbody tr').length===1);
  assert.match(await rows.nth(0).innerText(),/배정 중/);assert.equal(await page.locator('#admin-voters-delete-selected').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('PASS: escaped contact rows, edit dialog/validation, normalized phone, optimistic revision, visible conflict, server search/status filter, delete cancellation, single/selected delete and active-row protection. External services mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
