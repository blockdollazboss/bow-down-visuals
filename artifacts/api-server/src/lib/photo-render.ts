/**
 * photo-render.ts — server-side rendering for the Photo desk editor
 * (Stack 7). Pure builders + an injectable batch orchestrator.
 *
 * The recipe JSON is the SAME camelCase develop recipe the frontend
 * canvas model (lib/photo-canvas.ts) produces — one format for the
 * develop sliders, batch look-sync, multi-recipe export and preset
 * packs. Raster photos only; nothing here claims RAW/DNG parity.
 */

export interface DevelopSettings {
  exposure: number; brightness: number; contrast: number; temperature: number;
  hue: number; saturation: number; lightness: number;
  crop: { x: number; y: number; w: number; h: number } | null;
  rotateDeg: number;
}

export const DEFAULT_DEVELOP: DevelopSettings = {
  exposure: 0, brightness: 0, contrast: 0, temperature: 0,
  hue: 0, saturation: 0, lightness: 0, crop: null, rotateDeg: 0,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : lo));

export function clampDevelop(d: Partial<DevelopSettings> | null | undefined): DevelopSettings {
  const s = { ...DEFAULT_DEVELOP, ...(d ?? {}) };
  return {
    exposure: clamp(s.exposure, -2, 2),
    brightness: clamp(s.brightness, -100, 100),
    contrast: clamp(s.contrast, -100, 100),
    temperature: clamp(s.temperature, -100, 100),
    hue: clamp(s.hue, -180, 180),
    saturation: clamp(s.saturation, -100, 100),
    lightness: clamp(s.lightness, -100, 100),
    rotateDeg: clamp(s.rotateDeg, -45, 45),
    crop: s.crop
      ? { x: clamp(s.crop.x, 0, 0.99), y: clamp(s.crop.y, 0, 0.99), w: clamp(s.crop.w, 0.01, 1), h: clamp(s.crop.h, 0.01, 1) }
      : null,
  };
}

const f = (n: number) => {
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? "0" : String(v);
};

/**
 * Build the ffmpeg video-filter chain for a develop recipe.
 * Order matters: crop → fine rotate → color. Returns "" for identity.
 * Mappings (documented, deterministic, unit-tested):
 *  eq brightness = brightness/200 + lightness/200 + exposure*0.1
 *  eq contrast   = 1 + contrast/100          (clamped 0..3)
 *  eq saturation = 1 + saturation/100        (clamped 0..3)
 *  eq gamma      = 2^(-exposure/2)           (exposure brightens mids)
 *  colorbalance  = temperature warm/cool split across shadows+midtones
 *  hue           = hue degrees only (saturation lives in eq)
 */
export function buildDevelopFilter(raw: Partial<DevelopSettings> | null | undefined): string {
  const d = clampDevelop(raw);
  const parts: string[] = [];
  if (d.crop) {
    parts.push(`crop=iw*${f(d.crop.w)}:ih*${f(d.crop.h)}:iw*${f(d.crop.x)}:ih*${f(d.crop.y)}`);
  }
  if (d.rotateDeg !== 0) {
    parts.push(`rotate=${f((d.rotateDeg * Math.PI) / 180)}:c=black`);
  }
  const brightness = clamp(d.brightness / 200 + d.lightness / 200 + d.exposure * 0.1, -1, 1);
  const contrast = clamp(1 + d.contrast / 100, 0, 3);
  const saturation = clamp(1 + d.saturation / 100, 0, 3);
  const gamma = clamp(Math.pow(2, -d.exposure / 2), 0.1, 10);
  if (brightness !== 0 || contrast !== 1 || saturation !== 1 || gamma !== 1) {
    parts.push(`eq=brightness=${f(brightness)}:contrast=${f(contrast)}:saturation=${f(saturation)}:gamma=${f(gamma)}`);
  }
  if (d.temperature !== 0) {
    const t = d.temperature / 200; // -0.5..0.5
    parts.push(
      `colorbalance=rs=${f(t)}:gs=${f(t / 2)}:bs=${f(-t)}:rm=${f(t / 2)}:gm=${f(t / 4)}:bm=${f(-t / 2)}`,
    );
  }
  if (d.hue !== 0) parts.push(`hue=h=${f(d.hue)}`);
  return parts.join(",");
}

/* ── Multi-recipe export specs ──────────────────────────────────────── */
export interface PhotoOutputSpec {
  id: string;
  format: "png" | "jpg";
  width: number;
  height: number;
  watermark: boolean;
}

export const DEFAULT_OUTPUT_SPECS: PhotoOutputSpec[] = [
  { id: "wide-png", format: "png", width: 1920, height: 1080, watermark: false },
  { id: "vertical-png", format: "png", width: 1080, height: 1920, watermark: false },
  { id: "square-jpg", format: "jpg", width: 1080, height: 1080, watermark: false },
];

export function normalizeOutputSpecs(raw: unknown): PhotoOutputSpec[] | null {
  if (raw === undefined || raw === null) return [...DEFAULT_OUTPUT_SPECS];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const out: PhotoOutputSpec[] = [];
  for (const [i, s] of raw.entries()) {
    const spec = s as Partial<PhotoOutputSpec>;
    if (!spec || (spec.format !== "png" && spec.format !== "jpg")) return null;
    const width = Math.round(clamp(spec.width ?? 0, 16, 4096));
    const height = Math.round(clamp(spec.height ?? 0, 16, 4096));
    if (!width || !height) return null;
    out.push({
      id: typeof spec.id === "string" && spec.id.trim() ? spec.id.trim().slice(0, 40) : `output-${i + 1}`,
      format: spec.format, width, height, watermark: spec.watermark === true,
    });
  }
  return out;
}

/** Scale-to-fit + pad to the exact spec size (letterbox, never stretch). */
export function buildOutputFilter(recipe: Partial<DevelopSettings> | null | undefined, spec: PhotoOutputSpec): string {
  const develop = buildDevelopFilter(recipe);
  const fit = `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease,pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2:black`;
  return develop ? `${develop},${fit}` : fit;
}

/** ffmpeg args for one output. Watermarked outputs take the branding
 *  stamp as input 1 and overlay it bottom-right — visibly stamped. */
export function buildRenderArgs(opts: {
  inputPath: string; outputPath: string; recipe?: Partial<DevelopSettings> | null;
  spec: PhotoOutputSpec; watermarkPath?: string | null;
}): string[] {
  const vf = buildOutputFilter(opts.recipe, opts.spec);
  if (opts.spec.watermark && opts.watermarkPath) {
    return [
      "-y", "-i", opts.inputPath, "-i", opts.watermarkPath,
      "-filter_complex", `[0:v]${vf}[base];[1:v]scale=iw*0.18:-1[wm];[base][wm]overlay=W-w-24:H-h-24:format=auto[out]`,
      "-map", "[out]", "-frames:v", "1", opts.outputPath,
    ];
  }
  return ["-y", "-i", opts.inputPath, "-vf", vf, "-frames:v", "1", opts.outputPath];
}

/* ── Batch look-sync: one recipe, many photos, per-photo outcomes ───── */
export interface BatchPhotoResult {
  imageUrl: string;
  ok: boolean;
  url: string | null;
  error: string | null;
}

/**
 * Apply one recipe across many photos. NEVER rejects as a whole and
 * never silently half-applies: every input gets exactly one outcome
 * row, in input order.
 */
export async function runBatchLookSync(
  imageUrls: string[],
  recipe: Partial<DevelopSettings> | null | undefined,
  renderOne: (imageUrl: string, recipe: DevelopSettings) => Promise<string>,
): Promise<{ results: BatchPhotoResult[]; succeeded: number; failed: number }> {
  const develop = clampDevelop(recipe);
  const results: BatchPhotoResult[] = [];
  for (const imageUrl of imageUrls) {
    try {
      const url = await renderOne(imageUrl, develop);
      results.push({ imageUrl, ok: true, url, error: null });
    } catch (err) {
      results.push({
        imageUrl, ok: false, url: null,
        error: err instanceof Error ? err.message : "Render failed.",
      });
    }
  }
  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
