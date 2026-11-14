const http=require('node:http'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.resolve(process.execPath,'../../node_modules/playwright')));}
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
(async()=>{
 const pageServer=http.createServer((req,res)=>res.end('<!doctype html><title>CORS test</title>'));
 await listen(pageServer);const origin='http://127.0.0.1:'+pageServer.address().port;
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
 const browser=await chromium.launch(fs.existsSync(chrome)?{headless:true,executablePath:chrome}:{headless:true});
 try{
  for(const name of ['easycall-work-accounts','easycall-admin-invite']){
   const fixture=require('./edge-cors-handler.cjs')(name,origin),requests=[];
   const api=http.createServer(async(req,res)=>{
    requests.push(req.method);const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const r=await fixture.handler(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
    res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
   });
   await listen(api);const page=await browser.newPage();
   try{
    await page.goto(origin);
    const result=await page.evaluate(async url=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-easycall-session':'fixture-session','authorization':'Bearer fixture','apikey':'fixture','x-client-info':'fixture'},body:'{}'});return {status:r.status,body:await r.json()};},'http://127.0.0.1:'+api.address().port);
    assert.ok([401,403].includes(result.status));assert.equal(typeof result.body.error,'string');
    assert.deepEqual(requests,['OPTIONS','POST']);assert.equal(fixture.authCalls(),1);
   }finally{await page.close();await new Promise(r=>api.close(r));}
  }
  console.log('PASS: Chromium preflights the real Edge handlers with the application session header; unauthenticated POST remains denied. No production requests.');
 }finally{await browser.close();await new Promise(r=>pageServer.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
