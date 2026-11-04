/**
 * shop-domain-desk.test.ts — Stack-100 #29: the SHOP's storefront
 * domain (connect + DNS verify + disconnect) at the Marketplace
 * stand, on the storefront-builder's domain rails.
 *
 * The contract under test:
 *  - the seam state comes from the shop's own /api/shops/mine
 *    record (custom_domain + domain_verified ride the DTO pair,
 *    kept only as a proven pair);
 *  - the three actions ride the website's own rails with the My
 *    Shop page's exact bodies — POST /api/storefronts/:id/domain
 *    { domain }, POST /api/storefronts/domain/verify { shopId },
 *    DELETE /api/storefronts/:id/domain;
 *  - the DNS instructions rendered are the RAIL's (the attach
 *    answer's host / token / step lines, verbatim), and the
 *    constants the stand falls back on match the rail's own;
 *  - verification is never faked: status is "verified" only from
 *    the record's own flag, a verify answer without a boolean is
 *    a failed check (null), and the section flips the record to
 *    verified in exactly one place — after the rail said so;
 *  - the flow is FREE: no credit-cost registry row exists for any
 *    of the three rails, and the section carries no spend seam;
 *  - a returning session's token is masked with the page's own
 *    remedy (reconnect for a fresh one), never invented;
 *  - detach is two-step in-world.
 *
 * Source pins (contract style): the API rail source itself is
 * read for the route paths, the host prefix, the CNAME target
 * and the absence of any charge on the domain handlers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SHOP_DOMAIN_CNAME_TARGET,
  SHOP_DOMAIN_VERIFY_HOST_PREFIX,
  buildShopDomainAttachBody,
  parseMineShops,
  parseShopDomainAttachResult,
  parseShopDomainVerifyResult,
  savedShopDto,
  shopDomainStatus,
  shopDomainVerifyHost,
} from "@/lib/world/shop-stands";
import { getCreditCost } from "@/lib/credit-costs";

const standsSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/native/ShopStands.tsx", import.meta.url)),
  "utf8",
);
const apiShopsSrc = readFileSync(
  fileURLToPath(new URL("../../../../api-server/src/routes/generate/shops.ts", import.meta.url)),
  "utf8",
);
const sectionStart = standsSrc.indexOf("function ShopDomainSection");
const sectionEnd = standsSrc.indexOf("function StandManager", sectionStart);
const sectionSrc = standsSrc.slice(sectionStart, sectionEnd);

describe("storefront domain — the shop record carries the pair (Stack-100 #29)", () => {
  it("parseMineShops keeps custom_domain + domain_verified from the mine row", () => {
    const shops = parseMineShops({
      shops: [
        { id: "s1", name: "Gold", handle: "gold", custom_domain: "shop.example.com", domain_verified: false },
        { id: "s2", name: "Live", handle: "live", custom_domain: "live.example.com", domain_verified: true },
        { id: "s3", name: "Plain", handle: "plain", custom_domain: null, domain_verified: false },
      ],
    });
    expect(shops[0]).toMatchObject({ custom_domain: "shop.example.com", domain_verified: false });
    expect(shops[1]).toMatchObject({ custom_domain: "live.example.com", domain_verified: true });
    expect(shops[2]).toMatchObject({ custom_domain: null, domain_verified: false });
  });

  it("a row without the pair (or with a half-pair of the wrong type) keeps neither — never a fabricated verified", () => {
    const shops = parseMineShops({
      shops: [
        { id: "s1", name: "Bare", handle: "bare" },
        { id: "s2", name: "Half", handle: "half", custom_domain: 42, domain_verified: true },
      ],
    });
    expect(shops[0]?.custom_domain).toBeUndefined();
    expect(shops[0]?.domain_verified).toBeUndefined();
    expect(shops[1]?.custom_domain).toBeUndefined();
    expect(shops[1]?.domain_verified).toBeUndefined();
  });

  it("savedShopDto keeps the pair too, so a settings save never drops the domain truth", () => {
    const saved = savedShopDto({
      shop: { id: "s1", name: "Gold", handle: "gold", custom_domain: "shop.example.com", domain_verified: true },
    });
    expect(saved?.mine).toMatchObject({ custom_domain: "shop.example.com", domain_verified: true });
  });
});

describe("storefront domain — the three states mirror the record, never optimism", () => {
  it("no domain on record is 'none' — even if a stray verified flag rides along", () => {
    expect(shopDomainStatus({})).toBe("none");
    expect(shopDomainStatus({ custom_domain: null })).toBe("none");
    expect(shopDomainStatus({ custom_domain: null, domain_verified: true })).toBe("none");
    expect(shopDomainStatus({ domain_verified: true })).toBe("none");
  });

  it("a domain without the record's verified flag is 'pending'", () => {
    expect(shopDomainStatus({ custom_domain: "shop.example.com" })).toBe("pending");
    expect(shopDomainStatus({ custom_domain: "shop.example.com", domain_verified: false })).toBe("pending");
  });

  it("only the record's own true flag is 'verified'", () => {
    expect(shopDomainStatus({ custom_domain: "shop.example.com", domain_verified: true })).toBe("verified");
  });
});

describe("storefront domain — the rails' own words and values", () => {
  it("the stand's constants are the rail's, read off the API source", () => {
    expect(apiShopsSrc).toContain(`const VERIFY_HOST_PREFIX = "${SHOP_DOMAIN_VERIFY_HOST_PREFIX}"`);
    expect(apiShopsSrc).toContain(`cnameTarget: "${SHOP_DOMAIN_CNAME_TARGET}"`);
    expect(SHOP_DOMAIN_VERIFY_HOST_PREFIX).toBe("bdv-verify");
    expect(SHOP_DOMAIN_CNAME_TARGET).toBe("cname.bowdownvisuals.com");
  });

  it("the TXT host is the rail's construction: prefix + domain", () => {
    expect(shopDomainVerifyHost("shop.example.com")).toBe("bdv-verify.shop.example.com");
  });

  it("the attach body is the page's exact shape — one trimmed domain key", () => {
    expect(buildShopDomainAttachBody("  shop.example.com ")).toEqual({ domain: "shop.example.com" });
    expect(Object.keys(buildShopDomainAttachBody("shop.example.com")!)).toEqual(["domain"]);
    expect(buildShopDomainAttachBody("")).toBeNull();
    expect(buildShopDomainAttachBody("   ")).toBeNull();
  });

  it("the attach answer parses verbatim — host, token and the rail's DNS lines ride through untouched", () => {
    const parsed = parseShopDomainAttachResult({
      domain: "shop.example.com",
      verified: false,
      verification: { type: "TXT", host: "bdv-verify.shop.example.com", value: "bdv-0123456789abcdef01234567" },
      dns: {
        step1: "Add a TXT record at host \"bdv-verify\" with the value above in your DNS provider (Cloudflare, GoDaddy, Namecheap…).",
        step2: "Add a CNAME record: host \"@\" (or \"shop\") → cname.bowdownvisuals.com — this points your domain at your storefront.",
        step3: "Come back here and hit \"Verify domain\". DNS can take a few minutes to propagate.",
        cnameTarget: "cname.bowdownvisuals.com",
      },
    });
    expect(parsed).toEqual({
      domain: "shop.example.com",
      verification: { type: "TXT", host: "bdv-verify.shop.example.com", value: "bdv-0123456789abcdef01234567" },
      dns: {
        step1: "Add a TXT record at host \"bdv-verify\" with the value above in your DNS provider (Cloudflare, GoDaddy, Namecheap…).",
        step2: "Add a CNAME record: host \"@\" (or \"shop\") → cname.bowdownvisuals.com — this points your domain at your storefront.",
        step3: "Come back here and hit \"Verify domain\". DNS can take a few minutes to propagate.",
        cnameTarget: "cname.bowdownvisuals.com",
      },
    });
  });

  it("an attach answer without an honest token or domain is no answer at all", () => {
    expect(parseShopDomainAttachResult(null)).toBeNull();
    expect(parseShopDomainAttachResult({})).toBeNull();
    expect(parseShopDomainAttachResult({ domain: "shop.example.com" })).toBeNull();
    expect(parseShopDomainAttachResult({ domain: "shop.example.com", verification: { host: "bdv-verify.shop.example.com", value: "" } })).toBeNull();
    expect(parseShopDomainAttachResult({ verification: { host: "h", value: "v" } })).toBeNull();
  });

  it("a sparse attach answer still carries the token; missing DNS lines read empty, the CNAME target defaults to the rail's", () => {
    const parsed = parseShopDomainAttachResult({
      domain: "shop.example.com",
      verification: { host: "bdv-verify.shop.example.com", value: "bdv-x" },
    });
    expect(parsed?.dns).toEqual({ step1: "", step2: "", step3: "", cnameTarget: SHOP_DOMAIN_CNAME_TARGET });
    expect(parsed?.verification.type).toBe("TXT");
  });

  it("the verify answer parses with its reason verbatim; a boolean-less answer is a failed check, never a pass", () => {
    expect(parseShopDomainVerifyResult({ domain: "shop.example.com", verified: true, reason: "verified" })).toEqual({
      domain: "shop.example.com",
      verified: true,
      reason: "verified",
    });
    expect(parseShopDomainVerifyResult({ domain: "shop.example.com", verified: false, reason: "No TXT record found at bdv-verify.shop.example.com yet — DNS can take a few minutes to propagate." })).toEqual({
      domain: "shop.example.com",
      verified: false,
      reason: "No TXT record found at bdv-verify.shop.example.com yet — DNS can take a few minutes to propagate.",
    });
    expect(parseShopDomainVerifyResult({ verified: "yes" })).toBeNull();
    expect(parseShopDomainVerifyResult({})).toBeNull();
    expect(parseShopDomainVerifyResult(null)).toBeNull();
  });
});

describe("storefront domain — the rails exist, are the page's, and charge nothing", () => {
  it("the API source carries the three domain routes the section rides", () => {
    expect(apiShopsSrc).toContain('router.post("/storefronts/:id/domain"');
    expect(apiShopsSrc).toContain('router.post("/storefronts/domain/verify"');
    expect(apiShopsSrc).toContain('router.delete("/storefronts/:id/domain"');
  });

  it("no charge rides any domain handler — the handlers (the file's tail) never call the credit rail", () => {
    const tail = apiShopsSrc.slice(apiShopsSrc.indexOf("POST /api/storefronts/:id/domain"));
    expect(tail).not.toContain("chargeCredits");
    expect(tail).not.toContain("CREDIT_COSTS");
  });

  it("the credit-cost registry has no row for the domain rails — free, nothing to confirm", () => {
    expect(getCreditCost("/api/storefronts/domain/verify")).toBeNull();
    expect(getCreditCost("/api/storefronts/some-shop-id/domain")).toBeNull();
  });
});

describe("source pins — the section's wiring in ShopStands (Stack-100 #29)", () => {
  it("the section exists and docks in the settings, ahead of the creator-domains desk", () => {
    expect(sectionStart).toBeGreaterThan(-1);
    expect(standsSrc).toContain("<ShopDomainSection");
    expect(standsSrc.indexOf("<ShopDomainSection")).toBeLessThan(standsSrc.indexOf("<DomainsDesk"));
    expect(sectionSrc).toContain('data-testid="world-shop-domain"');
  });

  it("all three actions ride the storefront domain rails with the page's exact bodies", () => {
    expect(sectionSrc).toContain("`/api/storefronts/${shop.id}/domain`");
    expect(sectionSrc).toContain('"/api/storefronts/domain/verify"');
    expect(sectionSrc).toContain("JSON.stringify({ shopId: shop.id })");
    expect(sectionSrc).toContain('method: "DELETE"');
    expect(sectionSrc).toContain("buildShopDomainAttachBody(");
    expect(sectionSrc).toContain("parseShopDomainAttachResult(");
    expect(sectionSrc).toContain("parseShopDomainVerifyResult(");
  });

  it("the DNS instructions render from the rail's answer — host, token and step lines — with the derived host only as the returning-session fallback", () => {
    expect(sectionSrc).toContain("attachInfo.verification.host");
    expect(sectionSrc).toContain("attachInfo.verification.value");
    expect(sectionSrc).toContain("attachInfo.dns.step1");
    expect(sectionSrc).toContain("attachInfo.dns.step2");
    expect(sectionSrc).toContain("attachInfo.dns.step3");
    expect(sectionSrc).toContain("shopDomainVerifyHost(domain)");
    expect(sectionSrc).toContain("SHOP_DOMAIN_CNAME_TARGET");
    expect(sectionSrc).toContain('data-testid="world-shop-domain-txt-host"');
    expect(sectionSrc).toContain('data-testid="world-shop-domain-txt-value"');
  });

  it("state comes from the shop's record and flips to verified in exactly one place — after the rail said so", () => {
    expect(sectionSrc).toContain("shopDomainStatus(mineShop)");
    expect(sectionSrc).toContain("result.verified");
    expect(sectionSrc.match(/domain_verified: true/g)).toHaveLength(1);
    expect(sectionSrc).toContain('data-testid="world-shop-domain-pending-reason"');
    expect(sectionSrc).toContain("pendingReason");
  });

  it("the returning session masks the token and offers the page's remedy — reconnect for a fresh one", () => {
    expect(sectionSrc).toContain("••••••••");
    expect(sectionSrc).toContain("Reconnect for a fresh token");
    expect(sectionSrc).toContain('data-testid="world-shop-domain-reconnect"');
  });

  it("free end to end: no spend seam, no price literal, no link out of the World", () => {
    expect(sectionSrc).not.toContain("confirmedFetch");
    expect(sectionSrc).not.toContain("/pricing");
    expect(sectionSrc).not.toContain("VB");
  });

  it("detach is two-step in-world — the DELETE never fires on a first click", () => {
    expect(sectionSrc).toContain("confirmingDetach");
    expect(sectionSrc).toContain('data-testid="world-shop-domain-detach"');
    expect(sectionSrc).toContain('data-testid="world-shop-domain-detach-confirm"');
  });

  it("the section never touches the creator-domains rails — the two domain desks stay distinct", () => {
    expect(sectionSrc).not.toContain("/api/domains");
    expect(sectionSrc).not.toContain("lib/domains");
  });
});
