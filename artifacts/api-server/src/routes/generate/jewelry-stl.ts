/**
 * jewelry-stl.ts — logo → manufacturing-ready STL pendant model.
 *
 * Pipeline (pure Node, zero native deps):
 *   1. decodePNG — minimal 8-bit PNG decoder (zlib inflate + unfilter)
 *   2. logoToMask — silhouette: alpha-or-luminance → blur → threshold →
 *      largest component → fill holes → morphological close
 *   3. buildPendantSTL — heightfield slab mesh:
 *        - 35mm medallion disc, 2.2mm base + 1.2mm logo relief
 *        - optional 25.5mm NFC tag cavity carved into the back
 *        - torus bail fused at the top for a chain
 *      → binary STL with computed facet normals
 *   4. Volume → weight estimate via metal density
 *
 * The model is watertight (closed heightfield + closed torus) and suitable
 * for wax 3D printing → lost-wax casting. A jeweler CAD review is still
 * recommended before production (noted in the manufacturing guide).
 */
import { inflateSync } from "zlib";

/* ─── Minimal PNG decoder ─────────────────────────────────────────────── */

export interface DecodedImage {
  width: number;
  height: number;
  /** Row-major RGBA. */
  rgba: Uint8Array;
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePNG(buf: Buffer): DecodedImage {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("Not a PNG file (bad signature)");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idatParts: Buffer[] = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 8 + len + 4; // + CRC
  }

  if (!width || !height) throw new Error("PNG missing IHDR");
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth} (need 8-bit)`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");
  if (![0, 2, 3, 4, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG color type: ${colorType}`);
  }

  const raw = inflateSync(Buffer.concat(idatParts));
  const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error("PNG data truncated");

  // Unfilter scanlines (None/Sub/Up/Average/Paeth).
  const px = Buffer.alloc(height * stride);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const cur = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v: number;
      switch (f) {
        case 0: v = cur[x]!; break;
        case 1: v = (cur[x]! + a) & 255; break;
        case 2: v = (cur[x]! + b) & 255; break;
        case 3: v = (cur[x]! + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (cur[x]! + pr) & 255;
          break;
        }
        default: throw new Error(`Unknown PNG filter: ${f}`);
      }
      out[x] = v;
    }
    prev.set(out);
  }

  // Convert to RGBA.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * bpp;
    const d = i * 4;
    if (colorType === 0) {
      const g = px[o]!;
      rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
      rgba[d + 3] = 255;
    } else if (colorType === 2) {
      rgba[d] = px[o]!; rgba[d + 1] = px[o + 1]!; rgba[d + 2] = px[o + 2]!;
      rgba[d + 3] = 255;
    } else if (colorType === 3) {
      const idx = px[o]! * 3;
      rgba[d] = palette?.[idx] ?? 0;
      rgba[d + 1] = palette?.[idx + 1] ?? 0;
      rgba[d + 2] = palette?.[idx + 2] ?? 0;
      rgba[d + 3] = trns && px[o]! < trns.length ? trns[px[o]!]! : 255;
    } else if (colorType === 4) {
      const g = px[o]!;
      rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
      rgba[d + 3] = px[o + 1]!;
    } else {
      rgba[d] = px[o]!; rgba[d + 1] = px[o + 1]!;
      rgba[d + 2] = px[o + 2]!; rgba[d + 3] = px[o + 3]!;
    }
  }
  return { width, height, rgba };
}

/* ─── Silhouette extraction ───────────────────────────────────────────── */

function hasAlpha(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 16) {
    if (rgba[i]! < 250) return true;
  }
  return false;
}

function boxBlur(g: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) {
            s += g[yy * n + xx]!;
            c++;
          }
        }
      }
      out[y * n + x] = s / c;
    }
  }
  return out;
}

function largestComponent(mask: Uint8Array, n: number): Uint8Array {
  const seen = new Uint8Array(n * n);
  let best: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n * n; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const x = cur % n;
      const y = (cur / n) | 0;
      if (x > 0 && mask[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; stack.push(cur - 1); }
      if (x < n - 1 && mask[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; stack.push(cur + 1); }
      if (y > 0 && mask[cur - n] && !seen[cur - n]) { seen[cur - n] = 1; stack.push(cur - n); }
      if (y < n - 1 && mask[cur + n] && !seen[cur + n]) { seen[cur + n] = 1; stack.push(cur + n); }
    }
    if (comp.length > best.length) best = comp;
  }
  const out = new Uint8Array(n * n);
  for (const i of best) out[i] = 1;
  return out;
}

function fillHoles(mask: Uint8Array, n: number): Uint8Array {
  // Flood-fill background from the border; whatever background remains
  // unfilled is a hole → fill it.
  const bg = new Uint8Array(n * n);
  const stack: number[] = [];
  for (let x = 0; x < n; x++) {
    if (!mask[x]) { bg[x] = 1; stack.push(x); }
    const b = (n - 1) * n + x;
    if (!mask[b]) { bg[b] = 1; stack.push(b); }
  }
  for (let y = 0; y < n; y++) {
    const l = y * n;
    if (!mask[l]) { bg[l] = 1; stack.push(l); }
    const r = y * n + n - 1;
    if (!mask[r]) { bg[r] = 1; stack.push(r); }
  }
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % n;
    const y = (cur / n) | 0;
    const nb = [
      x > 0 ? cur - 1 : -1,
      x < n - 1 ? cur + 1 : -1,
      y > 0 ? cur - n : -1,
      y < n - 1 ? cur + n : -1,
    ];
    for (const q of nb) {
      if (q >= 0 && !mask[q] && !bg[q]) { bg[q] = 1; stack.push(q); }
    }
  }
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = mask[i] || !bg[i] ? 1 : 0;
  return out;
}

function morphClose(mask: Uint8Array, n: number): Uint8Array {
  const dil = new Uint8Array(n * n);
  const idx = (x: number, y: number) => y * n + x;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1 && !v; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n && mask[idx(xx, yy)]) v = 1;
        }
      }
      dil[idx(x, y)] = v;
    }
  }
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v; dy++) {
        for (let dx = -1; dx <= 1 && v; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n || !dil[idx(xx, yy)]) v = 0;
        }
      }
      out[idx(x, y)] = v;
    }
  }
  return out;
}

/**
 * Convert a decoded logo to a boolean silhouette mask (gridSize × gridSize).
 * Prefers the alpha channel when present; otherwise uses luminance.
 * Falls back to a full disc when the logo yields no foreground.
 */
export function logoToMask(img: DecodedImage, gridSize: number): Uint8Array {
  const n = gridSize;
  const useAlpha = hasAlpha(img.rgba);
  const acc = new Float32Array(n * n);
  const cnt = new Float32Array(n * n);

  for (let sy = 0; sy < img.height; sy++) {
    const gy = Math.min(n - 1, Math.floor((sy / img.height) * n));
    for (let sx = 0; sx < img.width; sx++) {
      const gx = Math.min(n - 1, Math.floor((sx / img.width) * n));
      const o = (sy * img.width + sx) * 4;
      let v: number;
      if (useAlpha) {
        v = img.rgba[o + 3]! / 255;
      } else {
        v = (0.299 * img.rgba[o]! + 0.587 * img.rgba[o + 1]! + 0.114 * img.rgba[o + 2]!) / 255;
      }
      acc[gy * n + gx]! += v;
      cnt[gy * n + gx]! += 1;
    }
  }
  const gray = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) gray[i] = cnt[i] ? acc[i]! / cnt[i]! : 0;

  const blurred = boxBlur(gray, n);
  const raw = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) raw[i] = blurred[i]! > 0.5 ? 1 : 0;

  let fg = 0;
  for (let i = 0; i < n * n; i++) fg += raw[i]!;
  if (fg === 0 || fg === n * n) {
    // Degenerate logo (blank or solid) → full medallion, no relief detail.
    return new Uint8Array(n * n).fill(1);
  }

  let mask = largestComponent(raw, n);
  mask = fillHoles(mask, n);
  mask = morphClose(mask, n);
  return mask;
}

/* ─── Pendant mesh → binary STL ───────────────────────────────────────── */

export const PENDANT_DISC_R_MM = 17.5;
export const PENDANT_BASE_T_MM = 2.2;
export const PENDANT_RELIEF_H_MM = 1.2;
export const NFC_POCKET_R_MM = 12.75; // fits a standard 25mm NTAG213/215 coin tag
export const NFC_POCKET_DEPTH_MM = 1.0;
const MESH_GRID = 128;

export interface PendantBuildOptions {
  /** Carve the NFC tag cavity into the back. */
  nfcPocket: boolean;
}

export interface PendantBuild {
  stl: Buffer;
  facetCount: number;
  /** mm³ */
  volumeMm3: number;
  widthMm: number;
  heightMm: number;
}

class MeshBuilder {
  // flat xyz xyz… triangles
  tris: number[] = [];

  /** Add a quad as two triangles, auto-orienting to the outward normal. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    ox: number, oy: number, oz: number,
  ): void {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, ox, oy, oz);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, ox, oy, oz);
  }

  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    ox: number, oy: number, oz: number,
  ): void {
    // geometric normal from winding
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (nx * ox + ny * oy + nz * oz < 0) {
      // flip winding
      const tx = bx;
      const ty = by;
      const tz = bz;
      bx = cx; by = cy; bz = cz;
      cx = tx; cy = ty; cz = tz;
      nx = -nx; ny = -ny; nz = -nz;
    }
    this.tris.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  toBinarySTL(): Buffer {
    const count = this.tris.length / 9;
    const buf = Buffer.alloc(84 + count * 50);
    buf.write("BowDownVisuals pendant", 0, "ascii");
    buf.writeUInt32LE(count, 80);
    let p = 84;
    for (let t = 0; t < count; t++) {
      const o = t * 9;
      const ax = this.tris[o]!;
      const ay = this.tris[o + 1]!;
      const az = this.tris[o + 2]!;
      const bx = this.tris[o + 3]!;
      const by = this.tris[o + 4]!;
      const bz = this.tris[o + 5]!;
      const cx = this.tris[o + 6]!;
      const cy = this.tris[o + 7]!;
      const cz = this.tris[o + 8]!;
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      buf.writeFloatLE(nx, p);
      buf.writeFloatLE(ny, p + 4);
      buf.writeFloatLE(nz, p + 8);
      buf.writeFloatLE(ax, p + 12);
      buf.writeFloatLE(ay, p + 16);
      buf.writeFloatLE(az, p + 20);
      buf.writeFloatLE(bx, p + 24);
      buf.writeFloatLE(by, p + 28);
      buf.writeFloatLE(bz, p + 32);
      buf.writeFloatLE(cx, p + 36);
      buf.writeFloatLE(cy, p + 40);
      buf.writeFloatLE(cz, p + 44);
      buf.writeUInt16LE(0, p + 48);
      p += 50;
    }
    return buf;
  }
}

export function buildPendantSTL(mask: Uint8Array, opts: PendantBuildOptions): PendantBuild {
  const n = MESH_GRID;
  const R = PENDANT_DISC_R_MM;
  const cell = (2 * R) / n;
  const mesh = new MeshBuilder();

  const inside = new Uint8Array(n * n);
  const topH = new Float32Array(n * n);
  const botH = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -R + (i + 0.5) * cell;
      const y = -R + (j + 0.5) * cell;
      const d = Math.hypot(x, y);
      const idx = j * n + i;
      if (d > R) continue;
      inside[idx] = 1;
      topH[idx] = PENDANT_BASE_T_MM + (mask[idx] ? PENDANT_RELIEF_H_MM : 0);
      botH[idx] =
        opts.nfcPocket && d <= NFC_POCKET_R_MM ? NFC_POCKET_DEPTH_MM : 0;
    }
  }

  const x0 = (i: number) => -R + i * cell;
  const y0 = (j: number) => -R + j * cell;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      if (!inside[idx]) continue;
      const xa = x0(i);
      const xb = x0(i + 1);
      const ya = y0(j);
      const yb = y0(j + 1);
      const t = topH[idx]!;
      const b = botH[idx]!;

      // Top face (+z)
      mesh.quad(xa, ya, t, xb, ya, t, xb, yb, t, xa, yb, t, 0, 0, 1);
      // Bottom face (−z)
      mesh.quad(xa, ya, b, xa, yb, b, xb, yb, b, xb, ya, b, 0, 0, -1);

      // Side walls vs 4 neighbors
      const neighbors: Array<[number, number, number, number, number]> = [
        // di, dj, outward x, outward y, edge selector
        [1, 0, 1, 0, 0], // +x edge at xb
        [-1, 0, -1, 0, 1], // −x edge at xa
        [0, 1, 0, 1, 2], // +y edge at yb
        [0, -1, 0, -1, 3], // −y edge at ya
      ];
      for (const [di, dj, ox, oy, edge] of neighbors) {
        const ni = i + di;
        const nj = j + dj;
        const nIdx = nj >= 0 && nj < n && ni >= 0 && ni < n ? nj * n + ni : -1;
        const nInside = nIdx >= 0 && inside[nIdx] === 1;
        const nt = nInside ? topH[nIdx]! : -1;
        const nb = nInside ? botH[nIdx]! : -1;
        // Wall segments where this cell's surface differs from neighbor's.
        const spans: Array<[number, number]> = [];
        if (!nInside) {
          spans.push([b, t]);
        } else {
          if (t > nt) spans.push([nt, t]);
          if (nb > b) spans.push([b, nb]);
        }
        for (const [z0, z1] of spans) {
          if (z1 - z0 < 1e-9) continue;
          if (edge === 0) mesh.quad(xb, ya, z0, xb, yb, z0, xb, yb, z1, xb, ya, z1, ox, oy, 0);
          else if (edge === 1) mesh.quad(xa, ya, z0, xa, ya, z1, xa, yb, z1, xa, yb, z0, ox, oy, 0);
          else if (edge === 2) mesh.quad(xa, yb, z0, xb, yb, z0, xb, yb, z1, xa, yb, z1, ox, oy, 0);
          else mesh.quad(xa, ya, z0, xb, ya, z0, xb, ya, z1, xa, ya, z1, ox, oy, 0);
        }
      }
    }
  }

  // Bail: torus fused at the top, loop plane = YZ (chain passes through).
  const Rmaj = 3.4;
  const rtube = 1.5;
  const cy = R - 0.6;
  const cz = PENDANT_BASE_T_MM / 2;
  const NU = 40;
  const NV = 20;
  const ringPt = (u: number, v: number): [number, number, number] => {
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const cv = Math.cos(v);
    const sv = Math.sin(v);
    return [
      rtube * sv,
      cy + (Rmaj + rtube * cv) * cu,
      cz + (Rmaj + rtube * cv) * su,
    ];
  };
  for (let iu = 0; iu < NU; iu++) {
    for (let iv = 0; iv < NV; iv++) {
      const u0 = (iu / NU) * Math.PI * 2;
      const u1 = ((iu + 1) / NU) * Math.PI * 2;
      const v0 = (iv / NV) * Math.PI * 2;
      const v1 = ((iv + 1) / NV) * Math.PI * 2;
      const p00 = ringPt(u0, v0);
      const p10 = ringPt(u1, v0);
      const p11 = ringPt(u1, v1);
      const p01 = ringPt(u0, v1);
      // outward ≈ radial from tube center — use centroid direction from ring axis point
      const umid = (u0 + u1) / 2;
      const vmid = (v0 + v1) / 2;
      const pc = ringPt(umid, vmid);
      const axX = 0;
      const axY = cy + Rmaj * Math.cos(umid);
      const axZ = cz + Rmaj * Math.sin(umid);
      let ox = pc[0] - axX;
      let oy = pc[1] - axY;
      let oz = pc[2] - axZ;
      const ol = Math.hypot(ox, oy, oz) || 1;
      ox /= ol; oy /= ol; oz /= ol;
      mesh.quad(
        p00[0], p00[1], p00[2],
        p10[0], p10[1], p10[2],
        p11[0], p11[1], p11[2],
        p01[0], p01[1], p01[2],
        ox, oy, oz,
      );
    }
  }

  // Volume: slab Σ(top−bottom)·cell² + torus 2π²Rr²
  let slabVol = 0;
  for (let k = 0; k < n * n; k++) {
    if (inside[k]) slabVol += (topH[k]! - botH[k]!) * cell * cell;
  }
  const torusVol = 2 * Math.PI * Math.PI * Rmaj * rtube * rtube;
  const volumeMm3 = slabVol + torusVol;

  const stl = mesh.toBinarySTL();
  return {
    stl,
    facetCount: mesh.tris.length / 9,
    volumeMm3,
    widthMm: 2 * R,
    heightMm: 2 * R + 2 * (Rmaj + rtube),
  };
}

/** grams = volume(cm³) × density */
export function stlWeightGrams(volumeMm3: number, densityGPerCm3: number): number {
  return (volumeMm3 / 1000) * densityGPerCm3;
}
