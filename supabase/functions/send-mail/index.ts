// No secrets in source. Platform JWT verification plus Auth user validation.
const json = (data: unknown, status = 200, origin = '') => new Response(JSON.stringify(data), {
 status, headers: {'Content-Type':'application/json', ...(origin ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin'} : {})}
});
function envKey(name: string, fallback: string): string {
 try { const keys=JSON.parse(Deno.env.get(name)||'{}'); if(keys.default)return keys.default; } catch { /* legacy fallback */ }
 return Deno.env.get(fallback)||'';
}
export async function handler(req: Request): Promise<Response> {
 const origin=req.headers.get('Origin')||'';
 const allowed=(Deno.env.get('ATS_ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(origin && !allowed.includes(origin)) return json({error:'このサイトからの送信は許可されていません'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}});
 if(req.method!=='POST')return json({error:'Method not allowed'},405,origin);
 const auth=req.headers.get('Authorization')||'';
 if(!/^Bearer \S+$/.test(auth))return json({error:'ログインが必要です'},401,origin);
 const url=Deno.env.get('SUPABASE_URL')||'';
 const publicKey=envKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
 const secret=envKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
 const privilegedHeaders: Record<string,string>={apikey:secret,'Content-Type':'application/json'};
 if(secret.startsWith('eyJ'))privilegedHeaders.Authorization='Bearer '+secret;
 const rest=async(path:string,options:RequestInit={})=>fetch(url+'/rest/v1/'+path,{...options,headers:{...privilegedHeaders,...options.headers},signal:AbortSignal.timeout(10000)});
 try {
  const authResult=await fetch(url+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:auth},signal:AbortSignal.timeout(10000)});
  if(!authResult.ok)return json({error:'ログインし直してください'},401,origin);
  const user=await authResult.json();
  const pr=await rest('profiles?select=id,role,is_active&id=eq.'+encodeURIComponent(user.id));
  if(!pr.ok)throw new Error('profile lookup failed');
  const profile=(await pr.json())[0];
  if(!profile?.is_active || !['admin','recruiter'].includes(profile.role))return json({error:'送信権限がありません'},403,origin);
  const raw=await req.text();
  if(raw.length>4096)return json({error:'リクエストが大きすぎます'},413,origin);
  let data;try{data=JSON.parse(raw);}catch{return json({error:'不正な入力です'},400,origin);}
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(typeof data.applicant_id!=='string'||data.applicant_id.length>100||!uuid.test(data.template_id||'')||!uuid.test(data.request_key||''))return json({error:'候補者・テンプレートを指定してください'},400,origin);
  const resendKey=Deno.env.get('RESEND_API_KEY');
  const from=Deno.env.get('ATS_MAIL_FROM');
  if(!resendKey||!from)return json({error:'メール送信設定が未完了です。管理者に確認してください。'},503,origin);
  const reserve=await rest('rpc/reserve_ats_mail',{method:'POST',body:JSON.stringify({p_user:user.id,p_applicant:data.applicant_id,p_template:data.template_id,p_key:data.request_key})});
  if(!reserve.ok){const e=await reserve.json();return json({error:e.message?.includes('Rate limit')?'送信が集中しています。1分後に再試行してください。':'候補者またはテンプレートを確認してください'},e.message?.includes('Rate limit')?429:400,origin);}
  const log=await reserve.json();
  if(log.status==='sent')return json({success:true,id:log.id,duplicate:true},200,origin);
  // Reuse frozen server-side content and provider idempotency key after a timeout.
  if(Date.now()-Date.parse(log.sent_at)>23*3600000)return json({error:'古い送信要求です。送信履歴を確認してください。'},409,origin);
  let sent: Response;
  try {
   sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resendKey,'Content-Type':'application/json','Idempotency-Key':'ats-'+log.request_key},body:JSON.stringify({from,to:[log.sent_to],subject:log.subject,text:log.body}),signal:AbortSignal.timeout(15000)});
  } catch {
   await rest('mail_logs?id=eq.'+log.id,{method:'PATCH',body:JSON.stringify({status:'unknown'})});
   return json({error:'送信結果を確認できません。同じ操作で再試行してください。'},502,origin);
  }
  if(!sent.ok){await rest('mail_logs?id=eq.'+log.id,{method:'PATCH',body:JSON.stringify({status:'failed'})});return json({error:'送信サービスがメールを受け付けませんでした。設定を確認してください。'},502,origin);}
  const provider=await sent.json();
  const logged=await rest('mail_logs?id=eq.'+log.id,{method:'PATCH',body:JSON.stringify({status:'sent',provider_id:provider.id})});
  if(!logged.ok)return json({error:'送信受付済みですが履歴保存に失敗しました。同じ操作で再試行してください。'},502,origin);
  return json({success:true,id:log.id},200,origin);
 } catch { return json({error:'処理に失敗しました。時間をおいて再試行してください。'},500,origin); }
}
Deno.serve(handler);
