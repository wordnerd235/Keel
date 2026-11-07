// On-device text recognition for Card File: PaddleOCR (PP-OCRv4) models run with ONNX Runtime Web.
// Nothing leaves the device. Models and the runtime (~30 MB) download on the first read, then are cached.
//
//   findCard(canvas)  -> the card's outline in the photo (edge finding, no AI)
//   readImage(blob)   -> { lines: [{ text, x, y, w, h, conf }], box, rotate, card: bool }
//
// Pipeline per photo: find the card and straighten it -> detect text boxes (DB model) -> work out which way
// is up (sideways text -> turn 90°, the angle classifier catches upside-down) -> recognize each box (CRNN)
// -> group boxes into lines.

const BASE = new URL("./", import.meta.url);
let models = null;

async function load() {
  if (models) return models;
  const ort = await import("./vendor/ort/ort.wasm.bundle.min.mjs");
  ort.env.wasm.wasmPaths = new URL("vendor/ort/", BASE).href;
  ort.env.wasm.numThreads = 1; // GitHub Pages can't enable cross-origin isolation, so no threads
  const opts = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const [det, rec, cls, keys] = await Promise.all([
    ort.InferenceSession.create(new URL("ocr-models/det.onnx", BASE).href, opts),
    ort.InferenceSession.create(new URL("ocr-models/rec.onnx", BASE).href, opts),
    ort.InferenceSession.create(new URL("ocr-models/cls.onnx", BASE).href, opts),
    fetch(new URL("ocr-models/keys.txt", BASE)).then((r) => r.text()),
  ]);
  const list = keys.split(/\r?\n/);
  if (list.length && list[list.length - 1] === "") list.pop(); // trailing newline, not a character
  models = { ort, det, rec, cls, keys: list };
  return models;
}
export const warmUp = () => load();

// ---------- canvas helpers ----------
const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const ctx2d = (c) => c.getContext("2d", { willReadFrequently: true });
function rotate90(src, k) { // k quarter turns clockwise
  k = ((k % 4) + 4) % 4;
  if (!k) return src;
  const c = k % 2 ? canvas(src.height, src.width) : canvas(src.width, src.height), g = ctx2d(c);
  g.translate(c.width / 2, c.height / 2); g.rotate((k * Math.PI) / 2);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// ---------- finding the card ----------
// A card is a bright-ish rectangle on a background. Try a few ways of separating it from the background
// (brightness either way, and color distance from the photo's border), keep the blob that best fills a
// card-shaped rectangle, and fit the smallest rectangle around it (any angle).
export function findCard(src) {
  const S = 360 / Math.max(src.width, src.height), w = Math.round(src.width * S), h = Math.round(src.height * S);
  const c = canvas(w, h), g = ctx2d(c);
  g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, n = w * h;
  const gray = new Float32Array(n), r = new Float32Array(n), gr = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { r[i] = px[i * 4]; gr[i] = px[i * 4 + 1]; b[i] = px[i * 4 + 2]; gray[i] = 0.299 * r[i] + 0.587 * gr[i] + 0.114 * b[i]; }
  // background color = median of the outer frame
  const frame = [];
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) frame.push(y * w + x);
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) frame.push(y * w + x);
  const med = (arr) => { const v = frame.map((i) => arr[i]).sort((a, z) => a - z); return v[v.length >> 1]; };
  const br = med(r), bg = med(gr), bb = med(b);
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = Math.hypot(r[i] - br, gr[i] - bg, b[i] - bb);

  const candidates = [];
  const tryMask = (vals, invert, label) => {
    const sm = blur(vals, w, h, 2), t = otsu(sm);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = (invert ? sm[i] < t : sm[i] > t) ? 1 : 0;
    const best = bestBlob(fillHoles(close(mask, w, h, 2), w, h), w, h);
    if (best) candidates.push({ ...best, label });
  };
  // Edges: a card's border is a closed outline even when its color is close to the table's.
  const gsm = blur(gray, w, h, 1), mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = gsm[i + 1 - w] + 2 * gsm[i + 1] + gsm[i + 1 + w] - gsm[i - 1 - w] - 2 * gsm[i - 1] - gsm[i - 1 + w];
    const gy = gsm[i + w - 1] + 2 * gsm[i + w] + gsm[i + w + 1] - gsm[i - w - 1] - 2 * gsm[i - w] - gsm[i - w + 1];
    mag[i] = Math.hypot(gx, gy);
  }
  const sorted = Array.from(mag).sort((a, z) => a - z), et = Math.max(8, sorted[Math.floor(n * 0.85)]);
  const edges = new Uint8Array(n);
  for (let i = 0; i < n; i++) edges[i] = mag[i] > et ? 1 : 0;
  const eb = bestBlob(fillHoles(close(edges, w, h, 2), w, h), w, h);
  if (eb) candidates.push({ ...eb, label: "edges" });
  tryMask(dist, false, "color");
  tryMask(gray, false, "bright");
  tryMask(gray, true, "dark");
  if (!candidates.length) return null;
  candidates.sort((a, z) => z.score - a.score);
  const best = candidates[0];
  if (best.score < 0.55) return null;
  return { corners: best.corners.map(([x, y]) => [x / S, y / S]), angle: best.angle, fill: best.fill, label: best.label };
}

function blur(src, w, h, rad) { // box blur, two passes
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0, cnt = 0;
    for (let x = -rad; x < w + rad; x++) {
      if (x + rad < w) { acc += src[y * w + Math.min(w - 1, Math.max(0, x + rad))]; cnt++; }
      if (x - rad - 1 >= 0) { acc -= src[y * w + x - rad - 1]; cnt--; }
      if (x >= 0 && x < w) tmp[y * w + x] = acc / cnt;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0, cnt = 0;
    for (let y = -rad; y < h + rad; y++) {
      if (y + rad < h) { acc += tmp[Math.min(h - 1, Math.max(0, y + rad)) * w + x]; cnt++; }
      if (y - rad - 1 >= 0) { acc -= tmp[(y - rad - 1) * w + x]; cnt--; }
      if (y >= 0 && y < h) out[y * w + x] = acc / cnt;
    }
  }
  return out;
}

// Anything enclosed by the mask (text on a card, a card inside its outline) becomes part of it.
function fillHoles(mask, w, h) {
  const n = w * h, outside = new Uint8Array(n), q = new Int32Array(n);
  let head = 0, tail = 0;
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; q[tail++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const p = q[head++], x = p % w;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < n - w) push(p + w);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

function otsu(vals) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 1e-6) return hi + 1;
  const hist = new Float64Array(256), k = 255 / (hi - lo);
  for (const v of vals) hist[Math.round((v - lo) * k)]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, bestT = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = vals.length - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestT = i; }
  }
  return lo + (bestT + 0.5) / k;
}

function close(mask, w, h, rad) { // dilate then erode (fills text holes and small gaps)
  const morph = (m, grow) => {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let dy = -rad; dy <= rad && v !== (grow ? 1 : 0); dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          if (grow ? m[yy * w + xx] : !m[yy * w + xx]) { v = grow ? 1 : 0; break; }
        }
      }
      out[y * w + x] = v;
    }
    return out;
  };
  return morph(morph(mask, true), false);
}

// The connected blob that looks most like a card: big, mostly filling its best-fit rectangle,
// card-shaped (long side 1.2 to 2.3 times the short side), and not spilling off the photo.
function bestBlob(mask, w, h) {
  const n = w * h, label = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let best = null, id = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    let head = 0, tail = 0, area = 0, edge = 0;
    const rowMin = new Int32Array(h).fill(w), rowMax = new Int32Array(h).fill(-1);
    queue[tail++] = s; label[s] = id;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p / w) | 0;
      area++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge++;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= n || !mask[q] || label[q] !== -1) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        label[q] = id; queue[tail++] = q;
      }
    }
    id++;
    if (area < n * 0.08 || area > n * 0.97) continue;
    const pts = [];
    for (let y = 0; y < h; y++) if (rowMax[y] >= 0) { pts.push([rowMin[y], y], [rowMax[y] + 1, y], [rowMin[y], y + 1], [rowMax[y] + 1, y + 1]); }
    const rect = minAreaRect(hull(pts));
    const fill = area / rect.area;
    const ratio = Math.max(rect.w, rect.h) / Math.min(rect.w, rect.h);
    const perim = 2 * (w + h);
    if (fill < 0.8 || ratio < 1.2 || ratio > 2.3 || edge > perim * 0.25) continue;
    const score = fill * Math.min(1, area / (n * 0.25)) * (1 - edge / perim);
    if (!best || score > best.score) best = { score, fill, corners: rect.corners, angle: rect.angle };
  }
  return best;
}

function hull(pts) { // monotone chain
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function minAreaRect(h) { // rotating calipers over hull edge angles
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(th), s = Math.sin(th);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of h) { const u = x * c + y * s, v = -x * s + y * c; if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v; }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) {
      const back = (u, v) => [u * c - v * s, u * s + v * c];
      best = { area, w: x1 - x0, h: y1 - y0, angle: th, corners: [back(x0, y0), back(x1, y0), back(x1, y1), back(x0, y1)] };
    }
  }
  return best;
}

// Turn the photo so the card's nearest-to-horizontal edge is level, and crop to the card.
function straighten(src, card) {
  let ang = card.angle;
  while (ang > Math.PI / 4) ang -= Math.PI / 2;
  while (ang <= -Math.PI / 4) ang += Math.PI / 2;
  const cx = card.corners.reduce((a, p) => a + p[0], 0) / 4, cy = card.corners.reduce((a, p) => a + p[1], 0) / 4;
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const local = card.corners.map(([x, y]) => [(x - cx) * c - (y - cy) * s, (x - cx) * s + (y - cy) * c]);
  const W = Math.max(...local.map((p) => p[0])) - Math.min(...local.map((p) => p[0]));
  const H = Math.max(...local.map((p) => p[1])) - Math.min(...local.map((p) => p[1]));
  const out = canvas(W, H), g = ctx2d(out);
  g.fillStyle = "#fff"; g.fillRect(0, 0, out.width, out.height);
  g.translate(out.width / 2, out.height / 2); g.rotate(-ang); g.translate(-cx, -cy);
  g.drawImage(src, 0, 0);
  out.geom = { cx: cx / src.width, cy: cy / src.height, w: W / src.width, h: H / src.width, angle: (ang * 180) / Math.PI };
  return out;
}

// ---------- text detection (DB) ----------
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
async function detect(src) {
  const { ort, det } = await load();
  const k = Math.min(1, 960 / Math.max(src.width, src.height));
  const W = Math.max(32, Math.round((src.width * k) / 32) * 32), H = Math.max(32, Math.round((src.height * k) / 32) * 32);
  const c = canvas(W, H), g = ctx2d(c);
  g.drawImage(src, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data, plane = W * H, data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) { // PaddleOCR reads images as BGR
    data[i] = (px[i * 4 + 2] / 255 - MEAN[0]) / STD[0];
    data[plane + i] = (px[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
    data[2 * plane + i] = (px[i * 4] / 255 - MEAN[2]) / STD[2];
  }
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor("float32", data, [1, 3, H, W]) });
  const prob = out[det.outputNames[0]].data;
  // components of the probability map above 0.3, scored by mean probability, expanded (unclipped) 1.5x
  const mask = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) mask[i] = prob[i] > 0.3 ? 1 : 0;
  const seen = new Uint8Array(plane), queue = new Int32Array(plane), boxes = [];
  const sx = src.width / W, sy = src.height / H;
  for (let s = 0; s < plane; s++) {
    if (!mask[s] || seen[s]) continue;
    let head = 0, tail = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, sum = 0;
    queue[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % W, y = (p / W) | 0;
      sum += prob[p];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue[tail++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; queue[tail++] = p - W; }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; queue[tail++] = p + W; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3 || sum / tail < 0.55) continue;
    const d = (bw * bh * 1.5) / (2 * (bw + bh));
    boxes.push({
      x: Math.max(0, (x0 - d) * sx), y: Math.max(0, (y0 - d) * sy),
      w: Math.min(src.width, (x1 + 1 + d) * sx) - Math.max(0, (x0 - d) * sx),
      h: Math.min(src.height, (y1 + 1 + d) * sy) - Math.max(0, (y0 - d) * sy),
    });
  }
  return boxes;
}

function crop(src, b, H, maxW) {
  const w = Math.max(8, Math.min(maxW, Math.round((H * b.w) / b.h)));
  const c = canvas(w, H);
  ctx2d(c).drawImage(src, b.x, b.y, b.w, b.h, 0, 0, w, H);
  return c;
}
function tensorOf(c, padW) {
  const px = ctx2d(c).getImageData(0, 0, c.width, c.height).data, W = padW || c.width, H = c.height, plane = W * H;
  const data = new Float32Array(3 * plane);
  for (let y = 0; y < H; y++) for (let x = 0; x < c.width; x++) {
    const i = y * c.width + x, o = y * W + x;
    data[o] = px[i * 4 + 2] / 127.5 - 1; data[plane + o] = px[i * 4 + 1] / 127.5 - 1; data[2 * plane + o] = px[i * 4] / 127.5 - 1;
  }
  return { data, W, H };
}

// Probability that each box is upside down (PaddleOCR's 0°/180° direction classifier).
async function upsideDown(src, boxes) {
  const { ort, cls } = await load();
  const pick = boxes.slice().sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 8);
  let votes = 0, weight = 0;
  for (const b of pick) {
    const t = tensorOf(crop(src, b, 48, 192), 192);
    const out = await cls.run({ [cls.inputNames[0]]: new ort.Tensor("float32", t.data, [1, 3, 48, 192]) });
    const p = out[cls.outputNames[0]].data; // [p0, p180]
    votes += p[1] * b.w; weight += b.w;
  }
  return weight ? votes / weight : 0;
}

async function recognize(src, b) {
  const { ort, rec, keys } = await load();
  const t = tensorOf(crop(src, b, 48, 1600));
  const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", t.data, [1, 3, 48, t.W]) });
  const o = out[rec.outputNames[0]], [, T, C] = o.dims, p = o.data;
  let text = "", last = 0, confSum = 0, confN = 0;
  for (let t2 = 0; t2 < T; t2++) {
    let bi = 0, bv = -Infinity;
    for (let k = 0; k < C; k++) { const v = p[t2 * C + k]; if (v > bv) { bv = v; bi = k; } }
    if (bi !== 0 && bi !== last) { text += bi - 1 < keys.length ? keys[bi - 1] : " "; confSum += bv; confN++; }
    last = bi;
  }
  return { text: text.trim(), conf: confN ? confSum / confN : 0 };
}

// Boxes on the same row with a small gap become one line; a big gap (two columns) keeps them apart.
function toLines(items) {
  items = items.filter((i) => i.text).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.cy - (it.y + it.h / 2)) < Math.min(r.h, it.h) * 0.5);
    if (row) { row.items.push(it); } else rows.push({ cy: it.y + it.h / 2, h: it.h, items: [it] });
  }
  const lines = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of r.items) {
      if (cur && it.x - (cur.x + cur.w) < Math.max(cur.h, it.h) * 1.5) {
        cur.text += " " + it.text; cur.w = it.x + it.w - cur.x; cur.h = Math.max(cur.h, it.h); cur.conf = Math.min(cur.conf, it.conf);
      } else { cur = { ...it }; lines.push(cur); }
    }
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

function insideQuad(q, x, y) { // convex quad, either winding
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c !== 0) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); }
  }
  return true;
}
function union(boxes, img, pad) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const mx = (x1 - x0) * pad + 10, my = (y1 - y0) * pad + 10;
  const x = Math.max(0, x0 - mx), y = Math.max(0, y0 - my);
  return { x, y, w: Math.min(img.width, x1 + mx) - x, h: Math.min(img.height, y1 + my) - y };
}

// Read one photo. Returns the lines (in straightened-card coordinates, top to bottom), plus the card's
// box as fractions of the photo and the clockwise turn that makes the text upright.
export async function readImage(blob) {
  await load();
  const bmp = await createImageBitmap(blob);
  const photo = canvas(bmp.width, bmp.height);
  ctx2d(photo).drawImage(bmp, 0, 0);
  let card = findCard(photo);
  const photoBoxes = await detect(photo);
  // Keep the outline only if most of the photo's text is inside it (else it found a logo or a stripe).
  if (card && photoBoxes.length) {
    const inside = photoBoxes.filter((b) => insideQuad(card.corners, b.x + b.w / 2, b.y + b.h / 2)).reduce((a, b) => a + b.w * b.h, 0);
    const total = photoBoxes.reduce((a, b) => a + b.w * b.h, 0);
    if (inside < total * 0.75) card = null;
  }
  const firstBoxes = card ? [] : photoBoxes; // photo coordinates
  let img = photo, straightened = null;
  if (card) img = straightened = straighten(photo, card);
  else if (photoBoxes.length) {
    // No outline: look again, closer, at just the text area.
    const u = union(photoBoxes, photo, 0.08);
    if (u.w * u.h < photo.width * photo.height * 0.6) { const c = canvas(u.w, u.h); ctx2d(c).drawImage(photo, u.x, u.y, u.w, u.h, 0, 0, u.w, u.h); img = c; }
  }
  let boxes = img === photo ? photoBoxes : await detect(img), turns = 0;
  // Mostly tall boxes means the text runs sideways: turn a quarter and look again.
  const tall = boxes.filter((b) => b.h > b.w * 1.5).length;
  if (boxes.length && tall > boxes.length / 2) { turns = 1; img = rotate90(img, 1); boxes = await detect(img); }
  if (boxes.length && (await upsideDown(img, boxes)) > 0.6) { turns += 2; img = rotate90(img, 2); boxes = await detect(img); }
  const items = [];
  for (const b of boxes) { const r = await recognize(img, b); if (r.conf > 0.5) items.push({ ...r, ...b }); }
  // The card's outline in the photo, as a straight box (Card File crops to it, then turns it).
  let box = null;
  const pts = card ? card.corners : null;
  if (pts) {
    const xs = pts.map((p) => p[0] / photo.width), ys = pts.map((p) => p[1] / photo.height);
    box = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(1, Math.max(...xs)), Math.min(1, Math.max(...ys))].map((v) => Math.round(v * 1000) / 1000);
  } else if (firstBoxes.length) {
    // No clear outline (say, a white card on a white table): crop around the text with a margin.
    const x0 = Math.min(...firstBoxes.map((b) => b.x)), y0 = Math.min(...firstBoxes.map((b) => b.y));
    const x1 = Math.max(...firstBoxes.map((b) => b.x + b.w)), y1 = Math.max(...firstBoxes.map((b) => b.y + b.h));
    const mx = (x1 - x0) * 0.1, my = (y1 - y0) * 0.15;
    box = [(x0 - mx) / photo.width, (y0 - my) / photo.height, (x1 + mx) / photo.width, (y1 + my) / photo.height].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000);
  }
  if (box && box[2] - box[0] > 0.97 && box[3] - box[1] > 0.97) box = null; // already fills the photo
  const geom = card ? straightened.geom : null;
  if (geom) for (const k of Object.keys(geom)) geom[k] = Math.round(geom[k] * 10000) / 10000;
  return { lines: toLines(items), box, rotate: ((turns % 4) * 90) % 360, card: geom, size: [img.width, img.height] };
}

// What Card File's "Read card" gets back: its JSON shape, filled from on-device OCR.
export async function readCard(blobs) {
  const { parseCard, mergeSides } = await import("./card-parse.js");
  const sides = [], photos = [];
  for (const b of blobs) {
    const r = await readImage(b);
    sides.push(parseCard(r.lines));
    photos.push({ box: r.box, rotate: r.rotate, card: r.card }); // card: exact tilted outline (Keel's Card File uses it)
  }
  return { ...mergeSides(sides), photos };
}
