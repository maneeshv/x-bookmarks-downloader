// Local-only QA host. Uses synthetic media and in-memory fixtures; never reads production config.
// node --no-warnings scripts/reels-preview.mjs /absolute/path/to/fixture.mp4 /absolute/path/to/poster.jpg
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handle as sourceHandle } from '#src/index';
import { Store } from '#src/store';
const { FakeD1, FakeKV, FakeR2, makeSigner } = await import(pathToFileURL(resolve('test/fakes.ts')).href);
const handle = process.env.REELS_QA_BUNDLE ? (await import('data:text/javascript;base64,'+Buffer.from(await readFile(process.env.REELS_QA_BUNDLE)).toString('base64'))).handle : sourceHandle;
const [mediaPath, posterPath, landscapePath] = process.argv.slice(2);
if (!mediaPath || !posterPath) throw new Error('Provide synthetic MP4 and poster paths');
const media = new Uint8Array(await readFile(mediaPath)), poster = new Uint8Array(await readFile(posterPath));
const landscape = landscapePath ? new Uint8Array(await readFile(landscapePath)) : media;
const kv = new FakeKV(), db = new FakeD1(), r2 = new FakeR2();
const store = new Store(kv.asKV(), db.asD1(), r2.asR2());
const port = Number(process.env.REELS_QA_PORT || 14888), origin = `http://127.0.0.1:${port}`;
const signer = await makeSigner('local-reels-qa');
const env = { X_CLIENT_ID:'fixture', X_CLIENT_SECRET:'fixture', TEAM_DOMAIN:'https://reels-qa.cloudflareaccess.com', POLICY_AUD:'reels-qa', PUBLIC_ORIGIN:origin, OWNER_EMAIL:'owner@example.test', VIDEOS:r2.asR2(), KV:kv.asKV(), DB:db.asD1() };
const jwt = async email => signer.sign({aud:[env.POLICY_AUD],iss:env.TEAM_DOMAIN,exp:Date.now()/1000+3600,email});
const owner = await jwt('owner@example.test'), viewer = await jwt('viewer@example.test');
const requests = [];
for (let i=1;i<=25;i++) {
  const id=String(61000+i), broken=i===25;
  await store.upsertBookmark({post_id:id,posted_at:`2026-10-${String(i).padStart(2,'0')}T00:00:00Z`,text:broken?'Missing fixture':'Synthetic travel video',post_url:`https://x.com/i/status/${id}`,has_video:1,status:'downloaded',error:null,r2_key:`${id}.mp4`,bytes:media.length,duration_ms:12000,preview_url:'https://example.test/poster.jpg',now:'2026-11-06T00:00:00Z'});
  await store.updateMeta(id,{title:broken?'Missing fixture':`Trail study ${String(i).padStart(2,'0')}`,tags:broken?['broken']:['travel',i%2?'outdoors':'city'],favorite:i%2===0},'2026-11-06T00:00:00Z');
  if(!broken) await r2.put(`${id}.mp4`,i===1?landscape:media,{httpMetadata:{contentType:'video/mp4'}});
  await r2.put(`posters/${id}`,poster,{httpMetadata:{contentType:'image/jpeg'}});
}
const server = createServer(async (incoming,outgoing)=>{
  try {
    const url=new URL(incoming.url,origin);
    if(url.pathname==='/__qa/log') {outgoing.setHeader('content-type','application/json');outgoing.end(JSON.stringify(requests));return;}
    if(url.pathname==='/__qa/role') {outgoing.setHeader('set-cookie',`qa-viewer=${url.searchParams.get('viewer')==='1'?'1':'0'}; Path=/; SameSite=Strict`);outgoing.end('ok');return;}
    const headers=new Headers();
    for(const [name,value] of Object.entries(incoming.headers)) if(value) headers.set(name,Array.isArray(value)?value.join(','):value);
    headers.set('cf-access-jwt-assertion',incoming.headers.cookie?.includes('qa-viewer=1')?viewer:owner);
    const body=[];for await(const chunk of incoming) body.push(chunk);
    requests.push({method:incoming.method,path:url.pathname});
    const request=new Request(url,{method:incoming.method,headers,...(body.length?{body:Buffer.concat(body)}:{})});
    const response=await handle(request,env,async input=>{
      if(String(input).endsWith('/cdn-cgi/access/certs')) return Response.json({keys:[signer.jwk]});
      throw new Error('Unexpected outbound request from local fixture');
    });
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {console.error('Local fixture error:',error.message);outgoing.writeHead(500);outgoing.end('fixture error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Reels QA fixture: ${origin}`));
