/**
 * Fan Art Wall — public profile Gallery block (Stack-200 #157),
 * frontend coverage (stack800 lane 10).
 *
 * The wall shipped with server tests only; this suite is the FE
 * half. vitest here runs in node with jsx:preserve, so per the
 * repo's established split (social-proof-strip.test.ts) the suite
 * tests the pure view logic the component renders from
 * (lib/profile-website) and pins the component's wiring by source.
 *
 * The law:
 *  - the server sends APPROVED pieces only — what renders IS the
 *    wall; pending art has no path onto it;
 *  - a failed load is an honest error + retry, never a fake-empty
 *    wall; an empty wall HIDES from visitors and invites the OWNER;
 *  - artist credit is never optional: a piece without a name (or
 *    id/title/image, or with an unknown status) is dropped by the
 *    DTO guard rather than rendered broken or credit-less;
 *  - the submit door belongs to signed-in fans who aren't the
 *    owner, and says plainly the piece is born pending.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fanArtStatusLabel,
  fanArtWallViewState,
  normalizeFanArtPiece,
  normalizeFanArtWall,
} from "@/lib/profile-website";

const RAW_PIECE = {
  id: "piece-1",
  creatorProfileId: "profile-1",
  artistUserId: "user-9",
  artistName: "Nova Fan",
  title: "Crown Study",
  imageUrl: "https://example.com/art.png",
  note: "Ink on paper",
  status: "approved",
  reviewedByUserId: "user-1",
  reviewedAt: "2026-10-20T12:00:00.000Z",
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  creatorSlug: "thy-cheat-code",
  creatorName: "Thy Cheat Code",
  artistSlug: "nova-fan",
  artistAvatarUrl: "https://example.com/avatar.png",
};

describe("fanArtWallViewState — render / empty / populated is a decision, not an accident", () => {
  it("loading wins over everything", () => {
    expect(fanArtWallViewState({ status: "loading", count: 0, isOwner: true })).toBe("loading");
    expect(fanArtWallViewState({ status: "loading", count: 5, isOwner: false })).toBe("loading");
  });

  it("a failed load is the error view for owner and visitor alike — never a fake-empty wall", () => {
    expect(fanArtWallViewState({ status: "error", count: 0, isOwner: true })).toBe("error");
    expect(fanArtWallViewState({ status: "error", count: 0, isOwner: false })).toBe("error");
  });

  it("a populated wall renders for everyone", () => {
    expect(fanArtWallViewState({ status: "ready", count: 1, isOwner: false })).toBe("wall");
    expect(fanArtWallViewState({ status: "ready", count: 12, isOwner: true })).toBe("wall");
  });

  it("an empty wall invites the owner and hides from visitors", () => {
    expect(fanArtWallViewState({ status: "ready", count: 0, isOwner: true })).toBe("owner-empty");
    expect(fanArtWallViewState({ status: "ready", count: 0, isOwner: false })).toBe("hidden");
  });
});

describe("normalizeFanArtPiece — the credit guard", () => {
  it("normalizes a complete piece, credit and profile link intact", () => {
    const piece = normalizeFanArtPiece(RAW_PIECE);
    expect(piece).not.toBeNull();
    expect(piece!.artistName).toBe("Nova Fan");
    expect(piece!.artistSlug).toBe("nova-fan");
    expect(piece!.status).toBe("approved");
    expect(piece!.creatorSlug).toBe("thy-cheat-code");
  });

  it("keeps the credit NAME when the artist's profile is not public (link fields fall to null)", () => {
    const piece = normalizeFanArtPiece({ ...RAW_PIECE, artistSlug: "", artistAvatarUrl: undefined });
    expect(piece).not.toBeNull();
    expect(piece!.artistName).toBe("Nova Fan");
    expect(piece!.artistSlug).toBeNull();
    expect(piece!.artistAvatarUrl).toBeNull();
  });

  it("drops a piece that cannot render honestly — no id, title, image, credit, or known status", () => {
    expect(normalizeFanArtPiece({ ...RAW_PIECE, id: "" })).toBeNull();
    expect(normalizeFanArtPiece({ ...RAW_PIECE, title: "" })).toBeNull();
    expect(normalizeFanArtPiece({ ...RAW_PIECE, imageUrl: "" })).toBeNull();
    expect(normalizeFanArtPiece({ ...RAW_PIECE, artistName: "" })).toBeNull();
    expect(normalizeFanArtPiece({ ...RAW_PIECE, status: "maybe" })).toBeNull();
    expect(normalizeFanArtPiece(null)).toBeNull();
    expect(normalizeFanArtPiece("piece-1")).toBeNull();
  });

  it("accepts every real status and defaults the optional strings", () => {
    for (const status of ["pending", "approved", "rejected", "revoked"]) {
      const piece = normalizeFanArtPiece({ ...RAW_PIECE, status, note: undefined });
      expect(piece!.status).toBe(status);
      expect(piece!.note).toBe("");
    }
  });
});

describe("normalizeFanArtWall", () => {
  it("keeps the honest pieces and drops the malformed ones", () => {
    const wall = normalizeFanArtWall({
      profile: { slug: "thy-cheat-code", displayName: "Thy Cheat Code" },
      pieces: [RAW_PIECE, { ...RAW_PIECE, id: "piece-2", artistName: "" }, null],
    });
    expect(wall).not.toBeNull();
    expect(wall!.pieces.map((p) => p.id)).toEqual(["piece-1"]);
    expect(wall!.profile.slug).toBe("thy-cheat-code");
  });

  it("a payload with no pieces array is malformed → null (the fetcher throws → the error view)", () => {
    expect(normalizeFanArtWall({ profile: {} })).toBeNull();
    expect(normalizeFanArtWall({ pieces: "all of them" })).toBeNull();
    expect(normalizeFanArtWall(null)).toBeNull();
  });

  it("an empty pieces array is a real empty wall, not an error", () => {
    const wall = normalizeFanArtWall({ pieces: [] });
    expect(wall).not.toBeNull();
    expect(wall!.pieces).toEqual([]);
  });
});

describe("fanArtStatusLabel — the fan's one honest line about their piece", () => {
  it("says exactly where each status stands", () => {
    expect(fanArtStatusLabel("pending")).toBe("Waiting for the creator's approval");
    expect(fanArtStatusLabel("approved")).toBe("On the wall");
    expect(fanArtStatusLabel("rejected")).toBe("Not accepted for this wall");
    expect(fanArtStatusLabel("revoked")).toBe("Taken down by the creator");
  });
});

describe("FanArtWallSection — component wiring (source pins)", () => {
  const src = readFileSync(join(__dirname, "FanArtWallSection.tsx"), "utf8");

  it("renders nothing while loading, and a visitor-empty wall hides outright", () => {
    expect(src).toContain('if (view === "loading") return null;');
    expect(src).toContain('if (view === "hidden" && !user) return null;');
    expect(src).toContain("fanArtWallViewState({ status, count: pieces.length, isOwner })");
  });

  it("the populated state is the grid of pieces, each with its artist credit and a report door", () => {
    expect(src).toContain('data-testid="profile-fan-art-wall"');
    expect(src).toContain('data-testid="fan-art-piece"');
    expect(src).toContain("{pieces.map((p) => (");
    expect(src).toContain("piece.artistName");
    expect(src).toContain("href={`/artist/${piece.artistSlug}`}");
    expect(src).toContain('<ReportButton targetType="fan_art" targetId={piece.id} variant="icon" />');
  });

  it("the error state is honest copy plus a retry that actually re-fetches", () => {
    expect(src).toContain("The fan art wall couldn't load right now.");
    expect(src).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(src).toContain("}, [slug, retryNonce]);");
  });

  it("the owner-empty state invites the owner to the review queue", () => {
    expect(src).toContain("Your fan art wall is waiting for its first piece");
    expect(src).toContain('href="/artist-setup"');
    expect(src).toContain("Review fan art");
  });

  it("the submit door is signed-in fans only, never the owner, and never over an error", () => {
    expect(src).toContain('{user && !isOwner && view !== "error" && (');
    expect(src).toContain('data-testid="fan-art-submit-open"');
    expect(src).toContain("submitFanArtPiece(slug, {");
    /* born pending, said plainly before the fan sends */
    expect(src).toContain("it appears on this wall only if");
  });

  it("a signed-in fan sees their own pieces on this wall with live status; signed-out visitors get the sign-in door", () => {
    expect(src).toContain('data-testid="fan-art-mine"');
    expect(src).toContain("all.filter((p) => p.creatorSlug === slug)");
    expect(src).toContain("fanArtStatusLabel(p.status)");
    expect(src).toContain('href="/login"');
  });
});

describe("the wall's server contract (lib/profile-website fetchers)", () => {
  const lib = readFileSync(join(__dirname, "..", "..", "lib", "profile-website.ts"), "utf8");

  it("reads the public wall, submits, and reads the fan's own submissions from the fan-art doors", () => {
    expect(lib).toContain("fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/fan-art`)");
    expect(lib).toContain('fetch("/api/fan-art/mine")');
    expect(lib).toContain('method: "POST"');
  });

  it("a malformed wall payload throws instead of rendering — the error view depends on it", () => {
    expect(lib).toContain('throw new Error("That fan art wall came back incomplete — try again.")');
  });
});
