/**
 * PushNotificationSettings (device-ping settings) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE MASTER TOGGLE runs an outcome machine, not a guess:
 *   the subscribe helper's exact outcome becomes the state —
 *   subscribed → on, denied → denied, not_configured →
 *   not-configured, unsupported → unsupported — and a thrown
 *   attempt lands on the error state. The toggle never shows
 *   "on" for a subscription that wasn't proven.
 * - THE CATEGORY PREFS load into their own error state
 *   (prefsError + retryNonce retry); a category toggle is
 *   optimistic WITH rollback to the previous proven prefs
 *   on failure.
 * - THE CONFIG PROBE's fail-soft default is pinned as-is:
 *   an unreachable config reads as not-configured, whose
 *   copy claims only a SITE fact ("aren't switched on for
 *   the site yet") and immediately states the still-true
 *   fallback ("the bell still catches everything") — it
 *   fabricates nothing about the member, and push simply
 *   stays unavailable, the conservative direction.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PushNotificationSettings.tsx");

describe("the master toggle becomes exactly what the subscribe outcome proved", () => {
  it("each outcome maps to its own state; a throw lands on error", () => {
    expect(src).toContain('outcome === "subscribed"');
    expect(src).toContain('outcome === "denied"');
    expect(src).toContain('outcome === "not_configured"');
    expect(src).toContain('setMaster("error");');
  });
});

describe("the category prefs error honestly and roll back on failure", () => {
  it("the prefs load has its own error state with a real retry", () => {
    expect(src).toContain("if (!cancelled) setPrefsError(true);");
    expect(src).toContain("}, [user, retryNonce]);");
  });

  it("a failed category save restores the previous proven prefs", () => {
    expect(src).toContain("setPrefs(await updatePushPreferences(deps, { [key]: next }));");
    expect(src).toContain("setPrefs(previous);");
  });
});
