export type WallpaperKind = "phone" | "tablet" | "desktop";

export interface WallpaperPreset {
  key: string;
  kind: WallpaperKind;
  label: string;
  width: number;
  height: number;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { key: "phone-iphone-promax", kind: "phone", label: "iPhone Pro Max", width: 1320, height: 2868 },
  { key: "phone-iphone", kind: "phone", label: "iPhone", width: 1179, height: 2556 },
  { key: "phone-android-flagship", kind: "phone", label: "Android Flagship", width: 1440, height: 3120 },
  { key: "phone-android", kind: "phone", label: "Android", width: 1080, height: 2400 },
  { key: "tablet-ipad-pro", kind: "tablet", label: "iPad Pro", width: 2048, height: 2732 },
  { key: "tablet-ipad", kind: "tablet", label: "iPad", width: 1640, height: 2360 },
  { key: "desktop-fhd", kind: "desktop", label: "Desktop Full HD", width: 1920, height: 1080 },
  { key: "desktop-qhd", kind: "desktop", label: "Desktop QHD", width: 2560, height: 1440 },
  { key: "desktop-4k", kind: "desktop", label: "Desktop 4K", width: 3840, height: 2160 },
  { key: "desktop-ultrawide", kind: "desktop", label: "Ultrawide", width: 3440, height: 1440 },
];

export function presetByKey(key: string): WallpaperPreset | undefined {
  return WALLPAPER_PRESETS.find((p) => p.key === key);
}
