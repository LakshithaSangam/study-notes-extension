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

function roundedRectMask(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function circleHit(sx, sy, cx, cy, r) {
  const dx = sx - cx;
  const dy = sy - cy;
  return dx * dx + dy * dy <= r * r;
}

// Tests whether (sx, sy) falls inside a note of size w x h, centered at
// (cx, cy) and rotated by angleDeg. Returns local box coords (0..w, 0..h)
// plus whether the point falls in the folded bottom-right corner.
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

// "Ls" mark rendered as a straight-line stroked path (a polyline, not a
// discrete grid), so it stays crisp and legible without looking cursive.
function distToPolyline(px, py, pts) {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < min) min = d;
  }
  return min;
}

function pt(x, y) {
  return { x, y };
}

// Points are in a 0..1 unit box per letter; scaled by the caller. Straight
// segments only — a plain geometric L, and an S built from square turns.
const LETTER_L_PTS = [pt(0.28, 0.04), pt(0.28, 0.88), pt(0.85, 0.85)];
const LETTER_S_PTS = [
  pt(0.78, 0.1),
  pt(0.16, 0.1),
  pt(0.16, 0.48),
  pt(0.78, 0.48),
  pt(0.78, 0.9),
  pt(0.16, 0.9),
];

function inStraightLetter(lx, ly, w, h, strokeR, pts) {
  const ux = lx / w;
  const uy = ly / h;
  if (ux < -0.2 || ux > 1.2 || uy < -0.2 || uy > 1.2) return false;
  return distToPolyline(ux, uy, pts) * Math.min(w, h) <= strokeR;
}

function makeIcon(size) {
  const radius = size * 0.22;
  const rows = [];
  const bgTop = [138, 90, 53]; // coffee
  const bgBottom = [74, 47, 24]; // deeper coffee
  const noteTop = [246, 234, 208]; // parchment
  const noteBottom = [223, 196, 146]; // deeper parchment
  const lineColor = [170, 138, 92]; // faint written lines
  const foldShadow = [58, 42, 24]; // folded corner underside

  // A fanned stack of notes in different colours — echoing the extension's
  // colour-coded bookmarks/highlights — with the parchment note on top.
  const stackNotes = [
    { cx: size * 0.34, cy: size * 0.62, w: size * 0.44, h: size * 0.44, angle: -13, color: [141, 184, 216], foldFrac: 0.28 },
    { cx: size * 0.5, cy: size * 0.66, w: size * 0.44, h: size * 0.44, angle: 10, color: [227, 184, 105], foldFrac: 0.28 },
  ];
  const frontNote = { cx: size * 0.4, cy: size * 0.64, w: size * 0.48, h: size * 0.48, angle: -2, foldFrac: 0.3 };

  // A small "Ls" + floral cluster in the top-right corner, echoing the
  // signature used elsewhere in the extension (welcome page, popup footer).
  const letterH = size * 0.24;
  const letterW = size * 0.15;
  const letterGap = size * 0.03;
  const letterStrokeR = size * 0.017;
  const letterStartX = size * 0.44;
  const letterStartY = size * 0.03;

  const flowerCx = size * 0.86;
  const flowerCy = size * 0.185;
  const petalR = size * 0.06;
  const petals = [
    { cx: flowerCx, cy: flowerCy - petalR * 0.65, r: petalR, color: [214, 137, 137] },
    { cx: flowerCx + petalR * 0.7, cy: flowerCy + petalR * 0.3, r: petalR * 0.9, color: [232, 167, 167] },
    { cx: flowerCx - petalR * 0.1, cy: flowerCy + petalR * 0.8, r: petalR * 0.9, color: [179, 97, 95] },
    { cx: flowerCx - petalR * 0.75, cy: flowerCy + petalR * 0.15, r: petalR * 0.85, color: [232, 167, 167] },
  ];
  const flowerCenter = { cx: flowerCx, cy: flowerCy, r: petalR * 0.38, color: [92, 31, 20] };

  const SS = 4; // supersampling factor for smoother edges

  for (let y = 0; y < size; y++) {
    const filter = Buffer.from([0]);
    const row = Buffer.alloc(size * 4);
    for (let x = 0; x < size; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const sx = x + (si + 0.5) / SS;
          const sy = y + (sj + 0.5) / SS;
          if (!roundedRectMask(sx, sy, size, radius)) continue;

          const t = sy / size;
          let r = lerp(bgTop[0], bgBottom[0], t);
          let g = lerp(bgTop[1], bgBottom[1], t);
          let b = lerp(bgTop[2], bgBottom[2], t);

          const outlineW = size * 0.02;
          const outline = [42, 27, 15];

          for (const note of stackNotes) {
            const hit = rotatedNoteHit(sx, sy, note.cx, note.cy, note.w, note.h, note.angle, note.foldFrac);
            if (hit) {
              const cornerDist = note.w - hit.lx + (note.h - hit.ly);
              const foldThresh = Math.min(note.w, note.h) * note.foldFrac;
              const nearEdge =
                hit.lx < outlineW || hit.lx > note.w - outlineW || hit.ly < outlineW || hit.ly > note.h - outlineW || Math.abs(cornerDist - foldThresh) < outlineW;
              if (nearEdge) {
                r = outline[0];
                g = outline[1];
                b = outline[2];
              } else if (hit.fold) {
                r = foldShadow[0];
                g = foldShadow[1];
                b = foldShadow[2];
              } else {
                r = note.color[0];
                g = note.color[1];
                b = note.color[2];
              }
            }
          }

          const front = rotatedNoteHit(sx, sy, frontNote.cx, frontNote.cy, frontNote.w, frontNote.h, frontNote.angle, frontNote.foldFrac);
          if (front) {
            const w = frontNote.w;
            const h = frontNote.h;
            const cornerDist = w - front.lx + (h - front.ly);
            const foldThresh = Math.min(w, h) * frontNote.foldFrac;
            const nearEdge = front.lx < outlineW || front.lx > w - outlineW || front.ly < outlineW || front.ly > h - outlineW || Math.abs(cornerDist - foldThresh) < outlineW;
            if (nearEdge) {
              r = outline[0];
              g = outline[1];
              b = outline[2];
            } else if (front.fold) {
              r = foldShadow[0];
              g = foldShadow[1];
              b = foldShadow[2];
            } else {
              const nt = front.ly / h;
              r = lerp(noteTop[0], noteBottom[0], nt);
              g = lerp(noteTop[1], noteBottom[1], nt);
              b = lerp(noteTop[2], noteBottom[2], nt);
              const onLine =
                (front.ly >= h * 0.27 && front.ly <= h * 0.34 && front.lx >= w * 0.16 && front.lx <= w * 0.8) ||
                (front.ly >= h * 0.47 && front.ly <= h * 0.54 && front.lx >= w * 0.16 && front.lx <= w * 0.8) ||
                (front.ly >= h * 0.65 && front.ly <= h * 0.72 && front.lx >= w * 0.16 && front.lx <= w * 0.62);
              if (onLine) {
                r = lineColor[0];
                g = lineColor[1];
                b = lineColor[2];
              }
            }
          }

          const llx = sx - letterStartX;
          const lly = sy - letterStartY;
          if (inStraightLetter(llx, lly, letterW, letterH, letterStrokeR, LETTER_L_PTS)) {
            r = 30;
            g = 20;
            b = 12;
          }
          if (inStraightLetter(llx, lly, letterW, letterH, letterStrokeR * 0.62, LETTER_L_PTS)) {
            r = noteTop[0];
            g = noteTop[1];
            b = noteTop[2];
          }
          const slx = sx - (letterStartX + letterW + letterGap);
          const sly = sy - letterStartY;
          if (inStraightLetter(slx, sly, letterW, letterH, letterStrokeR, LETTER_S_PTS)) {
            r = 30;
            g = 20;
            b = 12;
          }
          if (inStraightLetter(slx, sly, letterW, letterH, letterStrokeR * 0.62, LETTER_S_PTS)) {
            r = 214;
            g = 137;
            b = 137;
          }

          for (const p of petals) {
            if (circleHit(sx, sy, p.cx, p.cy, p.r)) {
              r = p.color[0];
              g = p.color[1];
              b = p.color[2];
            }
          }
          if (circleHit(sx, sy, flowerCenter.cx, flowerCenter.cy, flowerCenter.r)) {
            r = flowerCenter.color[0];
            g = flowerCenter.color[1];
            b = flowerCenter.color[2];
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
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = makeIcon(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`wrote icon${size}.png (${png.length} bytes)`);
}
