/**
 * SubjectReframeCard (the editor's subject-reframe tool) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, pinned as the failure
 * TAXONOMY exemplar — every failure class gets its own
 * truthful line instead of one generic shrug:
 * - a 402 lands on the out-of-credits copy;
 * - a server failure lands on the REFUNDED line, with the
 *   actual cost interpolated — the money truth ("failed,
 *   and your credits came back") stated exactly, the claim
 *   the endpoint's refund-on-failure contract backs;
 * - a failure with a server message shows that message over
 *   the plain fallback;
 * - a network failure (no answer at all) gets its own
 *   network line — the card never pretends it heard back.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SubjectReframeCard.tsx");

describe("each failure class gets its own truthful line", () => {
  it("402, refunded-failure, server-message, and network are distinct branches", () => {
    expect(src).toContain('setError(serverMsg ?? t("videoEditor.subjectReframe.outOfCredits"));');
    expect(src).toContain('setError(t("videoEditor.subjectReframe.failedRefunded", { cost }));');
    expect(src).toContain('setError(serverMsg ?? t("videoEditor.subjectReframe.failedPlain"));');
    expect(src).toContain('setError(t("videoEditor.subjectReframe.failedNetwork"));');
  });
});
