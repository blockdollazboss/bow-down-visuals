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
 * - Ring 2 (2.17–2.19): attachment classification/presentation +
 *   thread search, the FULL thread (no preview cap), the reply
 *   bench's batching + server-priced seam, and the follow-on log
 *   keeping only moderation transfer-only;
 * - STACK-20 #15: the composer's reply draft persists server-side —
 *   the draft rail's path, payload guard and save-decision seam, and
 *   the desk wiring (restore on open, debounced save, flush on
 *   switch/close, markers cleared on send);
 * - source pins: the desk components ride these builders, the host
 *   dispatches pattern "social" to them, and the host still renders
 *   the ONE TransferFooter for native resolutions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DM_CONVERSATIONS_PATH, DM_START_PATH, DM_ATTACHMENT_UPLOAD_PATH,
  dmMessagesPath, dmSendPath, dmRequestActionPath, profileResolvePath,
  dmConversationName, dmCanChat, dmNeedsAnswer, dmCanSendDraft,
  dmUnreadTotal, dmFindConversation, normalizeDmConversations,
  dmMessageAttachment, dmAttachmentKindForMime, dmAttachmentKindForUrl,
  dmAttachmentNameForUrl, dmWorkLabel, dmFilterMessages, dmConversationMatches,
  dmDraftPath, normalizeDmDraft, dmDraftSaveDecision,
  COMMUNITY_SUPERFANS_PATH, COMMUNITY_SENTIMENT_PATH,
  GENERATE_COMMUNITY_POST_PATH, COMMUNITY_POST_PLATFORMS_PATH, POSTS_PATH,
  REACT_PATH, reactRemovePath, feedPath, postRepliesPath, postReplyPath,
  COMMENT_REPLIES_PATH, COMMENT_REPLIES_META_PATH,
  REPLY_DRAFT_TONES, replyDraftBatch,
  commentsBatchFromPosts, pinTopicReady, postBodyReady,
  nextReactionState, fullThread,
  SOCIAL_NATIVE_FOLLOW_ONS, SOCIAL_RING2_PROMOTIONS,
  type DmConversation, type DmMessage,
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
    expect(DM_ATTACHMENT_UPLOAD_PATH).toBe("/api/dm/attachments/upload");
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

  it("a staged attachment completes an empty draft — but only in a chattable thread", () => {
    expect(dmCanSendDraft("", true, true)).toBe(true);
    expect(dmCanSendDraft("   ", true, true)).toBe(true);
    expect(dmCanSendDraft("", false, true)).toBe(false);
    expect(dmCanSendDraft("", true, false)).toBe(false);
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
    expect(postReplyPath("p 1")).toBe("/api/posts/p%201/reply");
    expect(COMMENT_REPLIES_PATH).toBe("/api/comment-replies");
    expect(COMMENT_REPLIES_META_PATH).toBe("/api/comment-replies/meta");
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

  it("the full thread is the whole thread — no preview cap (2.18)", () => {
    expect(fullThread([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(fullThread([])).toEqual([]);
  });
});

describe("DM attachments (2.17) — classification and presentation", () => {
  it("classifies picked files by MIME the way the server's filter does", () => {
    expect(dmAttachmentKindForMime("audio/mpeg")).toBe("audio");
    expect(dmAttachmentKindForMime("video/mp4")).toBe("video");
    expect(dmAttachmentKindForMime("image/png")).toBe("image");
    expect(dmAttachmentKindForMime("text/plain")).toBeNull();
    expect(dmAttachmentKindForMime("application/pdf")).toBeNull();
  });

  it("classifies by-URL attachments from the file ending, and titles them", () => {
    expect(dmAttachmentKindForUrl("https://cdn.example.com/work/beat.mp3?x=1")).toBe("audio");
    expect(dmAttachmentKindForUrl("https://cdn.example.com/cover.JPG")).toBe("image");
    expect(dmAttachmentKindForUrl("https://cdn.example.com/clip.webm")).toBe("video");
    expect(dmAttachmentKindForUrl("https://example.com/page")).toBeNull();
    expect(dmAttachmentKindForUrl("not a url")).toBeNull();
    expect(dmAttachmentNameForUrl("https://cdn.example.com/work/my%20beat.mp3")).toBe("my beat.mp3");
  });

  it("a message's attachment reads back as one tidy, valid object", () => {
    const m: DmMessage = {
      id: "m1", senderUserId: "u1", body: "", created_at: "2026-10-17T00:00:00Z",
      attachment_url: "https://signed.example/x", attachment_type: "audio", attachment_name: "beat.mp3",
    };
    expect(dmMessageAttachment(m)).toEqual({ url: "https://signed.example/x", type: "audio", name: "beat.mp3" });
    expect(dmMessageAttachment({ ...m, attachment_url: null })).toBeNull();
    expect(dmMessageAttachment({ ...m, attachment_type: "document" })).toBeNull();
    expect(dmMessageAttachment({ id: "m2", senderUserId: "u1", body: "hi", created_at: "" })).toBeNull();
  });

  it("work is introduced as what it is — a beat, a clip, artwork", () => {
    expect(dmWorkLabel("audio")).toBe("Beat");
    expect(dmWorkLabel("video")).toBe("Clip");
    expect(dmWorkLabel("image")).toBe("Artwork");
  });
});

describe("DM thread search (2.17)", () => {
  const msgs: DmMessage[] = [
    { id: "1", senderUserId: "u1", body: "that hook is fire", created_at: "" },
    {
      id: "2", senderUserId: "u2", body: "", created_at: "",
      attachment_url: "https://x", attachment_type: "audio", attachment_name: "midnight-beat.mp3",
    },
    { id: "3", senderUserId: "u1", body: "send the stems Friday", created_at: "" },
  ];

  it("searches words and work titles alike; an empty query keeps everything", () => {
    expect(dmFilterMessages(msgs, "hook").map((m) => m.id)).toEqual(["1"]);
    expect(dmFilterMessages(msgs, "MIDNIGHT").map((m) => m.id)).toEqual(["2"]);
    expect(dmFilterMessages(msgs, "  ")).toHaveLength(3);
    expect(dmFilterMessages(msgs, "nope")).toEqual([]);
  });

  it("conversation search covers name, slug, last words and last work", () => {
    expect(dmConversationMatches(conv(), "queen")).toBe(true);
    expect(dmConversationMatches(conv(), "bee")).toBe(true);
    expect(dmConversationMatches(conv({
      last_message: { body: "", createdAt: "", senderUserId: "u2", attachment_type: "audio", attachment_name: "final-mix.wav" },
    }), "final-mix")).toBe(true);
    expect(dmConversationMatches(conv(), "stranger")).toBe(false);
    expect(dmConversationMatches(conv(), "")).toBe(true);
  });
});

describe("DM reply drafts (STACK-20 #15) — the composer's words, persisted", () => {
  it("the draft rail is the thread's own sub-path", () => {
    expect(dmDraftPath("c1")).toBe("/api/dm/c1/draft");
    expect(dmDraftPath("c 1/x")).toBe("/api/dm/c%201%2Fx/draft");
  });

  it("a saved draft reads back exactly; anything malformed reads as no draft", () => {
    expect(normalizeDmDraft({ draft: { body: "half a thought", updated_at: "2026-10-18T19:00:00.000Z" } }))
      .toEqual({ body: "half a thought", updatedAt: "2026-10-18T19:00:00.000Z" });
    expect(normalizeDmDraft({ draft: { body: "no stamp" } })).toEqual({ body: "no stamp", updatedAt: null });
    expect(normalizeDmDraft({ draft: null })).toBeNull();
    expect(normalizeDmDraft({ draft: { body: "" } })).toBeNull();
    expect(normalizeDmDraft({ draft: { body: 42 } })).toBeNull();
    expect(normalizeDmDraft({})).toBeNull();
    expect(normalizeDmDraft(null)).toBeNull();
    expect(normalizeDmDraft(undefined)).toBeNull();
  });

  it("the save decision: skip what's saved, save new words, clear a blanked composer", () => {
    expect(dmDraftSaveDecision("same words", "same words")).toBe("skip");
    expect(dmDraftSaveDecision("", "")).toBe("skip");
    expect(dmDraftSaveDecision("new words", "")).toBe("save");
    expect(dmDraftSaveDecision("edited words", "old words")).toBe("save");
    expect(dmDraftSaveDecision("", "old words")).toBe("clear");
    expect(dmDraftSaveDecision("   ", "old words")).toBe("clear");
  });

  it("the desk wires the whole lifecycle: restore on open, save, flush, clear-on-send", () => {
    /* Restore: opening a thread fetches its draft and normalizes it. */
    expect(deskSrc).toContain("normalizeDmDraft(d)");
    expect(deskSrc).toContain("setDraft(saved.body)");
    /* Save + flush: one persist helper on the builder path, consulted
       by the debounce, the switch flush and the unmount flush. */
    expect(deskSrc).toContain("dmDraftPath(convId)");
    expect(deskSrc).toContain('method: "PUT", body: { body: text }');
    expect(deskSrc).toContain("dmDraftSaveDecision(");
    expect(deskSrc).toContain("void persistDraft(prevId, prevText)");
    expect(deskSrc).toContain("void persistDraft(id, draftTextRef.current)");
    /* Send: the server cleared the row; the local markers agree. */
    expect(deskSrc).toContain("savedTextRef.current = \"\";");
  });
});

describe("reply-drafts bench seam (2.19)", () => {
  it("the tones mirror the server's enum, in order", () => {
    expect(REPLY_DRAFT_TONES.map((t) => t.key)).toEqual(["hype", "grateful", "playful", "professional"]);
  });

  it("the batch is one comment per line, capped at the route's own max", () => {
    expect(replyDraftBatch(" one \n\n two\nthree ", 10)).toEqual(["one", "two", "three"]);
    expect(replyDraftBatch("a\nb\nc", 2)).toEqual(["a", "b"]);
    expect(replyDraftBatch("", 10)).toEqual([]);
  });
});

describe("the parity follow-on log", () => {
  it("only moderation stays transfer-only — Ring 2 promoted the rest", () => {
    const ids = SOCIAL_NATIVE_FOLLOW_ONS.map((f) => f.id);
    expect(ids).toEqual(["moderation-bench"]);
    const mod = SOCIAL_NATIVE_FOLLOW_ONS.find((f) => f.id === "moderation-bench")!;
    expect(mod.label).toContain("/api/community/moderate");
  });

  it("the Ring 2 promotions are recorded in the program's own numbering", () => {
    expect(SOCIAL_RING2_PROMOTIONS.map((p) => [p.id, p.item])).toEqual([
      ["dm-attachments", "2.17"],
      ["full-comment-threads", "2.18"],
      ["reply-drafts-bench", "2.19"],
    ]);
  });
});

describe("source pins — the desk and its host dispatch", () => {
  it("the desk components ride the lib builders, never hand-rolled paths", () => {
    for (const needle of [
      "DM_CONVERSATIONS_PATH", "dmMessagesPath", "dmSendPath", "dmRequestActionPath",
      "profileResolvePath", "COMMUNITY_SUPERFANS_PATH", "COMMUNITY_SENTIMENT_PATH",
      "GENERATE_COMMUNITY_POST_PATH", "POSTS_PATH", "feedPath", "postRepliesPath",
      "DM_ATTACHMENT_UPLOAD_PATH", "postReplyPath", "COMMENT_REPLIES_PATH",
      "COMMENT_REPLIES_META_PATH", "dmDraftPath",
    ]) {
      expect(deskSrc, needle).toContain(needle);
    }
    expect(deskSrc).toContain('data-testid="world-post-office"');
    expect(deskSrc).toContain('data-testid="world-community-hall"');
    expect(deskSrc).toContain('data-testid="world-dm-send"');
    expect(deskSrc).toContain('data-testid="world-dm-accept"');
    expect(deskSrc).toContain('data-testid="world-community-pin-post"');
    /* Ring 2 surfaces exist in the desk, not just the lib. */
    expect(deskSrc).toContain('data-testid="world-dm-attach"');
    expect(deskSrc).toContain('data-testid="world-dm-attachment"');
    expect(deskSrc).toContain('data-testid="world-dm-attachment-audio"');
    expect(deskSrc).toContain('data-testid="world-dm-search"');
    expect(deskSrc).toContain('data-testid="world-dm-thread-search"');
    expect(deskSrc).toContain('data-testid="world-community-reply-send"');
    expect(deskSrc).toContain('data-testid="world-community-bench-draft"');
    expect(deskSrc).toContain('data-testid="world-community-bench-post"');
  });

  it("attachments are presented as titled work with a player, never a file chip", () => {
    expect(deskSrc).toContain("<audio controls");
    expect(deskSrc).toContain("<video controls");
    expect(deskSrc).toContain("dmWorkLabel(att.type)");
    expect(deskSrc).toContain("hand-off");
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
