/**
 * link-to-hit-bench-components — Stack 300 world parity
 * (Lane B item 12) source-contract pins. The bench must
 * stack at the My Studio board as an ({ isLight,
 * onOpenStation }) bench; the picked file must REALLY
 * upload on the free rail before the analyze run; the
 * analyze run rides the confirmed spend seam at the
 * route's price (the override the panel itself passes);
 * the package renders whole with its two segment kinds;
 * the song hand-off opens the Song Desk station in-world.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/LinkToHitBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the My Studio board mount", () => {
  it("is a named ({ isLight, onOpenStation }) bench rooted at its testid", () => {
    expect(bench).toContain("export function LinkToHitBench({");
    expect(bench).toContain("onOpenStation?: (stationId: string) => void;");
    expect(bench).toContain('data-testid="world-link-to-hit-bench"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const LinkToHitBench = lazy(() => import("@/components/world/native/LinkToHitBench")');
    expect(panel).toContain("<LinkToHitBench isLight={isLight} onOpenStation={props.onOpenStation} />");
  });
});

describe("the two rails — a real upload, then the confirmed analyze", () => {
  it("uploads the picked file on the free rail before analyzing", () => {
    /* D-45: the upload rides the shared direct clip door (session →
       R2 doors → complete via lib/clip-upload), never the retired
       server-transit POST. */
    expect(bench).toContain("uploadClipDirect(");
    expect(bench).toContain("linkToHitUploadUrlOf(upData)");
    expect(bench).toContain("uploadLimitBytes(isAdmin, LINK_TO_HIT_MEMBER_UPLOAD_BYTES)");
  });

  it("analyzes through confirmedFetch with the panel's own override", () => {
    expect(bench).toContain("confirmedFetch(LINK_TO_HIT_ANALYZE_PATH, {");
    expect(bench).toContain("overrideCost: LINK_TO_HIT_COST");
    expect(bench).toContain("overrideFeature: LINK_TO_HIT_FEATURE");
    expect(bench).toContain("linkToHitPackageOf(data)");
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('data-testid="world-link-to-hit-result"');
  });

  it("the song hand-off opens the Song Desk station in-world", () => {
    expect(bench).toContain("onOpenStation?.(LINK_TO_HIT_SONG_STATION_ID)");
    expect(bench).toContain('data-testid="world-link-to-hit-make-song"');
    expect(bench).toContain("linkToHitSongCopyText(pkg)");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
