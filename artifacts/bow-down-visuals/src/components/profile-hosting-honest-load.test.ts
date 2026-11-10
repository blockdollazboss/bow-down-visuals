/**
 * ProfileHosting — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The creator-pricing hosting card
 * derives every render from a phase machine fed by GET
 * /api/creator-hosting/me, and the outcomes never blur:
 *
 * - A 404 is the server's real verdict "no creator profile" and
 *   lands the phase on no-profile (its own honest surface); any
 *   other non-ok response AND any throw land on failed; only an ok
 *   response records the member view and lands on ready. The
 *   card's render kinds (through lib/profile-hosting-state's
 *   hostingCardState) put load-failed — a retry button that resets
 *   the phase and re-runs the real load — ahead of every plan
 *   surface, so a failed load can never paint a price or an
 *   entitlement.
 * - The public plan pitch read is additive BY DESIGN: it records
 *   only on ok and never blocks or poisons the /me read.
 * - The checkout-return poll is BUDGETED HONESTY: the "switching
 *   on" note shows only while the poll budget lasts; when the
 *   budget runs out without the entitlement landing, a terminal
 *   state with a manual re-check replaces it (the note never hangs
 *   forever) — and both notes vanish the moment an entitled state
 *   actually lands. The session id is never trusted as proof; only
 *   the /me read can show hosting active.
 *
 * Copy rides profileHosting.* keys; the pin carries the catalog
 * block for its failure keys. The FE suite runs in node (no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("./ProfileHosting.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("the /me load separates no-profile, failure, and ready", () => {
  it("the phase starts at loading", () => {
    expect(card).toContain('const [phase, setPhase] = useState<HostingLoadPhase>("loading");');
  });

  it("a 404 lands on the no-profile phase — a verdict, not a failure", () => {
    expect(card).toContain('if (res.status === 404) {\n        setPhase("no-profile");');
  });

  it("any other non-ok response and any throw land on failed", () => {
    expect(card).toContain('if (!res.ok) {\n        setPhase("failed");');
    expect(card).toContain('} catch {\n      setPhase("failed");');
  });

  it("only an ok response records the member view and lands on ready", () => {
    expect(card).toContain('setPhase("ready");');
    expect(card).toContain("setMe(data);");
  });

  it("the load-failed kind renders a retry that re-runs the real load", () => {
    expect(card).toContain('onClick={() => { setPhase("loading"); void loadMe(); }}');
    expect(card).toContain('t("profileHosting.loadFailed")');
  });
});

describe("the plan pitch read is additive and never poisons the /me read", () => {
  it("it records only on ok, under the file's own note", () => {
    expect(card).toContain("a failed\n     plan read never blocks the signed-in /me read.");
    expect(card).toContain("if (live && res.ok) {");
  });
});

describe("the checkout-return poll is budgeted — the pending note always lands somewhere honest", () => {
  it("the poll gives up after its budget and lands the terminal state", () => {
    expect(card).toContain("if (pollRef.current > 8) {");
    expect(card).toContain("setPollDone(true);");
  });

  it("the switching-on note shows only while the budget lasts", () => {
    expect(card).toContain('{returning && !pollDone && state.kind !== "hosting-active"');
    expect(card).toContain('t("profileHosting.switchingOn")');
  });

  it("the terminal state offers a manual re-check against the real read", () => {
    expect(card).toContain('t("profileHosting.switchingOnLate")');
    expect(card).toContain("onClick={() => { void loadMe(); }}");
  });

  it("only the /me read can clear the poll — the session id is never proof", () => {
    expect(card).toContain("if (fresh?.hostingEntitled) clearInterval(timer);");
    expect(card).toContain("The session id itself is never trusted as proof.");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the hosting honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["profileHosting.loadFailed", "profileHosting.checkoutDidntStart"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
