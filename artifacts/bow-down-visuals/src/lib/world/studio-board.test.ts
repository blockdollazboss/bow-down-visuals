/**
 * studio-board — the Studio Board's pure shaping (NATIVE-PLAN §3.1).
 *
 * Pins:
 * - project rows keep the dashboard's exact label fallback chain
 *   (title → "artist — song" → type) and the server's newest-first
 *   order; rows without an id are skipped (Continue seeds the
 *   editor BY id — an id-less row could only dead-end);
 * - the streak strip reads bonus/status defensively (no streak →
 *   no strip, never a guessed flame);
 * - the Continue seam (source pins): the board's only project
 *   action calls onContinueProject(id), and the panel host renders
 *   the SAME StepThroughEditor the editor door uses, seeded via
 *   editorStepthroughSearch — no new editor plumbing, no page.
 *
 * P3-E pins:
 * - the deeper tabs shape the /my-projects page's own rails
 *   (drafts / generated-clips / generation-history) with the page's
 *   own label chains — nothing renamed, nothing invented;
 * - the away digest is the dashboard's rail: {show:false} reasons
 *   are states (off / first-visit / caught-up), never errors, and a
 *   {show:true} digest's lines are its own fields verbatim;
 * - the sponsor pipeline mirrors dashboard.tsx's derivation
 *   exactly (closed stages out, whole-dollar total, freshest
 *   active deal is next);
 * - next moves are the dashboard's rules over real state — no
 *   state, no move (except the trend look it always offers).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  historyStatusWord,
  latestActivityLine,
  normalizeSponsorPipeline,
  normalizeStudioClips,
  normalizeStudioDigest,
  normalizeStudioDrafts,
  normalizeStudioHistory,
  normalizeStudioProjects,
  normalizeStudioStrip,
  studioNextMoves,
  studioProjectLabel,
  summarizeContests,
  STUDIO_PROJECT_TABS,
} from "./studio-board";
import type { WorldContest } from "./contests";
import { editorStepthroughSearch } from "./station-panel";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const boardSrc = read("../../components/world/native/boards/StudioBoard.tsx");
const stationPanelSrc = read("../../components/world/StationPanel.tsx");

describe("studioProjectLabel — the dashboard's fallback chain", () => {
  it("prefers the title", () => {
    expect(studioProjectLabel({ title: "My Film", artist_name: "A", song_title: "S", project_type: "T" })).toBe("My Film");
  });
  it("falls back to artist — song, then to the project type", () => {
    expect(studioProjectLabel({ artist_name: "Ada", song_title: "Gold", project_type: "Make a Song" })).toBe("Ada — Gold");
    expect(studioProjectLabel({ song_title: "Gold", project_type: "Make a Song" })).toBe("Gold");
    expect(studioProjectLabel({ project_type: "Make a Song" })).toBe("Make a Song");
    expect(studioProjectLabel({})).toBe("Untitled project");
  });
});

describe("normalizeStudioProjects", () => {
  it("shapes rows in server order, skipping id-less rows", () => {
    const rows = normalizeStudioProjects({
      projects: [
        { id: "p2", title: "Newest", project_type: "Make a Song", created_at: "2026-10-15T00:00:00Z", credits_used: 400 },
        { title: "Ghost — no id", project_type: "Make a Song" },
        { id: "p1", artist_name: "Ada", song_title: "Old Song", project_type: "Make a Song", created_at: "2026-09-01T00:00:00Z" },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["p2", "p1"]);
    expect(rows[0]).toMatchObject({ label: "Newest", creditsUsed: 400 });
    expect(rows[1]!.label).toBe("Ada — Old Song");
  });

  it("an unusable payload is an empty list, never a throw", () => {
    expect(normalizeStudioProjects(null)).toEqual([]);
    expect(normalizeStudioProjects({ projects: "nope" })).toEqual([]);
  });
});

describe("the strip", () => {
  it("reads the streak + bonus balance from bonus/status", () => {
    expect(normalizeStudioStrip({ streak: 6, bonusCredits: 250, canClaimDaily: true })).toEqual({
      streak: 6,
      bonusCredits: 250,
      canClaimDaily: true,
    });
  });
  it("no real streak in the payload → no strip (never a guessed flame)", () => {
    expect(normalizeStudioStrip({})).toBeNull();
    expect(normalizeStudioStrip(null)).toBeNull();
    expect(normalizeStudioStrip({ streak: "six" })).toBeNull();
  });
  it("the latest activity line uses the signed VB rule", () => {
    expect(
      latestActivityLine({ usage: [{ action: "Song generation", creditsUsed: 400 }, { action: "Older", creditsUsed: 1 }] }),
    ).toBe("Latest: Song generation · −400 VB");
    expect(latestActivityLine({ usage: [{ action: "Grant", creditsUsed: -100 }] })).toBe("Latest: Grant · +100 VB");
    expect(latestActivityLine({ usage: [] })).toBeNull();
    expect(latestActivityLine(null)).toBeNull();
  });
});

describe("the Continue seam", () => {
  it("the seed the host's StepThroughEditor mounts is editorStepthroughSearch's", () => {
    expect(editorStepthroughSearch("p2")).toBe("project=p2");
  });

  it("the board's rows ride the plan's endpoints and reuse the vault shaping", () => {
    expect(boardSrc).toContain('fetch("/api/projects"');
    expect(boardSrc).toContain('fetch("/api/bonus/status"');
    expect(boardSrc).toContain('fetch("/api/credits/history"');
    expect(boardSrc).toContain("fetchVaultCharacters(getAccessToken)");
  });

  it("Continue is the rows' only action, and it hands the project id up", () => {
    expect(boardSrc).toContain("onClick={() => onContinueProject(p.id)}");
    expect(boardSrc).toContain('data-testid="world-studio-continue"');
    // No page pull-up from the board itself.
    expect(boardSrc).not.toContain("/video-editor?project=");
    expect(boardSrc).not.toContain("setLocation");
  });

  it("the host renders the shared StepThroughEditor for the board's pick", () => {
    expect(stationPanelSrc).toContain('resolution.pattern === "board" && station.id === "my-studio"');
    expect(stationPanelSrc).toContain("onContinueProject={(projectId) => setBoardProjectId(projectId)}");
    expect(stationPanelSrc).toContain("<StepThroughEditor projectId={boardProjectId} />");
    expect(stationPanelSrc).toContain('data-testid="world-studio-stepthrough"');
    expect(stationPanelSrc).toContain('data-testid="world-studio-return"');
  });
});

describe("the deeper tabs (P3-E)", () => {
  it("the tab model is the page's three deeper views behind the projects", () => {
    expect(STUDIO_PROJECT_TABS.map((t) => t.id)).toEqual(["projects", "drafts", "clips", "history"]);
  });

  it("drafts keep the page's label chain and workflow names", () => {
    const rows = normalizeStudioDrafts({
      drafts: [
        { id: "d1", workflow_type: "make-video", title: "My MV", updated_at: "2026-10-20T00:00:00Z", draft_data: {} },
        {
          id: "d2",
          workflow_type: "song-and-video",
          title: null,
          updated_at: "2026-10-19T00:00:00Z",
          draft_data: { formValues: { artistName: "Ada" } },
        },
        { id: "d3", workflow_type: "mystery", title: null, updated_at: "2026-10-18T00:00:00Z", draft_data: {} },
        { workflow_type: "make-video", title: "Ghost — no id" },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["d1", "d2", "d3"]);
    expect(rows[0]).toMatchObject({ label: "My MV", workflowLabel: "Video for my song" });
    expect(rows[1]).toMatchObject({ label: "Ada", workflowLabel: "Start from scratch" });
    expect(rows[2]).toMatchObject({ label: "Unsaved draft", workflowLabel: "mystery" });
    expect(normalizeStudioDrafts(null)).toEqual([]);
    expect(normalizeStudioDrafts({ drafts: "nope" })).toEqual([]);
  });

  it("clips fall back title → prompt and report a ready video honestly", () => {
    const rows = normalizeStudioClips({
      clips: [
        { id: "c1", title: "Named", prompt: "p", video_url: "https://x/v.mp4", status: "done", created_at: "2026-10-20T00:00:00Z" },
        { id: "c2", title: null, prompt: "a shark at dawn", video_url: null, status: "rendering", created_at: "2026-10-21T00:00:00Z" },
        { id: "c3", title: null, prompt: null, video_url: null, status: "queued", created_at: "2026-10-22T00:00:00Z" },
      ],
    });
    expect(rows[0]).toMatchObject({ label: "Named", hasVideo: true, status: "done" });
    expect(rows[1]).toMatchObject({ label: "a shark at dawn", hasVideo: false });
    expect(rows[2]!.label).toBe("Untitled clip");
    expect(normalizeStudioClips({})).toEqual([]);
  });

  it("history labels ride action → artist/song → type, with the status word honest", () => {
    const rows = normalizeStudioHistory({
      history: [
        { id: "h1", generation_type: "song", action_label: "Song generation", credits_used: 400, save_status: "saved", refunded: false, created_at: "2026-10-20T00:00:00Z" },
        { id: "h2", generation_type: "video", artist_name: "Ada", song_title: "Gold", credits_used: 700, save_status: "save_failed", refunded: true, created_at: "2026-10-19T00:00:00Z" },
        { id: "h3", generation_type: "image", credits_used: 100, save_status: "pending", refunded: false, created_at: "2026-10-18T00:00:00Z" },
      ],
    });
    expect(rows[0]).toMatchObject({ label: "Song generation", creditsUsed: 400 });
    expect(rows[1]!.label).toBe("Ada — Gold");
    expect(rows[2]!.label).toBe("image");
    expect(historyStatusWord(rows[0]!)).toBe("Saved");
    expect(historyStatusWord(rows[1]!)).toBe("Refunded");
    expect(historyStatusWord(rows[2]!)).toBeNull();
    expect(historyStatusWord({ saveStatus: "save_failed", refunded: false })).toBe("Save failed");
    expect(normalizeStudioHistory(null)).toEqual([]);
  });

  it("the tabs ride the page's own rails (source pins)", () => {
    expect(boardSrc).toContain('fetch("/api/drafts"');
    expect(boardSrc).toContain('fetch("/api/generated-clips"');
    expect(boardSrc).toContain('fetch("/api/generation-history"');
    expect(boardSrc).toContain("data-testid={`world-studio-tab-${t.id}`}");
    expect(boardSrc).toContain("STUDIO_PROJECT_TABS.map");
  });
});

describe("the away digest widget (P3-E)", () => {
  it("an unreadable payload hides the widget (null), never a throw", () => {
    expect(normalizeStudioDigest(null)).toBeNull();
    expect(normalizeStudioDigest("nope")).toBeNull();
  });

  it("{show:false} reasons are states, not errors", () => {
    expect(normalizeStudioDigest({ show: false, reason: "disabled" })?.state).toBe("off");
    expect(normalizeStudioDigest({ show: false, reason: "first-visit" })?.state).toBe("first-visit");
    expect(normalizeStudioDigest({ show: false, reason: "recent", hoursAway: 3.2 })).toMatchObject({
      state: "recent",
      hoursAway: 3.2,
    });
  });

  it("a ready digest's lines are its own fields, verbatim", () => {
    const d = normalizeStudioDigest({
      show: true,
      hoursAway: 49.5,
      completedJobs: [{ id: "j1" }, { id: "j2" }],
      failedJobs: 1,
      newProjects: [{ id: "p1", title: "Fresh Cut", projectType: "Make a Song" }],
      bowRace: { period: "2026-10", target: 5000, totalBows: 1250, won: true, youWon: true },
      jackpot: { name: "Golden Hour", prizeCredits: 2500, codeLength: 6, endsAt: "2026-10-30T00:00:00Z" },
      streak: { currentStreak: 4, longestStreak: 9, lastCreationDate: "2026-10-26" },
    });
    expect(d).toMatchObject({ state: "ready", completedJobs: 2, failedJobs: 1, streakDays: 4 });
    expect(d!.newProjectLabels).toEqual(["Fresh Cut"]);
    expect(d!.bowRaceLine).toBe("Bow Race: 1,250 of 5,000 bows — you won it");
    expect(d!.jackpotLine).toBe("Golden Hour: 2,500 VB jackpot live now");
  });

  it("a ready-but-empty digest carries no invented lines", () => {
    const d = normalizeStudioDigest({
      show: true,
      completedJobs: [],
      failedJobs: 0,
      newProjects: [],
      bowRace: null,
      jackpot: null,
      streak: null,
    });
    expect(d).toMatchObject({ state: "ready", completedJobs: 0, failedJobs: 0, bowRaceLine: null, jackpotLine: null, streakDays: null });
    expect(d!.newProjectLabels).toEqual([]);
  });
});

describe("the sponsor pipeline widget (P3-E)", () => {
  const deal = (over: Record<string, unknown>) => ({
    id: "x",
    sponsorName: "Brand",
    stage: "negotiating",
    dealValueCents: 10000,
    updatedAt: "2026-10-20T00:00:00Z",
    ...over,
  });

  it("mirrors the dashboard: closed stages out, whole dollars, freshest active is next", () => {
    const p = normalizeSponsorPipeline({
      deals: [
        deal({ id: "a", sponsorName: "Old Active", dealValueCents: 10050, updatedAt: "2026-10-18T00:00:00Z" }),
        deal({ id: "b", sponsorName: "Fresh Active", dealValueCents: 20000, updatedAt: "2026-10-25T00:00:00Z" }),
        deal({ id: "c", sponsorName: "Paid Out", stage: "paid", dealValueCents: 99900, updatedAt: "2026-10-26T00:00:00Z" }),
        deal({ id: "d", sponsorName: "Dead One", stage: "DEAD", dealValueCents: 5000, updatedAt: "2026-10-26T00:00:00Z" }),
      ],
    });
    expect(p).toEqual({
      activeCount: 2,
      pipelineDollars: 301,
      next: { sponsorName: "Fresh Active", stage: "negotiating" },
    });
  });

  it("an empty rail is a real zero, an unreadable one is null", () => {
    expect(normalizeSponsorPipeline({ deals: [] })).toEqual({ activeCount: 0, pipelineDollars: 0, next: null });
    expect(normalizeSponsorPipeline(null)).toBeNull();
    expect(normalizeSponsorPipeline({ deals: "nope" })).toBeNull();
  });
});

describe("the challenges & contests widget (P3-E)", () => {
  const contest = (over: Partial<WorldContest>): WorldContest => ({
    id: "k1",
    title: "Contest",
    theme: "",
    roomId: "games",
    hostUserId: "u1",
    hostName: "Host",
    startsAt: "2026-10-20T00:00:00Z",
    endsAt: "2026-10-30T00:00:00Z",
    status: "open",
    phase: "open",
    entryCount: 0,
    winners: [],
    ...over,
  });

  it("counts only live phases and names the soonest deadline", () => {
    const s = summarizeContests([
      contest({ id: "a", title: "Later", phase: "open", endsAt: "2026-11-05T00:00:00Z" }),
      contest({ id: "b", title: "Sooner", phase: "judging", endsAt: "2026-10-28T00:00:00Z" }),
      contest({ id: "c", title: "Decided", phase: "decided", endsAt: "2026-10-21T00:00:00Z" }),
      contest({ id: "d", title: "Called off", phase: "called-off", endsAt: "2026-10-22T00:00:00Z" }),
    ]);
    expect(s).toEqual({ liveCount: 2, nextTitle: "Sooner", nextEndsAt: "2026-10-28T00:00:00Z" });
    expect(summarizeContests([])).toEqual({ liveCount: 0, nextTitle: null, nextEndsAt: null });
  });

  it("the widget rides the challenges + contests rails and reuses their shaping (source pins)", () => {
    expect(boardSrc).toContain('fetch("/api/challenges/weekly"');
    expect(boardSrc).toContain('fetch("/api/world/contests"');
    expect(boardSrc).toContain("parseWeeklyContest(");
    expect(boardSrc).toContain("normalizeContests(");
    expect(boardSrc).toContain('data-testid="world-studio-widget-challenges"');
  });
});

describe("the leaderboard + digest + sponsor widgets (source pins)", () => {
  it("ride their own rails and reuse the treasury leaderboard shaping", () => {
    expect(boardSrc).toContain('fetch("/api/retention/leaderboard"');
    expect(boardSrc).toContain("normalizeLeaderboard(");
    expect(boardSrc).toContain('fetch("/api/retention/away-digest"');
    expect(boardSrc).toContain('fetch("/api/wave8/sponsors/deals"');
    expect(boardSrc).toContain('data-testid="world-studio-widget-leaderboard"');
    expect(boardSrc).toContain('data-testid="world-studio-widget-digest"');
    expect(boardSrc).toContain('data-testid="world-studio-widget-sponsors"');
    // The board digest is the dashboard's away digest — never the
    // community group-digest feature (a different rail entirely).
    expect(boardSrc).not.toContain("group-digest");
    expect(boardSrc).not.toContain("groupDigest");
  });
});

describe("next moves (P3-E)", () => {
  it("each move is gated on the real state behind it", () => {
    const bare = studioNextMoves({ latestProject: null, sponsorNextName: null, canClaimDaily: false });
    expect(bare.map((m) => m.kind)).toEqual(["trend"]);

    const withProject = studioNextMoves({
      latestProject: { id: "p9", label: "Half-Done Song" },
      sponsorNextName: null,
      canClaimDaily: false,
    });
    expect(withProject[0]).toMatchObject({ kind: "finish", projectId: "p9" });
    expect(withProject[0]!.title).toContain("Half-Done Song");
  });

  it("caps at three, in the dashboard's order — finish, sponsor, daily, trend", () => {
    const all = studioNextMoves({
      latestProject: { id: "p1", label: "Song" },
      sponsorNextName: "Big Brand",
      canClaimDaily: true,
    });
    expect(all.map((m) => m.kind)).toEqual(["finish", "sponsor", "daily"]);
    const noSponsor = studioNextMoves({
      latestProject: { id: "p1", label: "Song" },
      sponsorNextName: null,
      canClaimDaily: true,
    });
    expect(noSponsor.map((m) => m.kind)).toEqual(["finish", "daily", "trend"]);
  });
});
