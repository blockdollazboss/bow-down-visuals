/**
 * scenes-desk-components — stack1500 world parity wave #3
 * item 16 source-contract pins. The Local Scenes desk must
 * sit in the Community Hall stack as a board desk
 * ({ isLight } — the rails are public, guests browse in
 * full), with:
 * - the directory rendered from the shaped city rows, and
 *   each city's page in-panel: window chips (today / week /
 *   all), creators, shows, and both chart halves;
 * - the no-scene state said plainly (the rail's 404 wording,
 *   never a dressed-up empty shell) and a separate load-
 *   failure state with a retry;
 * - no auth or spend path anywhere (public rails);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/ScenesDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the board-desk shape + the Hall mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function ScenesDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-scenes-desk"');
  });

  it("StationPanel stacks it at the Community Hall board behind a DeskDoor", () => {
    expect(panel).toContain('const ScenesDesk = lazy(() => import("@/components/world/native/ScenesDesk")');
    expect(panel).toContain("<ScenesDesk isLight={isLight} />");
  });
});

describe("the scene in-panel", () => {
  it("directory, windows, creators, shows, both chart halves", () => {
    for (const needle of [
      'data-testid="world-scenes-desk-directory"',
      "SCENE_WINDOWS.map",
      'data-testid="world-scenes-desk-detail"',
      "worldCreateMedia.scenesCreatorsHeading",
      "worldCreateMedia.scenesComingUp",
      "worldCreateMedia.scenesChartTracks",
      "worldCreateMedia.scenesChartVideos",
      "fetchSceneDirectory()",
      "fetchScene(slug, win)",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the no-scene state is plain; the failure state retries", () => {
    expect(desk).toContain('data-testid="world-scenes-desk-noscene"');
    expect(desk).toContain("worldCreateMedia.scenesNoScene");
    expect(desk).toContain('data-testid="world-scenes-desk-failed"');
    expect(desk).toContain("worldCreateMedia.tryAgain");
  });

  it("public rails: no auth headers, no spend path", () => {
    expect(desk).not.toContain("useDeskAuthHeaders");
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("useConfirmedApi");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
