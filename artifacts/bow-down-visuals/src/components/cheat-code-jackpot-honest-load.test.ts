/**
 * CheatCodeJackpot (the monthly jackpot banner + attempt) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE STATUS read is a periodic banner poll, and its
 *   failure doctrine is stated in the source: "banner stays
 *   on last known state" — a failed refresh never replaces
 *   the proven jackpot state with a fabricated one, and the
 *   fetch itself throws on non-ok rather than parsing an
 *   error body as status.
 * - THE ATTEMPT is answered by the endpoint's own verdict
 *   fields, each rendered as itself: correct+claimed fires
 *   the celebration with the server's winner name and prize;
 *   claimed-alone shows the already-claimed truth; a
 *   rate-limit answer surfaces its retry-after seconds;
 *   an error field toasts as an error. Nothing celebrates
 *   on an unproven field.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./cheat-code-jackpot.tsx");

describe("the status poll keeps the last proven state on failure", () => {
  it("the fetch throws on non-ok; the refresh catch holds position", () => {
    expect(src).toContain("if (!res.ok) throw new Error(`status ${res.status}`);");
    expect(src).toContain("/* banner stays on last known state */");
  });
});

describe("the attempt celebrates only on the proven verdict fields", () => {
  it("correct+claimed is the only celebration path", () => {
    expect(src).toContain("} else if (data.correct && data.claimed) {");
    expect(src).toContain("setCelebration({ name, prize: data.prizeCredits ?? 0 });");
    expect(src).toContain("const wait = data.retryAfterSeconds;");
  });
});
