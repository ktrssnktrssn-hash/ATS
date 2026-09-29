const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'lib/api.js'),'utf8');
const user={id:'user-a',email:'admin@example.invalid',tenant_id:'tenant-a',name:'Admin',role:'admin',is_active:true};
function storage(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};}
function context(fetch){const ctx={fetch,localStorage:storage(),sessionStorage:storage(),window:{location:{pathname:'/list.html'},addEventListener(){}},document:{getElementById(){return null;}},console,URLSearchParams,crypto:require('node:crypto').webcrypto};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;}
const ok=data=>new Response(JSON.stringify(data),{status:200});
const run=(ctx,s)=>vm.runInContext(s,ctx);
test('login uses cookie server and never stores tokens',async()=>{
 const ctx=context(async()=>ok({user}));assert.equal((await run(ctx,'atsApi.login("a","b")')).success,true);
 assert.equal(run(ctx,'getCurrentUser().role'),'admin');assert.equal(ctx.localStorage.getItem('ats_edxfhpdyxlenkrxsnirb_token'),null);
});
test('local admin forgery cannot establish a server session',async()=>{
 const ctx=context(async()=>new Response('{"error":"ログインし直してください"}',{status:401}));
 ctx.localStorage.setItem('ats_edxfhpdyxlenkrxsnirb_user',JSON.stringify(user));
 await assert.rejects(run(ctx,'atsApi.validateSession()'));assert.equal(run(ctx,'getCurrentUser()'),null);
});
test('failed logout is reported instead of pretending the HttpOnly session was cleared',async()=>{
 const ctx=context(async()=>{throw Error('offline')});await assert.rejects(run(ctx,'atsApi.logout()'),/offline/);
});
test('proxy requests send custom CSRF header and no Authorization',async()=>{
 let options;const ctx=context(async(u,o)=>{options=o;return ok([])});await run(ctx,'sb.query("jobs")');
 assert.equal(options.credentials,'same-origin');assert.equal(options.headers['X-ATS-Request'],'1');assert.equal(options.headers.Authorization,undefined);
});
test('writes with no updated row and failed mail reject',async()=>{
 const ctx=context(async url=>url==='/api/auth/session'?ok({user}):url.includes('/functions/')?new Response('{"error":"未完了"}',{status:503}):ok([]));
 await run(ctx,'atsApi.validateSession()');await assert.rejects(run(ctx,'atsApi.updateApplicant("a",{name:"b"})'));await assert.rejects(run(ctx,'atsApi.sendMail("a","t")'),/未完了/);
});
test('all embedded page scripts parse',()=>{
 for(const file of ['index.html','list.html','detail.html']){const html=fs.readFileSync(path.join(root,file),'utf8');for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1],{filename:file});}
});
test('CSP hashes match inline scripts and forbid unapproved script, form and network destinations',()=>{
 const {createHash}=require('node:crypto');
 for(const file of ['index.html','list.html','detail.html']){
  const html=fs.readFileSync(path.join(root,file),'utf8');const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.ok(policy.includes("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"));
  assert.match(policy,/form-action 'none'/);assert.match(policy,/base-uri 'none'/);assert.match(policy,/script-src-attr 'none'/);
  const scripts=policy.split(';').find(x=>x.trim().startsWith('script-src '));assert.ok(!scripts.includes('unsafe-inline')&&!scripts.includes('unsafe-eval'));
 }
});
