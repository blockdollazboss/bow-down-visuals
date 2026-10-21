/**
 * Kingdom Board party tables — the directory join (program 2.23,
 * stack-20 item #8).
 *
 * The invite deep link itself (/world?party=CODE: build, parse,
 * server verify, summons banner, pre-filled Marble Table) shipped
 * with Ring 2 and is pinned in games-lobby.test.ts. The gap this
 * item closes is the audit's other half: the Kingdom Board — the
 * palace directory — showed rooms and headcounts but no open
 * party tables and no way to join one from the board.
 *
 * What these pins guard:
 *  1. The link round-trip at the pure seam: a path the site
 *     builds parses back to the same table code.
 *  2. The board reads the server's own open-rooms rail — never an
 *     invented table list — and shapes rows with the lobby's own
 *     parsers, so board and lobby can never disagree.
 *  3. Join routing: the board's Join hands the SERVER-shaped table
 *     to the page, and the page seats the walker through the same
 *     summons machinery a deep-link landing uses (invite state +
 *     the summons walk) — there is no second, board-only join.
 *  4. The guest path: the tables fetch never fires for a guest;
 *     the block is the members-only pitch with the sign-in door.
 *  5. The stale path stays honest: a table that closes on the way
 *     over meets the summons' closed notices (page banner + panel
 *     card), which the join inherits by riding the same machinery.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { partyInvitePath, parsePartyInvite } from "./games-lobby";

const blocks = readFileSync(
  new URL("../../components/world/native/KingdomBoardBlocks.tsx", import.meta.url),
  "utf8",
);
const stationPanel = readFileSync(
  new URL("../../components/world/StationPanel.tsx", import.meta.url),
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

const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe("the invite link round-trip (pure seam)", () => {
  it("a built /world?party= path parses back to the same code", () => {
    const path = partyInvitePath("abc234");
    expect(path).toBe("/world?party=ABC234");
    const search = path!.slice(path!.indexOf("?"));
    expect(parsePartyInvite(search)).toBe("ABC234");
  });
});

describe("the board reads the server's open-rooms rail", () => {
  it("fetches /api/party/rooms and shapes it with the lobby's parser", () => {
    expect(blocks).toContain('fetch("/api/party/rooms"');
    expect(blocks).toContain("parsePartyRooms(");
    expect(blocks).toContain("partyTableHomeLine(room)");
    expect(blocks).toContain('data-testid="world-kingdom-party-tables"');
  });

  it("the tables fetch is members-only — a guest never spends it", () => {
    // Both members-only effects (standings + tables) early-return
    // for guests; the tables block's own gate is one of them.
    expect(occurrences(blocks, "if (isGuest) return;")).toBeGreaterThanOrEqual(2);
  });
});

describe("join routing — the board rides the summons machinery", () => {
  it("each table row's Join hands the server-shaped room to the page", () => {
    expect(blocks).toContain("onJoinPartyTable(room)");
    expect(blocks).toContain("world-kingdom-party-join-");
  });

  it("StationPanel declares the seam and threads it to the board", () => {
    expect(stationPanel).toContain("onJoinPartyTable?:");
    expect(stationPanel).toContain(
      "onJoinPartyTable={props.onJoinPartyTable}",
    );
    // KingdomBoard forwards it to its blocks at both render sites.
    expect(
      occurrences(stationPanel, "onJoinPartyTable={onJoinPartyTable}"),
    ).toBe(2);
  });

  it("the page names the table as the invite and runs the summons walk", () => {
    expect(worldPage).toContain("onJoinPartyTable={joinDirectoryTable}");
    expect(worldPage).toContain("setPartyInviteCode(room.code)");
    expect(worldPage).toContain("setInviteResolved(true)");
    // The walk itself is the deep link's own — one machinery, two
    // doors (the handler calls it; its definition is the other hit).
    expect(occurrences(worldPage, "goToInvitedTable()")).toBeGreaterThanOrEqual(1);
    expect(worldPage).toContain("const goToInvitedTable = useCallback(");
  });

  it("the Marble Table still pre-fills the join from the invite", () => {
    expect(gamesPanels).toContain("setJoinCode(partyInvite.code)");
  });
});

describe("guest + stale paths stay honest", () => {
  it("a guest's tables block is the members-only pitch, with the sign-in door", () => {
    expect(blocks).toContain("The party tables are members&rsquo; games");
    expect(blocks).toContain("Sign in to take a seat");
  });

  it("an empty palace reads as an empty block, never phantom tables", () => {
    expect(blocks).toContain("No tables are open right now.");
  });

  it("a closed table meets the summons' closed notices, banner and panel", () => {
    expect(worldPage).toContain("That party table has closed");
    expect(gamesPanels).toContain("that table has closed");
  });
});
