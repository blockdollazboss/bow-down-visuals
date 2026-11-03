/**
 * setlist-desk — the Setlist desk's pure logic seam
 * (stack1500 world parity wave #3, census item 35).
 *
 * THE FEATURE (website): the Setlist Builder (pages/setlist.tsx,
 * helpers in lib/setlist.ts) — build the set by hand (add songs,
 * set durations + energy, reorder, stage notes) free, and ask
 * the AI for the flow: it orders the set across the night's arc
 * (opener → build → peak → breather → closer → encore) with a
 * one-line stage direction per song.
 *
 * THE RAILS:
 *   GET  /api/songs → { songs: [{ id, title, duration_sec }] } —
 *        the member's library, the builder's picker source
 *        (requireAuth; the page's LibrarySong shape).
 *   POST /api/setlist/flow { songs: [{ title, artist,
 *        durationSec, energy }], showNotes } →
 *        { order: [{ index, slot, note }], flowNotes,
 *          creditsUsed, creditsRemaining }
 *        (routes/generate/setlist.ts, requireAuth; 402 when
 *        broke; refunded when the model's answer is unusable).
 *
 * PRICE — READ from the credit-cost registry: 100, the route's
 * SETLIST_FLOW_CREDIT_COST, under the ledger action
 * "AI Setlist Flow" (also the confirmation's feature name). The
 * builder itself is free, exactly like the page.
 *
 * CONFIRMATION DISCIPLINE: the page posts without a spend
 * confirmation; the desk upgrades the flow run to
 * confirmedFetch with the registry cost as the explicit quote.
 * A decline runs nothing.
 *
 * SESSION STATE, NAMED: like the page, the set lives in the
 * panel for the sitting — the rails persist no setlist. The
 * desk never dresses the builder up as a saved library.
 *
 * DRIFT DISCIPLINE: the flow guard mirrors the route parser's
 * acceptance bar — every song exactly once, slots from the
 * rail's six, a note on every placement, flow notes present.
 * Anything less reads as failure (the route refunds exactly
 * those answers; the desk treats a drifted body the same way).
 */
import { getCreditCost } from "../credit-costs";
import type { FlowOrderItem, SetSong } from "../setlist";

function registryCost(path: string): number {
  const cost = getCreditCost(path)?.cost;
  if (typeof cost !== "number") {
    throw new Error(`setlist-desk: no credit-cost registry entry for ${path}`);
  }
  return cost;
}

export const SETLIST_FLOW_PATH = "/api/setlist/flow";
export const SETLIST_SONGS_PATH = "/api/songs";

export const SETLIST_FLOW_COST = registryCost(SETLIST_FLOW_PATH);
export const SETLIST_FEATURE = "AI Setlist Flow";

/** The flow schema's bounds (route MAX_SETLIST_SONGS = 40). */
export const SETLIST_MAX_SONGS = 40;

export const SETLIST_SLOTS = ["opener", "build", "peak", "breather", "closer", "encore"] as const;
export type SetlistSlot = (typeof SETLIST_SLOTS)[number];

/* ── The builder payload (the page's exact body) ──────────────────── */

export function buildFlowPayload(songs: readonly SetSong[], showNotes: string) {
  return {
    songs: songs.slice(0, SETLIST_MAX_SONGS).map((s) => ({
      title: s.title,
      artist: s.artist,
      durationSec: s.durationSec,
      energy: s.energy,
    })),
    showNotes: showNotes.trim(),
  };
}

export function flowReady(songs: readonly SetSong[]): boolean {
  return songs.length >= 1 && songs.length <= SETLIST_MAX_SONGS;
}

/* ── The library picker ───────────────────────────────────────────── */

export interface SetlistLibrarySong {
  id: string;
  title: string;
  durationSecRaw: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function libraryOfResponse(data: unknown): SetlistLibrarySong[] | null {
  if (!isRecord(data) || !Array.isArray(data["songs"])) return null;
  const out: SetlistLibrarySong[] = [];
  for (const row of data["songs"]) {
    if (!isRecord(row)) continue;
    const id = str(row["id"]);
    const title = str(row["title"]);
    if (!id || !title) continue;
    out.push({
      id,
      title,
      durationSecRaw: typeof row["duration_sec"] === "string" ? row["duration_sec"] : null,
    });
  }
  return out;
}

/** Library songs not already in the set (the page's title-match
 *  rule — a title in the set leaves the picker). */
export function libraryPicks(
  library: readonly SetlistLibrarySong[],
  songs: readonly SetSong[],
): SetlistLibrarySong[] {
  const inSet = new Set(songs.map((s) => s.title.toLowerCase()));
  return library.filter((s) => !inSet.has(s.title.toLowerCase()));
}

/* ── The flow guard (the route parser's acceptance bar) ───────────── */

export interface SetlistFlow {
  order: FlowOrderItem[];
  flowNotes: string;
}

export function flowOfResponse(data: unknown, songCount: number): SetlistFlow | null {
  if (!isRecord(data)) return null;
  const flowNotes = str(data["flowNotes"]);
  if (!flowNotes || !Array.isArray(data["order"])) return null;
  const seen = new Set<number>();
  const order: FlowOrderItem[] = [];
  for (const row of data["order"]) {
    if (!isRecord(row)) return null;
    const index = typeof row["index"] === "number" ? Math.floor(row["index"]) : -1;
    const slot = str(row["slot"]).toLowerCase();
    const note = str(row["note"]);
    if (index < 0 || index >= songCount || seen.has(index)) return null;
    if (!(SETLIST_SLOTS as readonly string[]).includes(slot)) return null;
    if (!note) return null;
    seen.add(index);
    order.push({ index, slot, note });
  }
  /* Every song exactly once — the route fails (and refunds) an
     answer that drops one; a drifted body gets the same verdict. */
  if (order.length !== songCount) return null;
  return { order, flowNotes };
}
