import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PITCH_FIX_BOARD_PATH,
  PITCH_FIX_FIXES_PATH,
  PITCH_FIX_MINE_PATH,
  PITCH_FIX_PITCHES_PATH,
  PITCH_FIX_REWARDS_LINE,
  buildFixBody,
  buildPitchBody,
  fixFormReady,
  fixPageLabel,
  fixSeverityLabel,
  normalizeMySubmissions,
  normalizePitchFixBoard,
  parseVoteResult,
  pitchCategoryLabel,
  pitchFormReady,
  pitchVotePath,
  submissionRewardLine,
  submissionStatusLine,
  type FixForm,
  type PitchForm,
} from "./pitch-fix-board";
import type { PitchFixSubmission } from "@/lib/pitch-fix";

/* ─── Pitch & Fix board (stack1100 world parity) ───────────────────
   The kingdom's suggestion board native at the Kingdom Board, on
   the pitch-fix router's own rails. These tests pin the seam: the
   board payload normalized through the shared wire type, the
   filing bodies matching the rail's zod schemas, the vote answer
   read from the rail, and a filing's standing spoken honestly
   (moderation first, rewards only when the rail says so). */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function wire(over: Partial<PitchFixSubmission> = {}): PitchFixSubmission {
  return {
    id: "sub-1",
    kind: "pitch",
    source: "door",
    submitterUserId: "u-1",
    submitterName: "Thy Cheat Code",
    title: "Duet stages in the World",
    body: "Two creators, one stage.",
    why: null,
    category: "world",
    page: null,
    severity: null,
    rating: null,
    status: "approved",
    moderationStatus: "approved",
    upvoteCount: 7,
    rewardStatus: "none",
    rewardAmount: null,
    rewardQueuedAt: null,
    rewardPaidAt: null,
    duplicateOfId: null,
    shippedAt: null,
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    ...over,
  };
}

describe("rails + the rewards line", () => {
  it("the paths are the pitch-fix page's own endpoints", () => {
    expect(PITCH_FIX_BOARD_PATH).toBe("/api/pitch-fix/board");
    expect(PITCH_FIX_PITCHES_PATH).toBe("/api/pitch-fix/pitches");
    expect(PITCH_FIX_FIXES_PATH).toBe("/api/pitch-fix/fixes");
    expect(PITCH_FIX_MINE_PATH).toBe("/api/pitch-fix/mine");
    expect(pitchVotePath("sub-1")).toBe("/api/pitch-fix/sub-1/vote");
    expect(pitchVotePath("a/b")).toBe("/api/pitch-fix/a%2Fb/vote");
  });

  it("the rewards line is the page's own words (owner ruling, Oct 25)", () => {
    expect(PITCH_FIX_REWARDS_LINE).toBe("Shipped pitches earn 500 VB · shipped fixes earn 100–250 VB");
    const en = read("../../locales/en.json");
    expect(en).toContain(`"rewardsLine": "${PITCH_FIX_REWARDS_LINE}"`);
  });
});

describe("normalizePitchFixBoard", () => {
  it("reads the board's three lists + the viewer's voted ids", () => {
    const data = normalizePitchFixBoard({
      pitches: [wire()],
      fixes: [wire({ id: "sub-2", kind: "fix", page: "the_world", severity: "blocks_me" })],
      shipped: [wire({ id: "sub-3", status: "shipped" })],
      viewerVotedIds: ["sub-1"],
    });
    expect(data?.pitches).toHaveLength(1);
    expect(data?.fixes[0]?.page).toBe("the_world");
    expect(data?.shipped[0]?.status).toBe("shipped");
    expect(data?.viewerVotedIds).toEqual(["sub-1"]);
  });

  it("a malformed row fails the whole read (null), never a partial board", () => {
    expect(normalizePitchFixBoard({ pitches: [{ id: "x" }], fixes: [], shipped: [] })).toBeNull();
    expect(normalizePitchFixBoard({ pitches: [], fixes: [] })).toBeNull();
    expect(normalizePitchFixBoard(null)).toBeNull();
    expect(normalizeMySubmissions({ submissions: [wire()] })).toHaveLength(1);
    expect(normalizeMySubmissions({})).toBeNull();
  });

  it("an unknown moderation value reads as pending — the gate is never overstated", () => {
    const data = normalizePitchFixBoard({
      pitches: [wire({ moderationStatus: "weird" as PitchFixSubmission["moderationStatus"] })],
      fixes: [],
      shipped: [],
      viewerVotedIds: [],
    });
    expect(data?.pitches[0]?.moderationStatus).toBe("pending");
  });
});

describe("labels", () => {
  it("categories, pages and severities speak the page's words", () => {
    expect(pitchCategoryLabel("world")).toBe("The World");
    expect(pitchCategoryLabel(null)).toBe("Other");
    expect(fixPageLabel("the_world")).toBe("The World");
    expect(fixPageLabel("make_song_video")).toBe("Make Song + Video");
    expect(fixPageLabel(null)).toBe("Somewhere else");
    expect(fixSeverityLabel("blocks_me")).toBe("Blocks me");
    expect(fixSeverityLabel(null)).toBe("Small");
  });
});

describe("a filing's standing", () => {
  it("moderation speaks first, then the team's ladder", () => {
    expect(submissionStatusLine(wire({ moderationStatus: "pending", status: "shipped" }))).toBe(
      "With the team — in review",
    );
    expect(submissionStatusLine(wire({ moderationStatus: "rejected" }))).toBe("Not taken up this time");
    expect(submissionStatusLine(wire({ status: "shipped" }))).toBe("Shipped — it's live");
    expect(submissionStatusLine(wire({ status: "fixed", kind: "fix" }))).toBe("Shipped — it's live");
    expect(submissionStatusLine(wire({ status: "building" }))).toBe("Being built now");
    expect(submissionStatusLine(wire({ status: "approved" }))).toBe("On the board");
  });

  it("rewards speak only when the rail says paid or queued", () => {
    expect(submissionRewardLine(wire({ rewardStatus: "paid", rewardAmount: 500 }))).toBe("+500 Bucs landed");
    expect(submissionRewardLine(wire({ rewardStatus: "queued" }))).toBe("Reward queued");
    expect(submissionRewardLine(wire({ rewardStatus: "none" }))).toBeNull();
    expect(submissionRewardLine(wire({ rewardStatus: "paid", rewardAmount: null }))).toBeNull();
  });
});

describe("filing forms — the rail's zod rules", () => {
  const pitch: PitchForm = { title: "Duet stages", body: "Two creators, one stage.", why: "", category: "world" };
  const fix: FixForm = { title: "Export stalls", body: "", page: "the_world", severity: "blocks_me" };

  it("pitch readiness + body (why omitted when blank)", () => {
    expect(pitchFormReady(pitch)).toBe(true);
    expect(pitchFormReady({ ...pitch, title: "" })).toBe(false);
    expect(pitchFormReady({ ...pitch, body: " " })).toBe(false);
    expect(pitchFormReady({ ...pitch, category: "space" })).toBe(false);
    expect(buildPitchBody(pitch)).toEqual({
      title: "Duet stages",
      body: "Two creators, one stage.",
      why: undefined,
      category: "world",
    });
  });

  it("fix readiness + body (body optional, page/severity enums enforced)", () => {
    expect(fixFormReady(fix)).toBe(true);
    expect(fixFormReady({ ...fix, page: "mars" })).toBe(false);
    expect(fixFormReady({ ...fix, severity: "meh" })).toBe(false);
    expect(buildFixBody(fix)).toEqual({
      title: "Export stalls",
      body: undefined,
      page: "the_world",
      severity: "blocks_me",
    });
  });

  it("the vote answer is the rail's own { voted, upvoteCount }", () => {
    expect(parseVoteResult({ voted: true, upvoteCount: 8 })).toEqual({ voted: true, upvoteCount: 8 });
    expect(parseVoteResult({ voted: "yes", upvoteCount: 8 })).toBeNull();
    expect(parseVoteResult({})).toBeNull();
  });
});

describe("the board stands in the Kingdom Board blocks", () => {
  const boardSrc = read("../../components/world/native/PitchFixBoard.tsx");
  const blocksSrc = read("../../components/world/native/KingdomBoardBlocks.tsx");

  it("KingdomBoardBlocks mounts it (the controller path: board station → blocks → this board)", () => {
    expect(blocksSrc).toContain('import { PitchFixBoard } from "./PitchFixBoard"');
    expect(blocksSrc).toContain("<PitchFixBoard isLight={isLight} isGuest={isGuest} />");
  });

  it("the board lands its verbs on the seam's rails and keeps guests read-only", () => {
    expect(boardSrc).toContain('data-testid="world-pitch-fix-board"');
    expect(boardSrc).toContain("pitchVotePath(pitch.id)");
    expect(boardSrc).toContain("PITCH_FIX_PITCHES_PATH");
    expect(boardSrc).toContain("PITCH_FIX_FIXES_PATH");
    expect(boardSrc).toContain("PITCH_FIX_MINE_PATH");
    expect(boardSrc).toContain("GUEST_SIGN_IN_HREF");
    /* The moderation truth is spoken at filing time. */
    expect(boardSrc).toContain("Every voice is read by the team before it shows on the board");
  });
});
