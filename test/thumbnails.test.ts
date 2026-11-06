import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '#src/store';
import { FakeD1, FakeKV, FakeR2 } from '#test/fakes';

const row = (id: string, bytes: number | null = 3, duration = 2000) => ({post_id:id, posted_at:null, text:'video '+id, post_url:'https://x.com/i/status/'+id, has_video:1 as const, status:'downloaded' as const, error:null, r2_key:id+'.mp4',bytes,duration_ms:duration,preview_url:null,now:'2026-11-06T00:00:00Z'});
const setup = () => {const db=new FakeD1(),r2=new FakeR2(),kv=new FakeKV();return {db,r2,store:new Store(kv.asKV(),db.asD1(),r2.asR2())};};
const scan = async () => (await import('#src/thumbnails')).scanThumbnails;

test('thumbnail scan matches actual posters despite different video size/duration; no video/body reads', async()=>{
 const a=setup();for(const [id,bytes,duration] of [['10000',3,2000],['10001',7,8000],['10002',null,9000]] as const){await a.store.upsertBookmark(row(id,bytes,duration));await a.r2.put('posters/'+id,id==='10002'?'xyz':'abc',{httpMetadata:{contentType:'image/jpeg'}});}
 await a.store.upsertBookmark({...row('10003'),r2_key:'10003-1.mp4'});await a.store.upsertBookmark({...row('10004'),error:'partial'});await a.store.upsertBookmark(row('10005'));await a.store.markDeleted('10005','2026-11-06');
 a.r2.get=async()=>{throw new Error('no body reads');};const head=a.r2.head.bind(a.r2);a.r2.head=async key=>{assert.match(key,/^posters\//);return head(key);};
 const batch=await (await scan())(a.store,null);assert.equal(batch.eligible,3);assert.equal(batch.items.length,3);assert.deepEqual(batch.items[0]!.poster,batch.items[1]!.poster);assert.notDeepEqual(batch.items[0]!.poster,batch.items[2]!.poster);assert.equal(batch.nextCursor,null);
});
test('missing/default/unsupported posters, unusable MD5, failed HEAD and invalid sizes stay unverified',async()=>{
 const a=setup();for(let i=10000;i<10008;i++){await a.store.upsertBookmark(row(String(i)));await a.r2.put('posters/'+i,'abc',{httpMetadata:{contentType:'image/jpeg'}});}
 const head=a.r2.head.bind(a.r2);a.r2.head=async key=>{const obj=(await head(key))!;
 switch(key){case 'posters/10000':return null;case 'posters/10001':return {...obj,httpMetadata:{contentType:'image/svg+xml'}};case 'posters/10002':return {...obj,checksums:{}} as any;case 'posters/10003':return {...obj,checksums:{md5:new ArrayBuffer(15)}};case 'posters/10004':throw new Error('secret');case 'posters/10005':return {...obj,size:0};case 'posters/10006':return {...obj,size:6*1024**2};case 'posters/10007':return {...obj,httpMetadata:undefined} as any;default:return obj;}};
 const batch=await(await scan())(a.store,null);assert.ok(batch.items.every(i=>!i.poster&&i.reason));assert.equal(batch.items[0]!.reason,'missing_poster');assert.ok(!JSON.stringify(batch).includes('secret'));
});
test('poster scan pages beyond 800 rows with <=100 HEADs and <=4 concurrent reads, no repeat IDs',async()=>{
 const a=setup();for(let i=10000;i<10803;i++){await a.store.upsertBookmark(row(String(i),i));await a.r2.put('posters/'+i,'same',{httpMetadata:{contentType:'image/png'}});}
 let active=0,max=0,heads=0;const head=a.r2.head.bind(a.r2);a.r2.head=async key=>{heads++;active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));try{return await head(key);}finally{active--;}};
 let cursor:string|null=null;const ids:string[]=[];do{heads=0;const batch=await(await scan())(a.store,cursor);assert.ok(heads<=100);assert.equal(batch.eligible,803);ids.push(...batch.items.map(i=>i.row.post_id));cursor=batch.nextCursor;}while(cursor);
 assert.equal(ids.length,803);assert.equal(new Set(ids).size,803);assert.ok(max<=4&&max>1);
});
