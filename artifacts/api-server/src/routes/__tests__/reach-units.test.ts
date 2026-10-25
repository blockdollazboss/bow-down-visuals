/**
 * Unit tests for the Stack 9 "Reach" pure logic:
 *   - lib/multistream relayPlan — the codec/transport honesty matrix
 *     (WebM can't -c copy to RTMP; hosted transport has no on-box
 *     bytes to relay; bad ingest/key rejected) + key protection and
 *     log redaction.
 *   - lib/for-you — ranking factors + the honest per-item "why".
 *   - routes/reach premierePhase — the server-clock premiere window.
 *   - lib/loyalty perkMenu — the fixed perk menu incl. custom reward.
 *   - lib/close-friends audienceVisible — the read-time predicate
 *     every serving surface filters through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  // A valid token key so protectKey takes the encryption path.
  process.env["SOCIAL_TOKEN_KEY"] = "a".repeat(64);
});

import {
  relayPlan,
  buildRtmpTarget,
  redactRtmpTarget,
  protectKey,
  unprotectKey,
} from "../../lib/multistream";
import { affinityScore, forYouScore, whyReason, AFFINITY_WEIGHTS } from "../../lib/for-you";
import { premierePhase } from "../reach";
import { perkMenu } from "../../lib/loyalty";
import { audienceVisible, type AudienceContext } from "../../lib/close-friends";

const DEST = { platform: "youtube", ingestUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: "secret-key-123" };

describe("relayPlan — codec/transport honesty", () => {
  it("MP4 own-server source relays with -c copy to the joined RTMP target", () => {
    const plan = relayPlan({ transport: "own", container: "mp4", sourcePath: "/tmp/s/live/playlist.m3u8" }, DEST);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.args).toContain("-c");
      expect(plan.args).toContain("copy");
      expect(plan.target).toBe("rtmp://a.rtmp.youtube.com/live2/secret-key-123");
    }
  });

  it("WebM source is refused plainly — no fake live", () => {
    const plan = relayPlan({ transport: "own", container: "webm", sourcePath: "/tmp/s/live/playlist.m3u8" }, DEST);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.code).toBe("CODEC_UNSUPPORTED");
      expect(plan.reason).toMatch(/WebM/);
      expect(plan.reason).toMatch(/re-encod/i);
    }
  });

  it("hosted-transport streams have nothing on-box to relay", () => {
    const plan = relayPlan({ transport: "cloudflare", container: "mp4", sourcePath: "/tmp/x" }, DEST);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("WRONG_TRANSPORT");
  });

  it("no media yet → NO_SOURCE; non-RTMP ingest and empty key → BAD_INGEST", () => {
    expect(relayPlan({ transport: "own", container: null, sourcePath: null }, DEST).ok).toBe(false);
    const badUrl = relayPlan({ transport: "own", container: "mp4", sourcePath: "/x" }, { ...DEST, ingestUrl: "https://example.com/live" });
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.code).toBe("BAD_INGEST");
    const noKey = relayPlan({ transport: "own", container: "mp4", sourcePath: "/x" }, { ...DEST, streamKey: "  " });
    expect(noKey.ok).toBe(false);
  });
});

describe("stream keys — protection + redaction", () => {
  it("protectKey encrypts at rest and unprotectKey round-trips", () => {
    const stored = protectKey("secret-key-123");
    expect(stored).not.toContain("secret-key-123");
    expect(unprotectKey(stored)).toBe("secret-key-123");
  });

  it("buildRtmpTarget joins cleanly and redactRtmpTarget hides the key", () => {
    expect(buildRtmpTarget("rtmp://ingest.example.com/app/", "/key9")).toBe("rtmp://ingest.example.com/app/key9");
    const redacted = redactRtmpTarget("rtmp://ingest.example.com/app/key9");
    expect(redacted).not.toContain("key9");
    expect(redacted).toContain("ingest.example.com");
  });
});

describe("for-you ranking — named factors, honest why", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const base = {
    isFollowed: false,
    isOwn: false,
    affinity: 0,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    hasMedia: false,
    createdAtMs: now,
  };

  it("affinityScore weights recorded behavior (reaction>like>play, follow counts)", () => {
    expect(affinityScore({ reactions: 1, likes: 1, plays: 1, follows: 1 })).toBe(
      AFFINITY_WEIGHTS.reaction + AFFINITY_WEIGHTS.like + AFFINITY_WEIGHTS.play + AFFINITY_WEIGHTS.follow,
    );
  });

  it("followed creators outrank identical strangers; engagement beats stale", () => {
    expect(forYouScore({ ...base, isFollowed: true }, now)).toBeGreaterThan(forYouScore(base, now));
    expect(forYouScore({ ...base, affinity: 60 }, now)).toBeGreaterThan(forYouScore(base, now));
    expect(forYouScore({ ...base, likeCount: 50 }, now)).toBeGreaterThan(
      forYouScore({ ...base, likeCount: 50, createdAtMs: now - 72 * 3600_000 }, now),
    );
  });

  it("why names the strongest TRUE signal — never a fake one", () => {
    expect(whyReason({ ...base, isFollowed: true, affinity: 90 }, now).kind).toBe("following");
    expect(whyReason({ ...base, affinity: 90 }, now).kind).toBe("affinity");
    expect(whyReason({ ...base, likeCount: 4 }, now).kind).toBe("chart");
    expect(whyReason(base, now).kind).toBe("fresh");
    expect(whyReason({ ...base, isOwn: true, isFollowed: true }, now).kind).toBe("own");
  });
});

describe("premierePhase — server-clock window", () => {
  const start = Date.parse("2026-10-16T20:00:00Z");
  const p = { status: "scheduled", scheduled_at: new Date(start), duration_seconds: 600 };
  it("before start = scheduled; inside = live; after = ended; cancelled sticks", () => {
    expect(premierePhase(p, start - 1000)).toBe("scheduled");
    expect(premierePhase(p, start)).toBe("live");
    expect(premierePhase(p, start + 599_000)).toBe("live");
    expect(premierePhase(p, start + 600_000)).toBe("ended");
    expect(premierePhase({ ...p, status: "cancelled" }, start + 1000)).toBe("cancelled");
  });
});

describe("loyalty perkMenu — fixed menu only", () => {
  it("base perks always present; custom only when the creator named + priced it", () => {
    const base = perkMenu(null);
    expect(base.map((p) => p.kind)).toEqual(["shoutout", "priority_chat"]);
    const withCustom = perkMenu({
      profile_id: "p",
      enabled: true,
      watch_points_per_10min: 10,
      chat_points: 2,
      tip_points_per_100vb: 5,
      custom_reward_label: "Pick the next game",
      custom_reward_cost: 2500,
      updated_at: new Date(),
    });
    expect(withCustom[2]).toEqual({ kind: "custom", label: "Pick the next game", cost: 2500 });
  });
});

describe("audienceVisible — the read-time predicate", () => {
  const author = { userId: "author-user", profileId: "author-profile" };
  const ctx = (over: Partial<AudienceContext>): AudienceContext => ({
    viewerUserId: "viewer",
    viewerProfileId: "viewer-profile",
    followedProfileIds: new Set(),
    circleAuthorUserIds: new Set(),
    memberGates: new Map(),
    ...over,
  });
  it("public is public; the author always sees their own", () => {
    expect(audienceVisible("public", author, ctx({ viewerUserId: null, viewerProfileId: null }))).toBe(true);
    expect(audienceVisible("close_friends", author, ctx({ viewerUserId: "author-user", viewerProfileId: "author-profile" }))).toBe(true);
  });
  it("followers audience needs a follow; close_friends needs the circle — a follow alone is NOT enough", () => {
    expect(audienceVisible("followers", author, ctx({ followedProfileIds: new Set(["author-profile"]) }))).toBe(true);
    expect(audienceVisible("followers", author, ctx({}))).toBe(false);
    expect(audienceVisible("close_friends", author, ctx({ followedProfileIds: new Set(["author-profile"]) }))).toBe(false);
    expect(audienceVisible("close_friends", author, ctx({ circleAuthorUserIds: new Set(["author-user"]) }))).toBe(true);
    expect(audienceVisible("close_friends", author, ctx({ viewerUserId: null, viewerProfileId: null }))).toBe(false);
  });
});
