import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { isAndroidDevice } from "./android-promo";
import { isIOSDevice } from "./ios-promo";

/**
 * QC-200 pre-proof — Q192 (PWA) + Q193 (/app device classes).
 * Code core only: manifest + service-worker + install-prompt contracts,
 * and the pure device-classification functions incl. the iPadOS
 * desktop-UA case. Whether a WebAPK actually lands in an Android app
 * drawer and per-class rendering on real hardware stay OWNER-WALK.
 */

const pub = (p: string) => new URL(`../../public/${p}`, import.meta.url);
const readPub = (p: string) => readFileSync(pub(p), "utf8");
const readSrc = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const origNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function setNavigator(ua: string, maxTouchPoints?: number) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: ua, ...(maxTouchPoints !== undefined ? { maxTouchPoints } : {}) },
    configurable: true,
  });
}
afterEach(() => {
  if (origNavigator) Object.defineProperty(globalThis, "navigator", origNavigator);
});

describe("Q193 device classification (pure functions)", () => {
  it("Android UA → android true, iOS false", () => {
    setNavigator("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36");
    expect(isAndroidDevice()).toBe(true);
    expect(isIOSDevice()).toBe(false);
  });
  it("iPhone UA → iOS true, android false", () => {
    setNavigator("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1");
    expect(isIOSDevice()).toBe(true);
    expect(isAndroidDevice()).toBe(false);
  });
  it("legacy iPad UA → iOS true", () => {
    setNavigator("Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1");
    expect(isIOSDevice()).toBe(true);
  });
  it("iPadOS desktop UA (Macintosh + maxTouchPoints>1) → iOS true", () => {
    setNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", 5);
    expect(isIOSDevice()).toBe(true);
    expect(isAndroidDevice()).toBe(false);
  });
  it("real Mac desktop UA (Macintosh, maxTouchPoints 0) → both false", () => {
    setNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", 0);
    expect(isIOSDevice()).toBe(false);
    expect(isAndroidDevice()).toBe(false);
  });
  it("Windows desktop UA → both false", () => {
    setNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36");
    expect(isIOSDevice()).toBe(false);
    expect(isAndroidDevice()).toBe(false);
  });
});

describe("Q193 /app cards: every card carries Install + Download slots", () => {
  const app = readSrc("pages/app.tsx");
  it("exactly 8 labelled ActionSlots (4 cards x Install+Download), in Install-first order per card", () => {
    const labels = [...app.matchAll(/<ActionSlot label=\{t\("appPage\.(installLabel|downloadLabel)"\)\}/g)].map((m) => m[1]);
    expect(labels).toEqual([
      "installLabel", "downloadLabel",
      "installLabel", "downloadLabel",
      "installLabel", "downloadLabel",
      "installLabel", "downloadLabel",
    ]);
  });
  it("slots with no real file render the honest NoFileNote (iPhone + Desktop downloads only)", () => {
    expect(app.match(/<NoFileNote /g)?.length).toBe(2);
    expect(app).toContain('t("appPage.iosNoFile")');
    expect(app).toContain('t("appPage.desktopNoFile")');
  });
  it("real download slots point at the real artifacts (APK + extension zip)", () => {
    expect(app).toContain("APP_DOWNLOADS.android.url");
    expect(app).toContain("APP_DOWNLOADS.extension.url");
  });
  it("device classes drive the page (hot card + headline action)", () => {
    expect(app).toContain("isAndroidDevice()");
    expect(app).toContain("isIOSDevice()");
  });
});

describe("Q192 PWA manifest contract", () => {
  const manifest = JSON.parse(readPub("manifest.json"));
  it("identity + standalone display + root scope/start", () => {
    expect(manifest.name).toBe("Thy Cheat Code");
    expect(manifest.short_name).toBe("Thy Cheat Code");
    expect(manifest.display).toBe("standalone");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
  });
  it("icons: 192/512 `any` + 192/512 `maskable`, and every icon file exists in public/", () => {
    const byKey = Object.fromEntries(manifest.icons.map((i: any) => [`${i.sizes}:${i.purpose}`, i.src]));
    expect(byKey["192x192:any"]).toBe("/icon-192.png");
    expect(byKey["512x512:any"]).toBe("/icon-512.png");
    expect(byKey["192x192:maskable"]).toBe("/icon-maskable-192.png");
    expect(byKey["512x512:maskable"]).toBe("/icon-maskable-512.png");
    for (const icon of manifest.icons) {
      expect(existsSync(pub(icon.src.replace(/^\//, ""))), icon.src).toBe(true);
    }
  });
});

describe("Q192 service worker + install prompt contract", () => {
  it("main.tsx registers /sw.js in PROD only", () => {
    const main = readSrc("main.tsx");
    expect(main).toContain("import.meta.env.PROD");
    expect(main).toContain('navigator.serviceWorker.register("/sw.js")');
  });
  it("sw.js has install/activate/fetch handlers and caches the app shell", () => {
    const sw = readPub("sw.js");
    for (const evt of ["install", "activate", "fetch"]) {
      expect(sw).toContain(`self.addEventListener("${evt}"`);
    }
    for (const shell of ['"/"', '"/index.html"', '"/manifest.json"', '"/icon-192.png"', '"/icon-512.png"']) {
      expect(sw).toContain(shell);
    }
  });
  it("beforeinstallprompt is captured app-wide and promptInstall() fires evt.prompt()/userChoice", () => {
    const ext = readSrc("lib/extension-promo.ts");
    expect(ext).toContain('window.addEventListener("beforeinstallprompt"');
    expect(ext).toContain("export function usePwaInstall()");
    expect(ext).toContain("evt.prompt()");
    expect(ext).toContain("userChoice");
  });
  it("/app Install button calls promptInstall() through usePwaInstall", () => {
    const app = readSrc("pages/app.tsx");
    expect(app).toContain("usePwaInstall()");
    expect(app).toContain("await promptInstall()");
  });
});
