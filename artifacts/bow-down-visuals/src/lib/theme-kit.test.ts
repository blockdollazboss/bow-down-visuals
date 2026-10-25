/**
 * theme-kit.test.ts — Stack-200 UPGRADES #39 (whole-device theme kits).
 *
 * Pins:
 *  1. The 12-component manifest: EVERY pack × ALL 12 components ×
 *     light+dark, branded by default with the whole-logo paths.
 *  2. Top-50 icons: exactly 50 per pack, rendered SVGs unique within
 *     a pack AND different across packs for the same icon (unique
 *     glyphs per pack character — frame + motif differ, not recolors).
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
 *     the same sound roles, and contains no per-pack wav data.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_PACKS, themePackById } from "@/lib/theme-packs";
import {
  APPROVED_ART_SOURCES,
  COMPONENT_SOUND_ROLES,
  ICON_NAMES,
  KIT_COMPONENTS,
  LOGO_BY_MODE,
  allKitManifests,
  buildChromeThemeManifest,
  buildShareCardSvg,
  buildWindowsThemeText,
  decodeLook,
  encodeLook,
  kitManifest,
  renderFolderIconSvg,
  renderIconSvg,
  renderWidgetSvg,
  sanitizeCustomization,
  soundLibraryPath,
} from "@/lib/theme-kit";

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

  it("wallpaper components source the pack's approved ground + whole logo", () => {
    for (const pack of THEME_PACKS) {
      const m = kitManifest(pack);
      for (const id of ["home-wallpapers", "lock-wallpapers"] as const) {
        const c = m.components.find((x) => x.component === id)!;
        expect(c.artSource).toBe(pack.deviceArt.dark);
        expect(c.logoPath).toBe(LOGO_BY_MODE.dark);
      }
    }
  });

  it("approved art sources are the existing library pieces only", () => {
    for (const a of APPROVED_ART_SOURCES) {
      if ("path" in a && a.path) expect(a.path).toMatch(/^\/wallpapers\/kings-set-/);
    }
  });
});

describe("top-50 icon sets — unique glyphs per pack, light+dark", () => {
  it("has exactly 50 icons", () => {
    expect(ICON_NAMES).toHaveLength(50);
    expect(new Set(ICON_NAMES).size).toBe(50);
  });

  it("renders 50 unique SVGs per pack per mode, and the same icon differs across packs", () => {
    for (const mode of ["light", "dark"] as const) {
      const perPack = new Map<string, string[]>();
      for (const pack of THEME_PACKS) {
        const svgs = ICON_NAMES.map((n) => renderIconSvg(pack, mode, n));
        expect(new Set(svgs).size, `${pack.id}/${mode}`).toBe(50);
        perPack.set(pack.id, svgs);
      }
      for (const name of ICON_NAMES) {
        const across = THEME_PACKS.map((p) => renderIconSvg(p, mode, name));
        expect(new Set(across).size, `${name}/${mode} must differ per pack`).toBe(THEME_PACKS.length);
      }
    }
  });

  it("folder icons and widget art render per pack × mode", () => {
    for (const pack of THEME_PACKS) {
      for (const mode of ["light", "dark"] as const) {
        expect(renderFolderIconSvg(pack, mode)).toContain(`data-folder="${pack.id}-${mode}"`);
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
        expect(soundLibraryPath(role)).toBe(`/sounds/signature-${role}.wav`);
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
