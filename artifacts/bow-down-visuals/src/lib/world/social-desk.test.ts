/**
 * social-desk — the Social Desk's pure seam (NATIVE-PLAN §3.4).
 *
 * Pins:
 * - the DM rails are the messages page's EXACT paths (conversations,
 *   thread, send, start, resolve, accept/decline/block);
 * - the thread rules mirror messages.tsx (who may type, who sees
 *   the accept/decline rail, the draft gate);
 * - the community rails are the community/scheduler/PostCard pages'
 *   exact paths — superfans/sentiment are POST (they analyse a
 *   batch; there is no GET form on the server);
 * - the pin composer obeys the server's own limits (topic ≥ 2 for
 *   generation, body 1–500 for POST /api/posts) and the price gate
 *   data (platforms meta carries the cost);
 * - reaction math mirrors PostCard (tap = set, same tap = remove,
 *   never below zero);
 * - the follow-on log names moderation + full threads as
 *   transfer-only in v1;
 * - source pins: the desk components ride these builders, the host
 *   dispatches pattern "social" to them, and the host still renders
 *   the ONE TransferFooter for native resolutions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DM_CONVERSATIONS_PATH, DM_START_PATH,
  dmMessagesPath, dmSendPath, dmRequestActionPath, profileResolvePath,
  dmConversationName, dmCanChat, dmNeedsAnswer, dmCanSendDraft,
  dmUnreadTotal, dmFindConversation, normalizeDmConversations,
  COMMUNITY_SUPERFANS_PATH, COMMUNITY_SENTIMENT_PATH,
  GENERATE_COMMUNITY_POST_PATH, COMMUNITY_POST_PLATFORMS_PATH, POSTS_PATH,
  REACT_PATH, reactRemovePath, feedPath, postRepliesPath,
  commentsBatchFromPosts, pinTopicReady, postBodyReady,
  nextReactionState, repliesPreview, REPLIES_PREVIEW_COUNT,
  SOCIAL_NATIVE_FOLLOW_ONS,
  type DmConversation,
} from "./social-desk";
import type { FeedPost } from "@/lib/social-api";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/SocialDesk.tsx");
const panelSrc = read("../../components/world/StationPanel.tsx");

function conv(over: Partial<DmConversation> = {}): DmConversation {
  return {
    id: "c1",
    status: "inbox",
    requested_by_me: false,
    other: { user_id: "u2", profile: { slug: "bee", displayName: "Queen Bee", avatarUrl: null } },
    last_message: null,
    unread: 0,
    last_message_at: null,
    ...over,
  };
}

function post(over: Partial<FeedPost> = {}): FeedPost {
  return {
    id: "p1",
    profile_id: "prof1",
    body: "hello hall",
    media_urls: [],
    kind: "post",
    reply_to: null,
    quote_of: null,
    repost_of: null,
    group_id: null,
    scheduled_for: null,
    audience: "public",
    like_count: 0,
    repost_count: 0,
    reply_count: 0,
    created_at: "2026-10-17T00:00:00Z",
    author: { id: "prof1", slug: "bee", display_name: "Queen Bee", avatar_url: null, is_verified: false },
    viewer_emoji: null,
    viewer_saved: false,
    reaction_counts: {},
    quoted: null,
    poll: null,
    ...over,
  };
}

describe("DM endpoints — the messages page's exact rails", () => {
  it("pins every path verbatim", () => {
    expect(DM_CONVERSATIONS_PATH).toBe("/api/dm/conversations");
    expect(DM_START_PATH).toBe("/api/dm/start");
    expect(dmMessagesPath("c 1")).toBe("/api/dm/c%201/messages");
    expect(dmSendPath("c1")).toBe("/api/dm/c1/send");
    expect(dmRequestActionPath("c1", "accept")).toBe("/api/dm/c1/accept");
    expect(dmRequestActionPath("c1", "decline")).toBe("/api/dm/c1/decline");
    expect(dmRequestActionPath("c1", "block")).toBe("/api/dm/c1/block");
    expect(profileResolvePath("  Shark-King ")).toBe("/api/profiles/resolve?slug=shark-king");
  });
});

describe("DM thread rules — mirrored from messages.tsx", () => {
  it("inbox threads are chattable; my own requests are chattable; theirs are not", () => {
    expect(dmCanChat("inbox", conv())).toBe(true);
    expect(dmCanChat("request", conv({ requested_by_me: true }))).toBe(true);
    expect(dmCanChat("request", conv({ requested_by_me: false }))).toBe(false);
    expect(dmCanChat("inbox", null)).toBe(false);
  });

  it("only an incoming request needs an answer", () => {
    expect(dmNeedsAnswer("request", conv({ requested_by_me: false }))).toBe(true);
    expect(dmNeedsAnswer("request", conv({ requested_by_me: true }))).toBe(false);
    expect(dmNeedsAnswer("inbox", conv())).toBe(false);
  });

  it("the draft gate needs a chattable thread and real words", () => {
    expect(dmCanSendDraft("hello", true)).toBe(true);
    expect(dmCanSendDraft("   ", true)).toBe(false);
    expect(dmCanSendDraft("hello", false)).toBe(false);
  });

  it("names, unread totals, lookup and payload guards behave", () => {
    expect(dmConversationName(conv())).toBe("Queen Bee");
    expect(dmConversationName(conv({ other: { user_id: "u2", profile: null } }))).toBe("Creator");
    expect(dmUnreadTotal([conv({ unread: 2 }), conv({ unread: 3 }), conv({ unread: -1 })])).toBe(5);
    const a = conv({ id: "a" });
    const b = conv({ id: "b" });
    expect(dmFindConversation([a], [b], "b")).toBe(b);
    expect(dmFindConversation([a], [b], null)).toBeNull();
    expect(normalizeDmConversations({ inbox: [a] })).toEqual({ inbox: [a], requests: [] });
    expect(normalizeDmConversations(null)).toEqual({ inbox: [], requests: [] });
    expect(normalizeDmConversations({ inbox: "nope", requests: 4 })).toEqual({ inbox: [], requests: [] });
  });
});

describe("community endpoints — the pages' exact rails", () => {
  it("pins every path verbatim (superfans/sentiment are POST-only on the server)", () => {
    expect(COMMUNITY_SUPERFANS_PATH).toBe("/api/community/superfans");
    expect(COMMUNITY_SENTIMENT_PATH).toBe("/api/community/sentiment");
    expect(GENERATE_COMMUNITY_POST_PATH).toBe("/api/generate-community-post");
    expect(COMMUNITY_POST_PLATFORMS_PATH).toBe("/api/community-post-platforms");
    expect(POSTS_PATH).toBe("/api/posts");
    expect(REACT_PATH).toBe("/api/react");
    expect(reactRemovePath("p 1")).toBe("/api/react?target_kind=post&target_id=p%201");
    expect(postRepliesPath("p1")).toBe("/api/posts/p1/replies");
    expect(feedPath(12)).toBe("/api/feed?mode=chrono&limit=12");
    expect(feedPath(0)).toBe("/api/feed?mode=chrono&limit=1");
    expect(feedPath(999)).toBe("/api/feed?mode=chrono&limit=30");
  });
});

describe("community pure helpers", () => {
  it("the scan batch is the board's own posts, in the page's input shape", () => {
    const batch = commentsBatchFromPosts([
      post({ body: "  loved this  " }),
      post({ body: "   " }),
      post({ body: "second", author: null }),
    ]);
    expect(batch).toEqual([
      { author: "bee", text: "loved this" },
      { author: "creator", text: "second" },
    ]);
  });

  it("pin gates follow the server's own limits", () => {
    expect(pinTopicReady(" x ")).toBe(false);
    expect(pinTopicReady("drop day")).toBe(true);
    expect(postBodyReady("")).toBe(false);
    expect(postBodyReady("a".repeat(500))).toBe(true);
    expect(postBodyReady("a".repeat(501))).toBe(false);
  });

  it("reaction math mirrors PostCard: set, swap, remove, floor at zero", () => {
    expect(nextReactionState(null, {}, "like")).toEqual({ emoji: "like", counts: { like: 1 } });
    expect(nextReactionState("like", { like: 3 }, "like")).toEqual({ emoji: null, counts: { like: 2 } });
    expect(nextReactionState("like", { like: 1, fire: 2 }, "fire")).toEqual({
      emoji: "fire",
      counts: { like: 0, fire: 3 },
    });
    expect(nextReactionState("like", { like: 0 }, "like").counts.like).toBe(0);
  });

  it("the replies preview is capped — the full thread is the transfer's job", () => {
    expect(REPLIES_PREVIEW_COUNT).toBe(3);
    expect(repliesPreview([1, 2, 3, 4, 5])).toEqual([1, 2, 3]);
  });
});

describe("the parity follow-on log", () => {
  it("names moderation and full threads as transfer-only in v1", () => {
    const ids = SOCIAL_NATIVE_FOLLOW_ONS.map((f) => f.id);
    expect(ids).toContain("moderation-bench");
    expect(ids).toContain("full-comment-threads");
    const mod = SOCIAL_NATIVE_FOLLOW_ONS.find((f) => f.id === "moderation-bench")!;
    expect(mod.label).toContain("/api/community/moderate");
  });
});

describe("source pins — the desk and its host dispatch", () => {
  it("the desk components ride the lib builders, never hand-rolled paths", () => {
    for (const needle of [
      "DM_CONVERSATIONS_PATH", "dmMessagesPath", "dmSendPath", "dmRequestActionPath",
      "profileResolvePath", "COMMUNITY_SUPERFANS_PATH", "COMMUNITY_SENTIMENT_PATH",
      "GENERATE_COMMUNITY_POST_PATH", "POSTS_PATH", "feedPath", "postRepliesPath",
    ]) {
      expect(deskSrc, needle).toContain(needle);
    }
    expect(deskSrc).toContain('data-testid="world-post-office"');
    expect(deskSrc).toContain('data-testid="world-community-hall"');
    expect(deskSrc).toContain('data-testid="world-dm-send"');
    expect(deskSrc).toContain('data-testid="world-dm-accept"');
    expect(deskSrc).toContain('data-testid="world-community-pin-post"');
  });

  it("moderation is never called from the desk — transfer-only in v1", () => {
    expect(deskSrc).not.toContain("/api/community/moderate");
    expect(deskSrc).toContain("Moderation stays on the website");
  });

  it("the host dispatches pattern social by station id, inside the native branch", () => {
    expect(panelSrc).toContain('resolution.pattern === "social"');
    expect(panelSrc).toContain('station.id === "post-office"');
    expect(panelSrc).toContain('station.id === "community-hall"');
    expect(panelSrc).toContain("<PostOfficeDesk isLight={isLight} />");
    expect(panelSrc).toContain("<CommunityHallBoard isLight={isLight} isGuest={isGuest} />");
    // The host still renders exactly one TransferFooter for native
    // resolutions — the desks render none of their own.
    expect(deskSrc).not.toContain("TransferFooter");
  });
});
