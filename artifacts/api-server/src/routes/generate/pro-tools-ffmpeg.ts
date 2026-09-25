/* ── Pro Tools → FFmpeg filter translation ─────────────────────────────────
 * SINGLE source of truth for the Pro Tools tab's export mapping. The master
 * player's live preview (pro-tools-preview.ts) mirrors these mappings in CSS —
 * keep the two in lockstep so the burned export matches what the user saw.
 *
 * Filter-chain order (per clip, applied BEFORE normalizeClip scales to target):
 *   1. speed    → setpts (video timing)
 *   2. reverse  → reverse (frame order)
 *   3. crop     → crop (creative crop, aspect presets or free rect)
 *   4. rotate   → transpose (90/180/270)
 *   5. flip     → hflip / vflip
 *   6. color    → eq + colorbalance + vibrance
 *   7. chroma   → chromakey + composite over bg color (drawbox+overlay trick)
 *
 * Mapping table (UI slider -100..100 → FFmpeg):
 *  brightness  → eq=brightness=(b/100)*0.5            [-1..1]
 *  exposure    → folded into eq brightness (+e/100*0.5)
 *  contrast    → eq=contrast=1+(c/100)                  [0..2]
 *  saturation  → eq=saturation=1+(s/100)                [0..2]
 *  temperature → colorbalance warm/cool shift on mids+highlights
 *                warm (+): rm/gm up, bm down (red/green lift, blue cut)
 *  tint        → colorbalance green↔magenta (gm down = magenta)
 *  highlights  → colorbalance rh/gh/bh lift
 *  shadows     → colorbalance rs/gs/bs lift
 *  vibrance    → vibrance=intensity=(v/100)*2           [-2..2]
 *  speed       → setpts=(1/speed)*PTS
 *  reverse     → reverse
 *  rotation 90 → transpose=1 | 180 → transpose=1,transpose=1 | 270 → transpose=2
 *  flipH/flipV → hflip / vflip
 *  crop aspect → crop='if(gt(iw/ih,A),ih*A,iw)':'if(gt(iw/ih,A),ih,iw/A)'
 *  crop free   → crop=iw*W:ih*H:iw*X:ih*Y
 *  chroma      → chromakey=0xRRGGBB:sim:blend → composite over bg via
 *                split + drawbox(fill) + overlay (works with unknown dims)
 */

export interface ProToolsColorCorrection {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  vibrance: number;
  exposure: number;
}

export interface ProToolsChromaKey {
  enabled: boolean;
  color: string;
  similarity: number;
  blend: number;
  bgColor: string;
}

export interface ProToolsCrop {
  enabled: boolean;
  aspect: "16:9" | "9:16" | "1:1" | "4:5" | "free";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProToolsFilterInput {
  colorCorrection?: ProToolsColorCorrection | null;
  chromaKey?: ProToolsChromaKey | null;
  speed?: number | null;
  reverse?: boolean;
  rotation?: 0 | 90 | 180 | 270 | null;
  flipH?: boolean;
  flipV?: boolean;
  crop?: ProToolsCrop | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const f4 = (n: number) => n.toFixed(4);

/** Normalize "#abc" / "#aabbcc" / "aabbcc" → "0xAABBCC". Falls back to green. */
export function hexToFfmpegColor(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return "0x00FF00";
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `0x${h.toUpperCase()}`;
}

const ASPECT_RATIOS: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

/**
 * Build the per-clip FFmpeg filter chain for pro tools.
 * Returns "" when nothing is active (caller should skip the extra pass).
 * The returned string is a filter_complex body: `[0:v]<chain>[ptout]`.
 */
export function buildProToolsFilterChain(input: ProToolsFilterInput): string {
  const parts: string[] = [];
  // Labels that need threading through the split/overlay chroma composite.
  let outLabel = "[ptout]";

  // ── 1. Speed ──
  const speed = input.speed ?? 1;
  if (Number.isFinite(speed) && speed !== 1 && speed >= 0.25 && speed <= 4) {
    parts.push(`setpts=${f4(1 / speed)}*PTS`);
  }

  // ── 2. Reverse ──
  if (input.reverse) parts.push("reverse");

  // ── 3. Crop ──
  const crop = input.crop;
  if (crop?.enabled) {
    if (crop.aspect === "free") {
      const x = clamp(crop.x, 0, 0.95), y = clamp(crop.y, 0, 0.95);
      const w = clamp(crop.w, 0.05, 1 - x), h = clamp(crop.h, 0.05, 1 - y);
      parts.push(`crop=iw*${f4(w)}:ih*${f4(h)}:iw*${f4(x)}:ih*${f4(y)}`);
    } else {
      const A = ASPECT_RATIOS[crop.aspect] ?? 16 / 9;
      const a = A.toFixed(6);
      // If source is wider than target → crop width; else crop height. Centered.
      parts.push(`crop='if(gt(iw/ih,${a}),ih*${a},iw)':'if(gt(iw/ih,${a}),ih,iw/${a})'`);
    }
  }

  // ── 4. Rotate ──
  const rot = input.rotation ?? 0;
  if (rot === 90) parts.push("transpose=1");
  else if (rot === 270) parts.push("transpose=2");
  else if (rot === 180) parts.push("transpose=1,transpose=1");

  // ── 5. Flip ──
  if (input.flipH) parts.push("hflip");
  if (input.flipV) parts.push("vflip");

  // ── 6. Color correction ──
  const cc = input.colorCorrection;
  if (cc) {
    const eqBits: string[] = [];
    const bright = clamp((cc.brightness / 100) * 0.5 + (cc.exposure / 100) * 0.5, -1, 1);
    const contrast = clamp(1 + cc.contrast / 100, 0, 3);
    const sat = clamp(1 + cc.saturation / 100, 0, 3);
    if (Math.abs(contrast - 1) > 0.001) eqBits.push(`contrast=${f4(contrast)}`);
    if (Math.abs(bright) > 0.001) eqBits.push(`brightness=${f4(bright)}`);
    if (Math.abs(sat - 1) > 0.001) eqBits.push(`saturation=${f4(sat)}`);
    if (eqBits.length > 0) parts.push(`eq=${eqBits.join(":")}`);

    // colorbalance: temperature / tint / highlights / shadows.
    const t = clamp(cc.temperature, -100, 100);
    const ti = clamp(cc.tint, -100, 100);
    const hl = clamp(cc.highlights, -100, 100);
    const sh = clamp(cc.shadows, -100, 100);
    const cbBits: string[] = [];
    // Temperature: warm (+) lifts red/green mids+highlights, cuts blue.
    if (t !== 0) {
      cbBits.push(`rm=${f4(t * 0.0008)}`, `gm=${f4(t * 0.0004)}`, `bm=${f4(-t * 0.0008)}`);
      cbBits.push(`rh=${f4(t * 0.0012)}`, `gh=${f4(t * 0.0006)}`, `bh=${f4(-t * 0.0012)}`);
    }
    // Tint: positive = magenta (cut green), negative = green.
    if (ti !== 0) {
      cbBits.push(`gm=${f4(-ti * 0.001)}`, `gs=${f4(-ti * 0.0006)}`, `gh=${f4(-ti * 0.001)}`);
    }
    // Highlights / shadows lift.
    if (hl !== 0) cbBits.push(`rh=${f4(hl * 0.001)}`, `gh=${f4(hl * 0.001)}`, `bh=${f4(hl * 0.001)}`);
    if (sh !== 0) cbBits.push(`rs=${f4(sh * 0.001)}`, `gs=${f4(sh * 0.001)}`, `bs=${f4(sh * 0.001)}`);
    if (cbBits.length > 0) parts.push(`colorbalance=${cbBits.join(":")}`);

    const vib = clamp(cc.vibrance, -100, 100);
    if (vib !== 0) parts.push(`vibrance=intensity=${f4((vib / 100) * 2)}`);
  }

  if (parts.length === 0 && !input.chromaKey?.enabled) return "";

  // ── 7. Chroma key (needs stream labels: split → bg fill + keyed fg → overlay) ──
  const ck = input.chromaKey;
  const chain = parts.join(",");
  if (ck?.enabled) {
    const keyColor = hexToFfmpegColor(ck.color);
    const sim = clamp(ck.similarity / 100, 0.01, 1);
    const blend = clamp(ck.blend / 100, 0, 1);
    const bg = hexToFfmpegColor(ck.bgColor);
    // drawbox t=fill paints the whole frame — works without knowing dims.
    const pre = chain ? `${chain},` : "";
    return (
      `[0:v]${pre}split=2[ckbg][ckfg];` +
      `[ckbg]drawbox=c=${bg}:t=fill,format=yuv420p[ckbg2];` +
      `[ckfg]chromakey=${keyColor}:${sim.toFixed(3)}:${blend.toFixed(3)},format=yuva420p[ckfg2];` +
      `[ckbg2][ckfg2]overlay=0:0:format=yuv420${outLabel}`
    );
  }

  return `[0:v]${chain}${outLabel}`;
}

/** True when the input would produce a non-empty filter chain. */
export function proToolsFilterActive(input: ProToolsFilterInput): boolean {
  return buildProToolsFilterChain(input).length > 0;
}
