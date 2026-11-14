// Run an existing browser fixture without sending requests to a local HTTP port.
// The fixture's original request handler still renders every HTML/JS/CSS response.
// Usage: node tests/browser-memory-runner.cjs tests/new-camp-call-browser.cjs
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.resolve(process.argv[2]||'');
if(path.dirname(file)!==__dirname||!file.endsWith('-browser.cjs'))throw Error('A browser fixture in tests/ is required.');
let source=fs.readFileSync(file,'utf8');
const memory=route=>"(()=>new Promise((resolve,reject)=>{const u=new URL("+route+".request().url());let status=200;const headers={};try{server.emit('request',{url:u.pathname+u.search},{setHeader(k,v){headers[k]=v;},writeHead(code){status=code;return this;},end(body=''){resolve("+route+".fulfill({status,headers,body}));return this;}});}catch(e){reject(e);}}))()";
source=source.replace(/\b(route|r)\.continue\(\)/g,(_,route)=>memory(route));
let playwright;
try{playwright=require.resolve('playwright');}catch{playwright=path.resolve(process.execPath,'../../node_modules/playwright');}
source=source.replaceAll("require('playwright')",'require('+JSON.stringify(playwright)+')');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
if(fs.existsSync(chrome))source=source.replace('chromium.launch({headless:true,args:',"chromium.launch({executablePath:"+JSON.stringify(chrome)+",headless:true,args:");
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(path.dirname(file));fixture._compile(source,file);
