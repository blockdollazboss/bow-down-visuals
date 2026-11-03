/**
 * saved-desk-components — stack1500 world parity wave #3
 * item 30 source-contract pins. The Saved desk must sit in the
 * My Studio stack as a board desk ({ isLight }), with:
 * - the shelf in-panel: kind tabs with counts, rows, and an
 *   Unsave on every row riding the rail's DELETE;
 * - the gone rows rendered as themselves (never vanished,
 *   never dressed up) with Unsave still offered;
 * - the honest states separate: loading, empty, failed+retry;
 * - no spend path (the rails are free);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/SavedDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function SavedDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-saved-desk"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const SavedDesk = lazy(() => import("@/components/world/native/SavedDesk")');
    expect(panel).toContain("<SavedDesk isLight={isLight} />");
  });
});

describe("the shelf in-panel", () => {
  it("kind tabs with counts and an Unsave riding the seam's delete path", () => {
    expect(desk).toContain('data-testid="world-saved-desk-tab-all"');
    expect(desk).toContain("data-testid={`world-saved-desk-tab-${kind}`}");
    expect(desk).toContain("saveDeletePath(item.kind, item.targetId)");
    expect(desk).toContain('method: "DELETE"');
    expect(desk).toContain("withoutSave(prev, item.kind, item.targetId)");
    expect(desk).toContain("saveCounts(items)");
  });

  it("gone rows say so plainly and still offer the Unsave", () => {
    expect(desk).toContain("item.gone");
    expect(desk).toContain("isn&rsquo;t available anymore");
    expect(desk).toContain("Unsave");
  });
});

describe("the honest states + free rails", () => {
  it("empty and failed-with-retry render as themselves", () => {
    expect(desk).toContain('data-testid="world-saved-desk-empty"');
    expect(desk).toContain("Nothing saved yet");
    expect(desk).toContain('data-testid="world-saved-desk-failed"');
    expect(desk).toContain("Try again");
  });

  it("plain fetches only, never confirmedFetch", () => {
    expect(desk).toContain("fetch(SAVES_PATH");
    expect(desk).not.toContain("confirmedFetch");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
