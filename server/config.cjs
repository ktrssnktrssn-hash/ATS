'use strict';

function readConfig(env){
 let origin=env.ATS_ORIGIN;
 const render=env.RENDER==='true';
 if(!origin&&render){
  let url;
  try{url=new URL(env.RENDER_EXTERNAL_URL);}catch{throw Error('Render external URL is missing');}
  if(url.protocol!=='https:'||!url.hostname.endsWith('.onrender.com')||url.origin!==env.RENDER_EXTERNAL_URL||url.username||url.password)
   throw Error('Render external URL must be an HTTPS onrender.com origin');
  origin=url.origin;
 }
 if(!origin)throw Error('Set ATS_ORIGIN to the public HTTPS origin');
 if(env.NODE_ENV==='production'&&!origin.startsWith('https://'))throw Error('Production ATS_ORIGIN must use HTTPS');
 if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)throw Error('Supabase URL and publishable key are required');
 const portText=env.PORT||(render?'10000':'3000');
 if(!/^\d+$/.test(portText)||Number(portText)<1||Number(portText)>65535)throw Error('PORT must be an integer from 1 to 65535');
 return {origin,supabaseUrl:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY,port:Number(portText),host:env.HOST||(render?'0.0.0.0':'127.0.0.1')};
}
module.exports={readConfig};
