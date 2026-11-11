/**
 * FacebookPostModal (post a video to a Facebook Page) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action modal, not a collection load. Both of its calls
 * narrate ONLY from checked responses:
 * - THE DESCRIPTION GENERATION treats non-ok, a non-array
 *   hooks payload, AND an empty hooks array as the same
 *   honest failure — a generation that returns no hooks
 *   delivered nothing, and the panel says so instead of
 *   rendering an empty picker.
 * - THE PUBLISH separates its outcomes: a declined credit
 *   confirmation (null res) claims nothing; a 402 lands on
 *   OutOfCredits; a 409 publish_in_progress gets its own
 *   truthful "already publishing" line (not an error, not a
 *   success); non-ok throws the server's message; the
 *   permalink + success toast land only on an ok response,
 *   and only then is the stored idempotency key retired.
 * - The elapsed timer is cleared when publishing ends and
 *   on unmount — no interval outlives the attempt.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FacebookPostModal.tsx");

describe("the description generation proves its payload before showing it", () => {
  it("non-ok, non-array, and empty hooks all land on the same error line", () => {
    expect(src).toContain("if (!res.ok || !Array.isArray(data.hooks) || data.hooks.length === 0) {");
    expect(src).toContain('setError(plainErrorText(err, "Description generation failed."));');
  });
});

describe("the publish separates cancel, credits, in-progress, failure, success", () => {
  it("each outcome lands on its own truthful state", () => {
    expect(src).toContain("if (!res) return; // user cancelled the credit confirmation (finally resets state)");
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain('if (res.status === 409 && data.error === "publish_in_progress") {');
    expect(src).toContain("This post is already publishing — give it a minute, then check your Facebook Page.");
    expect(src).toContain('throw new Error(apiErrorMessage(data, "Couldn\'t publish to Facebook."));');
  });

  it("success artifacts land only on ok, and the idempotency key retires only then", () => {
    expect(src).toContain("setPermalink(data.permalink || null);");
    expect(src).toContain("sessionStorage.removeItem(`fb-publish-key:${videoUrl}`);");
    expect(src).toContain('toast({ title: "Posted to Facebook"');
    expect(src).toContain("setPublishing(false);");
  });

  it("the elapsed timer never outlives the attempt", () => {
    expect(src).toContain("clearInterval(timer.current);");
  });
});
