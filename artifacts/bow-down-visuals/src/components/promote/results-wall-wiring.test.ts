/**
 * results-wall-wiring.test.ts — Stack-200 #177 source contracts.
 *
 * Pins the docking + honesty shape the board item demands:
 * - the wall docks INSIDE Promote (mounted by pages/promote.tsx) and is
 *   NOT a standalone page: no App.tsx route, no sidebar door, no page
 *   file for it anywhere;
 * - the panel talks to the wall's real endpoints only — the public read,
 *   the owner's /me, the scan, and the two prefs switches;
 * - there is NO client path that creates an event or sends a number:
 *   the only POST is the number-free scan trigger, and no request body
 *   in the panel carries a threshold/value/count;
 * - the example card is badged as an example in the component itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const panel = read("components/promote/ResultsWallPanel.tsx");
const promote = read("pages/promote.tsx");
const app = read("App.tsx");

describe("results wall docking — inside Promote, never standalone", () => {
  it("promote.tsx mounts the panel", () => {
    expect(promote).toContain("ResultsWallPanel");
    expect(promote).toContain("<ResultsWallPanel />");
  });

  it("no route, no page file, no sidebar door exists for the wall", () => {
    expect(app).not.toContain("results-wall");
    expect(app).not.toContain("ResultsWall");
    expect(existsSync(join(SRC, "pages/results-wall.tsx"))).toBe(false);
    const sidebar = read("components/layout/app-sidebar.tsx");
    expect(sidebar).not.toContain("results-wall");
    expect(sidebar).not.toContain("ResultsWall");
  });
});

describe("results wall endpoints — reads + switches + scan, nothing else", () => {
  it("uses the wall's real endpoints", () => {
    expect(panel).toContain("/api/results-wall?limit=50");
    expect(panel).toContain("/api/results-wall/me");
    expect(panel).toContain("/api/results-wall/scan");
    expect(panel).toContain("/api/results-wall/opt-in");
    expect(panel).toContain("/api/results-wall/visibility");
  });

  it("the only POST is the number-free scan trigger", () => {
    const posts = panel.match(/method:\s*"POST"/g) ?? [];
    expect(posts).toHaveLength(1);
    expect(panel).toContain('authedFetch("/api/results-wall/scan", { method: "POST" })');
  });

  it("no request body carries a milestone number", () => {
    for (const field of ["threshold", "value:", "count:", "followers:", "sales:"]) {
      expect(panel).not.toContain(`body: JSON.stringify({ ${field}`);
    }
    // The two switch bodies are booleans / kind lists only.
    expect(panel).toContain("body: JSON.stringify({ optedIn: next })");
    expect(panel).toContain("body: JSON.stringify({ hiddenKinds })");
  });

  it("opt-in defaults are honest — the switch reflects server prefs, not a local guess", () => {
    expect(panel).toContain("checked={me.prefs.optedIn}");
    expect(panel).toContain("Off by default");
  });

  it("the example card is badged as an example in the component", () => {
    expect(panel).toContain("EXAMPLE_WALL_EVENTS");
    // EventCard picks the testid by its `example` flag (ternary in source).
    expect(panel).toContain('"results-wall-example-card"');
    expect(panel).toContain('"results-wall-card"');
    expect(panel).toContain("exampleBadge");
  });

  it("renders both themes via the house light-theme hook", () => {
    expect(panel).toContain("useIsLightTheme");
  });
});
