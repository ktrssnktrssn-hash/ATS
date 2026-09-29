const {test}=require('node:test');const assert=require('node:assert/strict');const {createApp}=require('../server/app.cjs');
async function fixture(){
 let time=Date.now(),active=true,refreshes=0,requests=[];
 const user={id:'user-a',role:'admin',tenant_id:'tenant-a',is_active:true,name:'Admin'};
 const server=createApp({origin:'https://ats.example',supabaseUrl:'https://test.supabase.co',publishableKey:'sb_publishable_test',now:()=>time,fetchImpl:async(url,options)=>{
  requests.push({url,options});
  if(url.includes('grant_type=refresh_token')){refreshes++;await new Promise(r=>setTimeout(r,15));return Response.json({access_token:'renewed-secret',refresh_token:'renewed-refresh',expires_in:3600});}
  if(url.includes('grant_type=password'))return Response.json({access_token:'upstream-secret',refresh_token:'refresh-secret',expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:user.id});
  if(url.includes('/profiles?'))return Response.json([{...user,is_active:active}]);
  if(url.includes('/logout'))return new Response(null,{status:204});
  return Response.json([{id:'candidate-a'}]);
 }});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function req(p,options={}){return new Promise((resolve,reject)=>{
 const request=require('node:http').request(base+p,{method:options.method||'GET',headers:{Host:'ats.example','X-ATS-Request':'1',Origin:'https://ats.example',...options.headers}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:r.statusCode,headers:Object.fromEntries(Object.entries(r.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))})));});request.on('error',reject);request.end(options.body);
 });}
 async function login(){const r=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.invalid',password:'test-only'})});return {r,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 return {req,login,requests,setActive:v=>active=v,advance:v=>time+=v,refreshes:()=>refreshes,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
test('server sends opaque HttpOnly Secure cookie, no tokens, cache prevention and framing defenses',async()=>{
 const f=await fixture();try{const {r,cookie}=await f.login();assert.equal(r.status,200);const c=r.headers.get('set-cookie');assert.match(c,/__Host-ats_session=/);assert.match(c,/HttpOnly/);assert.match(c,/Secure/);assert.match(c,/SameSite=Strict/);assert.ok(!c.includes('upstream-secret'));assert.equal((await r.json()).access_token,undefined);
 const page=await f.req('/');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('x-content-type-options'),'nosniff');assert.match(page.headers.get('cache-control'),/no-store/);
 const data=await f.req('/api/supabase/rest/v1/applicants',{headers:{Cookie:cookie,Authorization:'Bearer attacker'}});assert.equal(data.status,200);assert.equal(f.requests.at(-1).options.headers.Authorization,'Bearer upstream-secret');
 }finally{await f.close();}
});
test('no session, forged cookies, cross-origin and missing custom headers are rejected',async()=>{
 const f=await fixture();try{
 assert.equal((await f.req('/api/auth/session')).status,401);
 assert.equal((await f.req('/api/auth/session',{headers:{Cookie:'__Host-ats_session=forged'}})).status,401);
 const {cookie}=await f.login();
 for(const headers of [{Origin:'https://evil.example'},{'X-ATS-Request':''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.req('/api/auth/logout',{method:'POST',headers:{Cookie:cookie,...headers}})).status,403);
 assert.equal((await f.req('/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
 }finally{await f.close();}
});
test('only public app files and approved proxy routes are served',async()=>{
 const f=await fixture();try{for(const p of ['/db/ats_schema.sql','/docs/SETUP.md','/server/app.cjs','/package.json','/.env','/tests/client.test.cjs'])assert.equal((await f.req(p)).status,404);
 const {cookie}=await f.login();for(const p of ['/api/supabase/auth/v1/admin/users','/api/supabase/rest/v1/rpc/reserve_ats_mail','/api/supabase/https://evil.example'])assert.equal((await f.req(p,{method:'POST',headers:{Cookie:cookie}})).status,404);
 }finally{await f.close();}
});
test('logout immediately rejects replay of the old browser cookie',async()=>{
 const f=await fixture();try{const {cookie}=await f.login();assert.equal((await f.req('/api/auth/logout',{method:'POST',headers:{Cookie:cookie}})).status,200);assert.equal((await f.req('/api/auth/session',{headers:{Cookie:cookie}})).status,401);}finally{await f.close();}
});
test('profile deactivation revokes an existing application session',async()=>{
 const f=await fixture();try{const {cookie}=await f.login();f.setActive(false);assert.equal((await f.req('/api/auth/session',{headers:{Cookie:cookie}})).status,403);f.setActive(true);assert.equal((await f.req('/api/auth/session',{headers:{Cookie:cookie}})).status,401);}finally{await f.close();}
});
test('idle and absolute timeouts are enforced by server',async()=>{
 const f=await fixture();try{let {cookie}=await f.login();f.advance(30*60000);assert.equal((await f.req('/api/auth/session',{headers:{Cookie:cookie}})).status,401);
 ({cookie}=await f.login());for(let i=0;i<32;i++){f.advance(15*60000);const r=await f.req('/api/auth/session',{headers:{Cookie:cookie}});assert.equal(r.status,i===31?401:200);}
 }finally{await f.close();}
});
test('parallel calls share one refresh, while tokens remain only on server',async()=>{
 const f=await fixture();try{const {cookie}=await f.login();for(let i=0;i<3;i++){f.advance(15*60000);await f.req('/api/auth/session',{headers:{Cookie:cookie}});}f.advance(15*60000);
 const responses=await Promise.all([f.req('/api/auth/session',{headers:{Cookie:cookie}}),f.req('/api/auth/session',{headers:{Cookie:cookie}})]);assert.ok(responses.every(r=>r.status===200));assert.equal(f.refreshes(),1);
 }finally{await f.close();}
});
test('login attempt limit and inactive account fail closed',async()=>{
 const f=await fixture();try{f.setActive(false);assert.equal((await f.login()).r.status,403);f.setActive(true);for(let i=0;i<4;i++)await f.login();assert.equal((await f.login()).r.status,429);}finally{await f.close();}
});
