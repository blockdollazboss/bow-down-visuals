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
  { key: "phone-iphone-pro", kind: "phone", label: "iPhone Pro", width: 1206, height: 2622 },
  { key: "phone-iphone", kind: "phone", label: "iPhone", width: 1179, height: 2556 },
  { key: "phone-android-flagship", kind: "phone", label: "Android Flagship", width: 1440, height: 3120 },
  { key: "phone-android", kind: "phone", label: "Android", width: 1080, height: 2400 },
  { key: "tablet-ipad-pro", kind: "tablet", label: "iPad Pro", width: 2048, height: 2732 },
  { key: "tablet-ipad", kind: "tablet", label: "iPad", width: 1640, height: 2360 },
  { key: "tablet-ipad-mini", kind: "tablet", label: "iPad mini", width: 1488, height: 2266 },
  { key: "desktop-fhd", kind: "desktop", label: "Desktop Full HD", width: 1920, height: 1080 },
  { key: "laptop-macbook-14", kind: "desktop", label: "MacBook Pro 14\"", width: 3024, height: 1964 },
  { key: "laptop-16-10", kind: "desktop", label: "Laptop 16:10", width: 2880, height: 1800 },
  { key: "desktop-qhd", kind: "desktop", label: "Desktop QHD", width: 2560, height: 1440 },
  { key: "desktop-4k", kind: "desktop", label: "Desktop 4K", width: 3840, height: 2160 },
  { key: "desktop-5k", kind: "desktop", label: "Desktop 5K", width: 5120, height: 2880 },
  { key: "desktop-ultrawide", kind: "desktop", label: "Ultrawide", width: 3440, height: 1440 },
];

export function presetByKey(key: string): WallpaperPreset | undefined {
  return WALLPAPER_PRESETS.find((p) => p.key === key);
}
