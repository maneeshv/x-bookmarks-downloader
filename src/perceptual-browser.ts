// Kept as browser source: Workers has no Canvas decoder. Used by UI and codec calibration.
export const POSTER_DECODER = `(tools)=>({
 async decode(bytes,mime,dimensions){
  if(typeof createImageBitmap!=='function')throw new Error('decoder unavailable');
  const bitmap=await createImageBitmap(new Blob([bytes],{type:mime}),{imageOrientation:'from-image',premultiplyAlpha:'none',colorSpaceConversion:'none'});
  let canvas;
  try{
   const width=bitmap.width,height=bitmap.height;
   if(width<9||height<8||width>tools.limits.side||height>tools.limits.side||width*height>tools.limits.pixels||!((width===dimensions.width&&height===dimensions.height)||(width===dimensions.height&&height===dimensions.width)))throw new Error('dimensions');
   canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const context=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});if(!context)throw new Error('canvas');
   context.drawImage(bitmap,0,0);
   const data=context.getImageData(0,0,width,height,{colorSpace:'srgb'}).data;
   const scale=Math.min(1,192/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
   context.drawImage(bitmap,0,0,canvas.width,canvas.height);const preview=canvas.toDataURL('image/jpeg',.7);
   return {data,width,height,preview:preview.length<=32768?preview:''};
  }finally{bitmap.close();if(canvas){canvas.width=0;canvas.height=0;}}
 }
})`;
