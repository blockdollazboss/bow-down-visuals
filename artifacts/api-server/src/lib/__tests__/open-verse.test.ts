/**
 * Open Verse (#176) — pure machine pins:
 *  - split terms built ON the existing publishing-splits rail (sum=100,
 *    creator remainder, winner share creator-entered, never invented);
 *  - terms shown up front and frozen — a pick can never change them;
 *  - only the song's creator can pick / close / cancel (no auto-pick);
 *  - exactly-once ledger: same-winner re-pick replays with the same
 *    idempotency key, a different second pick is refused;
 *  - submissions: no self-submit, no submit after close/pick, audio
 *    required, withdraw only by the submitter and only before a pick;
 *  - money law copy: Visual Bucs only, test mode, never cash.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  assertCanSubmit,
  buildPostTerms,
  buildSplitTerms,
  cancelPost,
  closePost,
  derivePostState,
  isPostOpenForSubmissions,
  ledgerDraftFor,
  openVerseLedgerKey,
  pickWinner,
  validateSplitTerms,
  viewerActions,
  winnerShareFromTerms,
  withdrawSubmission,
  OpenVerseError,
  OPEN_VERSE_COPY,
  OPEN_VERSE_CURRENCY,
  type OpenVersePost,
  type OpenVerseSubmission,
} from "../open-verse";

const OWNER = "user-owner";
const VERSE_A = "user-verse-a";
const VERSE_B = "user-verse-b";
const T0 = new Date("2026-10-26T00:00:00Z");
const POST_ID = "12345678-1234-1234-1234-1234567890ab";

function post(over: Partial<OpenVersePost> = {}): OpenVersePost {
  const terms = buildSplitTerms(25);
  return {
    id: POST_ID,
    ownerUserId: OWNER,
    songKind: "song",
    songId: "song-1",
    songTitle: "Midnight Tide",
    brief: "One verse, 16 bars.",
    slotLabel: "Second verse",
    splitTerms: terms,
    winnerSharePct: 25,
    status: "open",
    closesAt: null,
    winnerSubmissionId: null,
    winnerUserId: null,
    winnerPickedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function sub(id: string, user: string, over: Partial<OpenVerseSubmission> = {}): OpenVerseSubmission {
  return {
    id,
    postId: POST_ID,
    submitterUserId: user,
    submitterName: "Creator",
    audioUrl: "https://example.com/verse.mp3",
    lyrics: null,
    note: null,
    status: "submitted",
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof OpenVerseError) return err.code;
    throw err;
  }
  throw new Error("expected OpenVerseError");
}

describe("split terms — existing rail, up front", () => {
  it("builds exactly two lines summing to 100 via the splits rail", () => {
    const terms = buildSplitTerms(30);
    expect(terms).toHaveLength(2);
    expect(terms.reduce((a, t) => a + t.sharePct, 0)).toBe(100);
    expect(terms.find((t) => t.role === "winner")?.sharePct).toBe(30);
    expect(terms.find((t) => t.role === "creator")?.sharePct).toBe(70);
    // Names are slot labels, never invented people.
    expect(terms.map((t) => t.name)).toEqual(["Song creator", "Winning verse creator"]);
  });

  it("supports fractional shares the rail allows (<=2dp)", () => {
    const terms = buildSplitTerms(33.33);
    expect(winnerShareFromTerms(terms)).toBe(33.33);
    expect(() => validateSplitTerms(terms)).not.toThrow();
  });

  it("refuses 0, 100, negative, NaN and >2dp shares", () => {
    expect(code(() => buildSplitTerms(0))).toBe("split_range");
    expect(code(() => buildSplitTerms(100))).toBe("split_range");
    expect(code(() => buildSplitTerms(-5))).toBe("split_range");
    expect(code(() => buildSplitTerms(Number.NaN))).toBe("split_invalid");
    expect(() => buildSplitTerms(12.345)).toThrow(OpenVerseError);
  });

  it("re-validates a stored snapshot and refuses tampered terms", () => {
    const bad = [
      { name: "Song creator", role: "creator" as const, sharePct: 90 },
      { name: "Winning verse creator", role: "winner" as const, sharePct: 25 },
    ];
    expect(() => validateSplitTerms(bad)).toThrow(OpenVerseError);
    expect(code(() => validateSplitTerms([bad[0]]))).toBe("split_terms");
  });

  it("buildPostTerms trims, defaults the slot label and refuses a past close", () => {
    const built = buildPostTerms({ winnerSharePct: 20, brief: "  hi  " }, T0);
    expect(built.brief).toBe("hi");
    expect(built.slotLabel).toBe("Open verse");
    expect(code(() => buildPostTerms({ winnerSharePct: 20, closesAt: new Date(T0.getTime() - 1) }, T0))).toBe("closes_at_past");
    expect(code(() => buildPostTerms({ winnerSharePct: 20, brief: "x".repeat(1001) }, T0))).toBe("brief_too_long");
  });
});

describe("submissions", () => {
  it("accepts a clean submission and normalises blanks to null", () => {
    const out = assertCanSubmit(post(), VERSE_A, { audioUrl: " https://x/v.mp3 ", lyrics: " ", note: "" }, T0);
    expect(out).toEqual({ audioUrl: "https://x/v.mp3", lyrics: null, note: null });
  });

  it("refuses self-submit, missing audio, closed / picked / expired posts", () => {
    expect(code(() => assertCanSubmit(post(), OWNER, { audioUrl: "https://x" }, T0))).toBe("own_post");
    expect(code(() => assertCanSubmit(post(), VERSE_A, { audioUrl: " " }, T0))).toBe("audio_required");
    expect(code(() => assertCanSubmit(post({ status: "closed" }), VERSE_A, { audioUrl: "https://x" }, T0))).toBe("post_not_open");
    expect(code(() => assertCanSubmit(post({ status: "winner_picked" }), VERSE_A, { audioUrl: "https://x" }, T0))).toBe("winner_picked");
    const expired = post({ closesAt: new Date(T0.getTime() - 1000) });
    expect(code(() => assertCanSubmit(expired, VERSE_A, { audioUrl: "https://x" }, T0))).toBe("submissions_closed");
    expect(isPostOpenForSubmissions(expired, T0)).toBe(false);
    expect(derivePostState(expired, T0)).toBe("closed_time");
  });

  it("withdraw: only the submitter, only while live, never after a pick", () => {
    const s = sub("s1", VERSE_A);
    expect(withdrawSubmission(post(), s, VERSE_A, T0).status).toBe("withdrawn");
    expect(code(() => withdrawSubmission(post(), s, VERSE_B, T0))).toBe("not_submitter");
    expect(code(() => withdrawSubmission(post({ status: "winner_picked" }), s, VERSE_A, T0))).toBe("already_picked");
    expect(code(() => withdrawSubmission(post(), sub("s2", VERSE_A, { status: "withdrawn" }), VERSE_A, T0))).toBe("submission_not_live");
  });
});

describe("winner pick — creator-gated, exactly once", () => {
  const subs = () => [sub("s1", VERSE_A), sub("s2", VERSE_B), sub("s3", VERSE_B, { status: "withdrawn" })];

  it("picks: winner onto the track, others not_selected, withdrawn untouched", () => {
    const r = pickWinner(post(), subs(), OWNER, "s1", T0);
    expect(r.applied).toBe(true);
    expect(r.post.status).toBe("winner_picked");
    expect(r.post.winnerUserId).toBe(VERSE_A);
    expect(r.submissions.find((s) => s.id === "s1")?.status).toBe("winner");
    expect(r.submissions.find((s) => s.id === "s2")?.status).toBe("not_selected");
    expect(r.submissions.find((s) => s.id === "s3")?.status).toBe("withdrawn");
  });

  it("ledger draft carries the frozen up-front terms + exactly-once key, VB only", () => {
    const p = post();
    const r = pickWinner(p, subs(), OWNER, "s2", T0);
    expect(r.ledger.idempotencyKey).toBe(openVerseLedgerKey(POST_ID));
    expect(r.ledger.idempotencyKey).toBe(`open-verse-split:${POST_ID}`);
    expect(r.ledger.winnerSharePct).toBe(25);
    expect(r.ledger.splitTerms).toEqual(p.splitTerms);
    expect(r.ledger.currency).toBe(OPEN_VERSE_CURRENCY);
    expect(r.ledger.currency).toBe("VB");
    expect(ledgerDraftFor(r.post, r.submissions.find((s) => s.id === "s2")!).idempotencyKey).toBe(r.ledger.idempotencyKey);
  });

  it("only the creator can pick; strangers and submitters are refused", () => {
    expect(code(() => pickWinner(post(), subs(), VERSE_A, "s1", T0))).toBe("not_owner");
    expect(code(() => pickWinner(post(), subs(), "user-stranger", "s1", T0))).toBe("not_owner");
  });

  it("same-winner re-pick replays idempotently; a different pick is refused", () => {
    const first = pickWinner(post(), subs(), OWNER, "s1", T0);
    const replay = pickWinner(first.post, first.submissions, OWNER, "s1", T0);
    expect(replay.applied).toBe(false);
    expect(replay.ledger.idempotencyKey).toBe(first.ledger.idempotencyKey);
    expect(code(() => pickWinner(first.post, first.submissions, OWNER, "s2", T0))).toBe("already_picked");
  });

  it("refuses withdrawn / foreign / missing submissions and cancelled posts", () => {
    expect(code(() => pickWinner(post(), subs(), OWNER, "s3", T0))).toBe("submission_not_live");
    expect(code(() => pickWinner(post(), subs(), OWNER, "nope", T0))).toBe("submission_not_found");
    expect(code(() => pickWinner(post({ status: "cancelled" }), subs(), OWNER, "s1", T0))).toBe("post_not_open");
  });

  it("a closed post can still be picked (closing stops verses, not the pick)", () => {
    const r = pickWinner(post({ status: "closed" }), subs(), OWNER, "s1", T0);
    expect(r.applied).toBe(true);
  });
});

describe("close / cancel + viewer actions", () => {
  it("close and cancel are owner-only; cancel after a pick is refused", () => {
    expect(closePost(post(), OWNER, T0).status).toBe("closed");
    expect(code(() => closePost(post(), VERSE_A, T0))).toBe("not_owner");
    expect(cancelPost(post(), OWNER, T0).status).toBe("cancelled");
    expect(code(() => cancelPost(post({ status: "winner_picked" }), OWNER, T0))).toBe("already_picked");
  });

  it("viewerActions reflect the gate: owner manages, others submit/withdraw", () => {
    const p = post();
    expect(viewerActions(p, OWNER, null, T0)).toEqual(expect.arrayContaining(["close", "pick_winner", "cancel"]));
    expect(viewerActions(p, VERSE_A, null, T0)).toEqual(["submit"]);
    expect(viewerActions(p, VERSE_A, sub("s1", VERSE_A), T0)).toEqual(["withdraw"]);
    expect(viewerActions(post({ status: "winner_picked" }), VERSE_A, null, T0)).toEqual([]);
  });
});

describe("money law + route wiring", () => {
  it("copy is Visual Bucs / test mode only, never cash", () => {
    expect(OPEN_VERSE_COPY.moneyNote).toContain("Visual Bucs only, never cash");
    expect(OPEN_VERSE_COPY.moneyNote).toContain("Test mode");
    expect(OPEN_VERSE_COPY.termsUpFront).toContain("before any verse is submitted");
  });

  it("the router is registered and every route is auth-gated", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const routesIndex = fs.readFileSync(path.join(here, "../../routes/index.ts"), "utf8");
    expect(routesIndex).toContain('import openVerseRouter from "./open-verse"');
    expect(routesIndex).toContain("router.use(openVerseRouter)");
    const routeSrc = fs.readFileSync(path.join(here, "../../routes/open-verse.ts"), "utf8");
    for (const frag of [
      'router.post("/open-verse"',
      'router.get("/open-verse/open"',
      'router.get("/open-verse/mine"',
      'router.get("/open-verse/:id"',
      '"/open-verse/:id/submit"',
      '"/open-verse/:id/close"',
      '"/open-verse/:id/cancel"',
      '"/open-verse/:id/pick-winner"',
      '"/open-verse/:id/withdraw"',
    ]) {
      expect(routeSrc).toContain(frag);
    }
    // Every handler carries requireAuth (no anonymous money-adjacent surface).
    expect((routeSrc.match(/requireAuth/g) ?? []).length).toBeGreaterThanOrEqual(9);
    // Splits come from the existing rail, not a second machine.
    const libSrc = fs.readFileSync(path.join(here, "../open-verse.ts"), "utf8");
    expect(libSrc).toContain('from "./publishing-splits"');
    expect(libSrc).toContain("validateWriterSplits");
  });

  it("migration + schema carry the exactly-once ledger uniques", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(here, "../../../../..");
    const sql = fs.readFileSync(path.join(root, "lib/db/migrations/9999-open-verse.sql"), "utf8");
    expect(sql).toContain("open_verse_split_ledger");
    expect(sql).toMatch(/UNIQUE.*post_id|post_id.*UNIQUE/s);
    expect(sql).toContain("idempotency_key");
    expect(sql).toContain("'VB'");
  });
});
