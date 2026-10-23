/**
 * groups-desk-components — stack-100 #76/#77/#78 source contracts.
 * The in-world groups desk, forum and chrome bell must ride the
 * SITE's real endpoints (the 2D groups pages + header bell are the
 * reference implementations) — these pins fail if a surface stops
 * calling its rail, if a verb renders without the rail's own
 * permission fields, or if the bell leaves the World chrome.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/GroupsDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const bell = read("../../components/world/WorldNotificationsBell.tsx");
const world = read("../../pages/world.tsx");

describe("76 — groups desk rides the /api/groups rails at the Community Hall", () => {
  it("is mounted for the community-hall station beside the feed board", () => {
    expect(panel).toContain("GroupsDesk");
    expect(panel).toContain('station.id === "community-hall"');
  });
  it("calls browse/create/join/leave/feed/post/delete through the lib paths", () => {
    for (const fn of [
      "groupsSearchPath", "groupsMinePath", "GROUPS_PATH", "groupPath",
      "groupJoinPath", "groupLeavePath", "groupFeedPath", "groupPostsPath", "groupPostPath",
    ]) {
      expect(desk).toContain(fn);
    }
    expect(desk).toContain('data-testid="world-groups-desk"');
    expect(desk).toContain('data-testid="world-group-join"');
    expect(desk).toContain('data-testid="world-group-leave"');
    expect(desk).toContain('data-testid="world-group-feed-composer"');
  });
  it("create derives its slug by the rail's law and posts the rail body", () => {
    expect(desk).toContain("groupSlugFromName");
    expect(desk).toContain("buildGroupCreateBody");
    expect(desk).toContain("groupCreateReady");
  });
  it("verbs gate on the rail's viewer_role, never a client-invented role check", () => {
    expect(desk).toContain("groupMembershipAction(detail.viewer_role, isGuest)");
    expect(desk).toContain("groupFeedCanPost(viewerRole, isGuest)");
    expect(desk).toContain("p.can_delete");
  });
  it("opens the group a notification parked (item 78 hand-off)", () => {
    expect(desk).toContain("takePendingGroupSlug(window.sessionStorage)");
  });
});

describe("77 — forum rides the forum rails with the rail's own caps", () => {
  it("calls channels/threads/replies through the lib paths", () => {
    for (const fn of [
      "forumChannelsPath", "forumChannelPath", "forumChannelThreadsPath",
      "forumThreadPath", "forumThreadRepliesPath", "forumReplyPath",
    ]) {
      expect(desk).toContain(fn);
    }
  });
  it("channel management shows only on the rail's can_manage_channels", () => {
    expect(desk).toContain("caps.can_manage_channels");
    expect(desk).toContain('data-testid="world-forum-channel-create"');
  });
  it("pin/lock fire the rail's PATCH moderation and show only on can_moderate", () => {
    expect(desk).toContain("forumModerationVisible(thread, isGuest)");
    expect(desk).toContain('method: "PATCH"');
    expect(desk).toContain("is_pinned: !thread.is_pinned");
    expect(desk).toContain("is_locked: !thread.is_locked");
    expect(desk).toContain('data-testid="world-forum-thread-pin"');
    expect(desk).toContain('data-testid="world-forum-thread-lock"');
  });
  it("reply composer respects the locked-thread rule from the lib", () => {
    expect(desk).toContain("forumReplyAllowed(thread, caps, isGuest)");
    expect(desk).toContain('data-testid="world-forum-reply-composer"');
  });
});

describe("78 — the chrome bell rides the discovery notifications rail", () => {
  it("world.tsx mounts the bell in the header for members inside", () => {
    expect(world).toContain("WorldNotificationsBell");
    expect(world).toContain('status === "inside" && !isGuest');
    expect(world).toContain("STATION_BY_ID.get(stationId)");
  });
  it("bell fetches + marks read on the rail's own paths via the lib", () => {
    expect(bell).toContain("NOTIFICATIONS_PATH");
    expect(bell).toContain("NOTIFICATIONS_READ_PATH");
    expect(bell).toContain("markReadBody(ids)");
    expect(bell).toContain('data-testid="world-notifications-bell"');
    expect(bell).toContain('data-testid="world-notifications-badge"');
    expect(bell).toContain('data-testid="world-notifications-mark-all"');
  });
  it("taps navigate in-world through the lib's targeting, website only as transfer", () => {
    expect(bell).toContain("prepareNotificationNavigation(target, window.sessionStorage)");
    expect(bell).toContain("onOpenStation(stationId)");
    expect(bell).toContain("Opens on the website ↗");
  });
});
