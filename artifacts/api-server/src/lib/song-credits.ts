/* ─── Song credits that TRAVEL with the song (Stack-200 N1) — pure machine ─
   The canonical credits layer. One song, one credits list, read by every
   surface (library play, pre-save/smartlink share, releases, profiles,
   exports) instead of each surface re-entering or losing credits.

   Sources merged here — NO second splits machine, NO second credits
   copy of a split:
   1. WRITERS + publishing shares — publishing_split_registrations /
      publishing_split_writers, validated at write time by the existing
      validateWriterSplits (lib/publishing-splits.ts). This module
      re-exports that validator as the ONLY writer-share gate and
      re-checks the merged writer list with it (read paths report the
      result as `writer_splits_valid` instead of throwing on legacy
      data; the canonical WRITE path throws, via the validator).
   2. MASTER shares — distribution_royalty_splits, the existing
      versioned ledger (only the CURRENT, non-superseded version is a
      credit; its `role` rides along when one was recorded).
   3. CO-RELEASE shares — co_release_sides frozen agreed shares (or the
      proposed shares while unpublished, labelled as proposed). The
      agreement itself is never rewritten here.
   4. CREDIT ENTRIES — song_credit_entries: the credits no rail above
      records (producers, featured artists, declared samples,
      engineers…). Entries carry no share on purpose.
   Plus the SONG'S OWNER as the primary artist credit when nothing else
   names them, and INHERITANCE: a release reads through its library
   song (distribution_releases.song_id) and a library song reads
   through its parent_song_id chain (remixes, covers, open-verse
   winners, loop builds). Inherited credits are labelled with the
   anchor they came from — never silently passed off as entered on
   this song.

   Honesty rules:
   - A song with no credits anywhere renders an explicit empty state
     ("No credits recorded yet"), never an invented name.
   - Credits come from real records only. Nothing here fabricates a
     person, a share, or a role.
   - Shares are shown per rail (publishing vs master vs co-release):
     they are different rights and are NEVER blended into one number. */

import { pgErrorCode, pgErrorText } from "./pg-errors";
import {
  validateWriterSplits,
  PublishingSplitError,
  type PublishingWriter,
} from "./publishing-splits";

export { validateWriterSplits, PublishingSplitError };

export const SONG_CREDIT_KINDS = ["song", "release"] as const;
export type SongCreditKind = (typeof SONG_CREDIT_KINDS)[number];

export const SONG_CREDIT_ROLES = [
  "featured_artist",
  "producer",
  "sample",
  "engineer",
  "mixer",
  "mastering",
  "arranger",
  "other",
] as const;
export type SongCreditRole = (typeof SONG_CREDIT_ROLES)[number];

export const SONG_CREDIT_ROLE_LABELS: Record<SongCreditRole, string> = {
  featured_artist: "Featured artist",
  producer: "Producer",
  sample: "Sample",
  engineer: "Engineer",
  mixer: "Mixing",
  mastering: "Mastering",
  arranger: "Arranger",
  other: "Credit",
};

export const SONG_CREDITS_COPY = {
  empty: "No credits recorded yet.",
  emptyOwnerHint:
    "Add the writers, producers, featured artists and samples once — they follow this song to every release, share and play surface.",
  followsSong:
    "Credits are recorded once on the song and follow it everywhere — releases, shares, plays and exports read this same list.",
} as const;

export const SONG_CREDITS_NOT_READY = {
  error: "song_credits_not_ready",
  message:
    "Song credit entries aren't switched on yet — the splits already registered for this song are safe, and entry opens as soon as the credits storage lands.",
} as const;

/** Postgres "undefined table" (42P01) scoped to OUR tables — same
 *  detector pattern as the publishing registry. */
export function isMissingSongCreditTable(err: unknown): boolean {
  if (pgErrorCode(err) === "42P01") {
    return /song_credit_/.test(pgErrorText(err)) || pgErrorText(err) === "";
  }
  const text = pgErrorText(err);
  return /song_credit_/.test(text) && /(does not exist|undefined table|no such table)/i.test(text);
}

export class SongCreditError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ── Shapes ────────────────────────────────────────────────────────────── */

export interface SongAnchor {
  kind: SongCreditKind;
  id: string;
}

export interface CreditEntryInput {
  role: SongCreditRole;
  name: string;
  userId?: string | null;
  profileId?: string | null;
  detail?: string | null;
}

export interface CreditEntry {
  id: string | null;
  role: SongCreditRole;
  displayName: string;
  creditUserId: string | null;
  creditProfileId: string | null;
  detail: string | null;
  sortOrder: number;
}

export type CreditShareSource = "publishing" | "master" | "co_release";

export interface CanonicalCredit {
  /* Stable merge key: the same person credited on several rails is ONE
     credit with several roles/shares, not three rows. */
  key: string;
  name: string;
  profileId: string | null;
  profileSlug: string | null;
  userId: string | null;
  /* 'artist' (the owner) | 'writer' | one of SONG_CREDIT_ROLES. */
  roles: string[];
  roleLabels: string[];
  /* Shares stay per-rail — different rights, never blended. */
  shares: Array<{ source: CreditShareSource; pct: number; frozen?: boolean }>;
  writerStatus: string | null; // publishing confirmation status, when a writer
  detail: string | null; // sample source / role note (first non-empty)
  sources: Array<CreditShareSource | "credit_entry" | "owner">;
  inheritedFrom: SongAnchor | null; // null = recorded on this song itself
}

export interface CanonicalSongCredits {
  anchor: SongAnchor;
  songTitle: string;
  credits: CanonicalCredit[];
  hasCredits: boolean;
  /* True when the merged publishing writers pass validateWriterSplits
     (sum = 100). Null when the song has no publishing writers at all —
     absence is honest, not invalid. */
  writerSplitsValid: boolean | null;
  writerSplitsError: string | null;
  version: number; // latest audit revision (0 = never edited via the canonical layer)
  inheritedFromAnchors: SongAnchor[];
}

/* ── Entry validation ──────────────────────────────────────────────────── */

export const MAX_CREDIT_ENTRIES_PER_SONG = 40;

export function validateCreditEntries(entries: CreditEntryInput[]): void {
  if (!Array.isArray(entries)) {
    throw new SongCreditError("entries_invalid", "Credits must be a list.");
  }
  if (entries.length > MAX_CREDIT_ENTRIES_PER_SONG) {
    throw new SongCreditError(
      "too_many_entries",
      `A song can list at most ${MAX_CREDIT_ENTRIES_PER_SONG} credit entries.`,
    );
  }
  const seen = new Set<string>();
  for (const e of entries) {
    if (!SONG_CREDIT_ROLES.includes(e.role)) {
      throw new SongCreditError("credit_role", "Each credit needs a known role.");
    }
    if (typeof e.name !== "string" || e.name.trim() === "") {
      throw new SongCreditError("credit_name", "Each credit needs a name.");
    }
    if (e.role === "sample" && !(e.detail ?? "").trim()) {
      throw new SongCreditError(
        "sample_detail",
        "A declared sample needs its source — the sampled work's title and artist.",
      );
    }
    const dupKey = `${e.role}:${(e.profileId ?? e.userId ?? e.name.trim().toLowerCase())}`;
    if (seen.has(dupKey)) {
      throw new SongCreditError(
        "duplicate_credit",
        `"${e.name.trim()}" is already credited as ${SONG_CREDIT_ROLE_LABELS[e.role]} — list them once.`,
      );
    }
    seen.add(dupKey);
  }
}

export function normalizeCreditEntries(entries: CreditEntryInput[]): CreditEntry[] {
  validateCreditEntries(entries);
  return entries.map((e, i) => ({
    id: null,
    role: e.role,
    displayName: e.name.trim(),
    creditUserId: e.userId ?? null,
    creditProfileId: e.profileId ?? null,
    detail: (e.detail ?? "").trim() || null,
    sortOrder: i,
  }));
}

/* ── The merge ─────────────────────────────────────────────────────────── */

export interface CreditSources {
  owner: { userId: string; profileId: string | null; profileSlug: string | null; displayName: string } | null;
  publishingWriters: PublishingWriter[];
  masterSplits: Array<{
    payeeName: string;
    role: string | null;
    sharePct: number;
    /* distribution_royalty_splits links payees by name/email only — no
       profile id exists on that rail, so master credits are name-only
       unless the name also appears on a linked rail. */
  }>;
  coReleaseSides: Array<{
    profileId: string;
    userId: string;
    displayName: string;
    profileSlug: string | null;
    sharePct: number;
    frozen: boolean;
  }>;
  entries: CreditEntry[];
  inheritedFrom: SongAnchor | null;
}

const ROLE_ORDER: Record<string, number> = {
  artist: 0,
  featured_artist: 1,
  writer: 2,
  producer: 3,
  arranger: 4,
  engineer: 5,
  mixer: 6,
  mastering: 7,
  sample: 8,
  other: 9,
};

function roleLabel(role: string): string {
  if (role === "artist") return "Artist";
  if (role === "writer") return "Songwriter";
  return SONG_CREDIT_ROLE_LABELS[role as SongCreditRole] ?? "Credit";
}

/** Merge every rail's records for ONE anchor into the canonical list.
 *  Pure: the DB layer fetches, this decides. Merging keys on profile id
 *  first, then user id, then (for name-only rails) an exact name match
 *  against an already-linked credit — a name-only split NEVER merges
 *  into a different person who merely shares a first name. */
export function mergeCanonicalCredits(sources: CreditSources): CanonicalCredit[] {
  const byKey = new Map<string, CanonicalCredit>();
  const byProfile = new Map<string, CanonicalCredit>();
  const byUser = new Map<string, CanonicalCredit>();
  const byName = new Map<string, CanonicalCredit>();

  function obtain(init: {
    name: string;
    profileId?: string | null;
    profileSlug?: string | null;
    userId?: string | null;
  }): CanonicalCredit {
    let c: CanonicalCredit | undefined;
    if (init.profileId) c = byProfile.get(init.profileId);
    if (!c && init.userId) c = byUser.get(init.userId);
    if (!c && !init.profileId && !init.userId) c = byName.get(init.name.trim().toLowerCase());
    if (!c) {
      c = {
        key: init.profileId ?? init.userId ?? `name:${init.name.trim().toLowerCase()}`,
        name: init.name,
        profileId: init.profileId ?? null,
        profileSlug: init.profileSlug ?? null,
        userId: init.userId ?? null,
        roles: [],
        roleLabels: [],
        shares: [],
        writerStatus: null,
        detail: null,
        sources: [],
        inheritedFrom: sources.inheritedFrom,
      };
      byKey.set(c.key, c);
    }
    if (init.profileId && !c.profileId) c.profileId = init.profileId;
    if (init.profileSlug && !c.profileSlug) c.profileSlug = init.profileSlug;
    if (init.userId && !c.userId) c.userId = init.userId;
    if (c.profileId) byProfile.set(c.profileId, c);
    if (c.userId) byUser.set(c.userId, c);
    byName.set(c.name.trim().toLowerCase(), c);
    return c;
  }

  function addRole(c: CanonicalCredit, role: string) {
    if (!c.roles.includes(role)) {
      c.roles.push(role);
      c.roleLabels.push(roleLabel(role));
    }
  }
  function addSource(c: CanonicalCredit, s: CanonicalCredit["sources"][number]) {
    if (!c.sources.includes(s)) c.sources.push(s);
  }

  if (sources.owner && sources.owner.displayName.trim()) {
    const c = obtain({
      name: sources.owner.displayName,
      profileId: sources.owner.profileId,
      profileSlug: sources.owner.profileSlug,
      userId: sources.owner.userId,
    });
    addRole(c, "artist");
    addSource(c, "owner");
  }

  for (const w of sources.publishingWriters) {
    const c = obtain({
      name: w.writerName,
      profileId: w.writerProfileId,
      userId: w.writerUserId,
    });
    addRole(c, "writer");
    addSource(c, "publishing");
    c.shares.push({ source: "publishing", pct: w.sharePct });
    c.writerStatus = w.confirmationStatus;
  }

  for (const s of sources.coReleaseSides) {
    const c = obtain({
      name: s.displayName,
      profileId: s.profileId,
      profileSlug: s.profileSlug,
      userId: s.userId,
    });
    addSource(c, "co_release");
    c.shares.push({ source: "co_release", pct: s.sharePct, frozen: s.frozen });
  }

  for (const m of sources.masterSplits) {
    const c = obtain({ name: m.payeeName });
    addSource(c, "master");
    if (m.role && m.role.trim()) addRole(c, m.role.trim().toLowerCase());
    c.shares.push({ source: "master", pct: m.sharePct });
  }

  for (const e of [...sources.entries].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const c = obtain({
      name: e.displayName,
      profileId: e.creditProfileId,
      userId: e.creditUserId,
    });
    addRole(c, e.role);
    addSource(c, "credit_entry");
    if (e.detail && !c.detail) c.detail = e.detail;
  }

  const out = [...byKey.values()];
  out.sort((a, b) => {
    const ra = Math.min(...a.roles.map((r) => ROLE_ORDER[r] ?? 9));
    const rb = Math.min(...b.roles.map((r) => ROLE_ORDER[r] ?? 9));
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/** Check the merged writer list against the EXISTING validator — the
 *  sum-to-100 rule lives in publishing-splits.ts and nowhere else.
 *  Returns nulls when the song has no publishing writers. */
export function checkWriterSplits(
  writers: PublishingWriter[],
): { valid: boolean | null; error: string | null } {
  if (writers.length === 0) return { valid: null, error: null };
  try {
    validateWriterSplits(
      writers.map((w) => ({
        name: w.writerName,
        userId: w.writerUserId,
        profileId: w.writerProfileId,
        sharePct: w.sharePct,
      })),
    );
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Writer splits are invalid." };
  }
}

/** Assemble the canonical DTO from per-anchor source bundles. Earlier
 *  anchors win: a credit recorded on THIS song is not duplicated by the
 *  same credit inherited from a parent — it is the same record
 *  travelling, so the direct one is listed and the anchor is noted. */
export function buildCanonicalCredits(input: {
  anchor: SongAnchor;
  songTitle: string;
  version: number;
  bundles: Array<{ anchor: SongAnchor; sources: CreditSources }>;
}): CanonicalSongCredits {
  const credits: CanonicalCredit[] = [];
  const seenKeys = new Set<string>();
  const seenPersons = new Set<string>();
  const inheritedFromAnchors: SongAnchor[] = [];
  let allWriters: PublishingWriter[] = [];

  input.bundles.forEach((bundle, idx) => {
    const merged = mergeCanonicalCredits(bundle.sources);
    if (idx > 0 && merged.length > 0) inheritedFromAnchors.push(bundle.anchor);
    for (const c of merged) {
      const personKey = c.profileId ?? c.userId ?? `name:${c.name.trim().toLowerCase()}`;
      if (seenKeys.has(c.key) || seenPersons.has(personKey)) continue;
      seenKeys.add(c.key);
      seenPersons.add(personKey);
      credits.push(c);
    }
    if (idx === 0) allWriters = bundle.sources.publishingWriters;
    else if (allWriters.length === 0) allWriters = bundle.sources.publishingWriters;
  });

  const check = checkWriterSplits(allWriters);
  return {
    anchor: input.anchor,
    songTitle: input.songTitle,
    credits,
    hasCredits: credits.length > 0,
    writerSplitsValid: check.valid,
    writerSplitsError: check.error,
    version: input.version,
    inheritedFromAnchors,
  };
}

/* ── Plain-text credits sheet (export / share surfaces) ────────────────── */

export function buildCreditsSheet(credits: CanonicalSongCredits, at: Date = new Date()): string {
  const ymd = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  const lines: string[] = [
    "BOW DOWN VISUALS — SONG CREDITS",
    `Song: ${credits.songTitle}`,
    `Song reference: ${credits.anchor.kind}:${credits.anchor.id}`,
    `Credits version: ${credits.version} (${ymd})`,
    "",
  ];
  if (!credits.hasCredits) {
    lines.push(SONG_CREDITS_COPY.empty);
  } else {
    for (const c of credits.credits) {
      const shareText = c.shares
        .map((s) => `${s.pct.toFixed(2)}% ${s.source === "publishing" ? "publishing" : s.source === "master" ? "master" : "co-release"}${s.frozen ? " (agreed)" : ""}`)
        .join("; ");
      lines.push(
        `- ${c.name} — ${c.roleLabels.join(", ")}${shareText ? ` — ${shareText}` : ""}${c.detail ? ` — ${c.detail}` : ""}${c.inheritedFrom ? " (carried from the original song)" : ""}`,
      );
    }
  }
  lines.push("", SONG_CREDITS_COPY.followsSong);
  return lines.join("\n");
}
