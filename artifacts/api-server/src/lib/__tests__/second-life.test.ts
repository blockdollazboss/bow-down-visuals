/**
 * second-life.test.ts — UPGRADE #161 (Second Life, on Viral Spike Watch).
 *
 * Pins the delta's contract against in-memory stores:
 * - watch prefs: no row = watching ON (the shipped default); a stored
 *   row is exact; accounts are isolated;
 * - the revival plan is built ONLY from the spiking item's own ids —
 *   a video re-cuts in the video panel, a track's revival short is a
 *   song-video, and both kinds get a fresh-cover step in cover-art;
 * - a proposal records the REAL numbers from the spike evaluation
 *   (current plays from the window row, baseline/day from the eval);
 * - a failing proposal insert never throws — the spike alert stands
 *   and the miss is reported as null so the watch can count it.
 */
import { describe, expect, it } from "vitest";
import {
  buildRevivalPlan,
  getSecondLifePrefs,
  proposeRevivalForSpike,
  setSecondLifeWatchEnabled,
  type RevivalStore,
  type SecondLifePrefsStore,
  type SecondLifePrefsWire,
} from "../second-life";
import type { SpikeEvaluation, SpikeWindowRow } from "../viral-spike-watch";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function memoryPrefsStore(): SecondLifePrefsStore {
  const rows = new Map<string, SecondLifePrefsWire>();
  return {
    async getRow(userId) {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    async upsertRow(userId, prefs) {
      rows.set(userId, { ...prefs });
    },
  };
}

describe("second-life watch prefs", () => {
  it("no row yet: watching is ON (the shipped default)", async () => {
    const store = memoryPrefsStore();
    expect(await getSecondLifePrefs(store, USER_A)).toEqual({ watch_enabled: true });
  });

  it("the off-switch persists exactly and accounts are isolated", async () => {
    const store = memoryPrefsStore();
    await setSecondLifeWatchEnabled(store, USER_A, false);
    expect(await getSecondLifePrefs(store, USER_A)).toEqual({ watch_enabled: false });
    expect(await getSecondLifePrefs(store, USER_B)).toEqual({ watch_enabled: true });
    await setSecondLifeWatchEnabled(store, USER_A, true);
    expect(await getSecondLifePrefs(store, USER_A)).toEqual({ watch_enabled: true });
  });
});

describe("buildRevivalPlan — the one-tap revival, from the item itself", () => {
  it("a video re-cuts in the video panel and gets a fresh cover", () => {
    const plan = buildRevivalPlan({ kind: "video", mediaId: "vid-1" });
    expect(plan.steps.map((s) => s.action)).toEqual(["recut_short", "fresh_cover"]);
    expect(plan.steps[0]).toMatchObject({
      sourceKind: "video",
      sourceMediaId: "vid-1",
      createLink: "/create?panel=video&source=vid-1&intent=recut-short",
    });
    expect(plan.steps[1]!.createLink).toBe(
      "/create?panel=coverart&source=vid-1&intent=fresh-cover",
    );
  });

  it("a track's revival short is a song-video built from the track", () => {
    const plan = buildRevivalPlan({ kind: "track", mediaId: "trk-9" });
    expect(plan.steps[0]!.createLink).toBe(
      "/create?panel=song-video&source=trk-9&intent=recut-short",
    );
    expect(plan.steps.every((s) => s.sourceMediaId === "trk-9")).toBe(true);
  });
});

function memoryRevivalStore(): RevivalStore & { rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    async insert(row) {
      rows.push({ ...row });
      return { id: `revival-${rows.length}` };
    },
    async listForOwner() {
      return rows;
    },
    async decide() {
      return false;
    },
  };
}

const SPIKE_ROW: SpikeWindowRow = {
  kind: "track",
  mediaId: "trk-9",
  title: "Midnight Run",
  profileId: "prof-1",
  slug: "steady-creator",
  ownerUserId: USER_A,
  currentPlays: 120,
  baselinePlays: 70,
};
const SPIKE_EVAL: SpikeEvaluation = { spike: true, coldStart: false, baselineDaily: 10 };

describe("proposeRevivalForSpike — a plan, never an action", () => {
  it("records the proposal with the spike's real numbers", async () => {
    const store = memoryRevivalStore();
    const out = await proposeRevivalForSpike(store, SPIKE_ROW, SPIKE_EVAL);
    expect(out).toEqual({ id: "revival-1" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      ownerUserId: USER_A,
      profileId: "prof-1",
      kind: "track",
      mediaId: "trk-9",
      currentPlays: 120,
      baselineDaily: 10,
    });
    const plan = store.rows[0]!["plan"] as { steps: Array<{ action: string }> };
    expect(plan.steps.map((s) => s.action)).toEqual(["recut_short", "fresh_cover"]);
  });

  it("a failing insert returns null and never throws — the alert stands", async () => {
    const broken: RevivalStore = {
      async insert() {
        throw new Error("relation \"second_life_revivals\" does not exist");
      },
      async listForOwner() {
        return [];
      },
      async decide() {
        return false;
      },
    };
    await expect(proposeRevivalForSpike(broken, SPIKE_ROW, SPIKE_EVAL)).resolves.toBeNull();
  });
});
