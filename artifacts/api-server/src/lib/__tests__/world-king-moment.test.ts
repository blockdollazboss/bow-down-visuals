/**
 * The King's daily moment (lib/world-king-moment, Ring 3).
 *
 * Pinned contract:
 * - The palace day is the UTC day; the quest week is Monday-anchored
 *   (UTC), the same keys the retention rails use.
 * - The herald text is built only from the store's material: risers
 *   capped at three names, empty parts omitted, and the gift always
 *   named at KING_MOMENT_REWARD_VB drawn from the quest pool.
 * - THE MONEY RULE: a claim pays only inside the fired moment's
 *   window, only once per member per day (unique insert), and only
 *   while (quest claims + King gifts + gift) ≤ the 300 VB weekly
 *   quest pool — no new issuance, ever. A failed grant rolls the
 *   claim row back so the member can retry inside the window.
 * - The firing is idempotent: the day's primary-key row is the
 *   truth — a second tick (or a restart) repairs the hall's claim
 *   window from the row and never heralds twice; a scheduler that
 *   loses the markFired race stays silent.
 */
import { describe, it, expect, vi } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace } from "../world-palace";
import { WORLD_ROOM_ID, type WorldIdentity } from "../world-room";
import {
  KingMomentScheduler,
  createKingMomentClaimer,
  kingAnnouncementText,
  kingMomentDate,
  kingWeekStart,
  KING_MOMENT_REWARD_VB,
  WEEKLY_QUEST_POOL_VB,
  type KingMomentStore,
} from "../world-king-moment";
import type { KingMoment as KingMomentRow } from "@workspace/db";

/* ── Fakes ──────────────────────────────────────────────────────── */

interface FakeSocket extends WsClientSocket {
  sent: any[];
  closedWith: { code?: number; reason?: string } | null;
}

function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    readyState: 1,
    sent: [],
    closedWith: null,
    send(data: string) {
      s.sent.push(JSON.parse(data));
    },
    close(code?: number, reason?: string) {
      s.closedWith = { code, reason };
      s.readyState = 3;
    },
    terminate() {
      s.readyState = 3;
    },
    ping() {},
    on() {
      return s;
    },
  };
  return s;
}

const member = (name: string): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
});

class FakeKingStore implements KingMomentStore {
  moments = new Map<string, KingMomentRow>();
  claims = new Map<string, number>(); // `${userId}|${date}` → amountVb
  questVb = 0;
  grantCalls: { userId: string; amountVb: number }[] = [];
  grantFails = false;
  loseMarkRace = false;

  async getMoment(date: string) {
    return this.moments.get(date) ?? null;
  }
  async markFired(row: {
    momentDate: string;
    firedAt: Date;
    claimDeadline: Date;
    payload: Record<string, unknown>;
  }) {
    if (this.loseMarkRace || this.moments.has(row.momentDate)) return false;
    this.moments.set(row.momentDate, {
      momentDate: row.momentDate,
      firedAt: row.firedAt,
      claimDeadline: row.claimDeadline,
      payload: row.payload,
    } as KingMomentRow);
    return true;
  }
  async questClaimsVb() {
    return this.questVb;
  }
  async kingClaimsVb(userId: string, weekStart: string) {
    let sum = 0;
    for (const [key, amount] of this.claims) {
      const [u, d] = key.split("|");
      if (u === userId && d! >= weekStart) sum += amount;
    }
    return sum;
  }
  async insertClaim(userId: string, date: string, amountVb: number) {
    const key = `${userId}|${date}`;
    if (this.claims.has(key)) return false;
    this.claims.set(key, amountVb);
    return true;
  }
  async deleteClaim(userId: string, date: string) {
    this.claims.delete(`${userId}|${date}`);
  }
  async grant(userId: string, amountVb: number) {
    if (this.grantFails) throw new Error("grant boom");
    this.grantCalls.push({ userId, amountVb });
  }
  async momentMaterial() {
    return {
      kingName: "Thy Cheat Code",
      risers: [
        { name: "Nova Vale", score: 42 },
        { name: "Beat Smith", score: 30 },
      ],
      tonight: [{ title: "Friday Live", roomName: "Music Hall", startsAt: "2026-10-17T20:00:00.000Z" }],
    };
  }
}

/** Saturday Oct 17, 2026, 00:00:30 UTC — just past the day-turn. */
const FIRE_MS = Date.parse("2026-10-17T00:00:30.000Z");
const DATE = "2026-10-17";


/** The shared pool (lib/quest-pool) as this fake's world reports
 *  it: quest sums from the field, king gifts from the claims map,
 *  tutorial rewards zero unless a test seeds them. */
function poolOf(store: FakeKingStore, tutorialVb = 0): import("../quest-pool").QuestPoolStore {
  return {
    questClaimsVb: async () => store.questVb,
    kingClaimsVb: (u, w) => store.kingClaimsVb(u, w),
    tutorialClaimsVb: async () => tutorialVb,
  };
}

describe("the palace calendar math", () => {
  it("the palace day is the UTC date; the week starts Monday (UTC)", () => {
    expect(kingMomentDate(new Date("2026-10-17T23:59:59.000Z"))).toBe("2026-10-17");
    expect(kingMomentDate(new Date("2026-10-18T00:00:00.000Z"))).toBe("2026-10-18");
    // Saturday Oct 17 2026 → Monday Oct 12.
    expect(kingWeekStart(new Date("2026-10-17T12:00:00.000Z"))).toBe("2026-10-12");
    // Sunday Oct 18 → still the week of Monday Oct 12.
    expect(kingWeekStart(new Date("2026-10-18T12:00:00.000Z"))).toBe("2026-10-12");
    // Monday Oct 19 opens a new week.
    expect(kingWeekStart(new Date("2026-10-19T00:00:00.000Z"))).toBe("2026-10-19");
  });
});

describe("the herald text", () => {
  it("names the king, up to three risers, tonight's first event, and the gift from the pool", () => {
    const text = kingAnnouncementText({
      kingName: "Thy Cheat Code",
      risers: [
        { name: "A", score: 9 },
        { name: "B", score: 8 },
        { name: "C", score: 7 },
        { name: "D", score: 6 },
      ],
      tonight: [{ title: "Friday Live", roomName: "Music Hall", startsAt: "x" }],
    });
    expect(text).toContain("Thy Cheat Code takes the throne");
    expect(text).toContain("This week's risers: A, B, C.");
    expect(text).not.toContain(", D");
    expect(text).toContain("Tonight at the palace: Friday Live in the Music Hall.");
    expect(text).toContain(`claim ${KING_MOMENT_REWARD_VB} VB from the week's quest pool`);
  });

  it("omits empty parts — a quiet day still gets its moment", () => {
    const text = kingAnnouncementText({ kingName: "The King", risers: [], tonight: [] });
    expect(text).not.toContain("risers");
    expect(text).not.toContain("Tonight");
    expect(text).toContain("The King holds court");
  });
});

describe("the claimer — the money rule", () => {
  function firedStore(): FakeKingStore {
    const store = new FakeKingStore();
    store.moments.set(DATE, {
      momentDate: DATE,
      firedAt: new Date(FIRE_MS),
      claimDeadline: new Date(FIRE_MS + 60 * 60_000),
      payload: {},
    } as KingMomentRow);
    return store;
  }
  const claimAt = FIRE_MS + 5 * 60_000;

  it("pays the gift inside the window and records the claim", async () => {
    const store = firedStore();
    const claim = createKingMomentClaimer(store, poolOf(store));
    await expect(claim("user-a", DATE, claimAt)).resolves.toEqual({
      ok: true,
      amountVb: KING_MOMENT_REWARD_VB,
    });
    expect(store.grantCalls).toEqual([{ userId: "user-a", amountVb: KING_MOMENT_REWARD_VB }]);
    expect(store.claims.get(`user-a|${DATE}`)).toBe(KING_MOMENT_REWARD_VB);
  });

  it("refuses when no moment fired, and after the deadline (closed)", async () => {
    const store = firedStore();
    const claim = createKingMomentClaimer(store, poolOf(store));
    await expect(claim("user-a", "2026-10-16", claimAt)).resolves.toEqual({
      ok: false,
      reason: "closed",
    });
    await expect(claim("user-a", DATE, FIRE_MS + 61 * 60_000)).resolves.toEqual({
      ok: false,
      reason: "closed",
    });
    expect(store.grantCalls).toEqual([]);
  });

  it("refuses a second claim the same day (already) without paying twice", async () => {
    const store = firedStore();
    const claim = createKingMomentClaimer(store, poolOf(store));
    await claim("user-a", DATE, claimAt);
    await expect(claim("user-a", DATE, claimAt + 1000)).resolves.toEqual({
      ok: false,
      reason: "already",
    });
    expect(store.grantCalls).toHaveLength(1);
  });

  it("the pool is one envelope: quest earnings and past gifts both count against the 300", async () => {
    const store = firedStore();
    const claim = createKingMomentClaimer(store, poolOf(store));
    // 280 from quests + 25 gift > 300 → pool spent.
    store.questVb = 280;
    await expect(claim("user-a", DATE, claimAt)).resolves.toEqual({ ok: false, reason: "pool" });
    // Exactly at the line (275 + 25 = 300) pays.
    store.questVb = 275;
    await expect(claim("user-a", DATE, claimAt)).resolves.toEqual({
      ok: true,
      amountVb: KING_MOMENT_REWARD_VB,
    });
    // Yesterday's gift (same week) counts too: 275 + 25 (yesterday) + 25 > 300.
    const store2 = firedStore();
    store2.questVb = 275;
    store2.claims.set("user-a|2026-10-16", KING_MOMENT_REWARD_VB);
    const claim2 = createKingMomentClaimer(store2, poolOf(store2));
    await expect(claim2("user-a", DATE, claimAt)).resolves.toEqual({ ok: false, reason: "pool" });
    expect(WEEKLY_QUEST_POOL_VB).toBe(300);
  });

  it("tutorial rewards draw from the same envelope (the shared pool, Phase 6)", async () => {
    const store = firedStore();
    store.questVb = 260; // 260 + 30 tutorial + 25 gift > 300 → pool spent
    const claim = createKingMomentClaimer(store, poolOf(store, 30));
    await expect(claim("user-a", DATE, claimAt)).resolves.toEqual({ ok: false, reason: "pool" });
    // Without the tutorial draw the same week pays.
    const claim2 = createKingMomentClaimer(store, poolOf(store, 0));
    await expect(claim2("user-a", DATE, claimAt)).resolves.toEqual({
      ok: true,
      amountVb: KING_MOMENT_REWARD_VB,
    });
  });

  it("a failed grant rolls the claim row back and reports error — the member may retry", async () => {
    const store = firedStore();
    store.grantFails = true;
    const claim = createKingMomentClaimer(store, poolOf(store));
    await expect(claim("user-a", DATE, claimAt)).resolves.toEqual({ ok: false, reason: "error" });
    expect(store.claims.has(`user-a|${DATE}`)).toBe(false);
    store.grantFails = false;
    await expect(claim("user-a", DATE, claimAt)).resolves.toEqual({
      ok: true,
      amountVb: KING_MOMENT_REWARD_VB,
    });
  });
});

describe("the scheduler — one moment a day", () => {
  function palaceWithEar() {
    const palace = new WorldPalace(new RoomHub());
    const ear = fakeSocket();
    palace.enterHall(ear, member("Ear"));
    palace.handleFrame(ear, JSON.stringify({ type: "room.enter", roomId: "world:music-hall" }));
    ear.sent = [];
    return { palace, ear };
  }

  it("fires once: herald palace-wide through the announce channel + the hall's window opens", async () => {
    const { palace, ear } = palaceWithEar();
    const store = new FakeKingStore();
    const scheduler = new KingMomentScheduler({ palace, store });

    await scheduler.tick(FIRE_MS);

    const heard = ear.sent.filter((m) => m.type === "palace.announce").map((m) => m.announce);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: "king", name: "Thy Cheat Code", roomId: WORLD_ROOM_ID });
    expect(heard[0].text).toContain("Nova Vale");
    expect(palace.room(WORLD_ROOM_ID)!.activeKingMomentDate()).toBe(DATE);

    /* A second tick the same day: no second herald, window stands. */
    ear.sent = [];
    await scheduler.tick(FIRE_MS + 60_000);
    expect(ear.sent.filter((m) => m.type === "palace.announce")).toHaveLength(0);
    expect(palace.room(WORLD_ROOM_ID)!.activeKingMomentDate()).toBe(DATE);
  });

  it("a scheduler that loses the firing race stays silent and opens no window", async () => {
    const { palace, ear } = palaceWithEar();
    const store = new FakeKingStore();
    store.loseMarkRace = true;
    const scheduler = new KingMomentScheduler({ palace, store });
    await scheduler.tick(FIRE_MS);
    expect(ear.sent.filter((m) => m.type === "palace.announce")).toHaveLength(0);
    expect(palace.room(WORLD_ROOM_ID)!.activeKingMomentDate()).toBeNull();
  });

  it("repairs a lost window from the row after a restart, and sweeps it when the window closes", async () => {
    const { palace } = palaceWithEar();
    const store = new FakeKingStore();
    store.moments.set(DATE, {
      momentDate: DATE,
      firedAt: new Date(FIRE_MS),
      claimDeadline: new Date(FIRE_MS + 60 * 60_000),
      payload: {},
    } as KingMomentRow);
    const scheduler = new KingMomentScheduler({ palace, store });

    await scheduler.tick(FIRE_MS + 10 * 60_000);
    expect(palace.room(WORLD_ROOM_ID)!.activeKingMomentDate()).toBe(DATE);

    await scheduler.tick(FIRE_MS + 61 * 60_000);
    expect(palace.room(WORLD_ROOM_ID)!.activeKingMomentDate()).toBeNull();
  });
});
