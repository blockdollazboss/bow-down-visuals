/**
 * brief-desk-components — stack1500 world parity wave #3 item 20
 * source-contract pins. The Morning Brief desk must sit in the My
 * Studio stack as a board desk ({ isLight }), with:
 * - the brief in-panel: summary, the move with its draft whole,
 *   a copy button, and the draft-only line — the desk NEVER has a
 *   send/post/execute affordance;
 * - the digest fallback and the failed state as separate honest
 *   states, the failed one with a working retry;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/BriefDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function BriefDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-brief-desk"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const BriefDesk = lazy(() => import("@/components/world/native/BriefDesk")');
    expect(panel).toContain("<BriefDesk isLight={isLight} />");
  });
});

describe("the brief in-panel, draft-only by construction", () => {
  it("summary, move, draft, copy — and the never-sends line", () => {
    for (const needle of [
      'data-testid="world-brief-desk-read"',
      'data-testid="world-brief-desk-brief"',
      'data-testid="world-brief-desk-draft"',
      'data-testid="world-brief-desk-copy"',
      "Copy the draft",
      "Your next move",
      "you review it and send",
      "nothing here sends for you",
      "BRIEF_MOVE_SURFACES[read.brief.move.kind]",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the read is a plain free fetch of the brief rail — no spend path exists", () => {
    expect(desk).toContain("fetch(BRIEF_PATH");
    expect(desk).not.toContain("confirmedFetch");
  });
});

describe("the honest states stay separate", () => {
  it("digest fallback says the written brief is unavailable and shows real numbers", () => {
    expect(desk).toContain('data-testid="world-brief-desk-digest"');
    expect(desk).toContain("The written brief is unavailable right now");
    expect(desk).toContain("digestLines(read.fallback)");
  });

  it("failure is its own state with a retry — never dressed as an empty brief", () => {
    expect(desk).toContain('data-testid="world-brief-desk-failed"');
    expect(desk).toContain("your numbers are fine, the reading is what");
    expect(desk).toContain("Try again");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
