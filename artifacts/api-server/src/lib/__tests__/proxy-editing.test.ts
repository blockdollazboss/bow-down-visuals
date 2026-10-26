/**
 * proxy-editing.test.ts — board 184: proxy generation rules, preview
 * honesty, and the export relink guarantee, against an in-memory store.
 *
 * Pins: heavy-only on-demand creation (light clips get NO row), prefs
 * off blocks creation, failed rows re-queue instead of duplicating,
 * preview labels say proxy vs original plainly, and relink swaps every
 * known proxy URL back to its original (unknown URLs untouched).
 */
import { describe, expect, it } from "vitest";
import {
  assessHeaviness,
  buildProxyFfmpegArgs,
  previewSourceFor,
  proxyDimensions,
  relinkKnownProxyUrls,
  requestProxy,
  resolveExportSources,
  runProxyGeneration,
  ORIGINAL_PREVIEW_LABEL,
  PROXY_PREVIEW_LABEL,
  type ProxyMediaWire,
  type ProxyStore,
} from "../proxy-editing";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const HEAVY = { width: 3840, height: 2160, bytes: 400_000_000, durationSec: 60, codec: "h264" };
const LIGHT = { width: 1280, height: 720, bytes: 5_000_000, durationSec: 30, codec: "h264" };

function memoryStore(): ProxyStore & { rows: Map<string, ProxyMediaWire>; prefs: Map<string, boolean> } {
  const rows = new Map<string, ProxyMediaWire>();
  const prefs = new Map<string, boolean>();
  let seq = 0;
  const key = (u: string, o: string) => `${u}|${o}`;
  return {
    rows, prefs,
    async getByOriginal(userId, originalUrl) { return rows.get(key(userId, originalUrl)) ?? null; },
    async listByUser(userId, projectId) {
      return [...rows.values()].filter((r) => {
        // user isolation encoded in key prefix is not on the wire; track via map key
        return true;
      }).filter((r) => !projectId || r.project_id === projectId);
    },
    async listByProxyUrls(userId, urls) {
      return [...rows.entries()].filter(([k, r]) => k.startsWith(`${userId}|`) && r.proxy_url && urls.includes(r.proxy_url)).map(([, r]) => r);
    },
    async insertRow(userId, input) {
      const row: ProxyMediaWire = {
        id: `row-${++seq}`, project_id: input.projectId ?? null, original_url: input.originalUrl,
        proxy_url: null, original_width: input.width ?? null, original_height: input.height ?? null,
        proxy_width: null, proxy_height: null, status: "pending", is_heavy: input.isHeavy,
        heavy_reasons: input.reasons, error: null,
      };
      rows.set(key(userId, input.originalUrl), row);
      return row;
    },
    async updateRow(userId, id, patch) {
      for (const [k, r] of rows.entries()) {
        if (r.id === id && k.startsWith(`${userId}|`)) {
          const next = { ...r, ...patch };
          rows.set(k, next);
          return next;
        }
      }
      throw new Error("not found");
    },
    async getPrefsEnabled(userId) { return prefs.get(userId) ?? true; },
    async setPrefsEnabled(userId, enabled) { prefs.set(userId, enabled); },
  };
}

describe("heaviness", () => {
  it("4K is heavy; 720p small short h264 is light", () => {
    expect(assessHeaviness(HEAVY).isHeavy).toBe(true);
    expect(assessHeaviness(LIGHT).isHeavy).toBe(false);
  });
  it("size, duration and codec each trip heavy on their own", () => {
    expect(assessHeaviness({ bytes: 30_000_000 }).isHeavy).toBe(true);
    expect(assessHeaviness({ durationSec: 301 }).isHeavy).toBe(true);
    expect(assessHeaviness({ codec: "hevc" }).isHeavy).toBe(true);
    expect(assessHeaviness({}).isHeavy).toBe(false);
  });
  it("proxy dimensions cap the long edge at 854, even, never upscale", () => {
    expect(proxyDimensions(3840, 2160)).toEqual({ width: 854, height: 480 });
    expect(proxyDimensions(640, 360)).toEqual({ width: 640, height: 360 });
    expect(proxyDimensions(null, null)).toBeNull();
  });
  it("ffmpeg args use the proxy profile and the given dims", () => {
    const args = buildProxyFfmpegArgs("in.mp4", "out.mp4", { width: 854, height: 480 });
    expect(args).toContain("libx264");
    expect(args.join(" ")).toContain("scale=854:480");
    expect(args[args.length - 1]).toBe("out.mp4");
  });
});

describe("request flow — on demand only", () => {
  it("light clip: refused, NO row created", async () => {
    const store = memoryStore();
    const res = await requestProxy(store, USER_A, { originalUrl: "https://x/light.mp4", ...LIGHT });
    expect(res.outcome).toBe("not_heavy");
    expect(store.rows.size).toBe(0);
  });
  it("heavy clip: queued once; second request returns the same row", async () => {
    const store = memoryStore();
    const first = await requestProxy(store, USER_A, { originalUrl: "https://x/heavy.mp4", ...HEAVY });
    const second = await requestProxy(store, USER_A, { originalUrl: "https://x/heavy.mp4", ...HEAVY });
    expect(first.outcome).toBe("queued");
    expect(second.outcome).toBe("existing");
    expect(store.rows.size).toBe(1);
  });
  it("prefs off: disabled, no row", async () => {
    const store = memoryStore();
    await store.setPrefsEnabled(USER_A, false);
    const res = await requestProxy(store, USER_A, { originalUrl: "https://x/heavy.mp4", ...HEAVY });
    expect(res.outcome).toBe("disabled");
    expect(store.rows.size).toBe(0);
  });
  it("failed generation re-queues the same row, no duplicate", async () => {
    const store = memoryStore();
    const q = await requestProxy(store, USER_A, { originalUrl: "https://x/heavy.mp4", ...HEAVY });
    if (q.outcome !== "queued") throw new Error("expected queued");
    await runProxyGeneration(store, USER_A, q.row.id, async () => { throw new Error("ffmpeg died"); });
    const again = await requestProxy(store, USER_A, { originalUrl: "https://x/heavy.mp4", ...HEAVY });
    expect(again.outcome).toBe("queued");
    expect(store.rows.size).toBe(1);
  });
  it("successful generation marks ready with the proxy URL", async () => {
    const store = memoryStore();
    const q = await requestProxy(store, USER_A, { originalUrl: "https://x/heavy.mp4", ...HEAVY });
    if (q.outcome !== "queued") throw new Error("expected queued");
    const done = await runProxyGeneration(store, USER_A, q.row.id, async () => ({ proxyUrl: "https://cdn/proxies/row-1.mp4", proxyWidth: 854, proxyHeight: 480 }));
    expect(done.status).toBe("ready");
    expect(done.proxy_url).toBe("https://cdn/proxies/row-1.mp4");
  });
});

describe("preview honesty + relink guarantee", () => {
  const readyRow: ProxyMediaWire = {
    id: "r1", project_id: null, original_url: "https://x/orig.mp4", proxy_url: "https://cdn/proxy.mp4",
    original_width: 3840, original_height: 2160, proxy_width: 854, proxy_height: 480,
    status: "ready", is_heavy: true, heavy_reasons: [], error: null,
  };
  it("ready proxy + prefs on: preview is the proxy, labelled as proxy", () => {
    const p = previewSourceFor(readyRow, readyRow.original_url, true);
    expect(p).toEqual({ url: "https://cdn/proxy.mp4", is_proxy: true, label: PROXY_PREVIEW_LABEL });
    expect(PROXY_PREVIEW_LABEL).toContain("Export always uses the full-res original");
  });
  it("prefs off or not ready: preview is the original, labelled as original", () => {
    expect(previewSourceFor(readyRow, readyRow.original_url, false).is_proxy).toBe(false);
    expect(previewSourceFor({ ...readyRow, status: "generating", proxy_url: null }, readyRow.original_url, true))
      .toEqual({ url: readyRow.original_url, is_proxy: false, label: ORIGINAL_PREVIEW_LABEL });
    expect(previewSourceFor(null, readyRow.original_url, true).is_proxy).toBe(false);
  });
  it("relink swaps known proxies back, leaves everything else untouched", () => {
    const out = relinkKnownProxyUrls(["https://cdn/proxy.mp4", "https://x/other.mp4"], [readyRow]);
    expect(out).toEqual({ urls: ["https://x/orig.mp4", "https://x/other.mp4"], relinked: 1 });
  });
  it("resolveExportSources is user-scoped: another user's proxy URL is not relinked for me", async () => {
    const store = memoryStore();
    const q = await requestProxy(store, USER_B, { originalUrl: "https://x/b-orig.mp4", ...HEAVY });
    if (q.outcome !== "queued") throw new Error("expected queued");
    await runProxyGeneration(store, USER_B, q.row.id, async () => ({ proxyUrl: "https://cdn/b-proxy.mp4", proxyWidth: 854, proxyHeight: 480 }));
    const mine = await resolveExportSources(store, USER_A, ["https://cdn/b-proxy.mp4"]);
    expect(mine.relinked).toBe(0);
    const theirs = await resolveExportSources(store, USER_B, ["https://cdn/b-proxy.mp4"]);
    expect(theirs).toEqual({ urls: ["https://x/b-orig.mp4"], relinked: 1 });
  });
});
