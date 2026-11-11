/**
 * moderation-policy.test.ts — the public Moderation and Takedown
 * Rules page (owner-approved draft, Nov 11, 2026).
 *
 * Pins, in the house source-pin style:
 * - the page exists on the sibling policy-page pattern (PolicyNav,
 *   content panel, moderationPolicy namespace) and is routed PUBLIC
 *   at /moderation — in App.tsx, in the public-routes registry (both
 *   lists), and linked from the footer legal doors;
 * - the English copy carries the approved draft's exact governing
 *   terms — nothing paraphrased, nothing invented: the 24-hour
 *   review target, hidden up to 3 days, the ladder (warning → 7-day
 *   pause → 30-day pause → closure), the DMCA channel
 *   (support@bowdownvisuals.com, ~2 business days down, counter-
 *   notice, 10–14 business days before restore), and the single
 *   appeal within 30 days with a 5-business-day reply target;
 * - every moderationPolicy key the page renders exists in en, and
 *   the namespace rides English-verbatim in the 9 non-en catalogs
 *   (UNREVIEWED placeholders per the locale honesty law — when a
 *   real translation lands, update this pin in the same commit).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
function loadLocale(locale: string): Record<string, any> {
  return JSON.parse(read(`../locales/${locale}.json`));
}

const page = read("./moderation.tsx");
const app = read("../App.tsx");
const publicRoutes = read("../lib/public-routes.ts");
const footer = read("../components/layout/footer.tsx");
const en = loadLocale("en");
const mp = en.moderationPolicy as Record<string, any>;

function flat(o: Record<string, any>, p = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flat(v, key, out);
    else out[key] = String(v);
  }
  return out;
}
const MP = flat(mp, "moderationPolicy");

describe("the moderation policy page — pattern and routing", () => {
  it("follows the sibling policy-page pattern", () => {
    expect(page).toContain("function PolicyNav()");
    expect(page).toContain("content-panel");
    expect(page).toContain('usePageTitle(t("moderationPolicy.pageTitle")');
    expect(page).toContain('t("moderationPolicy.title")');
  });

  it("is routed at /moderation and registered public in both public-routes lists", () => {
    expect(app).toContain('import("@/pages/moderation")');
    expect(app).toContain('<Route path="/moderation"><ModerationPolicy /></Route>');
    expect(publicRoutes).toContain('"/moderation"');
    expect(publicRoutes).toContain('{ path: "/moderation", disposition: "public" }');
  });

  it("is linked from both footer legal doors", () => {
    expect(footer).toContain('{ label: "Moderation Rules", href: "/moderation" }');
    expect(footer).toContain('<Link href="/moderation"');
  });

  it("the page renders only moderationPolicy keys that exist in en (no raw keys)", () => {
    const used = [...page.matchAll(/t\("(moderationPolicy\.[^"]+)"\)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(40);
    for (const key of used) expect(MP[key], key).toBeTruthy();
  });
});

describe("the moderation policy copy — the approved draft's exact terms", () => {
  it("carries the reporting rules: anyone, guests included, reporter never named", () => {
    expect(MP["moderationPolicy.reporting.item1"]).toContain("Every public post, profile, and comment has a Report button.");
    expect(MP["moderationPolicy.reporting.item2"]).toContain("Anyone can report, including guests");
    expect(MP["moderationPolicy.reporting.item3"]).toContain("not told who reported them");
    expect(MP["moderationPolicy.reporting.item4"]).toContain("support@bowdownvisuals.com");
    expect(MP["moderationPolicy.reporting.item4"]).toContain("URGENT");
  });

  it("carries the review steps: 24-hour target, unclear hidden up to 3 days", () => {
    expect(MP["moderationPolicy.review.step1Body"]).toContain("within 24 hours");
    expect(MP["moderationPolicy.review.step3Body"]).toContain("hidden while we check, up to 3 days");
    expect(MP["moderationPolicy.review.step4Body"]).toContain("remove first and explain after");
  });

  it("carries the repeat-offender ladder exactly", () => {
    expect(MP["moderationPolicy.ladder.rung1Body"]).toContain("warning");
    expect(MP["moderationPolicy.ladder.rung2Body"]).toContain("7-day posting pause");
    expect(MP["moderationPolicy.ladder.rung3Body"]).toContain("30-day posting pause");
    expect(MP["moderationPolicy.ladder.rung4Body"]).toContain("account closed");
    expect(MP["moderationPolicy.ladder.rung4Body"]).toContain("earned creator money already due is still paid out");
    expect(MP["moderationPolicy.ladder.severe"]).toContain("skip straight to account closure");
  });

  it("carries the child-safety line with no warnings and no appeals on the content", () => {
    expect(MP["moderationPolicy.notAllowed.item3"]).toContain("under 18");
    expect(MP["moderationPolicy.notAllowed.item3"]).toContain("Removed instantly and reported to the authorities");
    expect(MP["moderationPolicy.notAllowed.item3"]).toContain("No warnings, no appeals on the content itself");
  });

  it("carries the DMCA flow: support@ intake, ~2 business days down, counter-notice, 10–14 business days to restore", () => {
    expect(MP["moderationPolicy.dmca.step1"]).toContain("Email support@bowdownvisuals.com");
    expect(MP["moderationPolicy.dmca.step1"]).toContain("the exact link to the post using it");
    expect(MP["moderationPolicy.dmca.step2"]).toContain("usually within 2 business days");
    expect(MP["moderationPolicy.dmca.step3Lead"]).toContain("Counter-notice:");
    expect(MP["moderationPolicy.dmca.step3Body"]).toContain("they have the right to use the work");
    expect(MP["moderationPolicy.dmca.step4"]).toContain("10–14 business days");
    expect(MP["moderationPolicy.dmca.step4"]).toContain("the content can go back up");
  });

  it("carries the single appeal: once, to support@, within 30 days, 5-business-day reply target, final", () => {
    expect(MP["moderationPolicy.appeals.p1"]).toContain("appeal once, by email to support@bowdownvisuals.com, within 30 days");
    expect(MP["moderationPolicy.appeals.p2"]).toContain("5 business days");
    expect(MP["moderationPolicy.appeals.p2"]).toContain("final");
  });
});

describe("the moderation policy namespace in the non-en catalogs", () => {
  it("rides English-verbatim (UNREVIEWED) in all 9 — present, never silently absent", () => {
    for (const loc of ["es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"]) {
      const other = flat(loadLocale(loc).moderationPolicy ?? {}, "moderationPolicy");
      expect(Object.keys(other).length, loc).toBe(Object.keys(MP).length);
      for (const [k, v] of Object.entries(MP)) expect(other[k], `${loc}:${k}`).toBe(v);
    }
  });
});
