/**
 * auth-session-death-wiring.test.ts — the gate-pass separation pins
 * (stack800 lane 4).
 *
 * Two different locks guard the gated build: the Supabase session
 * (localStorage) and the password gate's 30-day cookie. Gate #4
 * (Oct 28–29) reported "the gate dropped the signed-in session
 * repeatedly mid-run": the involuntary session-death path used to
 * call /__staging_logout, destroying the gate pass as a side effect,
 * so one (possibly false-positive) death cost the user BOTH sessions
 * and the recovery redirect landed on the gate form.
 *
 * Pins: session death never touches the gate; the DELIBERATE
 * sign-out still drops the gate pass, as its own comment documents.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ctx = readFileSync(join(__dirname, "AuthContext.tsx"), "utf8");

function bodyBetween(startMarker: string, endMarker: string): string {
  const start = ctx.indexOf(startMarker);
  const end = ctx.indexOf(endMarker, start + startMarker.length);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
  return ctx.slice(start, end);
}

describe("session death and the gate pass stay separate", () => {
  it("handleSessionDeath never calls the gate logout", () => {
    const death = bodyBetween("const handleSessionDeath", "useEffect(() => {");
    /* The pin is about the CALL, not the word: the body's own comment
       names the endpoint while explaining why it must never be hit. */
    expect(death).not.toMatch(/fetch\(\s*["']\/__staging_logout/);
    /* …but it still does its real job: clear the dead session and
       land on /login with the expiry notice. */
    expect(death).toContain("clearSupabaseStorage()");
    expect(death).toContain("/login?session=expired");
  });

  it("deliberate signOut still drops the gate pass (documented behaviour)", () => {
    const signOut = bodyBetween("async function signOut()", "/* One-time trial credits");
    expect(signOut).toContain('fetch("/__staging_logout"');
  });

  it("sign-in goes through the bounded wrapper, never the raw client call", () => {
    const signIn = bodyBetween("async function signIn(", "/* Generic social OAuth");
    expect(signIn).toContain("signInWithSupabase(");
    expect(signIn).not.toContain("signInWithPassword(");
    /* …and the profile fetch is settle-bounded inside sign-in. */
    expect(signIn).toContain("settleWithin(");
  });
});
