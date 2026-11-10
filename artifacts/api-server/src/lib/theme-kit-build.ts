/* ─── Theme kit bundle builder (Stack-200 UPGRADES #39) ──────────────
   Builds the downloadable whole-device kit bundles server-side.

   SOUND SYNC (owner ruling, Oct 25 17:39 EDT): kit sounds come from
   the SITE SOUND LIBRARY by role — the single source of truth. The
   library files live under the frontend public/sounds/ directory
   under the role-manifest names (signature-<role>.wav; the approved
   V7 masters swap in files-only via the signature lane). Bundles
   include those library files UNDER THEIR MANIFEST NAMES, shared by
   every pack — this module contains NO per-pack sound data and never
   writes a pack-named wav. If the library files are absent on a given
   deploy, bundles carry the role manifest (SOUND-MANIFEST.json)
   pointing at the library paths instead of silent substitutes.

   ART: every image byte resolves from the owner-approved library only
   (QC-200 G3 fix): the DESIGNED icon set from
   ~/workspace/theme-pack-art/MANIFEST.md (500 designed emblems —
   5 packs × 50 icons × light+dark — shipped scale-only at 512×512
   under public/theme-packs/icons/, provenance + hashes in
   public/theme-packs/kit-assets-manifest.json), the pack app icons
   (the REAL full logo lockup composited whole onto the pack tile,
   public/theme-packs/app-icons/), and wallpaper bytes from the
   frontend public/wallpapers/ tree (pack grounds + per-device
   crop-to-fill renders + King's Set stills and living loops).
   Kit wallpapers are CLEAN — no logo is ever baked or composited
   onto them; the whole logo ships as its own file. Asset roots can
   be overridden with THEME_KIT_ASSET_DIR (used by tests with
   fixtures). */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ZipArchive } from "archiver";

export type KitMode = "light" | "dark";

interface ServerPack {
  id: string;
  name: string;
  tier: "included" | "premium";
  cursor: string;
  deviceArt: Record<KitMode, string>;
  colors: Record<KitMode, { background: string; foreground: string; primary: string }>;
}

/** Server mirror of the FE registry's kit-relevant fields (ids, tiers,
    art paths, headline colors). Price is NOT here — it lives only on
    the purchase rail (routes/theme-packs.ts THEME_PACK_PRICE_VB). */
export const SERVER_PACKS: ServerPack[] = [
  {
    id: "golden-marble", name: "Golden Marble", tier: "included", cursor: "shark-fin",
    deviceArt: { dark: "/wallpapers/theme-packs/golden-marble-dark.webp", light: "/wallpapers/theme-packs/golden-marble-light.webp" },
    colors: {
      dark: { background: "36 24% 5%", foreground: "45 30% 94%", primary: "45 95% 50%" },
      light: { background: "40 33% 97%", foreground: "26 28% 10%", primary: "43 62% 46%" },
    },
  },
  {
    id: "shark-tank", name: "Shark Tank", tier: "included", cursor: "pixel-shark",
    deviceArt: { dark: "/wallpapers/theme-packs/shark-tank-dark.webp", light: "/wallpapers/theme-packs/shark-tank-light.webp" },
    colors: {
      dark: { background: "209 42% 5%", foreground: "200 25% 93%", primary: "45 95% 50%" },
      light: { background: "186 32% 96%", foreground: "204 32% 11%", primary: "43 62% 46%" },
    },
  },
  {
    id: "golden-hour", name: "Golden Hour", tier: "included", cursor: "flame",
    deviceArt: { dark: "/wallpapers/theme-packs/golden-hour-dark.webp", light: "/wallpapers/theme-packs/golden-hour-light.webp" },
    colors: {
      dark: { background: "27 32% 5%", foreground: "36 38% 93%", primary: "38 100% 55%" },
      light: { background: "33 58% 96%", foreground: "25 34% 11%", primary: "38 85% 50%" },
    },
  },
  {
    id: "kings-set", name: "The King's Set", tier: "premium", cursor: "crown",
    deviceArt: { dark: "/wallpapers/theme-packs/kings-set-dark.webp", light: "/wallpapers/theme-packs/kings-set-light.webp" },
    colors: {
      dark: { background: "36 30% 3%", foreground: "46 34% 95%", primary: "46 100% 56%" },
      light: { background: "42 48% 98%", foreground: "26 34% 8%", primary: "42 85% 48%" },
    },
  },
  {
    id: "arcade-gold", name: "Arcade Gold", tier: "premium", cursor: "gamepad",
    deviceArt: { dark: "/wallpapers/theme-packs/arcade-gold-dark.webp", light: "/wallpapers/theme-packs/arcade-gold-light.webp" },
    colors: {
      dark: { background: "38 14% 5%", foreground: "44 24% 94%", primary: "44 100% 52%" },
      light: { background: "40 38% 96%", foreground: "30 26% 10%", primary: "40 82% 46%" },
    },
  },
  {
    id: "crimson-marble", name: "Crimson Marble", tier: "premium", cursor: "diamond",
    deviceArt: { dark: "/wallpapers/theme-packs/crimson-marble-dark.webp", light: "/wallpapers/theme-packs/crimson-marble-light.webp" },
    colors: {
      dark: { background: "355 32% 4%", foreground: "25 30% 95%", primary: "43 95% 54%" },
      light: { background: "18 48% 97%", foreground: "350 35% 10%", primary: "38 82% 46%" },
    },
  },
  {
    id: "sapphire-marble", name: "Sapphire Marble", tier: "premium", cursor: "star",
    deviceArt: { dark: "/wallpapers/theme-packs/sapphire-marble-dark.webp", light: "/wallpapers/theme-packs/sapphire-marble-light.webp" },
    colors: {
      dark: { background: "222 47% 5%", foreground: "212 32% 94%", primary: "215 90% 58%" },
      light: { background: "207 48% 97%", foreground: "219 42% 11%", primary: "216 82% 40%" },
    },
  },
  {
    id: "emerald-marble", name: "Emerald Marble", tier: "premium", cursor: "gold-key",
    deviceArt: { dark: "/wallpapers/theme-packs/emerald-marble-dark.webp", light: "/wallpapers/theme-packs/emerald-marble-light.webp" },
    colors: {
      dark: { background: "152 38% 4%", foreground: "140 25% 95%", primary: "43 95% 54%" },
      light: { background: "140 42% 97%", foreground: "152 35% 10%", primary: "152 70% 30%" },
    },
  },
];

export function serverPackById(id: string): ServerPack | undefined {
  return SERVER_PACKS.find((p) => p.id === id);
}

/* ─── Designed icon set (the approved art — never code-drawn) ───────── */

/** The approved top-50 icon names, in manifest order: the original
    top 20, then the top-50 expansion (MANIFEST.md, Oct 25 2026).
    Mirror of the FE DESIGNED_ICON_NAMES — the parity test pins both
    lists to the same 50 names. */
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

/** Site path of one designed icon (the approved emblem master,
    scale-only at 512×512 — see kit-assets-manifest.json). */
export function designedIconSitePath(packId: string, icon: string, mode: KitMode): string {
  return `/theme-packs/icons/${packId}/${icon}-${mode}.webp`;
}

/** Site path of the pack's app icon: the REAL full illustrated logo
    lockup composited whole onto the pack tile (never cropped, never
    redrawn — the approved app-icons-logo composites). */
export function appIconSitePath(packId: string, mode: KitMode): string {
  return `/theme-packs/app-icons/${packId}-${mode}.webp`;
}

/** The whole-logo master for a mode — ships as its own file; kit
    wallpapers stay clean. */
function logoSitePath(mode: KitMode): string {
  return mode === "dark" ? "/logo-static.webp" : "/logo-light.webp";
}

/* ─── Per-device wallpapers (canonical sizes from the preset list) ──── */

export const WALLPAPER_DEVICES = [
  { id: "phone", label: "Phone", width: 1179, height: 2556 },
  { id: "tablet", label: "Tablet", width: 1640, height: 2360 },
  { id: "desktop", label: "Desktop", width: 1920, height: 1080 },
] as const;
type WallpaperDeviceId = (typeof WALLPAPER_DEVICES)[number]["id"];

/** Site path of the per-device crop-to-fill render of a pack ground
    (clean — no logo composited). Home and lock share the pack's one
    approved ground art per mode; no distinct lock scene has been
    approved per pack, and the kit says so rather than inventing one. */
export function deviceWallpaperSitePath(packId: string, mode: KitMode, device: WallpaperDeviceId): string {
  return `/wallpapers/theme-packs/devices/${packId}-${mode}-${device}.webp`;
}

/* ─── Sound library (single source of truth, by role) ───────────────── */

const SOUND_ROLES = [
  "notification", "message", "success", "error", "royal-sting", "ringtone",
] as const;
type SoundRoleName = (typeof SOUND_ROLES)[number];

/** The library file name for a role — manifest name, shared by site,
    app, extension, World and every theme pack. */
function soundLibraryFileName(role: SoundRoleName): string {
  return `signature-${role}.wav`;
}
export function soundLibrarySitePath(role: SoundRoleName): string {
  return `/sounds/${soundLibraryFileName(role)}`;
}

/* ─── Color helpers ─────────────────────────────────────────────────── */

export function hslToHex(hsl: string): string {
  const m = /^([\d.]+) ([\d.]+)% ([\d.]+)%$/.exec(hsl.trim());
  if (!m) return "#000000";
  const h = Number(m[1]), s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const c = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${c(f(0))}${c(f(8))}${c(f(4))}`;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/* ─── Stored customization mix (the builders consume it) ──────────────
   A member's saved mix (theme_pack_customizations) — or a creator
   pack's design mix (creator_theme_packs.mix) — is what a bundle is
   built FROM. The route loads + sanitizes it; these resolvers read
   the two fields that shape bundle bytes:

   - accentHex: the kit accent. Resolution mirrors the FE
     effectiveAccent (lib/theme-kit.ts): the component's own accent,
     then the accent-color component's, then the pack default. Device
     resolution tries the artifact's device key, then "all" (the key
     the kit panel writes).
   - artSourceId (home-wallpapers / lock-wallpapers): swap the slot's
     wallpaper art from the approved library. "pack-ground" (or no
     choice) keeps the pack ground — today's behaviour, unchanged.

   Fields with no bundle-byte meaning are NOT consumed here: branded
   and note carry no defined bundle semantics, cursorId names no
   bundle-side cursor art, customArtUrl bytes are not resolvable from
   the approved on-disk library, and extraSoundRole is already inside
   every bundle by construction (the full library set ships). */

export interface KitMixSettings {
  artSourceId?: string;
  accentHex?: string;
}

/** component → device → settings (the sanitized storage shape). */
export type KitMix = Partial<Record<string, Partial<Record<string, KitMixSettings>>>>;

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

function deviceChain(device: string): string[] {
  return device === "all" ? ["all"] : [device, "all"];
}

/** The accent a kit artifact renders with after customization —
    server mirror of the FE effectiveAccent chain. */
export function resolveKitAccent(
  pack: ServerPack,
  mode: KitMode,
  mix: KitMix | undefined,
  component: string,
  device = "all",
): string {
  for (const comp of [component, "accent-color"]) {
    for (const d of deviceChain(device)) {
      const hex = mix?.[comp]?.[d]?.accentHex;
      if (typeof hex === "string" && HEX6_RE.test(hex)) return hex.toLowerCase();
    }
  }
  return hslToHex(pack.colors[mode].primary);
}

/** Approved-library art id → site path. Mirror of the FE
    APPROVED_ART_SOURCES paths ("pack-ground" has no path — it IS the
    pack ground, the default). The parity tests pin both lists. */
export const KIT_ART_SITE_PATHS: Record<string, string> = {
  /* Per-pack ground sources (QC fix #13): each pack's approved ground
     art, by name — the paths are the SERVER_PACKS deviceArt values. */
  "pack-ground-golden-marble-dark": "/wallpapers/theme-packs/golden-marble-dark.webp",
  "pack-ground-golden-marble-light": "/wallpapers/theme-packs/golden-marble-light.webp",
  "pack-ground-shark-tank-dark": "/wallpapers/theme-packs/shark-tank-dark.webp",
  "pack-ground-shark-tank-light": "/wallpapers/theme-packs/shark-tank-light.webp",
  "pack-ground-golden-hour-dark": "/wallpapers/theme-packs/golden-hour-dark.webp",
  "pack-ground-golden-hour-light": "/wallpapers/theme-packs/golden-hour-light.webp",
  "pack-ground-kings-set-dark": "/wallpapers/theme-packs/kings-set-dark.webp",
  "pack-ground-kings-set-light": "/wallpapers/theme-packs/kings-set-light.webp",
  "pack-ground-arcade-gold-dark": "/wallpapers/theme-packs/arcade-gold-dark.webp",
  "pack-ground-arcade-gold-light": "/wallpapers/theme-packs/arcade-gold-light.webp",
  "pack-ground-crimson-marble-dark": "/wallpapers/theme-packs/crimson-marble-dark.webp",
  "pack-ground-crimson-marble-light": "/wallpapers/theme-packs/crimson-marble-light.webp",
  "pack-ground-sapphire-marble-dark": "/wallpapers/theme-packs/sapphire-marble-dark.webp",
  "pack-ground-sapphire-marble-light": "/wallpapers/theme-packs/sapphire-marble-light.webp",
  "pack-ground-emerald-marble-dark": "/wallpapers/theme-packs/emerald-marble-dark.webp",
  "pack-ground-emerald-marble-light": "/wallpapers/theme-packs/emerald-marble-light.webp",
  "kings-set-throne-phone": "/wallpapers/kings-set-throne-phone.webp",
  "kings-set-plaza-phone": "/wallpapers/kings-set-plaza-phone.webp",
  "kings-set-stage-desktop": "/wallpapers/kings-set-stage-desktop.webp",
  "kings-set-throne-loop": "/wallpapers/kings-set-throne-loop.mp4",
  "kings-set-plaza-loop": "/wallpapers/kings-set-plaza-loop.mp4",
  "kings-set-stage-loop": "/wallpapers/kings-set-stage-loop.mp4",
};

/** The raw art choice stored for one component × device (no device
    fallback) — kit.json records exactly what was stored. */
export function storedKitArtId(
  mix: KitMix | undefined,
  component: string,
  device: string,
): string | undefined {
  const id = mix?.[component]?.[device]?.artSourceId;
  return typeof id === "string" && id in KIT_ART_SITE_PATHS ? id : undefined;
}

/** The art choice that applies to a slot: the slot device's own
    choice, then the "all devices" choice, else the pack ground. */
export function resolveKitArtId(
  mix: KitMix | undefined,
  component: string,
  device: string,
): string | undefined {
  for (const d of deviceChain(device)) {
    const id = storedKitArtId(mix, component, d);
    if (id) return id;
  }
  return undefined;
}

/* ─── Asset resolution (approved library on disk) ───────────────────── */

function assetRoots(): string[] {
  const roots: string[] = [];
  if (process.env["THEME_KIT_ASSET_DIR"]) roots.push(process.env["THEME_KIT_ASSET_DIR"]);
  // Monorepo layouts (dev worktrees + the Docker image's FE dist tree).
  roots.push(join(process.cwd(), "artifacts/bow-down-visuals/public"));
  roots.push(join(process.cwd(), "../bow-down-visuals/public"));
  roots.push(join(process.cwd(), "../../artifacts/bow-down-visuals/public"));
  roots.push("/home/hatch/workspace/bow-down-visuals/artifacts/bow-down-visuals/public");
  return roots;
}

/** Resolve a site-relative asset path ("/wallpapers/…", "/sounds/…",
    "/logo-static.webp") to bytes from the approved library, or null. */
export function readSiteAsset(sitePath: string): Buffer | null {
  const rel = sitePath.replace(/^\//, "");
  for (const root of assetRoots()) {
    const p = join(root, rel);
    if (existsSync(p)) {
      try { return readFileSync(p); } catch { /* try next root */ }
    }
  }
  return null;
}

/** The mix-chosen art for one wallpaper slot, resolved to bytes from
    the approved library — null when the slot keeps the pack ground
    (no choice, or the chosen file is absent on this deploy, in which
    case the ground ships rather than a substitute). */
export function chosenKitArt(
  mix: KitMix | undefined,
  component: string,
  device: string,
): { id: string; bytes: Buffer; ext: "webp" | "mp4" } | null {
  const id = resolveKitArtId(mix, component, device);
  if (!id) return null;
  const sitePath = KIT_ART_SITE_PATHS[id]!;
  const bytes = readSiteAsset(sitePath);
  if (!bytes) return null;
  return { id, bytes, ext: sitePath.endsWith(".mp4") ? "mp4" : "webp" };
}

/* ─── Minimal .cur writer (32×32, 32bpp, accent glyph block) ───────── */

export function buildCursorFile(accentHex: string, kind: "arrow" | "hand"): Buffer {
  const [r, g, b] = hexToRgb(accentHex);
  const size = 32;
  const xorSize = size * size * 4;
  const andSize = size * 4; // 32 rows × 4 bytes (1bpp padded)
  const bihSize = 40;
  const imgSize = bihSize + xorSize + andSize;
  const buf = Buffer.alloc(6 + 16 + imgSize);
  // ICONDIR: reserved, type=2 (cursor), count=1
  buf.writeUInt16LE(0, 0); buf.writeUInt16LE(2, 2); buf.writeUInt16LE(1, 4);
  // ICONDIRENTRY
  buf.writeUInt8(size, 6); buf.writeUInt8(size, 7); buf.writeUInt8(0, 8); buf.writeUInt8(0, 9);
  buf.writeUInt16LE(1, 10); buf.writeUInt16LE(32, 12);
  buf.writeUInt32LE(imgSize, 14);
  buf.writeUInt16LE(kind === "arrow" ? 2 : 16, 18); // hotspot x
  buf.writeUInt16LE(2, 20); // hotspot y
  buf.writeUInt32LE(6 + 16, 22 - 4); // offset (bytesInRes at 14..17, hotspot at 18..21, offset at 22? no—)
  // Correct ICONDIRENTRY layout: bWidth,bHeight,bColorCount,bReserved,wPlanes,wBitCount,dwBytesInRes,dwImageOffset
  // then hotspot lives INSIDE the image data for cursors (after BITMAPINFOHEADER).
  buf.writeUInt32LE(6 + 16, 18);
  const img = 6 + 16;
  buf.writeUInt32LE(bihSize, img);
  buf.writeInt32LE(size, img + 4);
  buf.writeInt32LE(size * 2, img + 8); // cursor height is doubled
  buf.writeUInt16LE(1, img + 12);
  buf.writeUInt16LE(32, img + 14);
  // hotspot stored in entry for cursors replaces planes/bitcount in some readers;
  // canonical: wPlanes=hotspotX, wBitCount=hotspotY.
  buf.writeUInt16LE(kind === "arrow" ? 2 : 16, 10);
  buf.writeUInt16LE(2, 12);
  // XOR bitmap (BGRA), bottom-up; draw a simple arrow / hand block glyph.
  const px = img + bihSize;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = size - 1 - y;
      const inside = kind === "arrow"
        ? x < size - row && x < 20
        : x > 8 && x < 24 && row > 6 && row < 26;
      const off = px + (row * size + x) * 4;
      buf[off] = b; buf[off + 1] = g; buf[off + 2] = r; buf[off + 3] = inside ? 255 : 0;
    }
  }
  return buf;
}

/* ─── Minimal CAB writer (uncompressed) — a REAL .themepack ────────── */
/* CAB layout: CFHEADER(36) + CFFOLDER(8) + CFFILE(16+name)… + CFDATA…
   Compression type 0 (none). Each CFDATA block holds ≤ 32768 bytes of
   uncompressed data belonging to exactly one file stream segment; we
   emit one folder whose stream is all files concatenated. */

interface CabFile { name: string; data: Buffer }

export function buildCab(files: CabFile[]): Buffer {
  const headerSize = 36;
  const folderSize = 8;
  const fileEntriesSize = files.reduce((n, f) => n + 16 + Buffer.byteLength(f.name, "utf8") + 1, 0);
  const coffFiles = headerSize + folderSize;
  const coffData = coffFiles + fileEntriesSize;
  const totalUncomp = files.reduce((n, f) => n + f.data.length, 0);

  // Build CFDATA blocks first to know the folder's compressed size.
  const dataBlocks: Buffer[] = [];
  let stream = Buffer.concat(files.map((f) => f.data));
  let offset = 0;
  while (offset < stream.length || dataBlocks.length === 0) {
    const chunk = stream.subarray(offset, offset + 32768);
    const blk = Buffer.alloc(8 + chunk.length);
    blk.writeUInt32LE(0, 0); // checksum (0 allowed when unused)
    blk.writeUInt16LE(chunk.length, 4);
    blk.writeUInt16LE(chunk.length, 6);
    chunk.copy(blk, 8);
    dataBlocks.push(blk);
    offset += chunk.length;
    if (stream.length === 0) break;
  }
  const dataBytes = Buffer.concat(dataBlocks);
  stream = Buffer.alloc(0);

  const cab = Buffer.alloc(coffData + dataBytes.length);
  cab.write("MSCF", 0, "ascii");
  cab.writeUInt32LE(cab.length, 8); // cbCabinet
  cab.writeUInt32LE(coffFiles, 16); // coffFiles
  cab.writeUInt8(3, 24); // version minor
  cab.writeUInt8(1, 25); // version major
  cab.writeUInt16LE(1, 26); // cFolders
  cab.writeUInt16LE(files.length, 28); // cFiles
  cab.writeUInt16LE(0, 30); // flags
  cab.writeUInt16LE(0, 32); // setID
  cab.writeUInt16LE(0, 34); // iCabinet
  // CFFOLDER
  cab.writeUInt32LE(coffData, headerSize); // coffCabStart
  cab.writeUInt16LE(dataBlocks.length, headerSize + 4); // cCFData
  cab.writeUInt16LE(0, headerSize + 6); // typeCompress = none
  // CFFILE entries
  let p = coffFiles;
  let uoff = 0;
  for (const f of files) {
    cab.writeUInt32LE(f.data.length, p); // cbFile
    cab.writeUInt32LE(uoff, p + 4); // uoffFolderStart
    cab.writeUInt16LE(0, p + 8); // iFolder
    cab.writeUInt16LE(0, p + 10); // date (0 allowed)
    cab.writeUInt16LE(0, p + 12); // time
    cab.writeUInt16LE(0x20, p + 14); // attribs: archive
    const nameBytes = Buffer.from(f.name, "utf8");
    nameBytes.copy(cab, p + 16);
    cab[p + 16 + nameBytes.length] = 0;
    p += 16 + nameBytes.length + 1;
    uoff += f.data.length;
  }
  void totalUncomp;
  dataBytes.copy(cab, coffData);
  return cab;
}

/* ─── .themepack assembly ───────────────────────────────────────────── */

export function buildWindowsThemeText(pack: ServerPack, mode: KitMode, accentHex?: string): string {
  const accent = (accentHex ?? hslToHex(pack.colors[mode].primary)).replace("#", "");
  const r = parseInt(accent.slice(0, 2), 16), g = parseInt(accent.slice(2, 4), 16), b = parseInt(accent.slice(4, 6), 16);
  const colorization = (b << 16) | (g << 8) | r;
  return [
    "; Bow Down Visuals whole-device theme kit",
    "[Theme]",
    `DisplayName=Bow Down Visuals - ${pack.name} (${mode})`,
    "",
    "[Control Panel\\Desktop]",
    `Wallpaper=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\wallpaper.webp`,
    "TileWallpaper=0",
    "WallpaperStyle=10",
    "",
    "[VisualStyles]",
    "ColorStyle=@themeui.dll,-854",
    "AutoColorization=0",
    `ColorizationColor=${colorization}`,
    "",
    "[Sounds]",
    `; Sounds resolve BY ROLE to the site sound library set (single source).`,
    `DefaultValue=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\sounds\\${soundLibraryFileName("notification")}`,
    "",
    "[AppEvents\\Schemes\\Apps\\.Default\\Notification.Default\\.Current]",
    `DefaultValue=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\sounds\\${soundLibraryFileName("notification")}`,
    "[AppEvents\\Schemes\\Apps\\.Default\\SystemAsterisk\\.Current]",
    `DefaultValue=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\sounds\\${soundLibraryFileName("royal-sting")}`,
    "",
    "[Control Panel\\Cursors]",
    `Arrow=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\cursors\\arrow.cur`,
    `Hand=%SystemRoot%\\Resources\\Themes\\${pack.id}-${mode}\\cursors\\hand.cur`,
    "",
  ].join("\r\n");
}

/** A real .themepack (CAB) for one pack × mode: theme text, wallpaper
    (the pack's CLEAN approved ground — no logo baked onto it), the
    whole logo as its own file, the pack app icon (the real logo
    lockup composited whole onto the pack tile), pack cursors, and
    the LIBRARY sound files under manifest names. When a stored mix
    is supplied, the kit wears it: the theme-text colorization takes
    the mix accent, the cursors take the cursors-component accent,
    and a still art choice for home wallpapers ships as the wallpaper
    (a living-loop choice cannot be a Windows wallpaper — the ground
    ships for that slot instead). */
export function buildThemepack(pack: ServerPack, mode: KitMode, mix?: KitMix): Buffer {
  const packAccent = resolveKitAccent(pack, mode, mix, "accent-color");
  const files: CabFile[] = [
    { name: `${pack.id}-${mode}.theme`, data: Buffer.from(buildWindowsThemeText(pack, mode, packAccent), "utf8") },
  ];
  const homeArt = chosenKitArt(mix, "home-wallpapers", "desktop");
  const wallpaper = homeArt && homeArt.ext === "webp"
    ? homeArt.bytes
    : readSiteAsset(pack.deviceArt[mode]);
  if (wallpaper) files.push({ name: "wallpaper.webp", data: wallpaper });
  const logo = readSiteAsset(logoSitePath(mode));
  if (logo) files.push({ name: "logo.webp", data: logo });
  const appIcon = readSiteAsset(appIconSitePath(pack.id, mode));
  if (appIcon) files.push({ name: "app-icon.webp", data: appIcon });
  const accent = resolveKitAccent(pack, mode, mix, "cursors");
  files.push({ name: "cursors\\arrow.cur", data: buildCursorFile(accent, "arrow") });
  files.push({ name: "cursors\\hand.cur", data: buildCursorFile(accent, "hand") });
  for (const role of SOUND_ROLES) {
    const wav = readSiteAsset(soundLibrarySitePath(role));
    if (wav) files.push({ name: `sounds\\${soundLibraryFileName(role)}`, data: wav });
  }
  files.push({
    name: "SOUND-MANIFEST.json",
    data: Buffer.from(JSON.stringify({
      source: "site sound library (single source of truth)",
      roles: Object.fromEntries(SOUND_ROLES.map((r) => [r, soundLibrarySitePath(r)])),
      note: "Pack sounds ARE the house signature set by role. A set swap updates the library files and every pack follows — packs never fork copies.",
    }, null, 2)),
  });
  return buildCab(files);
}

/* ─── Zip bundle builder ────────────────────────────────────────────── */

export type KitBundleKind = "windows" | "mac" | "android" | "ios" | "chrome" | "sounds" | "full";

export const KIT_BUNDLE_KINDS: KitBundleKind[] = ["windows", "mac", "android", "ios", "chrome", "sounds", "full"];

function soundManifestJson(): string {
  return JSON.stringify({
    source: "site sound library (single source of truth)",
    roles: Object.fromEntries(SOUND_ROLES.map((r) => [r, soundLibrarySitePath(r)])),
    note: "These are the library files themselves under their manifest names — the same files the site plays. No per-pack copies exist.",
  }, null, 2);
}

function addSounds(archive: InstanceType<typeof ZipArchive>, prefix: string): void {
  let any = false;
  for (const role of SOUND_ROLES) {
    const wav = readSiteAsset(soundLibrarySitePath(role));
    if (wav) { archive.append(wav, { name: `${prefix}${soundLibraryFileName(role)}` }); any = true; }
  }
  archive.append(soundManifestJson(), { name: `${prefix}SOUND-MANIFEST.json` });
  if (!any) {
    archive.append(
      "The sound library files were not present on this deploy. Your pack's sounds are the site sound library set by role — download them any time from Settings > Sounds, or re-download this kit after the library lands. The pack never carries forked copies.",
      { name: `${prefix}SOUNDS-README.txt` },
    );
  }
}

/** Per-device wallpapers for BOTH modes: the full approved ground,
    a crop-to-fill render sized for phone / tablet / desktop as the
    home wallpaper, and the same sized renders as the lock wallpaper.
    HONEST SLOT NOTE: home and lock share the pack's one approved
    ground art per mode — no distinct lock scene has been approved
    per pack, so the kit ships the ground sized per device for both
    slots instead of inventing lock art. All wallpapers are CLEAN:
    no logo is baked or composited onto them; the whole logo ships
    as its own file (logo-<mode>.webp).
    MIX: a stored art choice for home-wallpapers / lock-wallpapers
    (per device, falling back to the "all devices" choice) ships in
    that slot instead of the ground render — a still under its .webp
    name, a living loop under its real .mp4 name. Untouched slots
    keep the ground exactly as before. */
function addWallpapers(archive: InstanceType<typeof ZipArchive>, pack: ServerPack, prefix: string, mix?: KitMix): void {
  for (const mode of ["light", "dark"] as KitMode[]) {
    const ground = readSiteAsset(pack.deviceArt[mode]);
    const homeAll = chosenKitArt(mix, "home-wallpapers", "all");
    if (homeAll) archive.append(homeAll.bytes, { name: `${prefix}wallpaper-${mode}-original.${homeAll.ext}` });
    else if (ground) archive.append(ground, { name: `${prefix}wallpaper-${mode}-original.webp` });
    for (const device of WALLPAPER_DEVICES) {
      const sized = readSiteAsset(deviceWallpaperSitePath(pack.id, mode, device.id));
      const home = chosenKitArt(mix, "home-wallpapers", device.id);
      if (home) archive.append(home.bytes, { name: `${prefix}wallpaper-${mode}-${device.id}.${home.ext}` });
      else if (sized) archive.append(sized, { name: `${prefix}wallpaper-${mode}-${device.id}.webp` });
      const lock = chosenKitArt(mix, "lock-wallpapers", device.id);
      if (lock) archive.append(lock.bytes, { name: `${prefix}lock-${mode}-${device.id}.${lock.ext}` });
      else if (sized) archive.append(sized, { name: `${prefix}lock-${mode}-${device.id}.webp` });
    }
    const logo = readSiteAsset(logoSitePath(mode));
    if (logo) archive.append(logo, { name: `${prefix}logo-${mode}.webp` });
  }
  // Approved King's Set library pieces: stills + living loops +
  // screensaver (shared approved library, shipped as extras).
  for (const still of ["kings-set-throne-phone.webp", "kings-set-plaza-phone.webp", "kings-set-stage-desktop.webp"]) {
    const bytes = readSiteAsset(`/wallpapers/${still}`);
    if (bytes) archive.append(bytes, { name: `${prefix}living/${still}` });
  }
  for (const loop of ["kings-set-throne-loop.mp4", "kings-set-plaza-loop.mp4", "kings-set-stage-loop.mp4"]) {
    const bytes = readSiteAsset(`/wallpapers/${loop}`);
    if (bytes) archive.append(bytes, { name: `${prefix}living/${loop}` });
  }
}

/** The designed-icon site paths ABSENT from this deploy's asset
    library for a pack, in bundle order (light then dark, manifest
    name order). A pack whose set the art program has not raised yet
    (crimson-marble, emerald-marble) is missing all 100; a raised
    pack is missing none. The bundle paperwork (README, kit.json,
    install texts, the manifests endpoint) conditions itself on
    this list — the kit never claims icons it does not ship. */
export function designedIconsMissing(pack: ServerPack): string[] {
  const missing: string[] = [];
  for (const mode of ["light", "dark"] as KitMode[]) {
    for (const icon of DESIGNED_ICON_NAMES) {
      const sitePath = designedIconSitePath(pack.id, icon, mode);
      if (!readSiteAsset(sitePath)) missing.push(sitePath);
    }
  }
  return missing;
}

/** The DESIGNED icon set: the approved emblem art for this pack —
    all 50 icons × light AND dark, the actual files from the art
    manifest (never code-drawn substitutes). Returns the site paths
    that were missing from the asset library so the bundle can say
    so honestly instead of silently shipping a partial set. */
function addDesignedIcons(
  archive: InstanceType<typeof ZipArchive>,
  pack: ServerPack,
  prefix: string,
): string[] {
  const missing: string[] = [];
  for (const mode of ["light", "dark"] as KitMode[]) {
    for (const icon of DESIGNED_ICON_NAMES) {
      const sitePath = designedIconSitePath(pack.id, icon, mode);
      const bytes = readSiteAsset(sitePath);
      if (bytes) archive.append(bytes, { name: `${prefix}icons/${icon}-${mode}.webp` });
      else missing.push(sitePath);
    }
  }
  if (missing.length > 0) {
    archive.append(
      [
        "Some designed icon files were not present in this deploy's asset library:",
        ...missing.map((m) => `- ${m}`),
        "No substitute art was generated — the designed set is the owner-approved",
        "art from the theme-pack art manifest. Re-download this kit once the",
        "asset library is complete.",
      ].join("\n"),
      { name: `${prefix}icons/ICONS-MISSING.txt` },
    );
  }
  return missing;
}

/** The pack app icons: the REAL full logo lockup composited whole
    onto the pack tile — one per mode, byte-identical to the
    approved composites. */
function addAppIcons(archive: InstanceType<typeof ZipArchive>, pack: ServerPack, prefix: string): void {
  for (const mode of ["light", "dark"] as KitMode[]) {
    const bytes = readSiteAsset(appIconSitePath(pack.id, mode));
    if (bytes) archive.append(bytes, { name: `${prefix}app-icon-${mode}.webp` });
  }
}

/** Folder icons ARE the pack's designed "files" emblem (the DESIGN
    finals from the art manifest) — shipped per mode, no code-drawn
    folder glyph. */
function addFolderIcons(archive: InstanceType<typeof ZipArchive>, pack: ServerPack, prefix: string): void {
  for (const mode of ["light", "dark"] as KitMode[]) {
    const bytes = readSiteAsset(designedIconSitePath(pack.id, "files", mode));
    if (bytes) archive.append(bytes, { name: `${prefix}folder-icon-${mode}.webp` });
  }
}

/** Build a zip bundle for one pack. ALL art ships from the approved
    library on disk — the designed icon set, the app-icon composites
    and the per-device wallpapers are resolved server-side from the
    pack's own assets, never supplied by the caller, so a download
    always carries the approved art whatever client asked for it.
    The remaining caller-supplied pieces are text builders owned by
    the FE kit module (widget art, Chrome manifest, share card).
    opts.mix is the STORED customization mix (loaded + sanitized by
    the route): the accent and wallpaper art are built from it. */
export function buildKitZip(
  pack: ServerPack,
  kind: Exclude<KitBundleKind, "windows">,
  opts: { mode: KitMode; widgetSvg?: string; chromeManifest?: string; shareCardSvg?: string; mix?: KitMix },
): InstanceType<typeof ZipArchive> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const base = `${pack.id}-${opts.mode}/`;
  const accent = resolveKitAccent(pack, opts.mode, opts.mix, "accent-color");
  const cursorAccent = resolveKitAccent(pack, opts.mode, opts.mix, "cursors");
  const defaultAccent = hslToHex(pack.colors[opts.mode].primary);
  // The stored art choices exactly as saved (kit.json records them;
  // slots resolve device → "all" when the builders place the art).
  const storedArt = (component: string): Record<string, string> => {
    const rec: Record<string, string> = {};
    for (const d of ["all", ...WALLPAPER_DEVICES.map((x) => x.id)]) {
      const id = storedKitArtId(opts.mix, component, d);
      if (id) rec[d] = id;
    }
    return rec;
  };
  const homeArt = storedArt("home-wallpapers");
  const lockArt = storedArt("lock-wallpapers");
  const mixApplied =
    accent !== defaultAccent || cursorAccent !== defaultAccent ||
    Object.keys(homeArt).length > 0 || Object.keys(lockArt).length > 0;

  /* Icon honesty (Stack-300 A4): the paperwork conditions itself on
     the missing list — a pack whose designed set has not been raised
     says so in its own bundle instead of claiming all 50 icons. */
  const iconMissing = designedIconsMissing(pack);
  const iconFilesTotal = DESIGNED_ICON_NAMES.length * 2;
  const iconFilesPresent = iconFilesTotal - iconMissing.length;
  const iconsComplete = iconMissing.length === 0;
  const folderIconMissing = (["light", "dark"] as KitMode[]).some((m) =>
    iconMissing.includes(designedIconSitePath(pack.id, "files", m)),
  );
  const iconReadmeLines = iconsComplete
    ? [
        `Icons: the designed emblem set approved for this pack — all 50 icons in light`,
        `and dark (icons/ folder), plus the pack app icon: the real Bow Down Visuals`,
        `logo lockup, whole, on the pack tile (app-icon-light/dark.webp).`,
      ]
    : iconFilesPresent === 0
      ? [
          `Icons: this pack's designed emblem set has NOT been raised yet — no icons`,
          `are included in this bundle. The icons/ folders (android/ios) carry`,
          `ICONS-MISSING.txt naming every designed file; no substitute art was`,
          `generated, because the set is owner-approved art from the theme-pack art`,
          `manifest. Re-download this kit once the set lands. The pack app icon IS`,
          `included: the real Bow Down Visuals logo lockup, whole, on the pack tile`,
          `(app-icon-light/dark.webp).`,
        ]
      : [
          `Icons: ${iconFilesPresent} of the ${iconFilesTotal} designed emblem files (50 icons × light`,
          `and dark) ship in the icons/ folder; the rest are named in`,
          `icons/ICONS-MISSING.txt — no substitute art was generated. Plus the pack`,
          `app icon: the real Bow Down Visuals logo lockup, whole, on the pack tile`,
          `(app-icon-light/dark.webp).`,
        ];

  const readme = [
    `Bow Down Visuals — ${pack.name} whole-device theme kit (${opts.mode})`,
    `Bundle: ${kind}`,
    ``,
    `One package, one price, owned forever. Every component ships in light AND dark.`,
    ...iconReadmeLines,
    `Wallpapers: this pack's clean ground art (no logo baked on), sized per device`,
    `— wallpaper-<mode>-phone/tablet/desktop.webp for home, lock-<mode>-*.webp for`,
    `the lock screen. Home and lock share the pack's approved ground art: no`,
    `separate lock scene has been approved for this pack, so none was invented.`,
    ...(mixApplied ? [
      `Customization: this kit was built FROM the saved customization mix — the`,
      `accent and the wallpaper art choices recorded in kit.json are the saved`,
      `ones, worn in the matching slots; every other slot keeps the pack ground.`,
    ] : []),
    `The whole logo ships on its own as logo-<mode>.webp.`,
    `Sounds: this pack's ringtone / notification / sound scheme ARE the site sound`,
    `library's signature set by role (single source of truth) — never per-pack copies.`,
    pack.tier === "premium" ? `Premium pack — licensed to the purchasing account.` : `Included pack — free for everyone.`,
  ].join("\n");
  archive.append(readme, { name: `${base}README.txt` });
  archive.append(JSON.stringify({
    packId: pack.id, kind, mode: opts.mode, accent,
    ...(mixApplied
      ? { customization: { source: "stored customization mix", art: { home: homeArt, lock: lockArt } } }
      : {}),
    icons: {
      source: "designed art manifest (owner-approved, Oct 25 2026)",
      count: DESIGNED_ICON_NAMES.length,
      modes: ["light", "dark"],
      names: [...DESIGNED_ICON_NAMES],
      complete: iconsComplete,
      missing: iconMissing,
    },
    appIcon: { light: appIconSitePath(pack.id, "light"), dark: appIconSitePath(pack.id, "dark") },
    wallpapers: {
      art: "pack ground — clean, no logo baked on",
      devices: WALLPAPER_DEVICES.map((d) => ({ id: d.id, width: d.width, height: d.height })),
      modes: ["light", "dark"],
      lockArt: "same approved ground art as home, sized per device (no distinct lock scene approved)",
    },
  }, null, 2), { name: `${base}kit.json` });

  if (kind === "mac" || kind === "full") {
    addWallpapers(archive, pack, `${base}mac/`, opts.mix);
    addFolderIcons(archive, pack, `${base}mac/`);
    addAppIcons(archive, pack, `${base}mac/`);
    archive.append(folderIconMissing
      ? "Set the wallpapers from System Settings > Wallpaper. Folder icons: this pack's designed folder icon (the designed 'files' emblem) has not been raised yet, so no folder icon is included in this bundle — no substitute art was generated; it arrives with the pack's designed emblem set."
      : "Set the wallpapers from System Settings > Wallpaper. Folder icons: Get Info on a folder, drag the icon file onto the icon well.", { name: `${base}mac/INSTALL.txt` });
  }
  if (kind === "android" || kind === "full") {
    addWallpapers(archive, pack, `${base}android/`, opts.mix);
    addDesignedIcons(archive, pack, `${base}android/`);
    addAppIcons(archive, pack, `${base}android/`);
    archive.append(iconsComplete
      ? "Android: apply the icons with your launcher's icon-pack import (the designed icons/ set, light and dark), set the wallpapers from the kit (wallpaper-<mode>-phone.webp for home, lock-<mode>-phone.webp for the lock screen), and set the ringtone + notification sounds from the sounds folder (the site sound library set, by role)."
      : iconFilesPresent === 0
        ? "Android: this pack's designed icon set has not been raised yet — the icons/ folder carries ICONS-MISSING.txt naming the designed files and no icons are included (no substitute art was generated), so there is no icon pack to import yet; re-download this kit once the designed set lands. Set the wallpapers from the kit (wallpaper-<mode>-phone.webp for home, lock-<mode>-phone.webp for the lock screen), and set the ringtone + notification sounds from the sounds folder (the site sound library set, by role)."
        : `Android: apply the icons with your launcher's icon-pack import (the designed icons/ set, light and dark — this bundle carries ${iconFilesPresent} of the ${iconFilesTotal} designed files; icons/ICONS-MISSING.txt names the rest and no substitute art was generated), set the wallpapers from the kit (wallpaper-<mode>-phone.webp for home, lock-<mode>-phone.webp for the lock screen), and set the ringtone + notification sounds from the sounds folder (the site sound library set, by role).`, { name: `${base}android/INSTALL.txt` });
    addSounds(archive, `${base}android/sounds/`);
  }
  if (kind === "ios" || kind === "full") {
    addWallpapers(archive, pack, `${base}ios/`, opts.mix);
    addDesignedIcons(archive, pack, `${base}ios/`);
    addAppIcons(archive, pack, `${base}ios/`);
    archive.append([
      "iPhone / iPad — honest labeling: Apple does not allow a true system theme.",
      "This kit uses Apple's own Shortcuts route: Shortcuts > + > Open App > choose the",
      ...(iconsComplete
        ? [
            "app > Share > Add to Home Screen > set the kit icon from the icons/ folder",
            "(the pack's designed set — pick the light or dark face). Repeat per app. Your",
          ]
        : [
            "app > Share > Add to Home Screen — NOTE: this pack's designed icon set is",
            "not complete in this bundle: the icons/ folder carries ICONS-MISSING.txt",
            "naming the missing designed files and no substitute art was generated, so",
            "skip the icon step until the designed set lands and you re-download this",
            "kit. Your",
          ]),
      "original apps stay in the App Library. Wallpapers set from Photos > Share >",
      "Use as Wallpaper. Ringtones install via GarageBand / Finder sync from the",
      "sounds folder (the site sound library set, by role).",
    ].join("\n"), { name: `${base}ios/GUIDED-SETUP.txt` });
    addSounds(archive, `${base}ios/sounds/`);
  }
  if (kind === "chrome" || kind === "full") {
    if (opts.chromeManifest) archive.append(opts.chromeManifest, { name: `${base}chrome/manifest.json` });
    // The NTP background is the home wallpaper's desktop face: a mix
    // still choice for home wallpapers ships here too (a living loop
    // can't be a static NTP background — the ground render ships).
    const homeDesktop = chosenKitArt(opts.mix, "home-wallpapers", "desktop");
    const wp = (homeDesktop && homeDesktop.ext === "webp" ? homeDesktop.bytes : null)
      ?? readSiteAsset(deviceWallpaperSitePath(pack.id, opts.mode, "desktop"))
      ?? readSiteAsset(pack.deviceArt[opts.mode]);
    if (wp) archive.append(wp, { name: `${base}chrome/theme-ntp-background.webp` });
    archive.append("Chrome: chrome://extensions > Developer mode > Load unpacked > select this chrome folder.", { name: `${base}chrome/INSTALL.txt` });
  }
  if (kind === "sounds" || kind === "full") {
    addSounds(archive, `${base}sounds/`);
  }
  if (kind === "full") {
    archive.append(buildCursorFile(cursorAccent, "arrow"), { name: `${base}cursors/arrow.cur` });
    archive.append(buildCursorFile(cursorAccent, "hand"), { name: `${base}cursors/hand.cur` });
    if (opts.widgetSvg) archive.append(opts.widgetSvg, { name: `${base}widget.svg` });
    if (opts.shareCardSvg) archive.append(opts.shareCardSvg, { name: `${base}share-card.svg` });
    const tp = buildThemepack(pack, opts.mode, opts.mix);
    archive.append(tp, { name: `${base}windows/${pack.id}-${opts.mode}.themepack` });
  }
  return archive;
}
