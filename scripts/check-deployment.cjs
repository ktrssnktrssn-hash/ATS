'use strict';
const assert=require('node:assert/strict');

async function check(origin){
 const u=new URL(origin);
 assert.ok(u.protocol==='https:'&&u.origin===origin&&!u.username&&!u.password,'Pass an exact HTTPS origin without a trailing slash');
 const request=p=>fetch(origin+p,{redirect:'error',headers:{'X-ATS-Request':'1'},signal:AbortSignal.timeout(90000)});
 const page=await request('/');assert.equal(page.status,200,'Login page must load');
 assert.match(page.headers.get('content-type')||'',/text\/html/);
 assert.match(page.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
 assert.match(page.headers.get('content-security-policy')||'',/connect-src 'self'/);
 assert.match(page.headers.get('cache-control')||'',/no-store/);
 assert.equal(page.headers.get('x-content-type-options'),'nosniff');
 assert.equal(page.headers.get('x-frame-options'),'DENY');
 assert.match(page.headers.get('strict-transport-security')||'',/max-age=[1-9]/);
 assert.equal(page.headers.get('set-cookie'),null,'Anonymous static page must not establish a session');
 for(const p of ['/api/auth/session','/api/supabase/rest/v1/applicants'])assert.equal((await request(p)).status,401,'Anonymous API access must be denied: '+p);
 for(const p of ['/server/app.cjs','/server/config.cjs','/.env','/db/ats_schema.sql','/package.json'])assert.equal((await request(p)).status,404,'Private source must not be served: '+p);
 const health=await request('/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
 console.log('Deployment headers, anonymous access and source-file restrictions passed. Actual browser login is still required.');
}
check(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
