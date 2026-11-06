// Synthetic, non-private patterns for pixel and browser-codec calibration.
export function posterPixels(width: number, height: number, variant = 0): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    const wave = Math.sin((u * 3 + v * 2 + variant * .7) * Math.PI) * Math.cos((v * 3 - u + variant * .3) * Math.PI);
    const oval = ((u - .35) ** 2 / .04 + (v - .4) ** 2 / .08) < 1 ? 45 : 0;
    const i = (y * width + x) * 4;
    data[i] = 110 + 75 * wave + oval;
    data[i + 1] = 110 + 65 * Math.sin((v * 2 + u * 3 + variant) * Math.PI) - oval / 2;
    data[i + 2] = 110 + 60 * Math.cos((u * 2 - v * 3 + variant * 2) * Math.PI);
    data[i + 3] = 255;
  }
  return data;
}
