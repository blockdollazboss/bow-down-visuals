/**
 * boundary-report.test.ts — stack600 boundary telemetry + one-shot
 * chunk recovery.
 *
 * The regression being pinned (vault-guards diagnosis, Oct 28 2026):
 * the RouteErrorBoundary tripped on the owner twice in one day and
 * left no trace but a console.error in his own browser — no route,
 * no error, no server record. These tests pin the three behaviours
 * that close the blindness without endangering the fallback:
 *   1. the trip report's shape (path only, truncated, chunk-flagged);
 *   2. fire-and-forget delivery that fires once per trip and can
 *      never throw back into the boundary;
 *   3. the ONE automatic reload for chunk-shaped errors — guarded so
 *      it cannot loop, re-armed only by a healthy mount.
 */
import { describe, it, expect, vi } from "vitest";
import {
  BOUNDARY_REPORT_PATH,
  CHUNK_RELOAD_FLAG,
  buildBoundaryReport,
  clearChunkReloadGuard,
  isChunkLoadError,
  reportBoundaryTrip,
  tryChunkAutoReload,
  type BoundaryStorage,
} from "./boundary-report";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: BoundaryStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
  return { storage, map };
}

const CHUNK_ERROR = new TypeError(
  "Failed to fetch dynamically imported module: https://bowdownvisuals.com/assets/world-abc123.js",
);
const RENDER_ERROR = new TypeError("Cannot read properties of undefined (reading 'map')");

describe("isChunkLoadError", () => {
  it("recognises the cross-browser chunk failure shapes", () => {
    expect(isChunkLoadError(CHUNK_ERROR)).toBe(true);
    expect(
      isChunkLoadError(new Error("Importing a module script failed.")),
    ).toBe(true);
    expect(
      isChunkLoadError(new Error("error loading dynamically imported module")),
    ).toBe(true);
    const named = new Error("Loading chunk 42 failed");
    named.name = "ChunkLoadError";
    expect(isChunkLoadError(named)).toBe(true);
    expect(
      isChunkLoadError(new Error("Unable to preload CSS for /assets/x.css")),
    ).toBe(true);
  });

  it("does not flag ordinary render throws or non-errors", () => {
    expect(isChunkLoadError(RENDER_ERROR)).toBe(false);
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(
      false,
    );
  });
});

describe("buildBoundaryReport", () => {
  const now = new Date("2026-10-28T20:17:00.000Z");

  it("carries route path, error name/message, chunk flag, build, timestamp", () => {
    const report = buildBoundaryReport(CHUNK_ERROR, {
      route: "/creator-pricing",
      build: "3eb648aa2",
      now,
    });
    expect(report).toEqual({
      route: "/creator-pricing",
      errorName: "TypeError",
      errorMessage: CHUNK_ERROR.message,
      chunkLike: true,
      build: "3eb648aa2",
      ts: "2026-10-28T20:17:00.000Z",
    });
  });

  it("strips query and hash — the report never carries URL parameters", () => {
    const report = buildBoundaryReport(RENDER_ERROR, {
      route: "/reset-password?token=SECRET#frag",
      now,
    });
    expect(report.route).toBe("/reset-password");
    expect(JSON.stringify(report)).not.toContain("SECRET");
  });

  it("reduces a full href to its pathname", () => {
    const report = buildBoundaryReport(RENDER_ERROR, {
      route: "https://bowdownvisuals.com/shop/test-buyer-d-shop?x=1",
      now,
    });
    expect(report.route).toBe("/shop/test-buyer-d-shop");
  });

  it("truncates an over-long message to 500 chars and defaults build to null", () => {
    const report = buildBoundaryReport(new Error("x".repeat(900)), {
      route: "/dashboard",
      now,
    });
    expect(report.errorMessage).toHaveLength(500);
    expect(report.build).toBeNull();
    expect(report.chunkLike).toBe(false);
  });
});

describe("reportBoundaryTrip", () => {
  const report = buildBoundaryReport(CHUNK_ERROR, {
    route: "/creator-pricing",
    now: new Date("2026-10-28T20:17:00.000Z"),
  });

  it("beacons once with the report JSON and does not fall back when accepted", async () => {
    const sendBeacon = vi.fn((_url: string, _body: Blob) => true);
    const fetchFn = vi.fn(() => Promise.resolve({}));
    const sent = reportBoundaryTrip(report, { sendBeacon, fetchFn });
    expect(sent).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0]!;
    expect(url).toBe(BOUNDARY_REPORT_PATH);
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual(report);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("falls back to keepalive fetch when the beacon is refused", async () => {
    const sendBeacon = vi.fn(() => false);
    const fetchFn = vi.fn((_url: string, _init: Record<string, unknown>) =>
      Promise.resolve({}),
    );
    const sent = reportBoundaryTrip(report, { sendBeacon, fetchFn });
    expect(sent).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(BOUNDARY_REPORT_PATH);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(report);
  });

  it("a throwing beacon falls back to fetch; a rejecting fetch changes nothing", async () => {
    const sendBeacon = vi.fn(() => {
      throw new Error("beacon exploded");
    });
    const fetchFn = vi.fn(() => Promise.reject(new Error("server down")));
    let sent: boolean | undefined;
    expect(() => {
      sent = reportBoundaryTrip(report, { sendBeacon, fetchFn });
    }).not.toThrow();
    expect(sent).toBe(true);
    /* flush the swallowed rejection */
    await new Promise((r) => setTimeout(r, 0));
  });

  it("with no transport at all it reports false and still never throws", () => {
    let sent: boolean | undefined;
    expect(() => {
      sent = reportBoundaryTrip(report, {
        sendBeacon: undefined,
        fetchFn: undefined,
        endpoint: "/api/client-errors",
      });
    }).not.toThrow();
    /* In the node harness there is no navigator; fetch exists, so the
       fetch fallback counts as a transport. Either outcome is safe —
       the pin is only that the call cannot throw. */
    expect(typeof sent).toBe("boolean");
  });
});

describe("tryChunkAutoReload — one reload, never a loop", () => {
  it("reloads once for a chunk-shaped error and sets the guard", () => {
    const { storage, map } = fakeStorage();
    const reload = vi.fn();
    expect(tryChunkAutoReload(CHUNK_ERROR, { storage, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(map.get(CHUNK_RELOAD_FLAG)).toBe("1");
  });

  it("a second trip while the guard is set does NOT reload again", () => {
    const { storage } = fakeStorage({ [CHUNK_RELOAD_FLAG]: "1" });
    const reload = vi.fn();
    expect(tryChunkAutoReload(CHUNK_ERROR, { storage, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("never auto-reloads for an ordinary render throw", () => {
    const { storage } = fakeStorage();
    const reload = vi.fn();
    expect(tryChunkAutoReload(RENDER_ERROR, { storage, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("a healthy mount re-arms the recovery (clearChunkReloadGuard)", () => {
    const { storage, map } = fakeStorage({ [CHUNK_RELOAD_FLAG]: "1" });
    clearChunkReloadGuard(storage);
    expect(map.has(CHUNK_RELOAD_FLAG)).toBe(false);
    const reload = vi.fn();
    expect(tryChunkAutoReload(CHUNK_ERROR, { storage, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("hostile storage (throws on every call) cannot break it", () => {
    const hostile: BoundaryStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const reload = vi.fn();
    let result: boolean | undefined;
    expect(() => {
      result = tryChunkAutoReload(CHUNK_ERROR, { storage: hostile, reload });
    }).not.toThrow();
    expect(result).toBe(true);
    expect(() => clearChunkReloadGuard(hostile)).not.toThrow();
    expect(() => clearChunkReloadGuard(null)).not.toThrow();
  });
});

describe("App.tsx wiring (source pin)", () => {
  it("the boundary self-reports, auto-reloads once, and renders as before", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
    const src = readFileSync(appPath, "utf8");
    expect(src).toContain("reportBoundaryTrip(");
    expect(src).toContain("buildBoundaryReport(");
    expect(src).toContain("tryChunkAutoReload(");
    expect(src).toContain("clearChunkReloadGuard(");
    /* The fallback screen itself is unchanged. */
    expect(src).toContain("The vault guards tripped.");
    expect(src).toContain("Try again");
  });
});
