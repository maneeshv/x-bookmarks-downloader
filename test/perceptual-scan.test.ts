import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPerceptualTools } from '#src/perceptual';
import { posterPixels } from '#test/fixtures/perceptual';
import * as scanner from '#src/perceptual-scan';
import type { PosterRequest } from '#src/perceptual-scan';
import type { ThumbnailItem } from '#src/thumbnails';
const png=()=>{const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(b.buffer).setUint32(16,90);new DataView(b.buffer).setUint32(20,80);return b;};
const entry=(id:number,md5=String(id).padStart(32,'0')):ThumbnailItem=>({row:{post_id:String(id),r2_key:id+'.mp4',bytes:id,duration_ms:id*1000} as any,poster:{bytes:33,md5},reason:null});
const setup=(pages:ThumbnailItem[][])=>{
 const tools=createPerceptualTools(),requests:string[]=[],bodies=png();let page=0,active=0,max=0;
 const platform={fetch:async(url:string,init?:PosterRequest)=>{requests.push(url);assert.equal(init?.credentials,'same-origin');assert.equal(init?.redirect,'error');
 if(url.startsWith('/api/')){const items=pages[page++]!;return Response.json({items,eligible:pages.flat().length,nextCursor:page<pages.length?items.at(-1)!.row.post_id:null});}
 assert.match(url,/^\/p\/\d+$/);active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));active--;return new Response(bodies,{headers:{'content-type':'image/png'}});},
 decode:async()=>({data:posterPixels(90,80),width:90,height:80,preview:'data:image/jpeg;base64,fixture'}),yield:async()=>{}};
 return {tools,requests,platform,max:()=>max,runner:()=>scanner.createPerceptualScanner(tools,platform)};
};
test('paged browser scan compares pairs across pages, excludes exact posters/known video pairs, does not merge',async()=>{
 const a=setup([[entry(10000),entry(10001)],[entry(10002,'00000000000000000000000000010000')]]),pairs:any[]=[];
 const out=await a.runner().run({signal:new AbortController().signal,onProgress(){},onPair:p=>pairs.push(p),excludePair:(x,y)=>x==='10001'&&y==='10002'});
 assert.equal(out.status,'complete');assert.equal(out.checked,3);assert.equal(pairs.length,1);assert.equal(pairs[0].similarity,100);assert.equal(pairs[0].aPreview,'data:image/jpeg;base64,fixture');assert.equal(out.bytes,66);assert.equal(a.max(),1);
 assert.ok(a.requests.every(u=>u.startsWith('/p/')||u.startsWith('/api/duplicates/thumbnails')));
});
test('missing posters, SVG placeholders, truncated bodies, decoder failures and low detail remain skipped',async()=>{
 const a=setup([[{...entry(10000),poster:null,reason:'missing_poster'},entry(10001),entry(10002),entry(10003),entry(10004)]]);
 const original=a.platform.fetch; a.platform.fetch=async(url,init)=>url==='/p/10001'?new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}):url==='/p/10002'?new Response(new Uint8Array(2),{headers:{'content-type':'image/png'}}):original(url,init);
 let n=0;a.platform.decode=async()=>{if(n++===0)throw new Error('decode');return {data:new Uint8ClampedArray(90*80*4),width:90,height:80,preview:''};};
 const out=await a.runner().run({signal:new AbortController().signal,onProgress(){},onPair(){assert.fail('no match');}});
 assert.equal(out.skipped,5);assert.equal(out.hashed,0);assert.equal(out.status,'complete');assert.equal(out.checked,5);
});
test('entry, total-byte and pair caps stop honestly before unbounded work',async()=>{
 for(const cap of ['entries','bytes','pairs'] as const){
 const a=setup([[entry(10000),entry(10001),entry(10002),entry(10003)]]);a.tools.limits[cap]=cap==='bytes'?50:2;
 const out=await a.runner().run({signal:new AbortController().signal,onProgress(){},onPair(){}});
 assert.equal(out.status,'limited');assert.ok(out.bytes<=a.tools.limits.bytes);assert.ok(out.checked<=a.tools.limits.entries);assert.ok(out.pairs<=a.tools.limits.pairs);}
});
test('cancellation aborts an active thumbnail read and cannot publish later matches',async()=>{
 const a=setup([[entry(10000),entry(10001)]]),controller=new AbortController();const original=a.platform.fetch;
 a.platform.fetch=async(url,init)=>{if(url.startsWith('/api/'))return original(url,init);return new Promise((_,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));controller.abort();});};
 const out=await a.runner().run({signal:controller.signal,onProgress(){},onPair(){assert.fail('cancelled');}});
 assert.equal(out.status,'cancelled');assert.equal(out.hashed,0);assert.equal(a.requests.filter(u=>u.startsWith('/api/')).length,1);
});

test('entry cap prevents requesting another metadata page',async()=>{
 const a=setup([[entry(10000),entry(10001)],[entry(10002)]]);a.tools.limits.entries=2;
 const out=await a.runner().run({signal:new AbortController().signal,onProgress(){},onPair(){}});
 assert.equal(out.status,'limited');assert.equal(a.requests.filter(u=>u.startsWith('/api/')).length,1);
});

test('oversized streamed chunk is counted and prevents further poster reads at budget',async()=>{
 const a=setup([[entry(10000),entry(10001)]]);a.tools.limits.bytes=50;const original=a.platform.fetch;let reads=0;
 a.platform.fetch=async(url,init)=>{if(url.startsWith('/api/'))return original(url,init);reads++;return new Response(new Uint8Array(60),{headers:{'content-type':'image/png'}});};
 const out=await a.runner().run({signal:new AbortController().signal,onProgress(){},onPair(){assert.fail('oversized');}});
 assert.equal(out.bytes,60);assert.equal(out.status,'limited');assert.equal(out.skipped,1);assert.equal(reads,1);
});
test('oversized metadata skips body; metadata failure reports partial results',async()=>{
 const e=entry(10000);e.poster!.bytes=2*1024*1024;const a=setup([[e],[entry(10001)]]);const original=a.platform.fetch;let calls=0;
 a.platform.fetch=async(url,init)=>{if(++calls===2)return new Response('',{status:503});return original(url,init);};
 const out=await a.runner().run({signal:new AbortController().signal,onProgress(){},onPair(){assert.fail('no match');}});
 assert.equal(out.status,'failed');assert.equal(out.checked,1);assert.equal(out.skipped,1);assert.equal(out.bytes,0);assert.ok(a.requests.every(u=>u.startsWith('/api/')));
});
test('cancel during native decode discards its result',async()=>{
 const a=setup([[entry(10000),entry(10001)]]),controller=new AbortController();
 a.platform.decode=async()=>{controller.abort();return {data:posterPixels(90,80),width:90,height:80,preview:''};};
 const out=await a.runner().run({signal:controller.signal,onProgress(){},onPair(){assert.fail('cancelled');}});
 assert.equal(out.status,'cancelled');assert.equal(out.hashed,0);assert.equal(out.checked,0);
});

test('accepts the full existing post-ID range without truncating IDs',async()=>{
 const e=entry(10000);e.row.post_id='1234567890123456789012345';const a=setup([[e]]);
 const out=await a.runner().run({signal:new AbortController().signal,onProgress(){},onPair(){}});
 assert.equal(out.status,'complete');assert.equal(out.hashed,1);assert.ok(a.requests.includes('/p/'+e.row.post_id));
});
