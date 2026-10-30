/**
 * Widgets Desk wiring (Stack900 C1) — source contracts in the house
 * style of results-wall-wiring.test.ts:
 * - the desk docks INSIDE Promote (mounted by pages/promote.tsx) and is
 *   NOT a standalone page: no App.tsx route, no page file, no sidebar door;
 * - it reads the creator's real inventory from /api/embed/mine (auth)
 *   and the public refcode endpoint — no invented data, no POST anywhere;
 * - previews render the creator's OWN widget at all three widths from
 *   the same WIDGET_DIMS the copied code uses;
 * - a widget the creator can't power yet says so plainly (setup doors),
 *   never a fake preview.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const panel = read("components/promote/WidgetsDeskPanel.tsx");
const promote = read("pages/promote.tsx");
const app = read("App.tsx");

describe("widgets desk docking — inside Promote, never standalone", () => {
  it("promote.tsx mounts the panel", () => {
    expect(promote).toContain("WidgetsDeskPanel");
    expect(promote).toContain("<WidgetsDeskPanel />");
  });

  it("no route, no page file, no sidebar door exists for the desk", () => {
    expect(app).not.toContain("widgets-desk");
    expect(app).not.toContain("WidgetsDesk");
    expect(existsSync(join(SRC, "pages/widgets-desk.tsx"))).toBe(false);
    expect(existsSync(join(SRC, "pages/widgets.tsx"))).toBe(false);
    const sidebar = read("components/layout/app-sidebar.tsx");
    expect(sidebar).not.toContain("WidgetsDesk");
  });
});

describe("widgets desk data — the real inventory only", () => {
  it("reads /api/embed/mine with the session token and the public refcode", () => {
    expect(panel).toContain("/api/embed/mine");
    expect(panel).toContain("Authorization");
    expect(panel).toContain("/api/embed/refcode/");
  });

  it("never POSTs — the desk creates nothing and charges nothing", () => {
    expect(panel).not.toContain('method: "POST"');
    expect(panel).not.toContain("method: 'POST'");
  });
});

describe("widgets desk previews — three widths, one source of sizes", () => {
  it("previews all three device widths and builds code from the same dims", () => {
    expect(panel).toContain("EMBED_SIZE_KEYS.map");
    expect(panel).toContain("WIDGET_DIMS");
    expect(panel).toContain("buildEmbedCode");
    expect(panel).toContain("embedWidgetSrc");
    expect(panel).toContain("<iframe");
  });

  it("offers both themes", () => {
    expect(panel).toContain('"dark"');
    expect(panel).toContain('"light"');
  });
});

describe("widgets desk honesty — unpowered widgets say so", () => {
  it("carries a plain-words setup door for each missing piece", () => {
    expect(panel).toContain("/artist-setup");
    expect(panel).toContain("/tips");
    expect(panel).toContain("/my-shop");
    expect(panel).toContain("previewBlocked");
  });

  it("uses the owner's own plain-words intro", () => {
    expect(panel).toContain("Put your Bow Down on any website");
  });
});
