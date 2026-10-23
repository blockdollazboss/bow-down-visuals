/**
 * Royalty Tracker load contract (S27-43):
 * - each of the three sources (summary / platforms / payouts) is
 *   checked for HTTP success on its own — a 500 body is an ERROR
 *   payload, never data (the old loader stored it as the summary and
 *   corrupted the totals);
 * - one source failing — by HTTP status OR by a rejected fetch —
 *   degrades only that source; its siblings still load and render.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadRoyaltySources } from "./royalties-load";

const SUMMARY = {
  total: "12.34",
  totalStreams: 100,
  entryCount: 2,
  perSong: [],
  perPlatform: [],
  monthly: [],
};
const PLATFORMS = [{ key: "spotify", label: "Spotify", connected: false, connectionType: null, accountLabel: null, connectable: true }];
const PAYOUTS = [{ id: "p1", distributor: "DistroKid", period_start: "2026-01-01", period_end: "2026-01-31", expected_amount: "10.00", received_amount: null, currency: "USD", status: "expected", notes: null }];

function getter(map: Record<string, { ok: boolean; status?: number; data: Record<string, unknown> } | "reject">) {
  return vi.fn(async (path: string) => {
    const entry = map[path];
    if (entry === "reject") throw new Error("network down");
    if (!entry) throw new Error(`unexpected path ${path}`);
    return { res: { ok: entry.ok, status: entry.status ?? (entry.ok ? 200 : 500) }, data: entry.data };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadRoyaltySources — per-source settle", () => {
  it("all three sources load when all succeed", async () => {
    const get = getter({
      "/api/royalties/summary": { ok: true, data: SUMMARY as unknown as Record<string, unknown> },
      "/api/royalties/platforms": { ok: true, data: { platforms: PLATFORMS } },
      "/api/royalties/payouts": { ok: true, data: { payouts: PAYOUTS } },
    });
    const r = await loadRoyaltySources(get);
    expect(r.summary?.total).toBe("12.34");
    expect(r.platforms).toHaveLength(1);
    expect(r.payouts).toHaveLength(1);
    expect(r.summaryError).toBeNull();
    expect(r.platformsError).toBeNull();
    expect(r.payoutsError).toBeNull();
  });

  it("a 500 summary body is NOT stored as data — siblings still render", async () => {
    const get = getter({
      "/api/royalties/summary": { ok: false, status: 500, data: { error: "database exploded", total: "99999.00", entryCount: 42 } },
      "/api/royalties/platforms": { ok: true, data: { platforms: PLATFORMS } },
      "/api/royalties/payouts": { ok: true, data: { payouts: PAYOUTS } },
    });
    const r = await loadRoyaltySources(get);
    expect(r.summary).toBeNull();
    expect(r.summaryError).toContain("database exploded");
    expect(r.platforms).toHaveLength(1);
    expect(r.payouts).toHaveLength(1);
    expect(r.platformsError).toBeNull();
    expect(r.payoutsError).toBeNull();
  });

  it("a rejected summary fetch degrades only the summary", async () => {
    const get = getter({
      "/api/royalties/summary": "reject",
      "/api/royalties/platforms": { ok: true, data: { platforms: PLATFORMS } },
      "/api/royalties/payouts": { ok: true, data: { payouts: PAYOUTS } },
    });
    const r = await loadRoyaltySources(get);
    expect(r.summary).toBeNull();
    expect(r.summaryError).toContain("network down");
    expect(r.platforms).toHaveLength(1);
    expect(r.payouts).toHaveLength(1);
  });

  it("a failing platforms source leaves summary and payouts intact", async () => {
    const get = getter({
      "/api/royalties/summary": { ok: true, data: SUMMARY as unknown as Record<string, unknown> },
      "/api/royalties/platforms": { ok: false, status: 503, data: { error: "platforms down" } },
      "/api/royalties/payouts": { ok: true, data: { payouts: PAYOUTS } },
    });
    const r = await loadRoyaltySources(get);
    expect(r.summary?.entryCount).toBe(2);
    expect(r.payouts).toHaveLength(1);
    expect(r.platforms).toEqual([]);
    expect(r.platformsError).toContain("platforms down");
  });
});
