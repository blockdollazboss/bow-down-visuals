/**
 * DiscordAnnounceModal (announce a drop to Discord) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE ANNOUNCE POST was already honest: non-ok throws the
 *   server's message, and the sent state + toast land only
 *   on an ok response.
 * - FIX (this tranche): THE STATUS READ dressed a failure
 *   as a fact about the member's account. A non-ok read set
 *   configured = false, and the modal then asserted "No
 *   Discord webhook connected yet. Connect one in Settings"
 *   and hid the announce form entirely — for a member whose
 *   webhook may well be connected (the sibling settings card
 *   proves the same read can fail while a webhook exists).
 *   A thrown read was inconsistent on top: it left the form
 *   open. The read now lands on a dedicated statusFailed
 *   state on BOTH non-ok and throw, rendering a couldn't-
 *   check line with a retry (retryNonce re-runs the read),
 *   and neither the not-connected warning nor the form
 *   renders until the status is proven.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DiscordAnnounceModal.tsx");

describe("the announce post claims sent only on an ok response", () => {
  it("non-ok throws the server's message before any sent state", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t post to Discord."));');
    expect(src).toContain("setSent(true);");
  });
});

describe("FIX: a failed status read is a couldn't-check state, not 'not connected'", () => {
  it("non-ok and thrown reads both land on statusFailed", () => {
    expect(src).toContain("const [statusFailed, setStatusFailed] = useState(false);");
    expect(src).toContain("setStatusFailed(true);");
    expect(src).toContain("setStatusFailed(false);");
    expect(src).not.toContain("setConfigured(false);");
  });

  it("neither the warning nor the form renders until the status is proven", () => {
    expect(src).toContain("{statusFailed && (");
    expect(src).toContain("{!statusFailed && configured === false && (");
    expect(src).toContain("{!statusFailed && configured !== false && (");
    expect(src).toContain("Couldn&apos;t check your Discord connection");
    expect(src).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});
