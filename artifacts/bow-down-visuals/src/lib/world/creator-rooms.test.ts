/**
 * Creator Rooms (Ring 2, item 3.5) — the client seam's tests.
 *
 * Two halves:
 *  - the floor plan's dynamic ring (palace-layout): the template
 *    registers under a creator's slug, the Courtyard arch becomes
 *    a walkable doorway in both directions, walls stay solid
 *    everywhere else, and an unregistered template is NOT
 *    walkable (no room, no floor);
 *  - the data seam (creator-rooms.ts): the directory/detail
 *    parsers drop malformed rows instead of crashing, the deep
 *    entry param accepts slugs and nothing else, and the play
 *    inputs the room's rail + screen hand the Shelf player are
 *    built from the room's own data.
 *  - the stations: the Courtyard gained the arch door, and a
 *    creator room answers with the template's four stations.
 */
import { describe, it, expect } from "vitest";
import {
  BOARDWALK_ID,
  COURTYARD_ID,
  HALL_ROOM_ID,
  creatorRoomId,
  creatorSlugFromRoomId,
  isCreatorRoomId,
  isWalkable,
  palaceRoomLayout,
  registerCreatorRoomLayout,
  roomAt,
  resolvePalaceMove,
  clampToRoom,
} from "./palace-layout";
import {
  creatorRoomStations,
  nearestStation,
  stationsInRoom,
  STATION_BY_ID,
} from "./stations";
import {
  createRoomInvitePath,
  creatorTrackPlayInput,
  creatorVideoPlayInput,
  frontRowCourtMember,
  parseCreatorRoomDetail,
  parseCreatorRoomDirectory,
  parseCreatorRoomParam,
  parseRoomInviteCandidates,
  parseRoomInvitesMine,
  parseWorldRoomInvite,
  roomInviteAcceptPath,
  roomInviteCandidatesPath,
  roomInviteDeclinePath,
  roomInvitesMinePath,
} from "./creator-rooms";

describe("the template floor plan", () => {
  it("is not walkable before any creator registers it", () => {
    /* Module state is shared across this file: this test runs
     * before any registration in file order. */
    expect(isCreatorRoomId(creatorRoomId("nova-reyes"))).toBe(true);
    expect(creatorSlugFromRoomId("creator:nova-reyes")).toBe("nova-reyes");
    expect(creatorSlugFromRoomId("world:kings-hall")).toBeNull();
    expect(palaceRoomLayout("creator:nova-reyes")).toBeUndefined();
    expect(isWalkable(9.5, 32)).toBe(false);
  });

  it("registration lays the room + the arch doorway under the slug", () => {
    const layout = registerCreatorRoomLayout("nova-reyes", "Nova Reyes");
    expect(layout.id).toBe("creator:nova-reyes");
    expect(layout.name).toBe("Nova Reyes's Room");
    expect(palaceRoomLayout("creator:nova-reyes")).toBe(layout);
    expect(isWalkable(9.5, 32)).toBe(true); // the room's floor
    expect(isWalkable(9.5, 26.2)).toBe(true); // the arch portal
    expect(isWalkable(5, 26.2)).toBe(false); // the wall either side of the arch
    /* DELIBERATELY moved in item 35: (9.5, 40) — beyond the
     * creator room's south wall — is the Boardwalk's deck now:
     * walkable, but as the Boardwalk's ground, never the
     * creator room's. The creator room still ends at its own
     * south wall; beyond the Boardwalk's wall, nothing walks. */
    expect(isWalkable(9.5, 40)).toBe(true);
    expect(roomAt(9.5, 40, COURTYARD_ID)).toBe(BOARDWALK_ID);
    expect(isWalkable(9.5, 62)).toBe(false); // beyond every south wall
  });

  it("membership flips at the arch plane, in both directions", () => {
    registerCreatorRoomLayout("nova-reyes", "Nova Reyes");
    expect(roomAt(9.5, 25.9, COURTYARD_ID)).toBe(COURTYARD_ID);
    expect(roomAt(9.5, 26.5, COURTYARD_ID)).toBe("creator:nova-reyes");
    const inStep = resolvePalaceMove({ x: 9.5, z: 25.9, room: COURTYARD_ID }, 9.5, 26.6);
    expect(inStep.entered).toBe("creator:nova-reyes");
    const outStep = resolvePalaceMove(
      { x: 9.5, z: 26.6, room: "creator:nova-reyes" },
      9.5,
      25.8,
    );
    expect(outStep.entered).toBe(COURTYARD_ID);
    /* The wall beside the arch still refuses. */
    const blocked = resolvePalaceMove({ x: 5, z: 25.9, room: COURTYARD_ID }, 5, 26.6);
    expect(blocked.entered).toBeNull();
    expect(blocked.z).toBe(25.9);
  });

  it("clamps and spawns on the template, and re-registering replaces the host", () => {
    registerCreatorRoomLayout("nova-reyes", "Nova Reyes");
    expect(clampToRoom("creator:nova-reyes", 99, 99)).toEqual({ x: 16.05, z: 37.65 });
    const layout = registerCreatorRoomLayout("other-creator");
    expect(layout.name).toBe("Creator Room");
    expect(palaceRoomLayout("creator:nova-reyes")).toBeUndefined();
    expect(palaceRoomLayout("creator:other-creator")).toBe(layout);
    expect(roomAt(9.5, 30, HALL_ROOM_ID)).toBe("creator:other-creator");
  });
});

describe("the stations", () => {
  it("the Courtyard gained the Creator Rooms arch door", () => {
    const arch = STATION_BY_ID.get("creator-rooms");
    expect(arch).toBeDefined();
    expect(arch!.roomId).toBe(COURTYARD_ID);
    expect(arch!.panel).toEqual({ kind: "custom", id: "creator-rooms" });
    expect(arch!.membersOnly).toBe(false);
    expect(stationsInRoom(COURTYARD_ID).map((s) => s.id)).toContain("creator-rooms");
    expect(nearestStation(COURTYARD_ID, 9.5, 24.6)?.id).toBe("creator-rooms");
  });

  it("a creator room answers with the template's four doors — and only there", () => {
    const stations = creatorRoomStations("creator:nova-reyes");
    expect(stations.map((s) => s.id)).toEqual([
      "creator-front-row",
      "creator-music",
      "creator-screen",
      "creator-store",
    ]);
    expect(stations.every((s) => s.roomId === "creator:nova-reyes")).toBe(true);
    expect(stations.every((s) => s.membersOnly === false)).toBe(true);
    expect(creatorRoomStations("world:kings-hall")).toEqual([]);
    expect(stationsInRoom("creator:nova-reyes")).toHaveLength(4);
    expect(nearestStation("creator:nova-reyes", 9.5, 36.5)?.id).toBe("creator-screen");
    expect(nearestStation("creator:nova-reyes", 3.9, 34.4)?.id).toBe("creator-music");
    /* The fixed rooms keep exactly their own stations. */
    expect(stationsInRoom(HALL_ROOM_ID).every((s) => !s.id.startsWith("creator-"))).toBe(true);
  });
});

const DIRECTORY_PAYLOAD = {
  rooms: [
    {
      slug: "nova-reyes",
      displayName: "Nova Reyes",
      roomName: "Nova Reyes's Room",
      avatarUrl: "https://cdn.example.com/nova.png",
      bannerUrl: null,
      theme: { primary: "#aa2244", accent: "#ffcc88", background: "#100408" },
      hasContent: true,
      occupantCount: 2,
    },
    { slug: "broken-row" },
    "not-a-row",
  ],
};

const DETAIL_PAYLOAD = {
  room: {
    roomId: "creator:nova-reyes",
    slug: "nova-reyes",
    displayName: "Nova Reyes",
    roomName: "Nova Reyes's Room",
    bio: "Singer.",
    avatarUrl: "https://cdn.example.com/nova.png",
    bannerUrl: "https://cdn.example.com/banner.png",
    theme: { primary: "#aa2244", accent: "not-a-color", background: "#100408" },
    followerCount: 42,
    occupantCount: 1,
    featuredVideo: {
      id: "vid-1",
      title: "The Big Video",
      videoUrl: "https://cdn.example.com/v.mp4",
      thumbnailUrl: null,
      durationSec: 95,
      viewCount: 9,
    },
    featuredTrack: null,
    tracks: [
      {
        id: "trk-1",
        title: "First Song",
        audioUrl: "https://cdn.example.com/t.mp3",
        artworkUrl: null,
        durationSec: 200,
        playCount: 5,
        likeCount: 4,
        commentCount: 1,
      },
      { id: "trk-broken", title: "No URL" },
    ],
    frontRow: [
      {
        position: 1,
        profileId: "p-1",
        slug: "fan-favorite",
        displayName: "Fan Favorite",
        avatarUrl: null,
      },
    ],
    storefront: { id: "shop-1", handle: "nova-goods", name: "Nova Goods" },
  },
};

describe("the data seam", () => {
  it("parses the directory, dropping malformed rows", () => {
    const rooms = parseCreatorRoomDirectory(DIRECTORY_PAYLOAD);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      slug: "nova-reyes",
      theme: { primary: "#aa2244", accent: "#ffcc88" },
      hasContent: true,
      occupantCount: 2,
    });
    expect(parseCreatorRoomDirectory(null)).toEqual([]);
    expect(parseCreatorRoomDirectory({ rooms: "nope" })).toEqual([]);
  });

  it("parses a room's data: bad hues fall back, broken tracks drop, the storefront rides", () => {
    const detail = parseCreatorRoomDetail(DETAIL_PAYLOAD);
    expect(detail).not.toBeNull();
    expect(detail!.theme.accent).toBe("#f0d488"); // invalid hue → house gold
    expect(detail!.theme.primary).toBe("#aa2244");
    expect(detail!.tracks.map((t) => t.id)).toEqual(["trk-1"]);
    expect(detail!.featuredVideo?.id).toBe("vid-1");
    expect(detail!.featuredTrack).toBeNull();
    expect(detail!.storefront).toEqual({ id: "shop-1", handle: "nova-goods", name: "Nova Goods" });
    expect(parseCreatorRoomDetail({})).toBeNull();
    expect(parseCreatorRoomDetail({ room: { slug: "x" } })).toBeNull();
  });

  it("builds the Shelf play inputs from the room's own data", () => {
    const detail = parseCreatorRoomDetail(DETAIL_PAYLOAD)!;
    const trackInput = creatorTrackPlayInput(detail.tracks[0]!, detail);
    expect(trackInput).toMatchObject({
      kind: "track",
      id: "trk-1",
      title: "First Song",
      artistName: "Nova Reyes",
      src: "https://cdn.example.com/t.mp3",
      pagePath: "/track/trk-1",
    });
    const videoInput = creatorVideoPlayInput(detail.featuredVideo!, detail);
    expect(videoInput).toMatchObject({
      kind: "video",
      id: "vid-1",
      src: "https://cdn.example.com/v.mp4",
      pagePath: "/watch/vid-1",
    });
  });

  it("maps a Front Row member onto the Portrait Card's court shape", () => {
    const detail = parseCreatorRoomDetail(DETAIL_PAYLOAD)!;
    expect(frontRowCourtMember(detail.frontRow[0]!)).toEqual({
      position: 1,
      profileId: "p-1",
      slug: "fan-favorite",
      displayName: "Fan Favorite",
      avatarUrl: null,
      profileUrl: "/artist/fan-favorite",
      isPublic: true,
    });
  });
});

describe("the deep entry param", () => {
  it("accepts a slug and nothing else", () => {
    expect(parseCreatorRoomParam("?creator=nova-reyes")).toBe("nova-reyes");
    expect(parseCreatorRoomParam("?creator=Nova_Reyes-2")).toBe("nova_reyes-2");
    expect(parseCreatorRoomParam("?party=ABC")).toBeNull();
    expect(parseCreatorRoomParam("?creator=")).toBeNull();
    expect(parseCreatorRoomParam("?creator=../etc/passwd")).toBeNull();
    expect(parseCreatorRoomParam("?creator=a%20b")).toBeNull();
    expect(parseCreatorRoomParam("")).toBeNull();
  });
});

describe("room invites (Lane B4)", () => {
  const INVITE_PAYLOAD = {
    id: "inv-1",
    roomId: "creator:nova-reyes",
    slug: "nova-reyes",
    roomName: "Nova Reyes's Room",
    hostName: "Nova Reyes",
    hostAvatarUrl: "https://cdn.example.com/nova.png",
    status: "pending",
    createdAt: "2026-10-29T12:00:00.000Z",
    respondedAt: null,
  };

  it("parses an invite DTO whole", () => {
    expect(parseWorldRoomInvite(INVITE_PAYLOAD)).toEqual({
      id: "inv-1",
      roomId: "creator:nova-reyes",
      slug: "nova-reyes",
      roomName: "Nova Reyes's Room",
      hostName: "Nova Reyes",
      hostAvatarUrl: "https://cdn.example.com/nova.png",
      status: "pending",
      createdAt: "2026-10-29T12:00:00.000Z",
      respondedAt: null,
    });
  });

  it("drops a row with no id or no room, and reads an unknown status as still-waiting", () => {
    expect(parseWorldRoomInvite({ slug: "nova-reyes" })).toBeNull();
    expect(parseWorldRoomInvite({ id: "inv-1" })).toBeNull();
    expect(parseWorldRoomInvite(null)).toBeNull();
    expect(parseWorldRoomInvite({ ...INVITE_PAYLOAD, status: "exploded" })?.status).toBe("pending");
    expect(parseWorldRoomInvite({ ...INVITE_PAYLOAD, status: "accepted" })?.status).toBe("accepted");
    expect(parseWorldRoomInvite({ ...INVITE_PAYLOAD, status: "declined" })?.status).toBe("declined");
  });

  it("splits the mine payload into pending and accepted, dropping malformed rows", () => {
    const mine = parseRoomInvitesMine({
      pending: [INVITE_PAYLOAD, { id: "broken" }],
      accepted: [{ ...INVITE_PAYLOAD, id: "inv-2", status: "accepted", respondedAt: "2026-10-29T13:00:00.000Z" }],
    });
    expect(mine.pending.map((i) => i.id)).toEqual(["inv-1"]);
    expect(mine.accepted.map((i) => i.id)).toEqual(["inv-2"]);
    expect(parseRoomInvitesMine(null)).toEqual({ pending: [], accepted: [] });
    expect(parseRoomInvitesMine({})).toEqual({ pending: [], accepted: [] });
  });

  it("parses the picker's members and drops rows that name nobody", () => {
    const members = parseRoomInviteCandidates({
      members: [
        { userId: "u-1", slug: "kai-beats", displayName: "Kai Beats", avatarUrl: null },
        { slug: "no-user-id", displayName: "Ghost" },
        { userId: "u-2", displayName: "No Slug" },
        "not-a-row",
      ],
    });
    expect(members).toEqual([
      { userId: "u-1", slug: "kai-beats", displayName: "Kai Beats", avatarUrl: null },
    ]);
    expect(parseRoomInviteCandidates(null)).toEqual([]);
  });

  it("builds the invite paths the server mounts", () => {
    expect(createRoomInvitePath("nova-reyes")).toBe("/api/world/creator-rooms/nova-reyes/invites");
    expect(roomInvitesMinePath()).toBe("/api/world/room-invites/mine");
    expect(roomInviteCandidatesPath()).toBe("/api/world/room-invites/candidates");
    expect(roomInviteCandidatesPath("  kai ")).toBe("/api/world/room-invites/candidates?q=kai");
    expect(roomInviteAcceptPath("inv 1")).toBe("/api/world/room-invites/inv%201/accept");
    expect(roomInviteDeclinePath("inv-1")).toBe("/api/world/room-invites/inv-1/decline");
  });
});
