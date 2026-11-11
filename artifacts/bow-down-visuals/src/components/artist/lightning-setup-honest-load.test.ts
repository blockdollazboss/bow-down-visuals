/**
 * lightning-setup — honest load standard (deep-pins
 * tranche 5). PINNED POST-FIX. The slug check is a state
 * machine (idle / checking / ok / taken / invalid) and
 * Continue is gated on slugState === "ok" exactly, so a
 * check that proves nothing can never read as "available":
 * the catch falls back to idle. THE FIX (this tranche): a
 * non-ok response used to fall through to the verdict logic,
 * where a JSON error body (no valid / available fields)
 * painted "taken" — a definitive verdict from a failed
 * check. !ok now returns to idle like the catch. An invalid
 * slug shows the server's real reason instead of "taken".
 * Going live: the LIVE step renders only after createProfile
 * resolves on either path (instant or AI); failures toast
 * and the step never advances. The Vault prefill is a
 * documented best-effort (its failure leaves the form
 * empty, never a fake prefill).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./lightning-setup.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the slug check — unknown never reads as a verdict", () => {
  it("checking is set before the fetch; !ok and throws fall back to idle; invalid carries the server's reason", () => {
    const body = slice(src, "/* ── Live slug availability check (debounced). ── */", "const suggestSlug = () => {");
    expect(body).toContain('setSlugState("checking");');
    expect(body).toContain('if (!res.ok) { setSlugState("idle"); return; }');
    expect(body).toContain("if (data.valid === false) {");
    expect(body).toContain('setSlugState("invalid");');
    expect(body).toContain('setSlugError(typeof data.error === "string" ? data.error : "That link can\'t be used.");');
    expect(body).toContain('setSlugState(data.available ? "ok" : "taken");');
    const catchPart = slice(body, "} catch {", "}, 400);");
    expect(catchPart).toContain('setSlugState("idle");');
    expect(catchPart).not.toContain("taken");
    expect(body.indexOf('setSlugState("checking");')).toBeLessThan(body.indexOf("if (!res.ok) {"));
    expect(body.indexOf("if (!res.ok) {")).toBeLessThan(body.indexOf("if (data.valid === false) {"));
  });

  it("Continue requires the ok state exactly — idle, checking, taken and invalid all block it", () => {
    expect(src).toContain('const canContinueStep0 = name.trim().length >= 2 && slugState === "ok";');
    expect(src).toContain('const [slugState, setSlugState] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");');
  });
});

describe("going live — the LIVE step exists only after a resolved create", () => {
  it("instant path: setLive + setStep(2) sit after the await; failure toasts in place", () => {
    const body = slice(src, "async function goLiveInstant() {", "/* AI path (default):");
    expect(body).toContain("const p = await createProfile(");
    expect(body).toContain("setLive(p);");
    expect(body).toContain("setStep(2);");
    expect(body).toContain("onCreated(p);");
    expect(body.indexOf("const p = await createProfile(")).toBeLessThan(body.indexOf("setLive(p);"));
    const catchPart = slice(body, "} catch (err) {", "} finally {");
    expect(catchPart).toContain('toast({ title: "Couldn\'t go live", description: plainErrorText(err, "Try again.") });');
    expect(catchPart).not.toContain("setStep");
  });

  it("AI path: a non-ok design response throws before createProfile can run", () => {
    const body = slice(src, "async function goLiveWithAi() {", "async function saveDesign()");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Design failed"));');
    expect(body).toContain("const p = await createProfile(");
    expect(body.indexOf('if (!res.ok) throw new Error(apiErrorMessage(data, "Design failed"));')).toBeLessThan(
      body.indexOf("const p = await createProfile("),
    );
  });

  it("the Vault prefill is best-effort by comment and by catch", () => {
    expect(src).toContain("} catch { /* vault is best-effort prefill */ }");
  });
});
