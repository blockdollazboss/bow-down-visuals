/**
 * theme-packs.test.ts — Stack-100 #3, lane theme-packs.
 *
 * Pins the theme-pack contract:
 *  1. The registry: two house packs (the site's own light/dark themes)
 *     + at least four new worlds, every non-house pack in BOTH modes,
 *     every paired cursor a real cursor, no price anywhere in the data.
 *  2. CSS parity: the palettes in theme-packs.ts and the token blocks
 *     in index.css are the same values (house blocks included — the
 *     stylesheet stays the source of truth, this mirror serves the
 *     desk previews and the contrast pins, drift fails here).
 *  3. Readability: WCAG contrast floors for every pack variant — body
 *     pairs ≥ 7:1, supporting pairs ≥ 4.5:1 (the Ivory Palace table's
 *     own discipline: body ≥ 7, muted ≥ 4.5, display accents ≥ 3 —
 *     packs are held to the stricter line throughout).
 *  4. Apply/persist behavior against stubbed storage + document:
 *     one switch paints mode class + pack attribute + both storage
 *     keys + the paired cursor; a mode flip never strands a pack on a
 *     mode it doesn't define.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CURSOR_OPTIONS } from "@/lib/cursor-settings";
import {
  EXTRA_VAR_NAMES,
  HOUSE_PACK_FOR_MODE,
  THEME_PACKS,
  TOKEN_VAR_NAMES,
  applyThemeMode,
  applyThemePack,
  bootThemePack,
  contrastRatio,
  getActiveThemePack,
  hslToHex,
  isThemePackUnlocked,
  packModes,
  parseHsl,
  resolvePackMode,
  themePackById,
  variantVarMap,
  type ThemePackExtras,
  type ThemePackTokens,
  type ThemePackVariant,
} from "@/lib/theme-packs";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/* ─── CSS block parsing ─────────────────────────────────────────────── */

/** Parse the `--var: value;` lines of the block whose selector line is
    exactly `selector` (blocks in index.css end with `}` on its own
    line). Skips --radius: a global constant, not a themed token. */
function parseCssBlock(selector: string): Record<string, string> {
  const lines = css.split("\n");
  const start = lines.findIndex((l) => l.trim() === `${selector} {`);
  expect(start, `CSS block for ${selector}`).toBeGreaterThan(-1);
  const out: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "}") break;
    const m = /^\s*(--[\w-]+):\s*(.+);$/.exec(line);
    if (m && m[1] !== "--radius") out[m[1]!] = m[2]!.trim();
  }
  return out;
}

function pickVars(map: Record<string, string>, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) out[n] = map[n]!;
  return out;
}

const TOKEN_VARS = Object.values(TOKEN_VAR_NAMES);
const EXTRA_VARS = Object.values(EXTRA_VAR_NAMES);

/* ─── 1. Registry ───────────────────────────────────────────────────── */

describe("theme pack registry", () => {
  it("has unique ids and exactly the two house packs", () => {
    const ids = THEME_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const house = THEME_PACKS.filter((p) => p.house);
    expect(house.map((p) => p.id).sort()).toEqual(
      [HOUSE_PACK_FOR_MODE.light, HOUSE_PACK_FOR_MODE.dark].sort(),
    );
    expect(themePackById(HOUSE_PACK_FOR_MODE.light)!.variants.light).toBeDefined();
    expect(themePackById(HOUSE_PACK_FOR_MODE.light)!.variants.dark).toBeUndefined();
    expect(themePackById(HOUSE_PACK_FOR_MODE.dark)!.variants.dark).toBeDefined();
    expect(themePackById(HOUSE_PACK_FOR_MODE.dark)!.variants.light).toBeUndefined();
  });

  it("ships at least four new worlds beyond the house themes", () => {
    const fresh = THEME_PACKS.filter((p) => !p.house);
    expect(fresh.length).toBeGreaterThanOrEqual(4);
    for (const p of fresh) {
      // Every new world lives in BOTH modes — a pack must never
      // half-skin the mode it doesn't define.
      expect(packModes(p), p.id).toEqual(["light", "dark"]);
    }
  });

  it("every pack carries the full token + extras set in every variant", () => {
    for (const pack of THEME_PACKS) {
      for (const mode of packModes(pack)) {
        const v = pack.variants[mode]!;
        for (const k of Object.keys(TOKEN_VAR_NAMES) as (keyof ThemePackTokens)[]) {
          expect(parseHsl(v.tokens[k]), `${pack.id}/${mode} token ${k}`).not.toBeNull();
        }
        for (const k of Object.keys(EXTRA_VAR_NAMES) as (keyof ThemePackExtras)[]) {
          expect(parseHsl(v.extras[k]), `${pack.id}/${mode} extra ${k}`).not.toBeNull();
        }
      }
    }
  });

  it("pairs every pack with a real cursor and hex swatches", () => {
    const cursorIds = new Set(CURSOR_OPTIONS.map((c) => c.id));
    for (const pack of THEME_PACKS) {
      expect(cursorIds.has(pack.cursor), `${pack.id} cursor ${pack.cursor}`).toBe(true);
      for (const s of pack.swatches) expect(s).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("carries no price anywhere in the pack data (selling model is the owner's open call)", () => {
    const data = JSON.stringify(THEME_PACKS);
    expect(data).not.toMatch(/price/i);
    expect(data).not.toMatch(/\$\s?\d/);
    expect(data).not.toMatch(/\bVB\b|Visual Bucs|credits/i);
  });

  it("premium packs exist in shape and stay locked without an entitlement feed", () => {
    const premium = THEME_PACKS.filter((p) => p.tier === "premium");
    expect(premium.length).toBeGreaterThanOrEqual(1);
    for (const p of premium) {
      expect(isThemePackUnlocked(p)).toBe(false);
      expect(isThemePackUnlocked(p, [p.id])).toBe(true);
      expect(isThemePackUnlocked(p, ["someone-else"])).toBe(false);
    }
    for (const p of THEME_PACKS.filter((x) => x.tier === "included")) {
      expect(isThemePackUnlocked(p)).toBe(true);
    }
  });
});

/* ─── 2. CSS parity ─────────────────────────────────────────────────── */

describe("index.css parity — the TS mirror never drifts from the stylesheet", () => {
  it("house dark palette equals the :root, .dark block (core tokens)", () => {
    const pack = themePackById(HOUSE_PACK_FOR_MODE.dark)!;
    const parsed = parseCssBlock(":root, .dark");
    expect(pickVars(variantVarMap(pack.variants.dark!), TOKEN_VARS)).toEqual(
      pickVars(parsed, TOKEN_VARS),
    );
  });

  it("house light palette equals the .light block (core tokens + signature extras)", () => {
    const pack = themePackById(HOUSE_PACK_FOR_MODE.light)!;
    const parsed = parseCssBlock(".light");
    const mine = variantVarMap(pack.variants.light!);
    expect(pickVars(mine, TOKEN_VARS)).toEqual(pickVars(parsed, TOKEN_VARS));
    for (const [name, value] of Object.entries(pack.variants.light!.cssExtras ?? {})) {
      expect(parsed[name], `house light signature ${name}`).toBe(value);
    }
  });

  it("every non-house pack variant equals its data-theme-pack block, exactly", () => {
    for (const pack of THEME_PACKS.filter((p) => !p.house)) {
      for (const mode of packModes(pack)) {
        const selector =
          mode === "dark"
            ? `[data-theme-pack="${pack.id}"]:not(.light)`
            : `[data-theme-pack="${pack.id}"].light`;
        const parsed = parseCssBlock(selector);
        expect(parsed, `${pack.id}/${mode}`).toEqual(variantVarMap(pack.variants[mode]!));
      }
    }
  });

  it("pack blocks live after the house themes and the Ivory Palace tables", () => {
    const firstPack = css.indexOf('[data-theme-pack="');
    expect(firstPack).toBeGreaterThan(css.indexOf("IVORY PALACE — flagship light theme design system"));
    expect(firstPack).toBeGreaterThan(css.indexOf(".light .text-white"));
  });

  it("the shared pack machinery repaints with the house tables' exclusions", () => {
    const section = css.slice(css.indexOf("THEME PACKS (Stack-100 #3"));
    expect(section).toContain('[data-theme-pack].light .bg-black');
    expect(section).toContain('[data-theme-pack]:not(.light) .bg-black');
    expect(section).toContain("[data-theme-pack] ::selection");
    expect(section).toContain("var(--pk-glow-a)");
    // Every repaint rule keeps the [data-dark-lock] exclusions — the
    // editor and the locked cinema surfaces are never pack-painted.
    const repaintLines = section.split("\n").filter((l) => l.includes("[data-theme-pack]") && l.includes(".bg-"));
    expect(repaintLines.length).toBeGreaterThan(30);
    for (const line of repaintLines) {
      expect(line, line.trim()).toContain("[data-dark-lock]");
    }
  });
});

/* ─── 3. Contrast ───────────────────────────────────────────────────── */

const BODY_PAIRS: [keyof ThemePackTokens, keyof ThemePackTokens][] = [
  ["foreground", "background"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["sidebarForeground", "sidebar"],
];
const SUPPORT_PAIRS: [keyof ThemePackTokens, keyof ThemePackTokens][] = [
  ["mutedForeground", "background"],
  ["mutedForeground", "card"],
  ["secondaryForeground", "secondary"],
  ["primaryForeground", "primary"],
  ["accentForeground", "accent"],
  ["sidebarPrimaryForeground", "sidebarPrimary"],
  ["sidebarAccentForeground", "sidebarAccent"],
  ["destructiveForeground", "destructive"],
];

describe("contrast — every pack variant stays readable", () => {
  it("color math sanity: black/white is 21, order does not matter", () => {
    expect(contrastRatio("0 0% 0%", "0 0% 100%")).toBeCloseTo(21, 0);
    expect(contrastRatio("0 0% 100%", "0 0% 0%")).toBeCloseTo(21, 0);
    expect(hslToHex("45 95% 50%")).toBe("#f9bc06");
    expect(parseHsl("not a color")).toBeNull();
  });

  for (const pack of THEME_PACKS) {
    for (const mode of packModes(pack)) {
      it(`${pack.id} (${mode}): body pairs ≥ 7, support pairs ≥ 4.5`, () => {
        const v: ThemePackVariant = pack.variants[mode]!;
        for (const [a, b] of BODY_PAIRS) {
          const r = contrastRatio(v.tokens[a], v.tokens[b]);
          expect(r, `${a} on ${b}`).not.toBeNull();
          expect(r!, `${a} on ${b} = ${r?.toFixed(2)}`).toBeGreaterThanOrEqual(7);
        }
        for (const [a, b] of SUPPORT_PAIRS) {
          const r = contrastRatio(v.tokens[a], v.tokens[b]);
          expect(r, `${a} on ${b}`).not.toBeNull();
          expect(r!, `${a} on ${b} = ${r?.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
        // Mode-specific accent ink + selection ink stay readable too.
        const accentInk = mode === "dark" ? v.extras.accentText : v.extras.deepAccent;
        expect(contrastRatio(accentInk, v.tokens.background)!).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(v.extras.selectionInk, v.extras.selection)!).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/* ─── 4. Apply / persist behavior ───────────────────────────────────── */

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

class FakeClassList {
  private set = new Set<string>();
  toggle(name: string, force?: boolean) {
    if (force === undefined) {
      if (this.set.has(name)) this.set.delete(name);
      else this.set.add(name);
    } else if (force) this.set.add(name);
    else this.set.delete(name);
  }
  add(name: string) {
    this.set.add(name);
  }
  remove(name: string) {
    this.set.delete(name);
  }
  contains(name: string) {
    return this.set.has(name);
  }
}

function stubBrowser() {
  const storage = new FakeStorage();
  const attrs = new Map<string, string>();
  const classList = new FakeClassList();
  const dispatched: string[] = [];
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    },
  });
  vi.stubGlobal("window", {
    dispatchEvent: (e: Event) => {
      dispatched.push(e.type);
      return true;
    },
  });
  return { storage, attrs, classList, dispatched };
}

describe("apply / persist", () => {
  it("resolvePackMode: preferred mode when the pack lives there, else the pack's own", () => {
    const shark = themePackById("shark-tank")!;
    expect(resolvePackMode(shark, "dark")).toBe("dark");
    expect(resolvePackMode(shark, "light")).toBe("light");
    const houseLight = themePackById(HOUSE_PACK_FOR_MODE.light)!;
    expect(resolvePackMode(houseLight, "dark")).toBe("light");
  });

  it("defaults to the house pack for the stored mode", () => {
    stubBrowser();
    expect(getActiveThemePack().id).toBe(HOUSE_PACK_FOR_MODE.dark);
  });

  it("applying a pack paints attribute + mode + both keys + paired cursor", () => {
    const { storage, attrs, classList } = stubBrowser();
    storage.setItem("bdv-theme", "dark");
    const res = applyThemePack("shark-tank");
    expect(res?.pack.id).toBe("shark-tank");
    expect(res?.mode).toBe("dark");
    expect(attrs.get("data-theme-pack")).toBe("shark-tank");
    expect(classList.contains("dark")).toBe(true);
    expect(storage.getItem("bdv-theme-pack")).toBe("shark-tank");
    expect(storage.getItem("bdv-cursor-choice")).toBe("pixel-shark");
  });

  it("applying a single-mode pack brings its mode with it", () => {
    const { storage, attrs, classList } = stubBrowser();
    storage.setItem("bdv-theme", "dark");
    const res = applyThemePack("golden-marble-light");
    expect(res?.mode).toBe("light");
    expect(classList.contains("light")).toBe(true);
    expect(storage.getItem("bdv-theme")).toBe("light");
    expect(attrs.has("data-theme-pack")).toBe(false); // house: attribute removed
  });

  it("pairCursor:false leaves the visitor's cursor alone", () => {
    const { storage } = stubBrowser();
    storage.setItem("bdv-cursor-choice", "flame");
    applyThemePack("rose-gold-palace", { pairCursor: false });
    expect(storage.getItem("bdv-cursor-choice")).toBe("flame");
    applyThemePack("rose-gold-palace");
    expect(storage.getItem("bdv-cursor-choice")).toBe("diamond");
  });

  it("unknown pack id applies nothing", () => {
    const { storage, attrs } = stubBrowser();
    expect(applyThemePack("no-such-pack")).toBeNull();
    expect(attrs.size).toBe(0);
    expect(storage.getItem("bdv-theme-pack")).toBeNull();
  });

  it("flipping mode inside a dual-mode pack keeps the pack", () => {
    const { storage, attrs, classList } = stubBrowser();
    applyThemePack("shark-tank");
    const res = applyThemeMode("light");
    expect(res.pack.id).toBe("shark-tank");
    expect(attrs.get("data-theme-pack")).toBe("shark-tank");
    expect(classList.contains("light")).toBe(true);
    expect(storage.getItem("bdv-theme")).toBe("light");
  });

  it("flipping mode out of a single-mode pack lands on that mode's house pack", () => {
    const { storage, attrs } = stubBrowser();
    applyThemePack("golden-black-marble");
    const res = applyThemeMode("light");
    expect(res.pack.id).toBe(HOUSE_PACK_FOR_MODE.light);
    expect(attrs.has("data-theme-pack")).toBe(false);
    expect(storage.getItem("bdv-theme-pack")).toBe(HOUSE_PACK_FOR_MODE.light);
  });

  it("boot restores the saved pack and its mode before first paint", () => {
    const { storage, attrs, classList } = stubBrowser();
    storage.setItem("bdv-theme-pack", "studio-clean");
    storage.setItem("bdv-theme", "light");
    bootThemePack();
    expect(attrs.get("data-theme-pack")).toBe("studio-clean");
    expect(classList.contains("light")).toBe(true);
  });

  it("boot with a saved single-mode pack brings the pack's mode", () => {
    const { storage, attrs, classList } = stubBrowser();
    storage.setItem("bdv-theme-pack", "golden-marble-light");
    storage.setItem("bdv-theme", "dark");
    bootThemePack();
    expect(classList.contains("light")).toBe(true);
    expect(attrs.has("data-theme-pack")).toBe(false);
  });
});
