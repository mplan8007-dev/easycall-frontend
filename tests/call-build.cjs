const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const dir=path.resolve(__dirname,'../dist/assets'),files=fs.readdirSync(dir);
const sip=files.find(f=>f.startsWith('sip-0.21.2.min-')&&f.endsWith('.js')),license=files.find(f=>f.startsWith('SIP.js-LICENSE-')&&f.endsWith('.md'));
assert.ok(sip,'Production SIP UMD asset must be emitted');assert.ok(license,'SIP license must ship with production');
const sandbox={setTimeout,clearTimeout,console,TextEncoder,TextDecoder,URL};
vm.runInNewContext(fs.readFileSync(path.join(dir,sip),'utf8'),sandbox);assert.equal(typeof sandbox.SIP.Web.SimpleUser,'function');
const bundle=files.filter(f=>f.endsWith('.js')&&f!==sip).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
assert.ok(bundle.includes(sip));assert.ok(bundle.includes('phone-policy-open'));assert.ok(bundle.includes('easycall_call_transport_set'));assert.ok(bundle.includes(license));
console.log('PASS: production build contains a loadable official SIP bundle, its license and super-only transport UI.');
