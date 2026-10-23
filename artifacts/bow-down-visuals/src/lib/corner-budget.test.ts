import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #58 (A5-M6) — floating chrome corner budget at 390px.
 * Slots (documented in index.css): T1 language (x16) + theme toggle
 * default (x72); T2 Enter-World pill (top 4.25rem); B0 player bar
 * (bottom-0); B1 sidebar trigger (bottom-24, left rail); B2 chat drawer
 * width capped so its left edge clears the B1 rail.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const css = read("../index.css");
const toggle = read("../components/FloatingThemeToggle.tsx");
const chat = read("../components/ThyCheatCodeChat.tsx");
const lang = read("../components/layout/floating-language-switcher.tsx");
const trigger = read("../components/layout/mobile-sidebar-trigger.tsx");
const worldEntry = read("./world-entry.ts");
const player = read("../components/player/StreamingPlayerBar.tsx");

describe("corner budget (Stack-28 #58)", () => {
  it("budget is documented in the shell CSS", () => {
    expect(css).toContain("FLOATING CHROME CORNER BUDGET");
  });
  it("top-left slots do not overlap", () => {
    expect(lang).toContain("fixed top-4 left-4");
    expect(toggle).toContain(": { top: 16, left: 72 }");
    expect(worldEntry).toContain("top-[4.25rem]");
  });
  it("bottom slots are separated", () => {
    expect(player).toContain("fixed bottom-0 inset-x-0 z-[60] md:hidden");
    expect(trigger).toContain("fixed bottom-24 left-5 z-[9999]");
    expect(chat).toContain("w-[min(340px,calc(100vw-6rem))]");
    expect(chat).not.toContain("w-[min(340px,90vw)]");
  });
});
