// =====================================================
// lib/api.js — Supabase接続層
// ここを変更するだけで将来別バックエンドに切り替え可能
// =====================================================

// Browser requests only our same-origin server. Supabase tokens never enter JS storage.
const SUPABASE_URL = '/api/supabase';
const SESSION_KEYS = {token:'ats_edxfhpdyxlenkrxsnirb_token',refresh:'ats_edxfhpdyxlenkrxsnirb_refresh',user:'ats_edxfhpdyxlenkrxsnirb_user'};
let currentUser=null;
function clearSession(){currentUser=null;[...Object.values(SESSION_KEYS),'ats_token','ats_refresh','ats_user'].forEach(k=>localStorage.removeItem(k));}
clearSession(); // Remove credentials left by the previous static client.
function getCurrentUser(){return currentUser;}
function notifyError(error) {
 const message=error?.message||'処理に失敗しました。再試行してください。';
 const box=document.getElementById('toast')||document.getElementById('lerr');
 if(box){box.textContent=message;box.setAttribute('role','alert');box.style.display='block';box.classList.add('show');}
}
window.addEventListener('unhandledrejection', e=>{notifyError(e.reason);e.preventDefault();});

async function readResponse(res) {
 if(!res)throw new Error('通信に失敗しました');
 const text=await res.text();let data=null;
 if(text){try{data=JSON.parse(text);}catch{if(res.ok)throw new Error('サーバーの応答を読み取れません');}}
 if(!res.ok)throw new Error(data?.error_description||data?.error||data?.message||`処理に失敗しました（${res.status}）`);
 return data;
}
const sb={
 async login(email,password){
  const data=await readResponse(await sb._fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}));
  currentUser=data.user;return data;
 },
 async logout(){await readResponse(await sb._fetch('/api/auth/logout',{method:'POST'}));clearSession();},
 async _fetch(url,options={}){
  if(!url.startsWith('/api/'))throw new Error('許可されていない接続先です');
  const res=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',headers:{...options.headers,'X-ATS-Request':'1'}});
  if(res.status===401){clearSession();if(url!=='/api/auth/login'&&window.location.pathname!=='/index.html'&&window.location.pathname!=='/')window.location.href='index.html';}
  if(!res.ok)await readResponse(res);return res;
 },
 async query(table,params={}){
  const q=new URLSearchParams();if(params.select)q.set('select',params.select);if(params.order)q.set('order',params.order);if(params.limit)q.set('limit',params.limit);if(params.offset)q.set('offset',params.offset);
  return readResponse(await sb._fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+q.toString()+(params.filter?'&'+params.filter:'')));
 },
 async insert(table,data){return readResponse(await sb._fetch(SUPABASE_URL+'/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(data)}));},
 async update(table,id,data,idColumn='id'){
  const result=await readResponse(await sb._fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+idColumn+'=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(data)}));
  if(!Array.isArray(result)||!result.length)throw new Error('更新できません。権限またはデータの状態を確認してください。');return result;
 },
 async softDelete(table,id){return sb.update(table,id,{deleted_at:new Date().toISOString()});},
 async uploadFile(bucket,path,file){return readResponse(await sb._fetch(SUPABASE_URL+'/storage/v1/object/'+bucket+'/'+path,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file}));},
 async getSignedUrl(bucket,path){
  const data=await readResponse(await sb._fetch(SUPABASE_URL+'/storage/v1/object/sign/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})}));
  const signed=data.signedURL||data.signedUrl;if(!signed)throw new Error('書類URLを取得できません');return signed.startsWith('https://')?signed:'https://edxfhpdyxlenkrxsnirb.supabase.co/storage/v1'+signed;
 }
};

const atsApi = {

  // ---------- 認証 ----------
  async login(email,password){
    try{await sb.login(email,password);await atsApi.validateSession();return {success:true};}
    catch(e){clearSession();return {error:e.message||'ログインに失敗しました'};}
  },
  async validateSession(){
    const data=await readResponse(await sb._fetch('/api/auth/session'));
    if(!data?.user?.is_active)throw new Error('ATSの利用権限がありません');
    currentUser=data.user;return currentUser;
  },
  async logout() {
    await sb.logout();
  },

  // ---------- 応募者 ----------
  async getApplicants(filters = {}) {
    let filter = "deleted_at=is.null";
    if (filters.step)    filter += `&step=eq.${filters.step}`;
    if (filters.status)  filter += `&status=eq.${filters.status}`;
    if (filters.job_id)  filter += `&job_id=eq.${filters.job_id}`;
    if (filters.gender)  filter += `&gender=eq.${filters.gender}`;
    if (filters.date_from) filter += `&applied_at=gte.${filters.date_from}`;
    if (filters.date_to)   filter += `&applied_at=lte.${filters.date_to}`;
    if (filters.keyword) {
      // 氏名・ID・メールで検索
      const term=encodeURIComponent(String(filters.keyword).replace(/[*,()."\\]/g," ")); filter += `&or=(name.ilike.*${term}*,id.ilike.*${term}*,email.ilike.*${term}*)`;
    }
    const rows=[]; const size=filters.limit||200;
    for(let offset=0;;offset+=size){
      const page=await sb.query('applicants',{select:'*',filter,order:'applied_at.desc,created_at.desc,id.asc',limit:size,offset});
      rows.push(...page);if(filters.limit||page.length<size)return rows;
    }
  },

  async getApplicant(id) {
    const rows = await sb.query("applicants", {
      select: "*",
      filter: `id=eq.${id}&deleted_at=is.null`
    });
    return rows?.[0] || null;
  },

  async createApplicant(data) {
    const user = getCurrentUser();
    return sb.insert("applicants", { ...data, created_by: user?.id });
  },

  async updateApplicant(id, data) {
    return sb.update("applicants", id, data);
  },

  async deleteApplicant(id) {
    return sb.softDelete("applicants", id);
  },

  // 一括操作
  async bulkUpdate(ids, data) {
    return readResponse(await sb._fetch(SUPABASE_URL+'/rest/v1/rpc/bulk_update_ats_applicants', {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_ids:ids,p_data:data})
    }));
  },

  // ---------- タグ ----------
  async getTags() {
    return sb.query("tags", { select: "*", order: "name.asc" });
  },

  async getApplicantTags(applicantId) {
    return sb.query("applicant_tags", {
      select: "tag_id,tags(id,name,color)",
      filter: `applicant_id=eq.${applicantId}`
    });
  },

  // 全応募者のタグを一括取得（一覧画面用）
  async getAllApplicantTags() {
    return sb.query("applicant_tags", {
      select: "applicant_id,tag_id,tags(id,name,color)"
    });
  },

  async addTag(applicantId, tagId) {
    return sb.insert("applicant_tags", { applicant_id: applicantId, tag_id: tagId });
  },

  async removeTag(applicantId, tagId) {
    const res = await sb._fetch(
      `${SUPABASE_URL}/rest/v1/applicant_tags?applicant_id=eq.${applicantId}&tag_id=eq.${tagId}`,
      { method: "DELETE" }
    );
    return res;
  },

  // ---------- 選考ステップ ----------
  async getStepHistory(applicantId) {
    return sb.query("step_histories", {
      select: "*, profiles(name)",
      filter: `applicant_id=eq.${applicantId}`,
      order: "created_at.asc"
    });
  },


  // ---------- 評価 ----------
  async getEvaluations(applicantId) {
    // profiles JOINは除外（evaluator_idがnullの場合に失敗するため）
    // 面接官名は criteria._name から取得する
    return sb.query("evaluations", {
      select: "*",
      filter: `applicant_id=eq.${applicantId}`,
      order: "step.asc,created_at.asc"
    });
  },

  async saveEvaluation(data) {
    const user = getCurrentUser();
    // evaluator_idがdataに明示指定されていればそちらを使う（nullも可）
    const evaluator_id = "evaluator_id" in data ? data.evaluator_id : user?.id;
    return sb.insert("evaluations", { ...data, evaluator_id });
  },

  async updateEvaluation(id, data) {
    return sb.update("evaluations", id, data);
  },

  async deleteEvaluation(id) {
    await sb._fetch(
      `${SUPABASE_URL}/rest/v1/evaluations?id=eq.${id}`,
      { method: "DELETE" }
    );
  },

  // ---------- 面接官アサイン ----------
  async getAssignments(applicantId) {
    return sb.query("interviewer_assignments", {
      select: "*, profiles(id,name,role)",
      filter: `applicant_id=eq.${applicantId}`
    });
  },

  async assignInterviewer(applicantId, userId, step) {
    const user = getCurrentUser();
    return sb.insert("interviewer_assignments", {
      applicant_id: applicantId,
      user_id: userId,
      step,
      assigned_by: user?.id
    });
  },

  async removeInterviewer(applicantId, userId, step) {
    const res = await sb._fetch(
      `${SUPABASE_URL}/rest/v1/interviewer_assignments?applicant_id=eq.${applicantId}&user_id=eq.${userId}&step=eq.${step}`,
      { method: "DELETE" }
    );
    return res;
  },

  // ---------- 書類 ----------
  async getFiles(applicantId) {
    return sb.query("files", {
      select: "*",
      filter: `applicant_id=eq.${applicantId}`,
      order: "created_at.asc"
    });
  },

  async uploadFile(applicantId, file) {
    const user = getCurrentUser();
    // ファイル名を安全なASCII形式に変換（日本語ファイル名対応）
    const ext      = file.name.split(".").pop().toLowerCase();
    const safeName = `${crypto.randomUUID()}.${ext}`;
    const path     = `${user.tenant_id}/${applicantId}/${safeName}`;
    const uploaded = await sb.uploadFile("applicant-files", path, file);
    if (!uploaded) return null;
    let rows;
    try { rows = await sb.insert("files", {
      applicant_id: applicantId,
      name:         file.name,          // 表示名は元のファイル名を保持
      file_type:    ext.toUpperCase(),
      storage_path: path,               // 保存パスはASCII安全なものを使用
      size_bytes:   file.size,
      uploaded_by:  user?.id
    }); } catch(error) {
      try { await sb._fetch(`${SUPABASE_URL}/storage/v1/object/applicant-files`, {method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})}); } catch { /* Report the original failure; orphan cleanup is documented. */ }
      throw error;
    }
    return rows[0];
  },

  async getFileUrl(storagePath) {
    return sb.getSignedUrl("applicant-files", storagePath);
  },

  // ファイル削除（DBレコード + Storageの両方）
  async deleteFile(fileId, storagePath) {
    // Storageから削除（パスをエンコード）
    await sb._fetch(
      `${SUPABASE_URL}/storage/v1/object/applicant-files`,
      { method: "DELETE", headers:{'Content-Type':'application/json'}, body:JSON.stringify({prefixes:[storagePath]}) }
    );
    // DBレコードを削除
    await sb._fetch(
      `${SUPABASE_URL}/rest/v1/files?id=eq.${fileId}`,
      { method: "DELETE" }
    );
  },

  // ---------- メール ----------
  async getMailTemplates() {
    return sb.query("mail_templates", { select: "*", order: "created_at.asc" });
  },

  async getMailHistory(applicantId) {
    return sb.query("mail_logs", {
      select: "*, mail_templates(name), profiles(name)",
      filter: `applicant_id=eq.${applicantId}`,
      order: "sent_at.desc"
    });
  },

  async sendMail(applicantId,templateId){
    const keyName=SESSION_KEYS.token+'_mail_'+getCurrentUser().id+'_'+applicantId+'_'+templateId;
    let requestKey=sessionStorage.getItem(keyName);if(!requestKey){requestKey=crypto.randomUUID();sessionStorage.setItem(keyName,requestKey);}
    const result=await readResponse(await sb._fetch(SUPABASE_URL+'/functions/v1/send-mail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({applicant_id:applicantId,template_id:templateId,request_key:requestKey})}));
    if(result?.success)sessionStorage.removeItem(keyName);return result;
  },

  // ---------- 社内連絡タイムライン ----------
  async getTimeline(applicantId) {
    return sb.query("timeline_entries", {
      select: "*",
      filter: `applicant_id=eq.${applicantId}`,
      order: "created_at.desc"
    });
  },

  async postTimeline(applicantId, type, text) {
    const user = getCurrentUser();
    return sb.insert("timeline_entries", {
      applicant_id: applicantId,
      user_id: user?.id,
      user_name: user?.name || user?.email || "管理者",
      type,
      text
    });
  },

  async deleteTimeline(id) {
    const res = await sb._fetch(
      `${SUPABASE_URL}/rest/v1/timeline_entries?id=eq.${id}`,
      { method: "DELETE" }
    );
    return res;
  },

  // ---------- 求人 ----------
  async getJobs() {
    return sb.query("jobs", {
      select: "id,title,department,status",
      filter: "deleted_at=is.null",
      order: "created_at.asc"
    });
  },

  // ---------- メンバー ----------
  async getMembers() {
    return sb.query("profiles", {
      select: "id,name,email,role",
      filter: "is_active=eq.true",
      order: "name.asc"
    });
  }
};
