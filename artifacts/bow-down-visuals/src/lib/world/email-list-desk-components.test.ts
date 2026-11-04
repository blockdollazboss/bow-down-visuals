/**
 * email-list-desk-components — stack1400 world parity wave #2 item 1
 * source-contract pins. The Email List family (email-list,
 * email-automations, fan-graph — the census's ABSENT ×3) must exist
 * as ONE native desk in the Promote Room:
 * - the desk rides the 2D page's rails end to end through the seam
 *   (lists, subscribers, segments, campaigns, automations, fan
 *   graph), never a website pull-up of /email-list;
 * - the paid newsletter draft goes through the confirmed rail with
 *   the seam's explicit override cost (100 VB) shown on the button;
 * - the desk is hung in the StationPanel's promote-room composition,
 *   stacked with the Promote Desk like its neighbors;
 * - guests get the sign-in gate, never the working desk.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/EmailListDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const seam = read("./email-list-desk.ts");

describe("the desk rides the family's rails end to end", () => {
  it("the newsletter draft rides the confirmed rail at the seam's price", () => {
    expect(desk).toContain("confirmedFetch(EMAIL_NEWSLETTER_PATH");
    expect(desk).toContain("overrideCost: EMAIL_NEWSLETTER_COST_VISUAL_BUCS");
    expect(desk).toContain('overrideFeature: "AI Newsletter Draft"');
    expect(desk).toContain('data-testid="world-email-newsletter-generate"');
    expect(desk).toContain("buildNewsletterPayload");
    expect(desk).toContain("parseNewsletterDraft");
  });

  it("lists + subscribers + segments ride their free rails", () => {
    for (const needle of [
      "EMAIL_LISTS_PATH",
      "emailListSubscribersPath(listId)",
      "emailListUnsubscribePath(activeListId)",
      "emailListSegmentsPath(listId)",
      "buildListPayload",
      "parseEmailLists",
      "parseSubscribers",
      "openRateLabel",
      'data-testid="world-email-list-create"',
      'data-testid="world-email-list-subscribers"',
      'data-testid="world-email-list-segments"',
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("campaigns ride draft + tracked-send rails", () => {
    for (const needle of [
      "emailListCampaignsPath(activeListId)",
      "emailListCampaignSendPath(activeListId, c.id)",
      "buildCampaignPayload",
      "campaignSendable",
      'data-testid="world-email-campaign-create"',
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("automations ride GET + PATCH toggle/copy rails for all four kinds", () => {
    for (const needle of [
      "emailListAutomationsPath(listId)",
      "emailListAutomationItemPath(activeListId, a.kind)",
      'method: "PATCH"',
      "buildAutomationToggle",
      "buildAutomationCopyPatch",
      'data-testid="world-email-automations"',
      "triggerNote",
    ]) {
      expect(desk, needle).toContain(needle);
    }
    expect(seam).toContain('"post_purchase", "abandoned_checkout", "membership_winback", "membership_payment_recovery"');
    expect(desk).toContain("world-email-automation-toggle-");
  });

  it("the fan graph rides its read-only rail with search, sort and paging", () => {
    for (const needle of [
      "fanGraphPath({ search: fanSearch, sort: fanSort, page: fanPage })",
      "parseFanGraph",
      "fanBadges",
      'data-testid="world-fan-graph-summary"',
      'data-testid="world-fan-graph-fans"',
      "worldScheduleRelease.emailFanReadOnly",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });
});

describe("world law: everything completes in-world", () => {
  it("no pull-up, no walk-out to the 2D email pages", () => {
    expect(desk).not.toContain('href="/email-list"');
    expect(desk).not.toContain("setLocation");
    expect(desk).not.toContain("window.location");
    expect(desk).not.toContain("window.open");
    /* the only Link is the guest gate's sign-in door, the house shape */
    expect(desk).toContain('<Link href="/login"');
  });

  it("guests get the gate, members get the desk", () => {
    expect(desk).toContain("if (isGuest) return <GuestGate isLight={isLight} />");
    expect(desk).toContain('data-testid="world-email-list-desk"');
  });
});

describe("station composition", () => {
  it("the desk is hung in the promote-room composition, stacked with PromoteDesk", () => {
    expect(panel).toContain('station.id === "promote-room"');
    expect(panel).toContain("<PromoteDesk isLight={isLight} isGuest={isGuest} />");
    expect(panel).toContain("<EmailListDesk isLight={isLight} isGuest={isGuest} />");
    expect(panel).toContain('import("@/components/world/native/EmailListDesk")');
    const stations = read("./stations.ts");
    const promote = stations.slice(stations.indexOf('id: "promote-room"'));
    expect(promote.slice(0, 600)).toContain('websitePath: "/promote"');
  });
});
