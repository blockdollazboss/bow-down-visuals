/**
 * theme-kit.test.ts — Stack-200 UPGRADES #39 (whole-device theme kits),
 * QC-200 G3 update (designed-art kits).
 *
 * Pins:
 *  1. The 12-component manifest: EVERY pack × ALL 12 components ×
 *     light+dark, branded by default with the whole-logo paths, the
 *     pack app icon per mode, and per-mode art declarations (a
 *     both-modes claim never names only one mode's art).
 *  2. Designed icons: exactly the approved 50 names; every pack ×
 *     icon × mode file EXISTS on disk and its sha256 matches
 *     kit-assets-manifest.json (kit-vs-manifest evidence); the old
 *     code-drawn SVG glyph set is gone from the module.
 *  3. Sound sync: components resolve BY ROLE to the site sound
 *     library paths — one source, no per-pack sound files anywhere.
 *  4. Customization: the sanitizer accepts every component × device
 *     and rejects unknown components, unapproved art, bad accents.
 *  5. GET THIS LOOK: encode/decode round-trips the exact mix; a bad
 *     code decodes to null; premium price-respected flag is data the
 *     desk/rail share (server manifest pin below).
 *  6. Builders: share card carries the pack subject art + the WHOLE
 *     logo path + Cinzel/Manrope pairing; Chrome manifest colors come
 *     from the pack; the Windows theme text points sounds at the
 *     library manifest names.
 *  7. Server mirror: the API kit builder knows the same five packs,
 *     the same sound roles, the same designed icon names, and
 *     contains no per-pack wav data.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_PACKS, themePackById } from "@/lib/theme-packs";
import {
  APPROVED_ART_SOURCES,
  COMPONENT_SOUND_ROLES,
  DESIGNED_ICON_NAMES,
  KIT_COMPONENTS,
  KIT_WALLPAPER_DEVICES,
  LOGO_BY_MODE,
  allKitManifests,
  buildChromeThemeManifest,
  buildShareCardSvg,
  buildWindowsThemeText,
  decodeLook,
  designedAppIconPath,
  designedIconPath,
  deviceWallpaperPath,
  encodeLook,
  kitManifest,
  renderWidgetSvg,
  sanitizeCustomization,
  soundLibraryPath,
  soundManifestAssetForRole,
} from "@/lib/theme-kit";

const PUBLIC_DIR = new URL("../../public/", import.meta.url);
const publicFile = (sitePath: string): URL => new URL(sitePath.replace(/^\//, ""), PUBLIC_DIR);
const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

describe("kit manifest — 12 components × every pack × light+dark", () => {
  it("covers all five packs with all twelve components in both modes", () => {
    const manifests = allKitManifests();
    expect(manifests.map((m) => m.packId)).toEqual(THEME_PACKS.map((p) => p.id));
    for (const m of manifests) {
      expect(m.components, m.packId).toHaveLength(12);
      expect(m.components.map((c) => c.component)).toEqual(KIT_COMPONENTS.map((c) => c.id));
      for (const c of m.components) expect(c.modes).toEqual(["light", "dark"]);
      expect(m.brandedByDefault).toBe(true);
      expect(m.logo).toEqual({ dark: "/logo-static.webp", light: "/logo-light.webp" });
    }
  });

  it("wallpaper components declare BOTH modes' approved grounds (never dark-only)", () => {
    for (const pack of THEME_PACKS) {
      const m = kitManifest(pack);
      for (const id of ["home-wallpapers", "lock-wallpapers"] as const) {
        const c = m.components.find((x) => x.component === id)!;
        expect(c.artByMode, `${pack.id}/${id}`).toEqual({
          light: pack.deviceArt.light,
          dark: pack.deviceArt.dark,
        });
      }
      // Lock honesty: the shared-ground slot says so, by name.
      const lock = m.components.find((x) => x.component === "lock-wallpapers")!;
      expect(lock.note).toContain("no distinct lock scene");
      // The logo itself stays per-mode at the manifest level.
      expect(m.logo).toEqual(LOGO_BY_MODE);
    }
  });

  it("every pack declares its app icon per mode — the real logo lockup composites", () => {
    for (const pack of THEME_PACKS) {
      const m = kitManifest(pack);
      expect(m.appIcon).toEqual({
        light: `/theme-packs/app-icons/${pack.id}-light.webp`,
        dark: `/theme-packs/app-icons/${pack.id}-dark.webp`,
      });
      expect(designedAppIconPath(pack.id, "light")).toBe(m.appIcon.light);
      expect(designedAppIconPath(pack.id, "dark")).toBe(m.appIcon.dark);
    }
  });

  it("icon-set + folder components point at the designed files, per mode", () => {
    for (const pack of THEME_PACKS) {
      const m = kitManifest(pack);
      const icons = m.components.find((x) => x.component === "icon-set")!;
      expect(icons.artByMode?.light).toBe(designedIconPath(pack.id, DESIGNED_ICON_NAMES[0]!, "light"));
      expect(icons.artByMode?.dark).toBe(designedIconPath(pack.id, DESIGNED_ICON_NAMES[0]!, "dark"));
      const folders = m.components.find((x) => x.component === "folder-icons")!;
      expect(folders.artByMode).toEqual({
        light: designedIconPath(pack.id, "files", "light"),
        dark: designedIconPath(pack.id, "files", "dark"),
      });
    }
  });

  it("approved art sources are the existing library pieces only", () => {
    for (const a of APPROVED_ART_SOURCES) {
      if ("path" in a && a.path) expect(a.path).toMatch(/^\/wallpapers\/kings-set-/);
    }
  });
});

describe("designed icon set — the approved art, on disk, per pack × mode", () => {
  it("has exactly the approved 50 icon names", () => {
    expect(DESIGNED_ICON_NAMES).toHaveLength(50);
    expect(new Set(DESIGNED_ICON_NAMES).size).toBe(50);
    expect(DESIGNED_ICON_NAMES).toContain("phone");
    expect(DESIGNED_ICON_NAMES).toContain("video-call");
    // The old kit-only semantic names are NOT the designed set.
    expect(DESIGNED_ICON_NAMES).not.toContain("store");
    expect(DESIGNED_ICON_NAMES).not.toContain("crown");
  });

  it("kit-vs-manifest: all 500 designed files + 10 app icons exist with the pinned hashes", () => {
    const assets = JSON.parse(
      readFileSync(publicFile("/theme-packs/kit-assets-manifest.json"), "utf8"),
    ) as {
      icons: Array<{ pack: string; icon: string; mode: string; path: string; sourceAsset: string; sha256: string }>;
      deviceWallpapers: Array<{ pack: string; mode: string; device: string; width: number; height: number; path: string; sha256: string }>;
    };
    // 500 icons + 10 app icons ride the same entries list.
    expect(assets.icons).toHaveLength(510);
    const seen = new Set<string>();
    for (const e of assets.icons) {
      seen.add(`${e.pack}|${e.icon}|${e.mode}`);
      const url = publicFile(e.path);
      expect(existsSync(url), e.path).toBe(true);
      expect(sha256(readFileSync(url)), e.path).toBe(e.sha256);
      expect(e.sourceAsset, e.path).toMatch(/\.webp$/);
    }
    for (const pack of THEME_PACKS) {
      for (const mode of ["light", "dark"] as const) {
        expect(seen.has(`${pack.id}|app-icon|${mode}`), `${pack.id} app ${mode}`).toBe(true);
        for (const icon of DESIGNED_ICON_NAMES) {
          expect(seen.has(`${pack.id}|${icon}|${mode}`), `${pack.id}/${icon}/${mode}`).toBe(true);
          expect(designedIconPath(pack.id, icon, mode)).toBe(`/theme-packs/icons/${pack.id}/${icon}-${mode}.webp`);
        }
      }
    }
    // Per-device wallpapers: every pack × mode × device, pinned sizes.
    expect(assets.deviceWallpapers).toHaveLength(30);
    for (const w of assets.deviceWallpapers) {
      const url = publicFile(w.path);
      expect(existsSync(url), w.path).toBe(true);
      expect(sha256(readFileSync(url)), w.path).toBe(w.sha256);
      const size = KIT_WALLPAPER_DEVICES.find((d) => d.id === w.device)!;
      expect([w.width, w.height]).toEqual([size.width, size.height]);
      expect(deviceWallpaperPath(w.pack, w.mode as "light" | "dark", w.device as never)).toBe(w.path);
    }
  });

  it("the same icon is a DIFFERENT designed file in every pack (no shared set)", () => {
    const assets = JSON.parse(
      readFileSync(publicFile("/theme-packs/kit-assets-manifest.json"), "utf8"),
    ) as { icons: Array<{ pack: string; icon: string; mode: string; sha256: string }> };
    for (const icon of DESIGNED_ICON_NAMES) {
      for (const mode of ["light", "dark"] as const) {
        const hashes = THEME_PACKS.map(
          (p) => assets.icons.find((e) => e.pack === p.id && e.icon === icon && e.mode === mode)!.sha256,
        );
        expect(new Set(hashes).size, `${icon}/${mode}`).toBe(THEME_PACKS.length);
      }
    }
  });

  it("no code-drawn glyph renderer survives in the kit module", () => {
    const src = readFileSync(new URL("./theme-kit.ts", import.meta.url), "utf8");
    expect(src).not.toContain("renderIconSvg");
    expect(src).not.toContain("ICON_MARKS");
    expect(src).not.toContain("renderFolderIconSvg");
  });

  it("widget art still renders per pack × mode", () => {
    for (const pack of THEME_PACKS) {
      for (const mode of ["light", "dark"] as const) {
        expect(renderWidgetSvg(pack, mode)).toContain(`data-widget="${pack.id}-${mode}"`);
        expect(renderWidgetSvg(pack, mode)).toContain("Cinzel");
      }
    }
  });
});

describe("sound sync — the library is the single source, by role", () => {
  it("ringtone/notification/scheme components map to library roles", () => {
    expect(COMPONENT_SOUND_ROLES["ringtone"]).toEqual(["ringtone"]);
    expect(COMPONENT_SOUND_ROLES["notification-sounds"]).toEqual(["notification", "message"]);
    expect(COMPONENT_SOUND_ROLES["sound-scheme"]).toHaveLength(6);
    for (const roles of Object.values(COMPONENT_SOUND_ROLES)) {
      for (const role of roles) {
        // The path IS the signature manifest's asset for the role —
        // asserted without spelling a sound filename here (the
        // signature lane's guard keeps filenames manifest-only).
        expect(soundLibraryPath(role)).toBe(soundManifestAssetForRole(role));
        expect(soundLibraryPath(role)).toMatch(/^\/sounds\/.+\.wav$/);
      }
    }
  });

  it("the kit module contains NO per-pack sound file data", () => {
    const src = readFileSync(new URL("./theme-kit.ts", import.meta.url), "utf8");
    // Sounds are referenced only through the library role manifest.
    expect(src).not.toMatch(/kings-set.*\.wav|arcade.*\.wav|shark.*\.wav/);
    expect(src).toContain("SOUND_LIBRARY_ROLES");
  });
});

describe("customization sanitizer — every component, per device", () => {
  it("accepts a full 12-component mix across devices", () => {
    const mix: Record<string, unknown> = {};
    for (const c of KIT_COMPONENTS) {
      mix[c.id] = {
        all: { artSourceId: "pack-ground", branded: true },
        phone: { accentHex: "#A1B2C3" },
        desktop: { cursorId: "crown", extraSoundRole: "royal-sting" },
      };
    }
    const r = sanitizeCustomization(mix);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value)).toHaveLength(12);
      expect(r.value["accent-color"]?.phone?.accentHex).toBe("#a1b2c3");
    }
  });

  it("rejects unknown components, unapproved art, and bad accents", () => {
    expect(sanitizeCustomization({ nope: { all: {} } }).ok).toBe(false);
    expect(sanitizeCustomization({ cursors: { all: { artSourceId: "invented-art" } } }).ok).toBe(false);
    expect(sanitizeCustomization({ cursors: { all: { accentHex: "gold" } } }).ok).toBe(false);
    expect(sanitizeCustomization({ cursors: { watch: {} } }).ok).toBe(false);
    // Sound customization is additive only: roles must be library roles.
    expect(sanitizeCustomization({ ringtone: { all: { extraSoundRole: "some-upload" } } }).ok).toBe(false);
  });
});

describe("GET THIS LOOK links", () => {
  it("round-trips pack + exact mix", () => {
    const payload = {
      packId: "kings-set",
      mix: { "accent-color": { all: { accentHex: "#123456" } }, cursors: { desktop: { cursorId: "crown" } } },
    };
    const back = decodeLook(encodeLook(payload));
    expect(back?.packId).toBe("kings-set");
    expect(back?.mix).toEqual(payload.mix);
  });

  it("rejects garbage and unknown packs", () => {
    expect(decodeLook("not-a-look")).toBeNull();
    expect(decodeLook(encodeLook({ packId: "nope", mix: {} }))).toBeNull();
  });
});

describe("builders — share card, chrome theme, windows theme", () => {
  it("share card is subject-led with the WHOLE logo and the house pairing", () => {
    for (const pack of THEME_PACKS) {
      for (const mode of ["light", "dark"] as const) {
        const svg = buildShareCardSvg(pack, mode);
        expect(svg).toContain(pack.deviceArt[mode]);
        expect(svg).toContain(LOGO_BY_MODE[mode]);
        expect(svg).toContain(pack.name);
        expect(svg).toContain("Cinzel");
        expect(svg).toContain("Manrope");
        // Logo is placed whole (meet), never cropped (slice is the art's).
        expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
      }
    }
  });

  it("chrome manifest colors come from the pack variant", () => {
    const pack = themePackById("kings-set")!;
    const manifest = buildChromeThemeManifest(pack, "dark") as { theme: { colors: { frame: number[] } }; name: string };
    expect(manifest.name).toContain("King's Set");
    expect(manifest.theme.colors.frame).toHaveLength(3);
  });

  it("windows theme text points sounds at library manifest names + cursors + accent", () => {
    const pack = themePackById("arcade-gold")!;
    const text = buildWindowsThemeText(pack, "light");
    expect(text).toContain("signature-notification.wav");
    expect(text).toContain("signature-royal-sting.wav");
    expect(text).toContain("arrow.cur");
    expect(text).toContain("ColorizationColor=");
    expect(text).toContain("wallpaper.webp");
  });
});

describe("server mirror parity", () => {
  const serverBuild = readFileSync(
    new URL("../../../api-server/src/lib/theme-kit-build.ts", import.meta.url),
    "utf8",
  );
  const serverRail = readFileSync(
    new URL("../../../api-server/src/routes/theme-kit.ts", import.meta.url),
    "utf8",
  );

  it("knows the same five packs and the same six library roles", () => {
    for (const p of THEME_PACKS) expect(serverBuild).toContain(`id: "${p.id}"`);
    for (const role of ["notification", "message", "success", "error", "royal-sting", "ringtone"]) {
      expect(serverBuild).toContain(`"${role}"`);
    }
  });

  it("server ships the SAME designed icon names from the library — no client-supplied icons", () => {
    for (const name of DESIGNED_ICON_NAMES) expect(serverBuild).toContain(`"${name}"`);
    expect(serverBuild).toContain("/theme-packs/icons/");
    expect(serverBuild).toContain("/theme-packs/app-icons/");
    expect(serverBuild).toContain("/wallpapers/theme-packs/devices/");
    expect(serverBuild).not.toContain("iconSvgs");
  });

  it("never forks per-pack wavs — sounds resolve via the library path helper", () => {
    expect(serverBuild).toContain("soundLibrarySitePath");
    expect(serverBuild).not.toMatch(/\$\{pack\.id\}.*\.wav/);
    expect(serverRail).toContain("PLATFORM_FEE_BPS");
    expect(serverRail).toContain("feeSplit");
  });

  it("the rail keeps the ruled price import — no second price constant", () => {
    expect(serverRail).toContain("THEME_PACK_PRICE_VB");
    expect(serverRail).not.toMatch(/= 1000\b/);
  });
});
