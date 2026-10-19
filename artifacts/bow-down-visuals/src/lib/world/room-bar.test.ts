/**
 * The palace directory as a room switcher (stack-3, room bar fix).
 *
 * The defect (proven live 2026-10-19): the World's room bar — the
 * "The Palace" directory on the world page, and the same directory
 * listed on the Kingdom Board — rendered every room as plain,
 * non-focusable text. Mouse users walked through 3D doorways, but
 * keyboard and screen-reader users could not switch rooms at all;
 * the Treasury was unreachable by keyboard.
 *
 * Pinned contract:
 * - each room entry is a REAL <button type="button">, so Tab focus
 *   and Enter/Space activation come from native button semantics —
 *   there is deliberately NO synthetic key handler (one would
 *   double-fire on top of the native click);
 * - the button rides the SAME switch path a doorway crossing uses:
 *   the page's goToDirectoryRoom dispatches exactly like the
 *   Kingdom Board calendar walk — a palace room takes the plain
 *   transfer (client.enterRoom → the "room.enter" socket frame),
 *   a creator room goes through its doorway transfer (the read
 *   that proves the room is open). Nothing about WHO may enter a
 *   room changes: the client refuses while we aren't inside, and
 *   the server still answers every room.enter;
 * - the room you stand in carries aria-current, and every entry's
 *   accessible label names the room + the occupant count the pill
 *   itself displays (the same values, no new data);
 * - the focus ring is a gold focus-visible ring with a theme-
 *   matched offset, readable on the cream bar and the black bar;
 * - the Kingdom Board's rows are buttons when the host wires the
 *   walk (onEnterRoom) and stay the look-only directory when it
 *   doesn't — the board's copy follows which one it is.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const page = read("../../pages/world.tsx");
const client = read("./world-client.ts");
const panel = read("../../components/world/StationPanel.tsx");

/** The directory bar block: from its testid to the party summons. */
const bar = page.slice(
  page.indexOf('data-testid="world-directory"'),
  page.indexOf("The party summons (2.23)"),
);

describe("the world page's directory bar", () => {
  it("renders each room as a real button, not a span", () => {
    expect(bar).toContain("<button");
    expect(bar).toContain('type="button"');
    expect(bar).toContain('data-testid="world-directory-room"');
    // The old plain-text pill is gone: no span carries the room testid.
    expect(bar).not.toMatch(/<span[^>]*data-testid="world-directory-room"/);
  });

  it("marks the room you stand in with aria-current", () => {
    expect(bar).toContain('aria-current={here ? "true" : undefined}');
  });

  it("labels each room with its name and the occupant count the pill displays", () => {
    expect(bar).toContain("aria-label={`${r.name}, ${r.count}");
    expect(bar).toContain('"person" : "people"} inside');
    expect(bar).toContain('", you\'re here"');
  });

  it("wears a gold focus-visible ring with a theme-matched offset", () => {
    expect(bar).toContain("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]");
    expect(bar).toContain('isLight ? "focus-visible:ring-offset-[#FBF6E9]" : "focus-visible:ring-offset-[#070605]"');
  });

  it("activates through goToDirectoryRoom — Enter/Space fire a button's click", () => {
    expect(bar).toContain("onClick={() => goToDirectoryRoom(r)}");
  });
});

describe("the switch path the button rides", () => {
  it("is the doorway path: enterRoom sends the room.enter frame and refuses the current room", () => {
    expect(client).toContain("enterRoom(roomId: string");
    expect(client).toContain('this.send({ type: "room.enter", roomId');
    expect(client).toContain("if (this.room?.id === roomId) return;");
    expect(client).toContain('if (this.status !== "inside" || !this.self) return;');
    // The scene's doorway crossing lands on the very same method.
    expect(page).toContain("scene.onRoomEnter = (nextRoomId) => {");
    expect(page).toContain("client.enterRoom(nextRoomId, pose);");
  });

  it("goToDirectoryRoom dispatches like the calendar walk: creator rooms through the doorway transfer, palace rooms through the plain transfer", () => {
    expect(page).toContain("const goToDirectoryRoom = useCallback((entry: PalaceDirectoryEntry) => {");
    expect(page).toContain("const slug = creatorSlugFromRoomId(entry.id);");
    expect(page).toContain("void enterCreatorRoomRef.current(slug);");
    expect(page).toContain("clientRef.current?.enterRoom(entry.id);");
    // A tap before we're inside is refused up front, never an error.
    expect(page).toContain('if (clientRef.current?.status !== "inside") return;');
  });

  it("the page threads the same walk into the Kingdom Board panel", () => {
    expect(page).toContain("onEnterRoom={(roomId) => {");
    expect(page).toContain("clientRef.current?.enterRoom(roomId);");
  });
});

describe("the Kingdom Board's directory rows", () => {
  it("are buttons riding onEnterRoom when the host wires the walk", () => {
    expect(panel).toContain("return onEnterRoom ? (");
    expect(panel).toContain('data-testid="world-board-room"');
    expect(panel).toContain("onClick={() => onEnterRoom(r.id)}");
    expect(panel).toContain('aria-current={here ? "true" : undefined}');
    expect(panel).toContain("aria-label={rowLabel}");
    expect(panel).toContain("focus-visible:ring-2 focus-visible:ring-[#d4af37]");
  });

  it("keep the look-only row when no host wires the walk, and the copy follows", () => {
    expect(panel).toContain('<div key={r.id} data-testid="world-board-room"');
    expect(panel).toContain('"tap a room, or walk through a door, and your name moves with you"');
    expect(panel).toContain('"walk through a door and your name moves with you"');
  });

  it("labels each row with the room name and the count it displays", () => {
    expect(panel).toContain("const rowLabel = `${r.name}, ${r.count}");
  });
});
