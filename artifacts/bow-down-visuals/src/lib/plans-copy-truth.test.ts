/**
 * Plans copy truth (Stack-200 M3) — the catalog/pricing copy must sell
 * ONLY what the entitlement rails actually grant (owner's ruled model):
 *
 *  - Premium theme packs: two house packs free; each premium pack is
 *    1,000 Visual Bucs one-time, owned forever; ALL packs included with
 *    Creator Elite while subscribed. Pro does NOT include them —
 *    routes/theme-kit.ts kitUnlocked unlocks premium only by ownership
 *    or live Elite (pinned server-side in theme-kit.test.ts).
 *  - Custom domains ride the Hosting product: $9/mo standalone,
 *    INCLUDED with Creator Elite; POST /api/domains is gated on that
 *    entitlement (pinned server-side in domains-hosting-gate.test.ts).
 *    Pro does NOT include a domain.
 *  - Storefronts: no tier gate on opening a shop and no product cap
 *    exist in the rails, so the note beside the Open-your-shop CTA may
 *    not claim either.
 *
 * Money/price copy law: the English source ships verbatim in all 10
 * catalogs; the other locales are UNREVIEWED until a native pass.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CREATOR_PLANS } from "./pricing-plans";

function readFe(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}
import en from "../locales/en.json";
import es from "../locales/es.json";
import pt from "../locales/pt.json";
import fr from "../locales/fr.json";
import itCatalog from "../locales/it.json";
import de from "../locales/de.json";
import ar from "../locales/ar.json";
import hi from "../locales/hi.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";

const CATALOGS = [en, es, pt, fr, itCatalog, de, ar, hi, ja, ko] as any[];

const STOREFRONT_PLAN_NOTE = "Every creator can open a shop · 5% platform fee on sales";
const DOM_NONE =
  "No custom domains yet — your free subdomain above is yours, and it goes live when the site launches. Your own .com comes with the Hosting plan ($9/mo), or included free with Creator Elite.";

function plan(tier: string) {
  const p = CREATOR_PLANS.find((x) => x.tier === tier);
  if (!p) throw new Error(`plan ${tier} missing`);
  return p;
}

describe("plan catalog copy matches the entitlement rails", () => {
  it("Pro does not claim a custom domain — domains ride Hosting / Elite", () => {
    const pro = plan("pro");
    expect(pro.features.map((f) => f.label).join(" ")).not.toMatch(/custom domain/i);
    expect(pro.tagline).not.toMatch(/domain/i);
  });

  it("Pro does not claim unlimited products — no plan caps a shop", () => {
    const pro = plan("pro");
    expect(pro.features.map((f) => f.label).join(" ")).not.toMatch(/unlimited products/i);
    expect(pro.tagline).not.toMatch(/unlimited/i);
  });

  it("the premium-theme row states the ruled model: 1,000 VB each, owned forever, all included with Elite", () => {
    const pro = plan("pro");
    const row = pro.features.find((f) => /premium theme packs/i.test(f.label));
    expect(row).toBeTruthy();
    expect(row!.label).toContain("1,000 Visual Bucs");
    expect(row!.label).toMatch(/yours forever/i);
    expect(row!.label).toMatch(/included with Elite/i);
    // And it must not read as a Pro inclusion:
    expect(row!.label).not.toMatch(/^Premium gold-luxury themes$/);
  });

  it("Elite explicitly includes every premium theme pack and Profile Hosting", () => {
    const elite = plan("elite");
    const labels = elite.features.map((f) => f.label);
    expect(labels.some((l) => /All premium theme packs included/i.test(l))).toBe(true);
    expect(labels.some((l) => /Profile Hosting included/i.test(l))).toBe(true);
  });
});

describe("storefront plan note — no tier claim beside Open your shop", () => {
  it("every catalog carries the English source verbatim (money copy)", () => {
    for (const cat of CATALOGS) {
      expect(cat.storefronts.planNote).toBe(STOREFRONT_PLAN_NOTE);
    }
  });

  it("the note names no tier and keeps the flat 5% fee truth", () => {
    expect(STOREFRONT_PLAN_NOTE).not.toMatch(/Pro plan/i);
    expect(STOREFRONT_PLAN_NOTE).toContain("5% platform fee");
  });
});

describe("domain empty-state copy names the real unlock", () => {
  it("every catalog carries the English source verbatim (money copy)", () => {
    for (const cat of CATALOGS) {
      expect(cat.worldIdentityMisc.domNone).toBe(DOM_NONE);
    }
  });

  it("the copy names Hosting and Elite, and no longer promises a free claim", () => {
    expect(DOM_NONE).toContain("Hosting plan ($9/mo)");
    expect(DOM_NONE).toContain("Creator Elite");
    expect(DOM_NONE).not.toContain("one claim away");
  });

  it("join19 walk fix: the subdomain copy is honest while the site is unlaunched", () => {
    /* The free subdomain serves nothing until launch — the copy must
       not claim it is "already working", and must not promise a date. */
    expect(DOM_NONE).not.toContain("already working");
    expect(DOM_NONE).toContain("goes live when the site launches");
    expect(DOM_NONE).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});

describe("pricing page + guide copy carry no dead claims", () => {
  const pricingPage = readFe("pages/creator-pricing.tsx");
  const guide = readFe("guides/pricing.ts");
  const domainsPage = readFe("pages/creator-domains.tsx");

  it("the #feature-site anchor sells the Hosting / Elite domain, not Pro", () => {
    expect(pricingPage).not.toContain("Pro connects your own custom domain");
    /* Stack-300 A6: the price is no longer a typed copy — it rides
       GET /creator-hosting/plan via hostingPriceLabel. */
    expect(pricingPage).toContain("comes with the Hosting plan (${hostingPriceLabel}/mo)");
    expect(pricingPage).toContain("included free while you're Creator Elite");
  });

  it("the #feature-themes anchor states the pack model, not 'a Pro move'", () => {
    expect(pricingPage).not.toContain("are a Pro move");
    expect(pricingPage).toContain("Premium theme packs cost 1,000 Visual Bucs each");
    expect(pricingPage).toContain("included while you're Creator Elite");
  });

  it("the guide's Pro step drops the domain / unlimited / themes bundle", () => {
    expect(guide).not.toContain("adds your own custom domain, unlimited products");
    expect(guide).toContain("premium theme packs are 1,000 Visual Bucs each");
  });

  it("the domains page empty state matches the catalog truth", () => {
    expect(domainsPage).not.toContain("one claim away");
    expect(domainsPage).toContain("comes with the Hosting plan ($9/mo), or included free with Creator Elite");
  });
});
