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
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  latestActivityLine,
  normalizeStudioProjects,
  normalizeStudioStrip,
  studioProjectLabel,
} from "./studio-board";
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
