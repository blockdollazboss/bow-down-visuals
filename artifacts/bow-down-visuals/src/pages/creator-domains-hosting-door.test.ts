/**
 * creator-domains-hosting-door.test.ts — the Hosting purchase door
 * docks at its gate on /creator/domains (hosting-door fix, Nov 10).
 *
 * The defect (walk-proven live on join18 @ b26d38b87): claiming a
 * custom domain is refused server-side for anyone without the
 * Hosting plan — routes/domains.ts answers "Your own custom domain
 * rides the Hosting plan — $9/mo on its own, or included free with
 * Creator Elite. Pick up either one and this door opens." — but the
 * domains page offered NO way to pick either one up: no buy button,
 * no link, a dead end at the exact moment of intent. The plan's one
 * purchase door (the ProfileHosting card) stood only on
 * /creator-pricing, a page the domains flow never sends anyone to.
 *
 * The fix mounts that same card on /creator/domains, directly under
 * the claim box it gates. These pins hold:
 *   - the REAL card is mounted (not a re-implementation): the card
 *     owns every state through hostingCardState — Free creator →
 *     the buy branch (profile-hosting-state.test.ts pins the
 *     derivation; profile-hosting-door.test.ts pins the branch →
 *     buyButton → POST /creator-hosting/checkout → embedded
 *     checkout wiring); hosting-active and Elite creators get the
 *     active / included state with Manage, never a buy offer, and
 *     the rail 409s a second sale regardless;
 *   - the mount sits in the page's loaded branch, under the claim
 *     box — NOT inside the no-profile branch (Hosting runs your
 *     page; the page-first surface stays the only word there);
 *   - the page derives NO entitlement of its own and runs NO
 *     checkout of its own — one state machine, one rail call, so
 *     the two doors can never disagree or double-sell;
 *   - the server gate copy this door answers stays in place (the
 *     refusal is honest; it just stops being a dead end).
 *
 * The FE suite runs in node (no DOM) — source pins in the house
 * style, matching profile-hosting-door.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./creator-domains.tsx");
const card = read("../components/ProfileHosting.tsx");
const domainsRail = read("../../../api-server/src/routes/domains.ts");

describe("the Hosting door docks on /creator/domains, at the claim gate", () => {
  it("mounts the real ProfileHosting card, exactly once", () => {
    expect(page).toContain('import ProfileHosting from "@/components/ProfileHosting"');
    expect(page.match(/<ProfileHosting isLight=\{isLight\} \/>/g)).toHaveLength(1);
    expect(page).toContain("const isLight = useIsLightTheme();");
    expect(page).toContain('import { useIsLightTheme } from "@/hooks/use-is-light-theme"');
  });

  it("the mount stands under the claim box, ahead of the domain cards", () => {
    const claimBox = page.indexOf("Connect your own domain");
    const mount = page.indexOf("<ProfileHosting isLight={isLight} />");
    const cards = page.indexOf("{domains.map((d) => (");
    expect(claimBox).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(claimBox);
    expect(cards).toBeGreaterThan(mount);
  });

  it("the mount is NOT inside the no-profile branch — page-first stays the only word there", () => {
    const noProfileBranch = page.slice(page.indexOf("noProfile ? ("), page.indexOf(") : (", page.indexOf("noProfile ? (")));
    expect(noProfileBranch).toContain("Build my creator page");
    expect(noProfileBranch).not.toContain("ProfileHosting");
  });

  it("the page derives no entitlement and runs no checkout of its own", () => {
    /* One state machine (the card's) and one rail call (the card's):
       a page-local gate or a second checkout is how the two doors
       would drift apart — or double-sell. */
    expect(page).not.toContain("hostingEntitled");
    expect(page).not.toContain("/api/creator-hosting/checkout");
    expect(page).not.toContain("EmbeddedSessionCheckout");
    expect(page).not.toMatch(/stripe/i);
  });

  it("the mounted card is the door whose buy branch starts the embedded checkout", () => {
    /* The behavior chain this page inherits, pinned at its source:
       buy state → buyButton → startCheckout → the rail POST → the
       shared embedded checkout on the clientSecret (never a hosted
       page, never a checkout URL). */
    const buyBranch = card.slice(card.indexOf('{state.kind === "buy" && !clientSecret && ('));
    expect(buyBranch).toContain('t("profileHosting.buyButton"');
    expect(buyBranch).toContain("onClick={startCheckout}");
    expect(card).toContain('postJsonWithTransportRetry("/api/creator-hosting/checkout"');
    expect(card).toContain("<EmbeddedSessionCheckout clientSecret={clientSecret} />");
    expect(card).not.toContain("checkoutUrl");
  });

  it("entitled creators meet Manage, not a second sale", () => {
    const activeBranch = card.slice(
      card.indexOf('{state.kind === "hosting-active" && ('),
      card.indexOf('{state.kind === "not-switched-on" && ('),
    );
    expect(activeBranch).toContain('t("profileHosting.manageButton")');
    expect(activeBranch).not.toContain("buyButton");
    const eliteBranch = card.slice(
      card.indexOf('{state.kind === "elite-included" && ('),
      card.indexOf('{state.kind === "admin-entitled" && ('),
    );
    expect(eliteBranch).not.toContain("buyButton");
    expect(eliteBranch).not.toContain("startCheckout");
  });

  it("the server gate this door answers still refuses honestly — with the door now beside it", () => {
    expect(domainsRail).toContain("rides the Hosting plan");
    expect(domainsRail).toContain("Pick up either one and this door opens");
    expect(domainsRail).toContain("resolveHostingEntitlement");
  });
});
