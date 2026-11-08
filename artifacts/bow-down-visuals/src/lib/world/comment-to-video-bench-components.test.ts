/**
 * comment-to-video-bench-components — Stack 300 world
 * parity (Lane B item 9) source-contract pins. The bench
 * must stack at the Hook Desk as an ({ isLight }) bench,
 * run through the confirmed spend seam at the route's
 * price (the override the page itself passes), render
 * whole scripts with the section's copy text, and branch
 * its surfaces on isLight.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/CommentToVideoBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the Hook Desk mount", () => {
  it("is a named ({ isLight }) bench rooted at its testid", () => {
    expect(bench).toContain("export function CommentToVideoBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-comment-to-video-bench"');
  });

  it("StationPanel stacks it at the hook-desk station behind a DeskDoor", () => {
    expect(panel).toContain('const CommentToVideoBench = lazy(() => import("@/components/world/native/CommentToVideoBench")');
    expect(panel).toContain("<CommentToVideoBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:comment-to-video`}');
  });
});

describe("the run rides the confirmed-spend seam", () => {
  it("posts through confirmedFetch with the section's own override", () => {
    expect(bench).toContain("confirmedFetch(COMMENT_TO_VIDEO_PATH, {");
    expect(bench).toContain("overrideCost: COMMENT_TO_VIDEO_COST");
    expect(bench).toContain("overrideFeature: COMMENT_TO_VIDEO_FEATURE");
    expect(bench).toContain("buildCommentVideoPayload(comments, niche)");
    expect(bench).toContain("commentVideoScriptsOf(data)");
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('data-testid="world-comment-to-video-results"');
  });

  it("copies a script with the seam's byte-exact copy text", () => {
    expect(bench).toContain("commentVideoScriptCopyText(s)");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
