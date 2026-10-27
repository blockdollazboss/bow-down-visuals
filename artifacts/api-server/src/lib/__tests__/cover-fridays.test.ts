/**
 * Cover Fridays (lib/cover-fridays, N19) — the weekly house
 * cover ritual over the challenge engine.
 *
 * Pinned contract:
 * - The house theme ALWAYS resolves: the rotation is fixed,
 *   published, and a pure function of the ISO week — no row,
 *   no launch, no admin. A Friday with no theme is impossible.
 * - The King crowns by a published house rule over real
 *   records: most plays takes the crown; votes are only a late
 *   tiebreak — a vote-stuffed cover with fewer plays loses.
 * - The crowning is claimed by the challenge's status flip:
 *   exactly one winner row, exactly one herald, and a week
 *   nobody entered crowns nobody, silently.
 * - The crown lands BY MONDAY: no crowning before the week's
 *   Monday 00:00 UTC, and the current week's challenge is
 *   ensured by the tick, never by an admin.
 */
import { describe, it, expect } from "vitest";
import {
  CoverFridaysScheduler,
  coverChallengeInsert,
  coverChallengeSlug,
  coverFridaysCrownText,
  coverThemeForWeek,
  coverWeekForDate,
  kingPickCover,
  COVER_FRIDAY_THEMES,
  type CoverChallengeRow,
  type CoverEntryInput,
  type CoverFridaysStore,
  type CrownedCover,
} from "../cover-fridays";
import type { PalaceAnnouncement } from "../world-room";

/* ── Fakes ──────────────────────────────────────────────────────── */

function entry(partial: Partial<CoverEntryInput> & { videoId: string }): CoverEntryInput {
  return {
    profileId: `profile-${partial.videoId}`,
    userId: `user-${partial.videoId}`,
    displayName: `Creator ${partial.videoId}`,
    slug: `slug-${partial.videoId}`,
    title: `Cover ${partial.videoId}`,
    thumbnailUrl: null,
    viewCount: 0,
    likeCount: 0,
    voteCount: 0,
    enteredAt: new Date("2026-10-28T00:00:00Z"),
    ...partial,
  };
}

class FakeStore implements CoverFridaysStore {
  challenges = new Map<string, CoverChallengeRow & { title: string }>();
  entries = new Map<string, CoverEntryInput[]>();
  winners: Array<{ challengeId: string; winner: CoverEntryInput }> = [];
  loseClaim = false;
  private seq = 0;

  async getChallenge(slug: string) {
    return this.challenges.get(slug) ?? null;
  }
  async ensureChallenge(row: Parameters<CoverFridaysStore["ensureChallenge"]>[0]) {
    if (this.challenges.has(row.slug)) return false;
    this.challenges.set(row.slug, {
      id: `ch-${++this.seq}`,
      slug: row.slug,
      title: row.title,
      weekKey: row.weekKey,
      status: "live",
      entryCount: 0,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    });
    return true;
  }
  async uncrownedPast(now: Date) {
    return [...this.challenges.values()]
      .filter((c) => c.status !== "winners" && c.endsAt.getTime() < now.getTime())
      .sort((a, b) => (a.weekKey < b.weekKey ? -1 : 1));
  }
  async entriesOf(challengeId: string) {
    return this.entries.get(challengeId) ?? [];
  }
  async claimCrowning(challengeId: string) {
    if (this.loseClaim) return false;
    const row = [...this.challenges.values()].find((c) => c.id === challengeId);
    if (!row || row.status === "winners") return false;
    row.status = "winners";
    return true;
  }
  async recordWinner(challengeId: string, winner: CoverEntryInput) {
    this.winners.push({ challengeId, winner });
  }
  async crownedCovers(): Promise<CrownedCover[]> {
    return [];
  }

  seedPastWeek(entries: CoverEntryInput[]): CoverChallengeRow {
    const info = coverWeekForDate(new Date("2026-10-30T12:00:00Z")); // W44
    const insert = coverChallengeInsert(info);
    void this.ensureChallenge(insert);
    const row = this.challenges.get(info.slug)!;
    this.entries.set(row.id, entries);
    return row;
  }
}

function announceSpy() {
  const calls: PalaceAnnouncement[] = [];
  return { calls, palace: { announce: (a: PalaceAnnouncement) => calls.push(a) } };
}

/* ── The theme (always resolvable) ──────────────────────────────── */

describe("coverThemeForWeek / COVER_FRIDAY_THEMES", () => {
  it("resolves a theme for every ISO week of a year — a Friday with no theme is impossible", () => {
    for (let w = 1; w <= 53; w++) {
      const { theme, index } = coverThemeForWeek(w);
      expect(theme.title.length).toBeGreaterThan(0);
      expect(theme.hashtag.length).toBeGreaterThan(0);
      expect(theme).toBe(COVER_FRIDAY_THEMES[index]);
    }
    // Deterministic: the same week reads the same theme forever.
    expect(coverThemeForWeek(44)).toEqual(coverThemeForWeek(44));
    // Covers only: every theme names a cover assignment.
    for (const t of COVER_FRIDAY_THEMES) {
      expect(t.description.toLowerCase()).toContain("cover");
    }
  });
});

/* ── The week ───────────────────────────────────────────────────── */

describe("coverWeekForDate", () => {
  it("spans Monday→Sunday with the Friday inside and the crowning at next Monday", () => {
    const info = coverWeekForDate(new Date("2026-10-30T15:00:00Z")); // a Friday
    expect(info.weekKey).toBe("2026-W44");
    expect(info.slug).toBe("cover-fridays-2026-w44");
    expect(coverChallengeSlug("2026-W44")).toBe("cover-fridays-2026-w44");
    expect(info.startsAt.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(info.fridayAt.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(info.fridayAt.getUTCDay()).toBe(5);
    expect(info.endsAt.toISOString()).toBe("2026-11-01T23:59:59.000Z");
    expect(info.crownByAt.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("gives the same week from any day inside it", () => {
    const fromMonday = coverWeekForDate(new Date("2026-10-26T00:00:00Z"));
    const fromSunday = coverWeekForDate(new Date("2026-11-01T23:00:00Z"));
    expect(fromSunday.weekKey).toBe(fromMonday.weekKey);
    expect(fromSunday.slug).toBe(fromMonday.slug);
  });
});

/* ── The King's pick ────────────────────────────────────────────── */

describe("kingPickCover", () => {
  it("crowns the most-played cover — votes alone never crown", () => {
    const pick = kingPickCover([
      entry({ videoId: "loved", viewCount: 10, voteCount: 900, likeCount: 90 }),
      entry({ videoId: "played", viewCount: 500, voteCount: 3, likeCount: 40 }),
    ]);
    expect(pick!.videoId).toBe("played");
  });

  it("breaks play ties by likes, then votes, then the earliest entry — total and deterministic", () => {
    const pick = kingPickCover([
      entry({ videoId: "b", viewCount: 100, likeCount: 5, voteCount: 9, enteredAt: new Date("2026-10-29T00:00:00Z") }),
      entry({ videoId: "a", viewCount: 100, likeCount: 5, voteCount: 9, enteredAt: new Date("2026-10-27T00:00:00Z") }),
      entry({ videoId: "c", viewCount: 100, likeCount: 7, voteCount: 0 }),
    ]);
    expect(pick!.videoId).toBe("c"); // likes beat the earlier entry
    const pick2 = kingPickCover([
      entry({ videoId: "b", viewCount: 100, likeCount: 5, voteCount: 9, enteredAt: new Date("2026-10-29T00:00:00Z") }),
      entry({ videoId: "a", viewCount: 100, likeCount: 5, voteCount: 9, enteredAt: new Date("2026-10-27T00:00:00Z") }),
    ]);
    expect(pick2!.videoId).toBe("a"); // earliest entry takes the full tie
  });

  it("crowns nobody in an empty court", () => {
    expect(kingPickCover([])).toBeNull();
  });
});

/* ── The herald ─────────────────────────────────────────────────── */

describe("coverFridaysCrownText", () => {
  it("names the theme, the creator, the cover and the deciding plays", () => {
    const text = coverFridaysCrownText(
      { weekKey: "2026-W44", themeTitle: "Country Roads" },
      entry({ videoId: "v1", displayName: "Sella", title: "Jolene (cover)", viewCount: 1234 }),
    );
    expect(text).toContain("2026-W44");
    expect(text).toContain("Country Roads");
    expect(text).toContain("Sella");
    expect(text).toContain("Jolene (cover)");
    expect(text).toContain("1,234 plays");
  });
});

/* ── The scheduler ──────────────────────────────────────────────── */

describe("CoverFridaysScheduler", () => {
  it("ensures the current week's challenge from its theme — no admin launch", async () => {
    const store = new FakeStore();
    const spy = announceSpy();
    const scheduler = new CoverFridaysScheduler({ palace: spy.palace, store });
    await scheduler.tick(new Date("2026-10-30T12:00:00Z").getTime()); // Friday W44
    const row = await store.getChallenge("cover-fridays-2026-w44");
    expect(row).not.toBeNull();
    expect(row!.status).toBe("live");
    expect(store.challenges.get("cover-fridays-2026-w44")!.title).toBe("Cover Fridays — Country Roads");
    expect(spy.calls).toEqual([]);
  });

  it("does not crown before the week's Monday", async () => {
    const store = new FakeStore();
    store.seedPastWeek([entry({ videoId: "v1", viewCount: 10 })]);
    const spy = announceSpy();
    const scheduler = new CoverFridaysScheduler({ palace: spy.palace, store });
    await scheduler.tick(new Date("2026-11-01T12:00:00Z").getTime()); // Sunday of W44
    expect(store.winners).toEqual([]);
    expect(spy.calls).toEqual([]);
  });

  it("crowns the King's pick on Monday, exactly once, with one herald", async () => {
    const store = new FakeStore();
    const row = store.seedPastWeek([
      entry({ videoId: "quiet", viewCount: 5, voteCount: 100 }),
      entry({ videoId: "played", viewCount: 800, voteCount: 2 }),
    ]);
    const spy = announceSpy();
    const scheduler = new CoverFridaysScheduler({ palace: spy.palace, store });
    const monday = new Date("2026-11-02T00:00:30Z").getTime();
    await scheduler.tick(monday);
    await scheduler.tick(monday);
    expect(store.winners.length).toBe(1);
    expect(store.winners[0]!.challengeId).toBe(row.id);
    expect(store.winners[0]!.winner.videoId).toBe("played");
    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]!.text).toContain("Cover Fridays 2026-W44");
    expect(spy.calls[0]!.roomId).toBe("world:royal-court");
    expect((await store.getChallenge(row.slug))!.status).toBe("winners");
  });

  it("crowns nobody in an empty week — the row flips, no winner, no herald", async () => {
    const store = new FakeStore();
    const row = store.seedPastWeek([]);
    const spy = announceSpy();
    const scheduler = new CoverFridaysScheduler({ palace: spy.palace, store });
    await scheduler.tick(new Date("2026-11-02T00:00:30Z").getTime());
    expect(store.winners).toEqual([]);
    expect(spy.calls).toEqual([]);
    expect((await store.getChallenge(row.slug))!.status).toBe("winners");
  });

  it("stays silent when a twin tick claims the crowning first", async () => {
    const store = new FakeStore();
    store.seedPastWeek([entry({ videoId: "v1", viewCount: 10 })]);
    store.loseClaim = true;
    const spy = announceSpy();
    const scheduler = new CoverFridaysScheduler({ palace: spy.palace, store });
    await scheduler.tick(new Date("2026-11-02T00:00:30Z").getTime());
    expect(store.winners).toEqual([]);
    expect(spy.calls).toEqual([]);
  });
});
