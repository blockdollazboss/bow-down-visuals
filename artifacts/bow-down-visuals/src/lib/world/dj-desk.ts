/**
 * dj-desk — the DJ Set Prep desk's pure logic seam
 * (stack1500 world parity wave #3, census item 29).
 *
 * THE FEATURE (website): DJ Set Prep (pages/songs/dj-set-prep.tsx)
 * — read your own songs' tempo and key, pack them into crates,
 * and let the harmonic orderer propose a set that blends: same
 * Camelot code first, tempo climbing as the energy arc. Crates
 * export to Rekordbox XML or M3U for the booth.
 *
 * THE RAILS (routes/dj.ts, all requireAuth, all FREE — the
 * analyze path carries a registry row at cost 0, "DJ Set Prep
 * (free)", pinned below):
 *   GET    /api/dj/library → { tracks: [{ id, title, audioUrl,
 *          source, durationSec, createdAt, analysis }] } (≤100)
 *   POST   /api/dj/analyze { songIds (1–20), force? } →
 *          { results: [{ songId, status: "analyzed" | "cached" |
 *            "failed", analysis?, error? }] }
 *   GET    /api/dj/crates → { crates }; POST /api/dj/crates
 *          { name } → { crate }; PATCH /api/dj/crates/:id
 *          { name?, songIds? } → { crate } (songIds REPLACES the
 *          crate's membership and order wholesale);
 *          DELETE /api/dj/crates/:id → { ok: true }
 *   POST   /api/dj/crates/:id/propose-order → { proposal:
 *          { order, transitions, unanalyzed } }
 *   GET    /api/dj/crates/:id/export?format=rekordbox|m3u →
 *          the file itself (400 on an empty crate).
 *
 * Analysis = { bpm, bpmConfidence, keyLabel, camelot,
 * keyConfidence, keyScore, durationSec, analyzedAt } or null —
 * null means "not analyzed yet", a state the desk shows as
 * itself, never as zeros.
 *
 * DRIFT DISCIPLINE: rows missing their id/title are dropped;
 * a crate or proposal that doesn't match its shape reads as
 * failure, never as an empty crate or an invented order.
 */
import { getCreditCost } from "../credit-costs";

function registryCost(path: string): number {
  const cost = getCreditCost(path)?.cost;
  if (typeof cost !== "number") {
    throw new Error(`dj-desk: no credit-cost registry entry for ${path}`);
  }
  return cost;
}

export const DJ_LIBRARY_PATH = "/api/dj/library";
export const DJ_ANALYZE_PATH = "/api/dj/analyze";
export const DJ_CRATES_PATH = "/api/dj/crates";

export function djCratePath(id: string): string {
  return `${DJ_CRATES_PATH}/${encodeURIComponent(id)}`;
}
export function djProposePath(id: string): string {
  return `${djCratePath(id)}/propose-order`;
}
export function djExportPath(id: string, format: DjExportFormat): string {
  return `${djCratePath(id)}/export?format=${format}`;
}

export type DjExportFormat = "rekordbox" | "m3u";

/** Free — the analyze rail's registry row, pinned at 0. */
export const DJ_ANALYZE_COST = registryCost(DJ_ANALYZE_PATH);

/** The analyze schema's batch bound (songIds min 1, max 20). */
export const DJ_ANALYZE_BATCH = 20;

export function chunkSongIds(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += DJ_ANALYZE_BATCH) {
    out.push(ids.slice(i, i + DJ_ANALYZE_BATCH));
  }
  return out;
}

export function buildAnalyzePayload(songIds: readonly string[], force = false) {
  return { songIds: [...songIds], ...(force ? { force: true } : {}) };
}

/* ── Shapes + guards ──────────────────────────────────────────────── */

export interface DjAnalysis {
  bpm: number | null;
  bpmConfidence: string | null;
  keyLabel: string | null;
  camelot: string | null;
  keyConfidence: string | null;
  keyScore: number | null;
  durationSec: number | null;
  analyzedAt: string | null;
}

export interface DjLibraryTrack {
  id: string;
  title: string;
  audioUrl: string;
  durationSec: number | null;
  analysis: DjAnalysis | null;
}

export interface DjCrateTrack {
  songId: string;
  title: string;
  durationSec: number | null;
  bpm: number | null;
  keyLabel: string | null;
  camelot: string | null;
  position: number;
}

export interface DjCrate {
  id: string;
  name: string;
  tracks: DjCrateTrack[];
}

export interface DjProposal {
  order: string[];
  transitions: Array<{ fromSongId: string; toSongId: string; note: string }>;
  unanalyzed: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function analysisOf(raw: unknown): DjAnalysis | null {
  if (!isRecord(raw)) return null;
  return {
    bpm: numOrNull(raw["bpm"]),
    bpmConfidence: strOrNull(raw["bpmConfidence"]),
    keyLabel: strOrNull(raw["keyLabel"]),
    camelot: strOrNull(raw["camelot"]),
    keyConfidence: strOrNull(raw["keyConfidence"]),
    keyScore: numOrNull(raw["keyScore"]),
    durationSec: numOrNull(raw["durationSec"]),
    analyzedAt: strOrNull(raw["analyzedAt"]) ?? strOrNull(raw["analyzed_at"]),
  };
}

export function libraryOfResponse(data: unknown): DjLibraryTrack[] | null {
  if (!isRecord(data) || !Array.isArray(data["tracks"])) return null;
  const out: DjLibraryTrack[] = [];
  for (const row of data["tracks"]) {
    if (!isRecord(row)) continue;
    const id = str(row["id"]);
    const title = str(row["title"]);
    if (!id || !title) continue;
    out.push({
      id,
      title,
      audioUrl: str(row["audioUrl"]),
      durationSec: numOrNull(row["durationSec"]),
      analysis: analysisOf(row["analysis"]),
    });
  }
  return out;
}

export interface DjAnalyzeOutcome {
  songId: string;
  status: "analyzed" | "cached" | "failed";
  analysis: DjAnalysis | null;
  error: string | null;
}

export function analyzeOutcomesOf(data: unknown): DjAnalyzeOutcome[] | null {
  if (!isRecord(data) || !Array.isArray(data["results"])) return null;
  const out: DjAnalyzeOutcome[] = [];
  for (const row of data["results"]) {
    if (!isRecord(row)) continue;
    const songId = str(row["songId"]);
    const status = str(row["status"]);
    if (!songId || (status !== "analyzed" && status !== "cached" && status !== "failed")) continue;
    out.push({
      songId,
      status,
      analysis: analysisOf(row["analysis"]),
      error: strOrNull(row["error"]),
    });
  }
  return out;
}

/** Fold analyze outcomes into the library (the response is the
 *  new truth for the tracks it names; failed tracks keep their
 *  old analysis state). */
export function applyAnalyzeOutcomes(
  tracks: readonly DjLibraryTrack[],
  outcomes: readonly DjAnalyzeOutcome[],
): DjLibraryTrack[] {
  const byId = new Map(outcomes.map((o) => [o.songId, o]));
  return tracks.map((t) => {
    const o = byId.get(t.id);
    if (!o || o.status === "failed" || !o.analysis) return t;
    return { ...t, analysis: o.analysis, durationSec: o.analysis.durationSec ?? t.durationSec };
  });
}

export function crateOf(raw: unknown): DjCrate | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const name = str(raw["name"]);
  if (!id || !name) return null;
  const tracks: DjCrateTrack[] = [];
  if (Array.isArray(raw["tracks"])) {
    for (const row of raw["tracks"]) {
      if (!isRecord(row)) continue;
      const songId = str(row["songId"]);
      const title = str(row["title"]);
      if (!songId || !title) continue;
      tracks.push({
        songId,
        title,
        durationSec: numOrNull(row["durationSec"]),
        bpm: numOrNull(row["bpm"]),
        keyLabel: strOrNull(row["keyLabel"]),
        camelot: strOrNull(row["camelot"]),
        position: numOrNull(row["position"]) ?? tracks.length,
      });
    }
  }
  tracks.sort((a, b) => a.position - b.position);
  return { id, name, tracks };
}

export function cratesOfResponse(data: unknown): DjCrate[] | null {
  if (!isRecord(data) || !Array.isArray(data["crates"])) return null;
  const out: DjCrate[] = [];
  for (const row of data["crates"]) {
    const crate = crateOf(row);
    if (crate) out.push(crate);
  }
  return out;
}

export function crateOfResponse(data: unknown): DjCrate | null {
  if (!isRecord(data)) return null;
  return crateOf(data["crate"]);
}

export function proposalOfResponse(data: unknown): DjProposal | null {
  if (!isRecord(data) || !isRecord(data["proposal"])) return null;
  const p = data["proposal"];
  if (!Array.isArray(p["order"]) || !p["order"].every((x) => typeof x === "string")) return null;
  const transitions: DjProposal["transitions"] = [];
  if (Array.isArray(p["transitions"])) {
    for (const row of p["transitions"]) {
      if (!isRecord(row)) continue;
      const fromSongId = str(row["fromSongId"]);
      const toSongId = str(row["toSongId"]);
      if (!fromSongId || !toSongId) continue;
      transitions.push({ fromSongId, toSongId, note: str(row["note"]) });
    }
  }
  return {
    order: [...(p["order"] as string[])],
    transitions,
    unanalyzed: Array.isArray(p["unanalyzed"])
      ? p["unanalyzed"].filter((x): x is string => typeof x === "string")
      : [],
  };
}

/* ── Membership + order helpers (the PATCH body's computations) ───── */

export function crateSongIds(crate: DjCrate): string[] {
  return crate.tracks.map((t) => t.songId);
}

export function withAdded(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

export function withoutId(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

/** Move the id at `index` one step; an edge move returns the
 *  same order (the desk disables those buttons rather than
 *  sending a no-op save). */
export function moved(ids: readonly string[], index: number, dir: -1 | 1): string[] {
  const target = index + dir;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return [...ids];
  const out = [...ids];
  const [item] = out.splice(index, 1);
  out.splice(target, 0, item!);
  return out;
}

/* ── Display ──────────────────────────────────────────────────────── */

export function durationLabel(durationSec: number | null): string {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec < 0) return "";
  const total = Math.round(durationSec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The analyzed facts as one line — only facts that exist. */
export function analysisLine(analysis: DjAnalysis | null): string {
  if (!analysis) return "Not analyzed yet";
  const parts: string[] = [];
  if (analysis.bpm !== null) parts.push(`${Math.round(analysis.bpm)} BPM`);
  if (analysis.camelot) parts.push(analysis.camelot);
  if (analysis.keyLabel) parts.push(analysis.keyLabel);
  return parts.length > 0 ? parts.join(" · ") : "Analyzed — no tempo or key found";
}
