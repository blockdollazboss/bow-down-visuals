/**
 * PitchFixBoard — honest load standard (deep-pins tranche 4,
 * batch D). Two collection loads, each held to the full
 * ordering:
 *
 * - THE BOARD (pitches / fixes / shipped): non-ok throws, and
 *   a payload the seam's normalizer returns null for throws
 *   too — both land boardFailed, whose error state (with a
 *   tick Retry) renders BEFORE the loading state (board still
 *   null). The per-section empty states live INSIDE the loaded
 *   board, so "no pitches yet" appears only after a proven
 *   empty load — a failure never renders as an empty board.
 * - MINE (the caller's own filings): the same shape on its own
 *   state — mineFailed renders its failed line with a Try
 *   again BEFORE the loading state, which stands before the
 *   honestly-empty state.
 *
 * The writes are free member verbs: a vote throws on non-ok
 * AND on an unparseable result before either votedIds or the
 * board's counts move — the tally on screen always comes from
 * the rail's parsed answer; a filing throws on non-ok before
 * the form resets, the mode closes, or the filed note is set,
 * so "filed" is claimed only after the rail's ok. Guests read
 * the board but get no vote action and no filing form.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PitchFixBoard.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the board load: failure is the error state, never an empty board", () => {
  it("non-ok throws; a null normalizer result throws; the board records only after both", () => {
    expect(src).toContain("if (!res.ok) throw new Error(`board ${res.status}`);");
    expect(src).toContain("const parsed = normalizePitchFixBoard(await res.json(), seamStrings);");
    expect(src).toContain('if (!parsed) throw new Error("board shape");');
    expect(src.indexOf("setBoard(parsed);")).toBeGreaterThan(src.indexOf('if (!parsed) throw new Error("board shape");'));
    expect(src).toContain("if (!cancelled) setBoardFailed(true);");
  });

  it("the render orders failed before loading, and the empties live inside the loaded board", () => {
    expect(src.indexOf("{boardFailed ? (")).toBeLessThan(src.indexOf("board === null ? ("));
    expect(src).toContain("onRetry={() => setTick((t) => t + 1)}");
    expect(src).toContain('message={tr("worldBoards.pfPitchesEmpty")}');
    expect(src).toContain('message={tr("worldBoards.pfFixesEmpty")}');
    expect(src.indexOf('message={tr("worldBoards.pfPitchesEmpty")}')).toBeGreaterThan(src.indexOf("board === null ? ("));
  });
});

describe("mine: failed, loading, empty — in that order", () => {
  it("non-ok and null-parse both land mineFailed", () => {
    expect(src).toContain("if (!res.ok) throw new Error(`mine ${res.status}`);");
    expect(src).toContain("const parsed = normalizeMySubmissions(await res.json(), seamStrings);");
    expect(src).toContain('if (!parsed) throw new Error("mine shape");');
    expect(src).toContain("if (!cancelled) setMineFailed(true);");
  });

  it("the render orders the failed line before loading before the empty state", () => {
    expect(src.indexOf("{mineFailed ? (")).toBeLessThan(src.indexOf("mine === null ? ("));
    expect(src.indexOf("mine === null ? (")).toBeLessThan(src.indexOf("mine.length === 0 ? ("));
    expect(src).toContain('message={tr("worldBoards.pfMineEmpty")}');
    expect(src).toContain('tr("worldBoards.pfMineFailed")');
  });

  it("guests never trigger the mine load", () => {
    expect(src).toContain("if (isGuest) return;");
  });
});

describe("the writes: tallies and the filed note move only on proven answers", () => {
  it("a vote throws on non-ok and on a bad shape before any tally moves", () => {
    const vote = slice(src, "async function vote(pitch: PitchFixSubmission) {", 'async function file(kind: "pitch" | "fix") {');
    expect(vote).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, tr("worldBoards.pfVoteFailedStatus", { status: res.status })));');
    expect(vote).toContain("const result = parseVoteResult(data);");
    expect(vote).toContain('if (!result) throw new Error(tr("worldBoards.pfVoteBadShape"));');
    expect(vote.indexOf("setVotedIds((prev) => {")).toBeGreaterThan(vote.indexOf('if (!result) throw new Error(tr("worldBoards.pfVoteBadShape"));'));
    expect(vote.indexOf("upvoteCount: result.upvoteCount")).toBeGreaterThan(vote.indexOf('if (!result) throw new Error(tr("worldBoards.pfVoteBadShape"));'));
    expect(vote).toContain("setVoteError(plainErrorText(err, tr(\"worldBoards.pfVoteFailed\")));");
  });

  it("a filing throws on non-ok before the form resets or the filed note is set", () => {
    const file = slice(src, 'async function file(kind: "pitch" | "fix") {', "  return (");
    expect(file).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, tr("worldBoards.pfFileFailedStatus", { status: res.status })));');
    expect(file.indexOf('setFiledNote(tr("worldBoards.pfFiledNote"));')).toBeGreaterThan(file.indexOf("if (!res.ok) throw new Error("));
    expect(file).toContain("setFileError(plainErrorText(err, tr(\"worldBoards.pfFileFailed\")));");
  });

  it("guests get no vote action and the sign-in line instead of the forms", () => {
    expect(src).toContain("action={\n                        isGuest ? undefined : (");
    expect(src).toContain('tr("worldBoards.pfGuestRead")');
  });
});
