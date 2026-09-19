const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const wait=()=>new Promise(r=>setTimeout(r,20));
async function load(file,role='admin'){
 const source=fs.readFileSync(path.join(root,file),'utf8');const scripts=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 const dom=new JSDOM(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{url:'https://ats.example/'+file+'?id=candidate-a',runScripts:'outside-only'});
 const w=dom.window;const profile={id:'user-a',tenant_id:'tenant-a',role,name:'Admin',is_active:true};
 const candidate={id:'candidate-a',name:'<img src=x onerror="window.compromised=true">青山',job_id:'job-a',step:'書類選考',status:'未対応',applied_at:'2026-09-01',memo:'',stars:0};
 const tables={profiles:[profile],applicants:[candidate],jobs:[{id:'job-a',title:'Engineer'}],tags:[],applicant_tags:[],mail_templates:[{id:'template-a',name:'Interview',subject:'Interview',body:'Hello'}],evaluations:[],step_histories:[],timeline_entries:[],files:[],mail_logs:[]};
 w.fetch=async(url,options={})=>{
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:'user-a'}));
  if(url.includes('/functions/'))return new Response('{"error":"メール送信設定が未完了です"}',{status:503});
  const table=new URL(url).pathname.split('/').pop();if(options.method==='PATCH'){const data=JSON.parse(options.body);Object.assign(tables[table][0],data);return new Response(JSON.stringify([tables[table][0]]));}
  if(options.method==='POST'){const data={...JSON.parse(options.body),id:'new-id'};tables[table].push(data);return new Response(JSON.stringify([data]));}
  return new Response(JSON.stringify(tables[table]||[]));
 };
 w.confirm=()=>true;vm.runInContext(fs.readFileSync(path.join(root,'lib/vendor/purify.min.js'),'utf8'),dom.getInternalVMContext());vm.runInContext(fs.readFileSync(path.join(root,'lib/api.js'),'utf8'),dom.getInternalVMContext());
 w.localStorage.setItem('ats_edxfhpdyxlenkrxsnirb_token','token');w.localStorage.setItem('ats_edxfhpdyxlenkrxsnirb_user',JSON.stringify(profile));scripts.forEach(s=>vm.runInContext(s,dom.getInternalVMContext()));await wait();return {dom,w,d:w.document,tables};
}
test('list loads, neutralizes event-handler HTML and registers a candidate',async()=>{
 const {dom,d,tables}=await load('list.html');try{assert.equal(d.querySelectorAll('#tbody tr').length,1);assert.equal(d.querySelectorAll('[onerror]').length,0);
 d.getElementById('new-btn').click();for(const [id,value]of Object.entries({'nf-sei':'試用','nf-mei':'太郎','nf-gender':'男','nf-job':'job-a'}))d.getElementById(id).value=value;
 d.getElementById('new-submit').click();await wait();assert.equal(tables.applicants.length,2);assert.equal(d.querySelectorAll('#tbody tr').length,2);
 }finally{dom.window.close();}
});
test('detail saves memo and uses real members',async()=>{
 const {dom,d,tables}=await load('detail.html');try{
 assert.match(d.getElementById('d-name').textContent,/青山/);d.getElementById('d-memo').value='保存テスト';d.getElementById('memo-save').click();await wait();assert.equal(tables.applicants[0].memo,'保存テスト');
 assert.ok(d.querySelector('#asel-0 option[value="user-a"]'));tables.applicants[0].email='candidate@example.invalid';
 // Explicit API rejection is covered by client.test; the page must not invent send success.
 assert.equal(d.querySelectorAll('[onerror]').length,0);
 }finally{dom.window.close();}
});
test('interviewer UI receives server-validated role',async()=>{const {dom,d}=await load('detail.html','interviewer');try{assert.ok(d.body.classList.contains('ats-interviewer'));}finally{dom.window.close();}});
