/**
 * viral-spike-service.test.ts — the kit's wiring invariants against an
 * in-memory store:
 *
 * - prefs default ON; opt-out stops ALL sampling (zero snapshot writes)
 *   and all surfacing, for that account only.
 * - a first check is a baseline only — insufficient data, no kit, no
 *   alert, however big the cumulative counter already is.
 * - a measured spike fires exactly one alert + kit; inside the
 *   cooldown the same kit is surfaced from the stored alert without a
 *   second alert row; after the cooldown a still-spiking post may
 *   fire again.
 * - the sweeper checks watched users and skips opted-out accounts.
 */
import { describe, expect, it } from "vitest";
import {
  getViralSpikePrefs,
  kitFromStoredAlert,
  runViralSpikeCheck,
  setViralSpikePrefs,
  sweepViralSpikeWatchers,
  type StoredSpikeAlert,
  type ViralSpikeContentRow,
  type ViralSpikeStore,
} from "../viral-spike-service";
import type { ViewSample } from "../viral-spike";

const HOUR = 3_600_000;
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const NOW = 1_800_000_000_000;

interface MemState {
  prefs: Map<string, boolean>;
  content: Map<string, ViralSpikeContentRow[]>;
  snapshots: Map<string, ViewSample[]>;
  alerts: (StoredSpikeAlert & { userId: string })[];
  snapshotWrites: number;
}

function key(userId: string, kind: string, id: string) {
  return `${userId}|${kind}|${id}`;
}

function memoryStore(): { store: ViralSpikeStore; state: MemState } {
  const state: MemState = {
    prefs: new Map(),
    content: new Map(),
    snapshots: new Map(),
    alerts: [],
    snapshotWrites: 0,
  };
  const store: ViralSpikeStore = {
    async getPrefsRow(userId) {
      const v = state.prefs.get(userId);
      return v === undefined ? null : { enabled: v };
    },
    async upsertPrefsRow(userId, enabled) {
      state.prefs.set(userId, enabled);
    },
    async listContent(userId) {
      return (state.content.get(userId) ?? []).map((c) => ({ ...c }));
    },
    async listSnapshots(userId, kind, contentId, sinceMs) {
      return (state.snapshots.get(key(userId, kind, contentId)) ?? [])
        .filter((s) => s.atMs >= sinceMs)
        .map((s) => ({ ...s }))
        .sort((a, b) => a.atMs - b.atMs);
    },
    async appendSnapshot(userId, kind, contentId, views, atMs) {
      state.snapshotWrites += 1;
      const k = key(userId, kind, contentId);
      const arr = state.snapshots.get(k) ?? [];
      arr.push({ atMs, views });
      state.snapshots.set(k, arr);
    },
    async lastAlert(userId, kind, contentId) {
      const mine = state.alerts
        .filter(
          (a) => a.userId === userId && a.content.kind === kind && a.content.id === contentId,
        )
        .sort((a, b) => b.detectedAtMs - a.detectedAtMs);
      return mine[0] ?? null;
    },
    async insertAlert(alert) {
      state.alerts.push({ ...alert, content: { ...alert.content } });
    },
    async listWatchedUserIds(limit) {
      return [...state.content.keys()].slice(0, limit);
    },
  };
  return { store, state };
}

function seedShowcase(state: MemState, userId: string, views: number, title = "My Video") {
  state.content.set(userId, [
    { kind: "showcase", id: ITEM, title, slug: "my-video", views },
  ]);
}

function setViews(state: MemState, userId: string, views: number) {
  const rows = state.content.get(userId)!;
  rows[0] = { ...rows[0]!, views };
}

function seedSamples(state: MemState, userId: string, samples: ViewSample[]) {
  state.snapshots.set(key(userId, "showcase", ITEM), [...samples]);
}

describe("viral-spike prefs", () => {
  it("default is ON with no row; opt-out persists per account", async () => {
    const { store } = memoryStore();
    expect(await getViralSpikePrefs(store, USER_A)).toEqual({ enabled: true });
    expect(await setViralSpikePrefs(store, USER_A, { enabled: false })).toEqual({
      enabled: false,
    });
    expect((await getViralSpikePrefs(store, USER_A)).enabled).toBe(false);
    expect((await getViralSpikePrefs(store, USER_B)).enabled).toBe(true);
  });
});

describe("runViralSpikeCheck", () => {
  it("opted out: returns disabled and writes ZERO snapshots", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 999_999);
    await setViralSpikePrefs(store, USER_A, { enabled: false });
    const r = await runViralSpikeCheck(store, USER_A, { nowMs: NOW });
    expect(r.status).toBe("disabled");
    expect(r.kits).toEqual([]);
    expect(state.snapshotWrites).toBe(0);
    expect(state.alerts).toEqual([]);
  });

  it("first check is baseline only: sampled, measuring, no kit on a huge counter", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 999_999);
    const r = await runViralSpikeCheck(store, USER_A, { nowMs: NOW });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.sampled).toBe(1);
      expect(r.measuring).toBe(1);
      expect(r.kits).toEqual([]);
    }
    expect(state.alerts).toEqual([]);
  });

  it("a measured spike fires one alert + kit with the real multiplier headline", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 1_672);
    seedSamples(state, USER_A, [
      { atMs: NOW - 78 * HOUR, views: 1_000 },
      { atMs: NOW - 6 * HOUR, views: 1_072 },
    ]);
    const r = await runViralSpikeCheck(store, USER_A, { nowMs: NOW });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.kits).toHaveLength(1);
      const kit = r.kits[0]!;
      expect(kit.basis).toBe("measured_multiplier");
      expect(kit.headline).toContain("+600 views");
      expect(kit.headline).toContain("100×");
      expect(kit.auto_actions_taken).toBe(0);
      expect(kit.steps.every((s) => s.requires_creator_action)).toBe(true);
    }
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]!.multiplier).toBe(100);
  });

  it("inside cooldown: no second alert, the fired kit is surfaced from storage", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 1_672);
    seedSamples(state, USER_A, [
      { atMs: NOW - 78 * HOUR, views: 1_000 },
      { atMs: NOW - 6 * HOUR, views: 1_072 },
    ]);
    const first = await runViralSpikeCheck(store, USER_A, { nowMs: NOW });
    setViews(state, USER_A, 2_272); // still climbing an hour later
    const second = await runViralSpikeCheck(store, USER_A, { nowMs: NOW + HOUR });
    expect(state.alerts).toHaveLength(1);
    if (first.status === "ok" && second.status === "ok") {
      expect(second.kits).toHaveLength(1);
      expect(second.kits[0]!.headline).toBe(first.kits[0]!.headline);
    } else {
      throw new Error("expected ok results");
    }
  });

  it("after the cooldown, a still-spiking post may fire a second kit", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 1_672);
    seedSamples(state, USER_A, [
      { atMs: NOW - 78 * HOUR, views: 1_000 },
      { atMs: NOW - 6 * HOUR, views: 1_072 },
    ]);
    await runViralSpikeCheck(store, USER_A, { nowMs: NOW });
    const later = NOW + 25 * HOUR;
    setViews(state, USER_A, 5_000);
    seedSamples(state, USER_A, [
      { atMs: later - 78 * HOUR, views: 2_000 },
      { atMs: later - 6 * HOUR, views: 2_072 },
      { atMs: NOW, views: 1_672 },
    ]);
    const r = await runViralSpikeCheck(store, USER_A, { nowMs: later });
    expect(state.alerts).toHaveLength(2);
    if (r.status === "ok") expect(r.kits).toHaveLength(1);
  });

  it("flat content never fires: steady views, no alert, no kit", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 1_100);
    seedSamples(state, USER_A, [
      { atMs: NOW - 78 * HOUR, views: 1_000 },
      { atMs: NOW - 6 * HOUR, views: 1_095 },
    ]);
    const r = await runViralSpikeCheck(store, USER_A, { nowMs: NOW });
    if (r.status === "ok") expect(r.kits).toEqual([]);
    expect(state.alerts).toEqual([]);
  });
});

describe("kitFromStoredAlert", () => {
  it("rebuilds the identical headline from the stored measured numbers", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 1_672);
    seedSamples(state, USER_A, [
      { atMs: NOW - 78 * HOUR, views: 1_000 },
      { atMs: NOW - 6 * HOUR, views: 1_072 },
    ]);
    const r = await runViralSpikeCheck(store, USER_A, { nowMs: NOW });
    const stored = state.alerts[0]!;
    const rebuilt = kitFromStoredAlert(stored);
    expect(rebuilt).not.toBeNull();
    if (r.status === "ok") {
      expect(rebuilt!.headline).toBe(r.kits[0]!.headline);
      expect(rebuilt!.steps).toEqual(r.kits[0]!.steps);
    }
  });
});

describe("sweepViralSpikeWatchers", () => {
  it("checks watched users, skips opted-out ones without sampling them", async () => {
    const { store, state } = memoryStore();
    seedShowcase(state, USER_A, 10);
    seedShowcase(state, USER_B, 20);
    await setViralSpikePrefs(store, USER_B, { enabled: false });
    const r = await sweepViralSpikeWatchers(store, { nowMs: NOW });
    expect(r.users).toBe(2);
    expect(r.skippedDisabled).toBe(1);
    // Only USER_A was sampled.
    expect(state.snapshotWrites).toBe(1);
    expect(state.snapshots.has(key(USER_A, "showcase", ITEM))).toBe(true);
    expect(state.snapshots.has(key(USER_B, "showcase", ITEM))).toBe(false);
  });
});
