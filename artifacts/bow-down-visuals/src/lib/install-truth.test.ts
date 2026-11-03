/**
 * Install-truth pins — the installable surface a real phone/desktop
 * meets: the web manifest's icons exist at their declared sizes, the
 * service worker cannot pin mutable engine glue the way the old
 * immutable HTTP rule pinned rvm-worker.js, a rotated push
 * subscription is answered, an offline open lands on a designed page,
 * and the floating install card rides the one shared install state
 * instead of a private, spendable copy of the prompt event.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const publicFile = (name: string) => new URL(`../../public/${name}`, import.meta.url);
const swSource = readFileSync(publicFile("sw.js"), "utf8");
const manifest = JSON.parse(readFileSync(publicFile("manifest.json"), "utf8"));

function pngSize(name: string): { width: number; height: number } {
  const buf = readFileSync(publicFile(name));
  // PNG IHDR: width/height are big-endian uint32 at bytes 16 and 20.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("web manifest — icons exist at their declared sizes", () => {
  it("carries the installability basics", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
  });

  it("every icon file exists and its pixels match the declared sizes", () => {
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    for (const icon of manifest.icons) {
      const file = String(icon.src).replace(/^\//, "");
      expect(existsSync(publicFile(file)), `${icon.src} exists`).toBe(true);
      const [w, h] = String(icon.sizes).split("x").map(Number);
      const actual = pngSize(file);
      expect(actual.width, `${icon.src} width`).toBe(w);
      expect(actual.height, `${icon.src} height`).toBe(h);
    }
  });

  it("offers a 512 any-purpose and a 512 maskable icon", () => {
    const has = (purpose: string, sizes: string) =>
      manifest.icons.some((i: any) => i.purpose === purpose && i.sizes === sizes);
    expect(has("any", "512x512")).toBe(true);
    expect(has("maskable", "512x512")).toBe(true);
    expect(has("maskable", "192x192")).toBe(true);
  });

  it("the apple touch icon is a real 180x180", () => {
    expect(pngSize("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });
});

describe("service worker — cache policy mirrors the server's", () => {
  it("cache version carries the v6 purge bump", () => {
    // v6 deletes the v5 caches on activate — they hold engine glue
    // pinned by the old blanket cache-first rule.
    expect(swSource).toContain('const CACHE_VERSION = "bdv-v6"');
  });

  it("engine glue is classified and handled BEFORE the cache-first branch", () => {
    expect(swSource).toContain("function isEngineGlue(url)");
    const glueBranch = swSource.indexOf("if (isEngineGlue(url))");
    const cacheFirstBranch = swSource.indexOf('url.pathname.startsWith("/assets/")');
    expect(glueBranch).toBeGreaterThan(-1);
    expect(cacheFirstBranch).toBeGreaterThan(-1);
    expect(glueBranch).toBeLessThan(cacheFirstBranch);
  });

  it("only a good page can become the cached offline shell", () => {
    const shellPut = swSource.indexOf('c.put("/index.html", copy)');
    const guard = swSource.lastIndexOf("if (res.ok)", shellPut);
    expect(shellPut).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
  });
});

describe("service worker — push rotation and offline honesty", () => {
  it("answers pushsubscriptionchange and can fetch the public VAPID key", () => {
    expect(swSource).toContain('addEventListener("pushsubscriptionchange"');
    expect(swSource).toContain('fetch("/api/push/config")');
  });

  it("precaches the offline page and serves it on the shell-miss path", () => {
    expect(swSource).toContain('"/offline.html"');
    expect(swSource).toContain('caches.match("/offline.html")');
  });

  it("the offline page is self-contained and says what's wrong", () => {
    const html = readFileSync(publicFile("offline.html"), "utf8");
    expect(html).toContain("You're offline");
    expect(html).toContain("/icon-192.png");
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe("floating install card — one shared install state", () => {
  const cardSource = readFileSync(new URL("../components/PWAInstallPrompt.tsx", import.meta.url), "utf8");

  it("renders from usePwaInstall, never its own prompt capture", () => {
    expect(cardSource).toContain("usePwaInstall");
    expect(cardSource).not.toContain('addEventListener("beforeinstallprompt"');
    expect(cardSource).not.toContain("deferred.prompt()");
  });

  it("keeps its standing dismissal memory", () => {
    expect(cardSource).toContain("bdv-pwa-dismissed");
  });

  it("remembers a dismissal for 30 days, then may ask again (stack1400 #16)", () => {
    // Timestamped dismissal through the shared helper — never the old
    // permanent bare "1" written straight to localStorage.
    expect(cardSource).toContain("isPromptDismissed");
    expect(cardSource).toContain("recordPromptDismissal");
    expect(cardSource).not.toContain('setItem("bdv-pwa-dismissed", "1")');
  });
});

describe("push opt-in prompt — dismissal memory (stack1400 #16)", () => {
  const pushSource = readFileSync(new URL("../components/PushOptInPrompt.tsx", import.meta.url), "utf8");

  it("keeps its per-context dismissal keys", () => {
    expect(pushSource).toContain("bdv_push_prompt_dismissed:");
  });

  it("remembers a dismissal for 30 days, then may ask again", () => {
    expect(pushSource).toContain("isPromptDismissed");
    expect(pushSource).toContain("recordPromptDismissal");
    expect(pushSource).not.toContain('"1")');
  });
});
