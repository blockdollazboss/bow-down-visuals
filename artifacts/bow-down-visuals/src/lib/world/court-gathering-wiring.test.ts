/**
 * court-gathering-wiring — the source-contract pins for the
 * stack1300 court-kind lane (Ring 3.6).
 *
 * The block must stay MOUNTED in the Front Row Gallery's panel —
 * the Chamber's own station — under the portraits the gathering
 * presents; it must post through the seam builder to the rail,
 * carry the house refusal to the member's eyes, and keep the
 * slate's failure state (with Retry) separate from its empty
 * state. The calendar surfaces must name the kind and walk its
 * rows into the Chamber.
 *
 * THE GATE PROOF CHAIN: the rail's own suite refuses a member the
 * court (ADMIN_REQUIRED, in the court's own words); the seam maps
 * that refusal to the catalog key; the block speaks it. This file
 * pins the client end; the API suites pin the rail end.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calendarEventAction, type CalendarEvent } from "./palace-calendar";
import en from "../../locales/en.json";
/* stack100 unit 50: the Kingdom Board's kind map resolves through
   the worldBoards catalog — the pin below asserts the KEY in the
   board source and the English copy in the catalog. */
const boards = (en as { worldBoards: Record<string, string> }).worldBoards;

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..");
const API_SRC = join(SRC, "..", "..", "api-server", "src");

const panel = readFileSync(join(SRC, "components/world/StationPanel.tsx"), "utf8");
const block = readFileSync(join(SRC, "components/world/native/CourtGatheringBlock.tsx"), "utf8");
const seam = readFileSync(join(SRC, "lib/world/court-gathering.ts"), "utf8");
const calendarBlock = readFileSync(join(SRC, "components/world/native/PalaceCalendarBlock.tsx"), "utf8");
const boardBlocks = readFileSync(join(SRC, "components/world/native/KingdomBoardBlocks.tsx"), "utf8");
const worldClient = readFileSync(join(SRC, "lib/world/world-client.ts"), "utf8");
const railSuite = readFileSync(join(API_SRC, "routes/__tests__/world-events.test.ts"), "utf8");
const railLib = readFileSync(join(API_SRC, "lib/world-events.ts"), "utf8");

describe("court gathering — mounted in the Chamber, in the gallery's panel", () => {
  it("the front-row case stacks the block under the gallery, behind its own lazy door", () => {
    expect(panel).toContain('case "front-row":');
    expect(panel).toContain("<CourtGatheringBlock isLight={isLight} isGuest={isGuest} />");
    expect(panel).toContain('import("@/components/world/native/CourtGatheringBlock")');
    const caseAt = panel.indexOf('case "front-row":');
    expect(panel.indexOf("<FrontRowGallery", caseAt)).toBeLessThan(
      panel.indexOf("<CourtGatheringBlock", caseAt),
    );
  });

  it("the block posts a built royal_court body to the rail and lists/cancels its own gatherings", () => {
    expect(seam).toContain('kind: "royal_court"');
    expect(seam).toContain("COURT_ROOM_ID = ROYAL_COURT_ID");
    expect(block).toContain("buildCourtGatheringBody");
    expect(block).toContain("fetch(COURT_BOOK_PATH");
    expect(block).toContain('method: "POST"');
    expect(block).toContain("fetch(COURT_MINE_PATH");
    expect(block).toContain("courtCancelPath(gathering.id)");
    expect(block).toContain('data-testid="world-court-submit"');
    expect(block).toContain('data-testid="world-court-mine"');
    expect(block).toContain('data-testid="world-court-cancel"');
    expect(block).toContain('data-testid="world-court-slate-row"');
  });

  it("failure ≠ empty on the slate: a failed read has a working Retry, an empty slate its own sentence", () => {
    expect(block).toContain("parseChamberGatherings");
    expect(block).toContain('data-testid="world-court-retry"');
    expect(block).toContain("worldCourtGathering.slateFailed");
    expect(block).toContain("worldCourtGathering.slateEmpty");
    /* The strict fold: a malformed slate is null = failed, and the
     * block throws on null instead of painting it empty. */
    expect(seam).toContain("return null");
    expect(block).toContain("parsed === null");
  });

  it("guests get the pitch and the sign-in door, never the form", () => {
    expect(block).toContain("worldCourtGathering.guestPitch");
    expect(block).toContain("GUEST_SIGN_IN_HREF");
  });
});

describe("court gathering — the calendar surfaces name the kind", () => {
  it("both kind-label maps carry the court gathering", () => {
    expect(calendarBlock).toContain('royal_court: "worldScheduleRelease.calKindRoyalCourt"');
    expect(boardBlocks).toContain('royal_court: "worldBoards.kbEventCourtGathering"');
    expect(boards.kbEventCourtGathering).toBe("Court gathering");
  });

  it("the slate DTO union carries the kind", () => {
    expect(worldClient).toContain('"office_hours" | "royal_court"');
  });

  it("a court gathering's calendar row walks into the Chamber", () => {
    const e: CalendarEvent = {
      id: "evt-1",
      kind: "royal_court",
      title: "The Week's Honors",
      roomId: "world:royal-court",
      hostName: "The House",
      startsAt: "2026-11-02T14:00:00.000Z",
      endsAt: "2026-11-02T15:00:00.000Z",
      status: "scheduled",
      theme: null,
      note: "Honors night.",
    };
    expect(calendarEventAction(e)).toEqual({ type: "room", roomId: "world:royal-court" });
  });
});

describe("court gathering — the gate proof chain", () => {
  it("the rail refuses members in the court's own words, and the seam maps that refusal to its key", () => {
    expect(railSuite).toContain("Court gatherings are called by the house.");
    expect(railLib).toContain('privilege: "admin"');
    expect(seam).toContain('case "ADMIN_REQUIRED":');
    expect(seam).toContain('key: "refusedHouse"');
    expect(block).toContain("courtGatheringError");
  });
});
