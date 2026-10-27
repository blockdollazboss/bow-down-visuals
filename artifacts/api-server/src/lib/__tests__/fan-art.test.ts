/**
 * Fan Art Wall (#157) — lib/fan-art.ts service tests (JOIN2 owed
 * verification: the feature shipped with zero tests of its own).
 *
 * The wall's honesty rules, pinned against an in-memory FanArtStore:
 *  - a piece is born pending and has NO path onto the public wall
 *    until the creator approves that exact piece;
 *  - only the profile owner can review, and only along the legal
 *    edges (pending→approved/rejected, approved→revoked,
 *    revoked→approved);
 *  - submission validation (title/URL/note bounds, http(s) only);
 *  - own-profile submissions refused; the per-artist pending cap;
 *  - credit resolution: the artist's live public profile name wins,
 *    the submit-time snapshot is the floor, and a private artist
 *    profile leaks neither slug nor avatar.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  FanArtError,
  MAX_PENDING_PER_ARTIST_PER_CREATOR,
  getPublicWall,
  listCreatorQueue,
  listMySubmissions,
  reviewPiece,
  submitFanArt,
  validateSubmission,
  type FanArtPieceRecord,
  type FanArtProfileRef,
  type FanArtStore,
} from "../fan-art";

const CREATOR: FanArtProfileRef = { id: "prof-creator", userId: "user-creator", slug: "creator-cee", displayName: "Creator Cee", isPublic: true };
const PRIVATE_CREATOR: FanArtProfileRef = { id: "prof-shy", userId: "user-shy", slug: "shy-one", displayName: "Shy One", isPublic: false };
const ARTIST = "user-artist";
const ARTIST_PROFILE = { id: "prof-artist", userId: ARTIST, slug: "art-by-ari", displayName: "Ari Draws", isPublic: true, avatarUrl: "https://cdn.example/ari.png" };

let seq = 0;
function makeStore() {
  const profiles: FanArtProfileRef[] = [CREATOR, PRIVATE_CREATOR];
  const artistProfiles = new Map<string, (FanArtProfileRef & { avatarUrl: string | null }) | null>([[ARTIST, ARTIST_PROFILE]]);
  const pieces: FanArtPieceRecord[] = [];
  const store: FanArtStore = {
    getProfileBySlug: async (slug) => profiles.find((p) => p.slug === slug) ?? null,
    getProfileByUserId: async (userId) => profiles.find((p) => p.userId === userId) ?? null,
    getProfileById: async (id) => profiles.find((p) => p.id === id) ?? null,
    getArtistProfile: async (userId) => artistProfiles.get(userId) ?? null,
    insertPiece: async (input) => {
      const now = new Date(Date.UTC(2026, 9, 26, 12, 0, seq)).toISOString();
      const piece: FanArtPieceRecord = {
        ...input,
        id: `piece-${++seq}`,
        reviewedByUserId: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      pieces.push(piece);
      return piece;
    },
    listPiecesForProfile: async (creatorProfileId) => pieces.filter((p) => p.creatorProfileId === creatorProfileId),
    listPiecesByArtist: async (artistUserId) => pieces.filter((p) => p.artistUserId === artistUserId),
    getPiece: async (id) => pieces.find((p) => p.id === id) ?? null,
    updatePiece: async (id, patch) => {
      const p = pieces.find((x) => x.id === id);
      if (!p) return null;
      Object.assign(p, patch);
      return p;
    },
  };
  return { store, pieces, artistProfiles };
}

const GOOD = { title: "Golden Hour Shark", imageUrl: "https://cdn.example/art.png", note: "for the king" };
const submit = (store: FanArtStore, over: Partial<Parameters<typeof submitFanArt>[1]> = {}) =>
  submitFanArt(store, { slug: "creator-cee", artistUserId: ARTIST, input: GOOD, ...over });

describe("validateSubmission", () => {
  it("trims and accepts a clean submission", () => {
    expect(validateSubmission({ title: "  Tide  ", imageUrl: " https://x.example/a.png ", note: " hi " })).toEqual({
      title: "Tide",
      imageUrl: "https://x.example/a.png",
      note: "hi",
    });
  });
  it("rejects empty title, non-URL, non-http(s) URL, and over-long fields", () => {
    expect(() => validateSubmission({ title: " ", imageUrl: "https://x.example/a.png" })).toThrowError(FanArtError);
    expect(() => validateSubmission({ title: "T", imageUrl: "not a url" })).toThrowError(/valid URL/);
    expect(() => validateSubmission({ title: "T", imageUrl: "data:image/png;base64,xx" })).toThrowError(/http\(s\)/);
    expect(() => validateSubmission({ title: "x".repeat(121), imageUrl: "https://x.example/a.png" })).toThrowError(/120 characters/);
    expect(() => validateSubmission({ title: "T", imageUrl: "https://x.example/a.png", note: "n".repeat(501) })).toThrowError(/500 characters/);
  });
});

describe("submitFanArt", () => {
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
  });

  it("a piece is born pending, credited from the artist's live profile name", async () => {
    const wire = await submit(ctx.store);
    expect(wire.status).toBe("pending");
    expect(wire.artistName).toBe("Ari Draws");
    expect(wire.creatorSlug).toBe("creator-cee");
    expect(wire.artistSlug).toBe("art-by-ari");
  });

  it("credit falls back to the submit-time snapshot, then to 'A fan'", async () => {
    ctx.artistProfiles.set(ARTIST, null);
    const named = await submit(ctx.store, { artistNameFallback: "  Wandering Fan  " });
    expect(named.artistName).toBe("Wandering Fan");
    const anon = await submit(ctx.store, { artistUserId: "user-nobody" });
    expect(anon.artistName).toBe("A fan");
  });

  it("refuses own-profile submissions and non-public walls", async () => {
    await expect(submit(ctx.store, { artistUserId: CREATOR.userId })).rejects.toMatchObject({ code: "own_profile" });
    await expect(submit(ctx.store, { slug: "shy-one" })).rejects.toMatchObject({ code: "not_found" });
    await expect(submit(ctx.store, { slug: "missing" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("the pending cap stops queue flooding at the limit", async () => {
    for (let i = 0; i < MAX_PENDING_PER_ARTIST_PER_CREATOR; i++) {
      await submit(ctx.store, { input: { ...GOOD, title: `Piece ${i}` } });
    }
    await expect(submit(ctx.store)).rejects.toMatchObject({ code: "queue_full" });
    /* approving one frees a slot — the cap counts pending only */
    const queue = await listCreatorQueue(ctx.store, CREATOR.userId);
    await reviewPiece(ctx.store, { ownerUserId: CREATOR.userId, pieceId: queue.pieces[0].id, action: "approve" });
    await expect(submit(ctx.store)).resolves.toMatchObject({ status: "pending" });
  });
});

describe("the public wall gate", () => {
  it("only approved pieces display — pending, rejected and revoked never appear", async () => {
    const { store } = makeStore();
    const a = await submit(store, { input: { ...GOOD, title: "A" } });
    const b = await submit(store, { input: { ...GOOD, title: "B" } });
    const c = await submit(store, { input: { ...GOOD, title: "C" } });
    await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: a.id, action: "approve" });
    await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: b.id, action: "reject" });
    let wall = await getPublicWall(store, "creator-cee");
    expect(wall.pieces.map((p) => p.title)).toEqual(["A"]);
    await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: a.id, action: "revoke" });
    wall = await getPublicWall(store, "creator-cee");
    expect(wall.pieces).toEqual([]);
    expect(c.status).toBe("pending");
  });

  it("a private profile has no public wall", async () => {
    const { store } = makeStore();
    await expect(getPublicWall(store, "shy-one")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("reviewPiece transitions", () => {
  it("only the owner may decide; strangers are forbidden", async () => {
    const { store } = makeStore();
    const piece = await submit(store);
    await expect(
      reviewPiece(store, { ownerUserId: "user-intruder", pieceId: piece.id, action: "approve" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: "piece-missing", action: "approve" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("legal edges walk the full lifecycle; illegal edges refuse", async () => {
    const { store } = makeStore();
    const piece = await submit(store);
    /* pending → revoke is not an edge */
    await expect(reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: piece.id, action: "revoke" })).rejects.toMatchObject({ code: "invalid_transition" });
    const approved = await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: piece.id, action: "approve" });
    expect(approved.status).toBe("approved");
    expect(approved.reviewedByUserId).toBe(CREATOR.userId);
    expect(approved.reviewedAt).toBeTruthy();
    /* approved → reject is not an edge */
    await expect(reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: piece.id, action: "reject" })).rejects.toMatchObject({ code: "invalid_transition" });
    const revoked = await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: piece.id, action: "revoke" });
    expect(revoked.status).toBe("revoked");
    /* revoked → approved is the undo edge */
    const restored = await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: piece.id, action: "approve" });
    expect(restored.status).toBe("approved");
    /* rejected is terminal from the desk */
    const other = await submit(store, { input: { ...GOOD, title: "Second" } });
    await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: other.id, action: "reject" });
    await expect(reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: other.id, action: "approve" })).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

describe("queue + my submissions", () => {
  it("the queue reads pending first, oldest waiting first", async () => {
    const { store } = makeStore();
    const first = await submit(store, { input: { ...GOOD, title: "First" } });
    const second = await submit(store, { input: { ...GOOD, title: "Second" } });
    await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: second.id, action: "approve" });
    const third = await submit(store, { input: { ...GOOD, title: "Third" } });
    const queue = await listCreatorQueue(store, CREATOR.userId);
    expect(queue.pieces.map((p) => p.id)).toEqual([first.id, third.id, second.id]);
  });

  it("my submissions carry live status + creator credit across walls", async () => {
    const { store } = makeStore();
    const piece = await submit(store);
    await reviewPiece(store, { ownerUserId: CREATOR.userId, pieceId: piece.id, action: "approve" });
    const mine = await listMySubmissions(store, ARTIST);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("approved");
    expect(mine[0].creatorName).toBe("Creator Cee");
  });

  it("a private artist profile leaks neither slug nor avatar into the wire", async () => {
    const { store, artistProfiles } = makeStore();
    artistProfiles.set(ARTIST, { ...ARTIST_PROFILE, isPublic: false });
    const wire = await submit(store);
    expect(wire.artistSlug).toBeNull();
    expect(wire.artistAvatarUrl).toBeNull();
    expect(wire.artistName).toBe("Ari Draws");
  });
});
