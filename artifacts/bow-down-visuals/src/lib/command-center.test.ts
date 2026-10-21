import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMMAND_PANEL_KEYS,
  briefApproveTarget,
  shapeActions,
  shapeAudience,
  shapeBrief,
  shapeContent,
  shapeRevenue,
} from "./command-center";

/**
 * Home-base command center (social-platforms dossier C3) — shaping +
 * draft-only invariants.
 *
 * The honesty rules under test: shaping never invents a number (a
 * missing/malformed field becomes null, rendered "—", never a fake 0,
 * while a server-known 0 stays 0); off-platform rows exist only when
 * the server says accounts are connected; and the brief's move is a
 * DRAFT — its only approve affordance is navigation to the surface
 * the kind maps to, re-derived client-side from the same allowlist,
 * so a payload can never smuggle in a destination (or an action).
 */

describe("command-center shaping", () => {
  it("has exactly the five panels", () => {
    expect(COMMAND_PANEL_KEYS).toEqual(["brief", "audience", "revenue", "content", "actions"]);
  });

  it("audience: real stats pass through; malformed stats become null, never 0", () => {
    const shaped = shapeAudience({
      followers: { total: 12, new7: 3 },
      subscribers: { total: "lots", new7: 1 },
      members: null,
      offPlatform: { connected: false, platforms: [] },
      partial: true,
    });
    expect(shaped.followers).toEqual({ total: 12, new7: 3 });
    expect(shaped.subscribers).toBeNull();
    expect(shaped.members).toBeNull();
    expect(shaped.partial).toBe(true);
  });

  it("audience: a server-known 0 stays 0", () => {
    const shaped = shapeAudience({
      followers: { total: 0, new7: 0 },
      subscribers: { total: 0, new7: 0 },
      members: { total: 0, new7: 0 },
    });
    expect(shaped.followers).toEqual({ total: 0, new7: 0 });
  });

  it("audience: off-platform rows exist only when connected, with snapshot numbers or nulls", () => {
    const shaped = shapeAudience({
      followers: { total: 0, new7: 0 },
      subscribers: { total: 0, new7: 0 },
      members: { total: 0, new7: 0 },
      offPlatform: {
        connected: true,
        platforms: [
          { platform: "instagram", username: "me", followers: 130, delta: 30 },
          { platform: "tiktok", username: null, followers: null, delta: null },
          { username: "no-platform" },
        ],
      },
    });
    expect(shaped.offPlatform.connected).toBe(true);
    expect(shaped.offPlatform.platforms).toEqual([
      { platform: "instagram", username: "me", followers: 130, delta: 30 },
      { platform: "tiktok", username: null, followers: null, delta: null },
    ]);
    const none = shapeAudience({});
    expect(none.offPlatform).toEqual({ connected: false, platforms: [] });
  });

  it("revenue: errored rails shape to nulls; tips stay a separate VB figure", () => {
    const shaped = shapeRevenue({
      totalCents: 34500,
      totalTipsVb: 500,
      rails: {
        store: { status: "ok", totalCents: 17250, count: 3 },
        memberships: { status: "error", totalCents: null, count: null },
        brandDeals: { status: "ok", totalCents: 3000, count: 1 },
        beats: null,
        tips: { status: "ok", streamTipsVb: 500, tipJarPendingCents: 0 },
      },
      partial: true,
    });
    expect(shaped.rails.store).toEqual({ totalCents: 17250, count: 3 });
    expect(shaped.rails.memberships).toEqual({ totalCents: null, count: null });
    expect(shaped.rails.beats).toEqual({ totalCents: null, count: null });
    expect(shaped.rails.tipsVb).toBe(500);
    expect(shaped.totalCents).toBe(34500);
    expect(shaped.partial).toBe(true);
  });

  it("content: no profile is an absent, and a true flag without a profile still reads absent", () => {
    expect(shapeContent({ hasProfile: false, profile: null }).hasProfile).toBe(false);
    expect(shapeContent({ hasProfile: true, profile: null }).hasProfile).toBe(false);
    const shaped = shapeContent({
      hasProfile: true,
      profile: { slug: "me", totalPlays: 150, followerCount: 3 },
      topTrack: { title: "Top Song", playCount: 120 },
      topVideo: null,
      totals: { trackCount: 2, trackPlays: 150, videoCount: 2, videoViews: 910 },
    });
    expect(shaped.hasProfile).toBe(true);
    expect(shaped.topTrack).toEqual({ title: "Top Song", playCount: 120 });
    expect(shaped.topVideo).toBeNull();
  });

  it("actions: unknown keys and off-site hrefs are dropped; the total is recomputed from what survives", () => {
    const shaped = shapeActions({
      items: [
        { key: "unreadMessages", count: 2, href: "/messages" },
        { key: "deleteEverything", count: 99, href: "/messages" },
        { key: "pastDueMembers", count: 5, href: "https://evil.example" },
      ],
      total: 106,
    });
    expect(shaped.items).toEqual([{ key: "unreadMessages", count: 2, href: "/messages" }]);
    expect(shaped.total).toBe(2);
  });
});

describe("the brief is draft-only", () => {
  it("the approve target is OUR mapping for the kind — a payload href is never rendered", () => {
    const brief = shapeBrief({
      summary: "Two members are past due.",
      move: { kind: "winback", title: "Win them back", draft: "Hey — we miss you.", href: "https://evil.example/phish" },
    });
    expect(brief).not.toBeNull();
    expect(briefApproveTarget(brief!)).toBe("/memberships");
  });

  it("unknown kinds, empty summaries, and empty drafts shape to null (no move renders)", () => {
    expect(shapeBrief({ summary: "Hi.", move: { kind: "charge_everyone", title: "x", draft: "y" } })).toBeNull();
    expect(shapeBrief({ summary: "", move: { kind: "post", title: "x", draft: "y" } })).toBeNull();
    expect(shapeBrief({ summary: "Hi.", move: { kind: "post", title: "x", draft: "  " } })).toBeNull();
    expect(shapeBrief(null)).toBeNull();
    expect(shapeBrief("a string")).toBeNull();
  });

  it("every allowlisted kind maps to its real in-app surface", () => {
    for (const [kind, href] of Object.entries({
      post: "/scheduler",
      winback: "/memberships",
      reply: "/messages",
      deliver: "/shoutouts",
      price_check: "/earnings",
      create: "/create",
    })) {
      const brief = shapeBrief({ summary: "S.", move: { kind, title: "T", draft: "D" } });
      expect(briefApproveTarget(brief!)).toBe(href);
    }
  });
});

/* ── Source pins: the component + the dashboard dock ──────────────── */

const componentSource = readFileSync(new URL("../components/CommandCenter.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../pages/dashboard.tsx", import.meta.url), "utf8");

describe("CommandCenter.tsx wiring (source pins)", () => {
  it("every panel has its own failure note + testid (the resilience law)", () => {
    for (const key of COMMAND_PANEL_KEYS) {
      expect(componentSource).toContain(`command-${key}-failure`);
      expect(componentSource).toContain(`retryPanel("${key}")`);
    }
  });

  it("fetches each panel from its own endpoint and settles through the shared seam", () => {
    expect(componentSource).toContain("fetch(`/api/command/${key}`");
    expect(componentSource).toContain("initialSectionStates(COMMAND_PANEL_KEYS)");
    expect(componentSource).toContain("settleSection(");
    expect(componentSource).toContain("markSectionLoading(");
  });

  it("never POSTs: the brief's approve path is navigation + copy only", () => {
    expect(componentSource).not.toContain('method: "POST"');
    expect(componentSource).not.toContain("method: 'POST'");
    expect(componentSource).not.toContain('method:"POST"');
    expect(componentSource).toContain("briefApproveTarget(brief)");
    expect(componentSource).toContain("navigator.clipboard.writeText");
  });

  it("is docked inside the dashboard, above the retention row, outside the core-failure gate", () => {
    expect(dashboardSource).toContain('import CommandCenter from "@/components/CommandCenter"');
    expect(dashboardSource).toContain("<CommandCenter getToken={getAccessToken} isLight={isLight} />");
    const dockAt = dashboardSource.indexOf("<CommandCenter");
    const gateAt = dashboardSource.indexOf("allDashboardSectionsFailed(sectionStates) ?");
    const retentionAt = dashboardSource.indexOf("RETENTION: CREATION STREAK");
    expect(dockAt).toBeGreaterThan(-1);
    expect(dockAt).toBeLessThan(retentionAt);
    expect(dockAt).toBeLessThan(gateAt);
  });
});
