/**
 * ConnectPayoutCard — honest LOAD states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The card's door contract (mounting,
 * the four server states, copy honesty) carries its own suite
 * (connect-payout-card.test.ts); this pin covers the load machine
 * underneath it:
 *
 * - The status load separates THREE outcomes that must never blur:
 *   a 404 is the server's real verdict "no creator profile" and
 *   gets its own honest surface (data-testid
 *   "connect-payout-noprofile") with the setup door; any other
 *   non-ok response THROWS into the failure surface
 *   ("connect-payout-failed", "Couldn't load — try again") whose
 *   retry re-runs the real load; an ok response records the status.
 *   Until one of those lands, the card shows its loading surface —
 *   a failed load can never render as "connect your bank" or as a
 *   $0 balance.
 * - Payout HISTORY is additive BY DESIGN: it records only on its
 *   own ok response, and its failure never takes the card down
 *   ("a history failure never takes the card down").
 * - The actions surface their failures with the server's own
 *   words: onboarding refuses without a URL, and a payout refusal
 *   carries Stripe's first action-needed reason.
 *
 * Copy is literal on this surface. The FE suite runs in node (no
 * DOM), so these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("./ConnectPayoutCard.tsx");

describe("the status load separates no-profile, failure, and loaded", () => {
  it("status starts null with the failed flag down", () => {
    expect(card).toContain("const [status, setStatus] = useState<ConnectStatusRead | null>(null);");
    expect(card).toContain("const [failed, setFailed] = useState(false);");
    expect(card).toContain("const [noProfile, setNoProfile] = useState(false);");
  });

  it("a 404 is the no-profile verdict — its own surface, not a failure", () => {
    expect(card).toContain("if (res.status === 404) { setNoProfile(true); return; }");
    expect(card).toContain('data-testid="connect-payout-noprofile"');
  });

  it("any other non-ok response throws with its status", () => {
    expect(card).toContain("if (!res.ok) throw new Error(`connect status failed (${res.status})`);");
  });

  it("the effect turns a thrown load into the failed surface", () => {
    expect(card).toContain("load().catch(() => { if (!cancelled) setFailed(true); });");
    expect(card).toContain('data-testid="connect-payout-failed"');
  });

  it("the failed surface's retry re-runs the real load", () => {
    expect(card).toContain("onClick={() => { setFailed(false); load().catch(() => setFailed(true)); }}");
  });

  it("until a verdict lands, the card shows its loading surface", () => {
    expect(card).toContain('data-testid="connect-payout-loading"');
    expect(card).toContain("Loading your payout setup…");
  });
});

describe("history is additive — its failure never takes the card down", () => {
  it("history records only on its own ok response, under the file's own note", () => {
    expect(card).toContain("/* History is additive — a history failure never takes the card down. */");
    expect(card).toContain("if (hres.ok) {");
    expect(card).toContain("} catch { /* the list just stays as it was */ }");
  });
});

describe("the actions surface the server's own reasons", () => {
  it("onboarding refuses when the response carries no URL", () => {
    expect(card).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, "Couldn\'t start payout setup."));');
  });

  it("a payout refusal appends Stripe's first action-needed reason", () => {
    expect(card).toContain("const reason = data.actionNeeded?.[0];");
    expect(card).toContain('throw new Error(apiErrorMessage(data, "Payout failed.") + (reason ? ` ${reason}` : ""));');
  });
});
