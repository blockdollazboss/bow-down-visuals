/**
 * LoyaltySettingsPanel (loyalty rules + redemption queue) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE RULES LOAD is the doctrine exemplar (Stack-28
 *   A3-F11, stated in its own header): until the saved rules
 *   actually load, the form is NOT rendered — the hard-coded
 *   defaults "must never pose as the creator's saved earn
 *   rules, and never be saveable over unseen settings"; a
 *   failure lands on "Your saved loyalty rules couldn't load
 *   — nothing below is your saved settings."
 * - THE PROFILE RESOLUTION distinguishes its answers: a
 *   deliberate 404 is the no-profile ANSWER (its own honest
 *   state), every other non-200 and any network failure is
 *   a load error — "a real failure must never pose as 'no
 *   profile'".
 * - FIX (this tranche): THE REDEMPTION QUEUE's fetch fell
 *   back to an empty list on failure, so the render asserted
 *   "Nothing waiting" over redemptions it never loaded. The
 *   queue leg now marks queueFailed, rendered as its own
 *   couldn't-load line; the genuine empty copy shows only
 *   from a proven empty queue. Per-section independence is
 *   preserved — a queue failure still doesn't break the
 *   rules form, and vice versa.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LoyaltySettingsPanel.tsx");

describe("the rules form never renders unproven defaults", () => {
  it("the doctrine and the failure lines are pinned", () => {
    expect(src).toContain("must never pose as the creator");
    expect(src).toContain("saved earn rules, and never be saveable over unseen settings.");
    expect(src).toContain('setLoadError("Your saved loyalty rules couldn\'t load — nothing below is your saved settings.");');
    expect(src).toContain("if (meRes.status === 404) { setNoProfile(true); return; }");
    expect(src).toContain('if (!meRes.ok) throw new Error("me lookup failed");');
  });
});

describe("FIX: a failed queue read never asserts an empty queue", () => {
  it("the queue leg marks its own failure and the render splits on it", () => {
    expect(src).toContain("setQueueFailed(true); return { redemptions: [] };");
    expect(src).toContain("{queueFailed ? (");
    expect(src).toContain("The redemption queue couldn&apos;t load — redemptions may be waiting.");
    expect(src).toContain("Nothing waiting. When a fan redeems a perk it lands here.");
  });
});
