/**
 * objective-strip.test.ts — Lane K2 (THE-GAME §5(a), part 2): the
 * Objective Strip's slot logic, the Kingdom Board blocks' shaping,
 * the Treasury streak moment's crossing detection, and the guest
 * honest-states.
 *
 * The pure logic is unit-tested against the real functions with
 * server-shaped payloads; the wiring is pinned as source contracts
 * in the repo's established style (see treasury-panels.test.ts).
 * Nothing here invents data: every fixture mirrors the exact shape
 * its rail serves —
 *   GET /api/retention/quests      → { enabled, weekStart, quests[] }
 *   GET /api/retention/streak      → { enabled, currentStreak, …,
 *                                      milestones[], nextMilestone }
 *   GET /api/retention/leaderboard → { weekStart, rows[], viewerRank,
 *                                      viewerScore }  (NO Front Row
 *                                      field — pinned below)
 *   GET /api/world/events          → { events[] } (Lane H's slate)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  destinationLabel,
  directorySlate,
  eventsToday,
  formatEventStart,
  kingdomStandings,
  mergeSlates,
  nextObjective,
  nextStreakStep,
  normalizeDailyQuestsStatus,
  normalizeQuestsStatus,
  normalizeStreakStatus,
  normalizeWorldEventSlate,
  pickPalaceSlot,
  type PalaceSlateEvent,
} from "./objective-strip";
import { normalizeLeaderboard } from "./treasury-quests";
import {
  evaluateStreakCrossing,
  highestReachedMilestone,
  readSeenStreakMilestone,
  seenStreakKey,
  writeSeenStreakMilestone,
} from "./streak-moment";
import {
  GUEST_EMOTE_PITCH,
  GUEST_SIGN_IN_HREF,
  GUEST_SPEAK_PITCH,
  memberControlsVisible,
  stripSlotsFor,
} from "./guest-honest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stripSrc = read("../../components/world/ObjectiveStrip.tsx");
const boardBlocksSrc = read("../../components/world/native/KingdomBoardBlocks.tsx");
const depthsSrc = read("../../components/world/native/TreasuryQuestDepths.tsx");
const stationPanelSrc = read("../../components/world/StationPanel.tsx");
const worldPageSrc = read("../../pages/world.tsx");
const worldClientSrc = read("./world-client.ts");

/* ─── Fixtures: the rails' own shapes ────────────────────────────── */

const QUESTS = {
  enabled: true,
  weekStart: "2026-10-12",
  quests: [
    { key: "make-thumbnail", target: 1, reward: 40, progress: 0, completed: false, claimed: false },
    { key: "generate-song", target: 1, reward: 80, progress: 0, completed: false, claimed: false },
    { key: "export-video", target: 1, reward: 120, progress: 0, completed: false, claimed: false },
    { key: "viral-sharer", target: 3, reward: 60, progress: 2, completed: false, claimed: false },
  ],
};

function streakPayload(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    currentStreak: 5,
    longestStreak: 9,
    lastCreationDate: "2026-10-17",
    milestonesClaimed: [3],
    milestones: [
      { days: 3, reward: 100, reached: true, claimed: true },
      { days: 7, reward: 250, reached: false, claimed: false },
      { days: 14, reward: 500, reached: false, claimed: false },
      { days: 30, reward: 1000, reached: false, claimed: false },
    ],
    nextMilestone: { days: 7, reward: 250 },
    ...over,
  };
}

const iso = (d: Date) => d.toISOString();
const at = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date(2026, 9, 17 + dayOffset, hour, minute); // local time
  return iso(d);
};
const NOW = new Date(2026, 9, 17, 12, 0).getTime(); // Sat Oct 17 2026, noon local

function slateEvent(over: Partial<PalaceSlateEvent> = {}): PalaceSlateEvent {
  return {
    id: "ev1",
    kind: "stage_show",
    title: "Crown Night",
    roomId: "world:kings-hall",
    hostName: "Ada",
    startsAt: at(0, 19),
    endsAt: at(0, 20),
    status: "scheduled",
    ...over,
  };
}

/* ─── QUEST slot ─────────────────────────────────────────────────── */

describe("quest slot — the next objective, from the retention quest rail", () => {
  it("normalizes the server payload and refuses junk", () => {
    const s = normalizeQuestsStatus(QUESTS);
    expect(s?.quests).toHaveLength(4);
    expect(s?.weekStart).toBe("2026-10-12");
    expect(normalizeQuestsStatus(null)).toBeNull();
    expect(normalizeQuestsStatus({ quests: "nope" })).toBeNull();
    expect(normalizeQuestsStatus({ quests: [{ key: "x" }] })).toBeNull();
  });

  it("the first incomplete quest is the objective, with progress + destination", () => {
    const next = nextObjective(normalizeQuestsStatus(QUESTS)!);
    expect(next.kind).toBe("active");
    if (next.kind === "active") {
      expect(next.quest.key).toBe("make-thumbnail");
      expect(next.objective).toMatchObject({ progress: 0, target: 1, state: "active" });
      expect(next.destination).toMatchObject({ kind: "station", stationId: "thumbnail-desk" });
      expect(destinationLabel(next.destination)).toContain("Thumbnail Desk");
      expect(destinationLabel(next.destination)).toContain("Create Wing");
    }
  });

  it("a claimable quest beats an earlier incomplete one — claiming is the next thing", () => {
    const payload = {
      ...QUESTS,
      quests: QUESTS.quests.map((q) =>
        q.key === "generate-song" ? { ...q, progress: 1, completed: true } : q,
      ),
    };
    const next = nextObjective(normalizeQuestsStatus(payload)!);
    expect(next.kind).toBe("claimable");
    if (next.kind === "claimable") {
      expect(next.quest.key).toBe("generate-song");
      expect(next.objective.state).toBe("claimable");
    }
  });

  it("progress reads from the server row (viral-sharer 2 of 3, website transfer)", () => {
    const payload = {
      ...QUESTS,
      quests: QUESTS.quests.map((q) =>
        q.key === "viral-sharer" ? q : { ...q, progress: q.target, completed: true, claimed: true },
      ),
    };
    const next = nextObjective(normalizeQuestsStatus(payload)!);
    expect(next.kind).toBe("active");
    if (next.kind === "active") {
      expect(next.objective).toMatchObject({ progress: 2, target: 3 });
      expect(next.destination).toEqual({ kind: "transfer", href: "/my-projects" });
      expect(destinationLabel(next.destination)).toBe("the website");
    }
  });

  it("all claimed names next week's slate; switched-off says so; empty catalog is honest", () => {
    const done = {
      ...QUESTS,
      quests: QUESTS.quests.map((q) => ({ ...q, progress: q.target, completed: true, claimed: true })),
    };
    expect(nextObjective(normalizeQuestsStatus(done)!).kind).toBe("all-done");
    expect(nextObjective(normalizeQuestsStatus({ ...QUESTS, enabled: false })!).kind).toBe("off");
    expect(nextObjective(normalizeQuestsStatus({ enabled: true, weekStart: "", quests: [] })!).kind).toBe("none");
    expect(destinationLabel(null)).toBe("the Treasury");
  });
});

/* ─── DAILY TRIO in the quest slot (Ring 4) ──────────────────────── */

const DAILY = {
  enabled: true,
  daily: {
    date: "2026-10-18",
    quests: [
      { key: "daily-first-frame", name: "First Frame", baseKey: "make-thumbnail", target: 1, rewardVb: 10, marks: 5, progress: 0, completed: false, claimed: false },
      { key: "daily-song-spark", name: "Song Spark", baseKey: "generate-song", target: 1, rewardVb: 10, marks: 5, progress: 0, completed: false, claimed: false },
      { key: "daily-ship-it", name: "Ship It", baseKey: "export-video", target: 1, rewardVb: 10, marks: 5, progress: 0, completed: false, claimed: false },
    ],
    marksTotal: 15,
    pool: { capVb: 300, spentVb: 40, remainingVb: 260 },
  },
};

describe("quest slot — the Daily Trio stands in front (Ring 4)", () => {
  it("normalizes the trio payload and refuses junk", () => {
    const s = normalizeDailyQuestsStatus(DAILY);
    expect(s?.quests).toHaveLength(3);
    expect(s?.quests[0]).toMatchObject({ key: "daily-first-frame", reward: 10, marks: 5, baseKey: "make-thumbnail" });
    expect(s?.marksTotal).toBe(15);
    expect(s?.pool.remainingVb).toBe(260);
    expect(normalizeDailyQuestsStatus(null)).toBeNull();
    expect(normalizeDailyQuestsStatus({ daily: { quests: "nope" } })).toBeNull();
    expect(normalizeDailyQuestsStatus({ daily: { quests: [{ key: "x" }] } })).toBeNull();
  });

  it("an active daily beats the weekly pick — today's step is the urgent one", () => {
    const weekly = normalizeQuestsStatus(QUESTS)!;
    const next = nextObjective(weekly, normalizeDailyQuestsStatus(DAILY));
    expect(next.kind).toBe("active");
    if (next.kind === "active") {
      expect(next.quest.key).toBe("daily-first-frame");
      expect(next.title).toBe("First Frame");
      /* The destination resolves from the BASE quest's desk. */
      expect(next.destination).toMatchObject({ kind: "station", stationId: "thumbnail-desk" });
    }
  });

  it("a claimable daily beats everything — its VB expires at the day-turn", () => {
    const payload = {
      ...DAILY,
      daily: {
        ...DAILY.daily,
        quests: DAILY.daily.quests.map((q) =>
          q.key === "daily-song-spark" ? { ...q, progress: 1, completed: true } : q,
        ),
      },
    };
    /* The weekly slate ALSO has a claimable quest standing. */
    const weeklyPayload = {
      ...QUESTS,
      quests: QUESTS.quests.map((q) =>
        q.key === "generate-song" ? { ...q, progress: 1, completed: true } : q,
      ),
    };
    const next = nextObjective(normalizeQuestsStatus(weeklyPayload)!, normalizeDailyQuestsStatus(payload));
    expect(next.kind).toBe("claimable");
    if (next.kind === "claimable") {
      expect(next.quest.key).toBe("daily-song-spark");
      expect(next.title).toBe("Song Spark");
    }
  });

  it("a fully-claimed trio falls through to the week's own next thing", () => {
    const payload = {
      ...DAILY,
      daily: {
        ...DAILY.daily,
        quests: DAILY.daily.quests.map((q) => ({ ...q, progress: q.target, completed: true, claimed: true })),
      },
    };
    const next = nextObjective(normalizeQuestsStatus(QUESTS)!, normalizeDailyQuestsStatus(payload));
    expect(next.kind).toBe("active");
    if (next.kind === "active") expect(next.quest.key).toBe("make-thumbnail");
  });

  it("no trio (null) or a switched-off trio leaves the weekly pick untouched", () => {
    const weekly = normalizeQuestsStatus(QUESTS)!;
    expect(nextObjective(weekly, null).kind).toBe("active");
    const off = normalizeDailyQuestsStatus({ ...DAILY, enabled: false });
    const next = nextObjective(weekly, off);
    expect(next.kind).toBe("active");
    if (next.kind === "active") expect(next.quest.key).toBe("make-thumbnail");
  });
});

/* ─── STREAK slot ────────────────────────────────────────────────── */

describe("streak slot — the next milestone, from /api/retention/streak", () => {
  it("normalizes the streak rail, milestones sorted, server pointer preserved", () => {
    const s = normalizeStreakStatus(streakPayload());
    expect(s?.currentStreak).toBe(5);
    expect(s?.milestones.map((m) => m.days)).toEqual([3, 7, 14, 30]);
    expect(s?.nextMilestone).toEqual({ days: 7, reward: 250 });
    expect(normalizeStreakStatus({ milestones: "no" })).toBeNull();
    expect(normalizeStreakStatus(null)).toBeNull();
  });

  it("an unreached milestone ahead names its days-to-go and its VB", () => {
    const step = nextStreakStep(normalizeStreakStatus(streakPayload())!);
    expect(step.kind).toBe("upcoming");
    if (step.kind === "upcoming") {
      expect(step.milestone).toMatchObject({ days: 7, reward: 250 });
      expect(step.daysToGo).toBe(2);
    }
  });

  it("a reached-but-unclaimed milestone is claimable and beats the road ahead", () => {
    const s = normalizeStreakStatus(
      streakPayload({
        currentStreak: 8,
        milestonesClaimed: [],
        milestones: [
          { days: 3, reward: 100, reached: true, claimed: false },
          { days: 7, reward: 250, reached: true, claimed: false },
          { days: 14, reward: 500, reached: false, claimed: false },
          { days: 30, reward: 1000, reached: false, claimed: false },
        ],
        nextMilestone: { days: 3, reward: 100 },
      }),
    )!;
    const step = nextStreakStep(s);
    expect(step.kind).toBe("claimable");
    if (step.kind === "claimable") expect(step.milestone.days).toBe(3);
  });

  it("every milestone claimed reads all-claimed; switched-off says so", () => {
    const all = normalizeStreakStatus(
      streakPayload({
        currentStreak: 31,
        milestones: [
          { days: 3, reward: 100, reached: true, claimed: true },
          { days: 7, reward: 250, reached: true, claimed: true },
          { days: 14, reward: 500, reached: true, claimed: true },
          { days: 30, reward: 1000, reached: true, claimed: true },
        ],
        nextMilestone: null,
      }),
    )!;
    expect(nextStreakStep(all).kind).toBe("all-claimed");
    expect(nextStreakStep(normalizeStreakStatus(streakPayload({ enabled: false }))!).kind).toBe("off");
  });
});

/* ─── PALACE slot ────────────────────────────────────────────────── */

describe("palace slot — Lane H's slate picks live first, then soonest", () => {
  it("the REST slate normalizes and drops done/cancelled rows", () => {
    const events = normalizeWorldEventSlate({
      events: [
        slateEvent(),
        slateEvent({ id: "ev2", status: "done" as never }),
        slateEvent({ id: "ev3", status: "cancelled" as never }),
        { bogus: true },
      ],
    });
    expect(events.map((e) => e.id)).toEqual(["ev1"]);
    expect(normalizeWorldEventSlate(null)).toEqual([]);
  });

  it("the directory slate flattens per-room events and carries the room id", () => {
    const events = directorySlate([
      {
        id: "world:music-hall",
        events: [
          { id: "ev9", kind: "listening_party", title: "Vinyl Hour", hostName: "Bo", startsAt: at(0, 18), endsAt: at(0, 19), status: "scheduled" },
        ],
      },
      { id: "world:treasury", events: [] },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "ev9", roomId: "world:music-hall" });
  });

  it("merging the two reads dedupes by event id", () => {
    const merged = mergeSlates([slateEvent()], [slateEvent(), slateEvent({ id: "ev2" })]);
    expect(merged.map((e) => e.id)).toEqual(["ev1", "ev2"]);
  });

  it("a live event wins over a sooner scheduled one", () => {
    const slot = pickPalaceSlot(
      [
        slateEvent({ id: "soon", startsAt: at(0, 13), endsAt: at(0, 14) }),
        slateEvent({ id: "live", status: "live", startsAt: at(0, 11), endsAt: at(0, 13) }),
      ],
      NOW,
    );
    expect(slot).toMatchObject({ kind: "live", event: { id: "live" } });
  });

  it("otherwise the soonest not-yet-ended scheduled event; ended ones don't count", () => {
    const slot = pickPalaceSlot(
      [
        slateEvent({ id: "later", startsAt: at(1, 19), endsAt: at(1, 20) }),
        slateEvent({ id: "ended", startsAt: at(0, 8), endsAt: at(0, 9) }),
        slateEvent({ id: "tonight", startsAt: at(0, 19), endsAt: at(0, 20) }),
      ],
      NOW,
    );
    expect(slot).toMatchObject({ kind: "next", event: { id: "tonight" } });
    expect(pickPalaceSlot([], NOW)).toEqual({ kind: "none" });
    expect(pickPalaceSlot([slateEvent({ startsAt: at(0, 8), endsAt: at(0, 9) })], NOW)).toEqual({ kind: "none" });
  });

  it("today's block: today's events plus anything live, live first", () => {
    const today = eventsToday(
      [
        slateEvent({ id: "tomorrow", startsAt: at(1, 10), endsAt: at(1, 11) }),
        slateEvent({ id: "tonight", startsAt: at(0, 19), endsAt: at(0, 20) }),
        slateEvent({ id: "live-yesterday", status: "live", startsAt: at(-1, 22), endsAt: at(0, 1) }),
      ],
      NOW,
    );
    expect(today.map((e) => e.id)).toEqual(["live-yesterday", "tonight"]);
  });

  it("start times say today / tomorrow / the date, in words", () => {
    expect(formatEventStart(at(0, 19, 30), NOW)).toMatch(/^today at /);
    expect(formatEventStart(at(1, 19), NOW)).toMatch(/^tomorrow at /);
    expect(formatEventStart(at(3, 19), NOW)).toContain("at");
    expect(formatEventStart(at(3, 19), NOW)).not.toMatch(/^today|^tomorrow/);
  });
});

/* ─── KINGDOM BOARD: standings shaping ───────────────────────────── */

describe("kingdom standings — top 5 + the viewer's own rank, nothing invented", () => {
  const boardPayload = {
    weekStart: "2026-10-12T00:00:00.000Z",
    rows: Array.from({ length: 8 }, (_, i) => ({
      rank: i + 1,
      name: `Creator ${i + 1}`,
      creations: 10 - i,
      exports: 2,
      score: 12 - i,
      isYou: i === 5,
    })),
    viewerRank: 6,
    viewerScore: 7,
  };

  it("the rail carries NO Front Row field — the gap is named, not filled", () => {
    const board = normalizeLeaderboard(boardPayload)!;
    expect(board).not.toHaveProperty("frontRow");
    expect(Object.keys(board).sort()).toEqual(["rows", "viewerRank", "viewerScore", "weekStart"]);
  });

  it("top is exactly 5; the viewer's rank survives even outside the top", () => {
    const s = kingdomStandings(normalizeLeaderboard(boardPayload)!);
    expect(s.top).toHaveLength(5);
    expect(s.top[0]).toMatchObject({ rank: 1, name: "Creator 1" });
    expect(s.viewerRank).toBe(6);
    expect(s.viewerInTop).toBe(false);
  });

  it("a viewer inside the top is flagged there; a viewer absent from the rail gets null rank", () => {
    const inside = kingdomStandings(
      normalizeLeaderboard({ ...boardPayload, viewerRank: 6, rows: boardPayload.rows.map((r, i) => ({ ...r, isYou: i === 2 })) })!,
    );
    expect(inside.viewerInTop).toBe(true);
    const absent = kingdomStandings(
      normalizeLeaderboard({ weekStart: "", rows: [], viewerRank: null, viewerScore: 0 })!,
    );
    expect(absent.viewerRank).toBeNull();
    expect(absent.top).toEqual([]);
  });

  it("the board blocks ride the real rails and name the Front Row gap in copy", () => {
    expect(boardBlocksSrc).toContain('fetch("/api/retention/leaderboard"');
    expect(boardBlocksSrc).toContain("fetchWorldEvents");
    expect(boardBlocksSrc).toContain("kingdomStandings(board)");
    expect(boardBlocksSrc).toContain('data-testid="world-kingdom-standings"');
    expect(boardBlocksSrc).toContain('data-testid="world-kingdom-today"');
    expect(boardBlocksSrc).toContain("isn&rsquo;t carried by this rail");
    expect(boardBlocksSrc).toContain("Nothing on today's slate at the palace.");
    // Members-only standings never fetch for a guest.
    expect(boardBlocksSrc).toContain("if (isGuest) return;");
  });

  it("the Kingdom Board host mounts the blocks for members and guests alike", () => {
    expect(stationPanelSrc).toContain("<KingdomBoardBlocks");
    expect(stationPanelSrc).toContain("isGuest={isGuest}");
  });
});

/* ─── STREAK MOMENT: crossing detection ──────────────────────────── */

describe("streak moment — crossings detected from server state only", () => {
  const statusAt = (current: number, claimedDays: number[]) =>
    normalizeStreakStatus(
      streakPayload({
        currentStreak: current,
        milestonesClaimed: claimedDays,
        milestones: [
          { days: 3, reward: 100, reached: current >= 3, claimed: claimedDays.includes(3) },
          { days: 7, reward: 250, reached: current >= 7, claimed: claimedDays.includes(7) },
          { days: 14, reward: 500, reached: current >= 14, claimed: claimedDays.includes(14) },
          { days: 30, reward: 1000, reached: current >= 30, claimed: claimedDays.includes(30) },
        ],
        nextMilestone: null,
      }),
    )!;

  it("the highest reached milestone is the server's flag, never a count of our own", () => {
    expect(highestReachedMilestone(statusAt(8, []))?.days).toBe(7);
    expect(highestReachedMilestone(statusAt(2, []))).toBeNull();
  });

  it("first sighting baselines silently — even already standing on a milestone", () => {
    expect(evaluateStreakCrossing(null, statusAt(8, []))).toEqual({ kind: "baseline", milestoneDays: 7 });
    expect(evaluateStreakCrossing(null, statusAt(1, []))).toEqual({ kind: "baseline", milestoneDays: 0 });
  });

  it("crossing a new milestone since the baseline is a moment, with its server VB", () => {
    const verdict = evaluateStreakCrossing(3, statusAt(7, [3]));
    expect(verdict.kind).toBe("crossed");
    if (verdict.kind === "crossed") {
      expect(verdict.milestone).toMatchObject({ days: 7, reward: 250, claimed: false });
      expect(verdict.currentStreak).toBe(7);
    }
  });

  it("no new milestone is no moment; a fallen streak re-baselines quietly", () => {
    expect(evaluateStreakCrossing(7, statusAt(9, [3, 7])).kind).toBe("none");
    expect(evaluateStreakCrossing(7, statusAt(1, [3, 7]))).toEqual({ kind: "baseline", milestoneDays: 0 });
  });

  it("the seen marker round-trips per user and refuses junk", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    writeSeenStreakMilestone(storage, "user-1", 7);
    expect(store.get(seenStreakKey("user-1"))).toBe("7");
    expect(readSeenStreakMilestone(storage, "user-1")).toBe(7);
    expect(readSeenStreakMilestone(storage, "user-2")).toBeNull();
    store.set(seenStreakKey("user-3"), "banana");
    expect(readSeenStreakMilestone(storage, "user-3")).toBeNull();
  });

  it("the Treasury presents the moment — and never broadcasts it", () => {
    expect(depthsSrc).toContain("evaluateStreakCrossing(");
    expect(depthsSrc).toContain("normalizeStreakStatus(rawStreak)");
    expect(depthsSrc).toContain('data-testid="world-treasury-streak-moment"');
    expect(depthsSrc).toContain('fetch("/api/retention/streak"');
    // The K1 moment protocol verifies quest claims + level-ups
    // only: no streak kind exists in the client, and this lane
    // adds none — an unverifiable broadcast would be a fake win.
    expect(depthsSrc).not.toContain("moment.celebrate");
    expect(worldClientSrc).not.toContain("celebrateStreak");
    expect(worldClientSrc).not.toContain('kind: "streak"');
  });
});

/* ─── GUEST HONEST-STATES ────────────────────────────────────────── */

describe("guest honest-states — look and listen only, said out loud", () => {
  it("the pitch copy and the sign-in route are the house's", () => {
    expect(GUEST_SPEAK_PITCH).toBe("Guests can look and listen — sign in to speak");
    expect(GUEST_EMOTE_PITCH).toBe("Guests can look and listen — sign in to join in");
    expect(GUEST_SIGN_IN_HREF).toBe("/login?next=/world");
  });

  it("guests get the palace slot only — no quest slot, no streak slot", () => {
    expect(stripSlotsFor(true)).toEqual({ quest: false, streak: false, palace: true });
    expect(stripSlotsFor(false)).toEqual({ quest: true, streak: true, palace: true });
    expect(memberControlsVisible(true)).toBe(false);
    expect(memberControlsVisible(false)).toBe(true);
  });

  it("the strip renders the guest pitch and never fetches personal rails for guests", () => {
    expect(stripSrc).toContain("stripSlotsFor(isGuest)");
    expect(stripSrc).toContain('data-testid="world-objective-guest-pitch"');
    expect(stripSrc).toContain('fetch("/api/retention/quests"');
    expect(stripSrc).toContain('fetch("/api/retention/streak"');
    /* Ring 4: the trio read rides the same member-only load. */
    expect(stripSrc).toContain('fetch("/api/retention/quests/daily"');
    expect(stripSrc).toContain("fetchWorldEvents()");
    expect(stripSrc).toContain("if (isGuest) return;");
    // The strip names the next thing; it never claims anything.
    expect(stripSrc).not.toContain("/claim");
    expect(stripSrc).not.toContain('data-testid="world-objective-quest" data-');
    expect(stripSrc).toContain('data-testid="world-objective-quest"');
    expect(stripSrc).toContain('data-testid="world-objective-streak"');
    expect(stripSrc).toContain('data-testid="world-objective-palace"');
    expect(stripSrc).toContain("Nothing on the palace slate");
  });

  it("the world page mounts the strip inside, across rooms", () => {
    expect(worldPageSrc).toContain("<ObjectiveStrip");
    expect(worldPageSrc).toContain("isGuest={isGuest}");
    expect(worldPageSrc).toContain("directory={directory}");
  });

  it("the say box: members keep the composer byte-for-byte; guests get the pitch in its place", () => {
    // The member composer is still the one form, still member-gated.
    expect(worldPageSrc).toContain('data-testid="world-say-input"');
    expect(worldPageSrc).toContain("{!isGuest && status === \"inside\" && (\n            <form");
    // The guest pitch stands exactly where a guest would look.
    expect(worldPageSrc).toContain('data-testid="world-guest-say-pitch"');
    expect(worldPageSrc).toContain("GUEST_SPEAK_PITCH");
    expect(worldPageSrc).toContain("GUEST_SIGN_IN_HREF");
  });

  it("the action bar: members keep it; guests get the emote pitch, and performAction itself refuses guests", () => {
    expect(worldPageSrc).toContain('data-testid="world-action-bar"');
    expect(worldPageSrc).toContain('status === "inside" && !isGuest');
    expect(worldPageSrc).toContain('data-testid="world-guest-action-pitch"');
    expect(worldPageSrc).toContain("GUEST_EMOTE_PITCH");
    expect(worldPageSrc).toContain("if (!memberControlsVisible(isGuest)) return;");
  });

  it("voice controls stay member-only in the chrome (no guest voice controls to go dead)", () => {
    expect(worldPageSrc).toContain('data-testid="world-voice-modes"');
    // The whole voice block rides the same !isGuest wrapper as before.
    const voiceIdx = worldPageSrc.indexOf('data-testid="world-voice-modes"');
    const guardIdx = worldPageSrc.lastIndexOf("{!isGuest && status === \"inside\" && (", voiceIdx);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(voiceIdx - guardIdx).toBeLessThan(1000);
  });

  it("no guest-facing sign-in in the world chrome points at a bare /login anymore", () => {
    expect(worldPageSrc).not.toContain('href="/login"');
    expect(stationPanelSrc).not.toContain('href="/login"');
    expect(stationPanelSrc).toContain("GUEST_SIGN_IN_HREF");
  });
});
