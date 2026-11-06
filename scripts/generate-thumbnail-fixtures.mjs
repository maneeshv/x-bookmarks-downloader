// Optional fixture regeneration: Node24 + installed ffmpeg. CI uses the committed images.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { posterPixels } from '#test/fixtures/perceptual';
const dir='test/fixtures/thumbnails/';
function chunk(type,bytes){const input=Buffer.concat([Buffer.from(type),bytes]);let crc=0xffffffff;for(const b of input){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const len=Buffer.alloc(4),tail=Buffer.alloc(4);len.writeUInt32BE(bytes.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,input,tail]);}
function png(name,data,w=180,h=160){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const rows=[];for(let y=0;y<h;y++)rows.push(Buffer.from([0]),Buffer.from(data.subarray(y*w*4,(y+1)*w*4)));writeFileSync(dir+name,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]));}
png('original.png',posterPixels(180,160));png('unrelated.png',posterPixels(180,160,2));png('near-miss.png',posterPixels(180,160,.3));
const blank=new Uint8ClampedArray(180*160*4).fill(120);for(let i=3;i<blank.length;i+=4)blank[i]=255;png('blank.png',blank);
const gradient=new Uint8ClampedArray(blank.length);for(let y=0;y<160;y++)for(let x=0;x<180;x++){let i=(y*180+x)*4;gradient[i]=gradient[i+1]=gradient[i+2]=x;gradient[i+3]=255;}png('gradient.png',gradient);
for(const [name,args] of [['original.jpg',['-q:v','2']],['recompressed.jpg',['-q:v','12']],['resized.jpg',['-vf','scale=90:80','-q:v','5']],['crop.png',['-vf','crop=126:112:27:24']]])execFileSync('ffmpeg',['-v','error','-y','-i',dir+'original.png','-frames:v','1',...args,dir+name]);
// This host's ffmpeg has no WebP encoder; browser calibration encodes WebP via Canvas.
console.log('Generated synthetic, non-private PNG/JPEG fixtures.');
