/**
 * F1 (wave-3 tutorial lane find, fixed at the Stack-100 #3 join):
 * the Make Song form's footnote said "100 Visual Bucs per generation"
 * while its own buttons AND the server rail charge 400. The display
 * moved to the rail — never the reverse. This pin holds all three
 * surfaces together: the footnote (every catalog), the button badge,
 * and the charge in api-server/src/routes/generate/song.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "hi", "ar"];

describe("make-song price: footnote == button == rail (400 VB)", () => {
  it("every catalog's footnote states 400, never 100", () => {
    for (const loc of LOCALES) {
      const json = JSON.parse(read(`../locales/${loc}.json`)) as {
        makeSong: { usesCredits: string };
      };
      expect(json.makeSong.usesCredits, loc).toContain("400");
      expect(json.makeSong.usesCredits, loc).not.toMatch(/\b100\b/);
    }
  });

  it("the form's buttons badge 400 next to the footnote", () => {
    const page = read("../pages/make-song.tsx");
    expect(page).toContain('t("makeSong.usesCredits")');
    expect(page).toContain("<CostBadge cost={400}");
  });

  it("the server rail charges exactly CREDIT_COST = 400", () => {
    const rail = read("../../../api-server/src/routes/generate/song.ts");
    expect(rail).toContain("const CREDIT_COST = 400;");
    expect(rail).toContain('chargeCredits(req.userId!, CREDIT_COST, { action: "Make a Song" })');
  });
});
