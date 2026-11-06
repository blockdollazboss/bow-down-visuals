/**
 * trends-radar-components — stack200 world parity lane B1,
 * census item 1 source-contract pins. The Trend Radar bench
 * must sit in the Promote Room stack under the Predictor as a
 * ({ isLight, isGuest }) desk with the house GuestGate, with:
 * - the free rail read plainly (no confirmed-spend seam —
 *   the radar charges nothing), a failed load landing in the
 *   honest error state with a retry, a loading state that is
 *   not an empty bench, and the genuine-empty copy only after
 *   a successful empty load;
 * - the three families rendered with the website rail's own
 *   labels (trends.radar.*) and pace lines;
 * - C-30's outside family rendered only when the seam kept
 *   it, as its own red lane, every row naming YouTube's views
 *   and clicking through to YouTube itself;
 * - NO create/use action anywhere — the bench is read-only,
 *   per the census build sketch;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/TrendsRadarDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the Promote Room mount", () => {
  it("is a named ({ isLight, isGuest }) desk rooted at its testid, guests gated", () => {
    expect(desk).toContain("export function TrendsRadarDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-trends-radar-desk"');
    expect(desk).toContain("if (isGuest) return <GuestGate isLight={isLight} />;");
    expect(desk).toContain('data-testid="world-trends-radar-desk-signin"');
  });

  it("StationPanel stacks it in the Promote Room under the Predictor, behind a DeskDoor", () => {
    expect(panel).toContain('const TrendsRadarDesk = lazy(() => import("@/components/world/native/TrendsRadarDesk")');
    expect(panel).toContain("<TrendsRadarDesk isLight={isLight} isGuest={isGuest} />");
    expect(panel.indexOf("<TrendsRadarDesk")).toBeGreaterThan(panel.indexOf("<TrendsDesk"));
  });
});

describe("the load — free rail, honest states", () => {
  it("reads the rail with a plain bearer fetch — no spend seam anywhere", () => {
    expect(desk).toContain("fetch(TREND_RADAR_PATH, {");
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("useConfirmedApi");
    expect(desk).not.toContain("confirmSpend");
  });

  it("failure is an error state with retry; loading is not an empty bench", () => {
    expect(desk).toContain("<NativeErrorState");
    expect(desk).toContain('t("trends.radar.loadError")');
    expect(desk).toContain("setRetryNonce((n) => n + 1)");
    expect(desk).toContain("<NativeLoadingState");
    expect(desk).toContain('t("trends.radar.loading")');
    /* The parse guard is what separates "failed" from "empty". */
    expect(desk).toContain("trendRadarFeedOf(await res.json()");
    expect(desk).toContain("if (!parsed) throw new Error(");
  });

  it("the genuine-empty copy renders only for a loaded, all-empty feed", () => {
    expect(desk).toContain("<NativeEmptyState");
    expect(desk).toContain('t("trends.radar.allEmpty")');
    expect(desk).toContain("radarAllEmpty(feed)");
  });
});

describe("the families — the rail's own labels, read-only", () => {
  it("renders sounds, topics and formats with the page's labels and pace lines", () => {
    for (const needle of [
      't("trends.radar.soundsTitle")',
      't("trends.radar.soundsEmpty")',
      't("trends.radar.topicsTitle")',
      't("trends.radar.topicsEmpty")',
      't("trends.radar.formatsTitle")',
      't("trends.radar.formatsEmpty")',
      't("trends.radar.pace"',
      't("trends.radar.coldStart"',
      't("trends.radar.honestNote")',
      "t(`trends.radar.format.${f.format}`)",
      'data-testid="world-trends-radar-feed"',
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("carries no create/use action — the bench is the radar, read-only", () => {
    expect(desk).not.toContain("createLink");
    expect(desk).not.toContain("trends.radar.useSound");
    expect(desk).not.toContain("trends.radar.makeInLane");
    expect(desk).not.toContain("trends.radar.scaffold");
  });
});

describe("the outside family — C-30's labeled lane", () => {
  it("renders only when the seam kept videos, as its own red panel", () => {
    expect(desk).toContain("const showOutside = outsideVideos.length > 0;");
    expect(desk).toContain('data-testid="world-trends-radar-outside"');
    expect(desk).toContain("border-red-500/25 bg-red-500/[0.04]");
    expect(desk).toContain("border-red-900/20 bg-red-500/[0.05]");
  });

  it("every row names YouTube's views and clicks through to YouTube itself", () => {
    expect(desk).toContain('t("trends.radar.outsideViews", { count: formatOutsideViews(v.viewCount) })');
    expect(desk).toContain('t("trends.radar.outsideBadge")');
    expect(desk).toContain('t("trends.radar.outsideNote")');
    expect(desk).toContain("href={v.url}");
    expect(desk).toContain('target="_blank"');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
