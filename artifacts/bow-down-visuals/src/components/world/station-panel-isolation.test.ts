/**
 * station-panel-isolation.test.ts — Stack-200 hardening wave,
 * section C (census item 31): error isolation in the World
 * StationPanel.
 *
 * The defects: (1) the entire `custom` station branch returned
 * bare — KingdomBoard, FrontRow, the Treasury customs and every
 * DeskDoor custom — so one desk throw took down the whole /world
 * page (canvas, HUD, presence); (2) inside the covered native
 * branch, ONE PanelBoundary wrapped whole stacks — Community
 * Hall's 7 desks and the My Studio region's desk sections — so one
 * bad desk blanked all its neighbours; (3) NowPlayingCard sat
 * outside any boundary.
 *
 * The fix: the custom body rides a PanelBoundary (reset key = the
 * custom panel id) at the render site; every DeskDoor inside the
 * Community Hall stack and the shared native-stacks region gets
 * its OWN PanelBoundary; NowPlayingCard is wrapped. PanelBoundary
 * itself is the World's pre-existing boundary class — extracted
 * from StationPanel.tsx and converted from JSX to createElement
 * form (components/world/panel-boundary.ts, the section-boundary
 * core pattern) with its rendered HTML proven byte-identical to
 * the JSX version in both themes before the JSX file was removed.
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PanelBoundary } from "./panel-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const panelSource = read("./StationPanel.tsx");
const appSource = read("../../App.tsx");

function makeBoundary(resetKey: string, child: ReactElement) {
  return new PanelBoundary({
    isLight: false,
    resetKey,
    children: child,
  });
}

function failWith(boundary: PanelBoundary) {
  Object.assign(
    boundary.state,
    PanelBoundary.getDerivedStateFromError(),
  );
}

describe("world stack shape — one bad desk never blanks its neighbours", () => {
  it("a failed desk shows the palace fallback; sibling desks render; App-level copy absent", () => {
    const board = makeBoundary(
      "community-hall",
      createElement("p", null, "HALL BOARD"),
    );
    const groups = makeBoundary(
      "community-hall",
      createElement("p", null, "GROUPS DESK"),
    );
    const grants = makeBoundary(
      "community-hall",
      createElement("p", null, "GRANTS DESK"),
    );
    failWith(groups);

    const html = [
      renderToStaticMarkup(board.render() as ReactElement),
      renderToStaticMarkup(groups.render() as ReactElement),
      renderToStaticMarkup(grants.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("HALL BOARD");
    expect(html).toContain("GRANTS DESK");
    expect(html).toContain("This desk wouldn’t open in the palace");
    expect(html).toContain("Try again");
    expect(html).not.toContain("GROUPS DESK");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });

  it("a healthy desk renders its children untouched (no wrapper markup)", () => {
    const desk = makeBoundary(
      "my-studio",
      createElement("p", { className: "desk-body" }, "STUDIO DESK"),
    );
    const html = renderToStaticMarkup(desk.render() as ReactElement);
    expect(html).toBe('<p class="desk-body">STUDIO DESK</p>');
  });
});

describe("StationPanel.tsx — census-31 structure (source pins)", () => {
  it("the custom branch body is bounded at the render site, keyed by the custom panel id", () => {
    expect(panelSource).toContain(
      'resolution?.type === "custom" ? (',
    );
    expect(panelSource).toContain(
      "<PanelBoundary isLight={isLight} resetKey={resolution.id}>",
    );
    expect(panelSource).toContain("{boundedBody}");
  });

  it("every DeskDoor in the Community Hall + native-stacks regions rides its own PanelBoundary (54 desks)", () => {
    /* 46 at the D5 lane; JOIN12: the four Stack-200 World-parity
       desks (Trend Radar bench, Remix feed, Repurpose, Video
       Studio) joined the same regions, each riding its own
       boundary the same way — the honest joined count was 50.
       Stack 300 world-new-benches: Dream Collab + Link To Hit
       joined the board on the same resetKey, and the Hook Desk
       split (four benches stacked under it on their own keys)
       duplicated the Create desk's render site into two
       branches — the honest count was 53. Stack 400 (B-08):
       the Chat Speak bench joined the board on its own
       resetKey — the honest count is 54. (The B-06 Avatar
       Presenter bench rides a suffixed resetKey in the
       create-pattern chain, outside this count's pattern.) */
    expect(
      panelSource.match(
        /<PanelBoundary isLight=\{isLight\} resetKey=\{station\.id\}><DeskDoor isLight=\{isLight\}>/g,
      ) ?? [],
    ).toHaveLength(54);
  });

  it("NowPlayingCard is wrapped in its own boundary", () => {
    expect(panelSource).toContain(
      '<PanelBoundary isLight={isLight} resetKey="now-playing">',
    );
    expect(panelSource).toContain(
      "<NowPlayingCard player={shelfPlayer} isLight={isLight} />",
    );
  });
});
