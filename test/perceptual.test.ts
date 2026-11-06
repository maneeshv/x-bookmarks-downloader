import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posterPixels } from '#test/fixtures/perceptual';
import * as module from '#src/perceptual';

test('versioned full-frame normalization accepts resize, rejects distinct/cropped/low-detail posters', () => {
  const tools = module.createPerceptualTools();
  const original = tools.fingerprint(posterPixels(180,160),180,160)!;
  assert.ok(original); assert.equal(original.version,'dhash-rgb-v1'); assert.equal(original.bits.length,64);
  assert.deepEqual(tools.fingerprint(posterPixels(180,160),180,160),original);
  assert.ok(tools.compare(original,tools.fingerprint(posterPixels(90,80),90,80)!));
  assert.equal(tools.compare(original,tools.fingerprint(posterPixels(180,160,2),180,160)!),null);
  const pixels=posterPixels(180,160),crop=new Uint8ClampedArray(90*160*4);
  for(let y=0;y<160;y++)crop.set(pixels.subarray((y*180+45)*4,(y*180+135)*4),y*90*4);
  assert.equal(tools.compare(original,tools.fingerprint(crop,90,160)!),null);
  for(const value of [0,100,255]) {const blank=new Uint8ClampedArray(90*80*4).fill(value); assert.equal(tools.fingerprint(blank,90,80),null);}
  assert.equal(tools.fingerprint(new Uint8ClampedArray(),0,10),null);
});
test('hash score is pairwise, color/near-miss gates are conservative, no transitive merge',()=>{
 const tools=module.createPerceptualTools(),base=tools.fingerprint(posterPixels(90,80),90,80)!;
 const flip=(bits:string,indices:number[])=>[...bits].map((b,i)=>indices.includes(i)?b==='1'?'0':'1':b).join('');
 const b={...base,bits:flip(base.bits,[0,1,2])},c={...base,bits:flip(base.bits,[0,1,2,3,4,5])};
 assert.equal(tools.compare(base,b)!.distance,3);assert.equal(tools.compare(base,b)!.similarity,95.3125);
 assert.ok(tools.compare(b,c));assert.equal(tools.compare(base,c),null);
 assert.equal(tools.compare(base,{...base,bits:flip(base.bits,[0,1,2,3])}),null);
 assert.equal(tools.compare(base,{...base,rgb:base.rgb.map(n=>n+30)}),null);
 assert.equal(tools.compare(base,{...base,version:'future'}),null);
});
test('encoded dimensions reject placeholders, malformed, animated and oversized files before decoder',()=>{
 const tools=module.createPerceptualTools();
 const png=new Uint8Array(33);png.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
 new DataView(png.buffer).setUint32(16,180);new DataView(png.buffer).setUint32(20,160);
 assert.deepEqual(tools.dimensions(png,'image/png'),{width:180,height:160});
 new DataView(png.buffer).setUint32(16,50000);assert.equal(tools.dimensions(png,'image/png'),null);
 assert.equal(tools.dimensions(new TextEncoder().encode('<svg/>'),'image/svg+xml'),null);
 assert.equal(tools.dimensions(new Uint8Array([255,216,255]),'image/jpeg'),null);
 const jpg=new Uint8Array([255,216,255,192,0,11,8,0,80,0,90,1,1,17,0]);
 assert.deepEqual(tools.dimensions(jpg,'image/jpeg'),{width:90,height:80});
 const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'));webp.set(new TextEncoder().encode('WEBPVP8X'),8);webp[24]=89;webp[27]=79;
 assert.deepEqual(tools.dimensions(webp,'image/webp'),{width:90,height:80});webp[20]=2;assert.equal(tools.dimensions(webp,'image/webp'),null);
});
