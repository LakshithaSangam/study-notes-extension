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

function roundedRectMask(x, y, w, h, radius) {
  const cx = Math.min(Math.max(x, radius), w - radius);
  const cy = Math.min(Math.max(y, radius), h - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function circleHit(sx, sy, cx, cy, r) {
  const dx = sx - cx;
  const dy = sy - cy;
  return dx * dx + dy * dy <= r * r;
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

function makeHero(width, height) {
  const radius = 26;
  const rows = [];
  const bgTop = [138, 90, 53];
  const bgBottom = [58, 39, 20];
  const noteTop = [246, 234, 208];
  const noteBottom = [223, 196, 146];
  const lineColor = [170, 138, 92];
  const foldShadow = [58, 42, 24];
  const outline = [42, 27, 15];

  const notes = [
    { cx: width * 0.38, cy: height * 0.56, w: height * 0.62, h: height * 0.62, angle: -14, color: [141, 184, 216], foldFrac: 0.26 },
    { cx: width * 0.52, cy: height * 0.6, w: height * 0.62, h: height * 0.62, angle: 11, color: [227, 184, 105], foldFrac: 0.26 },
    { cx: width * 0.45, cy: height * 0.58, w: height * 0.68, h: height * 0.68, angle: -2, color: null, foldFrac: 0.28 },
  ];

  const flowerCx = width * 0.83;
  const flowerCy = height * 0.28;
  const petalR = height * 0.055;
  const petals = [
    { cx: flowerCx, cy: flowerCy - petalR * 0.65, r: petalR, color: [214, 137, 137] },
    { cx: flowerCx + petalR * 0.7, cy: flowerCy + petalR * 0.3, r: petalR * 0.9, color: [232, 167, 167] },
    { cx: flowerCx - petalR * 0.1, cy: flowerCy + petalR * 0.8, r: petalR * 0.9, color: [179, 97, 95] },
    { cx: flowerCx - petalR * 0.75, cy: flowerCy + petalR * 0.15, r: petalR * 0.85, color: [232, 167, 167] },
  ];

  const SS = 3;
  const outlineW = 4.5;

  for (let y = 0; y < height; y++) {
    const filter = Buffer.from([0]);
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const sx = x + (si + 0.5) / SS;
          const sy = y + (sj + 0.5) / SS;
          if (!roundedRectMask(sx, sy, width, height, radius)) continue;

          const t = sy / height;
          let r = lerp(bgTop[0], bgBottom[0], t);
          let g = lerp(bgTop[1], bgBottom[1], t);
          let b = lerp(bgTop[2], bgBottom[2], t);

          for (const note of notes) {
            const hit = rotatedNoteHit(sx, sy, note.cx, note.cy, note.w, note.h, note.angle, note.foldFrac);
            if (!hit) continue;
            const cornerDist = note.w - hit.lx + (note.h - hit.ly);
            const foldThresh = Math.min(note.w, note.h) * note.foldFrac;
            const nearEdge = hit.lx < outlineW || hit.lx > note.w - outlineW || hit.ly < outlineW || hit.ly > note.h - outlineW || Math.abs(cornerDist - foldThresh) < outlineW;
            if (nearEdge) {
              r = outline[0];
              g = outline[1];
              b = outline[2];
            } else if (hit.fold) {
              r = foldShadow[0];
              g = foldShadow[1];
              b = foldShadow[2];
            } else if (note.color) {
              r = note.color[0];
              g = note.color[1];
              b = note.color[2];
            } else {
              const nt = hit.ly / note.h;
              r = lerp(noteTop[0], noteBottom[0], nt);
              g = lerp(noteTop[1], noteBottom[1], nt);
              b = lerp(noteTop[2], noteBottom[2], nt);
              const w = note.w;
              const h = note.h;
              const onLine =
                (hit.ly >= h * 0.24 && hit.ly <= h * 0.3 && hit.lx >= w * 0.14 && hit.lx <= w * 0.78) ||
                (hit.ly >= h * 0.42 && hit.ly <= h * 0.48 && hit.lx >= w * 0.14 && hit.lx <= w * 0.78) ||
                (hit.ly >= h * 0.6 && hit.ly <= h * 0.66 && hit.lx >= w * 0.14 && hit.lx <= w * 0.6) ||
                (hit.ly >= h * 0.78 && hit.ly <= h * 0.84 && hit.lx >= w * 0.14 && hit.lx <= w * 0.68);
              if (onLine) {
                r = lineColor[0];
                g = lineColor[1];
                b = lineColor[2];
              }
            }
          }

          for (const p of petals) {
            if (circleHit(sx, sy, p.cx, p.cy, p.r)) {
              r = p.color[0];
              g = p.color[1];
              b = p.color[2];
            }
          }
          const centerR = petalR * 0.38;
          if (circleHit(sx, sy, flowerCx, flowerCy, centerR)) {
            r = 92;
            g = 31;
            b = 20;
          }

          rSum += r;
          gSum += g;
          bSum += b;
          aSum += 255;
        }
      }
      const samples = SS * SS;
      const i = x * 4;
      row[i] = Math.round(rSum / samples);
      row[i + 1] = Math.round(gSum / samples);
      row[i + 2] = Math.round(bSum / samples);
      row[i + 3] = Math.round(aSum / samples);
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
const png = makeHero(1000, 400);
fs.writeFileSync(path.join(outDir, "hero.png"), png);
console.log(`wrote docs/hero.png (${png.length} bytes)`);
