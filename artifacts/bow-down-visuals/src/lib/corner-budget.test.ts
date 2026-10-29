import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #58 (A5-M6) — floating chrome corner budget at 390px.
 * Slots (documented in index.css): T1 language (x16) + theme toggle
 * default (x72) + pack picker (x128), all at top 68px since the stack700
 * extension (the jackpot banner band owns the document-top strip);
 * T2 Enter-World pill (top 7.5rem); B0 player bar (bottom-0); B1 sidebar
 * trigger (bottom-24, left rail); B2 chat drawer width capped so its
 * left edge clears the B1 rail.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const css = read("../index.css");
const toggle = read("../components/FloatingThemeToggle.tsx");
const chat = read("../components/ThyCheatCodeChat.tsx");
const lang = read("../components/layout/floating-language-switcher.tsx");
const trigger = read("../components/layout/mobile-sidebar-trigger.tsx");
const worldEntry = read("./world-entry.ts");
const player = read("../components/player/StreamingPlayerBar.tsx");
const picker = read("../components/theme-packs/ThemePackQuickPicker.tsx");
const guide = read("../components/BowDownAIGuide.tsx");

describe("corner budget (Stack-28 #58)", () => {
  it("budget is documented in the shell CSS", () => {
    expect(css).toContain("FLOATING CHROME CORNER BUDGET");
  });
  it("top-left slots do not overlap", () => {
    expect(lang).toContain("fixed top-[4.25rem] left-4");
    expect(toggle).toContain(": { top: 68, left: 72 }");
    expect(picker).toContain("left-[128px] top-[4.25rem]");
    expect(worldEntry).toContain("top-[7.5rem]");
  });
  it("top-left row clears the jackpot banner band (stack700)", () => {
    /* The banner is the first in-flow band (~57px tall). No T1/T2 slot
       may start inside it, and the guide's TL snap must clear T1's
       112px floor by its 16px margin (SNAP_M 20 + 108 = 128). */
    expect(css).toContain("slot T1 (top 68px");
    expect(guide).toContain("y: m + 108");
    expect(toggle).not.toContain(": { top: 16, left: 72 }");
    expect(worldEntry).not.toContain("top-[4.25rem]");
  });
  it("bottom slots are separated", () => {
    expect(player).toContain("fixed bottom-0 inset-x-0 z-[60] md:hidden");
    expect(trigger).toContain("fixed bottom-24 left-5 z-[9999]");
    expect(chat).toContain("w-[min(340px,calc(100vw-6rem))]");
    expect(chat).not.toContain("w-[min(340px,90vw)]");
  });
});
