// Run with Playwright installed: node tests/browser-smoke.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.resolve(process.execPath,'../../node_modules/playwright'))); }
(async () => {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch(fs.existsSync(chrome) ? {executablePath:chrome,headless:true} : {headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  // No real credentials, database changes, calls or SMS are made by this test.
  await page.route('**/*', async route => {
    const url=route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null},error:null})}})};`});
    if (url.startsWith('file:')) return route.continue();
    return route.fulfill({contentType:route.request().resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
  });
  await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>typeof window.onload==='function');
  assert.equal(await page.locator('#login-pw').inputValue(),'');
  for (const role of ['super','admin','agent']) {
    await page.evaluate(async role => {
      verifiedIdentity={role,campId:'camp01',agentId:'tab01'};
      localStorage.setItem('easycall_role',role);
      campsList=[{campId:'camp01',name:'Test',approved:true,tablets:15,period:'2026-01-01 ~ 2026-12-31'}];
      agentsList=[{campId:'camp01',agentId:'tab01',alias:'Tester',assignedPhone:'01012345678'}];
      votersList=[];globalCampCallLogs=[];campSettingsMap={};currentAgentId='tab01';currentAdminId='camp01';
      sbClient={rpc:async()=>({data:[],error:null})};isEnterpriseRpcAvailable=true;
      if(role==='super')initSuperView();else if(role==='admin')initAdminView();else initAgentView();
      await new Promise(resolve=>setTimeout(resolve,20));
    },role);
  }
  await page.evaluate(()=>{
    votersList=[{id:'1',campId:'camp01',name:'<img src=x onerror="window.injected=true">',phone:'01012345678',dong:'x',lastResult:'READY',lastMemo:'<svg onload="window.injected=true">'}];
    renderAgentSearchTable();
  });
  assert.equal(await page.locator('#agent-search-voters-tbody img, #agent-search-voters-tbody svg').count(),0);
  assert.equal(await page.evaluate(()=>Boolean(window.injected)),false);
  assert.deepEqual(errors,[]);
  console.log('Browser smoke passed: login, three role views, empty queue, escaped imported content. External services mocked; visual layout not rendered with CDN CSS.');
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
