/**
 * Smartlink retargeting pixels (migration 0186).
 *
 * Pins: shape validation mirrors the server; a landing with no pixels
 * configured arms NOTHING (no scripts, no globals); configured pixels
 * load exactly their vendor library once and fire a page view; the
 * once-per-load guard prevents double-firing on re-render.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  armedPixels,
  injectSmartlinkPixels,
  isValidPixelId,
  __resetSmartlinkPixelsForTests,
} from "./smartlink-pixels";

const NONE = { metaPixelId: null, tiktokPixelId: null, googleTagId: null };

describe("pixel ID shapes", () => {
  it("accepts real shapes and empty, refuses junk", () => {
    expect(isValidPixelId("meta", "123456789012345")).toBe(true);
    expect(isValidPixelId("meta", "12345")).toBe(false);
    expect(isValidPixelId("meta", "abc123456")).toBe(false);
    expect(isValidPixelId("tiktok", "C9ABCDEFGHIJKLMN12")).toBe(true);
    expect(isValidPixelId("tiktok", "has spaces!")).toBe(false);
    expect(isValidPixelId("google", "G-ABC123XYZ9")).toBe(true);
    expect(isValidPixelId("google", "AW-123456789")).toBe(true);
    expect(isValidPixelId("google", "12345")).toBe(false);
    expect(isValidPixelId("meta", "")).toBe(true);
    expect(isValidPixelId("meta", "   ")).toBe(true);
  });

  it("armedPixels keeps only configured, well-shaped IDs", () => {
    expect(armedPixels(null)).toEqual([]);
    expect(armedPixels(NONE)).toEqual([]);
    expect(armedPixels({ metaPixelId: "junk!!", tiktokPixelId: null, googleTagId: "G-ABC123XYZ9" }))
      .toEqual([{ kind: "google", id: "G-ABC123XYZ9" }]);
    expect(armedPixels({ metaPixelId: "123456789012345", tiktokPixelId: "C9ABCDEFGHIJKLMN12", googleTagId: null }))
      .toEqual([
        { kind: "meta", id: "123456789012345" },
        { kind: "tiktok", id: "C9ABCDEFGHIJKLMN12" },
      ]);
  });
});

/* Minimal fake DOM: scripts record their src, globals land on window. */
function installFakeDom() {
  const scripts: Array<{ src: string; async: boolean }> = [];
  const fakeWindow: Record<string, unknown> = {};
  const fakeDocument = {
    head: {
      appendChild(el: { src: string; async: boolean }) {
        scripts.push(el);
      },
    },
    createElement(_tag: string) {
      return { src: "", async: false };
    },
  };
  (globalThis as any).window = fakeWindow;
  (globalThis as any).document = fakeDocument;
  return { scripts, fakeWindow };
}

describe("injectSmartlinkPixels", () => {
  let env: ReturnType<typeof installFakeDom>;

  beforeEach(() => {
    __resetSmartlinkPixelsForTests();
    env = installFakeDom();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it("no pixels configured → nothing loads, nothing fires", () => {
    expect(injectSmartlinkPixels(NONE)).toEqual([]);
    expect(injectSmartlinkPixels(null)).toEqual([]);
    expect(env.scripts).toHaveLength(0);
    expect(env.fakeWindow.fbq).toBeUndefined();
    expect(env.fakeWindow.gtag).toBeUndefined();
    expect(env.fakeWindow.ttq).toBeUndefined();
  });

  it("meta pixel loads fbevents and fires init + PageView once", () => {
    const fired = injectSmartlinkPixels({ ...NONE, metaPixelId: "123456789012345" });
    expect(fired).toEqual(["meta"]);
    expect(env.scripts.map((s) => s.src)).toEqual(["https://connect.facebook.net/en_US/fbevents.js"]);
    const fbq = env.fakeWindow.fbq as any;
    expect(typeof fbq).toBe("function");
    expect(fbq.q).toEqual([["init", "123456789012345"], ["track", "PageView"]]);
    /* Re-render must not double-fire. */
    expect(injectSmartlinkPixels({ ...NONE, metaPixelId: "123456789012345" })).toEqual([]);
    expect(env.scripts).toHaveLength(1);
    expect(fbq.q).toHaveLength(2);
  });

  it("google tag loads gtag.js and configures the ID", () => {
    const fired = injectSmartlinkPixels({ ...NONE, googleTagId: "G-ABC123XYZ9" });
    expect(fired).toEqual(["google"]);
    expect(env.scripts.map((s) => s.src)).toEqual(["https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9"]);
    const dataLayer = env.fakeWindow.dataLayer as unknown[][];
    expect(dataLayer.some((a) => a[0] === "config" && a[1] === "G-ABC123XYZ9")).toBe(true);
  });

  it("tiktok pixel loads its library with the sdk id and queues a page view", () => {
    const fired = injectSmartlinkPixels({ ...NONE, tiktokPixelId: "C9ABCDEFGHIJKLMN12" });
    expect(fired).toEqual(["tiktok"]);
    expect(env.scripts.map((s) => s.src)).toEqual([
      "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C9ABCDEFGHIJKLMN12&lib=ttq",
    ]);
    const ttq = env.fakeWindow.ttq as any;
    expect(ttq.some((e: unknown[]) => e[0] === "page")).toBe(true);
  });

  it("all three configured → all three arm, in one call", () => {
    const fired = injectSmartlinkPixels({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
    expect(fired).toEqual(["meta", "tiktok", "google"]);
    expect(env.scripts).toHaveLength(3);
  });
});
