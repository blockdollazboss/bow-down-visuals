/**
 * avatar-presenter-bench-components — Stack 400 world parity
 * (census B-06) source-contract pins. The bench must stack
 * inside the Video Desk as an ({ isLight }) bench, read its
 * provider status from the panel's own rail, run a generate
 * through the confirmed spend seam at the registry's 1,200
 * ONLY when the server says configured — and in the ruled
 * dark state render the honest unavailable surface with NO
 * generate control at all — and branch its surfaces on
 * isLight with the NativeStates trio wired.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/AvatarPresenterBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the Video Desk mount", () => {
  it("is a named ({ isLight }) bench rooted at its testid", () => {
    expect(bench).toContain("export function AvatarPresenterBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-avatar-presenter-bench"');
  });

  it("StationPanel stacks it inside the video-desk branch behind a DeskDoor", () => {
    expect(panel).toContain('const AvatarPresenterBench = lazy(() => import("@/components/world/native/AvatarPresenterBench")');
    expect(panel).toContain('station.id === "video-desk"');
    expect(panel).toContain("<AvatarPresenterBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:avatar-presenter`}');
  });
});

describe("the dark state — B-06's hard condition", () => {
  it("the generate runs ONLY behind the server's configured word", () => {
    expect(bench).toContain("const canGenerate = avatarPresenterCanGenerate(status);");
    expect(bench).toContain("if (!canGenerate || !payload || run === \"running\") return;");
  });

  it("the dark branch renders the honest unavailable surface, plan fields and all", () => {
    expect(bench).toContain('data-testid="world-avatar-presenter-dark"');
    expect(bench).toContain('t("worldAvatarPresenterBench.notConfigured")');
    expect(bench).toContain('t("worldAvatarPresenterBench.savedNote")');
  });

  it("the confirmed generate exists in the bench exactly once — the lit branch only", () => {
    expect(bench.split("confirmedFetch(").length - 1).toBe(1);
    expect(bench.split("onClick={() => void generate()}").length - 1).toBe(1);
  });
});

describe("the lit run rides the confirmed-spend seam at the registry's 1,200", () => {
  it("posts through confirmedFetch with the registry override", () => {
    expect(bench).toContain('confirmedFetch("/api/avatar-presenter", {');
    expect(bench).toContain("overrideCost: AVATAR_PRESENTER_COST");
    expect(bench).toContain("overrideFeature: AVATAR_PRESENTER_FEATURE");
    expect(bench).toContain("JSON.stringify(payload)");
  });

  it("reads status from the panel's rail and polls the job to its clip", () => {
    expect(bench).toContain("fetch(AVATAR_PRESENTER_STATUS_PATH");
    expect(bench).toContain("parseAvatarPresenterStatus(data)");
    expect(bench).toContain("avatarPresenterJobPath(jobId)");
    expect(bench).toContain("presenterJobOutcome(view)");
    expect(bench).toContain('data-testid="world-avatar-presenter-result"');
  });

  it("a 402 lands in the out-of-Bucs state", () => {
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('data-testid="world-avatar-presenter-out"');
  });
});

describe("honest states + light/dark parity", () => {
  it("wires the NativeStates trio", () => {
    expect(bench).toContain("NativeLoadingState");
    expect(bench).toContain("NativeErrorState");
    expect(bench).toContain('t("worldAvatarPresenterBench.checking")');
    expect(bench).toContain('t("worldAvatarPresenterBench.statusFailed")');
  });

  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
