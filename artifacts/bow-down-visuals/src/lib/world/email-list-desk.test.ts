import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMAIL_AUTOMATION_KINDS, EMAIL_LISTS_PATH, EMAIL_NEWSLETTER_COST_VISUAL_BUCS,
  EMAIL_NEWSLETTER_PATH, FAN_GRAPH_PATH, FAN_GRAPH_SORTS, NEWSLETTER_TONES,
  buildAutomationCopyPatch, buildAutomationToggle, buildCampaignPayload, buildListPayload,
  buildNewsletterPayload, campaignReady, campaignSendable, emailListAutomationItemPath,
  emailListAutomationsPath, emailListCampaignSendPath, emailListCampaignsPath,
  emailListSegmentsPath, emailListSubscribersPath, emailListUnsubscribePath, fanBadges,
  fanGraphPath, fanSpentLabel, listReady, newsletterReady, openRateLabel, parseAutomations,
  parseCampaigns, parseEmailLists, parseFanGraph, parseNewsletterDraft, parseSegments,
  parseSubscribers,
} from "./email-list-desk";

/* ─── Email List desk seam (stack1400 world parity, wave #2 item 1) ──
   The Promote Room's email desk rides the 2D page's own rails. These
   tests pin the seam: the paths are the page's endpoints, the
   newsletter cost is the SERVER constant's own default (read from
   the route helper file, never re-typed from memory), the payload
   builders carry the page's field names trimmed the page's way, and
   every parser maps its rail's answer field-for-field — with a
   broken or incomplete paid answer reading as a failed read (null),
   never a painted-over draft, and an untracked open rate staying
   null, never a fabricated 0%. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("rails + prices", () => {
  it("the paths are the email-list page's own endpoints", () => {
    expect(EMAIL_LISTS_PATH).toBe("/api/email-list/lists");
    expect(EMAIL_NEWSLETTER_PATH).toBe("/api/email-list/newsletter");
    expect(FAN_GRAPH_PATH).toBe("/api/email-list/fan-graph");
    expect(emailListSubscribersPath("l 1")).toBe("/api/email-list/lists/l%201/subscribers");
    expect(emailListUnsubscribePath("l1")).toBe("/api/email-list/lists/l1/unsubscribe");
    expect(emailListSegmentsPath("l1")).toBe("/api/email-list/lists/l1/segments");
    expect(emailListCampaignsPath("l1")).toBe("/api/email-list/lists/l1/campaigns");
    expect(emailListCampaignSendPath("l1", "c/1")).toBe("/api/email-list/lists/l1/campaigns/c%2F1/send");
    expect(emailListAutomationsPath("l1")).toBe("/api/email-list/lists/l1/automations");
    expect(emailListAutomationItemPath("l1", "post_purchase")).toBe("/api/email-list/lists/l1/automations/post_purchase");
    expect(fanGraphPath({ search: " a b ", sort: "spent", page: 2 })).toBe(
      "/api/email-list/fan-graph?sort=spent&page=2&pageSize=25&search=a+b",
    );
    const page = read("../../pages/email-list.tsx");
    for (const p of ["/api/email-list/lists", "/api/email-list/newsletter", "/segments", "/campaigns", "/automations"]) {
      expect(page, p).toContain(p);
    }
    expect(read("../../components/FanGraphTab.tsx")).toContain("/api/email-list/fan-graph?");
  });

  it("the newsletter cost is the server constant's default — 100 VB", () => {
    const helpers = read("../../../../api-server/src/routes/generate/email-list-helpers.ts");
    expect(helpers).toContain('Number(process.env["EMAIL_NEWSLETTER_CREDIT_COST"]) || 100');
    expect(EMAIL_NEWSLETTER_COST_VISUAL_BUCS).toBe(100);
    /* Registry gap honesty: the newsletter path has NO credit-costs
       row, which is exactly why the desk passes an explicit override. */
    expect(read("../credit-costs.ts")).not.toContain('"/api/email-list/newsletter"');
  });

  it("the vocabularies are the server schemas' own enums", () => {
    expect(NEWSLETTER_TONES).toEqual(["hype", "behind-the-scenes", "personal", "announcement"]);
    expect(EMAIL_AUTOMATION_KINDS).toEqual([
      "post_purchase", "abandoned_checkout", "membership_winback", "membership_payment_recovery",
    ]);
    expect(FAN_GRAPH_SORTS).toEqual(["recent", "spent", "name"]);
    const schema = read("../../../../../lib/db/src/schema/email-lists.ts");
    expect(schema).toContain('"post_purchase", "abandoned_checkout", "membership_winback", "membership_payment_recovery"');
    const fanRoute = read("../../../../api-server/src/routes/generate/fan-graph.ts");
    expect(fanRoute).toContain('"/email-list/fan-graph"');
  });
});

describe("payload builders", () => {
  it("the list body trims and lowercases the handle, the page's way", () => {
    expect(buildListPayload({ name: "  Fans ", handle: " My-Fans ", description: " d " })).toEqual({
      name: "Fans", handle: "my-fans", description: "d",
    });
    expect(listReady({ name: "Fans", handle: "my-fans" })).toBe(true);
    expect(listReady({ name: "Fans", handle: "no way" })).toBe(false);
    expect(listReady({ name: " ", handle: "ok-handle" })).toBe(false);
  });

  it("the newsletter body carries the page's field names, trimmed", () => {
    expect(buildNewsletterPayload({
      topic: "  New song ", tone: "hype", creatorName: " Thy ", listName: " Fans ", callToAction: " Stream it ",
    })).toEqual({ topic: "New song", tone: "hype", creatorName: "Thy", listName: "Fans", callToAction: "Stream it" });
    expect(newsletterReady({ topic: " x " })).toBe(true);
    expect(newsletterReady({ topic: "  " })).toBe(false);
  });

  it("campaigns are born drafts — status is server-owned", () => {
    expect(buildCampaignPayload({ subject: " S ", body: " B " })).toEqual({ subject: "S", body: "B", status: "draft" });
    expect(campaignReady({ subject: "S", body: "" })).toBe(false);
    expect(campaignSendable({ status: "draft" })).toBe(true);
    expect(campaignSendable({ status: "failed" })).toBe(true);
    expect(campaignSendable({ status: "sent" })).toBe(false);
    expect(campaignSendable({ status: "queued" })).toBe(false);
  });

  it("automation toggle flips, copy patch clamps the delay to the schema's 0–720", () => {
    expect(buildAutomationToggle({ enabled: false })).toEqual({ enabled: true });
    expect(buildAutomationToggle({ enabled: true })).toEqual({ enabled: false });
    expect(buildAutomationCopyPatch({ subject: " S ", body: " B ", delayHours: 9999 })).toEqual({
      subject: "S", body: "B", delayHours: 720,
    });
    expect(buildAutomationCopyPatch({ subject: "S", body: "B", delayHours: -4 }).delayHours).toBe(0);
  });
});

describe("parsers", () => {
  it("lists, subscribers + honest stats", () => {
    const lists = parseEmailLists({ lists: [{ id: "l1", name: "Fans", handle: "fans", description: null, createdAt: "t" }, { name: "no id" }] });
    expect(lists).toEqual([{ id: "l1", name: "Fans", handle: "fans", description: null, createdAt: "t" }]);
    const { subscribers, stats } = parseSubscribers({
      subscribers: [{ id: "s1", email: "a@b.co", name: null, source: "landing", opens: 2, clicks: 1, tags: ["vip"], autoTags: ["opened"], unsubscribedAt: null, subscribedAt: "t" }],
      stats: { total: 3, active: 2, unsubscribed: 1, openRate: null, opensTracked: false, totalOpens: 0, totalClicks: 0, freeLimit: 1000 },
    });
    expect(subscribers[0]?.email).toBe("a@b.co");
    expect(stats?.openRate).toBeNull();
    expect(openRateLabel(stats)).toBe("Not tracked yet");
    expect(openRateLabel({ ...stats!, opensTracked: true, openRate: 0.5 })).toBe("50% open rate");
    expect(parseSubscribers({}).stats).toBeNull();
    expect(parseEmailLists(null)).toEqual([]);
  });

  it("segments + campaigns map field-for-field", () => {
    expect(parseSegments({ segments: [{ id: "g1", name: "VIPs", size: 7 }] })).toEqual([{ id: "g1", name: "VIPs", size: 7 }]);
    expect(parseCampaigns({ campaigns: [{ id: "c1", subject: "Hi", status: "sent", recipientCount: 9, deliveredCount: 8, openCount: 3, clickCount: 1, createdAt: "t" }] })[0]?.status).toBe("sent");
  });

  it("a newsletter answer missing subject or body is a failed read", () => {
    expect(parseNewsletterDraft({ subject: "S", body: "B", creditsRemaining: 42 })).toEqual({
      subject: "S", body: "B", creditsRemaining: 42,
    });
    expect(parseNewsletterDraft({ subject: "S" })).toBeNull();
    expect(parseNewsletterDraft({ body: "B" })).toBeNull();
    expect(parseNewsletterDraft(null)).toBeNull();
  });

  it("automations map with measured counts", () => {
    const rows = parseAutomations({ automations: [{
      id: "a1", kind: "post_purchase", label: "Thank-you", triggerNote: "Fires on purchase",
      enabled: true, subject: "S", body: "B", delayHours: 0, enabledAt: "t", lastRunAt: null,
      sent: 2, failed: 0, noProvider: 0, skippedUnsubscribed: 1, delivered: 2, opens: 1, clicks: 0,
    }] });
    expect(rows[0]?.kind).toBe("post_purchase");
    expect(rows[0]?.skippedUnsubscribed).toBe(1);
    expect(parseAutomations({ automations: [{ id: "x" }] })).toEqual([]);
  });

  it("the fan graph merges summary, badges and spend honestly", () => {
    const { fans, summary, total } = parseFanGraph({
      fans: [{ id: "f1", email: "a@b.co", displayName: "Fan", follows: true, subscribed: true, unsubscribed: false, member: { tierName: "Gold", status: "active" }, spentUsdCents: 500, spentVb: 25, purchaseCount: 2, lastActivityAt: "t" }],
      summary: { totalFans: 1, followers: 1, subscribers: 1, members: 1, buyers: 1, totalSpentUsdCents: 500, totalSpentVb: 25 },
      total: 1,
    });
    expect(summary.totalFans).toBe(1);
    expect(total).toBe(1);
    expect(fanBadges(fans[0]!)).toEqual(["Follows", "Subscribed", "Member · Gold", "2 purchases"]);
    expect(fanSpentLabel(fans[0]!)).toBe("$5.00 · 25 VB");
    expect(parseFanGraph(null).summary.totalFans).toBe(0);
    expect(parseFanGraph(null).fans).toEqual([]);
  });
});
