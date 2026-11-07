/**
 * remix-desk-components — stack200 world parity lane B1,
 * census item 2 source-contract pins. The Remix Trends desk
 * must sit in the My Studio board stack beside the Library
 * and Templates desks as an ({ isLight, onOpenStation }) desk,
 * with:
 * - the feed rendered from the seam (the page's catalog data,
 *   category chips, trend scores, platform tags) and the
 *   page's own empty-category line;
 * - Remix riding onOpenStation to the editor station with the
 *   seam's payload — no fetch, no rail, no charge, no 2D link
 *   out of the palace;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/RemixDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the board mount", () => {
  it("is an ({ isLight, onOpenStation }) desk rooted at its testid", () => {
    expect(desk).toContain("export function RemixDesk({");
    expect(desk).toContain('data-testid="world-remix-desk"');
    expect(desk).toContain("onOpenStation?: (stationId: string, payload?: PanelPayload | null) => void");
  });

  it("StationPanel stacks it at the My Studio board beside Templates, behind a DeskDoor", () => {
    expect(panel).toContain('const RemixDesk = lazy(() => import("@/components/world/native/RemixDesk")');
    expect(panel).toContain("<RemixDesk isLight={isLight} onOpenStation={props.onOpenStation} />");
    expect(panel.indexOf("<RemixDesk")).toBeGreaterThan(panel.indexOf("<TemplatesDesk"));
    expect(panel.indexOf("<RemixDesk")).toBeLessThan(panel.indexOf("<CatalogImportDesk"));
  });
});

describe("the feed — the catalog's own rows", () => {
  it("renders through the seam: categories, filter state, per-preset cards", () => {
    for (const needle of [
      "REMIX_CATEGORIES.map",
      "remixPresetsFor(category)",
      'data-testid="world-remix-desk-categories"',
      'data-testid="world-remix-desk-feed"',
      "p.trendScore",
      "p.platform.map",
      't("worldRemixDesk.empty")',
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("fetches nothing and charges nothing — the feed is the catalog", () => {
    expect(desk).not.toContain("fetch(");
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("/api/");
  });
});

describe("the handoff — through the channel, never a page link", () => {
  it("Remix opens the editor station carrying the seam's payload", () => {
    expect(desk).toContain("onOpenStation?.(REMIX_EDITOR_STATION_ID, payload)");
    expect(desk).toContain("remixPayloadFor(preset)");
    expect(desk).toContain("`world-remix-desk-use-${p.slug}`");
  });

  it("never links out to the 2D editor page", () => {
    expect(desk).not.toContain("/video-editor");
    expect(desk).not.toContain("<Link");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
