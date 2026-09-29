'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,createHash}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const TABLES=new Set(['organizations','profiles','jobs','applicants','tags','applicant_tags','interviewer_assignments','step_histories','evaluations','files','mail_templates','mail_logs','timeline_entries']);
const STATIC=new Map(['index.html','list.html','detail.html','lib/api.js','lib/vendor/purify.min.js'].map(p=>['/'+p,p]));
const MAX_AGE=8*3600*1000,IDLE=30*60*1000;
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
function createApp({origin,supabaseUrl,publishableKey,fetchImpl=fetch,now=Date.now}={}){
 const site=new URL(origin);const upstream=new URL(supabaseUrl);
 if(site.origin!==origin||site.username||site.password||(!['https:'].includes(site.protocol)&&!(site.protocol==='http:'&&['localhost','127.0.0.1'].includes(site.hostname))))throw Error('ATS_ORIGIN must be HTTPS origin (HTTP allowed only for loopback development)');
 if(upstream.protocol!=='https:'||!upstream.hostname.endsWith('.supabase.co')||upstream.origin!==supabaseUrl)throw Error('Invalid SUPABASE_URL');
 if(!publishableKey?.startsWith('sb_publishable_'))throw Error('Use a publishable key, never a service-role key');
 const cookieName=site.protocol==='https:'?'__Host-ats_session':'ats_dev_session';
 const sessions=new Map(),attempts=new Map();let globalAttempts={start:now(),count:0};
 const cookie=(sid='',age=0)=>`${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${site.protocol==='https:'?'; Secure':''}`;
 const getSid=req=>{const values=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='));return values.length===1?values[0].slice(cookieName.length+1):'';};
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 async function call(route,token,options={}){
  return fetchImpl(upstream.origin+route,{...options,redirect:'error',headers:{apikey:publishableKey,...(token?{Authorization:'Bearer '+token}:{}),...options.headers},signal:AbortSignal.timeout(15000)});
 }
 async function refresh(s){
  if(!s.refreshing)s.refreshing=(async()=>{const r=await call('/auth/v1/token?grant_type=refresh_token',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh})});
   if(!r.ok)throw new HttpError(401,'ログインし直してください');const d=await r.json();if(!d.access_token||!d.refresh_token)throw new HttpError(401,'ログインし直してください');
   s.access=d.access_token;s.refresh=d.refresh_token;s.expiry=now()+Number(d.expires_in||3600)*1000;
  })().finally(()=>{s.refreshing=null;});
  await s.refreshing;
 }
 async function profile(s){
  if(now()>=s.expiry-30000)await refresh(s);
  let r=await call('/auth/v1/user',s.access);
  if(r.status===401){await refresh(s);r=await call('/auth/v1/user',s.access);}
  if(!r.ok)throw new HttpError(r.status===401?401:502,'認証を確認できません');
  const user=await r.json();if(!user.id||(s.uid&&s.uid!==user.id))throw new HttpError(401,'ログインし直してください');
  r=await call('/rest/v1/profiles?select=id,email,name,role,tenant_id,is_active&id=eq.'+encodeURIComponent(user.id),s.access);
  if(!r.ok)throw new HttpError(502,'利用権限を確認できません');const rows=await r.json();const p=rows[0];
  if(!p||p.id!==user.id||!p.tenant_id||!p.is_active||!['admin','recruiter','interviewer'].includes(p.role))throw new HttpError(403,'ATSの利用権限がありません');
  s.uid=user.id;return p;
 }
 async function body(req,limit){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new HttpError(413,'リクエストが大きすぎます');chunks.push(chunk);}return Buffer.concat(chunks);}
 function throttle(email){
  const t=now();for(const [k,v] of attempts)if(t-v.start>=15*60*1000)attempts.delete(k);
  if(t-globalAttempts.start>=60000)globalAttempts={start:t,count:0};
  if(++globalAttempts.count>100)throw new HttpError(429,'時間をおいて再試行してください');
  const k=createHash('sha256').update(email.toLowerCase()).digest('hex');const a=attempts.get(k)||{start:t,count:0};
  if(attempts.size>=10000&&!attempts.has(k))throw new HttpError(429,'時間をおいて再試行してください');
  attempts.set(k,a);if(++a.count>5)throw new HttpError(429,'時間をおいて再試行してください');
 }
 function cleanup(){for(const [id,s] of sessions)if(now()-s.created>=MAX_AGE||now()-s.last>=IDLE)sessions.delete(id);}
 function proxyAllowed(url,method){
  if(!url.pathname.startsWith('/api/supabase/'))return false;
  const p=url.pathname.slice('/api/supabase'.length);
  if(/^\/rest\/v1\/[a-z_]+$/.test(p)&&TABLES.has(p.split('/').at(-1)))return ['GET','POST','PATCH','DELETE'].includes(method);
  if(p==='/rest/v1/rpc/bulk_update_ats_applicants')return method==='POST';
  if(p==='/functions/v1/send-mail')return method==='POST';
  if(p==='/storage/v1/object/applicant-files')return method==='DELETE';
  if(/^\/storage\/v1\/object\/(?:sign\/)?applicant-files\/[A-Za-z0-9%._/-]+$/.test(p))return method==='POST'&&!/%2f|%5c|\.\.|\/\//i.test(p);
  return false;
 }
 return http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Pragma','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(site.protocol==='https:')res.setHeader('Strict-Transport-Security','max-age=31536000');
  let sid='';
  try{
   if(req.headers.host!==site.host)throw new HttpError(400,'Invalid host');
   if(!req.url.startsWith('/')||req.url.startsWith('//'))throw new HttpError(400,'Invalid URL');
   const url=new URL(req.url,origin);sid=getSid(req);cleanup();
   if(url.pathname.startsWith('/api/')){
    // Required custom header blocks cross-site simple requests; no CORS is exposed.
    if(req.headers['x-ats-request']!=='1'||(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])))throw new HttpError(403,'アクセス元を確認できません');
    if(req.headers.origin&&req.headers.origin!==origin)throw new HttpError(403,'アクセス元を確認できません');
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)throw new HttpError(403,'アクセス元を確認できません');
    if(url.pathname==='/api/auth/login'&&req.method==='POST'){
     if(!(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'JSON required');
     let d;try{d=JSON.parse((await body(req,8192)).toString());}catch(e){if(e.status)throw e;throw new HttpError(400,'入力を確認してください');}
     if(typeof d.email!=='string'||d.email.length>254||typeof d.password!=='string'||d.password.length>1024||!d.password)throw new HttpError(400,'入力を確認してください');
     throttle(d.email.trim());if(sessions.size>=1000)throw new HttpError(503,'時間をおいて再試行してください');
     const r=await call('/auth/v1/token?grant_type=password',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:d.email.trim(),password:d.password})});
     if(!r.ok)throw new HttpError(r.status===429?429:401,'ログインできません。入力内容を確認してください');
     const token=await r.json();if(!token.access_token||!token.refresh_token)throw new HttpError(502,'認証に失敗しました');
     const s={access:token.access_token,refresh:token.refresh_token,expiry:now()+Number(token.expires_in||3600)*1000,created:now(),last:now()};
     let p;try{p=await profile(s);}catch(e){await call('/auth/v1/logout?scope=local',s.access,{method:'POST'}).catch(()=>{});throw e;}
     sessions.delete(sid);const id=randomBytes(32).toString('base64url');sessions.set(id,s);res.setHeader('Set-Cookie',cookie(id,MAX_AGE/1000));return json(res,200,{user:p});
    }
    if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
     const s=sessions.get(sid);sessions.delete(sid);res.setHeader('Set-Cookie',cookie());
     if(s)await call('/auth/v1/logout?scope=local',s.access,{method:'POST'}).catch(()=>{});
     return json(res,200,{success:true});
    }
    const s=sessions.get(sid);if(!s)throw new HttpError(401,'ログインし直してください');
    const p=await profile(s);if(sessions.get(sid)!==s)throw new HttpError(401,'ログインし直してください');s.last=now();
    if(url.pathname==='/api/auth/session'&&req.method==='GET')return json(res,200,{user:p});
    if(!proxyAllowed(url,req.method))throw new HttpError(404,'Not found');
    const headers={};for(const k of ['content-type','prefer'])if(req.headers[k])headers[k]=req.headers[k];
    const data=['GET','HEAD'].includes(req.method)?undefined:await body(req,url.pathname.includes('/storage/')?10485760:1048576);
    const r=await call(url.pathname.slice('/api/supabase'.length)+url.search,s.access,{method:req.method,headers,body:data});
    res.writeHead(r.status,{'Content-Type':'application/json; charset=utf-8'});return res.end(await r.text());
   }
   if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Method not allowed');
   const file=STATIC.get(url.pathname==='/'?'/index.html':url.pathname);if(!file)throw new HttpError(404,'Not found');
   const data=fs.readFileSync(path.join(ROOT,file));
   if(file.endsWith('.html')){
    const csp=data.toString().match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);if(!csp)throw Error('Missing CSP');
    res.setHeader('Content-Security-Policy',csp[1]+"; frame-ancestors 'none'");
   }
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/javascript; charset=utf-8');res.end(req.method==='HEAD'?undefined:data);
  }catch(e){
   if([401,403].includes(e.status)&&sid){sessions.delete(sid);res.setHeader('Set-Cookie',cookie());}
   if(!res.headersSent)json(res,e.status||502,{error:e.status?e.message:'通信に失敗しました。再試行してください'});else res.end();
  }
 });
}
module.exports={createApp};
if(require.main===module){
 const server=createApp({origin:process.env.ATS_ORIGIN,supabaseUrl:process.env.SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY});
 server.requestTimeout=30000;server.headersTimeout=15000;
 server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('ATS server ready'));
}
