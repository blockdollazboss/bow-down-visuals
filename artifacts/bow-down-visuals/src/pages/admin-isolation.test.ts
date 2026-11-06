/**
 * admin-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 27): per-bench render-error isolation on /admin.
 *
 * The defect: the admin page mounted its 17 benches (Jackpot,
 * Spotlight/Contact/DMCA/PitchFix/Content inboxes, Content Removal,
 * UserManagement, NFC/Jewelry orders, PaymentReversals,
 * OperatorActions, Gear, Challenges, Grants, RemixKing, WorldDrop)
 * and its 4 inline cards (grant / give-friend / plan / Bow Race) as
 * BARE siblings. Any bench render throw reached the one App-level
 * RouteErrorBoundary and replaced the ENTIRE admin page mid-triage —
 * payment reversals included. Owner law: "one bad section should
 * never take the whole dashboard down."
 *
 * The fix wraps every bench and every inline card in the shared
 * SectionBoundary (extracted by lane D3 from the Settings pattern).
 * This suite follows the D3 idiom: (a) a composition in the admin
 * page's shape — one failed bench's own fallback renders alongside
 * its healthy sibling benches, with the App-level boundary's
 * fallback copy proven ABSENT; (b) source pins that admin.tsx wraps
 * every bench and card the census named.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const adminSource = read("./admin.tsx");
const appSource = read("../App.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
  retryLabel: "Try again",
};

function makeBoundary(name: string, child: ReactElement) {
  return new SectionBoundaryCore({
    name,
    variant: "section",
    isLight: false,
    title: LABELS.title,
    description: LABELS.description,
    retryLabel: LABELS.retryLabel,
    children: child,
  });
}

function failWith(boundary: SectionBoundaryCore, error: Error) {
  Object.assign(
    boundary.state,
    SectionBoundaryCore.getDerivedStateFromError(error),
  );
}

const BENCHES: Array<[string, string]> = [
  ["JackpotAdmin", "admin-jackpot"],
  ["SpotlightInbox", "admin-spotlight"],
  ["ContactInbox", "admin-contact"],
  ["DmcaReportsInbox", "admin-dmca"],
  ["PitchFixInbox", "admin-pitch-fix"],
  ["ContentReportsInbox", "admin-content-reports"],
  ["ContentRemovalPanel", "admin-content-removal"],
  ["UserManagement", "admin-users"],
  ["NfcOrdersAdmin", "admin-nfc-orders"],
  ["JewelryOrdersAdmin", "admin-jewelry-orders"],
  ["PaymentReversalsAdmin", "admin-payment-reversals"],
  ["OperatorActionsAdmin", "admin-operator-actions"],
  ["StudioGearQueueAdmin", "admin-gear-queue"],
  ["ChallengeAdmin", "admin-challenges"],
  ["CommunityGrantsAdmin", "admin-community-grants"],
  ["RemixKingAdmin", "admin-remix-king"],
  ["WorldDropAdmin", "admin-world-drop"],
];

const CARDS = ["admin-grant", "admin-give-friend", "admin-plan", "admin-bow-race"];

describe("admin shape — one bad bench never takes the admin page down", () => {
  it("a failed bench's fallback renders alongside its healthy siblings; the App-level fallback copy is absent", () => {
    const reversals = makeBoundary(
      "admin-payment-reversals",
      createElement("p", null, "REVERSALS BENCH"),
    );
    const jackpot = makeBoundary(
      "admin-jackpot",
      createElement("p", null, "JACKPOT BENCH"),
    );
    const users = makeBoundary(
      "admin-users",
      createElement("p", null, "USERS BENCH"),
    );
    failWith(jackpot, new Error("jackpot table malformed"));

    const html = [
      renderToStaticMarkup(reversals.render() as ReactElement),
      renderToStaticMarkup(jackpot.render() as ReactElement),
      renderToStaticMarkup(users.render() as ReactElement),
    ].join("\n");

    /* Siblings survive untouched. */
    expect(html).toContain("REVERSALS BENCH");
    expect(html).toContain("USERS BENCH");
    /* The failed bench degrades to its OWN honest fallback. */
    expect(html).toContain('data-testid="section-error-admin-jackpot"');
    expect(html).toContain(LABELS.title);
    expect(html).not.toContain("JACKPOT BENCH");
    /* The SECTION boundary caught it — not the App-level one. */
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("admin.tsx — every census-27 bench and card is wrapped (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(adminSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each(BENCHES)("wraps %s in its own boundary", (component, slug) => {
    expect(adminSource).toContain(`<SectionBoundary name="${slug}">`);
    expect(adminSource).toContain(`<${component}`);
  });

  it.each(CARDS)("wraps the inline card %s", (slug) => {
    expect(adminSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 21 boundary usages (17 benches + 4 cards)", () => {
    const usages = adminSource.match(/<SectionBoundary name="admin-/g) ?? [];
    expect(usages).toHaveLength(21);
  });
});
