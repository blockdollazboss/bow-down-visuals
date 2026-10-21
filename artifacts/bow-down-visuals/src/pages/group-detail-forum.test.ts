/**
 * group-detail-forum.test.ts — source pins for the group forum tab
 * (Wave 3 #13, migration 0185): channels inside the group page,
 * threads inside a channel, replies inside a thread.
 *
 * The contract pinned here:
 *  (a) the forum lives INSIDE group-detail as a fourth tab — no
 *      standalone page or route was created for it;
 *  (b) every forum surface reads/writes through the group's forum
 *      endpoints, and moderation rides the shared api.patch verb
 *      (added to useCommunityApi alongside put);
 *  (c) permissions come from the SERVER's caps payload
 *      (can_post / can_moderate / can_manage_channels) — the page
 *      never re-derives the role ladder locally;
 *  (d) every node has an honest empty state: no channels, a channel
 *      with no threads, a thread with no replies — plus the
 *      read-only note for guests and non-members.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./group-detail.tsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../lib/community-ui.tsx", import.meta.url), "utf8");

describe("group forum tab — docked inside the group page", () => {
  it("the forum is a fourth tab on the group detail page", () => {
    expect(page).toContain('"about" | "feed" | "forum" | "members"');
    expect(page).toContain('(["about", "feed", "forum", "members"] as const)');
    expect(page).toContain('{tab === "forum" && (');
  });

  it("loads lazily on first forum visit, channels first", () => {
    expect(page).toContain('if (tab === "forum" && !forumLoaded)');
    expect(page).toContain("/api/groups/${slug}/forum/channels`");
  });
});

describe("group forum tab — endpoint wiring", () => {
  it("threads ride the open channel; one thread view carries its replies", () => {
    expect(page).toContain("/api/groups/${slug}/forum/channels/${id}/threads`");
    expect(page).toContain("/api/groups/${slug}/forum/channels/${channelId}/threads`");
    expect(page).toContain("/api/groups/${slug}/forum/threads/${id}`");
    expect(page).toContain("/api/groups/${slug}/forum/threads/${openThread.thread.id}/replies`");
  });

  it("channel close, thread delete and reply delete use the delete verb on the same rails", () => {
    expect(page).toContain("api.del(`/api/groups/${slug}/forum/channels/${id}`)");
    expect(page).toContain("api.del(`/api/groups/${slug}/forum/threads/${id}`)");
    expect(page).toContain("/forum/threads/${threadId}/replies/${replyId}`");
  });

  it("pin/lock rides api.patch, and the shared helper carries the verb", () => {
    expect(page).toContain("api.patch(`/api/groups/${slug}/forum/threads/${t.id}`, patch)");
    expect(ui).toContain('patch: useCallback((p: string, body?: unknown) => call(p, { method: "PATCH", body: body ?? {} }), [call])');
  });
});

describe("group forum tab — permissions come from the server caps", () => {
  it("caps are stored from the channels payload, not derived from viewer_role", () => {
    expect(page).toContain("can_manage_channels: d.can_manage_channels");
    expect(page).toContain("forumCaps.can_manage_channels");
    expect(page).toContain("forumCaps.can_post");
    expect(page).toContain("forumCaps.can_moderate");
  });

  it("the channel form and thread form render only behind their caps", () => {
    expect(page).toContain("showChannelForm && forumCaps.can_manage_channels");
    expect(page).toContain("showThreadForm && forumCaps.can_post && channelId");
  });

  it("a locked thread swaps the composer for the locked note (moderators keep theirs)", () => {
    expect(page).toContain("openThread.thread.is_locked && !forumCaps.can_moderate");
    expect(page).toContain("This thread is locked by the crew's moderators");
  });
});

describe("group forum tab — honest empty states at every node", () => {
  it("no channels, no threads, and no replies each say so", () => {
    expect(page).toContain("No channels yet — this crew hasn't opened its forum boards.");
    expect(page).toContain("No threads in this channel yet.");
    expect(page).toContain("No replies yet — be the first to answer.");
  });

  it("readers who cannot post are told why, guests and members apart", () => {
    expect(page).toContain("You're reading the forum — join the crew to start threads and reply.");
    expect(page).toContain("You're reading as a guest — sign in and join the crew to post.");
    expect(page).toContain("Join the crew to reply in this thread.");
  });
});
