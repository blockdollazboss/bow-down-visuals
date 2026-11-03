/**
 * brief-desk — stack1500 world parity wave #3 item 20 pins.
 *
 * The Morning Brief desk is the Command Center brief's native
 * form. These pins hold: the rail is FREE (no registry row, the
 * pacing limiter is not a price, the handler never charges);
 * shaping rides the website's own command-center guards — a kind
 * outside the allowlist is refused and the payload's href is
 * never trusted (ours is substituted); the three honest states
 * stay separate (brief / digest fallback / unusable); the digest
 * lines print only facts the digest carries.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BRIEF_ACTION_LABELS,
  BRIEF_COST_VISUAL_BUCS,
  BRIEF_MOVE_SURFACES,
  BRIEF_PATH,
  briefOfResponse,
  digestLines,
  type BriefFallbackPayload,
} from "./brief-desk";
import { getCreditCost } from "../credit-costs";

const routeSrc = readFileSync(
  new URL("../../../../api-server/src/routes/command.ts", import.meta.url),
  "utf8",
);

describe("the rail is free — a limiter is not a price", () => {
  it("no registry row exists for the brief path, and the cost constant is 0", () => {
    expect(getCreditCost(BRIEF_PATH)).toBeNull();
    expect(BRIEF_COST_VISUAL_BUCS).toBe(0);
  });

  it("the route mounts the brief behind requireAuth + the free-AI limiter", () => {
    expect(routeSrc).toContain('router.get("/command/brief", requireAuth, freeAiLimiter');
  });
});

const GOOD_BRIEF = {
  summary: "Your week: two new members and a track doing numbers.",
  move: { kind: "post", title: "Announce the drop", draft: "Friday. New heat. Stay close.", href: "/evil" },
  generatedAt: "2026-11-03T13:00:00.000Z",
};

describe("briefOfResponse — the website's own guard discipline", () => {
  it("accepts a real brief and substitutes OUR href for the payload's", () => {
    const read = briefOfResponse(GOOD_BRIEF);
    expect(read.kind).toBe("brief");
    if (read.kind !== "brief") return;
    expect(read.brief.move.href).toBe("/scheduler");
    expect(read.brief.move.kind).toBe("post");
  });

  it("a kind outside the allowlist is unusable, never rendered", () => {
    const bad = { ...GOOD_BRIEF, move: { ...GOOD_BRIEF.move, kind: "wire_money" } };
    expect(briefOfResponse(bad)).toEqual({ kind: "unusable" });
  });

  it("an empty summary or an empty draft is unusable — never an empty brief", () => {
    expect(briefOfResponse({ ...GOOD_BRIEF, summary: "  " })).toEqual({ kind: "unusable" });
    expect(briefOfResponse({ ...GOOD_BRIEF, move: { ...GOOD_BRIEF.move, draft: "" } })).toEqual({
      kind: "unusable",
    });
    expect(briefOfResponse(null)).toEqual({ kind: "unusable" });
    expect(briefOfResponse({ error: "brief_unavailable" })).toEqual({ kind: "unusable" });
  });

  it("every move kind names the surface its draft belongs to", () => {
    expect(Object.keys(BRIEF_MOVE_SURFACES).sort()).toEqual(
      ["create", "deliver", "post", "price_check", "reply", "winback"].sort(),
    );
    expect(BRIEF_MOVE_SURFACES.post).toBe("the Scheduler");
    expect(BRIEF_MOVE_SURFACES.create).toBe("the Create wing");
  });
});

const FALLBACK_RAW = {
  summary: "",
  move: null,
  narrativeUnavailable: true,
  generatedAt: "2026-11-03T13:00:00.000Z",
  digest: {
    audience: {
      followers: { total: 1204, new7: 31 },
      members: { total: 42, new7: 2 },
      subscribers: null,
      offPlatform: { connected: false, platforms: [] },
      partial: false,
    },
    revenue: { totalCents: 12345, totalTipsVb: 800, rails: {}, partial: false },
    content: {
      hasProfile: true,
      profile: { slug: "thy", totalPlays: 900, followerCount: 1204 },
      topTrack: { title: "Crown Talk", playCount: 512 },
      topVideo: null,
      totals: { trackCount: 7, trackPlays: 900, videoCount: 3, videoViews: 40 },
      partial: false,
    },
    actions: {
      items: [
        { key: "unreadMessages", count: 3, href: "/messages" },
        { key: "pastDueMembers", count: 0, href: "/memberships" },
      ],
      total: 3,
      partial: false,
    },
  },
};

describe("the digest fallback — real numbers, honestly framed", () => {
  it("a flagged narrativeUnavailable answer reads as the digest state", () => {
    const read = briefOfResponse(FALLBACK_RAW);
    expect(read.kind).toBe("digest");
  });

  it("an unflagged digest-shaped answer does NOT sneak into the fallback", () => {
    const { narrativeUnavailable: _drop, ...rest } = FALLBACK_RAW;
    expect(briefOfResponse(rest)).toEqual({ kind: "unusable" });
  });

  it("digest lines print only facts the digest carries — no zero-filled rows", () => {
    const read = briefOfResponse(FALLBACK_RAW);
    if (read.kind !== "digest") throw new Error("expected digest state");
    const lines = digestLines(read.fallback);
    const byLabel = new Map(lines.map((l) => [l.label, l.value]));
    expect(byLabel.get("Followers")).toBe("1,204 (+31 this week)");
    expect(byLabel.get("Members")).toBe("42");
    expect(byLabel.has("Subscribers")).toBe(false);
    expect(byLabel.get("All-time revenue")).toBe("$123.45");
    expect(byLabel.get("Tips (Visual Bucs)")).toBe("800");
    expect(byLabel.get("Your catalog")).toBe("7 tracks · 3 videos");
    expect(byLabel.get("Top track")).toBe("Crown Talk — 512 plays");
    expect(byLabel.get("Waiting on you")).toBe("3 unread messages");
    expect(lines.filter((l) => l.label === "Waiting on you")).toHaveLength(1);
  });

  it("an all-null digest yields no lines (the desk shows its own empty line)", () => {
    const empty: BriefFallbackPayload = {
      narrativeUnavailable: true,
      digest: { audience: null, revenue: null, content: null, actions: null },
    };
    expect(digestLines(empty)).toEqual([]);
  });

  it("the action labels cover the digest's three waiting kinds", () => {
    expect(BRIEF_ACTION_LABELS["unreadMessages"]).toBe("unread messages");
    expect(BRIEF_ACTION_LABELS["pastDueMembers"]).toBe("members past due");
    expect(BRIEF_ACTION_LABELS["shoutoutsToDeliver"]).toBe("shoutouts waiting to deliver");
  });
});
