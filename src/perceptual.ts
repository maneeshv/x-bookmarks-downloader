export type PosterHash = { version: string; bits: string; rgb: number[]; aspect: number };

// Self-contained for browser serialization; all policy belongs to this version.
export function createPerceptualTools() {
  return {
    version: 'dhash-rgb-v1',
    limits: { entries: 500, bytes: 32 * 1024 ** 2, imageBytes: 1024 ** 2, pairs: 100, pixels: 4_000_000, side: 4096 },
    dimensions(data: Uint8Array, mime: string): { width: number; height: number } | null {
      let width = 0, height = 0;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (mime === 'image/png') {
        if (data.length < 33 || ![137,80,78,71,13,10,26,10].every((n,i) => data[i] === n)
          || view.getUint32(12) !== 0x49484452) return null;
        width = view.getUint32(16); height = view.getUint32(20);
        for (let offset = 8; offset + 12 <= data.length;) {
          const length = view.getUint32(offset), type = view.getUint32(offset + 4);
          if (type === 0x6163544c) return null; // Animated PNG isn't a single poster.
          if (type === 0x49444154) break;
          offset += 12 + length;
        }
      } else if (mime === 'image/jpeg') {
        if (data[0] !== 255 || data[1] !== 216) return null;
        for (let offset = 2; offset + 4 <= data.length;) {
          if (data[offset++] !== 255) return null;
          while (data[offset] === 255) offset++;
          const marker = data[offset++];
          if (marker === 0xda || marker === 0xd9 || offset + 2 > data.length) break;
          const length = view.getUint16(offset);
          if (length < 2 || offset + length > data.length) return null;
          if ([0xc0,0xc1,0xc2].includes(marker!)) {
            if (length < 8) return null;
            height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
          }
          offset += length;
        }
      } else if (mime === 'image/webp') {
        if (data.length < 30 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) return null;
        const chunk = view.getUint32(12);
        if (chunk === 0x56503858) {
          if (data[20]! & 2) return null; // Animated WebP.
          width = 1 + data[24]! + (data[25]! << 8) + (data[26]! << 16);
          height = 1 + data[27]! + (data[28]! << 8) + (data[29]! << 16);
        } else if (chunk === 0x56503820 && data[23] === 0x9d && data[24] === 1 && data[25] === 0x2a) {
          width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
        } else if (chunk === 0x5650384c && data[20] === 0x2f) {
          const bits = view.getUint32(21, true);
          width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
        }
      }
      return width >= 9 && height >= 8 && width <= this.limits.side && height <= this.limits.side && width * height <= this.limits.pixels ? { width, height } : null;
    },
    fingerprint(data: Uint8ClampedArray, width: number, height: number): PosterHash | null {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 9 || height < 8 || width > this.limits.side || height > this.limits.side || width * height > this.limits.pixels || data.length !== width * height * 4) return null;
      const rgb: number[] = [], gray: number[] = [];
      for (let by = 0; by < 8; by++) for (let bx = 0; bx < 9; bx++) {
        const x0 = Math.floor(bx * width / 9), x1 = Math.floor((bx + 1) * width / 9), y0 = Math.floor(by * height / 8), y1 = Math.floor((by + 1) * height / 8);
        let r = 0, g = 0, b = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4, alpha = data[i + 3]!;
          r += Math.floor((data[i]! * alpha + 127) / 255); g += Math.floor((data[i + 1]! * alpha + 127) / 255); b += Math.floor((data[i + 2]! * alpha + 127) / 255);
        }
        const n = (x1 - x0) * (y1 - y0);
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        rgb.push(r, g, b); gray.push((77 * r + 150 * g + 29 * b + 128) >> 8);
      }
      let bits = '', strong = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const delta = gray[y * 9 + x]! - gray[y * 9 + x + 1]!;
        bits += delta > 0 ? '1' : '0'; if (Math.abs(delta) >= 8) strong++;
      }
      const mean = gray.reduce((sum,n) => sum + n, 0) / gray.length;
      const variance = gray.reduce((sum,n) => sum + (n - mean) ** 2, 0) / gray.length;
      const ones = [...bits].filter(bit => bit === '1').length;
      if (variance < 18 ** 2 || strong < 12 || ones < 8 || ones > 56) return null;
      return { version: this.version, bits, rgb, aspect: width / height };
    },
    compare(a: PosterHash, b: PosterHash): { distance: number; similarity: number } | null {
      if (!a || !b || a.version !== this.version || b.version !== this.version || a.bits.length !== 64 || b.bits.length !== 64 || a.rgb.length !== 216 || b.rgb.length !== 216 || Math.abs(a.aspect / b.aspect - 1) > .03) return null;
      let distance = 0, color = 0;
      for (let i = 0; i < 64; i++) if (a.bits[i] !== b.bits[i]) distance++;
      for (let i = 0; i < 216; i++) color += Math.abs(a.rgb[i]! - b.rgb[i]!);
      return distance <= 3 && color / 216 <= 18 ? { distance, similarity: 100 * (1 - distance / 64) } : null;
    },
  };
}
