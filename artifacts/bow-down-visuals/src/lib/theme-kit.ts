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

   ART SOURCING LAW: backgrounds + living wallpapers + screensavers
   come from the EXISTING owner-approved library (the King's Set
   stills/loops already live in the wallpaper desk under
   public/wallpapers/, and each pack's approved ground in
   public/wallpapers/theme-packs/). Designed art is ONLY for genuine
   gaps — the icon sets below: unique glyphs per pack (frame + motif +
   semantic mark drawn per pack character), never recolors of one
   shared shape across packs. */

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

/** Owner-approved stills + living loops already live in the wallpaper
    desk. Customization swaps choose from THIS list only. */
export const APPROVED_ART_SOURCES = [
  { id: "pack-ground", label: "This pack's ground art", kind: "still" },
  { id: "kings-set-throne-phone", label: "King's Set — Throne (phone)", kind: "still", path: "/wallpapers/kings-set-throne-phone.webp" },
  { id: "kings-set-plaza-phone", label: "King's Set — Plaza (phone)", kind: "still", path: "/wallpapers/kings-set-plaza-phone.webp" },
  { id: "kings-set-stage-desktop", label: "King's Set — Stage (desktop)", kind: "still", path: "/wallpapers/kings-set-stage-desktop.webp" },
  { id: "kings-set-throne-loop", label: "King's Set — Throne living loop", kind: "loop", path: "/wallpapers/kings-set-throne-loop.mp4" },
  { id: "kings-set-plaza-loop", label: "King's Set — Plaza living loop", kind: "loop", path: "/wallpapers/kings-set-plaza-loop.mp4" },
  { id: "kings-set-stage-loop", label: "King's Set — Stage screensaver loop", kind: "loop", path: "/wallpapers/kings-set-stage-loop.mp4" },
] as const;
export const APPROVED_ART_IDS: readonly string[] = APPROVED_ART_SOURCES.map((a) => a.id);

/** Screensaver + living-wallpaper sources per pack: the approved
    living loops (King's Set) — the same loops for every pack because
    they are the approved library; the pack's own ground still is its
    static screensaver frame. */
export const LIVING_SOURCES = APPROVED_ART_SOURCES.filter((a) => a.kind === "loop");

/* ─── Top-50 icon set: semantic marks + per-pack glyph character ────── */

export const ICON_NAMES = [
  "phone", "messages", "camera", "photos", "music", "video", "browser", "mail",
  "calendar", "clock", "maps", "weather", "notes", "settings", "store",
  "social", "chat", "wallet", "bank", "calculator", "files", "cloud",
  "gallery", "mic", "podcast", "radio", "tv", "games", "books", "news",
  "fitness", "heart", "shopping", "food", "travel", "car", "home",
  "lock", "alarm", "flashlight", "compass", "translate", "scan", "draw",
  "stream", "live", "crown", "shark", "star", "gift",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** Semantic mark per icon (24×24 viewBox path data, drawn in-house). */
const ICON_MARKS: Record<IconName, string> = {
  phone: "M6 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z",
  messages: "M4 4h16v11H8l-4 4V4Z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4V8Zm8 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  photos: "M4 5h16v14H4V5Zm2 12 5-6 3 4 2-2 2 4H6Z",
  music: "M9 18V6l10-2v11M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-3a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  video: "M3 7h13v10H3V7Zm13 3 5-3v10l-5-3v-4Z",
  browser: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18",
  mail: "M3 6h18v12H3V6Zm0 1 9 6 9-6",
  calendar: "M5 5h14v16H5V5Zm0 4h14M8 3v4M16 3v4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2",
  maps: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14M15 6v14",
  weather: "M7 18a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.5 11 3.5 3.5 0 0 1 17.5 18H7Z",
  notes: "M6 3h12v18H6V3Zm3 5h6M9 12h6M9 16h4",
  settings: "M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm7 3.5-2 .5-1.2 1.7.4 2-3-1.7-2 .6-1.3 1.5-1.6-1 .3-2.1-1.7-1.2-2 .5a7 7 0 0 1 0-2l2-.5 1.2-1.7-.4-2 3 1.7 2-.6 1.3-1.5 1.6 1-.3 2.1 1.7 1.2 2-.5a7 7 0 0 1 0 2Z",
  store: "M4 5h16l-1.5 6h-13L4 5Zm1.5 6v9h13v-9M9 20v-5h6v5",
  social: "M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 0a3 3 0 1 0 0-6M3 20c0-3 2-5 4-5s4 2 4 5M13.5 15.6c2.4-.8 6.5.4 6.5 4.4",
  chat: "M4 5h16v10H9l-5 4V5Z",
  wallet: "M3 7a2 2 0 0 1 2-2h13v3M3 7v10a2 2 0 0 0 2 2h16v-9H5a2 2 0 0 1-2-3Zm14 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  bank: "M3 9 12 4l9 5H3Zm2 2v7M9.5 11v7M14.5 11v7M19 11v7M3 20h18",
  calculator: "M6 3h12v18H6V3Zm3 3h6v3H9V6Zm0 6h1.5M13.5 12H15M9 15h1.5M13.5 15H15M9 18h6",
  files: "M6 3h8l4 4v14H6V3Zm8 0v4h4",
  cloud: "M7 18a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.5 11 3.5 3.5 0 0 1 17.5 18H7Zm5-8v7M9.5 13.5 12 11l2.5 2.5",
  gallery: "M4 4h16v16H4V4Zm2 14 4-5 3 3 2-2 3 4H6Zm11-9.5A1.5 1.5 0 1 0 17 5.5a1.5 1.5 0 0 0 0 3Z",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm-6.5 8a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7",
  podcast: "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-4.5 2a6 6 0 0 0 3 10.5M16.5 10a6 6 0 0 1-3 10.5M10 14a4 4 0 0 1 4 0v6.5h-4V14Z",
  radio: "M4 10h16v10H4V10ZM4 10l13-7M8 13.5A2.5 2.5 0 1 0 8 18.5a2.5 2.5 0 0 0 0-5Zm5.5 1h5M13.5 17h5",
  tv: "M3 8h18v11H3V8Zm6-5 3 3 3-3",
  games: "M7 8h10a5 5 0 0 1 5 5c0 2.8-2.2 5-5 5-1.2 0-2.3-.4-3.2-1.2H10.2A4.9 4.9 0 0 1 7 18a5 5 0 0 1-5-5 5 5 0 0 1 5-5ZM7 11v4M5 13h4M16.5 12h.01M18.5 15h.01",
  books: "M5 3h13a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5V3Zm0 17a2 2 0 0 1 2-2h12M9 7h6",
  news: "M4 5h13v14H6a2 2 0 0 1-2-2V5Zm13 3h3v9a2 2 0 0 1-2 2M7 9h7M7 13h7M7 17h4",
  fitness: "M12 20.5S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 5.5-8 11-8 11Z",
  heart: "M12 20.5S4 15 4 9.8A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.8c0 5.2-8 10.7-8 10.7ZM4 12h4l2-3 3 5 2-2h5",
  shopping: "M5 8h14l-1.2 12H6.2L5 8Zm4 0a3 3 0 0 1 6 0",
  food: "M7 3v7M4.5 3v4a2.5 2.5 0 0 0 5 0V3M7 10v11M17 3c-1.7 1.2-2.5 3.2-2.5 6 0 2 .8 3 2.5 3v9M17 3v9",
  travel: "M10.5 13.5 3 11l1.5-1.5L11 11l4.5-6.5c.8-1 2.7-.5 2.7.8L14.5 13l1.3 4.5L14.3 19l-2.3-3.8-2 1.5.5-3.2Z",
  car: "M5 12 6.8 6h10.4L19 12v7h-2.5v-2h-11v2H3v-7h2Zm.5 2.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Zm13 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z",
  home: "M3 11 12 4l9 7M5.5 9.5V20h13V9.5M10 20v-5h4v5",
  lock: "M6 11h12v10H6V11Zm3 0V8a3 3 0 0 1 6 0v3M12 15.5v2",
  alarm: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3.5V12l2.5 1.5M4.9 3 3 5.5M19.1 3 21 5.5",
  flashlight: "M9 3h6v4l-1.5 2v12h-3V9L9 7V3Zm0 2h6",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5-3.5-2 5-5 2 2-5 5-2Z",
  translate: "M4 5h9M8.5 3v2c0 4-2 7-4.5 9M6 8c1 3 3.5 5.5 6.5 6.5M13 21l4.5-10L22 21M14.8 17h5.4",
  scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16",
  draw: "M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Zm13.5-15 3 3M3 22h18",
  stream: "M4 6h16v12H4V6Zm7 3.5 5 2.5-5 2.5v-5Z",
  live: "M12 12h.01M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9.4 9.4 0 0 1 0-12.8M18.4 5.6a9.4 9.4 0 0 1 0 12.8",
  crown: "M3 18h18M4 18 3 8l5.5 4L12 5l3.5 7L21 8l-1 10",
  shark: "M2 15c4-1 7-4 9-8 2 3 5 5 9 5-2 1-3.5 2.5-4.5 4.5C12 15 8 16.5 4.5 17 3.5 16 2.5 15.5 2 15Zm13.5-3.5h.01",
  star: "M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7L12 3Z",
  gift: "M4 11h16v10H4V11Zm8 10V11M3 7.5h18V11H3V7.5ZM12 7.5a2.7 2.7 0 1 1 2.7-2.7c0 1.7-2.7 2.7-2.7 2.7Zm0 0a2.7 2.7 0 1 0-2.7-2.7c0 1.7 2.7 2.7 2.7 2.7Z",
};

/** Per-pack glyph character: frame path + motif mark + stroke. Unique
    per pack BY SHAPE — marble arch, shark shield, sunset roundel,
    royal crown-shield, pixel block — not a recolor of one frame. */
export const PACK_GLYPH_STYLE: Record<
  string,
  { frame: string; motif: string; strokeWidth: number; corner: string }
> = {
  "golden-marble": {
    frame: "M12 2.5 21 7v10c0 2-1 3.5-2.5 4.5H5.5C4 20.5 3 19 3 17V7l9-4.5Z",
    motif: "M7 19c2-6 8-6 10 0M12 5.5v13",
    strokeWidth: 1.5, corner: "arch",
  },
  "shark-tank": {
    frame: "M12 2 20 5v6c0 5-3.5 8.5-8 11C7.5 19.5 4 16 4 11V5l8-3Z",
    motif: "M4 15.5c2.5-1.2 5 1.2 8 0s5.5 1.2 8 0",
    strokeWidth: 1.6, corner: "shield",
  },
  "golden-hour": {
    frame: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Z",
    motif: "M5 16.5h14M8 19.5h8",
    strokeWidth: 1.5, corner: "roundel",
  },
  "kings-set": {
    frame: "M5 3h14v7c0 5-3 8.5-7 11C9 19.5 5 15 5 10V3Z",
    motif: "M8 6.5 12 4l4 2.5M8 9.5h8",
    strokeWidth: 1.7, corner: "crown-shield",
  },
  "arcade-gold": {
    frame: "M5 4h14v3h2v10h-2v3H5v-3H3V7h2V4Z",
    motif: "M7 7h3M14 14h3M7 14h.01M17 7h.01",
    strokeWidth: 1.4, corner: "pixel",
  },
};

/** Render one icon as a standalone SVG (light or dark variant). */
export function renderIconSvg(pack: ThemePack, mode: ThemePackMode, icon: IconName): string {
  const v = pack.variants[mode]!;
  const ground = hslToHex(v.tokens.background) ?? "#000000";
  const accent = hslToHex(v.tokens.primary) ?? "#f9bc06";
  const ink = hslToHex(v.tokens.foreground) ?? "#ffffff";
  const style = PACK_GLYPH_STYLE[pack.id] ?? PACK_GLYPH_STYLE["golden-marble"]!;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" data-pack="${pack.id}" data-mode="${mode}" data-icon="${icon}">`,
    `<path d="${style.frame}" transform="translate(0,-1) scale(2)" fill="${ground}" stroke="${accent}" stroke-width="0.8"/>`,
    `<g transform="translate(9,10) scale(1.25)" fill="none" stroke="${ink}" stroke-width="${style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${ICON_MARKS[icon]}"/></g>`,
    `<g transform="translate(9,26) scale(1.25)" fill="none" stroke="${accent}" stroke-width="1.1" opacity="0.9"><path d="${style.motif}"/></g>`,
    `</svg>`,
  ].join("");
}

/** Folder icon (computer) — the pack frame as a folder glyph. */
export function renderFolderIconSvg(pack: ThemePack, mode: ThemePackMode): string {
  const v = pack.variants[mode]!;
  const ground = hslToHex(v.tokens.card) ?? "#111111";
  const accent = hslToHex(v.tokens.primary) ?? "#f9bc06";
  const ink = hslToHex(v.tokens.foreground) ?? "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" data-folder="${pack.id}-${mode}"><path d="M4 10a3 3 0 0 1 3-3h9l4 5h21a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V10Z" fill="${ground}" stroke="${accent}" stroke-width="2"/><path d="M14 30l10-14 10 14h-6.5L24 24.5 20.5 30H14Z" fill="${ink}"/></svg>`;
}

/** Widget art (clock + headline widgets) as SVG per pack × mode. */
export function renderWidgetSvg(pack: ThemePack, mode: ThemePackMode): string {
  const v = pack.variants[mode]!;
  const ground = hslToHex(v.tokens.background) ?? "#000000";
  const accent = hslToHex(v.tokens.primary) ?? "#f9bc06";
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
  artSource?: string;
  logoPath?: string;
}

export interface KitManifest {
  packId: string;
  packName: string;
  tier: ThemePack["tier"];
  brandedByDefault: true;
  logo: Record<ThemePackMode, string>;
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
    if (c.id === "home-wallpapers" || c.id === "lock-wallpapers") {
      base.artSource = pack.deviceArt.dark;
      base.logoPath = LOGO_BY_MODE.dark;
    }
    return base;
  });
  return {
    packId: pack.id,
    packName: pack.name,
    tier: pack.tier,
    brandedByDefault: true,
    logo: LOGO_BY_MODE,
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

/** The accent a component renders with after customization. */
export function effectiveAccent(
  pack: ThemePack,
  mode: ThemePackMode,
  mix: PackCustomization | undefined,
  component: KitComponentId,
  device: KitDevice = "all",
): string {
  const custom = mix?.[component]?.[device]?.accentHex ?? mix?.["accent-color"]?.[device]?.accentHex;
  if (custom) return custom;
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

export function buildShareCardSvg(pack: ThemePack, mode: ThemePackMode): string {
  const v = pack.variants[mode]!;
  const ground = hslToHex(v.tokens.background) ?? "#000000";
  const accent = hslToHex(v.tokens.primary) ?? "#f9bc06";
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
