const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const dir=path.resolve(__dirname,'../dist/assets'),files=fs.readdirSync(dir);
const sip=files.find(f=>f.startsWith('sip-0.21.2.min-')&&f.endsWith('.js')),license=files.find(f=>f.startsWith('SIP.js-LICENSE-')&&f.endsWith('.md'));
assert.ok(sip,'Production SIP UMD asset must be emitted');
const sandbox={setTimeout,clearTimeout,console,TextEncoder,TextDecoder,URL};
vm.runInNewContext(fs.readFileSync(path.join(dir,sip),'utf8'),sandbox);assert.equal(typeof sandbox.SIP.Web.SimpleUser,'function');
const bundle=files.filter(f=>f.endsWith('.js')&&f!==sip).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
const inlineLicense=Buffer.from(fs.readFileSync(path.resolve(__dirname,'../vendor/SIP.js-LICENSE.md'))).toString('base64');
assert.ok(license||bundle.includes(inlineLicense),'SIP license must ship as an emitted file or an embedded asset');
assert.ok(bundle.includes(sip));assert.ok(bundle.includes('phone-policy-open'));assert.ok(bundle.includes('easycall_call_transport_set'));if(license)assert.ok(bundle.includes(license));
console.log('PASS: production build contains a loadable official SIP bundle, its license and super-only transport UI.');

const css=files.filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
assert.ok(css.includes('.ec-jump-nav')&&css.includes('.ec-responsive-table'),'Responsive layouts must be emitted into the production stylesheet');


