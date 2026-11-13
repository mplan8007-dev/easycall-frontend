const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
 const css=source.match(/<style id="auth-startup-style">[\s\S]*?<\/style>/)[0];
 const boot=source.slice(source.indexOf('    window.onload = async function() {'),source.indexOf('\n    function fillDemoLogin'));
 const bodyClass=source.match(/<body class="([^"]+)"/)[1];
 const server=http.createServer((req,res)=>{
  const scenario=new URL(req.url,'http://localhost').searchParams.get('case')||'admin';
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end('<!doctype html><html><head>'+css+'<style>.hidden{display:none!important}</style></head><body class="'+bodyClass+'"><div id="auth-startup" role="status">로그인 상태 확인</div><div id="login-view">LOGIN<p id="login-error"></p></div><div id="super-view" class="hidden">SUPER</div><div id="admin-view" class="hidden">ADMIN</div><div id="agent-view" class="hidden">AGENT</div><div id="challenge" class="hidden" role="dialog">인증 확인</div><script>let verifiedIdentity=null;let sbClient={auth:{getUser:()=>new Promise((resolve,reject)=>{window.__resolveUser=resolve;window.__rejectUser=reject;})}};async function initSupabaseEngine(){} async function activateVerifiedUser(user){if(user.challenge){document.getElementById("challenge").classList.remove("hidden");return;}await new Promise((resolve,reject)=>{window.__activate=resolve;window.__rejectActivation=reject;});verifiedIdentity={role:user.role};document.getElementById(user.role+"-view").classList.remove("hidden");}window.__loginPaints=0;function observe(){if(document.body.classList.contains("auth-restoring")&&getComputedStyle(document.getElementById("login-view")).display!=="none")window.__loginPaints++;requestAnimationFrame(observe);}requestAnimationFrame(observe);'+boot+'</script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync']});
 try{
  const page=await browser.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  async function pending(){await page.waitForFunction(()=>typeof window.__resolveUser==='function');assert.equal(await page.locator('#login-view').isVisible(),false);assert.equal(await page.locator('#auth-startup').isVisible(),true);}
  async function finish(){await page.waitForFunction(()=>!document.body.classList.contains('auth-restoring'));assert.equal(await page.locator('#auth-startup').isVisible(),false);assert.equal(await page.evaluate(()=>window.__loginPaints),0);}
  for(const role of ['super','admin','agent']){
   await page.goto(origin+'/?case='+role);
   for(let pass=0;pass<2;pass++){
    if(pass)await page.reload();
    await pending();await page.evaluate(role=>window.__resolveUser({data:{user:{role}}}),role);
    await page.waitForFunction(()=>typeof window.__activate==='function');
    assert.equal(await page.locator('#login-view').isVisible(),false);assert.equal(await page.locator('#'+role+'-view').isVisible(),false);
    await page.evaluate(()=>window.__activate());await finish();
    assert.equal(await page.locator('#'+role+'-view').isVisible(),true);assert.equal(await page.locator('#login-view').isVisible(),false);
   }
  }
  await page.goto(origin+'/?case=signedout');await pending();await page.evaluate(()=>window.__resolveUser({data:{user:null}}));await finish();assert.equal(await page.locator('#login-view').isVisible(),true);
  await page.reload();await pending();await page.evaluate(()=>window.__rejectUser(Error('offline')));await finish();assert.match(await page.locator('#login-error').innerText(),/확인하지 못했습니다/);assert.equal(await page.locator('#login-view').isVisible(),true);
  await page.reload();await pending();await page.evaluate(()=>window.__resolveUser({data:{user:{role:'admin'}}}));await page.waitForFunction(()=>typeof window.__rejectActivation==='function');await page.evaluate(()=>window.__rejectActivation(Error('permission unavailable')));await finish();assert.equal(await page.locator('#admin-view').isVisible(),false);assert.equal(await page.locator('#login-view').isVisible(),true);
  await page.reload();await pending();await page.evaluate(()=>window.__resolveUser({data:{user:{challenge:true}}}));await finish();assert.equal(await page.locator('#challenge').isVisible(),true);assert.equal(await page.locator('#login-view').isVisible(),false);
  console.log('PASS: first-paint and repeated refresh gates for all three roles, delayed auth/activation, signed-out, network/activation failure and pending authentication dialog. Production startup code, external services mocked.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
