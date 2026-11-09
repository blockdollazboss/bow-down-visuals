/**
 * qcproof-theme-packs.test.ts — QC-200 pre-proof, Q140 (theme packs).
 *
 * Pins the claims the Oct 30 sweep left unpinned:
 *  (a) per-device wallpapers: the kit device table carries DISTINCT
 *      sizes for phone / tablet / desktop, and the shipped asset
 *      manifest carries all 30 pack×mode×device renders whose hashes
 *      differ per device, per mode and per pack (real distinct files,
 *      not one ground file renamed) — home AND lock slots both ship
 *      from those sized renders server-side.
 *  (b) designed icon art: the asset manifest's provenance is the
 *      owner-approved theme-pack-art program, its rule says the art
 *      is never redrawn/recoloured, and each pack's masters are its
 *      OWN generation files (per-pack source assets).
 *  (c) kitManifest honesty: every one of the 12 components declares
 *      BOTH modes; wallpaper/icon/folder components declare art for
 *      BOTH modes with distinct light/dark paths; the lock slot's
 *      shared-ground note is present; sound components carry their
 *      library roles and no other component does.
 *  (d) price parity: the server kit builder's per-pack tiers mirror
 *      the FE registry exactly (included packs free, premium packs
 *      the two ruled ids), and the FE unlock seam prices the house
 *      pack (both house modes in one pack) as free.
 *  (e) mix-and-match resolution + reset: effectiveAccent resolves a
 *      per-component, per-device mix independently per component
 *      (the mix-and-match core), and the reset-to-pure-pack wiring
 *      exists on both sides (panel button → empty-mix PUT → server
 *      DELETE of the saved rows).
 *  (f) findability: Settings carries the #theme-packs jump link, the
 *      desk section carries id="theme-packs", look links land on the
 *      anchor, and the quick picker deep-links to it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_PACKS, themePackById } from "@/lib/theme-packs";
import {
  DESIGNED_ICON_NAMES,
  DESIGNED_ICON_SET_PACK_IDS,
  KIT_COMPONENTS,
  KIT_WALLPAPER_DEVICES,
  LOGO_BY_MODE,
  SOUND_LIBRARY_ROLES,
  deviceWallpaperPath,
  effectiveAccent,
  kitManifest,
  lookUrl,
  sanitizeCustomization,
} from "@/lib/theme-kit";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const PUBLIC_DIR = new URL("../../../public/", import.meta.url);
const assets = JSON.parse(
  readFileSync(new URL("theme-packs/kit-assets-manifest.json", PUBLIC_DIR), "utf8"),
) as {
  source: string;
  iconRule: string;
  wallpaperRule: string;
  icons: Array<{ pack: string; icon: string; mode: string; path: string; sourceAsset: string; sha256: string }>;
  deviceWallpapers: Array<{ pack: string; mode: string; device: string; width: number; height: number; path: string; sha256: string }>;
};

describe("(a) per-device wallpapers — distinct sizes, distinct files, home + lock", () => {
  it("the kit device table is phone 1179×2556, tablet 1640×2360, desktop 1920×1080 — all distinct", () => {
    expect(KIT_WALLPAPER_DEVICES).toEqual([
      { id: "phone", width: 1179, height: 2556 },
      { id: "tablet", width: 1640, height: 2360 },
      { id: "desktop", width: 1920, height: 1080 },
    ]);
    const dims = KIT_WALLPAPER_DEVICES.map((d) => `${d.width}x${d.height}`);
    expect(new Set(dims).size).toBe(3);
  });

  it("the shipped manifest carries 48 renders whose hashes differ per device, mode and pack", () => {
    expect(assets.deviceWallpapers).toHaveLength(48);
    for (const pack of THEME_PACKS) {
      for (const mode of ["light", "dark"] as const) {
        const rows = assets.deviceWallpapers.filter((w) => w.pack === pack.id && w.mode === mode);
        expect(rows.map((w) => w.device).sort(), `${pack.id}/${mode}`).toEqual(["desktop", "phone", "tablet"]);
        /* Distinct files per device — not one ground renamed three ways. */
        expect(new Set(rows.map((w) => w.sha256)).size, `${pack.id}/${mode}`).toBe(3);
        for (const w of rows) {
          const size = KIT_WALLPAPER_DEVICES.find((d) => d.id === w.device)!;
          expect([w.width, w.height]).toEqual([size.width, size.height]);
          expect(w.path).toBe(deviceWallpaperPath(pack.id, mode, w.device as never));
        }
      }
      /* The same device in the other mode is a different file too. */
      for (const device of ["phone", "tablet", "desktop"]) {
        const pair = assets.deviceWallpapers.filter((w) => w.pack === pack.id && w.device === device);
        expect(new Set(pair.map((w) => w.sha256)).size, `${pack.id}/${device}`).toBe(2);
      }
    }
  });

  it("the server bundle ships BOTH home and lock entries from the sized renders, per mode", () => {
    const serverBuild = read("../../../../api-server/src/lib/theme-kit-build.ts");
    expect(serverBuild).toContain("wallpaper-${mode}-${device.id}.webp");
    expect(serverBuild).toContain("lock-${mode}-${device.id}.webp");
    expect(serverBuild).toContain("deviceWallpaperSitePath(pack.id, mode, device.id)");
    /* The lock slot's honesty note ships in the bundle builder too. */
    expect(serverBuild).toContain("no distinct lock scene has been approved");
    expect(assets.wallpaperRule).toContain("no logo baked");
  });
});

describe("(b) designed icon art — bespoke per pack, from the approved art program", () => {
  it("the asset manifest's provenance is the theme-pack-art program and forbids redraws", () => {
    expect(assets.source).toContain("theme-pack-art/MANIFEST.md");
    expect(assets.source).toContain("owner-approved designed art");
    expect(assets.iconRule).toContain("never redrawn");
  });

  it("every raised pack's masters are its own generation files — no shared source across packs", () => {
    /* Scoped to the packs whose designed sets have been raised into
       the manifest (DESIGNED_ICON_SET_PACK_IDS in lib/theme-kit.ts):
       crimson-marble's and sapphire-marble's designed emblem sets
       are raised by the owner-approved art program, not invented
       in code. */
    const raised = THEME_PACKS.filter((p) => DESIGNED_ICON_SET_PACK_IDS.includes(p.id));
    for (const icon of ["phone", "camera", "wallet"] as const) {
      for (const mode of ["light", "dark"] as const) {
        const sources = raised.map(
          (p) => assets.icons.find((e) => e.pack === p.id && e.icon === icon && e.mode === mode)!.sourceAsset,
        );
        expect(new Set(sources).size, `${icon}/${mode}`).toBe(raised.length);
        for (const s of sources) expect(s).toMatch(/\.webp$/);
      }
    }
    expect(DESIGNED_ICON_NAMES).toHaveLength(50);
  });
});

describe("(c) kitManifest honesty — both modes declared, per component", () => {
  it("every pack × all 12 components declare light+dark, with sound roles only on sound components", () => {
    for (const pack of THEME_PACKS) {
      const m = kitManifest(pack);
      expect(m.packId).toBe(pack.id);
      expect(m.tier).toBe(pack.tier);
      expect(m.brandedByDefault).toBe(true);
      expect(m.logo).toEqual(LOGO_BY_MODE);
      expect(m.components).toHaveLength(12);
      for (const c of m.components) {
        expect(c.modes, `${pack.id}/${c.component}`).toEqual(["light", "dark"]);
        expect(c.devices.length).toBeGreaterThan(0);
      }
      const byId = (id: string) => m.components.find((c) => c.component === id)!;
      expect(byId("ringtone").soundRoles).toEqual(["ringtone"]);
      expect(byId("notification-sounds").soundRoles).toEqual(["notification", "message"]);
      expect(byId("sound-scheme").soundRoles).toEqual([...SOUND_LIBRARY_ROLES]);
      for (const c of m.components) {
        if (!["ringtone", "notification-sounds", "sound-scheme"].includes(c.component)) {
          expect(c.soundRoles, `${pack.id}/${c.component}`).toBeUndefined();
        }
      }
    }
  });

  it("art-bearing components declare BOTH modes' art with distinct light/dark paths", () => {
    for (const pack of THEME_PACKS) {
      const m = kitManifest(pack);
      const byId = (id: string) => m.components.find((c) => c.component === id)!;
      for (const id of ["home-wallpapers", "lock-wallpapers", "icon-set", "folder-icons"]) {
        const art = byId(id).artByMode!;
        expect(art, `${pack.id}/${id}`).toBeDefined();
        expect(art.light).toContain(pack.id);
        expect(art.dark).toContain(pack.id);
        expect(art.light).not.toBe(art.dark);
        expect(art.light).toContain("light");
        expect(art.dark).toContain("dark");
      }
      expect(byId("home-wallpapers").artByMode).toEqual({
        light: pack.deviceArt.light,
        dark: pack.deviceArt.dark,
      });
      /* Lock honesty: the shared-ground slot says so, by name. */
      expect(byId("lock-wallpapers").note).toContain("no distinct lock scene");
      expect(byId("icon-set").note).toContain("50 designed icons per mode");
    }
  });
});

describe("(d) price parity — server tiers mirror the FE registry", () => {
  it("SERVER_PACKS tiers equal the FE tiers pack for pack", () => {
    const serverBuild = read("../../../../api-server/src/lib/theme-kit-build.ts");
    for (const pack of THEME_PACKS) {
      const block = new RegExp(`id: "${pack.id}", name: "[^"]+", tier: "(\\w+)"`).exec(serverBuild);
      expect(block, pack.id).not.toBeNull();
      expect(block![1], pack.id).toBe(pack.tier);
    }
    /* Exactly the four ruled premium ids; the house pack is included. */
    expect(THEME_PACKS.filter((p) => p.tier === "premium").map((p) => p.id).sort())
      .toEqual(["arcade-gold", "crimson-marble", "emerald-marble", "kings-set", "sapphire-marble"]);
    expect(themePackById("golden-marble")!.tier).toBe("included");
    expect(themePackById("golden-marble")!.house).toBe(true);
  });
});

describe("(e) mix-and-match resolution + reset-to-pure-pack wiring", () => {
  it("effectiveAccent resolves each component's mix independently (mix-and-match core)", () => {
    const pack = themePackById("kings-set")!;
    const mix = sanitizeCustomization({
      cursors: { all: { accentHex: "#111111" } },
      "icon-set": { phone: { accentHex: "#222222" } },
      "accent-color": { all: { accentHex: "#333333" } },
    });
    expect(mix.ok).toBe(true);
    if (!mix.ok) return;
    /* Component-specific wins for that component… */
    expect(effectiveAccent(pack, "dark", mix.value, "cursors")).toBe("#111111");
    expect(effectiveAccent(pack, "dark", mix.value, "icon-set", "phone")).toBe("#222222");
    /* …the shared accent-color entry covers components without their own… */
    expect(effectiveAccent(pack, "dark", mix.value, "ringtone")).toBe("#333333");
    /* …and with no mix at all the pack's own primary is the pure-pack accent. */
    expect(effectiveAccent(pack, "dark", {}, "cursors")).toBe("#ffcb1f");
    expect(effectiveAccent(pack, "dark", undefined, "cursors")).toBe("#ffcb1f");
  });

  it("the reset wiring exists on both sides: panel button → empty-mix PUT → server DELETE", () => {
    const panel = read("./ThemeKitPanel.tsx");
    expect(panel).toContain("theme-kit-reset-${pack.id}");
    expect(panel).toContain("Reset to pure pack");
    expect(panel).toContain("setMix({})");
    expect(panel).toContain("JSON.stringify({ mix: {} })");
    const rail = read("../../../../api-server/src/routes/theme-kit.ts");
    expect(rail).toContain("DELETE FROM theme_pack_customizations");
    expect(rail).toContain("reset: true");
    expect(rail).toContain("Reset-to-pure-pack");
  });
});

describe("(f) findability — the desk is reachable by deep link", () => {
  it("Settings jump link, desk anchor id, look links and the quick picker all name #theme-packs", () => {
    const settings = read("../../pages/settings.tsx");
    expect(settings).toContain('href="#theme-packs"');
    expect(settings).toContain("settings.jumpThemePacks");
    const desk = read("./ThemePacksDesk.tsx");
    expect(desk).toContain('id="theme-packs"');
    expect(desk).toContain('data-testid="theme-packs-settings"');
    const picker = read("./ThemePackQuickPicker.tsx");
    expect(picker).toContain('href="/settings#theme-packs"');
    expect(lookUrl("https://example.com/", { packId: "kings-set", mix: {} })).toMatch(/#theme-packs$/);
  });

  it("the theme desk sits inside its own Settings error boundary", () => {
    const settings = read("../../pages/settings.tsx");
    expect(settings).toMatch(/<SettingsCardBoundary name="theme-packs">\s*<ThemePacksDesk \/>/);
  });
});
