// Local-only thumbnail QA/calibration, synthetic media and in-memory stores. No production config.
// node --no-warnings scripts/thumbnail-preview.mjs /absolute/path/to/synthetic.mp4
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handle } from '#src/index';
import { Store } from '#src/store';
import { createPerceptualTools } from '#src/perceptual';
import { POSTER_DECODER } from '#src/perceptual-browser';
import { FakeD1, FakeKV, FakeR2, makeSigner } from '#test/fakes';
const names=['original.png','original.jpg','recompressed.jpg','resized.jpg','unrelated.png','near-miss.png','crop.png','blank.png','gradient.png'];
const types={png:'image/png',jpg:'image/jpeg'};
const files=new Map(await Promise.all(names.map(async n=>[n,await readFile('test/fixtures/thumbnails/'+n)])));
const media=await readFile(process.argv[2]),signer=await makeSigner(crypto.randomUUID());
let kv,db,r2,store,slow=false,requests=[],report=null;
async function seed(mode='full'){
 kv=new FakeKV();db=new FakeD1();r2=new FakeR2();store=new Store(kv.asKV(),db.asD1(),r2.asR2());slow=mode==='slow';requests=[];
 const entries=mode==='large'?Array.from({length:105},(_,i)=>names[i%names.length]):[...names,'original.jpg','missing'];
 for(const [i,name] of entries.entries()){
  const id=String(91000+i),video=Buffer.concat([media,Buffer.alloc(i)]);
  await store.upsertBookmark({post_id:id,posted_at:'2026-11-06T00:00:00Z',text:name,post_url:'https://x.com/i/status/'+id,has_video:1,status:'downloaded',error:null,r2_key:id+'.mp4',bytes:video.length,duration_ms:2000+i*1000,preview_url:null,now:'2026-11-06T00:00:00Z'});
  await r2.put(id+'.mp4',video,{httpMetadata:{contentType:'video/mp4'}});
  if(files.has(name))await r2.put('posters/'+id,files.get(name),{httpMetadata:{contentType:types[name.split('.').at(-1)]}});
 }
}
await seed();
const calibration=`<!doctype html><meta name="viewport" content="width=device-width"><title>Thumbnail codec calibration</title><style>body{background:#111;color:#eee;font:16px system-ui;padding:24px}img{max-width:180px}pre{white-space:pre-wrap}</style><h1>Synthetic thumbnail codec calibration</h1><pre id="result">Running…</pre><div id="images"></div><script>
(async()=>{const tools=(${createPerceptualTools.toString()})(),decoder=(${POSTER_DECODER})(tools),hashes={},rows=[];
 for(const name of ${JSON.stringify(names)}){const response=await fetch('/__qa/image/'+name),bytes=new Uint8Array(await response.arrayBuffer()),mime=response.headers.get('content-type'),dims=tools.dimensions(bytes,mime);const pixels=await decoder.decode(bytes,mime,dims);hashes[name]=tools.fingerprint(pixels.data,pixels.width,pixels.height);const img=document.createElement('img');img.src='/__qa/image/'+name;img.title=name;document.getElementById('images').append(img);}
 const bitmap=await createImageBitmap(await(await fetch('/__qa/image/original.png')).blob());const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
 const webp=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.55));if(webp?.type!=='image/webp')throw new Error('WebP encoder unavailable');const bytes=new Uint8Array(await webp.arrayBuffer());const decoded=await decoder.decode(bytes,webp.type,tools.dimensions(bytes,webp.type));hashes['browser.webp']=tools.fingerprint(decoded.data,decoded.width,decoded.height);
 for(const name of Object.keys(hashes)){const a=hashes['original.png'],b=hashes[name],distance=b?[...a.bits].filter((bit,i)=>bit!==b.bits[i]).length:null,color=b?a.rgb.reduce((sum,n,i)=>sum+Math.abs(n-b.rgb[i]),0)/216:null;rows.push({name,distance,colorMAE:color,matched:Boolean(b&&tools.compare(a,b)),lowDetail:b===null});}
 const positives=['original.jpg','recompressed.jpg','resized.jpg','browser.webp'],negatives=['unrelated.png','near-miss.png','crop.png','blank.png','gradient.png'];const passed=rows.every(r=>positives.includes(r.name)?r.matched:negatives.includes(r.name)?!r.matched:true);
 const report={passed,algorithm:tools.version,userAgent:navigator.userAgent,rows};document.getElementById('result').textContent=JSON.stringify(report,null,2);await fetch('/__qa/report',{method:'POST',body:JSON.stringify(report)});
})().catch(error=>{document.getElementById('result').textContent='FAILED: '+error.message;});</script>`;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:4399');
  if(url.pathname==='/__qa/calibration'){res.setHeader('content-type','text/html');return res.end(calibration);}
  if(url.pathname.startsWith('/__qa/image/')){const name=url.pathname.split('/').at(-1);if(!files.has(name)){res.writeHead(404);return res.end();}res.setHeader('content-type',types[name.split('.').at(-1)]);return res.end(files.get(name));}
  if(url.pathname==='/__qa/report'){if(req.method==='POST'){const parts=[];for await(const c of req)parts.push(c);report=JSON.parse(Buffer.concat(parts));}res.setHeader('content-type','application/json');return res.end(JSON.stringify(report));}
  if(url.pathname==='/__qa/reset'){await seed(url.searchParams.get('mode')||'full');res.writeHead(302,{location:'/duplicates'});return res.end();}
  if(url.pathname==='/__qa/requests'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(requests));}
  if(url.pathname==='/__qa/mobile'){res.setHeader('content-type','text/html');return res.end('<html><body style="margin:0;background:#333"><iframe title="Mobile thumbnail QA" src="/duplicates" style="border:0;width:390px;height:844px"></iframe></body></html>');}
  requests.push({method:req.method,path:url.pathname});
  if(slow&&url.pathname.startsWith('/p/'))await new Promise(r=>setTimeout(r,1500));
  const headers=new Headers(req.headers),jwt=await signer.sign({aud:['qa'],iss:'https://thumbnail-qa.cloudflareaccess.com',exp:Date.now()/1000+120,email:'owner@example.test'});headers.set('cf-access-jwt-assertion',jwt);
  const parts=[];for await(const c of req)parts.push(c);
  const response=await handle(new Request(url,{method:req.method,headers,...(parts.length?{body:Buffer.concat(parts)}:{})}),{X_CLIENT_ID:'qa',X_CLIENT_SECRET:'qa',TEAM_DOMAIN:'https://thumbnail-qa.cloudflareaccess.com',POLICY_AUD:'qa',PUBLIC_ORIGIN:url.origin,OWNER_EMAIL:'owner@example.test',VIDEOS:r2.asR2(),DB:db.asD1(),KV:kv.asKV()},async()=>Response.json({keys:[signer.jwk]}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error);res.writeHead(500);res.end('Synthetic QA failure');}
});
server.listen(4399,'127.0.0.1',()=>console.log('Synthetic thumbnail QA http://127.0.0.1:4399/duplicates and /__qa/calibration'));
