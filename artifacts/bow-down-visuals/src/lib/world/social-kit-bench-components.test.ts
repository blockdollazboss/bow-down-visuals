/**
 * social-kit-bench-components — Stack 400 world parity
 * (Lane B item 9) source-contract pins. The Social Kit bench
 * must stack at the Post Office station in StationPanel as an
 * ({ isLight }) bench, run through the confirmed spend seam at
 * the registry price, flow the finished kit into the hub
 * project, and wire the NativeStates trio — with light/dark
 * parity via its isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/SocialKitBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the Post Office mount", () => {
  it("is a named ({ isLight }) bench rooted at its testid on a NativeCard", () => {
    expect(bench).toContain("export function SocialKitBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-social-kit-bench"');
    expect(bench).toContain("<NativeCard isLight={isLight}>");
  });

  it("StationPanel stacks it in the Post Office family behind a DeskDoor", () => {
    expect(panel).toContain('const SocialKitBench = lazy(() => import("@/components/world/native/SocialKitBench")');
    expect(panel).toContain('station.id === "post-office"');
    expect(panel).toContain("<SocialKitBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:social-kit`}');
  });
});

describe("the run rides the confirmed-spend seam", () => {
  it("posts through confirmedFetch with the registry cost + the panel's feature name", () => {
    expect(bench).toContain("confirmedFetch(SOCIAL_KIT_PATH, {");
    expect(bench).toContain("overrideCost: cost");
    expect(bench).toContain('overrideFeature: "Social Media Kit"');
    expect(bench).toContain("socialKitCost()");
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('t("worldBenches300.outOfBucs", { feature: "Social Media Kit" })');
  });

  it("flows the finished kit into the hub project like the panel", () => {
    expect(bench).toContain("socialKitAssetsOf(data)");
    expect(bench).toContain('addAsset({');
    expect(bench).toContain('sourceAsset: "social-kit"');
    expect(bench).toContain('data-testid="world-social-kit-result"');
  });
});

describe("the NativeStates trio is wired", () => {
  it("loading, empty and error states all render from the trio", () => {
    expect(bench).toContain("<NativeLoadingState isLight={isLight}");
    expect(bench).toContain("<NativeEmptyState isLight={isLight}");
    expect(bench).toContain("<NativeErrorState");
    expect(bench).toContain('t("worldBizBenches400.socialKitStateLoading")');
    expect(bench).toContain('t("worldBizBenches400.socialKitStateEmpty")');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
