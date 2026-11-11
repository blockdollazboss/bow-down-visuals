/**
 * ChartsBoard — honest load standard (deep-pins tranche 3, batch 5).
 * The Music Hall's charts board: six tabs, one cached read per
 * window+vertical+lookback (media) or tab+vertical (fixed-span).
 *
 * The main read renders in the house order — error state (retry
 * bumps the tick, which re-runs the load effect for the failed key)
 * before the loading state before the board — and each tab's empty
 * state renders only inside the loaded arm, with span-honest copy:
 * the span noun in the title and the empty line is recomputed from
 * the CHOSEN window/lookback, so the board never shows a filtered
 * read under an unfiltered name (its own render comments record
 * this). A cached view is never re-fetched or re-failed by another
 * view's failure: failedKey is per loadKey.
 *
 * The three seeding reads (follow / like / repost states) are the
 * documented seed family and pin as-is: a failed seed leaves the
 * rows on their chart counts with the toggles unsettled, and every
 * toggle settles from the SERVER's answer (followStateFromResponse /
 * likeStateFromToggle / repostStateFromToggle) — a failed toggle
 * flips nothing ("the heart never pretends", per the code comments).
 * Seeds never overwrite a toggle's settled answer.
 *
 * Guests fire the chart reads (the station is open) but no seeding
 * reads and get no member actions — Play/Follow/Like/Repost are
 * member acts, and the guest line says so instead of handing out
 * dead buttons.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ChartsBoard.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — per-key cache, failure first, span-honest empties", () => {
  it("the loader throws on non-ok for both read shapes and clears only its own key's failure", () => {
    const effect = slice(src, "useEffect(() => {\n    let cancelled = false;\n    const loaded =", "}, [tab, tick, window, vertical, lookbackDays]);");
    expect(effect).toContain('if (!res.ok) throw new Error("charts");');
    expect(effect).toContain("normalizeChartTracks(payload)");
    expect(effect).toContain('if (!res.ok) throw new Error("creators");');
    expect(effect).toContain("setFailedKey(null)");
    expect(effect).toContain("if (!cancelled) setFailedKey(loadKey);");
    expect(effect).toContain("if (loaded && failedKey !== loadKey) return;");
  });

  it("render order is error → loading → board, and the retry re-runs the failed key's load", () => {
    const errAt = src.indexOf("{failedKey === loadKey ? (");
    const loadAt = src.indexOf(") : loading ? (");
    const boardAt = src.indexOf("<NativeBoard isLight={isLight} title={boardTitle}>");
    expect(errAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(errAt);
    expect(boardAt).toBeGreaterThan(loadAt);
    const errBlock = src.slice(errAt, loadAt);
    expect(errBlock).toContain("onRetry={() => setTick((n) => n + 1)}");
  });

  it("empties live in the loaded arm and speak the chosen span", () => {
    expect(src).toContain("(tracks ?? []).length === 0");
    expect(src).toContain('tr("worldBoards.chEmptyTracksAllTime")');
    expect(src).toContain('tr("worldBoards.chEmptyTracksSpan", { span: spanNoun })');
    expect(src).toContain("creatorRows.length === 0");
    expect(src).toContain("const spanNoun = lookbackDays !== null ? chartLookbackNoun(lookbackDays, chStrings) : chartWindowNoun(window, chStrings);");
  });
});

describe("seeding reads — the documented seed family", () => {
  it("all three seeds skip guests, return silently on non-ok, and never overwrite a settled toggle", () => {
    expect(src).toContain("if (isGuest || !creatorKey) return;");
    expect(src).toContain("if (isGuest || !likeIdsParam) return;");
    expect(src).toContain("if (isGuest || !repostIdsParam) return;");
    expect(src).toContain("if (!(key in next)) next[key] = { liked, count: countByKey.get(key) ?? 0 };");
    expect(src).toContain("if (!(key in next)) next[key] = { reposted, count: countByKey.get(key) ?? 0 };");
    expect(src).toContain("/* unknown state — the toggle still works off the response */");
  });

  it("toggles settle from the server's answer — a failed toggle flips nothing", () => {
    const follow = slice(src, "const toggleFollow = async (row: ChartCreatorRow) => {", "const play = (row: ChartTrackRow) => {");
    expect(follow).toContain("const state = followStateFromResponse(await res.json().catch(() => null));");
    expect(follow).toContain("if (res.ok && state) {");
    expect(follow).toContain("/* the button just doesn't flip — no toast spam in-world */");
    const like = slice(src, "const toggleRowLike = async (", "const likeButton =");
    expect(like).toContain("setLikeStates((prev) => ({ ...prev, [key]: likeStateFromToggle(current, res) }));");
    expect(like).toContain("/* the heart just doesn't flip — no toast spam in-world */");
    const repost = slice(src, "const toggleRowRepost = async (", "const repostButton =");
    expect(repost).toContain("setRepostStates((prev) => ({ ...prev, [key]: repostStateFromToggle(current, res) }));");
  });
});

describe("guests — open station, no dead buttons", () => {
  it("member actions render only for members; the guest line explains instead", () => {
    expect(src).toContain("{embedButton(\"track\", row)}");
    expect(src).toContain("{!isGuest && (");
    expect(src).toContain('tr("worldBoards.chGuestPrefix")');
    expect(src).toContain('tr("worldBoards.chGuestSignIn")');
    expect(src).toContain("action={\n                    isGuest ? undefined : (");
  });
});
