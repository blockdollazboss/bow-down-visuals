/**
 * stage-drop-booking-wiring — the source-contract pins for the
 * stack1300 stage-booking lane (Ring 3.1 + the drop bench).
 *
 * The stage block must stay MOUNTED on the Kingdom Board (beside
 * the slate it feeds), must post through the seam builder to the
 * rail, must carry the Front Row refusal to the member's eyes, and
 * must keep the catalog's failure state separate from its empty
 * state. The drop bench must stay DOCKED in /admin with the page's
 * authHeaders, post kind "drop" through its seam, and keep its
 * load failure (with Retry) separate from an empty slate.
 *
 * THE GATE PROOF CHAIN: the rail's own suite refuses a plain member
 * the stage (FRONT_ROW_REQUIRED); the seam maps that refusal to its
 * words; this file pins both ends so neither can silently rot.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..");
const API_SRC = join(SRC, "..", "..", "api-server", "src");

const board = readFileSync(join(SRC, "components/world/native/KingdomBoardBlocks.tsx"), "utf8");
const block = readFileSync(join(SRC, "components/world/native/StageBookingBlock.tsx"), "utf8");
const stageSeam = readFileSync(join(SRC, "lib/world/stage-booking.ts"), "utf8");
const adminPage = readFileSync(join(SRC, "pages/admin.tsx"), "utf8");
const bench = readFileSync(join(SRC, "components/WorldDropAdmin.tsx"), "utf8");
const dropSeam = readFileSync(join(SRC, "lib/world/drop-booking.ts"), "utf8");
const railSuite = readFileSync(join(API_SRC, "routes/__tests__/world-events.test.ts"), "utf8");
const railLib = readFileSync(join(API_SRC, "lib/world-events.ts"), "utf8");

describe("stage booking — mounted on the Kingdom Board", () => {
  it("the board imports and mounts the block beside the calendar, guests included", () => {
    expect(board).toContain('import { StageBookingBlock } from "./StageBookingBlock"');
    expect(board).toContain("<StageBookingBlock isLight={isLight} isGuest={isGuest} />");
    expect(board.indexOf("<PalaceCalendarBlock")).toBeLessThan(board.indexOf("<StageBookingBlock"));
  });

  it("the block posts a built stage_show body to the rail and lists/cancels its own shows", () => {
    expect(stageSeam).toContain('kind: "stage_show"');
    expect(stageSeam).toContain("STAGE_ROOM_ID = HALL_ROOM_ID");
    expect(stageSeam).toContain('from "./palace-layout"');
    expect(block).toContain("buildStageShowBody");
    expect(block).toContain("fetch(STAGE_BOOK_PATH");
    expect(block).toContain('method: "POST"');
    expect(block).toContain("fetch(STAGE_MINE_PATH");
    expect(block).toContain("stageCancelPath(show.id)");
    expect(block).toContain('data-testid="world-stage-submit"');
    expect(block).toContain('data-testid="world-stage-pick"');
    expect(block).toContain('data-testid="world-stage-mine"');
    expect(block).toContain('data-testid="world-stage-cancel"');
  });

  it("the content picker reads the screen catalog — mine shelf first", () => {
    expect(block).toContain("fetch(STAGE_SCREEN_CATALOG_PATH");
    expect(block).toContain("parseScreenCatalog");
    expect(block).toContain("setChoice({ type: \"live\" })");
    expect(block).toContain("contentRef");
  });

  it("a guest gets the pitch and the sign-in door, never the form", () => {
    expect(block).toContain("if (isGuest)");
    expect(block).toContain("GUEST_SIGN_IN_HREF");
    expect(block).toContain('data-testid="world-stage-booking"');
  });

  it("catalog failure is NOT the empty state — it carries a working Retry", () => {
    expect(block).toContain("catalogFailed");
    expect(block).toContain("NativeErrorState");
    expect(block).toContain("onRetry={() => void loadCatalog()}");
    expect(block).toContain("worldStageBooking.catalogEmpty");
  });
});

describe("the booking-rule gate — a non-Front-Row member cannot book the stage", () => {
  it("the rail itself refuses a plain member (the server suite proves it)", () => {
    expect(railLib).toContain('"front-row-or-admin"');
    expect(railSuite).toContain("a plain member is refused the stage");
    expect(railSuite).toContain("FRONT_ROW_REQUIRED");
  });

  it("the seam maps the refusal to the refusal words, and the block speaks them", () => {
    expect(stageSeam).toContain('"FRONT_ROW_REQUIRED"');
    expect(stageSeam).toContain('"refusedFrontRow"');
    expect(block).toContain("stageBookingError(res.status, data)");
    expect(block).toContain("worldStageBooking.errors.");
  });

  it("the drop gate is the same shape: the house-only refusal reaches the bench", () => {
    expect(dropSeam).toContain('"ADMIN_REQUIRED"');
    expect(dropSeam).toContain('"refusedAdmin"');
    expect(bench).toContain("dropBookingError(res.status, data)");
  });
});

describe("drop bench — docked in /admin on the same backbone", () => {
  it("the page imports and docks the bench with the house authHeaders", () => {
    expect(adminPage).toContain('import { WorldDropAdmin } from "@/components/WorldDropAdmin"');
    expect(adminPage).toContain("<WorldDropAdmin authHeaders={authHeaders} />");
  });

  it("the bench books through its seam and reads the slate strictly", () => {
    expect(dropSeam).toContain('kind: "drop"');
    expect(bench).toContain("buildDropBody");
    expect(bench).toContain("fetch(DROP_BOOK_PATH");
    expect(bench).toContain("parseUpcomingDrops");
    expect(bench).toContain('data-testid="world-drop-admin-bench"');
    expect(bench).toContain('data-testid="world-drop-submit"');
  });

  it("the room picker is the palace's own rooms — spectacles never land in a creator room", () => {
    expect(dropSeam).toContain("PALACE_LAYOUT");
    expect(dropSeam).toContain("isDropRoomId");
    expect(bench).toContain("dropRooms()");
  });

  it("load failure and an empty slate are separate states, failure with a working Retry", () => {
    expect(bench).toContain("loadError");
    expect(bench).toContain('data-testid="world-drop-load-error"');
    expect(bench).toContain('data-testid="world-drop-retry"');
    expect(bench).toContain("setRetryNonce");
    expect(bench).toContain('data-testid="world-drop-empty"');
  });
});
