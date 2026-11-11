/**
 * PushAlertsToggle (the live page's push-alerts switch) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A member of the push family (PushNotificationSettings /
 * PushOptInPrompt, pinned in this same tranche): the toggle
 * derives its state from the shared probes — an unreachable
 * config reads as not-configured, and an unproven
 * subscription check assumes NOT subscribed, the actionable
 * direction for a switch whose job is to offer subscribing
 * (the settings card remains the surface of record for push
 * state). While loading or signed out the toggle renders
 * nothing at all rather than a guessed state.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PushAlertsToggle.tsx");

describe("the toggle renders only a derived state, never a guess", () => {
  it("the probes and the null states are pinned", () => {
    expect(src).toContain(".catch(() => ({ configured: false, publicKey: null }));");
    expect(src).toContain("const subscribed = await hasPushSubscription().catch(() => false);");
    expect(src).toContain('if (state === "loading" || state === "signed-out") return null;');
  });
});
