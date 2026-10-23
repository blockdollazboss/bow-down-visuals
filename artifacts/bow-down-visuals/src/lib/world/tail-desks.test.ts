/**
 * tail-desks — Stage D tail (stack-100 #93-remainder, #94, #95, #96,
 * #98 seams).
 *
 * Pins:
 * - #93 the operator's trouble flags ARE content_reports rows and
 *   the in-world moderation bench's queue (GET /api/admin/reports)
 *   serves that table — an operator-flag-shaped row passes the
 *   bench's own normalizer and is recognised, never filtered out;
 * - #94 the account rails are the settings page's verbatim:
 *   retention prefs, delight prefs, the export download, the cursor
 *   store — and the in-world desk NEVER calls DELETE /api/account
 *   (deletion stays behind the 2D type-DELETE confirmation);
 * - #95 the giveaway rails are generate/contests.ts verbatim
 *   (owner-scoped list/detail/entries/verify/draw/announce), the
 *   create gate mirrors createContestSchema, and the announce is
 *   the one charged verb at the server's default 100 VB;
 * - #96 the jackpot rails are cheat-code.ts verbatim (status,
 *   attempt, admin events + activate/deactivate), sequence/prize
 *   bounds mirror the server schema + the admin page's own form,
 *   and the admin surface in-world gates on /api/admin/status;
 * - #98 source pins: the picker carries create/restyle handlers and
 *   world.tsx wires them to the characters.ts vault verbs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MODERATION_QUEUE_PATH, isOperatorFlagRow, operatorFlagsInQueue,
  ACCOUNT_EXPORT_PATH, ACCOUNT_EXPORT_FILENAME, ACCOUNT_DELETE_HANDOFF_PATH,
  RETENTION_PREFS_PATH, DELIGHT_PREFS_PATH, RETENTION_PREF_DEFS, DELIGHT_PREF_DEFS,
  normalizeRetentionPrefs, normalizeDelightPrefs, exportSummary,
  GIVEAWAY_CONTESTS_PATH, giveawayContestPath, giveawayEntriesPath, giveawayEntryPath,
  giveawayDrawPath, giveawayAnnouncePath, GIVEAWAY_ANNOUNCE_COST_VB,
  normalizeGiveawayContests, normalizeGiveawayDetail, giveawayCreateReady, giveawayCreateBody,
  JACKPOT_STATUS_PATH, JACKPOT_ATTEMPT_PATH, JACKPOT_ADMIN_EVENTS_PATH, JACKPOT_ADMIN_STATUS_PATH,
  jackpotAdminEventActionPath, jackpotSequenceReady, jackpotPrizeReady,
  normalizeJackpotStatus, normalizeJackpotAttempt, normalizeJackpotAdminEvents,
  jackpotEventPhase, jackpotCreateBody,
} from "./tail-desks";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desksSrc = read("../../components/world/native/TailDesks.tsx");
const panelSrc = read("../../components/world/StationPanel.tsx");
const pickerSrc = read("../../components/world/WalkInAsPicker.tsx");
const worldSrc = read("../../pages/world.tsx");

describe("#93-remainder — the moderation queue is already the bench's queue", () => {
  it("pins the queue path to the admin reports rail", () => {
    expect(MODERATION_QUEUE_PATH).toBe("/api/admin/reports");
  });

  it("an operator trouble-flag row (profile target, the duty's note) is recognised in the queue payload", () => {
    /* The row shape operator-duties files into content_reports and
       GET /api/admin/reports serves (contentReportDto verbatim). */
    const payload = {
      reports: [
        {
          id: "r-flag", reporterUserId: "thy-cheat-code-house", targetType: "profile",
          targetId: "p-1", targetOwnerUserId: "u-trouble", targetSummary: "Trouble",
          reason: "harassment",
          note: "Operator flag: 3 members reported this member in the last 24 hours. Filed for a human moderator — no automatic action was taken.",
          status: "new", createdAt: "2026-10-22T00:00:00.000Z",
        },
        {
          id: "r-member", reporterUserId: "u-9", targetType: "post",
          targetId: "post-1", targetOwnerUserId: "u-8", targetSummary: "a post",
          reason: "spam", note: "selling stuff", status: "new", createdAt: "2026-10-22T01:00:00.000Z",
        },
      ],
    };
    const flags = operatorFlagsInQueue(payload);
    expect(flags.map((f) => f.id)).toEqual(["r-flag"]);
    expect(isOperatorFlagRow({ targetType: "post", note: "Operator flag: x" })).toBe(false);
    expect(isOperatorFlagRow({ targetType: "profile", note: "member note" })).toBe(false);
    expect(isOperatorFlagRow({ targetType: "profile", note: null })).toBe(false);
  });

  it("the bench renders the flag's note + target in the member-reports queue (source pin)", () => {
    const wave2 = read("../../components/world/native/SocialWave2.tsx");
    expect(wave2).toContain('data-testid="world-moderation-bench"');
    expect(wave2).toContain("r.note");
    expect(wave2).toContain("r.targetSummary");
    /* status verbs ride the same queue item rail */
    expect(wave2).toContain("adminQueueItemPath(kind, id)");
  });
});

describe("#94 account settings — the settings page's own rails", () => {
  it("pins every path verbatim", () => {
    expect(ACCOUNT_EXPORT_PATH).toBe("/api/account/export");
    expect(RETENTION_PREFS_PATH).toBe("/api/retention/prefs");
    expect(DELIGHT_PREFS_PATH).toBe("/api/retention/delight-prefs");
    expect(ACCOUNT_EXPORT_FILENAME).toBe("bow-down-visuals-export.json");
    expect(ACCOUNT_DELETE_HANDOFF_PATH).toBe("/settings");
  });

  it("the switch boards are the pages' boards, in order", () => {
    expect(RETENTION_PREF_DEFS.map((d) => d.key)).toEqual([
      "daily_drop_enabled", "away_digest_enabled", "creation_streaks_enabled",
      "quests_enabled", "login_streaks_enabled", "share_to_earn_enabled",
      "contests_enabled", "fomo_feed_enabled",
    ]);
    expect(DELIGHT_PREF_DEFS.map((d) => d.key)).toEqual([
      "sharkDropsEnabled", "levelCelebrationsEnabled", "leaderboardVisible",
    ]);
  });

  it("prefs normalize with the page's rule: missing reads ON, explicit false stays off", () => {
    const p = normalizeRetentionPrefs({ quests_enabled: false });
    expect(p["quests_enabled"]).toBe(false);
    expect(p["daily_drop_enabled"]).toBe(true);
    const d = normalizeDelightPrefs({ prefs: { leaderboardVisible: false } });
    expect(d["leaderboardVisible"]).toBe(false);
    expect(d["sharkDropsEnabled"]).toBe(true);
    expect(normalizeDelightPrefs(null)["sharkDropsEnabled"]).toBe(true);
  });

  it("the export summary counts what account.ts actually sends", () => {
    const s = exportSummary({
      exportedAt: "2026-10-22T00:00:00.000Z", profile: { id: "u" },
      projects: [1, 2], drafts: [1], clips: [], songs: [1, 2, 3],
    });
    expect(s.exportedAt).toBe("2026-10-22T00:00:00.000Z");
    expect(s.counts).toEqual({ projects: 2, drafts: 1, clips: 0, songs: 3 });
    expect(exportSummary(null).counts).toEqual({ projects: 0, drafts: 0, clips: 0, songs: 0 });
  });

  it("source pins: the desk PATCHes both pref rails, downloads the export, and NEVER deletes", () => {
    expect(desksSrc).toContain("RETENTION_PREFS_PATH");
    expect(desksSrc).toContain('method: "PATCH"');
    expect(desksSrc).toContain("ACCOUNT_EXPORT_PATH");
    expect(desksSrc).toContain("setCursorChoice");
    expect(desksSrc).toContain('data-testid="world-account-delete-handoff"');
    expect(desksSrc).not.toContain('method: "DELETE"');
    expect(desksSrc).not.toContain("/api/account\"");
    /* docked at My Studio beside My Profile */
    expect(panelSrc).toContain("<AccountDesk isLight={isLight} />");
  });
});

describe("#95 giveaway contests — /api/contests verbatim", () => {
  it("pins every path", () => {
    expect(GIVEAWAY_CONTESTS_PATH).toBe("/api/contests");
    expect(giveawayContestPath("c 1")).toBe("/api/contests/c%201");
    expect(giveawayEntriesPath("c1")).toBe("/api/contests/c1/entries");
    expect(giveawayEntryPath("c1", "e1")).toBe("/api/contests/c1/entries/e1");
    expect(giveawayDrawPath("c1")).toBe("/api/contests/c1/draw");
    expect(giveawayAnnouncePath("c1")).toBe("/api/contests/c1/announce");
    expect(GIVEAWAY_ANNOUNCE_COST_VB).toBe(100);
  });

  it("normalizes the list + detail (snake_case entries included)", () => {
    const list = normalizeGiveawayContests({
      contests: [
        { id: "c1", title: "Merch drop", prize: "Signed hoodie", entryMethods: ["follow"], status: "active", entryCount: 2 },
        { junk: true },
        null,
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.entryCount).toBe(2);
    const detail = normalizeGiveawayDetail({
      contest: { id: "c1", title: "Merch drop", prize: "Hoodie", entryMethods: ["follow"], status: "active", winnerEntryId: "e2", drawAudit: { seed: "abc", drawnAt: "2026-10-22T00:00:00Z" } },
      entries: [
        { id: "e1", handle: "@fan", entry_method: "follow", is_verified: false },
        { id: "e2", handle: "@superfan", entry_method: "follow", is_verified: true },
      ],
      stats: { total: 2, verified: 1, byMethod: { follow: 2 } },
    });
    expect(detail?.entries.map((e) => e.handle)).toEqual(["@fan", "@superfan"]);
    expect(detail?.entries[1]?.isVerified).toBe(true);
    expect(detail?.contest.winnerEntryId).toBe("e2");
    expect(detail?.contest.drawAudit?.seed).toBe("abc");
    expect(normalizeGiveawayDetail({ contest: null })).toBeNull();
  });

  it("the create gate mirrors createContestSchema", () => {
    const base = { title: "T", prize: "P", entryMethods: ["follow"] };
    expect(giveawayCreateReady(base)).toBe(true);
    expect(giveawayCreateReady({ ...base, title: "  " })).toBe(false);
    expect(giveawayCreateReady({ ...base, prize: "" })).toBe(false);
    expect(giveawayCreateReady({ ...base, entryMethods: [] })).toBe(false);
    expect(giveawayCreateReady({ ...base, entryMethods: ["teleport"] })).toBe(false);
    expect(giveawayCreateReady({ ...base, startsAt: "2026-10-23T10:00", endsAt: "2026-10-23T09:00" })).toBe(false);
    expect(giveawayCreateReady({ ...base, startsAt: "2026-10-23T09:00", endsAt: "2026-10-23T10:00" })).toBe(true);
  });

  it("the create body sends ISO datetimes and null for empty dates", () => {
    const body = giveawayCreateBody({
      title: " T ", prize: " P ", description: "", rules: "", entryMethods: ["follow"],
      startsAt: "2026-10-23T09:00", endsAt: undefined, status: "bogus",
    });
    expect(body["title"]).toBe("T");
    expect(typeof body["startsAt"]).toBe("string");
    expect(body["endsAt"]).toBeNull();
    expect(body["status"]).toBe("draft");
  });

  it("source pins: the desk rides the rails, the announce is two-tap armed, docked at the Winners' Circle", () => {
    expect(desksSrc).toContain("giveawayEntriesPath(detail.contest.id)");
    expect(desksSrc).toContain("giveawayDrawPath(detail.contest.id)");
    expect(desksSrc).toContain("giveawayAnnouncePath(detail.contest.id)");
    expect(desksSrc).toContain("announceArmed");
    expect(panelSrc).toContain("<GiveawayContestsDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("#96 jackpot — cheat-code.ts verbatim", () => {
  it("pins every path", () => {
    expect(JACKPOT_STATUS_PATH).toBe("/api/cheat-code/status");
    expect(JACKPOT_ATTEMPT_PATH).toBe("/api/cheat-code/attempt");
    expect(JACKPOT_ADMIN_EVENTS_PATH).toBe("/api/cheat-code/admin/events");
    expect(JACKPOT_ADMIN_STATUS_PATH).toBe("/api/admin/status");
    expect(jackpotAdminEventActionPath("e 1", "activate")).toBe("/api/cheat-code/admin/events/e%201/activate");
    expect(jackpotAdminEventActionPath("e1", "deactivate")).toBe("/api/cheat-code/admin/events/e1/deactivate");
  });

  it("sequence + prize bounds mirror the server schema and the admin page's form", () => {
    expect(jackpotSequenceReady(["up", "down", "left", "right"])).toBe(true);
    expect(jackpotSequenceReady(["up", "down", "left"])).toBe(false);
    expect(jackpotSequenceReady(Array(11).fill("up"))).toBe(false);
    expect(jackpotSequenceReady(["up", "down", "left", "sideways"])).toBe(false);
    expect(jackpotPrizeReady(100)).toBe(true);
    expect(jackpotPrizeReady(99)).toBe(false);
    expect(jackpotPrizeReady(1_000_000)).toBe(true);
    expect(jackpotPrizeReady(1_000_001)).toBe(false);
    expect(jackpotPrizeReady(100.5)).toBe(false);
  });

  it("normalizes status, attempt outcomes and the admin event list", () => {
    const s = normalizeJackpotStatus({ phase: "live", name: "October", prizeCredits: 10000, codeLength: 6 });
    expect(s.phase).toBe("live");
    expect(s.codeLength).toBe(6);
    expect(normalizeJackpotStatus({ phase: "weird" }).phase).toBe("none");
    expect(normalizeJackpotStatus(null).phase).toBe("none");
    const o = normalizeJackpotAttempt({ correct: false, claimed: false, triesLeft: 2 });
    expect(o.triesLeft).toBe(2);
    const won = normalizeJackpotAttempt({ correct: true, claimed: true, prizeCredits: 10000, winnerDisplayName: "Nova" });
    expect(won.correct).toBe(true);
    expect(won.prizeCredits).toBe(10000);
    const events = normalizeJackpotAdminEvents({
      events: [
        { id: "e1", name: "A", codeLength: 6, prizeCredits: 10000, isActive: true, winnerUserId: null },
        { id: "e2", name: "B", codeLength: 4, prizeCredits: 500, isActive: false, winnerUserId: "u-1", endsAt: "2020-01-01T00:00:00Z" },
        { nope: 1 },
      ],
    });
    expect(events).toHaveLength(2);
    expect(jackpotEventPhase(events[0]!)).toBe("live");
    expect(jackpotEventPhase(events[1]!)).toBe("claimed");
    expect(jackpotEventPhase({ winnerUserId: null, isActive: false, endsAt: "2020-01-01T00:00:00Z" })).toBe("ended");
    expect(jackpotEventPhase({ winnerUserId: null, isActive: false, endsAt: "2999-01-01T00:00:00Z" })).toBe("upcoming");
  });

  it("the create body matches CreateEventSchema (ISO datetimes, sequence copied)", () => {
    const seq = ["up", "down", "left", "right"];
    const body = jackpotCreateBody({ name: " N ", codeSequence: seq, prizeCredits: 10000, endsAt: "2026-11-01T00:00" });
    expect(body["name"]).toBe("N");
    expect(body["codeSequence"]).toEqual(seq);
    expect(body["codeSequence"]).not.toBe(seq);
    expect(typeof body["endsAt"]).toBe("string");
    expect(body["startsAt"]).toBeUndefined();
  });

  it("source pins: attempt rides the real rail, the admin surface is status-gated, docked at the Winners' Circle", () => {
    expect(desksSrc).toContain("JACKPOT_ATTEMPT_PATH");
    expect(desksSrc).toContain("JACKPOT_ADMIN_STATUS_PATH");
    expect(desksSrc).toContain("isAdmin === true");
    expect(desksSrc).toContain("jackpotAdminEventActionPath");
    expect(panelSrc).toContain("<JackpotDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("#98 picker wiring — create + restyle live where the picker lives", () => {
  it("the picker carries the create strip and the restyle form", () => {
    expect(pickerSrc).toContain('data-testid="walk-in-create-panel"');
    expect(pickerSrc).toContain('data-testid="walk-in-restyle-open"');
    expect(pickerSrc).toContain('data-testid="walk-in-restyle-save"');
    expect(pickerSrc).toContain("onSaveAppearance");
    expect(pickerSrc).toContain("CHARACTER_THEMES");
  });

  it("world.tsx wires all three handlers at both picker mounts", () => {
    expect(worldSrc).toContain("createVaultCharacter");
    expect(worldSrc).toContain("fetchVaultAppearance");
    expect(worldSrc).toContain("saveVaultAppearance");
    expect(worldSrc.match(/onCreate=\{handleCreateVaultCharacter\}/g)).toHaveLength(2);
    expect(worldSrc.match(/onSaveAppearance=\{handleSaveVaultAppearance\}/g)).toHaveLength(2);
  });
});
