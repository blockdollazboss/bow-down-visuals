/**
 * Crownfall Run — prestige/meta adapter tests (v2).
 *
 * The adapter is the single seam between the game and persistence
 * (device storage as the cache/fallback; the account as the home
 * since join19 — see the persistence note in crownfall-meta.ts,
 * and the account-sync suite at the bottom of this file). These
 * tests pin
 * the RULES that must hold wherever the data lives:
 * - prestige math per tier, hard-capped at tier 10;
 * - prestige never inflates score inputs — the coin bonus yields
 *   SCRIP, and the score conversion (component) reads only the
 *   regular purse; here we pin that the bounty is scrip-sized and
 *   claimable once per day;
 * - achievements: First Crown / Centurion / Deep Diver / Prestigious;
 * - recording a run folds kills/depth/bosses into lifetime totals.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CROWNFALL_META_DEFAULTS,
  PRESTIGE_TIER_CAP,
  ROYAL_BOUNTY_SCRIP,
  achievementsEarnedBy,
  claimPrestigeTier,
  claimRoyalBounty,
  loadCrownfallMeta,
  prestigeCoinChance,
  prestigeDamageMult,
  recordRunInMeta,
  type CrownfallMeta,
} from "./crownfall-meta";

const meta = (over: Partial<CrownfallMeta> = {}): CrownfallMeta => ({
  ...CROWNFALL_META_DEFAULTS,
  achievements: [],
  ...over,
});

describe("prestige math", () => {
  it("+5% bolt damage per tier, capped at tier 10 (×1.5)", () => {
    expect(prestigeDamageMult(0)).toBe(1);
    expect(prestigeDamageMult(1)).toBeCloseTo(1.05);
    expect(prestigeDamageMult(5)).toBeCloseTo(1.25);
    expect(prestigeDamageMult(10)).toBeCloseTo(1.5);
    expect(prestigeDamageMult(99)).toBeCloseTo(1.5); /* the stack caps */
  });

  it("+10% coin-drop chance per tier, capped at tier 10 (100%)", () => {
    expect(prestigeCoinChance(0)).toBe(0);
    expect(prestigeCoinChance(3)).toBeCloseTo(0.3);
    expect(prestigeCoinChance(10)).toBeCloseTo(1);
    expect(prestigeCoinChance(42)).toBeCloseTo(1);
  });

  it("claiming a tier adds exactly one and stops at the cap", () => {
    expect(claimPrestigeTier(meta()).tier).toBe(1);
    expect(claimPrestigeTier(meta({ tier: 9 })).tier).toBe(10);
    const maxed = meta({ tier: PRESTIGE_TIER_CAP });
    expect(claimPrestigeTier(maxed)).toBe(maxed); /* no-op at the cap */
  });

  it("claiming the first tier also earns Prestigious", () => {
    expect(claimPrestigeTier(meta()).achievements).toContain("prestigious");
    const again = claimPrestigeTier(meta({ tier: 1, achievements: ["prestigious"] }));
    expect(again.achievements.filter((a) => a === "prestigious")).toHaveLength(1);
  });
});

describe("royal bounty (scrip, once a day)", () => {
  it("grants +50 scrip on a fresh day and stamps the day", () => {
    const { granted, meta: next } = claimRoyalBounty(meta(), "2026-11-10");
    expect(granted).toBe(ROYAL_BOUNTY_SCRIP);
    expect(granted).toBe(50);
    expect(next.lastBountyDay).toBe("2026-11-10");
  });

  it("grants nothing twice in one day, then again the next", () => {
    const first = claimRoyalBounty(meta(), "2026-11-10");
    const second = claimRoyalBounty(first.meta, "2026-11-10");
    expect(second.granted).toBe(0);
    const tomorrow = claimRoyalBounty(first.meta, "2026-11-11");
    expect(tomorrow.granted).toBe(50);
  });
});

describe("achievements", () => {
  it("First Crown: any boss kill, this run or lifetime", () => {
    expect(achievementsEarnedBy(meta(), { kills: 3, depth: 5, bossKills: 1 })).toContain("first-crown");
    expect(achievementsEarnedBy(meta(), { kills: 3, depth: 4, bossKills: 0 })).not.toContain("first-crown");
    expect(achievementsEarnedBy(meta({ lifetimeBossKills: 1 }), { kills: 0, depth: 1, bossKills: 0 })).toContain("first-crown");
  });

  it("Centurion: 100 lifetime kills, counting the run just played", () => {
    expect(achievementsEarnedBy(meta({ lifetimeKills: 87 }), { kills: 12, depth: 2, bossKills: 0 })).not.toContain("centurion");
    expect(achievementsEarnedBy(meta({ lifetimeKills: 87 }), { kills: 13, depth: 2, bossKills: 0 })).toContain("centurion");
  });

  it("Deep Diver: reach floor 10 in one run", () => {
    expect(achievementsEarnedBy(meta(), { kills: 0, depth: 9, bossKills: 0 })).not.toContain("deep-diver");
    expect(achievementsEarnedBy(meta(), { kills: 0, depth: 10, bossKills: 0 })).toContain("deep-diver");
  });

  it("already-earned achievements are never re-earned", () => {
    const done = meta({ achievements: ["first-crown", "centurion", "deep-diver", "prestigious"], lifetimeKills: 500, tier: 3 });
    expect(achievementsEarnedBy(done, { kills: 60, depth: 12, bossKills: 2 })).toEqual([]);
  });
});

describe("recording a run", () => {
  it("folds the run into lifetime totals and stamps new achievements", () => {
    const next = recordRunInMeta(meta({ lifetimeKills: 90 }), { kills: 15, depth: 10, bossKills: 1 });
    expect(next.lifetimeKills).toBe(105);
    expect(next.lifetimeBossKills).toBe(1);
    expect(next.bestDepth).toBe(10);
    expect(next.achievements).toEqual(expect.arrayContaining(["first-crown", "centurion", "deep-diver"]));
  });

  it("best depth never goes backwards", () => {
    const next = recordRunInMeta(meta({ bestDepth: 12 }), { kills: 1, depth: 3, bossKills: 0 });
    expect(next.bestDepth).toBe(12);
  });
});

describe("the adapter itself", () => {
  it("loads sane defaults with no storage available (node)", () => {
    const loaded = loadCrownfallMeta();
    expect(loaded.tier).toBeGreaterThanOrEqual(0);
    expect(loaded.tier).toBeLessThanOrEqual(PRESTIGE_TIER_CAP);
    expect(Array.isArray(loaded.achievements)).toBe(true);
  });
});

/* ─── account sync (join19 — the server home, migration 0336) ────────
   Each test gets a FRESH adapter module (vi.resetModules) so the
   in-memory copy, token seam and sync state start clean — a second
   module instance is a second device. The fake server below is the
   account: it stores what PUT sends and serves it back on GET,
   folding monotonically like the real route. */
describe("account sync", () => {
  const DEFAULTS_BODY = {
    tier: 0, lifetimeKills: 0, lifetimeBossKills: 0, bestDepth: 0,
    achievements: [] as string[], lastBountyDay: "",
  };

  function fakeServer(initial: Record<string, unknown> | null = null) {
    let stored: Record<string, unknown> | null = initial;
    const fold = (a: any, b: any) => ({
      tier: Math.max(a.tier, b.tier),
      lifetimeKills: Math.max(a.lifetimeKills, b.lifetimeKills),
      lifetimeBossKills: Math.max(a.lifetimeBossKills, b.lifetimeBossKills),
      bestDepth: Math.max(a.bestDepth, b.bestDepth),
      achievements: [...new Set([...a.achievements, ...b.achievements])],
      lastBountyDay: a.lastBountyDay > b.lastBountyDay ? a.lastBountyDay : b.lastBountyDay,
    });
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") {
        stored = fold(stored ?? DEFAULTS_BODY, JSON.parse(init.body ?? "{}"));
        return { ok: true, status: 200, json: async () => ({ meta: stored }) };
      }
      return { ok: true, status: 200, json: async () => ({ meta: stored ?? DEFAULTS_BODY }) };
    });
    return { fetchMock, get stored() { return stored; } };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("save → account → a fresh device reloads with the tier intact", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetchMock);

    vi.resetModules();
    const deviceA = await import("./crownfall-meta");
    deviceA.configureCrownfallMetaAuth(async () => "tok");
    deviceA.saveCrownfallMeta({
      tier: 2, lifetimeKills: 137, lifetimeBossKills: 1, bestDepth: 6,
      achievements: ["first-crown"], lastBountyDay: "2026-11-10",
    });
    await vi.waitFor(() => expect(deviceA.getCrownfallMetaSyncState()).toBe("synced"));
    expect(server.stored?.["tier"]).toBe(2);

    /* a brand-new device: empty local copy, same account */
    vi.resetModules();
    const deviceB = await import("./crownfall-meta");
    expect(deviceB.loadCrownfallMeta().tier).toBe(0);
    deviceB.configureCrownfallMetaAuth(async () => "tok");
    const merged = await deviceB.syncCrownfallMetaFromServer();
    expect(merged.tier).toBe(2);
    expect(merged.lifetimeKills).toBe(137);
    expect(merged.achievements).toEqual(["first-crown"]);
    expect(deviceB.loadCrownfallMeta().tier).toBe(2); /* adopted locally */
    expect(deviceB.getCrownfallMetaSyncState()).toBe("synced");
  });

  it("a failed save surfaces as error — the device copy stands, never dressed as synced", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "PUT") return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ meta: DEFAULTS_BODY }) };
    }));
    vi.resetModules();
    const mod = await import("./crownfall-meta");
    mod.configureCrownfallMetaAuth(async () => "tok");
    mod.saveCrownfallMeta({
      tier: 1, lifetimeKills: 40, lifetimeBossKills: 0, bestDepth: 3,
      achievements: [], lastBountyDay: "",
    });
    await vi.waitFor(() => expect(mod.getCrownfallMetaSyncState()).toBe("error"));
    expect(mod.loadCrownfallMeta().tier).toBe(1); /* device copy intact */
  });

  it("signed out: no fetch, no fake sync claim — device-only stays idle", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const mod = await import("./crownfall-meta");
    mod.configureCrownfallMetaAuth(async () => null);
    mod.saveCrownfallMeta({
      tier: 1, lifetimeKills: 5, lifetimeBossKills: 0, bestDepth: 1,
      achievements: [], lastBountyDay: "",
    });
    const merged = await mod.syncCrownfallMetaFromServer();
    expect(merged.tier).toBe(1);
    expect(mod.getCrownfallMetaSyncState()).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("two devices converge: account tier + device kills fold together and upload", async () => {
    const server = fakeServer({
      tier: 3, lifetimeKills: 500, lifetimeBossKills: 4, bestDepth: 9,
      achievements: ["first-crown"], lastBountyDay: "2026-11-09",
    });
    vi.stubGlobal("fetch", server.fetchMock);
    vi.resetModules();
    const mod = await import("./crownfall-meta");
    /* this device played offline before the seam was configured */
    mod.saveCrownfallMeta({
      tier: 1, lifetimeKills: 900, lifetimeBossKills: 4, bestDepth: 2,
      achievements: ["centurion"], lastBountyDay: "",
    });
    mod.configureCrownfallMetaAuth(async () => "tok");
    const merged = await mod.syncCrownfallMetaFromServer();
    expect(merged.tier).toBe(3);
    expect(merged.lifetimeKills).toBe(900);
    expect(merged.bestDepth).toBe(9);
    expect(merged.achievements).toEqual(expect.arrayContaining(["first-crown", "centurion"]));
    expect(server.stored?.["lifetimeKills"]).toBe(900); /* the fold was uploaded */
  });
});
