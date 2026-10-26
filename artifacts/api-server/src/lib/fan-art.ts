/* ─── Fan Art Wall (Stack-200, owner idea batch 4 #157) ──────────────
   Fan-submitted art, creator-approved, displayed in the creator's
   profile GALLERY block. Not Showcase (the creator's own work): every
   piece here is made by a FAN for the profile's creator.

   THE GATE: pieces are born 'pending'. The public wall function below
   only ever returns 'approved' rows — approval is PER PIECE and only
   the profile's creator can give it. Revoking flips an approved piece
   to 'revoked' and it leaves the public wall on the next read (same
   filter, no cache). Approving a revoked piece again is the undo.

   ARTIST CREDIT IS NEVER STRIPPED: every DTO in every state (public
   wall, creator queue, artist's own list) carries artistName +
   artistUserId; the name resolves live from the artist's profile when
   they have one and falls back to the submit-time snapshot, so a
   rename or a deleted profile never erases who made the piece. The
   artist's slug/avatar only ride along while their profile is public.

   NO PRICES: submitting, approving, and displaying fan art is free. */

import { db, fanArtPiecesTable, creatorProfilesTable, FAN_ART_STATUSES, type FanArtStatus } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

export { FAN_ART_STATUSES };
export type { FanArtStatus };

export type FanArtAction = "approve" | "reject" | "revoke";
export const FAN_ART_ACTIONS: readonly FanArtAction[] = ["approve", "reject", "revoke"];

/** Flooding restraint (smart law): an artist may hold at most this
 *  many still-pending pieces on one creator's wall at a time. The
 *  creator clearing the queue (approve/reject) frees room. */
export const MAX_PENDING_PER_ARTIST_PER_CREATOR = 10;

export const FAN_ART_TITLE_MAX = 120;
export const FAN_ART_NOTE_MAX = 500;
export const FAN_ART_IMAGE_URL_MAX = 2048;

export class FanArtError extends Error {
  code: "not_found" | "validation" | "own_profile" | "forbidden" | "invalid_transition" | "queue_full";
  constructor(code: FanArtError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ─── Shapes ─────────────────────────────────────────────────────────── */

export interface FanArtProfileRef {
  id: string;
  userId: string;
  slug: string;
  displayName: string;
  isPublic: boolean;
}

export interface FanArtPieceRecord {
  id: string;
  creatorProfileId: string;
  artistUserId: string;
  /** Submit-time credit snapshot. Never stripped, never rewritten. */
  artistName: string;
  title: string;
  imageUrl: string;
  note: string;
  status: FanArtStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FanArtPieceWire extends FanArtPieceRecord {
  creatorSlug: string;
  creatorName: string;
  /** Live artist profile link data — present only while the artist
   *  has a PUBLIC profile. The credit NAME always rides regardless. */
  artistSlug: string | null;
  artistAvatarUrl: string | null;
}

/* ─── Storage seam (drizzle in production, in-memory in tests) ─────── */

export interface FanArtStore {
  getProfileBySlug(slug: string): Promise<FanArtProfileRef | null>;
  getProfileByUserId(userId: string): Promise<FanArtProfileRef | null>;
  getProfileById(id: string): Promise<FanArtProfileRef | null>;
  /** The artist's own profile (for live credit resolution), any state. */
  getArtistProfile(userId: string): Promise<(FanArtProfileRef & { avatarUrl: string | null }) | null>;
  insertPiece(input: Omit<FanArtPieceRecord, "id" | "reviewedByUserId" | "reviewedAt" | "createdAt" | "updatedAt">): Promise<FanArtPieceRecord>;
  listPiecesForProfile(creatorProfileId: string): Promise<FanArtPieceRecord[]>;
  listPiecesByArtist(artistUserId: string): Promise<FanArtPieceRecord[]>;
  getPiece(id: string): Promise<FanArtPieceRecord | null>;
  updatePiece(id: string, patch: Partial<Pick<FanArtPieceRecord, "status" | "reviewedByUserId" | "reviewedAt">>): Promise<FanArtPieceRecord | null>;
}

/* ─── Validation ─────────────────────────────────────────────────────── */

export interface FanArtSubmissionInput {
  title: string;
  imageUrl: string;
  note?: string;
}

export function validateSubmission(input: FanArtSubmissionInput): { title: string; imageUrl: string; note: string } {
  const title = (input.title ?? "").trim();
  if (!title) throw new FanArtError("validation", "Give your piece a title — the wall shows it under the art.");
  if (title.length > FAN_ART_TITLE_MAX) {
    throw new FanArtError("validation", `Titles run up to ${FAN_ART_TITLE_MAX} characters.`);
  }
  const imageUrl = (input.imageUrl ?? "").trim();
  if (!imageUrl) throw new FanArtError("validation", "Add a link to your artwork — the piece itself has to be somewhere we can show.");
  if (imageUrl.length > FAN_ART_IMAGE_URL_MAX) {
    throw new FanArtError("validation", "That artwork link is too long to store.");
  }
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new FanArtError("validation", "That artwork link doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new FanArtError("validation", "Artwork links must be http(s) URLs.");
  }
  const note = (input.note ?? "").trim();
  if (note.length > FAN_ART_NOTE_MAX) {
    throw new FanArtError("validation", `Notes run up to ${FAN_ART_NOTE_MAX} characters.`);
  }
  return { title, imageUrl, note };
}

/* ─── Credit resolution ────────────────────────────────────────────────
   The displayed credit name: the artist's live profile name when they
   have one, else the submit-time snapshot. The snapshot itself is
   never mutated — it is the floor the credit can never fall below. */
async function toWire(store: FanArtStore, piece: FanArtPieceRecord, creator: FanArtProfileRef): Promise<FanArtPieceWire> {
  const artistProfile = await store.getArtistProfile(piece.artistUserId).catch(() => null);
  return {
    ...piece,
    artistName: artistProfile?.displayName?.trim() ? artistProfile.displayName : piece.artistName,
    creatorSlug: creator.slug,
    creatorName: creator.displayName,
    artistSlug: artistProfile && artistProfile.isPublic ? artistProfile.slug : null,
    artistAvatarUrl: artistProfile && artistProfile.isPublic ? artistProfile.avatarUrl : null,
  };
}

async function toWires(store: FanArtStore, pieces: FanArtPieceRecord[], creator: FanArtProfileRef): Promise<FanArtPieceWire[]> {
  return Promise.all(pieces.map((p) => toWire(store, p, creator)));
}

/* ─── Service ────────────────────────────────────────────────────────── */

/** A fan submits a piece for a creator. Born pending — it does NOT
 *  display until the creator approves this exact piece. */
export async function submitFanArt(
  store: FanArtStore,
  args: { slug: string; artistUserId: string; artistNameFallback?: string; input: FanArtSubmissionInput },
): Promise<FanArtPieceWire> {
  const creator = await store.getProfileBySlug(args.slug.toLowerCase());
  if (!creator || !creator.isPublic) {
    throw new FanArtError("not_found", "That creator's page isn't public — there's no wall to submit to.");
  }
  if (creator.userId === args.artistUserId) {
    throw new FanArtError(
      "own_profile",
      "This wall is for your fans' art — your own work belongs in your tracks, videos, and showcase.",
    );
  }
  const clean = validateSubmission(args.input);
  const existing = await store.listPiecesForProfile(creator.id);
  const pendingMine = existing.filter((p) => p.artistUserId === args.artistUserId && p.status === "pending").length;
  if (pendingMine >= MAX_PENDING_PER_ARTIST_PER_CREATOR) {
    throw new FanArtError(
      "queue_full",
      `You already have ${MAX_PENDING_PER_ARTIST_PER_CREATOR} pieces waiting on this creator's review — they need to clear some before you send more.`,
    );
  }
  const artistProfile = await store.getArtistProfile(args.artistUserId).catch(() => null);
  const snapshot =
    artistProfile?.displayName?.trim() ||
    (args.artistNameFallback ?? "").trim().slice(0, 80) ||
    "A fan";
  const piece = await store.insertPiece({
    creatorProfileId: creator.id,
    artistUserId: args.artistUserId,
    artistName: snapshot,
    title: clean.title,
    imageUrl: clean.imageUrl,
    note: clean.note,
    status: "pending",
  });
  return toWire(store, piece, creator);
}

/** THE PUBLIC WALL: approved pieces only, newest approval-ward first
 *  (created order). Pending / rejected / revoked pieces have no path
 *  into this list — this filter IS the display gate. */
export async function getPublicWall(
  store: FanArtStore,
  slug: string,
): Promise<{ creator: FanArtProfileRef; pieces: FanArtPieceWire[] }> {
  const creator = await store.getProfileBySlug(slug.toLowerCase());
  if (!creator || !creator.isPublic) {
    throw new FanArtError("not_found", "That creator's page isn't public.");
  }
  const all = await store.listPiecesForProfile(creator.id);
  const approved = all.filter((p) => p.status === "approved");
  return { creator, pieces: await toWires(store, approved, creator) };
}

/** The creator's review queue: every piece for their wall, pending
 *  first (oldest waiting first within the queue), then the rest by
 *  newest. Only the profile owner may read it — resolved from the
 *  session user id, never a slug claim. */
export async function listCreatorQueue(
  store: FanArtStore,
  ownerUserId: string,
): Promise<{ creator: FanArtProfileRef; pieces: FanArtPieceWire[] }> {
  const creator = await store.getProfileByUserId(ownerUserId);
  if (!creator) {
    throw new FanArtError("not_found", "Create your creator profile first — your Gallery wall lives on it.");
  }
  const all = await store.listPiecesForProfile(creator.id);
  const rank = (p: FanArtPieceRecord) => (p.status === "pending" ? 0 : p.status === "approved" ? 1 : 2);
  const sorted = [...all].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    /* Pending waits longest-first (fair review order); decided pieces
       newest-first. */
    return a.status === "pending"
      ? a.createdAt.localeCompare(b.createdAt)
      : b.createdAt.localeCompare(a.createdAt);
  });
  return { creator, pieces: await toWires(store, sorted, creator) };
}

/** The artist's own submissions across every wall, with each piece's
 *  live status — a fan can always see where their art stands. Credit
 *  rides on every row here too. */
export async function listMySubmissions(
  store: FanArtStore,
  artistUserId: string,
): Promise<FanArtPieceWire[]> {
  const mine = await store.listPiecesByArtist(artistUserId);
  const out: FanArtPieceWire[] = [];
  for (const piece of mine) {
    const creator = await store.getProfileById(piece.creatorProfileId);
    if (!creator) continue;
    out.push(await toWire(store, piece, creator));
  }
  return out;
}

const TRANSITIONS: Record<FanArtAction, { from: readonly FanArtStatus[]; to: FanArtStatus; verb: string }> = {
  approve: { from: ["pending", "revoked"], to: "approved", verb: "approve" },
  reject: { from: ["pending"], to: "rejected", verb: "reject" },
  revoke: { from: ["approved"], to: "revoked", verb: "revoke" },
};

/** The creator's per-piece decision. Only the owner of the profile the
 *  piece was submitted to may act, and only along the legal edges:
 *  pending → approved / rejected; approved → revoked; revoked →
 *  approved (undo). Everything else is an invalid transition. */
export async function reviewPiece(
  store: FanArtStore,
  args: { ownerUserId: string; pieceId: string; action: FanArtAction },
): Promise<FanArtPieceWire> {
  const piece = await store.getPiece(args.pieceId);
  if (!piece) throw new FanArtError("not_found", "That piece isn't on any wall.");
  const creator = await store.getProfileById(piece.creatorProfileId);
  if (!creator) throw new FanArtError("not_found", "That piece's wall is gone.");
  if (creator.userId !== args.ownerUserId) {
    throw new FanArtError("forbidden", "Only the creator this art was made for can decide on it.");
  }
  const edge = TRANSITIONS[args.action];
  if (!edge.from.includes(piece.status)) {
    throw new FanArtError(
      "invalid_transition",
      piece.status === "approved"
        ? "That piece is already on the wall — revoke it to take it down."
        : piece.status === "rejected"
          ? "That piece was rejected — it can't re-enter from here; the artist can submit a new piece."
          : `You can't ${edge.verb} a piece that's ${piece.status}.`,
    );
  }
  const updated = await store.updatePiece(piece.id, {
    status: edge.to,
    reviewedByUserId: args.ownerUserId,
    reviewedAt: new Date().toISOString(),
  });
  if (!updated) throw new FanArtError("not_found", "That piece isn't on any wall.");
  return toWire(store, updated, creator);
}

/* ─── Drizzle store ──────────────────────────────────────────────────── */

type ProfileRow = typeof creatorProfilesTable.$inferSelect;
const profileRef = (r: ProfileRow): FanArtProfileRef => ({
  id: r.id, userId: r.userId, slug: r.slug, displayName: r.displayName, isPublic: r.isPublic,
});
type PieceRow = typeof fanArtPiecesTable.$inferSelect;
const pieceRecord = (r: PieceRow): FanArtPieceRecord => ({
  id: r.id,
  creatorProfileId: r.creatorProfileId,
  artistUserId: r.artistUserId,
  artistName: r.artistName,
  title: r.title,
  imageUrl: r.imageUrl,
  note: r.note,
  status: r.status,
  reviewedByUserId: r.reviewedByUserId ?? null,
  reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const drizzleFanArtStore: FanArtStore = {
  async getProfileBySlug(slug) {
    const [row] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, slug)).limit(1);
    return row ? profileRef(row) : null;
  },
  async getProfileByUserId(userId) {
    const [row] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId)).limit(1);
    return row ? profileRef(row) : null;
  },
  async getProfileById(id) {
    const [row] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, id)).limit(1);
    return row ? profileRef(row) : null;
  },
  async getArtistProfile(userId) {
    const [row] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId)).limit(1);
    return row ? { ...profileRef(row), avatarUrl: row.avatarUrl ?? null } : null;
  },
  async insertPiece(input) {
    const [row] = await db.insert(fanArtPiecesTable).values({
      creatorProfileId: input.creatorProfileId,
      artistUserId: input.artistUserId,
      artistName: input.artistName,
      title: input.title,
      imageUrl: input.imageUrl,
      note: input.note,
      status: input.status,
    }).returning();
    return pieceRecord(row!);
  },
  async listPiecesForProfile(creatorProfileId) {
    const rows = await db.select().from(fanArtPiecesTable)
      .where(eq(fanArtPiecesTable.creatorProfileId, creatorProfileId))
      .orderBy(desc(fanArtPiecesTable.createdAt));
    return rows.map(pieceRecord);
  },
  async listPiecesByArtist(artistUserId) {
    const rows = await db.select().from(fanArtPiecesTable)
      .where(eq(fanArtPiecesTable.artistUserId, artistUserId))
      .orderBy(desc(fanArtPiecesTable.createdAt));
    return rows.map(pieceRecord);
  },
  async getPiece(id) {
    const [row] = await db.select().from(fanArtPiecesTable)
      .where(eq(fanArtPiecesTable.id, id)).limit(1);
    return row ? pieceRecord(row) : null;
  },
  async updatePiece(id, patch) {
    const [row] = await db.update(fanArtPiecesTable)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.reviewedByUserId !== undefined ? { reviewedByUserId: patch.reviewedByUserId } : {}),
        ...(patch.reviewedAt !== undefined ? { reviewedAt: patch.reviewedAt ? new Date(patch.reviewedAt) : null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(fanArtPiecesTable.id, id)))
      .returning();
    return row ? pieceRecord(row) : null;
  },
};

/* ─── In-memory store (tests) ────────────────────────────────────────── */

export function createMemoryFanArtStore(seed: {
  profiles: Array<FanArtProfileRef & { avatarUrl?: string | null }>;
}): FanArtStore {
  const profiles = new Map(seed.profiles.map((p) => [p.id, p]));
  const pieces = new Map<string, FanArtPieceRecord>();
  let seq = 0;
  const bySlug = (slug: string) => [...profiles.values()].find((p) => p.slug === slug) ?? null;
  const byUser = (userId: string) => [...profiles.values()].find((p) => p.userId === userId) ?? null;
  return {
    async getProfileBySlug(slug) { return bySlug(slug); },
    async getProfileByUserId(userId) { return byUser(userId); },
    async getProfileById(id) { return profiles.get(id) ?? null; },
    async getArtistProfile(userId) {
      const p = byUser(userId);
      return p ? { ...p, avatarUrl: p.avatarUrl ?? null } : null;
    },
    async insertPiece(input) {
      seq += 1;
      const now = new Date(Date.now() + seq).toISOString();
      const rec: FanArtPieceRecord = {
        ...input, id: `piece-${seq}`, reviewedByUserId: null, reviewedAt: null,
        createdAt: now, updatedAt: now,
      };
      pieces.set(rec.id, rec);
      return rec;
    },
    async listPiecesForProfile(creatorProfileId) {
      return [...pieces.values()]
        .filter((p) => p.creatorProfileId === creatorProfileId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async listPiecesByArtist(artistUserId) {
      return [...pieces.values()]
        .filter((p) => p.artistUserId === artistUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getPiece(id) { return pieces.get(id) ?? null; },
    async updatePiece(id, patch) {
      const cur = pieces.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      pieces.set(id, next);
      return next;
    },
  };
}
