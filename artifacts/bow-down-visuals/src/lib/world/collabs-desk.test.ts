import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COLLAB_MATCH_COST_VB,
  COLLAB_MATCH_PATH,
  buildProfileBody,
  buildSendRequestBody,
  collabRespondPath,
  collabsProfilesPath,
  normalizeCollabProfiles,
  normalizeCollabRequests,
  parseMatchResult,
  parseMyCollabProfile,
  profileFormFrom,
  profileFormReady,
  requestStatusLabel,
  sendRequestReady,
  type CollabProfileForm,
} from "./collabs-desk";

/* ─── Collabs desk (stack1100 world parity) ────────────────────────
   Creator collaboration native in the Community Hall, on the
   collabs router's own rails. These tests pin the seam: browse
   cards + the three-state profile read, the upsert body against
   the rail's zod rules, the match answer (score or nothing), and
   the requests inbox with the rail's double opt-in lock intact. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const CARD = {
  userId: "u-2",
  displayName: "Wave Rider",
  niche: "gaming",
  nicheLabel: "Gaming",
  platforms: [{ platform: "twitch", label: "Twitch", followers: 42000, followersLabel: "42K" }],
  collabInterests: "Co-streams",
  bio: "FPS + music.",
  isOwn: false,
};

describe("rails + price", () => {
  it("the paths are the collabs page's own endpoints; the match price is the registry's pinned 100", () => {
    expect(collabsProfilesPath("")).toBe("/api/collabs/profiles");
    expect(collabsProfilesPath("gaming")).toBe("/api/collabs/profiles?niche=gaming");
    expect(collabRespondPath("r 1")).toBe("/api/collabs/requests/r%201/respond");
    expect(COLLAB_MATCH_PATH).toBe("/api/collabs/match");
    expect(COLLAB_MATCH_COST_VB).toBe(100);
    const costs = read("../credit-costs.ts");
    expect(costs).toContain('"/api/collabs/match": { cost: 100, feature: "Collab Match Report" }');
  });
});

describe("browse + my card", () => {
  it("cards normalize field-for-field; a broken payload is a failed read", () => {
    expect(normalizeCollabProfiles({ profiles: [CARD] })).toEqual([CARD]);
    expect(normalizeCollabProfiles({ profiles: [{ userId: "x" }] })).toBeNull();
    expect(normalizeCollabProfiles({})).toBeNull();
  });

  it("the profile read is three honest states — failed, none yet, ready", () => {
    expect(parseMyCollabProfile({ profile: null })).toEqual({ state: "none" });
    expect(parseMyCollabProfile({})).toEqual({ state: "failed" });
    const ready = parseMyCollabProfile({
      profile: {
        displayName: "Thy Cheat Code",
        niche: "music",
        platforms: [{ platform: "youtube", followers: 1200 }],
        collabInterests: "Duets",
        bio: "King Shark.",
        isPublic: true,
      },
    });
    expect(ready.state).toBe("ready");
    if (ready.state === "ready") {
      expect(ready.profile.platforms).toEqual([{ platform: "youtube", followers: 1200 }]);
      expect(profileFormFrom(ready.profile).platforms).toEqual([
        { platform: "youtube", followersText: "1200" },
      ]);
    }
  });
});

describe("the upsert form — the rail's zod rules", () => {
  const form: CollabProfileForm = {
    displayName: "Thy Cheat Code",
    niche: "music",
    platforms: [{ platform: "youtube", followersText: "1200" }],
    collabInterests: "Duets",
    bio: "",
    isPublic: true,
  };

  it("readiness enforces name, niche enum, platform rows and caps", () => {
    expect(profileFormReady(form)).toBe(true);
    expect(profileFormReady({ ...form, displayName: "" })).toBe(false);
    expect(profileFormReady({ ...form, niche: "space" })).toBe(false);
    expect(profileFormReady({ ...form, platforms: [{ platform: "myspace", followersText: "1" }] })).toBe(false);
    expect(profileFormReady({ ...form, platforms: [{ platform: "youtube", followersText: "1.5" }] })).toBe(false);
    expect(profileFormReady({ ...form, platforms: Array(7).fill({ platform: "x", followersText: "0" }) })).toBe(false);
    expect(profileFormReady({ ...form, bio: "b".repeat(501) })).toBe(false);
  });

  it("the body is the schema's shape — followers as numbers, words trimmed", () => {
    expect(buildProfileBody({ ...form, displayName: "  Thy Cheat Code " })).toEqual({
      displayName: "Thy Cheat Code",
      niche: "music",
      platforms: [{ platform: "youtube", followers: 1200 }],
      collabInterests: "Duets",
      bio: "",
      isPublic: true,
    });
  });
});

describe("the match answer", () => {
  it("parses the rail's report + credit lines; a scoreless answer is a failed read", () => {
    const parsed = parseMatchResult({
      report: {
        score: 87,
        verdict: "Great fit.",
        strengths: ["Shared audience"],
        risks: ["Time zones"],
        ideas: ["Duet stream"],
        targetDisplayName: "Wave Rider",
      },
      creditsUsed: 100,
      creditsRemaining: 900,
    });
    expect(parsed?.report.score).toBe(87);
    expect(parsed?.creditsRemaining).toBe(900);
    expect(parseMatchResult({ report: { verdict: "?" } })).toBeNull();
    expect(parseMatchResult({})).toBeNull();
  });
});

describe("requests — the double opt-in stays locked", () => {
  const inbox = {
    received: [
      {
        id: "r-1",
        message: "",
        status: "pending",
        createdAt: "2026-10-30T00:00:00.000Z",
        fromUserId: "u-2",
        fromDisplayName: "Wave Rider",
        fromNiche: "gaming",
        introLocked: true,
        lockedReason: "Accept to read the pitch.",
      },
    ],
    sent: [
      {
        id: "r-2",
        message: "Let's duet.",
        status: "accepted",
        createdAt: "2026-10-29T00:00:00.000Z",
        toUserId: "u-3",
        toDisplayName: "Beat Smith",
        toNiche: "music",
      },
    ],
  };

  it("normalizes both directions with the lock intact", () => {
    const parsed = normalizeCollabRequests(inbox);
    expect(parsed?.received[0]?.introLocked).toBe(true);
    expect(parsed?.received[0]?.lockedReason).toBe("Accept to read the pitch.");
    expect(parsed?.sent[0]?.status).toBe("accepted");
    expect(normalizeCollabRequests({ received: [] })).toBeNull();
  });

  it("statuses + the send rule speak plainly", () => {
    expect(requestStatusLabel("pending")).toBe("Waiting for an answer");
    expect(requestStatusLabel("accepted")).toBe("Accepted — you're connected");
    expect(requestStatusLabel("declined")).toBe("Declined");
    expect(sendRequestReady("  ")).toBe(false);
    expect(sendRequestReady("Let's work.")).toBe(true);
    expect(buildSendRequestBody("u-2", "  Let's work. ")).toEqual({ toUserId: "u-2", message: "Let's work." });
  });
});

describe("the desk is mounted in the Hall and rides the confirmation", () => {
  const deskSrc = read("../../components/world/native/CollabsDesk.tsx");
  const panelSrc = read("../../components/world/StationPanel.tsx");

  it("the panel opens it from the community-hall branch, after Events", () => {
    const hallAt = panelSrc.indexOf('station.id === "community-hall"');
    const eventsAt = panelSrc.indexOf("<EventsDesk");
    const collabsAt = panelSrc.indexOf("<CollabsDesk");
    expect(hallAt).toBeGreaterThan(-1);
    expect(eventsAt).toBeGreaterThan(hallAt);
    expect(collabsAt).toBeGreaterThan(eventsAt);
    expect(panelSrc).toContain('import { CollabsDesk } from "@/components/world/native/CollabsDesk"');
  });

  it("the match rides confirmedFetch with the pinned cost; a declined confirmation charges nothing", () => {
    expect(deskSrc).toContain('data-testid="world-collabs-desk"');
    expect(deskSrc).toContain("confirmedFetch(COLLAB_MATCH_PATH");
    expect(deskSrc).toContain("overrideCost: COLLAB_MATCH_COST_VB");
    expect(deskSrc).toContain("if (!res) return");
    /* The match button only arms with a saved card — no charge-then-refund dance. */
    expect(deskSrc).toContain("Save your card above and the matcher can read you both.");
    /* A failed requests read shows an error, never a painted-empty inbox. */
    expect(deskSrc).toContain("setRequestsFailed(true)");
  });
});
