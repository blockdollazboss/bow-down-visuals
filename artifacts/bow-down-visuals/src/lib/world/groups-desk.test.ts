import { describe, expect, it } from "vitest";
import {
  GROUPS_PATH, groupsSearchPath, groupsMinePath, groupPath, groupJoinPath, groupLeavePath,
  groupFeedPath, groupPostsPath, groupPostPath, forumChannelsPath, forumChannelPath,
  forumChannelThreadsPath, forumThreadPath, forumThreadRepliesPath, forumReplyPath,
  normalizeGroups, normalizeGroupDetail, normalizeGroupFeed, normalizeForumChannels,
  normalizeForumThreads, normalizeForumThreadDetail, forumCapsOf, forumChannelKnock,
  groupMembershipAction, groupFeedCanPost, forumReplyAllowed, forumModerationVisible,
  groupSlugFromName, groupSlugValid, groupCreateReady, buildGroupCreateBody,
  stashPendingGroupSlug, takePendingGroupSlug, PENDING_GROUP_KEY,
  type ForumThread,
} from "./groups-desk";

describe("76/77 — rail paths are the 2D groups pages' own strings", () => {
  it("builds every groups + forum path on /api/groups", () => {
    expect(GROUPS_PATH).toBe("/api/groups");
    expect(groupsSearchPath("")).toBe("/api/groups");
    expect(groupsSearchPath(" beat makers ")).toBe("/api/groups?q=beat%20makers");
    expect(groupsMinePath("u-1")).toBe("/api/groups?member=u-1");
    expect(groupPath("beat-makers")).toBe("/api/groups/beat-makers");
    expect(groupJoinPath("beat-makers")).toBe("/api/groups/beat-makers/join");
    expect(groupLeavePath("beat-makers")).toBe("/api/groups/beat-makers/leave");
    expect(groupFeedPath("beat-makers")).toBe("/api/groups/beat-makers/feed");
    expect(groupPostsPath("beat-makers")).toBe("/api/groups/beat-makers/posts");
    expect(groupPostPath("beat-makers", "p1")).toBe("/api/groups/beat-makers/posts/p1");
    expect(forumChannelsPath("beat-makers")).toBe("/api/groups/beat-makers/forum/channels");
    expect(forumChannelPath("beat-makers", "c1")).toBe("/api/groups/beat-makers/forum/channels/c1");
    expect(forumChannelThreadsPath("beat-makers", "c1")).toBe("/api/groups/beat-makers/forum/channels/c1/threads");
    expect(forumThreadPath("beat-makers", "t1")).toBe("/api/groups/beat-makers/forum/threads/t1");
    expect(forumThreadRepliesPath("beat-makers", "t1")).toBe("/api/groups/beat-makers/forum/threads/t1/replies");
    expect(forumReplyPath("beat-makers", "t1", "r1")).toBe("/api/groups/beat-makers/forum/threads/t1/replies/r1");
  });
});

const groupRow = {
  id: "g1", slug: "beat-makers", name: "Beat Makers", description: "We make beats",
  cover_url: null, owner_profile_id: "pr1", member_count: 12, is_public: true,
  created_at: "2026-10-01T00:00:00Z",
};

describe("76 — normalizers read the rail's snake_case DTOs", () => {
  it("normalizes the group list and drops malformed rows", () => {
    const groups = normalizeGroups({ groups: [groupRow, { name: "no slug" }, null] });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ slug: "beat-makers", member_count: 12, is_public: true });
    expect(normalizeGroups({})).toEqual([]);
    expect(normalizeGroups(null)).toEqual([]);
  });

  it("normalizes detail with viewer_role, owner and member cards", () => {
    const detail = normalizeGroupDetail({
      group: groupRow,
      owner_profile: { slug: "king", displayName: "King" },
      members: [{ user_id: "u1", role: "owner", joined_at: "x", profile: { slug: "king", displayName: "King", avatarUrl: null } }],
      viewer_role: "member",
    });
    expect(detail?.viewer_role).toBe("member");
    expect(detail?.owner_profile?.slug).toBe("king");
    expect(detail?.members[0]?.profile?.displayName).toBe("King");
    expect(normalizeGroupDetail({ group: null })).toBeNull();
  });

  it("normalizes the feed with per-post can_delete from the rail", () => {
    const feed = normalizeGroupFeed({
      viewer_role: "mod",
      posts: [
        { id: "p1", body: "hi", like_count: 3, created_at: "t", author_user_id: "u1", author: { slug: "a", displayName: "A", avatarUrl: null }, can_delete: true },
        { id: "p2", body: "yo", like_count: 0, created_at: "t", author_user_id: "u2", author: null, can_delete: false },
      ],
    });
    expect(feed.viewer_role).toBe("mod");
    expect(feed.posts.map((p) => p.can_delete)).toEqual([true, false]);
  });
});

describe("77 — forum normalizers + caps come from the rail", () => {
  it("channels carry thread counts and the viewer caps", () => {
    const { channels, caps } = normalizeForumChannels({
      channels: [{ id: "c1", group_id: "g1", name: "General", description: "", position: 0, thread_count: 4, created_at: "t" }],
      viewer_role: "admin", can_post: true, can_moderate: true, can_manage_channels: true,
    });
    expect(channels[0]).toMatchObject({ name: "General", thread_count: 4 });
    expect(caps).toEqual({ viewer_role: "admin", can_post: true, can_moderate: true, can_manage_channels: true });
  });

  it("tier-gated channels (#19) normalize their gate + knock, and gate options ride along", () => {
    const { channels, gateOptions } = normalizeForumChannels({
      channels: [
        {
          id: "c1", name: "VIP Lounge", description: "", thread_count: 2,
          min_fan_tier_id: "t2",
          gate: {
            tier_id: "t2", tier_name: "Silver", viewer_has_access: false, viewer_status: "lapsed",
            knock: {
              message: "Your membership has ended…", history_note: "Your posts are never deleted…",
              join_url: "/memberships?creator=owner-1", viewer_status: "lapsed",
              required_tier: { id: "t2", name: "Silver" },
            },
          },
        },
        { id: "c2", name: "General", description: "", thread_count: 5, min_fan_tier_id: null, gate: null },
      ],
      gate_options: [{ id: "t1", name: "Bronze" }, { id: "t2", name: "Silver" }],
      viewer_role: "member", can_post: true, can_moderate: false, can_manage_channels: false,
    });
    expect(channels[0]!.gate?.tier_name).toBe("Silver");
    expect(forumChannelKnock(channels[0]!)?.join_url).toBe("/memberships?creator=owner-1");
    expect(forumChannelKnock(channels[0]!)?.viewer_status).toBe("lapsed");
    expect(channels[1]!.gate).toBeNull();
    expect(forumChannelKnock(channels[1]!)).toBeNull();
    expect(gateOptions.map((t) => t.name)).toEqual(["Bronze", "Silver"]);
  });

  it("a gated channel the viewer CAN enter has no knock", () => {
    const { channels } = normalizeForumChannels({
      channels: [{
        id: "c1", name: "VIP", description: "", thread_count: 0, min_fan_tier_id: "t2",
        gate: { tier_id: "t2", tier_name: "Silver", viewer_has_access: true, viewer_status: null, knock: null },
      }],
    });
    expect(channels[0]!.gate?.viewer_has_access).toBe(true);
    expect(forumChannelKnock(channels[0]!)).toBeNull();
  });

  it("thread detail carries pin/lock, replies and per-row can_delete", () => {
    const detail = normalizeForumThreadDetail({
      thread: {
        id: "t1", channel_id: "c1", group_id: "g1", title: "Rules", body: "Be kind",
        tags: ["rules"], reply_count: 1, last_reply_at: "t", is_pinned: true, is_locked: false,
        created_at: "t", author_user_id: "u1", author: { slug: "a", displayName: "A", avatarUrl: null },
        can_delete: false, can_moderate: true,
      },
      replies: [{ id: "r1", thread_id: "t1", body: "Agreed", created_at: "t", author_user_id: "u2", author: null, can_delete: true }],
      viewer_role: "mod", can_post: true, can_moderate: true, can_manage_channels: false,
    });
    expect(detail?.thread.is_pinned).toBe(true);
    expect(detail?.thread.can_moderate).toBe(true);
    expect(detail?.replies[0]?.can_delete).toBe(true);
    expect(detail?.caps.can_manage_channels).toBe(false);
    expect(normalizeForumThreadDetail({ thread: null })).toBeNull();
  });

  it("caps default closed when the rail omits them", () => {
    expect(forumCapsOf({})).toEqual({
      viewer_role: null, can_post: false, can_moderate: false, can_manage_channels: false,
    });
    expect(normalizeForumThreads({ threads: [] }).threads).toEqual([]);
  });
});

describe("76/77 — verb visibility follows the rail, guest law holds", () => {
  it("membership action: guest signs in, owner stays, member leaves, stranger joins", () => {
    expect(groupMembershipAction(null, true)).toBe("sign-in");
    expect(groupMembershipAction("owner", false)).toBe("owner");
    expect(groupMembershipAction("member", false)).toBe("leave");
    expect(groupMembershipAction("mod", false)).toBe("leave");
    expect(groupMembershipAction(null, false)).toBe("join");
  });

  it("feed posting is members-only", () => {
    expect(groupFeedCanPost("member", false)).toBe(true);
    expect(groupFeedCanPost(null, false)).toBe(false);
    expect(groupFeedCanPost("member", true)).toBe(false);
  });

  const thread = (over: Partial<ForumThread>): ForumThread => ({
    id: "t1", channel_id: "c1", title: "T", body: "", tags: [], reply_count: 0,
    is_pinned: false, is_locked: false, created_at: "", author: null,
    can_delete: false, can_moderate: false, ...over,
  });
  const caps = (over: Partial<ReturnType<typeof forumCapsOf>>) => ({
    viewer_role: "member", can_post: true, can_moderate: false, can_manage_channels: false, ...over,
  });

  it("locked threads close to members but stay open to moderators (the rail's rule)", () => {
    expect(forumReplyAllowed(thread({ is_locked: true }), caps({}), false)).toBe(false);
    expect(forumReplyAllowed(thread({ is_locked: true }), caps({ can_moderate: true }), false)).toBe(true);
    expect(forumReplyAllowed(thread({}), caps({}), false)).toBe(true);
    expect(forumReplyAllowed(thread({}), caps({ can_post: false }), false)).toBe(false);
    expect(forumReplyAllowed(thread({}), caps({}), true)).toBe(false);
  });

  it("pin/lock buttons show only where the rail's DTO says the viewer moderates", () => {
    expect(forumModerationVisible(thread({ can_moderate: true }), false)).toBe(true);
    expect(forumModerationVisible(thread({ can_moderate: false }), false)).toBe(false);
    expect(forumModerationVisible(thread({ can_moderate: true }), true)).toBe(false);
  });
});

describe("76 — create form follows the rail's slug law", () => {
  it("derives a lawful slug from a name", () => {
    expect(groupSlugFromName("Beat Makers!!")).toBe("beat-makers");
    expect(groupSlugFromName("  The 808 Club  ")).toBe("the-808-club");
    expect(groupSlugValid(groupSlugFromName("Beat Makers"))).toBe(true);
  });
  it("validates slugs exactly like the rail regex (3–40, no edge hyphens)", () => {
    expect(groupSlugValid("ab")).toBe(false);
    expect(groupSlugValid("abc")).toBe(true);
    expect(groupSlugValid("-abc")).toBe(false);
    expect(groupSlugValid("abc-")).toBe(false);
    expect(groupSlugValid("Beat-Makers")).toBe(false);
  });
  it("readiness + body", () => {
    expect(groupCreateReady("Beat Makers", "beat-makers")).toBe(true);
    expect(groupCreateReady("", "beat-makers")).toBe(false);
    expect(groupCreateReady("Beat Makers", "x")).toBe(false);
    expect(buildGroupCreateBody(" Beat Makers ", "Beat-Makers", " hi ", false)).toEqual({
      name: "Beat Makers", slug: "beat-makers", description: "hi", is_public: false,
    });
  });
});

describe("78→76 — pending-group hint fires exactly once", () => {
  it("stash/take round-trips and clears", () => {
    const store = new Map<string, string>();
    const storage = {
      setItem: (k: string, v: string) => void store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => void store.delete(k),
    };
    stashPendingGroupSlug(storage, "beat-makers");
    expect(store.get(PENDING_GROUP_KEY)).toBe("beat-makers");
    expect(takePendingGroupSlug(storage)).toBe("beat-makers");
    expect(takePendingGroupSlug(storage)).toBeNull();
  });
  it("a malformed stashed slug is ignored", () => {
    const storage = {
      getItem: () => "Not A Slug!!",
      removeItem: () => {},
    };
    expect(takePendingGroupSlug(storage)).toBeNull();
  });
});
