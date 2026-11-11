/**
 * PlanReview (the content-plan review + share step) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE PUBLISH action gates the shareable result on ok +
 *   a proven slug (`!res.ok || !data.slug` throws the
 *   share-failed error) — a plan is never presented as
 *   published, with a link to share, before the server
 *   stored it and returned its address.
 * - THE REFERRAL-CODE READ is a fail-soft prefill: a failed
 *   read (its own try/catch) simply leaves the code out of
 *   the publish body — it decorates the share, it never
 *   fabricates one.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PlanReview.tsx");

describe("the publish claims a shareable plan only from a proven slug", () => {
  it("the gate is pinned", () => {
    expect(src).toContain('if (!res.ok || !data.slug) throw new Error(apiErrorMessage(data, t("contentIntelligence.shareFailed")));');
    expect(src).toContain('const res = await fetch("/api/content-plans/publish", {');
  });
});
