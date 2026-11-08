/**
 * caption-styler-bench-components — Stack 300 world parity
 * (Lane B item 7) source-contract pins. The Caption Styler
 * bench must stack at the Hook Desk in StationPanel as an
 * ({ isLight }) bench, start its job through the confirmed
 * spend seam at the registry price, poll the server job,
 * and flow the finished video into the hub project — with
 * light/dark parity via its isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/CaptionStylerBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the Hook Desk mount", () => {
  it("is a named ({ isLight }) bench rooted at its testid", () => {
    expect(bench).toContain("export function CaptionStylerBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-caption-styler-bench"');
  });

  it("StationPanel stacks it at the hook-desk station behind a DeskDoor", () => {
    expect(panel).toContain('const CaptionStylerBench = lazy(() => import("@/components/world/native/CaptionStylerBench")');
    expect(panel).toContain('station.id === "hook-desk"');
    expect(panel).toContain("<CaptionStylerBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:caption-styler`}');
  });
});

describe("the run rides the confirmed-spend seam", () => {
  it("starts through confirmedFetch with the registry cost + the page's feature name", () => {
    expect(bench).toContain("confirmedFetch(CAPTION_STYLER_PATH, {");
    expect(bench).toContain("overrideCost: cost");
    expect(bench).toContain('overrideFeature: "Caption Styler"');
    expect(bench).toContain("captionStylerCost()");
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('t("worldBenches300.outOfBucs", { feature: "Caption Styler" })');
  });

  it("polls the server job and flows the finished video into the hub project", () => {
    expect(bench).toContain("captionStylerJobPath(jobId)");
    expect(bench).toContain("captionStylerJobOf(data)");
    expect(bench).toContain('addAsset({ kind: "video", url: job.outputUrl');
    expect(bench).toContain('data-testid="world-caption-styler-result"');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
