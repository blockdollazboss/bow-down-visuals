/**
 * profile-hosting-door.test.ts — the Hosting door's wiring pins
 * (Stack-200 wave A5, money census item 5).
 *
 * The defect: Profile Hosting ($9/mo, included with Creator Elite) had
 * a complete API rail and ZERO frontend callers, and its checkout was
 * hosted-only. These pins hold the fix:
 *   - the card reads its state from GET /creator-hosting/me (and the
 *     public /plan for the signed-out pitch) — never invents state;
 *   - the buy action posts /creator-hosting/checkout and mounts the
 *     shared EmbeddedSessionCheckout on the clientSecret answer;
 *   - NO hosted navigation exists anywhere in the door (no checkout
 *     URL is ever followed — the buyer never leaves the site);
 *   - the buy button renders ONLY inside the "buy" state branch, so
 *     an Elite member (elite-included state) is never even offered
 *     the second charge the ruling forbids;
 *   - the card docks on /creator-pricing and the #feature-site anchor
 *     the plan's feature rows point at finally names the plan;
 *   - the copy lives in the profileHosting catalog namespace, and
 *     the money lines (price, Elite inclusion) sit ENGLISH VERBATIM
 *     in all 10 catalogs — the money-copy law: never agent-translated,
 *     figures by {{price}} / {{date}} interpolation, the nine non-en
 *     values UNREVIEWED as translations by design.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("./ProfileHosting.tsx");
const pricing = read("../pages/creator-pricing.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function catalog(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
}
const HOSTING_KEYS = [
  "heading", "tagline", "pricePerMonth", "includedWithEliteNote", "eliteActive",
  "adminActive", "hostingActive", "activeUntil", "renewsNote", "buyButton",
  "openingCheckout", "checkoutDidntStart", "notSwitchedOn", "noProfile",
  "signInPrompt", "loadFailed", "switchingOn", "cancelCheckout", "siteAnchorNote",
  /* Stack 300 (items 88/115/116): the manage door on the active card,
     the return-poll terminal state + its re-check, and the honest
     key-missing checkout state. */
  "switchingOnLate", "checkAgain", "manageButton", "manageDidntOpen",
  "checkoutUnavailable",
] as const;

describe("profile hosting door — reads the rail, buys embedded, never leaves the site", () => {
  it("reads state from /creator-hosting/me and the public /creator-hosting/plan", () => {
    expect(card).toContain('fetch("/api/creator-hosting/me"');
    expect(card).toContain('fetch("/api/creator-hosting/plan"');
    expect(card).toContain("hostingCardState(");
  });

  it("checkout posts to the rail and mounts the shared embedded checkout on the clientSecret", () => {
    expect(card).toContain('postJsonWithTransportRetry("/api/creator-hosting/checkout"');
    expect(card).toContain('import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout"');
    expect(card).toContain("<EmbeddedSessionCheckout clientSecret={clientSecret} />");
    expect(card).toContain("data.clientSecret");
  });

  it("no hosted navigation: no checkout URL is ever read or followed", () => {
    expect(card).not.toContain("checkoutUrl");
    expect(card).not.toContain("data.url");
    expect(card).not.toMatch(/window\.location\.href\s*=\s*data\./);
    /* The only full-page navigation the card performs is the
       signed-out bounce to the site's own login, context intact. */
    expect(card).toContain('loginPathWithNext("/creator-pricing")');
  });

  it("the buy button exists ONLY inside the buy-state branch (Elite is never offered a charge)", () => {
    const buyBranch = card.slice(card.indexOf('{state.kind === "buy" && !clientSecret && ('));
    expect(buyBranch).toContain('t("profileHosting.buyButton"');
    const eliteBranch = card.slice(
      card.indexOf('{state.kind === "elite-included" && ('),
      card.indexOf('{state.kind === "admin-entitled" && ('),
    );
    expect(eliteBranch).toContain('t("profileHosting.eliteActive")');
    expect(eliteBranch).not.toContain("buyButton");
    expect(eliteBranch).not.toContain("startCheckout");
  });

  it("the return from embedded checkout polls /me instead of trusting the session id", () => {
    expect(card).toContain('params.get("hosting") !== "return"');
    expect(card).toContain('t("profileHosting.switchingOn")');
    expect(card).toContain("loadMe()");
  });

  it("docks on /creator-pricing, and the #feature-site anchor names the plan", () => {
    expect(pricing).toContain('import ProfileHosting from "@/components/ProfileHosting"');
    expect(pricing).toContain("<ProfileHosting isLight={isLight} />");
    const anchor = pricing.slice(pricing.indexOf('id="feature-site"'), pricing.indexOf('id="feature-streaming"'));
    /* Stack-300 A6: the anchor's price rides GET /creator-hosting/plan
       (the same DTO the card reads) — no typed { price: 9 } copy. */
    expect(pricing).toContain('fetch("/api/creator-hosting/plan")');
    expect(anchor).toContain('t("profileHosting.siteAnchorNote", { price: hostingPriceLabel })');
    expect(anchor).not.toContain("{ price: 9 }");
    expect(anchor).toContain('href="#profile-hosting"');
    expect(card).toContain('id="profile-hosting"');
  });
});

describe("profile hosting — Stack 300 tails (manage door, poll terminal, key-missing state)", () => {
  it("the active card carries the manage door: portal POST, opened in a new tab (item 88)", () => {
    expect(card).toContain('fetch("/api/creator-tiers/portal"');
    expect(card).toContain('window.open(payload.url, "_blank", "noopener,noreferrer")');
    const activeBranch = card.slice(
      card.indexOf('{state.kind === "hosting-active" && ('),
      card.indexOf('{state.kind === "not-switched-on" && ('),
    );
    expect(activeBranch).toContain('t("profileHosting.manageButton")');
    expect(activeBranch).toContain("openManage()");
  });

  it("the return poll lands in a terminal state with a manual re-check (item 115)", () => {
    expect(card).toContain("setPollDone(true)");
    expect(card).toContain('t("profileHosting.switchingOnLate")');
    expect(card).toContain('t("profileHosting.checkAgain")');
    /* The live "switching on" note yields once the budget is spent. */
    expect(card).toContain("returning && !pollDone");
  });

  it("the key-missing checkout state is honest and makes no retry promise (item 116)", () => {
    const embBranch = card.slice(card.indexOf("hasStripePublishableKey() ? ("));
    expect(embBranch).toContain('t("profileHosting.checkoutUnavailable")');
    expect(embBranch).not.toContain('t("profileHosting.checkoutDidntStart")');
  });
});

describe("profile hosting copy — money lines are English verbatim in all 10 catalogs", () => {
  const en = catalog("en")["profileHosting"] as Record<string, string>;

  it("en carries the full 24-key set with the ruled figures by interpolation", () => {
    expect(Object.keys(en).sort()).toEqual([...HOSTING_KEYS].sort());
    expect(en["pricePerMonth"]).toBe("${{price}}/month");
    expect(en["buyButton"]).toContain("${{price}}");
    expect(en["siteAnchorNote"]).toContain("${{price}}");
    expect(en["includedWithEliteNote"]).toMatch(/Included with Creator Elite/);
    expect(en["activeUntil"]).toContain("{{date}}");
  });

  it.each(LOCALES)("%s carries every key, money lines byte-identical to the en source", (locale) => {
    const cat = catalog(locale)["profileHosting"] as Record<string, string>;
    expect(cat, `${locale} is missing the profileHosting namespace`).toBeTruthy();
    for (const k of HOSTING_KEYS) {
      expect(typeof cat[k], `${locale}.profileHosting.${k} missing`).toBe("string");
      expect(cat[k]!.trim().length, `${locale}.profileHosting.${k} empty`).toBeGreaterThan(0);
      /* Money-copy law: the whole door copy set is the English
         source verbatim in every catalog — never agent-translated. */
      expect(cat[k], `${locale}.profileHosting.${k} drifted from the en source`).toBe(en[k]);
    }
  });
});
