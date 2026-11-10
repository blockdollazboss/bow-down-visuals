/**
 * FloatingAdminPanel — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The admin quick-actions panel floats
 * over every page for the owner account. Its loads are an admin gate
 * probe and one config record; everything else is action POSTs.
 *
 * The gate is FAIL-CLOSED by design: GET /api/admin/status must
 * answer ok with isAdmin === true or the panel renders nothing —
 * any failure (non-ok, network, signed-out) reads as "not an admin",
 * never as a panel full of defaults. The bow-race section's config
 * load throws on non-ok and records a ✗ message; its form renders
 * only after a successful load, and while unloaded it shows the
 * loading line with the failure message beneath it — a failed load
 * never dresses up as saved settings. The 30s live-count poll keeps
 * the last known count on failure (a refresh keeping prior data, the
 * same shape the World directory pin blesses), it never zeroes it.
 * Every action POST rides authedFetch, which throws on non-ok, and
 * every handler records the failure in its own message line.
 *
 * Copy is hardcoded English literals; no catalog block. The FE suite
 * runs in node (no DOM), so these tests pin the machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./floating-admin-panel.tsx");

describe("the admin gate is fail-closed — a failed probe never opens the panel", () => {
  it("admin is granted only on an ok response whose body says isAdmin === true", () => {
    expect(panel).toContain('const res = await fetch("/api/admin/status", {');
    expect(panel).toContain("if (!cancelled) setIsAdmin(res.ok && status.isAdmin === true);");
  });

  it("a failed probe records not-admin in the catch", () => {
    expect(panel).toContain("if (!cancelled) setIsAdmin(false);");
  });

  it("the panel renders nothing until the server says true", () => {
    expect(panel).toContain("if (isAdmin !== true) return null;");
  });
});

describe("the bow-race config load — failure never renders as saved settings", () => {
  it("the loader throws on a non-ok response", () => {
    expect(panel).toContain('const res = await fetch("/api/admin/bow-challenge", {');
    expect(panel).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, `Failed (${res.status})`));");
  });

  it("the catch records the failure message and loaded stays false", () => {
    expect(panel).toContain('setMsg(`✗ ${plainErrorText(e, "Failed to load.")}`);');
    expect(panel).toContain("const [loaded, setLoaded] = useState(false);");
    expect(panel).toContain("setLoaded(true);");
  });

  it("the unloaded branch shows the loading line AND the failure message", () => {
    expect(panel).toContain("if (!loaded) {");
    expect(panel).toContain("Loading race...");
    expect(panel).toContain('{msg && <p className="text-[10px] mt-1 text-red-400/80 break-words">{msg}</p>}');
  });

  it("the live-count poll keeps the last known count on failure instead of zeroing it", () => {
    expect(panel).toContain("if (!res.ok || cancelled) return;");
    expect(panel).toContain("/* keep last known count on poll failure */");
  });
});

describe("action posts surface their failures in their own message lines", () => {
  it("the shared action fetch throws on a non-ok response", () => {
    expect(panel).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Request failed."));');
  });

  it("handlers record failures instead of reporting success", () => {
    expect(panel).toContain('setTierMsg(`✗ ${plainErrorText(e, "Failed.")}`);');
    expect(panel).toContain('setCreditMsg(`✗ ${plainErrorText(e, "Failed.")}`);');
    expect(panel).toContain('setFriendMsg(`✗ ${plainErrorText(e, "Failed.")}`);');
  });
});
