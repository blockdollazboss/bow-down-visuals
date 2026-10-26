/* ─── Sample Clearance Lane (Stack-200 N2) ───────────────────────────
   Declared samples on a track get RISK FLAGS in plain words, and the
   lane OFFERS CLEARED-LOOP ALTERNATIVES (licensable material from the
   existing Beats Marketplace catalog) before a risky track ships.

   Declaring is the creator's honesty; this module's job is flags +
   alternatives, never silent passage:
   - A flag WARNS. It never silently blocks. The one gate: shipping a
     release whose track carries a flagged declaration the creator has
     not acknowledged answers 409 until the creator records an explicit
     acknowledgement on the declaration (see the distribution submit
     hook). Acknowledging is one tap and is recorded with a timestamp.
   - clearance_status is CREATOR-STATED, always. No code path in this
     module verifies a license, and no wire shape calls a claim
     "verified" — the flag copy says "you told us" / "your statement".

   The declaration rides the track's credits (N1, sibling lane
   stack200/rem-song-credits, not in this base): declarations live in
   sample_declarations keyed to songs.id and are exposed read-only via
   GET /api/sample-clearance/songs/:songId/credits-summary so the
   credits layer can render them at join.

   NO MONEY: nothing here charges, prices, or splits anything. */

import {
  db,
  sampleDeclarationsTable,
  songsTable,
  beatsTable,
  type SampleClearanceStatus,
  type SampleUseKind,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";

export type FlagLevel = "none" | "caution" | "high";

export interface RiskFlag {
  level: FlagLevel;
  /** One plain-words headline a creator understands at a glance. */
  headline: string;
  /** The reason, stated in plain language — the rule is transparent. */
  reason: string;
  /** True when the claim behind a "none" flag is the creator's own
   *  statement (always true today — the platform verifies nothing). */
  creatorStated: boolean;
}

/* ─── The flag rules (transparent, pure) ─────────────────────────────
   Inputs are ONLY what the creator declared: their stated clearance,
   whether they say the source is recognizable, and how it is used. */
export function computeRiskFlag(input: {
  clearanceStatus: SampleClearanceStatus;
  recognizable: boolean;
  useKind: SampleUseKind;
}): RiskFlag {
  const { clearanceStatus, recognizable, useKind } = input;
  switch (clearanceStatus) {
    case "licensed":
      return {
        level: "none",
        headline: "No flag — you say this sample is licensed.",
        reason:
          "You told us you have a license or clearance for this sample. That is your statement — Bow Down Visuals has not verified it, and your credits will show it as declared by you.",
        creatorStated: true,
      };
    case "public_domain_or_original":
      return {
        level: "none",
        headline: "No flag — you say this source is public domain or your own recording.",
        reason:
          "You told us the source is public domain, or that it is your own original recording. That is your statement — Bow Down Visuals has not verified it, and your credits will show it as declared by you.",
        creatorStated: true,
      };
    case "unsure":
      return {
        level: "caution",
        headline: "Caution — you're not sure this sample is cleared.",
        reason:
          "You said you're not sure whether this sample is cleared. Shipping a sample you can't confirm is cleared can get the track taken down or its earnings claimed by the rights holder. Check before you ship, or swap in a cleared alternative below.",
        creatorStated: true,
      };
    case "not_cleared":
      if (recognizable) {
        return {
          level: "high",
          headline: "High risk — this sample is not cleared, and listeners can recognize the source.",
          reason:
            useKind === "loop" || useKind === "replay"
              ? "You declared a sample you do not have a license for, used as a recognizable piece of someone else's recording. Shipping it can lead to a takedown, a blocked release, or the rights holder claiming this track's earnings. Clear it, re-play it as an interpolation with permission, or swap in a cleared alternative below."
              : "You declared a sample you do not have a license for, and you said listeners can recognize the source. Shipping it can lead to a takedown, a blocked release, or the rights holder claiming this track's earnings. Clear it first, or swap in a cleared alternative below.",
          creatorStated: true,
        };
      }
      return {
        level: "caution",
        headline: "Caution — this sample is not cleared.",
        reason:
          "You declared a sample you do not have a license for. You said the source isn't recognizable, which lowers the chance anyone spots it — it does not make the sample cleared. A takedown or earnings claim is still possible.",
        creatorStated: true,
      };
  }
}

/** A flagged declaration must be explicitly acknowledged before the
 *  track ships. "None"-flag declarations never need acknowledgement. */
export function needsAcknowledgement(flag: RiskFlag, acknowledged: boolean): boolean {
  return flag.level !== "none" && !acknowledged;
}

/* ─── Wire shape ───────────────────────────────────────────────────── */

export interface DeclarationWire {
  id: string;
  songId: string;
  userId: string;
  sourceDescription: string;
  useKind: SampleUseKind;
  clearanceStatus: SampleClearanceStatus;
  /** Labelled creator-stated everywhere it renders — never "verified". */
  clearanceLabel: string;
  recognizable: boolean;
  riskAcknowledged: boolean;
  riskAcknowledgedAt: string | null;
  flag: RiskFlag;
  needsAcknowledgement: boolean;
  createdAt: string;
  updatedAt: string;
}

export class SampleClearanceError extends Error {
  code: "not_found" | "not_owner" | "validation";
  constructor(code: SampleClearanceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ─── Storage seam (drizzle in production, in-memory in tests) ─────── */

export interface DeclarationRow {
  id: string;
  songId: string;
  userId: string;
  sourceDescription: string;
  useKind: SampleUseKind;
  clearanceStatus: SampleClearanceStatus;
  recognizable: boolean;
  riskAcknowledged: boolean;
  riskAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BeatCandidate {
  id: string;
  title: string;
  genre: string;
  bpm: number | null;
  musicalKey: string | null;
  moodTags: string[];
  previewUrl: string | null;
  audioUrl: string;
}

export interface SampleClearanceStore {
  getSongOwner(songId: string): Promise<{ userId: string; title: string; genre: string | null } | null>;
  insertDeclaration(row: Omit<DeclarationRow, "id" | "createdAt" | "updatedAt">): Promise<DeclarationRow>;
  listDeclarationsForSong(songId: string): Promise<DeclarationRow[]>;
  getDeclaration(id: string): Promise<DeclarationRow | null>;
  updateDeclaration(id: string, patch: Partial<DeclarationRow>): Promise<DeclarationRow | null>;
  deleteDeclaration(id: string): Promise<boolean>;
  listBeats(): Promise<BeatCandidate[]>;
  /** Releases are read from the distribution rails (raw row shape). */
  getReleaseSongIds(releaseId: string, userId: string): Promise<string[] | null>;
}

function rowToWire(r: DeclarationRow): DeclarationWire {
  const flag = computeRiskFlag({ clearanceStatus: r.clearanceStatus, recognizable: r.recognizable, useKind: r.useKind });
  return {
    id: r.id,
    songId: r.songId,
    userId: r.userId,
    sourceDescription: r.sourceDescription,
    useKind: r.useKind,
    clearanceStatus: r.clearanceStatus,
    clearanceLabel: "Declared by the creator — not verified by Bow Down Visuals",
    recognizable: r.recognizable,
    riskAcknowledged: r.riskAcknowledged,
    riskAcknowledgedAt: r.riskAcknowledgedAt,
    flag,
    needsAcknowledgement: needsAcknowledgement(flag, r.riskAcknowledged),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function dbRowToRow(r: typeof sampleDeclarationsTable.$inferSelect): DeclarationRow {
  return {
    id: r.id,
    songId: r.song_id,
    userId: r.user_id,
    sourceDescription: r.source_description,
    useKind: r.use_kind as SampleUseKind,
    clearanceStatus: r.clearance_status as SampleClearanceStatus,
    recognizable: r.recognizable,
    riskAcknowledged: r.risk_acknowledged,
    riskAcknowledgedAt: r.risk_acknowledged_at ? new Date(r.risk_acknowledged_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export const drizzleSampleClearanceStore: SampleClearanceStore = {
  async getSongOwner(songId) {
    const rows = await db
      .select({ userId: songsTable.user_id, title: songsTable.title, genre: songsTable.genre })
      .from(songsTable)
      .where(eq(songsTable.id, songId))
      .limit(1);
    return rows[0] ?? null;
  },
  async insertDeclaration(row) {
    const [inserted] = await db
      .insert(sampleDeclarationsTable)
      .values({
        song_id: row.songId,
        user_id: row.userId,
        source_description: row.sourceDescription,
        use_kind: row.useKind,
        clearance_status: row.clearanceStatus,
        recognizable: row.recognizable,
        risk_acknowledged: row.riskAcknowledged,
        risk_acknowledged_at: row.riskAcknowledgedAt ? new Date(row.riskAcknowledgedAt) : null,
      })
      .returning();
    return dbRowToRow(inserted!);
  },
  async listDeclarationsForSong(songId) {
    const rows = await db
      .select()
      .from(sampleDeclarationsTable)
      .where(eq(sampleDeclarationsTable.song_id, songId))
      .orderBy(desc(sampleDeclarationsTable.created_at));
    return rows.map(dbRowToRow);
  },
  async getDeclaration(id) {
    const rows = await db.select().from(sampleDeclarationsTable).where(eq(sampleDeclarationsTable.id, id)).limit(1);
    return rows[0] ? dbRowToRow(rows[0]) : null;
  },
  async updateDeclaration(id, patch) {
    const values: Record<string, unknown> = { updated_at: new Date() };
    if (patch.sourceDescription !== undefined) values["source_description"] = patch.sourceDescription;
    if (patch.useKind !== undefined) values["use_kind"] = patch.useKind;
    if (patch.clearanceStatus !== undefined) values["clearance_status"] = patch.clearanceStatus;
    if (patch.recognizable !== undefined) values["recognizable"] = patch.recognizable;
    if (patch.riskAcknowledged !== undefined) values["risk_acknowledged"] = patch.riskAcknowledged;
    if (patch.riskAcknowledgedAt !== undefined)
      values["risk_acknowledged_at"] = patch.riskAcknowledgedAt ? new Date(patch.riskAcknowledgedAt) : null;
    const [updated] = await db
      .update(sampleDeclarationsTable)
      .set(values)
      .where(eq(sampleDeclarationsTable.id, id))
      .returning();
    return updated ? dbRowToRow(updated) : null;
  },
  async deleteDeclaration(id) {
    const deleted = await db.delete(sampleDeclarationsTable).where(eq(sampleDeclarationsTable.id, id)).returning();
    return deleted.length > 0;
  },
  async listBeats() {
    const rows = await db.select().from(beatsTable).orderBy(desc(beatsTable.created_at)).limit(200);
    return rows.map((b) => ({
      id: b.id,
      title: b.title,
      genre: b.genre,
      bpm: b.bpm,
      musicalKey: b.musical_key,
      moodTags: b.mood_tags ?? [],
      previewUrl: b.preview_url,
      audioUrl: b.audio_url,
    }));
  },
  async getReleaseSongIds(releaseId, userId) {
    /* distribution_releases.song_id exists in the DB (the distribution
       route reads it via raw SQL) but is not on the drizzle schema —
       raw SQL here matches that rail's own pattern. */
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT song_id FROM distribution_releases WHERE id = ${releaseId} AND user_id = ${userId} LIMIT 1
    `);
    const row = result.rows[0] as { song_id: string | null } | undefined;
    if (!row) return null;
    return row.song_id ? [row.song_id] : [];
  },
};

/* ─── Business logic ───────────────────────────────────────────────── */

export interface DeclareInput {
  sourceDescription: string;
  useKind: SampleUseKind;
  clearanceStatus: SampleClearanceStatus;
  recognizable: boolean;
}

function validateDeclareInput(input: DeclareInput): void {
  if (!input.sourceDescription || input.sourceDescription.trim().length < 3) {
    throw new SampleClearanceError("validation", "Describe what you sampled in a few words — this rides your track's credits.");
  }
  if (input.sourceDescription.length > 500) {
    throw new SampleClearanceError("validation", "Keep the sample description under 500 characters.");
  }
}

/** Declare a sample on a song the caller OWNS (verified against the
 *  songs rails — a song that isn't theirs, or doesn't exist, refuses). */
export async function declareSample(
  store: SampleClearanceStore,
  userId: string,
  songId: string,
  input: DeclareInput,
): Promise<DeclarationWire> {
  validateDeclareInput(input);
  const song = await store.getSongOwner(songId);
  if (!song) throw new SampleClearanceError("not_found", "That track wasn't found in your library.");
  if (song.userId !== userId) throw new SampleClearanceError("not_owner", "You can only declare samples on your own tracks.");
  const row = await store.insertDeclaration({
    songId,
    userId,
    sourceDescription: input.sourceDescription.trim(),
    useKind: input.useKind,
    clearanceStatus: input.clearanceStatus,
    recognizable: input.recognizable,
    riskAcknowledged: false,
    riskAcknowledgedAt: null,
  });
  return rowToWire(row);
}

export async function listDeclarations(store: SampleClearanceStore, songId: string): Promise<DeclarationWire[]> {
  const rows = await store.listDeclarationsForSong(songId);
  return rows.map(rowToWire);
}

/** Owner-only read model check: returns the song or throws. */
async function requireOwnedSong(store: SampleClearanceStore, userId: string, songId: string) {
  const song = await store.getSongOwner(songId);
  if (!song) throw new SampleClearanceError("not_found", "That track wasn't found in your library.");
  if (song.userId !== userId) throw new SampleClearanceError("not_owner", "You can only manage sample declarations on your own tracks.");
  return song;
}

export async function listMyDeclarations(store: SampleClearanceStore, userId: string, songId: string): Promise<DeclarationWire[]> {
  await requireOwnedSong(store, userId, songId);
  return listDeclarations(store, songId);
}

async function requireOwnedDeclaration(store: SampleClearanceStore, userId: string, id: string): Promise<DeclarationRow> {
  const row = await store.getDeclaration(id);
  if (!row) throw new SampleClearanceError("not_found", "That sample declaration wasn't found.");
  if (row.userId !== userId) throw new SampleClearanceError("not_owner", "You can only change your own sample declarations.");
  return row;
}

export async function updateDeclaration(
  store: SampleClearanceStore,
  userId: string,
  id: string,
  patch: Partial<DeclareInput>,
): Promise<DeclarationWire> {
  const existing = await requireOwnedDeclaration(store, userId, id);
  const merged: DeclareInput = {
    sourceDescription: patch.sourceDescription ?? existing.sourceDescription,
    useKind: patch.useKind ?? existing.useKind,
    clearanceStatus: patch.clearanceStatus ?? existing.clearanceStatus,
    recognizable: patch.recognizable ?? existing.recognizable,
  };
  validateDeclareInput(merged);
  /* Changing what was declared clears any earlier acknowledgement —
     the creator must see the (possibly new) flags again before ship. */
  const changed =
    merged.sourceDescription.trim() !== existing.sourceDescription ||
    merged.useKind !== existing.useKind ||
    merged.clearanceStatus !== existing.clearanceStatus ||
    merged.recognizable !== existing.recognizable;
  const updated = await store.updateDeclaration(id, {
    sourceDescription: merged.sourceDescription.trim(),
    useKind: merged.useKind,
    clearanceStatus: merged.clearanceStatus,
    recognizable: merged.recognizable,
    ...(changed ? { riskAcknowledged: false, riskAcknowledgedAt: null } : {}),
  });
  if (!updated) throw new SampleClearanceError("not_found", "That sample declaration wasn't found.");
  return rowToWire(updated);
}

export async function removeDeclaration(store: SampleClearanceStore, userId: string, id: string): Promise<void> {
  await requireOwnedDeclaration(store, userId, id);
  await store.deleteDeclaration(id);
}

/** Record the creator's explicit pre-ship acknowledgement of the flags
 *  on one declaration. Only meaningful (and only accepted) when the
 *  current flag actually needs it. */
export async function acknowledgeDeclaration(
  store: SampleClearanceStore,
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<DeclarationWire> {
  const existing = await requireOwnedDeclaration(store, userId, id);
  const updated = await store.updateDeclaration(id, {
    riskAcknowledged: true,
    riskAcknowledgedAt: now.toISOString(),
  });
  if (!updated) throw new SampleClearanceError("not_found", "That sample declaration wasn't found.");
  return rowToWire(updated);
}

/* ─── Credits summary (the N1 join surface) ──────────────────────────
   What the credits layer renders for a track: one line per declared
   sample, each labelled creator-declared, plus the worst flag level.
   Honest absence: no declarations → samplesDeclared: false, lines: []. */
export interface CreditsSummary {
  songId: string;
  samplesDeclared: boolean;
  lines: Array<{
    declarationId: string;
    text: string;
    clearanceStatus: SampleClearanceStatus;
    clearanceLabel: string;
    flagLevel: FlagLevel;
  }>;
  worstFlagLevel: FlagLevel;
}

const LEVEL_RANK: Record<FlagLevel, number> = { none: 0, caution: 1, high: 2 };

export function summarizeForCredits(songId: string, declarations: DeclarationWire[]): CreditsSummary {
  const lines = declarations.map((d) => ({
    declarationId: d.id,
    text: `Sample: ${d.sourceDescription} (${d.useKind.replace("_", "-")}) — declared by the creator as ${d.clearanceStatus.replace(/_/g, " ")}`,
    clearanceStatus: d.clearanceStatus,
    clearanceLabel: d.clearanceLabel,
    flagLevel: d.flag.level,
  }));
  const worst = declarations.reduce<FlagLevel>(
    (acc, d) => (LEVEL_RANK[d.flag.level] > LEVEL_RANK[acc] ? d.flag.level : acc),
    "none",
  );
  return { songId, samplesDeclared: declarations.length > 0, lines, worstFlagLevel: worst };
}

/* ─── Cleared-loop alternatives ──────────────────────────────────────
   Candidates come from the EXISTING Beats Marketplace catalog: every
   beat there carries a license path (basic / premium / exclusive), so
   licensing one is a real clearance route — the offer says exactly
   that, and links to the marketplace; nothing is auto-substituted.

   "Fits" is honest matching on fields that actually exist on beats
   (genre, bpm, musical_key) against the track's own genre (songs.genre)
   — there is no BPM/key on the songs table, so none is invented: the
   match basis strings name only the signals that actually fired. */

export interface AlternativeOffer {
  beatId: string;
  title: string;
  genre: string;
  bpm: number | null;
  musicalKey: string | null;
  previewUrl: string | null;
  /** Where the offer leads: the existing marketplace surface. */
  href: string;
  score: number;
  /** Plain words: what this match is based on (only real signals). */
  matchBasis: string[];
  clearanceNote: string;
}

export function rankAlternatives(trackGenre: string | null, beats: BeatCandidate[], limit = 5): AlternativeOffer[] {
  const genre = (trackGenre ?? "").trim().toLowerCase();
  const scored = beats
    .map((b) => {
      const basis: string[] = [];
      let score = 0;
      if (genre && b.genre.trim().toLowerCase() === genre) {
        score += 10;
        basis.push(`Same genre as your track (${b.genre})`);
      }
      /* Beats with no genre match still surface when the catalog is
         thin — but they are labelled as catalog picks, never as fits. */
      return { b, score, basis };
    })
    .sort((a, z) => z.score - a.score);
  return scored.slice(0, limit).map(({ b, score, basis }) => ({
    beatId: b.id,
    title: b.title,
    genre: b.genre,
    bpm: b.bpm,
    musicalKey: b.musicalKey,
    previewUrl: b.previewUrl,
    href: "/beats",
    score,
    matchBasis: basis.length > 0 ? basis : ["From the Beats Marketplace catalog"],
    clearanceNote:
      "Licensable in the Beats Marketplace — buying a license there is a real clearance path for this material. This is an offer, not a swap: nothing in your track changes unless you choose it.",
  }));
}

export async function getAlternatives(
  store: SampleClearanceStore,
  userId: string,
  songId: string,
): Promise<{ songId: string; basedOn: string; offers: AlternativeOffer[] }> {
  const song = await requireOwnedSong(store, userId, songId);
  const beats = await store.listBeats();
  const offers = rankAlternatives(song.genre, beats);
  return {
    songId,
    basedOn: song.genre
      ? `Matched on your track's genre (${song.genre}) against the Beats Marketplace catalog. Beats carry no sample-clearance risk once licensed there.`
      : "Your track has no genre on file, so these are catalog picks from the Beats Marketplace, not genre matches.",
    offers,
  };
}

/* ─── Pre-ship check ─────────────────────────────────────────────────
   The distribution submit hook calls this: any flagged declaration on
   the release's tracks that the creator hasn't acknowledged stops the
   ship with the flags in plain words (409 upstream). Acknowledged or
   unflagged declarations never stop a ship. */
export interface PreShipResult {
  ok: boolean;
  blocking: DeclarationWire[];
  warnings: DeclarationWire[];
}

export async function preShipCheck(store: SampleClearanceStore, songIds: string[]): Promise<PreShipResult> {
  const blocking: DeclarationWire[] = [];
  const warnings: DeclarationWire[] = [];
  for (const songId of songIds) {
    for (const d of await listDeclarations(store, songId)) {
      if (d.needsAcknowledgement) blocking.push(d);
      else if (d.flag.level !== "none") warnings.push(d);
    }
  }
  return { ok: blocking.length === 0, blocking, warnings };
}

export async function preShipCheckForRelease(
  store: SampleClearanceStore,
  userId: string,
  releaseId: string,
): Promise<PreShipResult & { releaseFound: boolean }> {
  const songIds = await store.getReleaseSongIds(releaseId, userId);
  if (songIds === null) return { ok: true, blocking: [], warnings: [], releaseFound: false };
  const result = await preShipCheck(store, songIds);
  return { ...result, releaseFound: true };
}
