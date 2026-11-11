/**
 * BragModal (the milestone brag-card share) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A two-step share held to the chain rule — "posted" is
 * earned by BOTH steps:
 * - THE CARD RENDER failure lands on its own line
 *   (bragRenderFailed) — no card, no share.
 * - THE UPLOAD gates on ok + the returned URL
 *   (`!up.ok || !upData.url` throws the upload-failed
 *   message); the feed POST (apiJson, which throws on
 *   non-ok) must also succeed before the phase may become
 *   "posted" — and any failure returns the phase to "ready"
 *   with the error shown, so the member can retry and is
 *   never told a brag posted that didn't.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BragModal.tsx");

describe("posted is earned by the upload AND the post, in order", () => {
  it("the upload gate precedes the posted phase; failure returns to ready", () => {
    const gateIdx = src.indexOf("if (!up.ok || !upData.url) throw new Error(");
    const postedIdx = src.indexOf('setPhase("posted");');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(postedIdx).toBeGreaterThan(gateIdx);
    expect(src).toContain('setPhase("ready");');
    expect(src).toContain('setError(t("milestones.bragRenderFailed"));');
  });
});
