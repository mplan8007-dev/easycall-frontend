const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
module.exports=function loadHandler(name,origin='https://easycall-frontend.vercel.app'){
 let handler,authCalls=0;
 let source=fs.readFileSync(path.join(__dirname,'../supabase/functions',name,'index.ts'),'utf8');
 source=source.replace(/^import .*;\r?\n/gm,'').replaceAll('https://easycall-frontend.vercel.app',origin);
 vm.runInNewContext(stripTypeScriptTypes(source),{
  Request,Response,Headers,URL,crypto,console,
  Deno:{serve(fn){handler=fn;},env:{get(){return 'isolated-test-value';}}},
  createClient(){return {auth:{getUser:async()=>{authCalls++;return {data:{user:null},error:{message:'unauthenticated'}};}}};}
 });
 return {handler,authCalls:()=>authCalls};
};
