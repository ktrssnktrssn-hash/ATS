// Run after editing inline scripts. Only reviewed script bodies receive hashes.
const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
for(const file of ['index.html','list.html','detail.html']){
 const p=path.join(__dirname,'..',file);let html=fs.readFileSync(p,'utf8');
 const hashes=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'");
 const policy=["default-src 'none'","script-src 'self' "+hashes.join(' '),"script-src-attr 'none'","style-src 'self' 'unsafe-inline'","img-src 'self' data:","font-src 'self'","connect-src 'self'","base-uri 'none'","object-src 'none'","form-action 'none'"].join('; ');
 html=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/g,'').replace(/<meta name="referrer"[^>]*>\n?/g,'');
 html=html.replace(/(<meta charset="[^"]+"\s*\/?>)/i,'$1\n<meta http-equiv="Content-Security-Policy" content="'+policy+'">\n<meta name="referrer" content="no-referrer">');
 fs.writeFileSync(p,html);
}
