/* ─── Theme Kits — the whole-device package (Stack-200 UPGRADES #39) ──
   A theme pack is a WHOLE-DEVICE kit: 12 components, every pack, light
   AND dark, one ruled price (lib/theme-packs.ts THEME_PACK_PRICE_VB —
   untouched by this module). This file is the kit manifest + the pure
   builders the desk and the server kit rail both read:

   SOUND SYNC LAW (owner ruling, Oct 25 17:39 EDT): a pack's ringtone /
   notification / sound-scheme components ARE the approved V7 house
   signature set, BY ROLE, drawn from the SITE SOUND LIBRARY — the
   single source of truth (public/sounds/ under the role-manifest
   names; the signature lane's set swap is files-only). Packs NEVER
   fork wav copies: bundles reference the library files by role, and
   applying a pack applies those sounds. A future set swap updates
   every pack automatically by construction. Per-pack sound variants
   are ADDITIONS on top of the house set, never replacements.

   ART SOURCING LAW: every image in the kit is owner-approved art —
   backgrounds + living wallpapers + screensavers from the EXISTING
   approved library (the King's Set stills/loops in
   public/wallpapers/, each pack's approved ground in
   public/wallpapers/theme-packs/ plus its per-device renders), and
   the icon set is the DESIGNED emblem program from the theme-pack
   art manifest (500 designed files, per pack, per mode — see the
   designed-icon section below). No code-drawn substitute art ships
   in a kit. Wallpapers are CLEAN scenes/grounds: no logo is baked
   or composited onto them; the whole logo (logo-static.webp /
   logo-light.webp) ships as its own file, and the pack app icon is
   that real lockup composited whole onto the pack tile. */

import {
  THEME_PACKS,
  hslToHex,
  themePackById,
  type ThemePack,
  type ThemePackMode,
} from "@/lib/theme-packs";
import { SIGNATURE_SOUND_ASSETS } from "./signature-sound-manifest";
import {
  signatureSounds,
  type SoundKind,
  type SoundPrefs,
} from "./signature-sounds";

/* ─── The 12 components ─────────────────────────────────────────────── */

export const KIT_COMPONENTS = [
  { id: "home-wallpapers", label: "Home wallpapers", devices: ["phone", "tablet", "desktop"] },
  { id: "lock-wallpapers", label: "Lock wallpapers", devices: ["phone", "tablet", "desktop"] },
  { id: "icon-set", label: "Home-screen icon set (top 50)", devices: ["phone", "tablet"] },
  { id: "folder-icons", label: "Computer folder icons", devices: ["desktop"] },
  { id: "cursors", label: "Cursor set", devices: ["desktop", "site"] },
  { id: "ringtone", label: "Ringtone", devices: ["phone"] },
  { id: "notification-sounds", label: "Notification sounds", devices: ["phone", "site"] },
  { id: "sound-scheme", label: "Sound scheme", devices: ["phone", "desktop", "site"] },
  { id: "browser-theme", label: "Browser theme (Chrome)", devices: ["desktop"] },
  { id: "widget-art", label: "Widget art", devices: ["phone", "tablet", "desktop"] },
  { id: "accent-color", label: "Accent color", devices: ["phone", "tablet", "desktop", "site"] },
  { id: "site-reskin", label: "App / site reskin", devices: ["site"] },
] as const;

export type KitComponentId = (typeof KIT_COMPONENTS)[number]["id"];
export const KIT_COMPONENT_IDS: readonly string[] = KIT_COMPONENTS.map((c) => c.id);
export const KIT_DEVICES = ["all", "phone", "tablet", "desktop"] as const;
export type KitDevice = (typeof KIT_DEVICES)[number];

/* ─── Sound library sync (single source of truth, by role) ──────────── */

/** The site sound library's role manifest — the SAME files the site
    plays. The signature lane owns the files under public/sounds/;
    swapping the set (v7 today) is a files-only swap there and every
    pack follows automatically. No pack ever carries its own copy. */
export const SOUND_LIBRARY_ROLES = [
  "notification",
  "message",
  "success",
  "error",
  "royal-sting",
  "ringtone",
] as const;
export type SoundRole = (typeof SOUND_LIBRARY_ROLES)[number];

/** Library path for a role — the one reference every pack uses.
    Resolved THROUGH the signature-sound-manifest (the single source
    of truth for sound filenames): this module never spells a sound
    filename itself, so a set swap stays a files-only change in the
    manifest — the signature lane's guard (join #7) requires exactly
    that, and the role→kind map lives in the binding section below. */
export function soundLibraryPath(role: SoundRole): string {
  return SIGNATURE_SOUND_ASSETS[SOUND_ROLE_ENGINE_KIND[role]];
}

/** Which library roles each sound component plays. Ringtone and
    notification components are the house set BY ROLE (owner ruling);
    the sound scheme is the full six-role set. */
export const COMPONENT_SOUND_ROLES: Record<string, SoundRole[]> = {
  ringtone: ["ringtone"],
  "notification-sounds": ["notification", "message"],
  "sound-scheme": [...SOUND_LIBRARY_ROLES],
};

/* ─── Sound-pref binding (Stack-200 join #12 — the seam this lane left) ──
   On this lane's base, the signature lane's per-account sound_prefs
   (migration 0242, GET/PATCH /api/sound-prefs) did not exist yet, so
   pack-apply could only stamp the local seam (localStorage
   "bdv-sound-set" + the "bdv-pack-sounds-applied" event). With both
   lanes joined, the binding lands here: applying an ENTITLED pack
   writes the pack's sound roles into the account's sound_prefs.

   sound_prefs stores SWITCHES, not a set identity, so the stamp is:
   master on + the switch governing each of the pack's sound-scheme
   roles on — the v7 house set, BY ROLE, becomes the account's active
   sound choice. Roles resolve through the signature-sound-manifest
   (the single source of truth the engine plays from); no per-pack
   sound files or forks exist. The prefs the server returns are pushed
   into the live engine so playback follows the stamp immediately.

   An UNENTITLED pack gets NO stamp at all — not even the local seam.
   A signed-out apply keeps the local seam only (house/included packs
   are free for guests); the account stamp lands on the first signed-in
   apply. Fire-and-forget safe: a failed stamp never breaks an apply. */

/** Pack sound role → the engine kind that plays it. The manifest's
    "sting" kind is the scheme's "royal-sting" role — the same file,
    proven by the stamp tests against SIGNATURE_SOUND_ASSETS. */
export const SOUND_ROLE_ENGINE_KIND: Record<SoundRole, SoundKind> = {
  notification: "notification",
  message: "message",
  success: "success",
  error: "error",
  "royal-sting": "sting",
  ringtone: "ringtone",
};

/** Pack sound role → the sound_prefs switch that governs it. The
    success_stings switch governs BOTH success and the royal sting,
    per the owner's Settings control spec (migration 0242). */
export const SOUND_ROLE_PREF_SWITCH: Record<SoundRole, keyof SoundPrefs> = {
  notification: "notifications_enabled",
  message: "messages_enabled",
  success: "success_stings_enabled",
  error: "errors_enabled",
  "royal-sting": "success_stings_enabled",
  ringtone: "ringtone_enabled",
};

/** The PATCH body a pack apply stamps: master on, plus the governing
    switch of every role in the pack's sound scheme on. Built FROM the
    role map — never a hand-kept literal list — so a role change in the
    scheme moves the stamp with it. Every pack carries the same house
    set by law, so the stamp is pack-independent by construction. */
export function soundPrefsPatchForPackSounds(): Partial<SoundPrefs> {
  const patch: Partial<SoundPrefs> = { master_enabled: true };
  for (const role of COMPONENT_SOUND_ROLES["sound-scheme"] ?? []) {
    patch[SOUND_ROLE_PREF_SWITCH[role]] = true;
  }
  return patch;
}

export const SOUND_SET_STAMP_KEY = "bdv-sound-set";
export const SOUND_SET_STAMP_VALUE = "library:signature-house";
export const PACK_SOUNDS_APPLIED_EVENT = "bdv-pack-sounds-applied";

export interface SoundPrefsFetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type SoundPrefsFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<SoundPrefsFetchResponse>;

export interface PackSoundStampDeps {
  /** Entitlement is the gate: false → no stamp of any kind. Both apply
      surfaces (desk Apply, toggle quick-picker) already gate on it;
      the stamper re-checks so no future caller can stamp a locked pack. */
  unlocked: boolean;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: SoundPrefsFetch;
  storageSet?: (key: string, value: string) => void;
  dispatchApplied?: (packId: string) => void;
}

export interface PackSoundStampResult {
  localStamped: boolean;
  accountStamped: boolean;
}

function defaultStorageSet(key: string, value: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
}

function defaultDispatchApplied(packId: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PACK_SOUNDS_APPLIED_EVENT, { detail: { packId } }),
    );
  }
}

function defaultFetchImpl(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
): Promise<SoundPrefsFetchResponse> {
  return fetch(url, init);
}

/** Stamp a pack apply into the sound system: the local seam (the
    active-set choice + the applied event) AND, for a signed-in member,
    the pack's sound roles into their per-account sound_prefs via
    PATCH /api/sound-prefs, with the saved prefs pushed into the live
    engine. Returns what actually landed; never throws. */
export async function stampPackSoundsForApply(
  packId: string,
  deps: PackSoundStampDeps,
): Promise<PackSoundStampResult> {
  if (!deps.unlocked) return { localStamped: false, accountStamped: false };
  let localStamped = false;
  try {
    (deps.storageSet ?? defaultStorageSet)(SOUND_SET_STAMP_KEY, SOUND_SET_STAMP_VALUE);
    (deps.dispatchApplied ?? defaultDispatchApplied)(packId);
    localStamped = true;
  } catch {
    /* private mode / no DOM — the account stamp still runs */
  }
  let accountStamped = false;
  try {
    const token = await deps.getAccessToken().catch(() => null);
    if (token) {
      const doFetch = deps.fetchImpl ?? defaultFetchImpl;
      const res = await doFetch("/api/sound-prefs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(soundPrefsPatchForPackSounds()),
      });
      if (res.ok) {
        accountStamped = true;
        const saved = (await res.json().catch(() => null)) as
          | Partial<SoundPrefs>
          | null;
        if (saved) {
          signatureSounds.setPrefs({
            master_enabled: saved.master_enabled ?? true,
            notifications_enabled: saved.notifications_enabled ?? true,
            messages_enabled: saved.messages_enabled ?? true,
            success_stings_enabled: saved.success_stings_enabled ?? true,
            errors_enabled: saved.errors_enabled ?? true,
            ringtone_enabled: saved.ringtone_enabled ?? true,
          });
        }
      }
    }
  } catch {
    /* sounds never break an apply — the local seam already landed */
  }
  return { localStamped, accountStamped };
}

/** The manifest asset a pack sound role plays — through the manifest,
    never a pack-local path. (soundLibraryPath above stays the bundle
    reference; this is the engine-truth cross-check the tests pin.) */
export function soundManifestAssetForRole(role: SoundRole): string {
  return SIGNATURE_SOUND_ASSETS[SOUND_ROLE_ENGINE_KIND[role]];
}

/* ─── Approved background library (existing art — never invented) ───── */

export interface ApprovedArtSource {
  id: string;
  label: string;
  kind: "still" | "loop";
  /** Site path of the library file. "pack-ground" has none — it IS
      the ground of whichever pack the mix belongs to, resolved at
      build time. */
  path?: string;
}

/** The cross-pack source id for one pack's approved ground art in one
    mode: `pack-ground-<packId>-<mode>`. */
export function packGroundArtSourceId(packId: string, mode: ThemePackMode): string {
  return `pack-ground-${packId}-${mode}`;
}

/* One named source per pack × mode, DERIVED from the registry: every
   pack's approved ground art is offerable by name, so a mix on any
   pack can wear any pack's ground. (QC fix #13: the source list used
   to be a hand-kept constant whose only scene entries were the
   King's Set stills/loops — every other pack's art was reachable
   only through the relative "pack-ground" entry on its own card, so
   Shark Tank / Golden Hour grounds never appeared as cross-pack
   sources even though the packs apply fine. Deriving from
   THEME_PACKS means a future pack's grounds join the list by
   construction; the server mirrors are pinned to this list by the
   parity tests.) */
const PACK_GROUND_ART_SOURCES: ApprovedArtSource[] = THEME_PACKS.flatMap((pack) =>
  (["dark", "light"] as ThemePackMode[]).map((mode) => ({
    id: packGroundArtSourceId(pack.id, mode),
    label: `${pack.name} — Ground art (${mode})`,
    kind: "still" as const,
    path: pack.deviceArt[mode],
  })),
);

/** Owner-approved stills + living loops already live in the wallpaper
    desk. Customization swaps choose from THIS list only. */
export const APPROVED_ART_SOURCES: ApprovedArtSource[] = [
  { id: "pack-ground", label: "This pack's ground art", kind: "still" },
  ...PACK_GROUND_ART_SOURCES,
  { id: "kings-set-throne-phone", label: "King's Set — Throne (phone)", kind: "still", path: "/wallpapers/kings-set-throne-phone.webp" },
  { id: "kings-set-plaza-phone", label: "King's Set — Plaza (phone)", kind: "still", path: "/wallpapers/kings-set-plaza-phone.webp" },
  { id: "kings-set-stage-desktop", label: "King's Set — Stage (desktop)", kind: "still", path: "/wallpapers/kings-set-stage-desktop.webp" },
  { id: "kings-set-throne-loop", label: "King's Set — Throne living loop", kind: "loop", path: "/wallpapers/kings-set-throne-loop.mp4" },
  { id: "kings-set-plaza-loop", label: "King's Set — Plaza living loop", kind: "loop", path: "/wallpapers/kings-set-plaza-loop.mp4" },
  { id: "kings-set-stage-loop", label: "King's Set — Stage screensaver loop", kind: "loop", path: "/wallpapers/kings-set-stage-loop.mp4" },
];
export const APPROVED_ART_IDS: readonly string[] = APPROVED_ART_SOURCES.map((a) => a.id);

/** Screensaver + living-wallpaper sources per pack: the approved
    living loops (King's Set) — the same loops for every pack because
    they are the approved library; each pack's own ground still is its
    static screensaver frame, and every pack's grounds are offerable
    by name as mix sources (PACK_GROUND_ART_SOURCES above). */

/* ─── Designed icon set (the approved art — never code-drawn) ────────
   QC-200 G3: the kit ships the owner-approved DESIGNED emblem set
   from the theme-pack art manifest (Oct 25 2026): 5 packs × 50 icons
   × light+dark = 500 files, generated per pack in its own character
   (gold-foil emblem, regal gold, amber glow, teal-and-gold ocean,
   8-bit arcade). The files live under public/theme-packs/icons/ as
   scale-only 512×512 renders of the masters; provenance + hashes
   are pinned in public/theme-packs/kit-assets-manifest.json. The
   old code-drawn SVG glyph set (one shared semantic mark in
   per-pack frames) is GONE — downloads and previews alike use the
   designed files. Mirror of the server DESIGNED_ICON_NAMES. */

export const DESIGNED_ICON_NAMES = [
  "phone", "messages", "camera", "photos", "music", "video", "browser", "mail",
  "shop", "maps", "settings", "clock", "calendar", "weather", "notes",
  "calculator", "wallet", "health", "social", "files",
  "contacts", "voice-recorder", "compass", "flashlight", "reminders",
  "timer", "podcasts", "books", "news", "workout", "games", "tv", "radio",
  "translator", "scanner", "passwords", "cloud", "bank", "food", "rides",
  "flights", "tickets", "events", "smart-home", "security", "search",
  "stocks", "learn", "vpn", "video-call",
] as const;
export type DesignedIconName = (typeof DESIGNED_ICON_NAMES)[number];

/** Packs whose designed emblem set has actually been RAISED into the
    asset library — all 50 icons × light+dark on disk, hashes pinned
    in kit-assets-manifest.json. Every other pack's set is
    owner-approved art-program work that has not landed yet
    (crimson-marble, sapphire-marble, emerald-marble): its icon-set + folder-icons
    components are marked artPending in the kit manifest, the desk
    says so, and its bundles name the missing files
    (ICONS-MISSING.txt) — never a substitute. Pinned against the
    files on disk by theme-kit.test.ts (kit-vs-manifest). */
export const DESIGNED_ICON_SET_PACK_IDS: readonly string[] = [
  "golden-marble", "shark-tank", "golden-hour", "kings-set", "arcade-gold",
];

export function hasDesignedIconSet(packId: string): boolean {
  return DESIGNED_ICON_SET_PACK_IDS.includes(packId);
}

/** Site path of one designed icon for a pack × mode. */
export function designedIconPath(packId: string, icon: DesignedIconName, mode: ThemePackMode): string {
  return `/theme-packs/icons/${packId}/${icon}-${mode}.webp`;
}

/** The pack's app icon: the REAL full illustrated logo lockup
    composited whole onto the pack tile (from logo-static.webp /
    logo-light.webp) — never cropped, never redrawn. */
export function designedAppIconPath(packId: string, mode: ThemePackMode): string {
  return `/theme-packs/app-icons/${packId}-${mode}.webp`;
}

/** Canonical per-device wallpaper sizes (mirror of the server
    WALLPAPER_DEVICES; from the wallpaper preset list). */
export const KIT_WALLPAPER_DEVICES = [
  { id: "phone", width: 1179, height: 2556 },
  { id: "tablet", width: 1640, height: 2360 },
  { id: "desktop", width: 1920, height: 1080 },
] as const;
export type KitWallpaperDeviceId = (typeof KIT_WALLPAPER_DEVICES)[number]["id"];

/** Site path of the per-device wallpaper render (clean pack ground,
    crop-to-fill — no logo composited). */
export function deviceWallpaperPath(packId: string, mode: ThemePackMode, device: KitWallpaperDeviceId): string {
  return `/wallpapers/theme-packs/devices/${packId}-${mode}-${device}.webp`;
}

/** Widget art (clock + headline widgets) as SVG per pack × mode.
    accentHex overrides the pack accent — the kit panel passes the
    saved mix's widget-art accent (through effectiveAccent). */
export function renderWidgetSvg(pack: ThemePack, mode: ThemePackMode, accentHex?: string): string {
  const v = pack.variants[mode]!;
  const ground = hslToHex(v.tokens.background) ?? "#000000";
  const accent = accentHex ?? hslToHex(v.tokens.primary) ?? "#f9bc06";
  const ink = hslToHex(v.tokens.foreground) ?? "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" data-widget="${pack.id}-${mode}"><rect width="200" height="200" rx="36" fill="${ground}"/><circle cx="100" cy="92" r="52" fill="none" stroke="${accent}" stroke-width="5"/><path d="M100 56v36l24 14" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/><text x="100" y="182" text-anchor="middle" font-family="Cinzel, serif" font-size="17" fill="${accent}">${pack.name}</text></svg>`;
}

/* ─── Kit manifest ──────────────────────────────────────────────────── */

export interface KitComponentManifest {
  component: KitComponentId;
  label: string;
  modes: ThemePackMode[];
  devices: readonly string[];
  soundRoles?: SoundRole[];
  /** The approved art this component ships, PER MODE — a kit that
      claims light+dark declares both, never one mode's art under a
      both-modes claim (the QC-200 G3 honesty fix). */
  artByMode?: Record<ThemePackMode, string>;
  /** True when the component's designed art has NOT been raised yet:
      artByMode names the set's canonical paths, but the files are
      not in the asset library — the component is unavailable until
      the art program lands it, and bundles name the missing files
      instead of shipping substitutes (Stack-300 A4 honesty). */
  artPending?: boolean;
  /** Honest slot note where a component shares art (lock wallpapers
      use the pack ground — no distinct lock scene was approved). */
  note?: string;
}

export interface KitManifest {
  packId: string;
  packName: string;
  tier: ThemePack["tier"];
  brandedByDefault: true;
  logo: Record<ThemePackMode, string>;
  /** The pack's app icon per mode: the real logo lockup, whole. */
  appIcon: Record<ThemePackMode, string>;
  components: KitComponentManifest[];
}

export const LOGO_BY_MODE: Record<ThemePackMode, string> = {
  dark: "/logo-static.webp",
  light: "/logo-light.webp",
};

export function kitManifest(pack: ThemePack): KitManifest {
  const components: KitComponentManifest[] = KIT_COMPONENTS.map((c) => {
    const base: KitComponentManifest = {
      component: c.id as KitComponentId,
      label: c.label,
      modes: ["light", "dark"],
      devices: c.devices,
    };
    if (COMPONENT_SOUND_ROLES[c.id]) base.soundRoles = COMPONENT_SOUND_ROLES[c.id];
    if (c.id === "home-wallpapers") {
      // Clean pack ground per mode + per-device sized renders.
      base.artByMode = { light: pack.deviceArt.light, dark: pack.deviceArt.dark };
    }
    if (c.id === "lock-wallpapers") {
      base.artByMode = { light: pack.deviceArt.light, dark: pack.deviceArt.dark };
      base.note = "Lock uses the pack's approved ground art, sized per device — no distinct lock scene has been approved for this pack.";
    }
    if (c.id === "icon-set") {
      // The designed emblem set: /theme-packs/icons/<pack>/<icon>-<mode>.webp
      base.artByMode = {
        light: designedIconPath(pack.id, DESIGNED_ICON_NAMES[0]!, "light"),
        dark: designedIconPath(pack.id, DESIGNED_ICON_NAMES[0]!, "dark"),
      };
      if (hasDesignedIconSet(pack.id)) {
        base.note = `${DESIGNED_ICON_NAMES.length} designed icons per mode — the approved art-manifest set for this pack.`;
      } else {
        base.artPending = true;
        base.note = `${DESIGNED_ICON_NAMES.length} designed icons per mode — this pack's designed emblem set has not been raised yet: the kit names the missing files (ICONS-MISSING.txt) and ships no substitute art.`;
      }
    }
    if (c.id === "folder-icons") {
      // Folder icons ARE the designed files emblem (DESIGN finals).
      base.artByMode = {
        light: designedIconPath(pack.id, "files", "light"),
        dark: designedIconPath(pack.id, "files", "dark"),
      };
      if (!hasDesignedIconSet(pack.id)) {
        base.artPending = true;
        base.note = "Folder icons are the designed 'files' emblem — not raised yet for this pack: the kit ships none and names it in ICONS-MISSING.txt.";
      }
    }
    return base;
  });
  return {
    packId: pack.id,
    packName: pack.name,
    tier: pack.tier,
    brandedByDefault: true,
    logo: LOGO_BY_MODE,
    appIcon: {
      light: designedAppIconPath(pack.id, "light"),
      dark: designedAppIconPath(pack.id, "dark"),
    },
    components,
  };
}

export function allKitManifests(): KitManifest[] {
  return THEME_PACKS.map(kitManifest);
}

/* ─── Customization (the capstone — every component, per device) ───── */

export interface ComponentCustomization {
  /** Swap the art from the approved library only. */
  artSourceId?: string;
  /** Buyer's own uploaded art URL (their media library). */
  customArtUrl?: string;
  accentHex?: string;
  cursorId?: string;
  /** ADDITIONS on top of the synced house sound set — never a
      replacement for the library roles. */
  extraSoundRole?: SoundRole;
  branded?: boolean;
  note?: string;
}

export type PackCustomization = Partial<
  Record<KitComponentId, Partial<Record<KitDevice, ComponentCustomization>>>
>;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Validate + sanitize a customization patch. Returns {ok, value} or
    {ok:false, error}. This is the ONE validator the desk and the
    server rail both enforce (mirrored server-side). */
export function sanitizeCustomization(
  input: unknown,
): { ok: true; value: PackCustomization } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "mix must be an object" };
  const out: PackCustomization = {};
  for (const [comp, perDevice] of Object.entries(input as Record<string, unknown>)) {
    if (!KIT_COMPONENT_IDS.includes(comp)) return { ok: false, error: `unknown component ${comp}` };
    if (typeof perDevice !== "object" || perDevice === null) return { ok: false, error: `${comp} must be an object` };
    const compOut: Partial<Record<KitDevice, ComponentCustomization>> = {};
    for (const [device, raw] of Object.entries(perDevice as Record<string, unknown>)) {
      if (!(KIT_DEVICES as readonly string[]).includes(device)) return { ok: false, error: `unknown device ${device}` };
      if (typeof raw !== "object" || raw === null) return { ok: false, error: `${comp}/${device} must be an object` };
      const r = raw as Record<string, unknown>;
      const clean: ComponentCustomization = {};
      if (r.artSourceId !== undefined) {
        if (typeof r.artSourceId !== "string" || !APPROVED_ART_IDS.includes(r.artSourceId))
          return { ok: false, error: `artSourceId must come from the approved library` };
        clean.artSourceId = r.artSourceId;
      }
      if (r.customArtUrl !== undefined) {
        if (typeof r.customArtUrl !== "string" || r.customArtUrl.length > 2048)
          return { ok: false, error: `customArtUrl invalid` };
        clean.customArtUrl = r.customArtUrl;
      }
      if (r.accentHex !== undefined) {
        if (typeof r.accentHex !== "string" || !HEX_RE.test(r.accentHex))
          return { ok: false, error: `accentHex must be #rrggbb` };
        clean.accentHex = r.accentHex.toLowerCase();
      }
      if (r.cursorId !== undefined) {
        if (typeof r.cursorId !== "string" || r.cursorId.length > 64) return { ok: false, error: `cursorId invalid` };
        clean.cursorId = r.cursorId;
      }
      if (r.extraSoundRole !== undefined) {
        if (!(SOUND_LIBRARY_ROLES as readonly string[]).includes(r.extraSoundRole as string))
          return { ok: false, error: `extraSoundRole must be a library role` };
        clean.extraSoundRole = r.extraSoundRole as SoundRole;
      }
      if (r.branded !== undefined) {
        if (typeof r.branded !== "boolean") return { ok: false, error: `branded must be boolean` };
        clean.branded = r.branded;
      }
      if (r.note !== undefined) {
        if (typeof r.note !== "string" || r.note.length > 200) return { ok: false, error: `note too long` };
        clean.note = r.note;
      }
      compOut[device as KitDevice] = clean;
    }
    out[comp as KitComponentId] = compOut;
  }
  return { ok: true, value: out };
}

/** The accent a component renders with after customization: the
    component's own accentHex (the requested device key first, then
    the "all devices" key the kit panel writes), then the
    accent-color component's, then the pack's own primary. The kit
    download builders resolve through this — the server bundle
    builder mirrors the same chain (resolveKitAccent). */
export function effectiveAccent(
  pack: ThemePack,
  mode: ThemePackMode,
  mix: PackCustomization | undefined,
  component: KitComponentId,
  device: KitDevice = "all",
): string {
  const devices: KitDevice[] = device === "all" ? ["all"] : [device, "all"];
  for (const comp of [component, "accent-color"] as const) {
    for (const d of devices) {
      const custom = mix?.[comp]?.[d]?.accentHex;
      if (custom) return custom;
    }
  }
  return hslToHex(pack.variants[mode]!.tokens.primary) ?? "#f9bc06";
}

/* ─── GET THIS LOOK — virality deep links ───────────────────────────── */

export interface LookPayload {
  packId: string;
  mix: PackCustomization;
  creatorPackId?: string;
}

/** Stateless look code: base64url(JSON). The link carries the sender's
    pack + exact customization mix; a paid pack's link LANDS on the
    pack wearing the mix as preview — purchase is still required to
    own/apply permanently (price respected by the desk + rail). */
export function encodeLook(payload: LookPayload): string {
  const json = JSON.stringify(payload);
  const b64 = typeof btoa !== "undefined"
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeLook(code: string): LookPayload | null {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob !== "undefined"
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as LookPayload;
    if (typeof parsed.packId !== "string" || !themePackById(parsed.packId)) return null;
    const clean = sanitizeCustomization(parsed.mix ?? {});
    if (!clean.ok) return null;
    return {
      packId: parsed.packId,
      mix: clean.value,
      ...(typeof parsed.creatorPackId === "string" ? { creatorPackId: parsed.creatorPackId } : {}),
    };
  } catch {
    return null;
  }
}

export function lookUrl(origin: string, payload: LookPayload): string {
  return `${origin.replace(/\/$/, "")}/settings?look=${encodeLook(payload)}#theme-packs`;
}

/* ─── Share cards (subject-led, logo whole) ─────────────────────────── */

export function buildShareCardSvg(pack: ThemePack, mode: ThemePackMode, accentHex?: string): string {
  const v = pack.variants[mode]!;
  const ground = hslToHex(v.tokens.background) ?? "#000000";
  const accent = accentHex ?? hslToHex(v.tokens.primary) ?? "#f9bc06";
  const ink = hslToHex(v.tokens.foreground) ?? "#ffffff";
  const logo = LOGO_BY_MODE[mode];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" data-share-card="${pack.id}-${mode}">`,
    `<rect width="1200" height="630" fill="${ground}"/>`,
    `<image href="${pack.deviceArt[mode]}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>`,
    `<rect x="0" y="430" width="1200" height="200" fill="${ground}" opacity="0.88"/>`,
    `<image href="${logo}" x="48" y="452" width="220" height="110" preserveAspectRatio="xMidYMid meet"/>`,
    `<text x="300" y="512" font-family="Cinzel, serif" font-size="54" fill="${ink}">${pack.name}</text>`,
    `<text x="300" y="556" font-family="Manrope, sans-serif" font-size="26" fill="${accent}">Get this look — the whole-device theme kit</text>`,
    `</svg>`,
  ].join("");
}

/* ─── Browser theme + Windows theme text builders ──────────────────── */

export function buildChromeThemeManifest(pack: ThemePack, mode: ThemePackMode, accentHex?: string): Record<string, unknown> {
  const v = pack.variants[mode]!;
  const accent = accentHex ?? hslToHex(v.tokens.primary) ?? "#f9bc06";
  const ground = hslToHex(v.tokens.background) ?? "#000000";
  const ink = hslToHex(v.tokens.foreground) ?? "#ffffff";
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  ];
  return {
    manifest_version: 3,
    name: `Bow Down Visuals — ${pack.name} (${mode})`,
    version: "1.0",
    description: `${pack.name} browser theme from the Bow Down Visuals whole-device theme kit.`,
    theme: {
      colors: {
        frame: rgb(ground),
        toolbar: rgb(ground),
        tab_text: rgb(ink),
        tab_background_text: rgb(ink),
        bookmark_text: rgb(ink),
        ntp_background: rgb(ground),
        ntp_text: rgb(ink),
        button_background: rgb(accent),
      },
      properties: { ntp_background_alignment: "bottom", ntp_background_repeat: "no-repeat" },
    },
  };
}

/** The .theme text inside a Windows .themepack. Sounds reference the
    SITE SOUND LIBRARY roles — the themepack's CAB carries the library
    files under their manifest names (single source; see server rail),
    never per-pack remixes. */
export function buildWindowsThemeText(pack: ThemePack, mode: ThemePackMode, accentHex?: string): string {
  const v = pack.variants[mode]!;
  const accent = (accentHex ?? hslToHex(v.tokens.primary) ?? "#f9bc06").replace("#", "");
  const r = parseInt(accent.slice(0, 2), 16), g = parseInt(accent.slice(2, 4), 16), b = parseInt(accent.slice(4, 6), 16);
  const colorization = (b << 16) | (g << 8) | r;
  return [
    "; Bow Down Visuals whole-device theme kit",
    `[Theme]`,
    `DisplayName=Bow Down Visuals — ${pack.name} (${mode})`,
    ``,
    `[Control Panel\\Desktop]`,
    `Wallpaper=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\wallpaper.webp`,
    `TileWallpaper=0`,
    `WallpaperStyle=10`,
    ``,
    `[VisualStyles]`,
    `ColorStyle=@themeui.dll,-854`,
    `AutoColorization=0`,
    `ColorizationColor=${colorization}`,
    ``,
    `[Sounds]`,
    `; Scheme sounds resolve BY ROLE to the site sound library set`,
    `DefaultValue=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\sounds\\signature-notification.wav`,
    ``,
    `[AppEvents\\Schemes\\Apps\\.Default\\Notification.Default\\.Current]`,
    `DefaultValue=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\sounds\\signature-notification.wav`,
    `[AppEvents\\Schemes\\Apps\\.Default\\SystemAsterisk\\.Current]`,
    `DefaultValue=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\sounds\\signature-royal-sting.wav`,
    ``,
    `[Control Panel\\Cursors]`,
    `DefaultValue=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\cursors\\arrow.cur`,
    `Arrow=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\cursors\\arrow.cur`,
    `Hand=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\cursors\\hand.cur`,
    ``,
  ].join("\r\n");
}
