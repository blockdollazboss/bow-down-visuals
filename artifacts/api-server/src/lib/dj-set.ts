/**
 * dj-set.ts — the Set Builder brain + DJ library export (pure logic).
 *
 * Harmonic ordering follows the Camelot wheel, the system every DJ app
 * speaks: from any key, the smooth moves are the SAME code (perfect
 * blend), ±1 number on the same side (energy shift), or the same number
 * on the other side (relative major/minor). Thy Cheat Code PROPOSES an
 * order — key-compatible transitions first, tempo climbing as an energy
 * arc — and the creator drags it into their own. This module never
 * mutates a crate; it only suggests.
 *
 * Exports target the two interchange formats the DJ industry trades in:
 * rekordbox XML (collection + playlist) and extended M3U. BPM/key ride
 * in the fields each format actually carries (AverageBpm / Tonality in
 * rekordbox XML; comment lines in M3U, which has no key field).
 */

export interface DjTrackMeta {
  songId: string;
  title: string;
  /** Storage/download URL of the audio file. */
  audioUrl: string;
  durationSec: number | null;
  bpm: number | null;
  /** "A minor" — null when unanalyzed or no key found. */
  keyLabel: string | null;
  /** "8A" — null when unknown. */
  camelot: string | null;
  /** Rekordbox tonality ("Am") — derived from keyLabel parts when set. */
  tonality: string | null;
  keyConfidence: "high" | "medium" | "low" | null;
}

/* ── Camelot geometry ─────────────────────────────────────────────────── */

export function parseCamelot(code: string): { num: number; side: "A" | "B" } | null {
  const m = /^(\d{1,2})([AB])$/.exec(code.trim());
  if (!m) return null;
  const num = Number(m[1]);
  if (num < 1 || num > 12) return null;
  return { num, side: m[2] as "A" | "B" };
}

/**
 * Harmonic distance between two Camelot codes:
 *  0 = same code (perfect blend)
 *  1 = ±1 number same side, or relative major/minor (same number)
 *  2 = two steps around the wheel
 *  3 = anything further (a key clash to plan around)
 */
export function camelotDistance(a: string, b: string): number {
  const pa = parseCamelot(a);
  const pb = parseCamelot(b);
  if (!pa || !pb) return 3;
  if (pa.num === pb.num && pa.side === pb.side) return 0;
  if (pa.num === pb.num) return 1; // relative major/minor
  const step = Math.min(Math.abs(pa.num - pb.num), 12 - Math.abs(pa.num - pb.num));
  if (pa.side === pb.side) return step === 1 ? 1 : step === 2 ? 2 : 3;
  // Different side AND different number: relative shift plus wheel steps.
  return Math.min(3, step + 1);
}

/** Tempo distance, half/double-time aware (a 70 BPM track rides over 140). */
export function bpmDistance(a: number, b: number): number {
  let best = Math.abs(a - b);
  for (const m of [0.5, 2]) best = Math.min(best, Math.abs(a - b * m));
  return best;
}

export interface TransitionNote {
  fromSongId: string;
  toSongId: string;
  /** Plain-language read of the transition, e.g. "8A → 8A — same key". */
  note: string;
  keyDistance: number | null;
  bpmDelta: number | null;
}

function describeTransition(from: DjTrackMeta, to: DjTrackMeta): TransitionNote {
  const parts: string[] = [];
  let keyDistance: number | null = null;
  if (from.camelot && to.camelot) {
    keyDistance = camelotDistance(from.camelot, to.camelot);
    const label =
      keyDistance === 0
        ? "same key — seamless blend"
        : keyDistance === 1
          ? "harmonic step — smooth"
          : keyDistance === 2
            ? "two keys apart — workable with a longer blend"
            : "key jump — plan an effect or echo-out here";
    parts.push(`${from.camelot} → ${to.camelot} — ${label}`);
  } else {
    parts.push("key unknown on one side — placed by tempo");
  }
  let bpmDelta: number | null = null;
  if (from.bpm != null && to.bpm != null) {
    bpmDelta = Math.round((to.bpm - from.bpm) * 10) / 10;
    parts.push(`tempo ${bpmDelta >= 0 ? "+" : ""}${bpmDelta} BPM`);
  }
  return {
    fromSongId: from.songId,
    toSongId: to.songId,
    note: parts.join(" · "),
    keyDistance,
    bpmDelta,
  };
}

/* ── The proposal ─────────────────────────────────────────────────────── */

/**
 * Cost of putting `next` right after `current`. Lower is smoother.
 * Key compatibility dominates; tempo closeness matters; a gentle
 * preference for rising tempo builds the energy arc.
 */
function transitionCost(current: DjTrackMeta, next: DjTrackMeta): number {
  let cost = 0;
  if (current.camelot && next.camelot) {
    cost += camelotDistance(current.camelot, next.camelot) * 2;
  } else {
    cost += 1.5; // unknown key — neither trusted nor banished
  }
  if (current.bpm != null && next.bpm != null) {
    cost += bpmDistance(current.bpm, next.bpm) / 6;
    if (next.bpm < current.bpm - 2) cost += 0.4; // energy dips cost a little
  } else {
    cost += 1;
  }
  return cost;
}

export interface SetProposal {
  /** Song ids in the proposed play order (a permutation of the input). */
  order: string[];
  transitions: TransitionNote[];
  /** Song ids with no key and/or no tempo — placed by what we do know. */
  unanalyzed: string[];
}

/**
 * Greedy harmonic ordering: open on the lowest-tempo analyzed track
 * (sets start low), then repeatedly take the smoothest next transition.
 * Fully deterministic — same crate, same proposal, every time.
 */
export function proposeSetOrder(tracks: DjTrackMeta[]): SetProposal {
  const unanalyzed = tracks
    .filter((t) => t.camelot == null || t.bpm == null)
    .map((t) => t.songId);
  if (tracks.length === 0) return { order: [], transitions: [], unanalyzed };

  const pool = [...tracks];
  // Opener: lowest BPM among tracks that have one; else the first track.
  let startIdx = 0;
  let startBpm = Infinity;
  pool.forEach((t, i) => {
    if (t.bpm != null && t.bpm < startBpm) {
      startBpm = t.bpm;
      startIdx = i;
    }
  });
  const ordered: DjTrackMeta[] = [pool.splice(startIdx, 1)[0]!];
  while (pool.length > 0) {
    const current = ordered[ordered.length - 1]!;
    let bestIdx = 0;
    let bestCost = Infinity;
    pool.forEach((candidate, i) => {
      const c = transitionCost(current, candidate);
      if (c < bestCost - 1e-9) {
        bestCost = c;
        bestIdx = i;
      }
    });
    ordered.push(pool.splice(bestIdx, 1)[0]!);
  }
  const transitions: TransitionNote[] = [];
  for (let i = 1; i < ordered.length; i++) {
    transitions.push(describeTransition(ordered[i - 1]!, ordered[i]!));
  }
  return { order: ordered.map((t) => t.songId), transitions, unanalyzed };
}

/* ── Export: rekordbox XML ────────────────────────────────────────────── */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Filename a DJ drops next to the XML — from the audio URL when it has
 *  one, else a sanitized title. rekordbox resolves Location on disk, so
 *  the export speaks in filenames, not stream URLs. */
export function exportFileName(track: DjTrackMeta): string {
  try {
    const u = new URL(track.audioUrl);
    const base = decodeURIComponent(u.pathname.split("/").pop() ?? "");
    if (/\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(base)) return base;
  } catch {
    /* not a URL — fall through to the title */
  }
  const clean = track.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ") || "track";
  return `${clean}.mp3`;
}

export function buildRekordboxXml(crateName: string, tracks: DjTrackMeta[]): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<DJ_PLAYLISTS Version="1.0.0">`);
  lines.push(`<PRODUCT Name="Bow Down Visuals" Version="1.0.0" Company="Bow Down Visuals"/>`);
  lines.push(`<COLLECTION Entries="${tracks.length}">`);
  tracks.forEach((t, i) => {
    const id = i + 1;
    const attrs: string[] = [
      `TrackID="${id}"`,
      `Name="${xmlEscape(t.title)}"`,
      `Location="file://localhost/${xmlEscape(encodeURIComponent(exportFileName(t)).replace(/%2F/g, "/"))}"`,
    ];
    if (t.bpm != null) attrs.push(`AverageBpm="${t.bpm.toFixed(2)}"`);
    if (t.tonality) attrs.push(`Tonality="${xmlEscape(t.tonality)}"`);
    if (t.durationSec != null) attrs.push(`TotalTime="${Math.round(t.durationSec)}"`);
    const comment = [
      t.camelot ? `Camelot ${t.camelot}` : null,
      t.keyConfidence === "low" ? "key estimated (low confidence)" : null,
      "via Bow Down Visuals",
    ]
      .filter(Boolean)
      .join(" · ");
    attrs.push(`Comments="${xmlEscape(comment)}"`);
    lines.push(`<TRACK ${attrs.join(" ")}/>`);
  });
  lines.push(`</COLLECTION>`);
  lines.push(`<PLAYLISTS>`);
  lines.push(`<NODE Type="0" Name="ROOT" Count="1">`);
  lines.push(`<NODE Type="1" Name="${xmlEscape(crateName)}" Entries="${tracks.length}">`);
  tracks.forEach((_, i) => lines.push(`<TRACK Key="${i + 1}"/>`));
  lines.push(`</NODE>`);
  lines.push(`</NODE>`);
  lines.push(`</PLAYLISTS>`);
  lines.push(`</DJ_PLAYLISTS>`);
  return lines.join("\n") + "\n";
}

/* ── Export: M3U ──────────────────────────────────────────────────────── */

export function buildM3u(crateName: string, tracks: DjTrackMeta[]): string {
  const lines: string[] = [`#EXTM3U`, `#PLAYLIST:${crateName}`];
  for (const t of tracks) {
    const dur = t.durationSec != null ? Math.round(t.durationSec) : -1;
    lines.push(`#EXTINF:${dur},${t.title}`);
    // M3U has no BPM/key fields — they ride in a comment line, which
    // players skip and DJs (and other tools) can still read.
    const meta = [
      t.bpm != null ? `${t.bpm} BPM` : null,
      t.keyLabel ?? null,
      t.camelot ? `Camelot ${t.camelot}` : null,
      t.keyConfidence === "low" ? "key estimated, low confidence" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (meta) lines.push(`# Bow Down Visuals: ${meta}`);
    lines.push(t.audioUrl);
  }
  return lines.join("\n") + "\n";
}
