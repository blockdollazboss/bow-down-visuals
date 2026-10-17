/**
 * treasury-panels.test.ts — Lane 8, the Treasury verification pass
 * (NATIVE-PLAN §2 footnotes + §4 step 4).
 *
 * Verdict on the claim under test: the Treasury's three custom
 * panels complete their interactions in-world.
 * - Daily Drop (treasury-daily): GET /api/bonus/status, then
 *   POST /api/bonus/claim-daily — claimed where you stand.
 * - Shark Drops (treasury-shark): GET /api/bonus/hourly-crate-status
 *   + POST /api/bonus/spin-wheel (the hourly crate), and
 *   GET /api/retention/shark-drop + POST /api/retention/shark-drop/claim
 *   (the personal drop) — both claimed where you stand.
 * - Quest Board (treasury-quests): the embedded QuestsWidget reads
 *   GET /api/retention/quests, claims via POST
 *   /api/retention/quests/claim and toggles via PATCH
 *   /api/retention/prefs — all in-world.
 *
 * Two pull-up remnants were found INSIDE the embedded website
 * components and fixed in this lane. Both components render in
 * StationPanel OUTSIDE the in-panel router, under the world page's
 * own router — so their wouter <Link>s were same-tab navigations
 * that ejected the walker from /world entirely:
 * - DailyDropCard's CTA → the day's drop tool (drop.href);
 * - QuestsWidget's unfinished-quest action → the quest's tool
 *   (meta.href).
 * The fix is panel-scoped and zero-behavior on the website: both
 * components take an optional `inWorld` prop (default off — the
 * dashboard and the social rail render them exactly as before);
 * StationPanel passes it, and in-world those two actions render as
 * explicit transfers — plain anchors, target="_blank" — the
 * framework's TransferFooter shape (NATIVE-PLAN §3.0): the tool
 * opens in a new tab, the palace session stays where it was.
 *
 * Re-skin: SKIPPED for the components' internals, deliberately.
 * Both components are shared with website pages (dashboard;
 * DailyDropCard also rides the social retention rail), so any
 * class change inside them would repaint the website — outside
 * this lane's zero-behavior mandate. A panel-level wrapper cannot
 * recolor their internal rows without fragile descendant CSS. The
 * in-world delta is therefore the transfer anchors above plus the
 * palace frame the panels already wear. (Noted for a future lane:
 * QuestsWidget's unfinished-quest rows keep a dark gradient slab
 * in light theme — a website-shared surface, to be fixed at the
 * component for BOTH homes or not at all.)
 *
 * These are source-contract pins in the repo's established style:
 * they fail if a Treasury panel regains a page-router call, if a
 * claim rail moves, or if the in-world transfer shape is lost.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stationPanel = read("../../components/world/StationPanel.tsx");
const dailyDropCard = read("../../components/DailyDropCard.tsx");
const questsWidget = read("../../components/QuestsWidget.tsx");

/** Slice one component's body out of StationPanel.tsx. */
function panelBody(startMarker: string, endMarker: string): string {
  const start = stationPanel.indexOf(startMarker);
  const end = stationPanel.indexOf(endMarker, start + 1);
  expect(start, startMarker).toBeGreaterThanOrEqual(0);
  expect(end, endMarker).toBeGreaterThan(start);
  return stationPanel.slice(start, end);
}

const dailyBody = panelBody("function TreasuryDaily", "function TreasuryShark");
const sharkBody = panelBody("function TreasuryShark", "function TreasuryQuests");
const questsBody = panelBody("function TreasuryQuests", "/* ─── The Music Hall jukebox");

describe("the Treasury panels resolve from the host's custom switch", () => {
  it("the host mounts exactly the three Treasury customs", () => {
    expect(stationPanel).toContain('case "treasury-daily":');
    expect(stationPanel).toContain('case "treasury-shark":');
    expect(stationPanel).toContain('case "treasury-quests":');
    expect(stationPanel).toContain("return <TreasuryDaily");
    expect(stationPanel).toContain("return <TreasuryShark");
    expect(stationPanel).toContain("return <TreasuryQuests");
  });
});

describe("Daily Drop — the claim completes in-world", () => {
  it("rides the bonus rails and nothing else outbound", () => {
    expect(dailyBody).toContain('fetch("/api/bonus/status"');
    expect(dailyBody).toContain('fetch("/api/bonus/claim-daily"');
    expect(dailyBody).toContain('method: "POST"');
    expect(dailyBody).toContain('data-testid="world-treasury-claim-daily"');
  });

  it("never calls the page router and holds no same-tab link", () => {
    expect(dailyBody).not.toContain("onOpenPage");
    expect(dailyBody).not.toContain("PanelRouter");
    expect(dailyBody).not.toContain("<Link");
    expect(dailyBody).not.toContain("window.location");
  });

  it("embeds the day's drop card in its in-world form", () => {
    expect(dailyBody).toContain("<DailyDropCard inWorld />");
    expect(dailyDropCard).toContain('fetch("/api/retention/daily-drop"');
  });
});

describe("Shark Drops — crate and drop both claim in-world", () => {
  it("rides the crate and shark-drop rails", () => {
    expect(sharkBody).toContain('fetch("/api/bonus/hourly-crate-status"');
    expect(sharkBody).toContain('fetch("/api/bonus/spin-wheel"');
    expect(sharkBody).toContain('fetch("/api/retention/shark-drop"');
    expect(sharkBody).toContain('fetch("/api/retention/shark-drop/claim"');
    expect(sharkBody).toContain('data-testid="world-treasury-claim-crate"');
    expect(sharkBody).toContain('data-testid="world-treasury-claim-drop"');
  });

  it("holds no link, no page-router call, no navigation at all", () => {
    expect(sharkBody).not.toContain("onOpenPage");
    expect(sharkBody).not.toContain("PanelRouter");
    expect(sharkBody).not.toContain("<Link");
    expect(sharkBody).not.toContain("href");
    expect(sharkBody).not.toContain("window.location");
  });
});

describe("Quest Board — track and claim ride the widget's rails, in-world", () => {
  it("the host mounts the widget in its in-world form", () => {
    expect(questsBody).toContain("<QuestsWidget");
    expect(questsBody).toContain("inWorld");
    expect(questsBody).toContain("onBalanceChange={refreshProfile}");
  });

  it("the widget's rails are the retention quest rails", () => {
    expect(questsWidget).toContain('fetch("/api/retention/quests"');
    expect(questsWidget).toContain('fetch("/api/retention/quests/claim"');
    expect(questsWidget).toContain('fetch("/api/retention/prefs"');
  });

  it("the Treasury host's quest panel never calls the page router", () => {
    expect(questsBody).not.toContain("onOpenPage");
    expect(questsBody).not.toContain("PanelRouter");
    expect(questsBody).not.toContain("<Link");
  });
});

describe("the two pull-up remnants — fixed as explicit in-world transfers", () => {
  it("DailyDropCard: inWorld renders a new-tab anchor; the website keeps its Link", () => {
    expect(dailyDropCard).toContain("inWorld = false");
    expect(dailyDropCard).toContain('target="_blank"');
    expect(dailyDropCard).toContain('rel="noopener noreferrer"');
    // The website default is untouched: the same wouter Link.
    expect(dailyDropCard).toContain("<Link href={drop.href}");
  });

  it("QuestsWidget: inWorld renders a new-tab anchor; the website keeps its Link", () => {
    expect(questsWidget).toContain("inWorld = false");
    expect(questsWidget).toContain('target="_blank"');
    expect(questsWidget).toContain('rel="noopener noreferrer"');
    expect(questsWidget).toContain("<Link href={meta.href}>");
  });

  it("the claim flows are untouched by the transfer shape", () => {
    // The quest claim button still posts the claim rail directly;
    // the transfer anchor only replaces the unfinished-quest action.
    expect(questsWidget).toContain("onClick={() => void claim(q.key)}");
    expect(dailyBody).toContain("onClick={claim}");
    expect(sharkBody).toContain("onClick={claimCrate}");
    expect(sharkBody).toContain("onClick={claimDrop}");
  });
});
