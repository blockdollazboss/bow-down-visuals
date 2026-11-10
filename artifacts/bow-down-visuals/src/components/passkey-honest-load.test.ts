/**
 * Passkey (PasskeyManager + the login/register buttons) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - THE CREDENTIAL LIST was already the family shape: loading →
 *   loadError → empty → list, with the Retry button re-running the
 *   load through refreshNonce, and the loader's own comment
 *   recording the rule ("A failed load is NOT 'no passkeys yet'").
 *   On failure the list is cleared AND the flag set, and the render
 *   checks the flag before the empty branch.
 * - THE LOGIN AND REGISTER FLOWS check every step: options must be
 *   ok, a credential must actually come back, verify must be ok
 *   AND carry success (login also demands the action link and a
 *   clean OTP exchange) — "Passkey registered!" renders only after
 *   the verify answer is proven.
 *
 * FINDING + FIX IN THIS LANE: PasskeyManager.remove() awaited the
 * DELETE and never looked at the response — a 500 (or a missing
 * token, which returned silently) bumped the refresh nonce anyway,
 * so the key simply stayed in the reloaded list with no word to
 * the user: a silent failure on a security action. The delete now
 * throws on a missing token or a non-ok response into a deleteError
 * line ("That passkey couldn't be removed — it's still active"),
 * and the list refresh happens only on ok.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pk = read("./Passkey.tsx");

const load = pk.slice(pk.indexOf("async function load()"), pk.indexOf("const remove = async"));
const remove = pk.slice(pk.indexOf("const remove = async"), pk.indexOf("/* Hooks must all run before any conditional return (Rules of Hooks). */\n  if (!supported) return null;\n\n  return (\n    <div className={`rounded-2xl border p-6"));

describe("the credential list: failure is its own state, never an empty list", () => {
  it("a non-ok response throws before the body is trusted; success records the keys", () => {
    expect(load).toContain('const res = await fetch("/api/auth/webauthn/credentials", {');
    expect(load).toContain('if (!res.ok) throw new Error("load failed");');
    expect(load.indexOf('throw new Error("load failed")')).toBeLessThan(load.indexOf("setKeys(data.credentials ?? []);"));
  });

  it("failure clears the list AND sets the flag; a fresh load clears a stale flag", () => {
    expect(load).toContain("setKeys([]);");
    expect(load).toContain("setLoadError(true);");
    expect(load).toContain("setLoadError(false);");
    expect(pk).toContain('A failed load is NOT "no passkeys yet"');
  });

  it("render order: loading, error + retry, genuine empty, list", () => {
    const loadIdx = pk.indexOf("Loading passkeys...");
    const errIdx = pk.indexOf("Couldn't load your passkeys — check your connection and try again.");
    const emptyIdx = pk.indexOf("No passkeys yet. Add one below.");
    expect(loadIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeGreaterThan(loadIdx);
    expect(emptyIdx).toBeGreaterThan(errIdx);
  });

  it("the retry re-runs the real load through the nonce the effect depends on", () => {
    expect(pk).toContain("onClick={() => setRefreshNonce((n) => n + 1)}");
    expect(pk).toContain("}, [refreshNonce]);");
  });
});

describe("remove: a failed delete says so (fixed in this lane)", () => {
  it("a missing token or a non-ok response throws before any refresh", () => {
    expect(remove).toContain('if (!token) throw new Error("missing token");');
    expect(remove).toContain('if (!res.ok) throw new Error("delete failed");');
    expect(remove.indexOf('throw new Error("delete failed")')).toBeLessThan(remove.indexOf("setRefreshNonce((n) => n + 1);"));
  });

  it("failure lands in the delete error line above the list", () => {
    expect(remove).toContain("setDeleteError(true);");
    expect(pk).toContain("{deleteError && (");
    expect(pk).toContain("That passkey couldn&rsquo;t be removed — it&rsquo;s still active. Try again.");
    expect(pk.indexOf("{deleteError && (")).toBeLessThan(pk.indexOf("Loading passkeys..."));
  });

  it("a fresh attempt clears the old failure first", () => {
    expect(remove).toContain("setDeleteError(false);");
  });
});

describe("the login and register flows check every step — unchanged", () => {
  it("login demands ok options, a real credential, and a proven verify before success", () => {
    expect(pk).toContain('if (!optRes.ok) throw new Error(apiErrorMessage(options, "Failed to start"));');
    expect(pk).toContain('if (!credential) throw new Error("No credential returned");');
    expect(pk).toContain("if (!verifyRes.ok || !result.success || !result.actionLink) {");
    expect(pk).toContain('if (otpError) throw new Error("Could not establish session");');
    expect(pk.indexOf("if (otpError) throw")).toBeLessThan(pk.indexOf("onSuccess();"));
  });

  it("register shows its success line only after a proven verify", () => {
    expect(pk).toContain("if (!verifyRes.ok || !result.success) {");
    expect(pk).toContain('throw new Error(apiErrorMessage(result, "Registration failed"));');
    expect(pk.indexOf("if (!verifyRes.ok || !result.success) {")).toBeLessThan(pk.indexOf("setDone(true);"));
    expect(pk).toContain("Passkey registered!");
  });
});
