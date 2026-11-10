/**
 * SponsorCreatorSection — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The public profile's
 * sponsorship section loads the creator's sponsor quote (fee split)
 * and then runs an escrow payment on the embedded rail. Its
 * contract:
 *
 * - THE QUOTE is a full machine: a non-ok response throws into the
 *   quoteError flag; the render runs error (with a retry that
 *   clears the flag and bumps the reload nonce) BEFORE the loading
 *   line BEFORE any quote-derived surface. Every figure the form
 *   shows — the creator's keep %, the platform fee %, the split
 *   preview — derives from the LOADED quote, never from constants,
 *   so a failed load can never present invented fee terms.
 * - THE PAYMENT narrates each stage truthfully: a card error is
 *   the card error; an incomplete payment says "no charge was
 *   settled"; a settled payment whose escrow verify fails says
 *   exactly that — the money moved, settling failed, it reconciles
 *   automatically — instead of claiming either success or a clean
 *   failure; the catch-all sends the sponsor to check their
 *   dashboard before trying again rather than inviting a blind
 *   double-charge retry.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sec = read("./SponsorCreatorSection.tsx");

describe("the quote load — fee terms exist only behind a loaded quote", () => {
  it("quote starts null with the error flag down", () => {
    expect(sec).toContain("const [quote, setQuote] = useState<SponsorQuote | null>(null);");
    expect(sec).toContain("const [quoteError, setQuoteError] = useState(false);");
  });

  it("a non-ok quote response throws; the catch raises the error flag", () => {
    expect(sec).toContain('if (!res.ok) throw new Error("quote failed");');
    expect(sec).toContain("if (!cancelled) setQuoteError(true);");
  });

  it("render order: error with retry, then loading, then quote surfaces", () => {
    const errIdx = sec.indexOf("Sponsorship couldn't load right now.");
    const loadIdx = sec.indexOf("Loading sponsorship…");
    const formIdx = sec.indexOf("You set the amount. It sits in escrow until");
    expect(errIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(errIdx);
    expect(formIdx).toBeGreaterThan(loadIdx);
  });

  it("the retry clears the flag and re-runs the load through the nonce dep", () => {
    expect(sec).toContain("onClick={() => { setQuoteError(false); setReloadNonce((n) => n + 1); }}");
    expect(sec).toContain("}, [user, slug, reloadNonce, funded]);");
  });

  it("the split preview derives from the loaded quote's feeBps", () => {
    expect(sec).toContain("sponsorSplitPreview(amountCents, quote.feeBps)");
  });
});

describe("the escrow payment narrates each stage truthfully", () => {
  it("an incomplete payment says no charge was settled", () => {
    expect(sec).toContain('onError("Payment didn\'t complete — no charge was settled. Try again.");');
  });

  it("a settled payment with a failed escrow verify says exactly that", () => {
    expect(sec).toContain('onError(data.error || "Your payment went through but settling the escrow failed — it reconciles automatically; check your sponsor dashboard.");');
  });

  it("the catch-all sends the sponsor to check before any retry", () => {
    expect(sec).toContain('onError("Something went wrong confirming that payment — check your sponsor dashboard before trying again.");');
  });

  it("the funded surface shows only after the verify succeeded", () => {
    expect(sec).toContain('data-testid="sponsor-funded"');
    expect(sec).toContain("onFunded();");
  });
});
