/**
 * show-invites — invite-to-a-show's client half (stack1300, 3.8).
 *
 * The server half (host-only door, exactly-once bells, the
 * show-standing rule) is pinned in the api-server suites; these
 * pin the client: the DTO parsers carry the show's identity (the
 * right show id, kind, room, window) or drop the row, the mine
 * payload splits pending from accepted, the paths name the real
 * endpoints, the walk resolves through the calendar's own action
 * (a room walk for the show kinds, the winners-circle station for
 * a contest, none for an unknown kind), and the host's pickable
 * shows are only the ones still standing.
 */
import { describe, it, expect } from "vitest";
import {
  answerShowInvite,
  createShowInvitePath,
  parseShowInvitesMine,
  parseWorldShowInvite,
  sendShowInvite,
  showInviteAcceptPath,
  showInviteAction,
  showInviteDeclinePath,
  showInvitesMinePath,
  upcomingInvitableShows,
  type WorldShowInvite,
} from "./show-invites";

const NOW = Date.parse("2026-11-06T18:00:00.000Z");
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const dto = {
  id: "inv-1",
  eventId: "evt-9",
  eventTitle: "Big Night",
  eventKind: "stage_show",
  roomId: "world:kings-hall",
  startsAt: iso(NOW + 2 * HOUR),
  endsAt: iso(NOW + 3 * HOUR),
  hostName: "Host Harriet",
  hostAvatarUrl: null,
  status: "pending",
  createdAt: iso(NOW),
  respondedAt: null,
};

describe("parseWorldShowInvite", () => {
  it("carries the show's identity — the right show id, kind, room and window", () => {
    const invite = parseWorldShowInvite(dto);
    expect(invite).toMatchObject({
      id: "inv-1",
      eventId: "evt-9",
      eventTitle: "Big Night",
      eventKind: "stage_show",
      roomId: "world:kings-hall",
      hostName: "Host Harriet",
      status: "pending",
    });
    expect(invite?.startsAt).toBe(dto.startsAt);
    expect(invite?.endsAt).toBe(dto.endsAt);
  });
  it("a row without an id or a show id is not an invite", () => {
    expect(parseWorldShowInvite({ ...dto, id: "" })).toBeNull();
    expect(parseWorldShowInvite({ ...dto, eventId: "" })).toBeNull();
    expect(parseWorldShowInvite(null)).toBeNull();
    expect(parseWorldShowInvite("nope")).toBeNull();
  });
  it("an unknown status reads as still-waiting; a missing host reads plainly", () => {
    expect(parseWorldShowInvite({ ...dto, status: "??" })?.status).toBe("pending");
    expect(parseWorldShowInvite({ ...dto, status: "accepted" })?.status).toBe("accepted");
    expect(parseWorldShowInvite({ ...dto, hostName: "" })?.hostName).toBe("A creator");
  });
});

describe("parseShowInvitesMine", () => {
  it("splits pending from accepted and drops malformed rows", () => {
    const mine = parseShowInvitesMine({
      pending: [dto, { id: "broken" }],
      accepted: [{ ...dto, id: "inv-2", status: "accepted" }],
    });
    expect(mine.pending).toHaveLength(1);
    expect(mine.accepted).toHaveLength(1);
    expect(mine.accepted[0]?.eventId).toBe("evt-9");
  });
  it("a malformed body is no invites — never a crash, never a phantom", () => {
    expect(parseShowInvitesMine(null)).toEqual({ pending: [], accepted: [] });
    expect(parseShowInvitesMine({})).toEqual({ pending: [], accepted: [] });
  });
});

describe("the paths", () => {
  it("name the real endpoints", () => {
    expect(createShowInvitePath("evt-9")).toBe("/api/world/events/evt-9/invites");
    expect(showInvitesMinePath()).toBe("/api/world/show-invites/mine");
    expect(showInviteAcceptPath("inv-1")).toBe("/api/world/show-invites/inv-1/accept");
    expect(showInviteDeclinePath("inv-1")).toBe("/api/world/show-invites/inv-1/decline");
  });
});

describe("showInviteAction — the invitee's walk", () => {
  const invite = parseWorldShowInvite(dto) as WorldShowInvite;
  it("a stage show walks to the show's own room", () => {
    expect(showInviteAction(invite)).toEqual({ type: "room", roomId: "world:kings-hall" });
  });
  it("office hours walk to the host's creator room; a listening party to its hall", () => {
    expect(
      showInviteAction({ ...invite, eventKind: "office_hours", roomId: "creator:host-harriet" }),
    ).toEqual({ type: "room", roomId: "creator:host-harriet" });
    expect(
      showInviteAction({ ...invite, eventKind: "listening_party", roomId: "world:music-hall" }),
    ).toEqual({ type: "room", roomId: "world:music-hall" });
  });
  it("a contest opens its station; an unknown kind wears no walk", () => {
    expect(showInviteAction({ ...invite, eventKind: "contest", roomId: "" })).toEqual({
      type: "station",
      stationId: "winners-circle",
    });
    expect(showInviteAction({ ...invite, eventKind: "something-new" })).toEqual({ type: "none" });
  });
});

describe("upcomingInvitableShows — the host's pickable shows", () => {
  const ev = (over: Record<string, unknown>) => ({
    id: "evt-1",
    kind: "stage_show",
    title: "Show",
    roomId: "world:kings-hall",
    hostUserId: "host",
    hostName: "Host Harriet",
    startsAt: iso(NOW + 2 * HOUR),
    endsAt: iso(NOW + 3 * HOUR),
    status: "scheduled",
    payload: {},
    ...over,
  });
  it("keeps scheduled and live shows whose window is still open, soonest first", () => {
    const shows = upcomingInvitableShows(
      {
        events: [
          ev({ id: "later", startsAt: iso(NOW + 5 * HOUR), endsAt: iso(NOW + 6 * HOUR) }),
          ev({ id: "live-now", status: "live", startsAt: iso(NOW - HOUR), endsAt: iso(NOW + HOUR) }),
          ev({ id: "soon", startsAt: iso(NOW + HOUR), endsAt: iso(NOW + 2 * HOUR) }),
        ],
      },
      NOW,
    );
    expect(shows.map((s) => s.id)).toEqual(["live-now", "soon", "later"]);
  });
  it("drops done, cancelled and already-ended shows — the picker never offers a refused send", () => {
    const shows = upcomingInvitableShows(
      {
        events: [
          ev({ id: "done", status: "done" }),
          ev({ id: "cancelled", status: "cancelled" }),
          ev({ id: "ended", startsAt: iso(NOW - 3 * HOUR), endsAt: iso(NOW - HOUR) }),
          ev({ id: "standing", status: "scheduled" }),
        ],
      },
      NOW,
    );
    expect(shows.map((s) => s.id)).toEqual(["standing"]);
  });
});

describe("the calls", () => {
  it("a refusal throws the server's own plain words, never a local guess", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Your invite to Mel is already out." }), {
        status: 409,
      })) as typeof fetch;
    try {
      await expect(sendShowInvite("evt-9", "user-2", null)).rejects.toThrow(
        "Your invite to Mel is already out.",
      );
      await expect(answerShowInvite("inv-1", "accept", null)).rejects.toThrow(
        "Your invite to Mel is already out.",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
