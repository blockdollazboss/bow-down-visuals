/**
 * XPostModal (post a video to X) — honest action states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * A member of the social-publish modal family (Facebook /
 * Instagram / TikTok twins pinned in this same tranche),
 * kept honest by the same machines:
 * - THE CAPTION GENERATION treats non-ok, a non-array hooks
 *   payload, AND an empty hooks array as one honest failure —
 *   a generation that returns no hooks delivered nothing.
 * - THE PUBLISH separates its outcomes: declined confirmation
 *   (null res) claims nothing; 402 lands on OutOfCredits; a
 *   409 publish_in_progress gets its own truthful "already
 *   publishing" line; non-ok throws the server's message; the
 *   success state lands only on an ok response, and only
 *   then is the stored idempotency key retired (the key
 *   covers text-only posts too — "text-only" rides in the
 *   key when there is no video).
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
const src = read("./XPostModal.tsx");

describe("the caption generation proves its payload before showing it", () => {
  it("non-ok, non-array, and empty hooks all land on the same error line", () => {
    expect(src).toContain("if (!res.ok || !Array.isArray(data.hooks) || data.hooks.length === 0) {");
    expect(src).toContain('setError(plainErrorText(err, "Caption generation failed."));');
  });
});

describe("the publish separates cancel, credits, in-progress, failure, success", () => {
  it("each outcome lands on its own truthful state", () => {
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain('if (res.status === 409 && data.error === "publish_in_progress") {');
    expect(src).toContain("This post is already publishing — give it a minute, then check your X profile.");
    expect(src).toContain('setError(plainErrorText(err, "Couldn\'t publish to X."));');
  });

  it("the idempotency key retires only after a proven publish; the timer is cleaned up", () => {
    expect(src).toContain('sessionStorage.removeItem(`x-publish-key:${videoUrl ?? "text-only"}`);');
    expect(src).toContain("clearInterval(timer.current);");
  });
});
