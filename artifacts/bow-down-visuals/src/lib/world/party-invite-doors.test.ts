/**
 * Party invite deep links — the two copy doors + the landing's
 * full state (program 2.23, stack-30 item).
 *
 * What already existed (pinned in games-lobby.test.ts and
 * kingdom-party-tables.test.ts): the link itself — /world?party=CODE
 * built by partyInvitePath/partyInviteUrl, parsed back by
 * parsePartyInvite, re-verified against GET /api/party/rooms/:code,
 * and ridden by ONE claim path (the party socket's attach, which
 * refuses full rooms server-side). The Marble Table's lobby rows
 * and the in-room view already copied that link.
 *
 * The gaps this item closes, and what these pins guard:
 *  1. The two host surfaces the program names had NO copy door:
 *     the Kingdom Board's table card (the palace directory) and
 *     the profile/stream table block (the table's home). Both now
 *     copy the SAME absolute /world link through the SAME builder
 *     (partyInviteUrl) — one link, every door, no new format.
 *  2. A full table was offered as a seat on the directory and on
 *     the landing ("Your seat is waiting" at 8/8). Full is now a
 *     STATE on all three: the board row reads "Table full" with
 *     no seat button (the profile block's precedent), and the
 *     landing — world banner + Marble Table summons card — says
 *     every seat is taken instead of offering one, while the walk
 *     to the Game Rooms and the pre-filled code stay.
 *
 * Nothing here seats anyone: the copy doors only write a link to
 * the clipboard, and the seat still rides the summons machinery
 * into the socket's own validations (auth, full, closed).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parsePartyInvite, partyInviteUrl } from "./games-lobby";

const blocks = readFileSync(
  new URL("../../components/world/native/KingdomBoardBlocks.tsx", import.meta.url),
  "utf8",
);
const section = readFileSync(
  new URL("../../components/artist/PartyTableSection.tsx", import.meta.url),
  "utf8",
);
const worldPage = readFileSync(
  new URL("../../pages/world.tsx", import.meta.url),
  "utf8",
);
const gamesPanels = readFileSync(
  new URL("../../components/world/native/GamesPanels.tsx", import.meta.url),
  "utf8",
);

describe("the link the new doors copy (pure seam)", () => {
  it("is the same absolute /world link the lobby copies, and it parses back", () => {
    const url = partyInviteUrl("https://bowdownvisuals.com", "abc234");
    expect(url).toBe("https://bowdownvisuals.com/world?party=ABC234");
    const search = url!.slice(url!.indexOf("?"));
    expect(parsePartyInvite(search)).toBe("ABC234");
  });
});

describe("the Kingdom Board table card — copy door + full state", () => {
  it("copies the table's World invite link, with the lobby's Copied feedback", () => {
    expect(blocks).toContain("partyInviteUrl(window.location.origin, code)");
    expect(blocks).toContain("copyInvite(room.code)");
    expect(blocks).toContain("world-kingdom-party-invite-");
    expect(blocks).toContain('copiedCode === room.code ? "Copied" : "Invite"');
    expect(blocks).toContain("navigator.clipboard.writeText(url)");
  });

  it("a full table reads full and offers no seat; an open one still joins", () => {
    expect(blocks).toContain("partyTableSeatState(room)");
    expect(blocks).toContain("world-kingdom-party-full-");
    expect(blocks).toContain("Table full");
    expect(blocks).toContain("world-kingdom-party-join-");
    expect(blocks).toContain("onJoinPartyTable(room)");
  });

  it("the copy door seats nobody — the board's only seat path is still the summons hand-off", () => {
    expect(blocks).not.toContain("/api/party/ws");
    expect(blocks).not.toContain('method: "POST"');
  });
});

describe("the profile table block — the copy door at the table's home", () => {
  it("copies the same World invite link from the host's own block", () => {
    expect(section).toContain("partyInviteUrl(window.location.origin, code)");
    expect(section).toContain("copyInvite(room.code)");
    expect(section).toContain("profile-party-table-invite-");
    expect(section).toContain("Copy invite link");
    expect(section).toContain("navigator.clipboard.writeText(url)");
  });

  it("the copy door seats nobody — the seat still rides the invite path", () => {
    expect(section).not.toContain("/api/party/ws");
    expect(section).toContain("partyInvitePath(room.code)");
  });
});

describe("the landing consumes the link — offer, full, closed, guest", () => {
  it("the table is re-verified against the server, never trusted from the link", () => {
    expect(worldPage).toContain(
      "/api/party/rooms/${encodeURIComponent(partyInviteCode)}",
    );
    expect(worldPage).toContain("parsePartyRoomSnapshot(");
  });

  it("a valid, open table gets the seat offer — banner and panel", () => {
    expect(worldPage).toContain("partySummonsHeadline(inviteRoom)");
    expect(worldPage).toContain("Take me to the table");
    expect(gamesPanels).toContain("Your seat is waiting.");
    expect(gamesPanels).toContain("setActiveCode(summonsRoom.code)");
  });

  it("a full table gets the full state, checked BEFORE the seat offer", () => {
    expect(worldPage).toContain('partyTableSeatState(inviteRoom) === "full"');
    expect(worldPage).toContain("every seat is");
    expect(
      worldPage.indexOf('partyTableSeatState(inviteRoom) === "full"'),
    ).toBeLessThan(worldPage.indexOf("Join your party?"));
    expect(gamesPanels).toContain('partyTableSeatState(summonsRoom) === "full"');
    expect(gamesPanels).toContain("every seat is taken");
    expect(
      gamesPanels.indexOf('partyTableSeatState(summonsRoom) === "full"'),
    ).toBeLessThan(gamesPanels.indexOf("Your seat is waiting."));
    /* The walk survives the full state — the banner's action on a
       full table is the Game Rooms, like the closed state's. */
    expect(worldPage).toContain("Go to the Game Rooms");
  });

  it("an ended table meets the honest closed state, not a dead end", () => {
    expect(worldPage).toContain("That party table has closed");
    expect(gamesPanels).toContain("that table has closed");
  });

  it("a guest is gated to sign-in with the invite preserved as the return", () => {
    expect(worldPage).toContain(
      "/login?next=${encodeURIComponent(`/world?party=${partyInviteCode}`)}",
    );
    expect(worldPage).toContain("Sign in to join the table");
  });
});
