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

   ART: wallpaper bytes resolve from the approved library only — the
   frontend public/wallpapers/ tree (pack grounds + King's Set stills
   and living loops). Asset roots can be overridden with
   THEME_KIT_ASSET_DIR (used by tests with fixtures). */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ZipArchive } from "archiver";

export type KitMode = "light" | "dark";

export interface ServerPack {
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
];

export function serverPackById(id: string): ServerPack | undefined {
  return SERVER_PACKS.find((p) => p.id === id);
}

/* ─── Sound library (single source of truth, by role) ───────────────── */

export const SOUND_ROLES = [
  "notification", "message", "success", "error", "royal-sting", "ringtone",
] as const;
export type SoundRoleName = (typeof SOUND_ROLES)[number];

/** The library file name for a role — manifest name, shared by site,
    app, extension, World and every theme pack. */
export function soundLibraryFileName(role: SoundRoleName): string {
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

/* ─── Asset resolution (approved library on disk) ───────────────────── */

export function assetRoots(): string[] {
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

export function buildWindowsThemeText(pack: ServerPack, mode: KitMode): string {
  const accent = hslToHex(pack.colors[mode].primary).replace("#", "");
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
    (approved library bytes, branded lockup already on pack grounds),
    pack cursors, and the LIBRARY sound files under manifest names. */
export function buildThemepack(pack: ServerPack, mode: KitMode): Buffer {
  const files: CabFile[] = [
    { name: `${pack.id}-${mode}.theme`, data: Buffer.from(buildWindowsThemeText(pack, mode), "utf8") },
  ];
  const wallpaper = readSiteAsset(pack.deviceArt[mode]);
  if (wallpaper) files.push({ name: "wallpaper.webp", data: wallpaper });
  const logo = readSiteAsset(mode === "dark" ? "/logo-static.webp" : "/logo-light.webp");
  if (logo) files.push({ name: "logo.webp", data: logo });
  const accent = hslToHex(pack.colors[mode].primary);
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

function addWallpapers(archive: InstanceType<typeof ZipArchive>, pack: ServerPack, prefix: string): void {
  for (const mode of ["light", "dark"] as KitMode[]) {
    const bytes = readSiteAsset(pack.deviceArt[mode]);
    if (bytes) archive.append(bytes, { name: `${prefix}wallpaper-${mode}.webp` });
    const logo = readSiteAsset(mode === "dark" ? "/logo-static.webp" : "/logo-light.webp");
    if (logo) archive.append(logo, { name: `${prefix}logo-${mode}.webp` });
  }
  // Approved living loops + screensaver (King's Set library pieces).
  for (const loop of ["kings-set-throne-loop.mp4", "kings-set-plaza-loop.mp4", "kings-set-stage-loop.mp4"]) {
    const bytes = readSiteAsset(`/wallpapers/${loop}`);
    if (bytes) archive.append(bytes, { name: `${prefix}living/${loop}` });
  }
}

/** Build a zip bundle for one pack. `iconSvgs` are supplied by the
    caller (the FE-generated per-pack glyph set is mirrored by the
    route from its own server-side SVG strings — see routes/theme-kit
    ICON_SVG_SOURCE note) — to keep ONE glyph source, the route passes
    rendered SVGs in; when absent, the bundle carries the icon
    manifest so the desk's client-side export can fill them. */
export function buildKitZip(
  pack: ServerPack,
  kind: Exclude<KitBundleKind, "windows">,
  opts: { mode: KitMode; iconSvgs?: Record<string, string>; folderSvg?: string; widgetSvg?: string; chromeManifest?: string; shareCardSvg?: string },
): InstanceType<typeof ZipArchive> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const base = `${pack.id}-${opts.mode}/`;
  const accent = hslToHex(pack.colors[opts.mode].primary);

  const readme = [
    `Bow Down Visuals — ${pack.name} whole-device theme kit (${opts.mode})`,
    `Bundle: ${kind}`,
    ``,
    `One package, one price, owned forever. Every component ships in light AND dark.`,
    `Sounds: this pack's ringtone / notification / sound scheme ARE the site sound`,
    `library's signature set by role (single source of truth) — never per-pack copies.`,
    pack.tier === "premium" ? `Premium pack — licensed to the purchasing account.` : `Included pack — free for everyone.`,
  ].join("\n");
  archive.append(readme, { name: `${base}README.txt` });
  archive.append(JSON.stringify({ packId: pack.id, kind, mode: opts.mode, accent }, null, 2), { name: `${base}kit.json` });

  if (kind === "mac" || kind === "full") {
    addWallpapers(archive, pack, `${base}mac/`);
    if (opts.folderSvg) archive.append(opts.folderSvg, { name: `${base}mac/folder-icon.svg` });
    archive.append("Set the wallpapers from System Settings > Wallpaper. Folder icons: Get Info on a folder, drag the icon file onto the icon well.", { name: `${base}mac/INSTALL.txt` });
  }
  if (kind === "android" || kind === "full") {
    addWallpapers(archive, pack, `${base}android/`);
    if (opts.iconSvgs) {
      for (const [name, svg] of Object.entries(opts.iconSvgs)) {
        archive.append(svg, { name: `${base}android/icons/${name}.svg` });
      }
    }
    archive.append("Android: apply the icons with your launcher's icon-pack import (SVG set), set wallpaper-home.webp / wallpaper-lock from the kit, and set the ringtone + notification sounds from the sounds folder (the site sound library set, by role).", { name: `${base}android/INSTALL.txt` });
    addSounds(archive, `${base}android/sounds/`);
  }
  if (kind === "ios" || kind === "full") {
    addWallpapers(archive, pack, `${base}ios/`);
    if (opts.iconSvgs) {
      for (const [name, svg] of Object.entries(opts.iconSvgs)) {
        archive.append(svg, { name: `${base}ios/icons/${name}.svg` });
      }
    }
    archive.append([
      "iPhone / iPad — honest labeling: Apple does not allow a true system theme.",
      "This kit uses Apple's own Shortcuts route: Shortcuts > + > Open App > choose the",
      "app > Share > Add to Home Screen > set the kit icon. Repeat per app. Your",
      "original apps stay in the App Library. Wallpapers set from Photos > Share >",
      "Use as Wallpaper. Ringtones install via GarageBand / Finder sync from the",
      "sounds folder (the site sound library set, by role).",
    ].join("\n"), { name: `${base}ios/GUIDED-SETUP.txt` });
    addSounds(archive, `${base}ios/sounds/`);
  }
  if (kind === "chrome" || kind === "full") {
    if (opts.chromeManifest) archive.append(opts.chromeManifest, { name: `${base}chrome/manifest.json` });
    const wp = readSiteAsset(pack.deviceArt[opts.mode]);
    if (wp) archive.append(wp, { name: `${base}chrome/theme-ntp-background.webp` });
    archive.append("Chrome: chrome://extensions > Developer mode > Load unpacked > select this chrome folder.", { name: `${base}chrome/INSTALL.txt` });
  }
  if (kind === "sounds" || kind === "full") {
    addSounds(archive, `${base}sounds/`);
  }
  if (kind === "full") {
    const accentHex = accent;
    archive.append(buildCursorFile(accentHex, "arrow"), { name: `${base}cursors/arrow.cur` });
    archive.append(buildCursorFile(accentHex, "hand"), { name: `${base}cursors/hand.cur` });
    if (opts.widgetSvg) archive.append(opts.widgetSvg, { name: `${base}widget.svg` });
    if (opts.shareCardSvg) archive.append(opts.shareCardSvg, { name: `${base}share-card.svg` });
    const tp = buildThemepack(pack, opts.mode);
    archive.append(tp, { name: `${base}windows/${pack.id}-${opts.mode}.themepack` });
  }
  return archive;
}
