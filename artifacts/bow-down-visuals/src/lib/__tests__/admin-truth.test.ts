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

/**
 * C2 — the plan-tier card claimed the control caps Creator Level
 * stars ("tier 1 gets 1 star, tier 6 gets all 6", all ten catalogs).
 * It does not and cannot: Creator Level stars are EARNED rank (owner
 * ruling 2026-10-17) — lib/creator-rank's hard rule is that no source
 * counts plan tier, and lib/platform-fees states it outright: "The
 * ladder number is a plan record, not a rank — Creator Level stars
 * are earned separately and no tier moves them." What plan/set really
 * writes is profiles.plan_tier, which tier gates read as free/pro/
 * elite. The card copy, the success message, the floating panel, and
 * the route header now say exactly that.
 *
 * NOTE on translations: the corrected planDescription /
 * planSetMessage values in the nine non-English catalogs are
 * AGENT-DRAFTED and UNREVIEWED (standing practice — English is final;
 * a human review pass owns the rest). No money copy is involved.
 */
const FALSE_PLAN_DESCRIPTIONS = [
  "A user's plan tier caps their Creator Level stars — tier 1 gets 1 star, tier 6 gets all 6.",
  "El nivel de plan de un usuario limita sus estrellas de Nivel de Creador — el nivel 1 obtiene 1 estrella, el nivel 6 obtiene las 6.",
  "Le niveau d'abonnement d'un utilisateur plafonne ses étoiles de Creator Level — le niveau 1 obtient 1 étoile, le niveau 6 les 6.",
  "Die Plan-Stufe begrenzt die Creator-Level-Sterne eines Nutzers – Stufe 1 erhält 1 Stern, Stufe 6 alle 6.",
  "Il livello del piano limita le stelle del Creator Level — il livello 1 ottiene 1 stella, il livello 6 tutte e 6.",
  "O nível do plano de um usuário limita as estrelas do Creator Level dele — nível 1 tem 1 estrela, nível 6 tem as 6.",
  "مستوى خطة المستخدم يحدد نجوم مستوى المبدع — المستوى 1 يحصل على نجمة واحدة، والمستوى 6 يحصل على الست.",
  "उपयोगकर्ता का प्लान टियर उनके Creator Level स्टार्स को सीमित करता है — टियर 1 को 1 स्टार मिलता है, टियर 6 को सभी 6।",
  "ユーザーのプランティアがクリエイターレベルの星の上限を決めます——ティア1は1つ星、ティア6は6つ星すべてを獲得できます。",
  "사용자의 플랜 등급은 Creator Level 별 개수를 제한합니다 — 등급 1은 별 1개, 등급 6은 6개 모두 획득합니다.",
];

describe("C2 — the plan-tier card no longer claims it moves Creator Level stars", () => {
  it("the English description states the real effect and the earned-stars rule", () => {
    const desc = catalog("en")?.admin?.planDescription as string;
    expect(desc).toContain("plan ladder");
    expect(desc).toContain("earned");
    expect(desc).not.toContain("caps their Creator Level");
  });

  it("no catalog still carries the false star-cap description", () => {
    for (const loc of LOCALES) {
      const desc = catalog(loc)?.admin?.planDescription as string;
      expect(FALSE_PLAN_DESCRIPTIONS, loc).not.toContain(desc);
    }
  });

  it("the English success message names a plan tier, not a rank assignment", () => {
    const msg = catalog("en")?.admin?.planSetMessage as string;
    expect(msg).toContain("plan tier");
  });

  it("the API route header no longer claims a star cap either", () => {
    const adminRoute = read("../../../../api-server/src/routes/admin.ts");
    expect(adminRoute).not.toContain("caps Creator Level at N stars");
    expect(adminRoute).toContain("no tier moves them");
  });

  it("the earned-rank rail itself never reads plan tier (the claim had no mechanism)", () => {
    const rank = read("../../../../api-server/src/lib/creator-rank.ts");
    expect(rank).not.toContain("plan_tier");
    expect(rank).not.toContain("planTier");
    expect(rank).toContain("Rank is NEVER purchasable");
  });
});
