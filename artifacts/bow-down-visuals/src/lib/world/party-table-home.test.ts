/**
 * Party tables homed on stream/profile (program 2.25, stack-20 R2
 * item #20).
 *
 * What existed: party rooms already anchor to a home at creation
 * (the room's stored profileSlug — the host's own profile unless
 * they homed the table to a stream), the Kingdom Board already
 * lists every open table with a Join riding the summons machinery
 * (2.23), and the world summons front door is /world?party=CODE.
 * The gap: the table showed NOWHERE at its own home — the host's
 * public profile and their stream's watch page said nothing about
 * it. The server half is a public per-profile read
 * (GET /api/creator-profiles/:slug/party-tables, pinned by the API
 * route suite); this file pins the frontend half:
 *
 *  1. Seat truth: full is the roster against the game's seats —
 *     a full table offers no seat, ever.
 *  2. The stream cut: the watch page shows only the table homed
 *     to THAT stream out of the host's open tables.
 *  3. Door parity: the profile/stream seat is the summons flow's
 *     own front door (partyInvitePath) — the same code the board's
 *     Join feeds into the same world-page machinery. No second
 *     seat-claim path is built here.
 *  4. Honest states: no open table renders no block at all; a
 *     guest's door is the sign-in (the seat itself stays
 *     members-only, enforced by the summons + the party socket).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  partyRoomsForStream,
  partyTableSeatState,
  type PartyOpenRoom,
} from "./games-lobby";

const section = readFileSync(
  new URL("../../components/artist/PartyTableSection.tsx", import.meta.url),
  "utf8",
);
const profilePage = readFileSync(
  new URL("../../pages/artist-public.tsx", import.meta.url),
  "utf8",
);
const watchPage = readFileSync(
  new URL("../../pages/live-watch.tsx", import.meta.url),
  "utf8",
);
const worldPage = readFileSync(
  new URL("../../pages/world.tsx", import.meta.url),
  "utf8",
);

const room = (over: Partial<PartyOpenRoom> = {}): PartyOpenRoom => ({
  code: "ABC234",
  game: "trivia",
  hostName: "Thy Cheat Code",
  players: 3,
  streamId: null,
  profileSlug: "thy-cheat-code",
  ...over,
});

describe("seat truth — full is a server fact", () => {
  it("a trivia table is open below 8 and full at 8", () => {
    expect(partyTableSeatState(room({ players: 7 }))).toBe("open");
    expect(partyTableSeatState(room({ players: 8 }))).toBe("full");
  });

  it("a duel table is open at 1 and full at 2", () => {
    expect(partyTableSeatState(room({ game: "duel", players: 1 }))).toBe("open");
    expect(partyTableSeatState(room({ game: "duel", players: 2 }))).toBe("full");
  });
});

describe("the stream cut", () => {
  it("keeps only the table homed to that stream", () => {
    const rooms = [
      room({ code: "STR111", streamId: "stream-1" }),
      room({ code: "STR222", streamId: "stream-2" }),
      room({ code: "HOME11", streamId: null }),
    ];
    expect(partyRoomsForStream(rooms, "stream-1").map((r) => r.code)).toEqual(["STR111"]);
    expect(partyRoomsForStream(rooms, "stream-9")).toEqual([]);
  });
});

describe("the section's contract (source pins)", () => {
  it("reads the public per-profile rail and shapes it with the board's own parser", () => {
    expect(section).toContain("/party-tables");
    expect(section).toContain("parsePartyRooms(data)");
  });

  it("the seat rides the summons front door — the same code the board's Join carries", () => {
    expect(section).toContain("partyInvitePath(room.code)");
    /* The world page is where that door lands: it parses the same
       param the board's Join feeds as invite state. One flow. */
    expect(worldPage).toContain("parsePartyInvite");
    expect(worldPage).toContain("setPartyInviteCode");
  });

  it("a full table says so and offers no seat", () => {
    expect(section).toContain("Table full");
    expect(section).toContain("partyTableSeatState(room)");
  });

  it("a guest's door is the sign-in, with the invite as the return", () => {
    expect(section).toContain("Sign in to take a seat");
    expect(section).toContain("/login?next=${encodeURIComponent(invite)}");
  });

  it("no open table renders no block — never a dressed-up empty", () => {
    expect(section).toContain("if (shown.length === 0) return null;");
  });

  it("is docked on the profile's Stage and on the watch page of its stream", () => {
    expect(profilePage).toContain("<PartyTableSection slug={slug} />");
    expect(watchPage).toContain("streamId={stream.id}");
    expect(watchPage).toContain("slug={creator.slug}");
  });
});
