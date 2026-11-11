/**
 * InstagramPostModal (post a video to Instagram) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The exact twin of FacebookPostModal (pinned in this same
 * tranche), kept honest by the same machines:
 * - THE CAPTION GENERATION treats non-ok, a non-array hooks
 *   payload, AND an empty hooks array as one honest failure —
 *   a generation that returns no hooks delivered nothing.
 * - THE PUBLISH separates its outcomes: declined confirmation
 *   (null res) claims nothing; 402 lands on OutOfCredits; a
 *   409 publish_in_progress gets its own truthful "already
 *   publishing" line; non-ok throws the server's message; the
 *   permalink + success toast land only on an ok response,
 *   and only then is the stored idempotency key retired.
 * - The elapsed timer is cleared when publishing ends and on
 *   unmount.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./InstagramPostModal.tsx");

describe("the caption generation proves its payload before showing it", () => {
  it("non-ok, non-array, and empty hooks all land on the same error line", () => {
    expect(src).toContain("if (!res.ok || !Array.isArray(data.hooks) || data.hooks.length === 0) {");
    expect(src).toContain('setError(plainErrorText(err, "Caption generation failed."));');
  });
});

describe("the publish separates cancel, credits, in-progress, failure, success", () => {
  it("each outcome lands on its own truthful state", () => {
    expect(src).toContain("if (!res) return; // user cancelled the credit confirmation (finally resets state)");
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain('if (res.status === 409 && data.error === "publish_in_progress") {');
    expect(src).toContain("This post is already publishing — give it a minute, then check your Instagram.");
    expect(src).toContain('throw new Error(apiErrorMessage(data, "Couldn\'t publish to Instagram."));');
  });

  it("success artifacts land only on ok; the timer never outlives the attempt", () => {
    expect(src).toContain("setPermalink(data.permalink || null);");
    expect(src).toContain("sessionStorage.removeItem(`ig-publish-key:${videoUrl}`);");
    expect(src).toContain("setPublishing(false);");
    expect(src).toContain("clearInterval(timer.current);");
  });
});
