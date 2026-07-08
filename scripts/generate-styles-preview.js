const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rotatedNoteHit(sx, sy, cx, cy, w, h, angleDeg, foldFrac) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = sx - cx;
  const dy = sy - cy;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const lx = dx * cos - dy * sin + w / 2;
  const ly = dx * sin + dy * cos + h / 2;
  if (lx < 0 || lx >= w || ly < 0 || ly >= h) return null;
  const cornerDist = w - lx + (h - ly);
  const fold = foldFrac > 0 && cornerDist < Math.min(w, h) * foldFrac;
  return { lx, ly, fold };
}

function inZigzag(lx, ly, w, h) {
  const toothH = 16;
  const cols = 8;
  const colW = w / cols;
  const col = Math.floor(lx / colW);
  const localX = lx - col * colW;
  const peak = col % 2 === 0 ? 0 : toothH;
  const edge = h - toothH + peak - (localX / colW) * 0 - (col % 2 === 0 ? (toothH * (colW - Math.abs(localX - colW / 2) * 2)) / colW : -(toothH * (colW - Math.abs(localX - colW / 2) * 2)) / colW);
  return ly < h - toothH || ly < edge;
}

function makeStylesPreview(width, height) {
  const bgTop = [46, 30, 16];
  const bgBottom = [26, 17, 9];
  const noteTop = [246, 234, 208];
  const noteBottom = [223, 196, 146];
  const lineColor = [170, 138, 92];
  const foldShadow = [58, 42, 24];
  const outline = [42, 27, 15];
  const tapeA = [214, 137, 137];
  const tapeB = [224, 163, 163];

  const noteW = width / 3 - 60;
  const noteH = height * 0.66;
  const centers = [width / 6 + 10, width / 2, (5 * width) / 6 - 10];

  const SS = 3;
  const outlineW = 3.5;

  const rows = [];
  for (let y = 0; y < height; y++) {
    const filter = Buffer.from([0]);
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const sx = x + (si + 0.5) / SS;
          const sy = y + (sj + 0.5) / SS;
          const t = sy / height;
          let r = lerp(bgTop[0], bgBottom[0], t);
          let g = lerp(bgTop[1], bgBottom[1], t);
          let b = lerp(bgTop[2], bgBottom[2], t);

          [0, 1, 2].forEach((idx) => {
            const cx = centers[idx];
            const cy = height * 0.52;
            const angle = idx === 0 ? -3 : idx === 1 ? 2.5 : -1.5;
            if (idx === 1) {
              const w = noteW;
              const h = noteH;
              const rad = (angle * Math.PI) / 180;
              const dx = sx - cx;
              const dy = sy - cy;
              const cos = Math.cos(-rad);
              const sin = Math.sin(-rad);
              const lx = dx * cos - dy * sin + w / 2;
              const ly = dx * sin + dy * cos + h / 2;
              if (lx >= 0 && lx < w && ly >= 0 && ly < h && inZigzag(lx, ly, w, h)) {
                const nt = ly / h;
                r = lerp(noteTop[0], noteBottom[0], nt);
                g = lerp(noteTop[1], noteBottom[1], nt);
                b = lerp(noteTop[2], noteBottom[2], nt);
                const onLine = (ly >= h * 0.2 && ly <= h * 0.26 && lx >= w * 0.15 && lx <= w * 0.85) || (ly >= h * 0.38 && ly <= h * 0.44 && lx >= w * 0.15 && lx <= w * 0.85) || (ly >= h * 0.56 && ly <= h * 0.62 && lx >= w * 0.15 && lx <= w * 0.6);
                if (onLine) {
                  r = lineColor[0];
                  g = lineColor[1];
                  b = lineColor[2];
                }
                if (lx < outlineW || lx > w - outlineW) {
                  r = outline[0];
                  g = outline[1];
                  b = outline[2];
                }
              }
              return;
            }
            const w = noteW;
            const h = noteH;

            const foldFrac = idx === 0 ? 0.28 : 0.3;
            const hit = rotatedNoteHit(sx, sy, cx, cy, noteW, noteH, angle, foldFrac);
            if (hit) {
              const cornerDist = w - hit.lx + (h - hit.ly);
              const foldThresh = Math.min(w, h) * foldFrac;
              const nearEdge = hit.lx < outlineW || hit.lx > w - outlineW || hit.ly < outlineW || hit.ly > h - outlineW || Math.abs(cornerDist - foldThresh) < outlineW;
              if (nearEdge) {
                r = outline[0];
                g = outline[1];
                b = outline[2];
              } else if (hit.fold) {
                r = foldShadow[0];
                g = foldShadow[1];
                b = foldShadow[2];
              } else {
                const nt = hit.ly / h;
                r = lerp(noteTop[0], noteBottom[0], nt);
                g = lerp(noteTop[1], noteBottom[1], nt);
                b = lerp(noteTop[2], noteBottom[2], nt);
                const onLine = (hit.ly >= h * 0.2 && hit.ly <= h * 0.26 && hit.lx >= w * 0.15 && hit.lx <= w * 0.85) || (hit.ly >= h * 0.38 && hit.ly <= h * 0.44 && hit.lx >= w * 0.15 && hit.lx <= w * 0.85) || (hit.ly >= h * 0.56 && hit.ly <= h * 0.62 && hit.lx >= w * 0.15 && hit.lx <= w * 0.6);
                if (onLine) {
                  r = lineColor[0];
                  g = lineColor[1];
                  b = lineColor[2];
                }
              }
            }

            if (idx === 0) {
              const tapeCx = cx - w * 0.28;
              const tapeCy = cy - h / 2 - 4;
              const tdx = sx - tapeCx;
              const tdy = sy - tapeCy;
              const trad = (-8 * Math.PI) / 180;
              const tcos = Math.cos(-trad);
              const tsin = Math.sin(-trad);
              const tlx = tdx * tcos - tdy * tsin;
              const tly = tdx * tsin + tdy * tcos;
              if (Math.abs(tlx) < 26 && Math.abs(tly) < 11) {
                const stripe = Math.floor((tlx + tly) / 6) % 2 === 0;
                r = stripe ? tapeA[0] : tapeB[0];
                g = stripe ? tapeA[1] : tapeB[1];
                b = stripe ? tapeA[2] : tapeB[2];
              }
            }
          });

          rSum += r;
          gSum += g;
          bSum += b;
        }
      }
      const samples = SS * SS;
      const i = x * 4;
      row[i] = Math.round(rSum / samples);
      row[i + 1] = Math.round(gSum / samples);
      row[i + 2] = Math.round(bSum / samples);
      row[i + 3] = 255;
    }
    rows.push(Buffer.concat([filter, row]));
  }

  const raw = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, "..", "docs");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const png = makeStylesPreview(900, 300);
fs.writeFileSync(path.join(outDir, "notestyles.png"), png);
console.log(`wrote docs/notestyles.png (${png.length} bytes)`);
