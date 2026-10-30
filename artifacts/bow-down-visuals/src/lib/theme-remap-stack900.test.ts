/**
 * Stack900 light-truth audit — pins for the §20 rungs and the two
 * dark-lock islands. Each rule below healed a surface where a class
 * fell between the §1–§19 tables (a missing opacity step, a side-
 * specific class name, an uncovered via hex) while its partner ink
 * remapped — the dark-on-dark / washed-on-ivory family. The pins keep
 * the rungs from being trimmed away, and the scoping test keeps every
 * one of them light-only (dark rendering must never move).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const videos = readFileSync(
  new URL("../pages/templates/videos.tsx", import.meta.url),
  "utf8",
);
const effects = readFileSync(
  new URL("../components/editor/sections/EffectsSection.tsx", import.meta.url),
  "utf8",
);
const jewelry = readFileSync(
  new URL("../pages/jewelry-shop.tsx", import.meta.url),
  "utf8",
);

const GUARDED = ":not([data-dark-lock]):not([data-dark-lock] *)";

/** Every selector string a §20 rung must appear as in the stylesheet. */
const RUNGS: Array<[string, string]> = [
  // [selector fragment, expected declaration snippet]
  [`.light .via-\\[\\#0d0a04\\]${GUARDED}`, "--tw-gradient-via: rgb(250 247 240 / 0.6)"],
  [`.light .bg-\\[\\#171208\\]\\/65${GUARDED}`, "background-color: rgb(253 251 246 / 0.72)"],
  [`.light .text-emerald-100${GUARDED}`, "color: #047857"],
  [`.light .text-emerald-100\\/70${GUARDED}`, "color: rgb(4 120 87 / 0.82)"],
  [`.light .text-amber-100\\/45${GUARDED}`, "color: rgb(138 107 31 / 0.71)"],
  [`.light .text-amber-200\\/30${GUARDED}`, "color: rgb(138 107 31 / 0.55)"],
  [`.light .text-amber-200\\/25${GUARDED}`, "color: rgb(138 107 31 / 0.5)"],
  [`.light .text-yellow-200\\/90${GUARDED}`, "color: rgb(138 107 31 / 0.92)"],
  [`.light .text-yellow-200\\/60${GUARDED}`, "color: rgb(138 107 31 / 0.78)"],
  [`.light .text-red-200\\/85${GUARDED}`, "color: rgb(185 28 28 / 0.9)"],
  [`.light .text-emerald-200\\/85${GUARDED}`, "color: rgb(4 120 87 / 0.9)"],
  [`.light .text-\\[\\#d4af37\\]${GUARDED}`, "color: #8A6B1F"],
  [`.light .text-\\[\\#d4af37\\]\\/80${GUARDED}`, "color: rgb(138 107 31 / 0.92)"],
  [`.light .text-\\[\\#d4af37\\]\\/70${GUARDED}`, "color: rgb(138 107 31 / 0.86)"],
  [`.light .text-\\[\\#d4af37\\]\\/50${GUARDED}`, "color: rgb(138 107 31 / 0.74)"],
  [`.light .text-\\[\\#d4a017\\]${GUARDED}`, "color: #8A6B1F"],
  [`.light .text-\\[\\#f5e6b8\\]${GUARDED}`, "color: #8A6B1F"],
  [`.light .text-\\[\\#C9A84C\\]\\/90${GUARDED}`, "color: rgb(138 107 31 / 0.92)"],
  [`.light .text-\\[\\#C9A84C\\]\\/70${GUARDED}`, "color: rgb(138 107 31 / 0.86)"],
  [`.light .text-\\[\\#C9A84C\\]\\/60${GUARDED}`, "color: rgb(138 107 31 / 0.8)"],
  [`.light .text-\\[\\#C9A84C\\]\\/50${GUARDED}`, "color: rgb(138 107 31 / 0.74)"],
  [`.light .text-\\[\\#C9A84C\\]\\/40${GUARDED}`, "color: rgb(138 107 31 / 0.68)"],
  [`.light .text-\\[\\#c9a84c\\]\\/70${GUARDED}`, "color: rgb(138 107 31 / 0.86)"],
  [`.light .text-\\[\\#c9a84c\\]\\/60${GUARDED}`, "color: rgb(138 107 31 / 0.8)"],
  [`.light .text-\\[\\#c9a84c\\]\\/40${GUARDED}`, "color: rgb(138 107 31 / 0.68)"],
  [`.light .hover\\:border-white\\/35:hover${GUARDED}`, "border-color: rgb(201 168 76 / 0.38)"],
  [`.light .border-t-white\\/60${GUARDED}`, "border-top-color: rgb(201 168 76 / 0.65)"],
];

describe("stack900 §20 rungs exist, guarded, with their values", () => {
  it.each(RUNGS)("%s", (selector, declaration) => {
    const at = css.indexOf(selector);
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, at + 400)).toContain(declaration);
  });

  it("placeholder rungs land on §11's readable value", () => {
    for (const step of ["35", "30"]) {
      const sel = `.light .placeholder\\:text-amber-100\\/${step}${GUARDED}::placeholder`;
      const at = css.indexOf(sel);
      expect(at).toBeGreaterThan(-1);
      expect(css.slice(at, at + 300)).toContain("color: #7A7266");
    }
  });

  it("every §20 selector is light-scoped (no unscoped copy can move dark)", () => {
    const start = css.indexOf("── 20. Stack900 light-truth");
    const end = css.indexOf("HOMEPAGE LIGHT MODE", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = css.slice(start, end);
    const selectorLines = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("."));
    expect(selectorLines.length).toBeGreaterThan(20);
    expect(selectorLines.every((l) => l.startsWith(".light"))).toBe(true);
  });
});

describe("the two dark islands carry their lock", () => {
  it("templates/videos share strip is data-dark-lock", () => {
    expect(videos).toContain('data-dark-lock className={`mt-3 rounded-xl border px-3.5 py-3');
  });
  it("EffectsSection watermark swatch is data-dark-lock", () => {
    expect(effects).toContain('data-dark-lock className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-white/[0.08]"');
  });
});

describe("jewelry-shop steppers branch like nfc-cards", () => {
  it("no unconditional hover:bg-zinc-700 remains in jewelry-shop", () => {
    expect(jewelry).not.toContain('rounded-lg bg-zinc-800 hover:bg-zinc-700');
    expect(jewelry).toContain('isLight ? "bg-[#C9A84C]/20 hover:bg-[#C9A84C]/35" : "bg-zinc-800 hover:bg-zinc-700"');
  });
});
