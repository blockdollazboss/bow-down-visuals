import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #57 (A5-M5 scoped) — video-editor.tsx carries no sub-11px text.
 * Editor-scoped only: transport labels, badges, panel microcopy raised to
 * text-[11px]; structure/layout classes untouched.
 */
const src = readFileSync(new URL("../pages/video-editor.tsx", import.meta.url), "utf8");

describe("editor text size (Stack-28 #57)", () => {
  it("no text-[7px..10px] utilities remain in video-editor.tsx", () => {
    expect(src).not.toMatch(/text-\[(7|8|9|10)px\]/);
    expect(src).not.toContain("fontSize: 9");
  });
});
