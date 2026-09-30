const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readConfig}=require('../server/config.cjs');
const base={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};

test('Render boot uses platform URL and reachable bind address without trusting request headers',()=>{
 const c=readConfig({...base,RENDER:'true',NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://ats-demo.onrender.com',PORT:'10000'});
 assert.equal(c.origin,'https://ats-demo.onrender.com');assert.equal(c.host,'0.0.0.0');assert.equal(c.port,10000);
 const custom=readConfig({...base,RENDER:'true',ATS_ORIGIN:'https://ats.example',PORT:'3000'});
 assert.equal(custom.origin,'https://ats.example');
});
test('unsafe or missing production configuration fails before listening',()=>{
 for(const env of [{},{RENDER:'true'},{RENDER:'true',RENDER_EXTERNAL_URL:'http://ats.onrender.com'},{RENDER:'true',RENDER_EXTERNAL_URL:'https://evil.example'},{ATS_ORIGIN:'http://127.0.0.1:3000',NODE_ENV:'production'}])
  assert.throws(()=>readConfig({...base,...env}));
 for(const port of ['0','65536','NaN','3000junk','-1','1.5'])assert.throws(()=>readConfig({...base,ATS_ORIGIN:'https://ats.example',PORT:port}));
});
test('local development stays on loopback and requires explicit origin',()=>{
 const c=readConfig({...base,ATS_ORIGIN:'http://127.0.0.1:3000'});
 assert.equal(c.port,3000);assert.equal(c.host,'127.0.0.1');
 assert.throws(()=>readConfig({ATS_ORIGIN:'https://ats.example'}));
});
