/**
 * Touch targets (Q194, stack900 world-touch lane) — the World's
 * operation controls at a thumb's size.
 *
 * The census behind this file: the World's movement layer was
 * already whole for touch (stick, drag-look, Sprint hold, Jump,
 * prompts — sprint.test.ts pins the pace seam), but the chrome
 * around it was drawn as one compact furniture set for a cursor:
 * 26–37px pills, chips and icon buttons, every one of them a
 * control a phone walker must hit to operate the World. The fix
 * is two utility classes whose rules live ONLY inside a
 * (pointer: coarse) media block in index.css — on touch devices
 * the controls grow to a 44px minimum; a fine pointer's World
 * is pixel-for-pixel unchanged, and no pad or keyboard path is
 * touched. These pins keep both halves of that bargain: the
 * classes exist, they are media-gated, and every operation
 * control wears one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const worldPageSrc = readFileSync(
  new URL("../../pages/world.tsx", import.meta.url),
  "utf8",
);
const sceneSrc = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");
const stationPanelSrc = readFileSync(
  new URL("../../components/world/StationPanel.tsx", import.meta.url),
  "utf8",
);
const switchSrc = readFileSync(
  new URL("../../components/world/SwitchToWebsite.tsx", import.meta.url),
  "utf8",
);
const bellSrc = readFileSync(
  new URL("../../components/world/WorldNotificationsBell.tsx", import.meta.url),
  "utf8",
);
const objectiveSrc = readFileSync(
  new URL("../../components/world/ObjectiveStrip.tsx", import.meta.url),
  "utf8",
);

/** The class a testid's control wears: className follows the
 *  testid inside the same opening tag cluster in this page's
 *  JSX, so a bounded forward window is the house source pin
 *  (the pattern sprint.test.ts established). */
function wears(src: string, testid: string, cls: string): boolean {
  const i = src.indexOf(`data-testid="${testid}"`);
  if (i < 0) return false;
  return src.slice(i, i + 900).includes(cls);
}
function wearsDynamic(src: string, testidPrefix: string, cls: string): boolean {
  const i = src.indexOf(`data-testid={\`${testidPrefix}`);
  if (i < 0) return false;
  return src.slice(i, i + 900).includes(cls);
}

describe("the coarse-pointer rules — 44px, and ONLY on coarse pointers", () => {
  it("defines both utilities at 44px inside the pointer:coarse block", () => {
    const mediaIdx = css.indexOf("@media (pointer: coarse)");
    expect(mediaIdx).toBeGreaterThan(-1);
    const block = css.slice(mediaIdx, mediaIdx + 900);
    expect(block).toContain(".bdv-touch-target");
    expect(block).toContain("min-height: 44px");
    expect(block).toContain(".bdv-touch-box");
    expect(block).toContain("min-width: 44px");
    /* Text fields wearing the target take a 16px font on coarse
     * pointers — below it iOS zooms the page on focus. */
    expect(block).toContain("input.bdv-touch-target");
    expect(block).toContain("font-size: 16px");
  });

  it("defines them nowhere else — a fine pointer never sees them", () => {
    /* Line-start definitions: the textarea arm of the input rule
     * also ends in the class name, so the pin counts the rules'
     * own selector lines, not every mention. */
    expect(css.split("\n  .bdv-touch-target {").length - 1).toBe(1);
    expect(css.split("\n  .bdv-touch-box {").length - 1).toBe(1);
    const mediaIdx = css.indexOf("@media (pointer: coarse)");
    expect(css.indexOf(".bdv-touch-target {")).toBeGreaterThan(mediaIdx);
    expect(css.indexOf(".bdv-touch-box {")).toBeGreaterThan(mediaIdx);
  });
});

describe("the world strip — the touch family's verbs", () => {
  it("Interact, Claim, Sprint, Jump and Photo all wear the target", () => {
    for (const id of [
      "world-strip-interact",
      "world-strip-claim",
      "world-strip-sprint",
      "world-strip-jump",
      "world-strip-photo",
    ]) {
      expect(wears(worldPageSrc, id, "bdv-touch-target"), id).toBe(true);
    }
  });

  it("the action bar's buttons and page tabs wear it too", () => {
    /* ActionButton renders every world-action-<id> button. */
    const ab = worldPageSrc.indexOf("function ActionButton");
    expect(worldPageSrc.slice(ab, ab + 1400)).toContain("bdv-touch-target");
    expect(wearsDynamic(worldPageSrc, "world-action-page-", "bdv-touch-target")).toBe(true);
  });
});

describe("the doors — header, prompts, panels and their returns", () => {
  it("header doors: announcements, fullscreen, quality, view, character, website, bell", () => {
    for (const id of [
      "world-announce-toggle",
      "world-fullscreen",
      "world-quality-control",
      "world-view-toggle",
      "world-change-character",
    ]) {
      expect(wears(worldPageSrc, id, "bdv-touch-target"), id).toBe(true);
    }
    expect(wears(switchSrc, "world-switch-to-website", "bdv-touch-target")).toBe(true);
    expect(wears(bellSrc, "world-notifications-bell", "bdv-touch-target")).toBe(true);
  });

  it("the walk-up prompts: station Open and courtesy Perform", () => {
    expect(wears(worldPageSrc, "world-station-open", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-courtesy-perform", "bdv-touch-target")).toBe(true);
  });

  it("panel doors ride panelBtnCls, which wears the target once for all of them", () => {
    const i = worldPageSrc.indexOf("const panelBtnCls");
    expect(worldPageSrc.slice(i, i + 300)).toContain("bdv-touch-target");
    expect(worldPageSrc).toContain("className={panelBtnCls(screenPanelOpen)}");
    expect(worldPageSrc).toContain("className={panelBtnCls(hostPanelOpen)}");
  });

  it("the panels' own returns: station close, station return, studio return", () => {
    expect(wears(stationPanelSrc, "world-station-close", "bdv-touch-target")).toBe(true);
    expect(wears(stationPanelSrc, "world-station-return", "bdv-touch-target")).toBe(true);
    expect(wears(stationPanelSrc, "world-studio-return", "bdv-touch-target")).toBe(true);
  });

  it("the fullscreen re-enter chip — the touch walker's way back in", () => {
    expect(wears(worldPageSrc, "world-fs-reenter", "bdv-touch-target")).toBe(true);
  });
});

describe("the room's working controls", () => {
  it("claims and money: King claim, drop claim, stage tips, tutorial claim", () => {
    expect(wears(worldPageSrc, "world-king-claim", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-drop-claim", "bdv-touch-target")).toBe(true);
    expect(wearsDynamic(worldPageSrc, "world-stage-tip-", "bdv-touch-target")).toBe(true);
    expect(objectiveSrc).toContain(
      'className="bdv-touch-target inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-2.5 py-0.5',
    );
  });

  it("navigation and summons: directory rooms, summons Go, radio, jukebox", () => {
    expect(wears(worldPageSrc, "world-directory-room", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-party-summons-go", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-plaza-radio-open", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-jukebox-hear", "bdv-touch-target")).toBe(true);
  });

  it("the screen panel: take the stage, play/pause (panelBtnCls), end, video picks", () => {
    expect(wears(worldPageSrc, "world-stage-live", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-screen-playpause", "panelBtnCls")).toBe(true);
    expect(wears(worldPageSrc, "world-stage-end", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-screen-video", "bdv-touch-target")).toBe(true);
  });

  it("voice: mode radios, character voice, join, mic toggle, retry, leave", () => {
    expect(wearsDynamic(worldPageSrc, "world-voice-mode-", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-character-voice-switch", "bdv-touch-target")).toBe(true);
    expect(wears(worldPageSrc, "world-voice-retry", "bdv-touch-target")).toBe(true);
    expect(worldPageSrc).toContain(
      'className="bdv-touch-target inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"',
    ); /* Join voice */
    expect(worldPageSrc).toContain(
      "bdv-touch-target inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${muted ?",
    ); /* Mic live / Muted toggle */
    /* Both Leave voice buttons ride the shared header-door string. */
    expect(
      worldPageSrc.split("bdv-touch-target inline-flex items-center gap-2 rounded-full border px-4 py-2").length - 1,
    ).toBeGreaterThanOrEqual(6);
  });

  it("host controls: mute, lock, remove, door lock, lift lock, herald send", () => {
    for (const id of [
      "world-host-mute",
      "world-host-lock-person",
      "world-host-remove",
      "world-host-door-lock",
      "world-host-unlock-person",
    ]) {
      expect(wears(worldPageSrc, id, "bdv-touch-target"), id).toBe(true);
    }
    expect(worldPageSrc).toContain(
      'className="bdv-touch-target rounded-full border border-[#d4af37] bg-[#d4af37]/15 px-4 py-2 text-sm font-black',
    );
  });

  it("typing: the say and herald fields wear the target (44px + the 16px rule)", () => {
    /* Exact-string pins: both inputs carry their className
     * before the testid, outside the window helper's reach. */
    expect(worldPageSrc).toContain(
      "className={`bdv-touch-target min-w-0 flex-1 rounded-full border px-4 py-2 text-sm outline-none",
    );
    expect(worldPageSrc).toContain(
      "className={`bdv-touch-target min-w-[220px] flex-1 rounded-full border px-4 py-2 text-sm font-semibold outline-none",
    );
    expect(worldPageSrc).toContain('data-testid="world-say-input"');
    expect(worldPageSrc).toContain('data-testid="world-herald-input"');
  });
});

describe("the icon-only controls wear the box, not the pill", () => {
  it("announce dismiss and the radio close grow to a 44px square on touch", () => {
    expect(wears(worldPageSrc, "world-announce-dismiss", "bdv-touch-box")).toBe(true);
    expect(wears(worldPageSrc, "world-plaza-radio-close", "bdv-touch-box")).toBe(true);
  });

  it("the say row's send and emoji buttons wear the box", () => {
    expect(worldPageSrc).toContain(
      'className="bdv-touch-box rounded-full bg-[#d4af37] p-2.5 text-black',
    );
    expect(worldPageSrc).toContain("buttonClassName={`bdv-touch-box rounded-full border p-2");
  });
});

describe("coverage floor — the treatment cannot silently thin out", () => {
  it("world.tsx + the chrome components carry the full set", () => {
    const all = worldPageSrc + stationPanelSrc + switchSrc + bellSrc + objectiveSrc;
    expect(all.split("bdv-touch-target").length - 1).toBeGreaterThanOrEqual(67);
    expect(all.split("bdv-touch-box").length - 1).toBeGreaterThanOrEqual(4);
  });
});

describe("the touch layer stays independent — pad and mouse untouched", () => {
  it("the canvas touch branch keys on pointerType touch, never on pad state", () => {
    const i = sceneSrc.indexOf('e.pointerType === "touch"');
    expect(i).toBeGreaterThan(-1);
    /* The stick-claim window around the branch consults no
     * gamepad: touch claims its zone on its own facts. */
    const branch = sceneSrc.slice(i - 200, i + 400);
    expect(branch).not.toContain("gamepad");
    expect(branch).not.toContain("padPanelHold");
  });

  it("pointer lock stays a mouse-only act", () => {
    expect(sceneSrc).toContain('if (e.pointerType === "mouse")');
    expect(sceneSrc).toContain("canvas.requestPointerLock?.()");
  });

  it("the stick still merges into the same move axes as every family", () => {
    expect(sceneSrc).toContain("strafe += this.stick.dx");
    expect(sceneSrc).toContain("fwd += -this.stick.dy");
  });
});
