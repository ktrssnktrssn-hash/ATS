const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'lib/api.js'),'utf8');
const user={id:'user-a',email:'admin@example.invalid',tenant_id:'tenant-a',name:'Admin',role:'admin',is_active:true};
function storage(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};}
function context(fetch){const ctx={fetch,localStorage:storage(),sessionStorage:storage(),window:{location:{},addEventListener(){}},document:{getElementById(){return null;}},console,URLSearchParams,crypto:require('node:crypto').webcrypto};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;}
const ok=data=>new Response(JSON.stringify(data),{status:200});
const run=(ctx,s)=>vm.runInContext(s,ctx);
test('old project sessions ignored and unprovisioned login rejected',async()=>{
 const ctx=context(async url=>url.includes('/token?')?ok({access_token:'new',refresh_token:'refresh',user}):url.includes('/auth/v1/user')?ok(user):ok([]));
 ctx.localStorage.setItem('ats_token','old');assert.equal(run(ctx,'getToken()'),'');
 const result=await run(ctx,'atsApi.login("admin@example.invalid","test")');assert.match(result.error,/利用権限/);assert.equal(run(ctx,'getToken()'),'');
});
test('login stores active server profile and logout clears local credentials on network failure',async()=>{
 const ctx=context(async url=>{if(url.endsWith('/logout'))throw Error('network');return url.includes('/token?')?ok({access_token:'new',refresh_token:'refresh',user}):url.includes('/auth/v1/user')?ok(user):ok([user]);});
 assert.equal((await run(ctx,'atsApi.login("a","b")')).success,true);assert.equal(run(ctx,'getCurrentUser().tenant_id'),'tenant-a');await run(ctx,'atsApi.logout()');assert.equal(run(ctx,'getToken()'),'');
});
test('failed and zero-row writes reject; failed mail never returns success',async()=>{
 const ctx=context(async url=>url.includes('/functions/')?new Response('{"error":"メール送信設定が未完了です"}',{status:503}):ok([]));
 run(ctx,'localStorage.setItem(SESSION_KEYS.user,JSON.stringify({id:"user-a"}))');
 await assert.rejects(run(ctx,'atsApi.updateApplicant("a",{name:"b"})'),/更新できません/);
 await assert.rejects(run(ctx,'atsApi.sendMail("a","t")'),/未完了/);
});
test('concurrent expired requests share one refresh',async()=>{
 let refreshes=0;const ctx=context(async(url,options)=>{
  if(url.includes('grant_type=refresh_token')){refreshes++;await new Promise(r=>setTimeout(r,10));return ok({access_token:'fresh',refresh_token:'next'});}
  return options.headers.Authorization==='Bearer fresh'?ok([]):new Response('{}',{status:401});
 });run(ctx,'localStorage.setItem(SESSION_KEYS.token,"expired");localStorage.setItem(SESSION_KEYS.refresh,"refresh")');
 await Promise.all([run(ctx,'sb.query("jobs")'),run(ctx,'sb.query("tags")')]);assert.equal(refreshes,1);
});
test('mail retry retains idempotency key and sends IDs, not arbitrary recipient/body',async()=>{
 const calls=[];let attempts=0;const ctx=context(async(url,options)=>{calls.push(JSON.parse(options.body));return ++attempts===1?new Response('{"error":"retry"}',{status:502}):ok({success:true});});
 run(ctx,'localStorage.setItem(SESSION_KEYS.user,JSON.stringify({id:"user-a"}))');
 await assert.rejects(run(ctx,'atsApi.sendMail("candidate","template")'));
 await run(ctx,'atsApi.sendMail("candidate","template")');assert.equal(calls[0].request_key,calls[1].request_key);assert.deepEqual(Object.keys(calls[0]).sort(),['applicant_id','request_key','template_id']);
});
test('upload returns a file object with tenant-isolated path',async()=>{
 const calls=[];const ctx=context(async(url,options)=>{calls.push({url,options});return url.includes('/storage/')?ok({Key:'stored'}):ok([{id:'file-1'}]);});
 run(ctx,'localStorage.setItem(SESSION_KEYS.user,JSON.stringify({id:"user-a",tenant_id:"tenant-a"}))');
 const file=await run(ctx,'atsApi.uploadFile("candidate-a",{name:"履歴書.pdf",type:"application/pdf",size:100})');assert.equal(file.id,'file-1');assert.match(calls[0].url,/applicant-files\/tenant-a\/candidate-a\//);
});
test('all embedded page scripts parse',()=>{
 for(const file of ['index.html','list.html','detail.html']){const html=fs.readFileSync(path.join(root,file),'utf8');for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1],{filename:file});}
});
test('forged local token and admin profile do not pass server validation',async()=>{
 const ctx=context(async()=>new Response('{"error":"invalid JWT"}',{status:401}));
 run(ctx,'localStorage.setItem(SESSION_KEYS.token,"forged");localStorage.setItem(SESSION_KEYS.user,JSON.stringify({id:"fake",role:"admin",is_active:true}))');
 await assert.rejects(run(ctx,'atsApi.validateSession()'),/ログインし直/);assert.equal(run(ctx,'getToken()'),'');
});
test('server profile replaces tampered local admin role',async()=>{
 const interviewer={...user,role:'interviewer'};
 const ctx=context(async url=>url.includes('/auth/')?ok(user):ok([interviewer]));
 run(ctx,'localStorage.setItem(SESSION_KEYS.token,"valid");localStorage.setItem(SESSION_KEYS.user,JSON.stringify({role:"admin"}))');
 await run(ctx,'atsApi.validateSession()');assert.equal(run(ctx,'getCurrentUser().role'),'interviewer');
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
