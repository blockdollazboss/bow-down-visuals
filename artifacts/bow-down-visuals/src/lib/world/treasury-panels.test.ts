/**
 * treasury-panels.test.ts — Lane 8, the Treasury verification pass
 * (NATIVE-PLAN §2 footnotes + §4 step 4).
 *
 * Verdict on the claim under test: the Treasury's three custom
 * panels complete their interactions in-world.
 * - Daily Drop (treasury-daily): GET /api/bonus/status, then
 *   POST /api/bonus/claim-daily — claimed where you stand.
 * - Shark Drops (treasury-shark): GET /api/bonus/hourly-crate-status
 *   + POST /api/bonus/spin-wheel (the hourly crate), and
 *   GET /api/retention/shark-drop + POST /api/retention/shark-drop/claim
 *   (the personal drop) — both claimed where you stand.
 * - Quest Board (treasury-quests): the embedded QuestsWidget reads
 *   GET /api/retention/quests, claims via POST
 *   /api/retention/quests/claim and toggles via PATCH
 *   /api/retention/prefs — all in-world.
 *
 * Two pull-up remnants were found INSIDE the embedded website
 * components and fixed in this lane. Both components render in
 * StationPanel OUTSIDE the in-panel router, under the world page's
 * own router — so their wouter <Link>s were same-tab navigations
 * that ejected the walker from /world entirely:
 * - DailyDropCard's CTA → the day's drop tool (drop.href);
 * - QuestsWidget's unfinished-quest action → the quest's tool
 *   (meta.href).
 * The fix is panel-scoped and zero-behavior on the website: both
 * components take an optional `inWorld` prop (default off — the
 * dashboard and the social rail render them exactly as before);
 * StationPanel passes it, and in-world those two actions render as
 * explicit transfers — plain anchors, target="_blank" — the
 * framework's TransferFooter shape (NATIVE-PLAN §3.0): the tool
 * opens in a new tab, the palace session stays where it was.
 *
 * Re-skin: SKIPPED for the components' internals, deliberately.
 * Both components are shared with website pages (dashboard;
 * DailyDropCard also rides the social retention rail), so any
 * class change inside them would repaint the website — outside
 * this lane's zero-behavior mandate. A panel-level wrapper cannot
 * recolor their internal rows without fragile descendant CSS. The
 * in-world delta is therefore the transfer anchors above plus the
 * palace frame the panels already wear. (Noted for a future lane:
 * QuestsWidget's unfinished-quest rows keep a dark gradient slab
 * in light theme — a website-shared surface, to be fixed at the
 * component for BOTH homes or not at all.)
 *
 * These are source-contract pins in the repo's established style:
 * they fail if a Treasury panel regains a page-router call, if a
 * claim rail moves, or if the in-world transfer shape is lost.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stationPanel = read("../../components/world/StationPanel.tsx");
const dailyDropCard = read("../../components/DailyDropCard.tsx");
const questsWidget = read("../../components/QuestsWidget.tsx");

/** Slice one component's body out of StationPanel.tsx. */
function panelBody(startMarker: string, endMarker: string): string {
  const start = stationPanel.indexOf(startMarker);
  const end = stationPanel.indexOf(endMarker, start + 1);
  expect(start, startMarker).toBeGreaterThanOrEqual(0);
  expect(end, endMarker).toBeGreaterThan(start);
  return stationPanel.slice(start, end);
}

const dailyBody = panelBody("function TreasuryDaily", "function TreasuryShark");
const sharkBody = panelBody("function TreasuryShark", "function TreasuryQuests");
const questsBody = panelBody("function TreasuryQuests", "/* ─── The Music Hall jukebox");

describe("the Treasury panels resolve from the host's custom switch", () => {
  it("the host mounts exactly the three Treasury customs", () => {
    expect(stationPanel).toContain('case "treasury-daily":');
    expect(stationPanel).toContain('case "treasury-shark":');
    expect(stationPanel).toContain('case "treasury-quests":');
    expect(stationPanel).toContain("return <TreasuryDaily");
    expect(stationPanel).toContain("return <TreasuryShark");
    expect(stationPanel).toContain("return <TreasuryQuests");
  });
});

describe("Daily Drop — the claim completes in-world", () => {
  it("rides the bonus rails and nothing else outbound", () => {
    expect(dailyBody).toContain('fetch("/api/bonus/status"');
    expect(dailyBody).toContain('fetch("/api/bonus/claim-daily"');
    expect(dailyBody).toContain('method: "POST"');
    expect(dailyBody).toContain('data-testid="world-treasury-claim-daily"');
  });

  it("never calls the page router and holds no same-tab link", () => {
    expect(dailyBody).not.toContain("onOpenPage");
    expect(dailyBody).not.toContain("PanelRouter");
    expect(dailyBody).not.toContain("<Link");
    expect(dailyBody).not.toContain("window.location");
  });

  it("embeds the day's drop card in its in-world form", () => {
    expect(dailyBody).toContain("<DailyDropCard inWorld />");
    expect(dailyDropCard).toContain('fetch("/api/retention/daily-drop"');
  });
});

describe("Shark Drops — crate and drop both claim in-world", () => {
  it("rides the crate and shark-drop rails", () => {
    expect(sharkBody).toContain('fetch("/api/bonus/hourly-crate-status"');
    expect(sharkBody).toContain('fetch("/api/bonus/spin-wheel"');
    expect(sharkBody).toContain('fetch("/api/retention/shark-drop"');
    expect(sharkBody).toContain('fetch("/api/retention/shark-drop/claim"');
    expect(sharkBody).toContain('data-testid="world-treasury-claim-crate"');
    expect(sharkBody).toContain('data-testid="world-treasury-claim-drop"');
  });

  it("holds no link, no page-router call, no navigation at all", () => {
    expect(sharkBody).not.toContain("onOpenPage");
    expect(sharkBody).not.toContain("PanelRouter");
    expect(sharkBody).not.toContain("<Link");
    expect(sharkBody).not.toContain("href");
    expect(sharkBody).not.toContain("window.location");
  });
});

describe("Quest Board — track and claim ride the widget's rails, in-world", () => {
  it("the host mounts the widget in its in-world form", () => {
    expect(questsBody).toContain("<QuestsWidget");
    expect(questsBody).toContain("inWorld");
    expect(questsBody).toContain("onBalanceChange={refreshProfile}");
  });

  it("the widget's rails are the retention quest rails", () => {
    expect(questsWidget).toContain('fetch("/api/retention/quests"');
    expect(questsWidget).toContain('fetch("/api/retention/quests/claim"');
    expect(questsWidget).toContain('fetch("/api/retention/prefs"');
  });

  it("the Treasury host's quest panel never calls the page router", () => {
    expect(questsBody).not.toContain("onOpenPage");
    expect(questsBody).not.toContain("PanelRouter");
    expect(questsBody).not.toContain("<Link");
  });
});

/* ─── Ring 2 (2.20–2.22) ─────────────────────────────────────────────
   The Quest Board's depth: completable quests, the trophy ledger,
   the full catalog. The mapping and shaping are unit-tested
   against the real functions; the wiring is pinned as source
   contracts in this file's established style. */
import {
  DAILY_QUEST_TITLES,
  IN_WORLD_QUEST_KEYS,
  TUTORIAL_LEDGER_TITLE,
  claimableVb,
  dailyQuestName,
  dailyQuestTitle,
  historyTotalVb,
  ledgerEntryKindLabel,
  normalizeLeaderboard,
  normalizeQuestMarksBoard,
  normalizeTreasuryHistory,
  questDestination,
  questObjective,
} from "./treasury-quests";
import { STATION_BY_ID } from "./stations";
import { resolveStationPanel } from "./station-panel";

const depthsPanel = read("../../components/world/native/TreasuryQuestDepths.tsx");
const worldPage = read("../../pages/world.tsx");

describe("2.20 — every quest's 'go do it' resolves somewhere honest", () => {
  it("the creation quests open their in-world desks", () => {
    expect(questDestination("make-thumbnail")).toMatchObject({ kind: "station", stationId: "thumbnail-desk", stationName: "Thumbnail Desk" });
    expect(questDestination("generate-song")).toMatchObject({ kind: "station", stationId: "song-desk", stationName: "Song Desk" });
    expect(questDestination("export-video")).toMatchObject({ kind: "station", stationId: "visual-vibes-editor", stationName: "Visual Vibes Editor" });
  });

  it("every station destination is a real registry door in the Create Wing", () => {
    for (const key of IN_WORLD_QUEST_KEYS) {
      const dest = questDestination(key);
      expect(dest?.kind).toBe("station");
      if (dest?.kind === "station") {
        expect(STATION_BY_ID.get(dest.stationId)?.roomId).toBe("world:create-wing");
        expect(dest.roomName).toBe("the Create Wing");
      }
    }
  });

  it("viral-sharer completes in-world too — the Cover Art Desk's share chip records on the tracked share rail", () => {
    expect(questDestination("viral-sharer")).toMatchObject({ kind: "station", stationId: "cover-art-desk", stationName: "Cover Art Desk" });
  });

  it("every quest in the server's weekly catalog now resolves to an in-world station (round 2)", () => {
    /* The weekly keys are the whole catalog QUEST_DEFS serves —
       and every daily def's baseKey is one of these four, so the
       trio inherits the same completion paths. */
    for (const key of ["make-thumbnail", "generate-song", "export-video", "viral-sharer"]) {
      expect(questDestination(key)?.kind).toBe("station");
    }
    expect([...IN_WORLD_QUEST_KEYS].sort()).toEqual(
      ["export-video", "generate-song", "make-thumbnail", "viral-sharer"],
    );
  });

  it("a quest the palace can't place wears its honest label on the board — 'On the website', never a bare arrow", () => {
    expect(questsWidget).toContain("world-quest-elsewhere-${q.key}");
    expect(questsWidget).toContain("world-daily-elsewhere-${q.key}");
    expect(questsWidget).toContain("On the website");
  });

  it("an unknown quest key resolves to null (the board falls back to the quest's own transfer — never a dead button)", () => {
    expect(questDestination("some-future-quest")).toBeNull();
    expect(questDestination("")).toBeNull();
  });

  it("the widget wires station quests to the host opener and keeps the transfer for the rest", () => {
    expect(questsWidget).toContain("onGoToStation");
    expect(questsWidget).toContain("questDestination(q.key)");
    expect(questsWidget).toContain("world-quest-go-${q.key}");
    expect(questsWidget).toContain('dest?.kind === "station" && onGoToStation');
    // The transfer path survives for transfer quests and handler-less renders.
    expect(questsWidget).toContain('dest?.kind === "transfer" ? dest.href : meta.href');
  });

  it("the host and the page carry the generalized station opener", () => {
    expect(stationPanel).toContain("onOpenStation?: (stationId: string) => void");
    expect(questsBody).toContain("onGoToStation={onOpenStation}");
    expect(questsBody).toContain("<TreasuryQuestDepths");
    expect(worldPage).toContain("onOpenStation={(stationId) => {");
    expect(worldPage).toContain('STATION_BY_ID.get(stationId)');
  });
});

describe("Ring 2 addendum — objectives read as a game, completion is a moment", () => {
  it("questObjective derives fraction, percent and state from server progress only", () => {
    expect(questObjective({ key: "viral-sharer", progress: 2, target: 3, completed: false, claimed: false }))
      .toEqual({ key: "viral-sharer", progress: 2, target: 3, percent: 67, state: "active" });
    expect(questObjective({ key: "generate-song", progress: 1, target: 1, completed: true, claimed: false }).state).toBe("claimable");
    expect(questObjective({ key: "generate-song", progress: 1, target: 1, completed: true, claimed: true }).state).toBe("claimed");
    expect(questObjective({ key: "x", progress: 0, target: 0, completed: false, claimed: false }).percent).toBe(0);
  });

  it("claimableVb sums only completed, unclaimed, payable rewards", () => {
    expect(claimableVb([
      { reward: 80, completed: true, claimed: false },
      { reward: 40, completed: true, claimed: true },
      { reward: 120, completed: false, claimed: false },
      { reward: 0, completed: true, claimed: false },
    ])).toBe(80);
  });

  it("the in-world board announces a claimable objective with its VB total", () => {
    expect(questsWidget).toContain("world-quest-claimable-banner");
    expect(questsWidget).toContain("claimableVb(data.quests)");
    expect(questsWidget).toContain("retention.quest_objective_complete");
  });
});

describe("2.21 + 2.22 — the trophy ledger and catalog shape server truth only", () => {
  const payload = {
    catalog: [
      { key: "generate-song", target: 1, reward: 80, kinds: ["song"] },
      { key: "viral-sharer", target: 3, reward: 60, kinds: ["share"] },
    ],
    weeks: [
      {
        weekStart: "2026-10-05",
        quests: [
          { key: "generate-song", target: 1, reward: 80, progress: 1, completed: true, claimed: true, claimedAt: "2026-10-06T12:00:00.000Z" },
        ],
      },
    ],
    entries: [
      { kind: "crate", key: null, amount: 500, at: "2026-10-15T11:05:00.000Z" },
      { kind: "daily-quest", key: "daily-song-spark", amount: 10, at: "2026-10-15T08:00:00.000Z" },
      { kind: "king-gift", key: null, amount: 25, at: "2026-10-14T20:00:00.000Z" },
      { kind: "tutorial", key: null, amount: 30, at: "2026-10-13T12:05:00.000Z" },
      { kind: "quest", key: "generate-song", amount: 80, at: "2026-10-06T12:00:00.000Z" },
      { kind: "shark-drop", key: null, amount: 350, at: "2026-10-04T09:30:00.000Z" },
    ],
  };

  it("a well-formed history payload normalizes whole", () => {
    const h = normalizeTreasuryHistory(payload);
    expect(h).not.toBeNull();
    expect(h!.catalog).toHaveLength(2);
    expect(h!.weeks[0]!.quests[0]).toMatchObject({ key: "generate-song", claimed: true });
    expect(h!.entries).toHaveLength(6);
    expect(historyTotalVb(h!.entries)).toBe(995);
  });

  it("malformed payloads normalize to null — the error state, never invented rows", () => {
    expect(normalizeTreasuryHistory(null)).toBeNull();
    expect(normalizeTreasuryHistory({})).toBeNull();
    expect(normalizeTreasuryHistory({ catalog: [], weeks: [], entries: [{ kind: "daily", amount: 5, at: "x" }] })).toBeNull();
    expect(normalizeTreasuryHistory({ catalog: [{ key: "x" }], weeks: [], entries: [] })).toBeNull();
  });

  it("an empty history is valid and totals zero", () => {
    const h = normalizeTreasuryHistory({ catalog: [], weeks: [], entries: [] });
    expect(h).toEqual({ catalog: [], dailyCatalog: [], today: "", weeks: [], entries: [] });
    expect(historyTotalVb(h!.entries)).toBe(0);
  });

  it("ledger kinds name themselves; daily claims are not a kind (no per-claim rail exists)", () => {
    expect(ledgerEntryKindLabel("quest")).toBe("Quest reward");
    expect(ledgerEntryKindLabel("shark-drop")).toBe("Shark drop");
    expect(ledgerEntryKindLabel("crate")).toBe("Hourly crate");
    // "daily" (the Daily Drop bonus claim) stays an invalid kind in
    // the malformed-payload test above — it keeps no per-claim row.
    // The Daily QUEST Trio is a different system with real rows:
    expect(ledgerEntryKindLabel("daily-quest")).toBe("Daily quest");
    expect(ledgerEntryKindLabel("king-gift")).toBe("The King's gift");
    expect(ledgerEntryKindLabel("tutorial")).toBe("Tutorial reward");
  });

  it("daily-quest rows name the quest from the server's def names; the tutorial names itself", () => {
    expect(dailyQuestTitle("daily-song-spark")).toBe("Song Spark");
    expect(dailyQuestTitle("daily-marathon-cut")).toBe("Marathon Cut");
    expect(Object.keys(DAILY_QUEST_TITLES)).toHaveLength(7);
    // An unknown future key degrades to the raw key, never a blank.
    expect(dailyQuestTitle("daily-something-new")).toBe("daily-something-new");
    expect(dailyQuestTitle(null)).toBe("Daily quest");
    expect(TUTORIAL_LEDGER_TITLE).toBe("Your First 10 Minutes");
  });

  it("the ledger is members-only territory — guests get the pitch and never mount the panel", () => {
    const board = STATION_BY_ID.get("quest-board")!;
    expect(board.membersOnly).toBe(true);
    expect(resolveStationPanel(board, true).type).toBe("guest-pitch");
    expect(resolveStationPanel(board, false).type).toBe("custom");
    // …and the ledger's only read rides the member's auth headers.
    expect(depthsPanel).toContain("Authorization: `Bearer ${token}`");
  });

  it("the leaderboard normalizes the site's rows and refuses junk", () => {
    const board = normalizeLeaderboard({
      weekStart: "2026-10-12T00:00:00.000Z",
      rows: [{ rank: 1, name: "Creator", creations: 4, exports: 2, score: 6, isYou: true }],
      viewerRank: 1,
      viewerScore: 6,
    });
    expect(board!.rows[0]).toMatchObject({ rank: 1, name: "Creator", score: 6, isYou: true });
    expect(board!.viewerRank).toBe(1);
    expect(normalizeLeaderboard({ rows: "nope" })).toBeNull();
    expect(normalizeLeaderboard(null)).toBeNull();
  });

  it("the depths panel rides the real rails and carries its honest states", () => {
    expect(depthsPanel).toContain('fetch("/api/retention/quests/history"');
    expect(depthsPanel).toContain('fetch("/api/retention/streak"');
    expect(depthsPanel).toContain('fetch("/api/bonus/status"');
    expect(depthsPanel).toContain('fetch("/api/retention/leaderboard"');
    expect(depthsPanel).toContain('data-testid="world-treasury-depths"');
    expect(depthsPanel).toContain('data-testid="world-treasury-status-strip"');
    expect(depthsPanel).toContain("NativeErrorState");
    expect(depthsPanel).toContain("NativeEmptyState");
    // Amounts render from the payloads only — the claimed total is
    // the ledger sum, rows show their recorded entry amount.
    expect(depthsPanel).toContain("historyTotalVb(history.entries)");
    expect(depthsPanel).toContain("e.amount.toLocaleString");
    expect(depthsPanel).toContain("c.reward > 0");
    // The Ring 3/4 sources render under their own names.
    expect(depthsPanel).toContain("dailyQuestTitle(e.key)");
    expect(depthsPanel).toContain("TUTORIAL_LEDGER_TITLE");
  });
});

describe("2.22 completed — the full catalog (both slates), trio days in past weeks, the Quest Marks board", () => {
  const fullPayload = {
    catalog: [{ key: "generate-song", name: "Generate a song", target: 1, reward: 80, kinds: ["song"] }],
    dailyCatalog: [
      { key: "daily-song-spark", name: "Song Spark", baseKey: "generate-song", target: 1, rewardVb: 10, marks: 5, kinds: ["song"], liveToday: true },
      { key: "daily-first-frame", name: "First Frame", baseKey: "make-thumbnail", target: 1, rewardVb: 10, marks: 5, kinds: ["thumbnail"], liveToday: false },
    ],
    today: "2026-10-19",
    weeks: [
      {
        weekStart: "2026-10-12",
        quests: [
          { key: "generate-song", target: 1, reward: 80, progress: 1, completed: true, claimed: true, claimedAt: "2026-10-13T10:00:00.000Z" },
        ],
        daily: [
          { day: "2026-10-14", key: "daily-song-spark", progress: 1, target: 1, completed: true, claimed: true, claimedAt: "2026-10-14T20:00:00.000Z", rewardVb: 10, marks: 5 },
          { day: "2026-10-15", key: "daily-first-frame", progress: 0, target: 1, completed: false, claimed: false, claimedAt: null, rewardVb: null, marks: 0 },
        ],
      },
    ],
    entries: [],
  };

  it("the catalog carries BOTH slates — weekly defs and the trio's whole pool, live flags intact", () => {
    const h = normalizeTreasuryHistory(fullPayload);
    expect(h).not.toBeNull();
    expect(h!.catalog[0]).toMatchObject({ key: "generate-song", name: "Generate a song", reward: 80 });
    expect(h!.dailyCatalog).toHaveLength(2);
    expect(h!.dailyCatalog[0]).toMatchObject({ key: "daily-song-spark", name: "Song Spark", rewardVb: 10, marks: 5, liveToday: true });
    expect(h!.dailyCatalog[1]!.liveToday).toBe(false);
    expect(h!.today).toBe("2026-10-19");
  });

  it("past weeks carry the member's trio days with their recorded claim amounts", () => {
    const h = normalizeTreasuryHistory(fullPayload);
    const daily = h!.weeks[0]!.daily;
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({ day: "2026-10-14", claimed: true, rewardVb: 10, marks: 5 });
    expect(daily[1]).toMatchObject({ day: "2026-10-15", claimed: false, rewardVb: null, marks: 0 });
    // A past day names itself from the catalog — never a client-side pool copy.
    expect(dailyQuestName(h!.dailyCatalog, "daily-song-spark")).toBe("Song Spark");
    expect(dailyQuestName(h!.dailyCatalog, "daily-unknown")).toBeNull();
  });

  it("a present-but-malformed trio field fails the payload; an absent one defaults empty", () => {
    expect(normalizeTreasuryHistory({ ...fullPayload, dailyCatalog: [{ key: "x" }] })).toBeNull();
    expect(normalizeTreasuryHistory({ ...fullPayload, weeks: [{ weekStart: "2026-10-12", quests: [], daily: [{ day: "x" }] }] })).toBeNull();
    const legacy = normalizeTreasuryHistory({ catalog: [], weeks: [{ weekStart: "2026-10-12", quests: [] }], entries: [] });
    expect(legacy).not.toBeNull();
    expect(legacy!.dailyCatalog).toEqual([]);
    expect(legacy!.weeks[0]!.daily).toEqual([]);
  });

  it("the Quest Marks board normalizes the server's standings and refuses junk", () => {
    const board = normalizeQuestMarksBoard({
      rows: [{ rank: 1, name: "Bea", marks: 45, claims: 9, isYou: false }],
      viewer: { marks: 10, claims: 2, rank: 4, listed: true },
    });
    expect(board).toEqual({
      rows: [{ rank: 1, name: "Bea", marks: 45, claims: 9, isYou: false }],
      viewerMarks: 10,
      viewerClaims: 2,
      viewerRank: 4,
      viewerListed: true,
    });
    expect(normalizeQuestMarksBoard({ rows: [] })).toBeNull();
    expect(normalizeQuestMarksBoard(null)).toBeNull();
    expect(normalizeQuestMarksBoard({ rows: [{ rank: 1 }], viewer: { marks: 0, claims: 0 } })).toBeNull();
  });

  it("the depths panel rides the marks rail and keeps the trio + marks surfaces labeled as their own", () => {
    expect(depthsPanel).toContain('fetch("/api/retention/quests/leaderboard"');
    expect(depthsPanel).toContain("normalizeQuestMarksBoard");
    expect(depthsPanel).toContain('data-testid="world-treasury-daily-catalog"');
    expect(depthsPanel).toContain('data-testid="world-treasury-marks-board"');
    expect(depthsPanel).toContain("Quest marks — all time");
    // The trio's amounts render from the payload — def reward + marks, row stamps.
    expect(depthsPanel).toContain("d.marks");
    expect(depthsPanel).toContain("d.rewardVb");
  });

  it("guests never reach the depths: the Quest Board station is members-only, so no fetch fires", () => {
    const station = STATION_BY_ID.get("quest-board");
    expect(station).toBeDefined();
    expect(station!.membersOnly).toBe(true);
  });
});

describe("the two pull-up remnants — fixed as explicit in-world transfers", () => {
  it("DailyDropCard: inWorld renders a new-tab anchor; the website keeps its Link", () => {
    expect(dailyDropCard).toContain("inWorld = false");
    expect(dailyDropCard).toContain('target="_blank"');
    expect(dailyDropCard).toContain('rel="noopener noreferrer"');
    // The website default is untouched: the same wouter Link.
    expect(dailyDropCard).toContain("<Link href={drop.href}");
  });

  it("QuestsWidget: inWorld renders a new-tab anchor; the website keeps its Link", () => {
    expect(questsWidget).toContain("inWorld = false");
    expect(questsWidget).toContain('target="_blank"');
    expect(questsWidget).toContain('rel="noopener noreferrer"');
    expect(questsWidget).toContain("<Link href={meta.href}>");
  });

  it("the claim flows are untouched by the transfer shape", () => {
    // The quest claim button still posts the claim rail directly;
    // the transfer anchor only replaces the unfinished-quest action.
    expect(questsWidget).toContain("onClick={() => void claim(q.key)}");
    expect(dailyBody).toContain("onClick={claim}");
    expect(sharkBody).toContain("onClick={claimCrate}");
    expect(sharkBody).toContain("onClick={claimDrop}");
  });
});
