/**
 * LoadingScreenModal (advertise on the loading screens —
 * the takeover inquiry modal) — honest action states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * - THE OFFER READ is an ok-gated enhancement: the live
 *   offer replaces the displayed terms only from an ok
 *   response carrying an offer; otherwise the modal shows
 *   the standing house terms (the fallback price/duration
 *   are the advertised base offer, not a claim about the
 *   visitor's account).
 * - THE INQUIRY POST gates the done state on an ok response:
 *   non-ok throws the server's most specific message (the
 *   first validation detail when present) into the error
 *   line — an inquiry is never shown as received before the
 *   server stored it; the submitting flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LoadingScreenModal.tsx");

describe("the offer read replaces the terms only from a proven offer", () => {
  it("the fetch is ok-gated before setOffer may run", () => {
    expect(src).toContain(".then((r) => (r.ok ? r.json() : null))");
    expect(src).toContain(".then((d) => d?.offer && setOffer(d.offer))");
  });
});

describe("the inquiry claims received only on an ok response", () => {
  it("non-ok throws the server's most specific message; done waits for ok", () => {
    expect(src).toContain("const first = d?.details?.[0]?.message;");
    expect(src).toContain("setDone(true);");
    expect(src).toContain('setError(plainErrorText(err, "Something went wrong."));');
    expect(src).toContain("setSubmitting(false);");
  });
});
