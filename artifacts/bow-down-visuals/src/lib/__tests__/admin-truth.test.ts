/**
 * Admin truth pins (stack1100 lane W6).
 *
 * The /admin surfaces are the owner's daily instruments: every label
 * that names a rail must name the rail that actually runs.
 *
 * C1 — the grant card's log note quoted the ledger action
 * "Admin Visual Buc Grant" in all ten catalogs. No such action exists:
 * POST /api/admin/credits/grant writes the strict-ledger row with the
 * action string "Admin Credit Grant" (routes/admin.ts) and the ledger
 * read-back matches on that exact string (lib/credits.ts). An owner
 * searching his ledger for the note's quoted name found nothing. The
 * note now quotes the literal identifier in every catalog (the
 * identifier itself is never translated — ledger strings are literal;
 * the surrounding prose is untouched).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const catalog = (loc: string) => readJson(`../../locales/${loc}.json`);

describe("C1 — the grant log note quotes the ledger's real action name", () => {
  it("every catalog's grantLogNote names \"Admin Credit Grant\"", () => {
    for (const loc of LOCALES) {
      const note = catalog(loc)?.admin?.grantLogNote as string | undefined;
      expect(note, `${loc} grantLogNote missing`).toBeTruthy();
      expect(note).toContain("Admin Credit Grant");
    }
  });

  it("no catalog anywhere still quotes the phantom \"Admin Visual Buc Grant\"", () => {
    for (const loc of LOCALES) {
      expect(read(`../../locales/${loc}.json`), loc).not.toContain("Admin Visual Buc Grant");
    }
  });

  it("the server's grant rail really writes that action string", () => {
    const adminRoute = read("../../../../api-server/src/routes/admin.ts");
    expect(adminRoute).toContain('action: "Admin Credit Grant"');
  });
});
