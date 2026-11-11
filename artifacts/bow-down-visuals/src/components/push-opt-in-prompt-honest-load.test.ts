/**
 * PushOptInPrompt (the soft ask to enable device pings) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A prompt whose every failure direction is conservative,
 * pinned as-is:
 * - an unreachable push config reads as not-configured, so
 *   the prompt simply never appears — it never invites the
 *   member into a flow that can't complete;
 * - an unprovable subscription state assumes SUBSCRIBED
 *   (catch → true), so a member who already enabled pings is
 *   never nagged by a failed check — the failure direction
 *   is always toward NOT interrupting;
 * - the blocked-permission state tells its truth with the
 *   still-true fallback ("the bell still catches
 *   everything").
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PushOptInPrompt.tsx");

describe("every failure direction is toward not interrupting", () => {
  it("an unreachable config hides the prompt; an unproven subscription assumes subscribed", () => {
    expect(src).toContain(".catch(() => ({ configured: false, publicKey: null }));");
    expect(src).toContain("const subscribed = await hasPushSubscription().catch(() => true);");
    expect(src).toContain("Notifications are blocked in your browser settings — the bell still catches everything.");
  });
});
