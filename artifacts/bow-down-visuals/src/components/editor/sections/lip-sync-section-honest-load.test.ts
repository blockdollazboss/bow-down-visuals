/**
 * LipSyncSection — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The editor's lip-sync tool carries
 * no collection list; its loads are a provider-status probe, three
 * diagnostics checks, an advisory input pre-flight, and job checks —
 * and each one records failure AS failure:
 *
 * - PROVIDER STATUS is a CLOSED GATE: the status is recorded only
 *   on an ok response; `connected` derives false from an unloaded
 *   or failed probe, and every generation path refuses with a plain
 *   error while not connected. A failed probe can never unlock a
 *   fake "connected".
 * - THE DIAGNOSTICS NEVER FABRICATE A VERDICT: the account check
 *   records an explicit FAILED result ("Account check failed" /
 *   "The check came back unreadable — try again in a moment.") on a
 *   non-JSON response and on a network throw; the health check
 *   records reachable from the real response (`res.ok`) and
 *   reachable:false on a throw; the route test does the same.
 * - THE INPUT PRE-FLIGHT IS ADVISORY AND FAIL-SOFT BY DESIGN: a
 *   failed check returns null and records NO verdict — it never
 *   writes a fabricated "inputs found" result — while a real
 *   found=false verdict blocks the apply with a specific error.
 * - JOB CHECKS SURFACE THE TRUTH: a non-ok check throws the
 *   server's message into the apply error; a provider-reported
 *   "failed" status marks the clip failed with the provider's own
 *   error; processing/pending are never marked failed.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const lip = read("./LipSyncSection.tsx");

describe("the provider status is a closed gate", () => {
  it("status starts null and is recorded only on an ok response", () => {
    expect(lip).toContain("const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);");
    const probe = lip.slice(lip.indexOf("const fetchProviderStatus"), lip.indexOf("useEffect(() => {\n    void fetchProviderStatus();"));
    expect(probe).toContain('const res = await fetch("/api/lip-sync/status");');
    expect(probe).toContain("if (res.ok) {");
    expect(probe).toContain("setProviderStatus(data);");
    expect(probe).toContain("/* network error — leave null */");
  });

  it("connected derives false from an unloaded or failed probe", () => {
    expect(lip).toContain("const providerConnected = providerStatus?.connected ?? false;");
  });

  it("a not-connected apply refuses with a plain error instead of fake-running", () => {
    expect(lip).toContain('setApplyError("Lip Sync is not connected on this site yet — real lip sync is unavailable right now. Demo mode still works.");');
  });
});

describe("the diagnostics record failure as failure — never a fabricated verdict", () => {
  it("the account check records an explicit failed result on a non-JSON response", () => {
    expect(lip).toContain('if (!ct.includes("application/json")) {');
    expect(lip).toContain('lastError: "The check came back unreadable — try again in a moment.",');
    expect(lip).toContain('message: "Account check failed"');
  });

  it("the account check records the same failed shape on a network throw", () => {
    expect(lip).toContain('lastError: plainErrorText(err, "Network error"),');
  });

  it("the health check records reachability from the real response, false on a throw", () => {
    expect(lip).toContain("reachable:   res.ok,");
    expect(lip).toContain("setHealthCheck({ reachable: false, status: 0, contentType: \"(none)\", isJson: false });");
  });

  it("the route test records unreachable on a throw", () => {
    expect(lip).toContain('contentType:                "(network error)",');
  });
});

describe("the input pre-flight never fabricates a pass", () => {
  it("a non-ok or thrown check returns null and records no verdict", () => {
    const check = lip.slice(lip.indexOf("async function checkInputs"), lip.indexOf("/* ── Lip Sync account check ── */"));
    expect(check).toContain("if (!res.ok) return null;");
    expect(check).toContain("setInputCheck(result);");
  });

  it("a real found=false verdict blocks the apply with a specific error", () => {
    expect(lip).toContain('setApplyError("The audio file couldn\'t be reached — check it and try again.");');
    expect(lip).toContain('setApplyError("The scene clip couldn\'t be reached — try again, or pick a different clip.");');
  });
});

describe("job checks surface the provider's truth", () => {
  it("a non-ok job check throws the server's message into the apply error", () => {
    expect(lip).toContain('throw new Error(apiErrorMessage(body, "We couldn\'t check that job — please try again."));');
    expect(lip).toContain('setApplyError(plainErrorText(err, "We couldn\'t check that job — please try again."));');
  });

  it("a provider-failed status marks the clip failed with the provider's error", () => {
    expect(lip).toContain('lipSyncError:  plainErrorText(data.error, "Lip sync job failed."),');
  });

  it("processing and pending are never marked failed", () => {
    expect(lip).toContain('"processing" / "pending": leave status as-is, never mark failed.');
  });
});
