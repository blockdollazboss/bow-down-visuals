/* ─── Proxy editing (Stack-200 board item 184) ─────────────────────────
   Low-res proxy media so the Visual Vibes editor can preview / scrub /
   arrange HEAVY originals smoothly, relinked to full-res at export.

   Hard laws (do not soften):
   - RELINK HONESTY: export ALWAYS renders from the original. Any clip
     URL pointing at a known proxy is swapped back to its original
     before a render starts (resolveExportSources, wired into the
     export job kickoff in routes/generate/export-video.ts). There is
     no code path that exports a proxy.
   - PREVIEW HONESTY: the UI must say plainly whether the creator is
     looking at a proxy or the original (previewSourceFor /
     PROXY_PREVIEW_LABEL / ORIGINAL_PREVIEW_LABEL).
   - ON DEMAND ONLY: a proxy is generated only when a creator asks for
     one for a clip that is actually heavy (assessHeaviness). Light
     clips get no row, no file, and no proxy.
   - NO PRICES: proxy editing charges nothing and prices nothing. */

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { db, proxyMediaTable, proxyPrefsTable, PROXY_MAX_EDGE } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { uploadPublicMediaFileToR2, SUPABASE_CLIPS_BUCKET } from "./objectStorage";

const execFileAsync = promisify(execFile);

export { PROXY_MAX_EDGE };

/* ── Heavy thresholds ─────────────────────────────────────────────────
   A clip is heavy when ANY signal trips. Thresholds are deliberately
   conservative: a 720p phone clip stays on its original. */
export const HEAVY_MIN_LONG_EDGE = 1920;
export const HEAVY_MIN_BYTES = 25_000_000;
export const HEAVY_MIN_DURATION_SEC = 300;
export const HEAVY_CODECS = new Set(["hevc", "h265", "av1", "vp9", "prores", "dnxhd", "dnxhr"]);

export interface ClipProbeInput {
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  durationSec?: number | null;
  codec?: string | null;
}

export interface HeavinessVerdict {
  isHeavy: boolean;
  reasons: string[];
}

export function assessHeaviness(input: ClipProbeInput): HeavinessVerdict {
  const reasons: string[] = [];
  const longEdge = Math.max(input.width ?? 0, input.height ?? 0);
  if (longEdge >= HEAVY_MIN_LONG_EDGE) reasons.push(`resolution ${input.width ?? "?"}x${input.height ?? "?"} (long edge ≥ ${HEAVY_MIN_LONG_EDGE}px)`);
  if ((input.bytes ?? 0) >= HEAVY_MIN_BYTES) reasons.push(`file size ≥ ${HEAVY_MIN_BYTES} bytes`);
  if ((input.durationSec ?? 0) >= HEAVY_MIN_DURATION_SEC) reasons.push(`duration ≥ ${HEAVY_MIN_DURATION_SEC}s`);
  if (input.codec && HEAVY_CODECS.has(input.codec.toLowerCase())) reasons.push(`heavy codec ${input.codec.toLowerCase()}`);
  return { isHeavy: reasons.length > 0, reasons };
}

/** Scale (w,h) so the long edge is ≤ PROXY_MAX_EDGE, aspect preserved,
 *  both dimensions even (h264 requirement), never upscale. Returns null
 *  when dimensions are unknown. */
export function proxyDimensions(width?: number | null, height?: number | null): { width: number; height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const longEdge = Math.max(width, height);
  if (longEdge <= PROXY_MAX_EDGE) return { width: even(width), height: even(height) };
  const scale = PROXY_MAX_EDGE / longEdge;
  return { width: even(Math.round(width * scale)), height: even(Math.round(height * scale)) };
}
function even(n: number): number {
  const e = Math.max(2, Math.round(n / 2) * 2);
  return e;
}

/** Pure ffmpeg argument builder for the one proxy profile (854 long
 *  edge, h264 + aac, faststart). Tested without running ffmpeg. */
export function buildProxyFfmpegArgs(inputPath: string, outputPath: string, dims?: { width: number; height: number } | null): string[] {
  const vf = dims
    ? `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
    : `scale='min(${PROXY_MAX_EDGE},iw)':'min(${PROXY_MAX_EDGE},ih)':force_original_aspect_ratio=decrease,setsar=1`;
  return [
    "-y", "-i", inputPath,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    outputPath,
  ];
}

/* ── Wire shape ───────────────────────────────────────────────────── */
export type ProxyStatusWire = "pending" | "generating" | "ready" | "failed";
export interface ProxyMediaWire {
  id: string;
  project_id: string | null;
  original_url: string;
  proxy_url: string | null;
  original_width: number | null;
  original_height: number | null;
  proxy_width: number | null;
  proxy_height: number | null;
  status: ProxyStatusWire;
  is_heavy: boolean;
  heavy_reasons: string[];
  error: string | null;
}

export const PROXY_PREVIEW_LABEL = "Proxy — preview only. Export always uses the full-res original.";
export const ORIGINAL_PREVIEW_LABEL = "Original — full-res. This is exactly what export uses.";

export interface PreviewSource {
  url: string;
  is_proxy: boolean;
  label: string;
}

/** Which URL the PREVIEW should play, with an honest label. A ready
 *  proxy is used only when prefs are enabled; everything else falls
 *  back to the original and says so. */
export function previewSourceFor(row: ProxyMediaWire | null, originalUrl: string, prefsEnabled: boolean): PreviewSource {
  if (prefsEnabled && row && row.status === "ready" && row.proxy_url) {
    return { url: row.proxy_url, is_proxy: true, label: PROXY_PREVIEW_LABEL };
  }
  return { url: originalUrl, is_proxy: false, label: ORIGINAL_PREVIEW_LABEL };
}

/* ── Relink (the export guarantee) ────────────────────────────────── */
export function relinkKnownProxyUrls(urls: string[], rows: Pick<ProxyMediaWire, "original_url" | "proxy_url">[]): { urls: string[]; relinked: number } {
  const byProxy = new Map<string, string>();
  for (const r of rows) if (r.proxy_url) byProxy.set(r.proxy_url, r.original_url);
  let relinked = 0;
  const out = urls.map((u) => {
    const orig = byProxy.get(u);
    if (orig) { relinked++; return orig; }
    return u;
  });
  return { urls: out, relinked };
}

/* ── Storage seam (drizzle in prod, in-memory in tests) ───────────── */
export interface ProxyStore {
  getByOriginal(userId: string, originalUrl: string): Promise<ProxyMediaWire | null>;
  listByUser(userId: string, projectId?: string | null): Promise<ProxyMediaWire[]>;
  listByProxyUrls(userId: string, urls: string[]): Promise<ProxyMediaWire[]>;
  insertRow(userId: string, input: ClipProbeInput & { projectId?: string | null; originalUrl: string; isHeavy: boolean; reasons: string[] }): Promise<ProxyMediaWire>;
  updateRow(userId: string, id: string, patch: Partial<Pick<ProxyMediaWire, "status" | "proxy_url" | "proxy_width" | "proxy_height" | "error">>): Promise<ProxyMediaWire>;
  getPrefsEnabled(userId: string): Promise<boolean>;
  setPrefsEnabled(userId: string, enabled: boolean): Promise<void>;
}

function rowToWire(r: typeof proxyMediaTable.$inferSelect): ProxyMediaWire {
  return {
    id: r.id, project_id: r.projectId, original_url: r.originalUrl, proxy_url: r.proxyUrl,
    original_width: r.originalWidth, original_height: r.originalHeight,
    proxy_width: r.proxyWidth, proxy_height: r.proxyHeight,
    status: r.status as ProxyStatusWire, is_heavy: r.isHeavy,
    heavy_reasons: r.heavyReasons ?? [], error: r.error,
  };
}

export const drizzleProxyStore: ProxyStore = {
  async getByOriginal(userId, originalUrl) {
    const rows = await db.select().from(proxyMediaTable)
      .where(and(eq(proxyMediaTable.userId, userId), eq(proxyMediaTable.originalUrl, originalUrl))).limit(1);
    return rows[0] ? rowToWire(rows[0]) : null;
  },
  async listByUser(userId, projectId) {
    const rows = projectId
      ? await db.select().from(proxyMediaTable).where(and(eq(proxyMediaTable.userId, userId), eq(proxyMediaTable.projectId, projectId)))
      : await db.select().from(proxyMediaTable).where(eq(proxyMediaTable.userId, userId));
    return rows.map(rowToWire);
  },
  async listByProxyUrls(userId, urls) {
    if (urls.length === 0) return [];
    const rows = await db.select().from(proxyMediaTable)
      .where(and(eq(proxyMediaTable.userId, userId), inArray(proxyMediaTable.proxyUrl, urls)));
    return rows.map(rowToWire);
  },
  async insertRow(userId, input) {
    const rows = await db.insert(proxyMediaTable).values({
      userId, projectId: input.projectId ?? null, originalUrl: input.originalUrl,
      originalWidth: input.width ?? null, originalHeight: input.height ?? null,
      originalBytes: input.bytes != null ? Math.round(input.bytes) : null,
      originalDurationSec: input.durationSec ?? null, originalCodec: input.codec ?? null,
      status: "pending", isHeavy: input.isHeavy, heavyReasons: input.reasons,
    }).returning();
    return rowToWire(rows[0]!);
  },
  async updateRow(userId, id, patch) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set["status"] = patch.status;
    if (patch.proxy_url !== undefined) set["proxyUrl"] = patch.proxy_url;
    if (patch.proxy_width !== undefined) set["proxyWidth"] = patch.proxy_width;
    if (patch.proxy_height !== undefined) set["proxyHeight"] = patch.proxy_height;
    if (patch.error !== undefined) set["error"] = patch.error;
    const rows = await db.update(proxyMediaTable).set(set)
      .where(and(eq(proxyMediaTable.userId, userId), eq(proxyMediaTable.id, id))).returning();
    if (!rows[0]) throw new Error("proxy row not found");
    return rowToWire(rows[0]);
  },
  async getPrefsEnabled(userId) {
    const rows = await db.select().from(proxyPrefsTable).where(eq(proxyPrefsTable.userId, userId)).limit(1);
    return rows[0] ? rows[0].enabled : true;
  },
  async setPrefsEnabled(userId, enabled) {
    await db.insert(proxyPrefsTable).values({ userId, enabled })
      .onConflictDoUpdate({ target: proxyPrefsTable.userId, set: { enabled, updatedAt: new Date() } });
  },
};

/* ── Request flow (on demand only) ────────────────────────────────── */
export type RequestProxyOutcome =
  | { outcome: "disabled" }
  | { outcome: "not_heavy"; verdict: HeavinessVerdict }
  | { outcome: "queued" | "existing"; row: ProxyMediaWire };

export async function requestProxy(
  store: ProxyStore,
  userId: string,
  input: ClipProbeInput & { projectId?: string | null; originalUrl: string },
): Promise<RequestProxyOutcome> {
  if (!(await store.getPrefsEnabled(userId))) return { outcome: "disabled" };
  const verdict = assessHeaviness(input);
  if (!verdict.isHeavy) return { outcome: "not_heavy", verdict };
  const existing = await store.getByOriginal(userId, input.originalUrl);
  if (existing) {
    if (existing.status === "failed") {
      const requeued = await store.updateRow(userId, existing.id, { status: "pending", error: null });
      return { outcome: "queued", row: requeued };
    }
    return { outcome: "existing", row: existing };
  }
  const row = await store.insertRow(userId, { ...input, isHeavy: true, reasons: verdict.reasons });
  return { outcome: "queued", row };
}

/** Resolve export clip URLs back to originals. MUST be called with the
 *  export's clip list before any render reads it. */
export async function resolveExportSources(store: ProxyStore, userId: string, clipUrls: string[]): Promise<{ urls: string[]; relinked: number }> {
  const rows = await store.listByProxyUrls(userId, clipUrls);
  return relinkKnownProxyUrls(clipUrls, rows);
}

/* ── Generation runner (injectable generator for tests) ───────────── */
export type ProxyGenerator = (row: ProxyMediaWire) => Promise<{ proxyUrl: string; proxyWidth: number | null; proxyHeight: number | null }>;

export async function runProxyGeneration(store: ProxyStore, userId: string, id: string, generate: ProxyGenerator): Promise<ProxyMediaWire> {
  const rows = await store.listByUser(userId);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error("proxy row not found");
  await store.updateRow(userId, id, { status: "generating", error: null });
  try {
    const out = await generate(row);
    return await store.updateRow(userId, id, { status: "ready", proxy_url: out.proxyUrl, proxy_width: out.proxyWidth, proxy_height: out.proxyHeight, error: null });
  } catch (err) {
    return await store.updateRow(userId, id, { status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500) });
  }
}

/** Production generator: ffmpeg reads the original URL directly,
 *  writes a local proxy file, uploads it as public media (preview-only
 *  asset), and cleans up. Never touches the original. */
export const ffmpegProxyGenerator: ProxyGenerator = async (row) => {
  const dims = proxyDimensions(row.original_width, row.original_height);
  const dir = mkdtempSync(path.join(os.tmpdir(), "proxy-"));
  const outPath = path.join(dir, "proxy.mp4");
  try {
    await execFileAsync("ffmpeg", buildProxyFfmpegArgs(row.original_url, outPath, dims), { timeout: 600_000 });
    const objectPath = `proxies/${row.id}.mp4`;
    const proxyUrl = await uploadPublicMediaFileToR2(SUPABASE_CLIPS_BUCKET, objectPath, outPath, "video/mp4");
    return { proxyUrl, proxyWidth: dims?.width ?? null, proxyHeight: dims?.height ?? null };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
};
