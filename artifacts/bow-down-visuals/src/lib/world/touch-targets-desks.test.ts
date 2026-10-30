/**
 * Touch targets, second pass (stack900 world-touch-desks lane) —
 * the panel and desk BODY internals at a thumb's size.
 *
 * The first pass (touch-targets.test.ts) lifted the World's own
 * chrome — strip, doors, prompts, returns. This pass drives the
 * same two coarse-pointer utility classes through the bodies the
 * first pass named as its frontier: the WalkInAsPicker strips,
 * the station desks' inner controls, the Charts radio rows, and
 * every native desk's shared class families (chipBtn / inputCls /
 * goldBtn / tabBtn and their per-file twins), so the controls a
 * walker actually works with — fields, chips, queue buttons,
 * claim buttons, checkout buttons — meet the same 44px law.
 *
 * The bargain is unchanged: the rules live ONLY inside the
 * (pointer: coarse) block in index.css; a fine pointer's World
 * is pixel-for-pixel unchanged; no colour or layout token moves
 * in either theme; pad and keyboard paths are untouched (the
 * classes key on the media query alone).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

function src(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const walkIn = src("../../components/world/WalkInAsPicker.tsx");
const station = src("../../components/world/StationPanel.tsx");
const radio = src("../../components/discovery/ChartsRadio.tsx");
const bell = src("../../components/world/WorldNotificationsBell.tsx");

const N = "../../components/world/native/";
const desks: Record<string, string> = {
  ShopStands: src(`${N}ShopStands.tsx`),
  BeatsDesk: src(`${N}BeatsDesk.tsx`),
  BusinessDesks: src(`${N}BusinessDesks.tsx`),
  SocialDesk: src(`${N}SocialDesk.tsx`),
  ShelfPlayer: src(`${N}ShelfPlayer.tsx`),
  CoachPanels: src(`${N}CoachPanels.tsx`),
  AudioDesk: src(`${N}AudioDesk.tsx`),
  AudioDeskTabs: src(`${N}AudioDeskTabs.tsx`),
  CreatorRooms: src(`${N}CreatorRooms.tsx`),
  SongDeskTabs: src(`${N}SongDeskTabs.tsx`),
  CreateDesks: src(`${N}CreateDesks.tsx`),
  CreateDeskShared: src(`${N}CreateDeskShared.tsx`),
  GamesPanels: src(`${N}GamesPanels.tsx`),
  GroupsDesk: src(`${N}GroupsDesk.tsx`),
  SmartCardsStand: src(`${N}SmartCardsStand.tsx`),
  JewelryBench: src(`${N}JewelryBench.tsx`),
  TipJarDesk: src(`${N}TipJarDesk.tsx`),
  SuccessionDesk: src(`${N}SuccessionDesk.tsx`),
  MoneyActionsDesk: src(`${N}MoneyActionsDesk.tsx`),
  PlansDesk: src(`${N}PlansDesk.tsx`),
  DomainsDesk: src(`${N}DomainsDesk.tsx`),
  PortraitTip: src(`${N}PortraitTip.tsx`),
  LiveDesk: src(`${N}LiveDesk.tsx`),
  ChartsBoard: src(`${N}boards/ChartsBoard.tsx`),
  EarningsBoard: src(`${N}boards/EarningsBoard.tsx`),
};
const quests = src("../../components/QuestsWidget.tsx");
const dailyDrop = src("../../components/DailyDropCard.tsx");

/** The class a testid's control wears: className follows the
 *  testid inside the same opening tag cluster, so a bounded
 *  forward window is the house source pin (D2's pattern). */
function wears(s: string, testid: string, cls: string): boolean {
  const i = s.indexOf(`data-testid="${testid}"`);
  if (i < 0) return false;
  return s.slice(i, i + 900).includes(cls);
}
function wearsDynamic(s: string, testidPrefix: string, cls: string): boolean {
  const i = s.indexOf(`data-testid={\`${testidPrefix}`);
  if (i < 0) return false;
  return s.slice(i, i + 900).includes(cls);
}
/** Some tags put className BEFORE the testid — read backwards. */
function wearsBefore(s: string, testid: string, cls: string): boolean {
  const i = s.indexOf(`data-testid="${testid}"`);
  if (i < 0) return false;
  return s.slice(Math.max(0, i - 700), i).includes(cls);
}
/** A shared class family's definition carries the class once,
 *  and every control riding the family inherits it. */
function constWears(s: string, marker: string, cls: string): boolean {
  const i = s.indexOf(marker);
  if (i < 0) return false;
  return s.slice(i, i + 500).includes(cls);
}

describe("the coarse-pointer rules on this base — one copy, media-gated, size only", () => {
  it("defines both utilities at 44px inside the pointer:coarse block", () => {
    const mediaIdx = css.indexOf("@media (pointer: coarse)");
    expect(mediaIdx).toBeGreaterThan(-1);
    const block = css.slice(mediaIdx, mediaIdx + 900);
    expect(block).toContain(".bdv-touch-target");
    expect(block).toContain("min-height: 44px");
    expect(block).toContain(".bdv-touch-box");
    expect(block).toContain("min-width: 44px");
    expect(block).toContain("input.bdv-touch-target");
    expect(block).toContain("font-size: 16px");
  });

  it("defines them nowhere else — a fine pointer never sees them", () => {
    expect(css.split("\n  .bdv-touch-target {").length - 1).toBe(1);
    expect(css.split("\n  .bdv-touch-box {").length - 1).toBe(1);
    const mediaIdx = css.indexOf("@media (pointer: coarse)");
    expect(css.indexOf(".bdv-touch-target {")).toBeGreaterThan(mediaIdx);
    expect(css.indexOf(".bdv-touch-box {")).toBeGreaterThan(mediaIdx);
  });

  it("the coarse block carries size declarations only — no colour, no layout", () => {
    const mediaIdx = css.indexOf("@media (pointer: coarse)");
    /* Bound the window to the media block itself (its closing
     * brace at line start), not whatever section follows it. */
    const blockEnd = css.indexOf("\n}\n", mediaIdx);
    const block = css.slice(mediaIdx, blockEnd);
    for (const banned of ["color:", "background", "border", "margin", "padding", "display:"]) {
      expect(block.includes(banned), banned).toBe(false);
    }
  });
});

describe("the picker and the panel bodies the first pass named", () => {
  it("WalkInAsPicker: the shared field string lifts every create/restyle field", () => {
    expect(constWears(walkIn, "const inputCls", "bdv-touch-target")).toBe(true);
    expect(wearsBefore(walkIn, "walk-in-create-save", "bdv-touch-target")).toBe(true);
    expect(wearsBefore(walkIn, "walk-in-create-close", "bdv-touch-box")).toBe(true);
    expect(wearsBefore(walkIn, "walk-in-manage-close", "bdv-touch-box")).toBe(true);
  });

  it("StationPanel bodies: both chip families, the party field, the treasury verbs", () => {
    expect(constWears(station, "const chipBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(station, "const inputCls", "bdv-touch-target")).toBe(true);
    expect(station).toContain("${chipBtn} bdv-touch-box");
    expect(wears(station, "world-board-room", "bdv-touch-target")).toBe(true);
  });

  it("Charts radio: the rotation rows wear the target (play/skip already carry min-h)", () => {
    expect(radio).toContain("min-h-[44px]");
    /* The rotation rows carry no testid — pin the row literal. */
    expect(radio).toContain(
      "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition bdv-touch-target",
    );
  });

  it("the bell's panel body: mark-all-read wears the target (rows are content-tall)", () => {
    expect(wears(bell, "world-notifications-mark-all", "bdv-touch-target")).toBe(true);
  });
});

describe("the desks' shared families — one lift per family, every rider inherits", () => {
  it("ShopStands: goldBtn(), chipBtn() and inputCls() helpers all wear it", () => {
    const s = desks.ShopStands;
    expect(constWears(s, "function goldBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(s, "function chipBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(s, "function inputCls", "bdv-touch-target")).toBe(true);
    expect(s).toContain("bdv-touch-box");
  });

  it("the desk field family: deskInputCls riders (TipJar, Succession, MoneyActions inputs)", () => {
    expect(desks.TipJarDesk).toContain("deskInputCls(isLight)");
    expect(desks.SuccessionDesk).toContain("deskInputCls(isLight)");
    expect(desks.MoneyActionsDesk).toContain("deskInputCls(isLight)");
    /* The shared helper itself is pinned in CreateDeskShared. */
    expect(constWears(desks.CreateDeskShared, "deskInputCls", "bdv-touch-target")).toBe(true);
  });

  it("per-desk consts: BeatsDesk, CoachPanels smallBtn, AudioDeskTabs chips, SongDeskTabs, CreatorRooms, SocialWave2 riders", () => {
    expect(constWears(desks.CoachPanels, "const smallBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(desks.AudioDeskTabs, "const chipBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(desks.SongDeskTabs, "const tabBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(desks.SongDeskTabs, "const goldBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(desks.CreatorRooms, "const chipCls", "bdv-touch-target")).toBe(true);
    expect(constWears(desks.ChartsBoard, "const actionBtn", "bdv-touch-target")).toBe(true);
    expect(constWears(desks.EarningsBoard, "const tabBtn", "bdv-touch-target")).toBe(true);
  });

  it("Succession + MoneyActions share the px-3 py-1.5 chip shape — both lifted", () => {
    expect(constWears(desks.SuccessionDesk, "const chip", "bdv-touch-target")).toBe(true);
    expect(constWears(desks.MoneyActionsDesk, "const chip", "bdv-touch-target")).toBe(true);
  });
});

describe("named desk controls wear the target (testid pins)", () => {
  it("money doors: domains verify/delete, plans buy/manage, portrait tip send, payout gold", () => {
    expect(wears(desks.DomainsDesk, "world-domains-verify", "bdv-touch-target")).toBe(true);
    expect(wears(desks.DomainsDesk, "world-domains-delete", "bdv-touch-target")).toBe(true);
    expect(wearsDynamic(desks.PlansDesk, "world-plan-buy-", "bdv-touch-target")).toBe(true);
    expect(wears(desks.PlansDesk, "world-plan-manage", "bdv-touch-target")).toBe(true);
    expect(wears(desks.PortraitTip, "world-portrait-tip-send", "bdv-touch-target")).toBe(true);
  });

  it("audio + song bodies: desk tabs, library rows, packs audition, mashup sliders", () => {
    expect(wearsDynamic(desks.AudioDesk, "world-audio-desk-tab-", "bdv-touch-target")).toBe(true);
    expect(wears(desks.AudioDeskTabs, "world-audio-packs-audition", "bdv-touch-target")).toBe(true);
    expect(wears(desks.AudioDeskTabs, "world-audio-library-play", "bdv-touch-target")).toBe(true);
    expect(desks.SongDeskTabs).toContain('className="w-full bdv-touch-target"');
    expect(wears(desks.SongDeskTabs, "world-song-mashup-run", "goldBtn")).toBe(true);
  });

  it("rooms, games, groups: office-hours, party invite, forum backs", () => {
    expect(wearsDynamic(desks.CreatorRooms, "world-office-hours-duration-", "bdv-touch-target")).toBe(true);
    expect(wears(desks.CreatorRooms, "world-room-store-checkout", "bdv-touch-target")).toBe(true);
    expect(wearsDynamic(desks.GamesPanels, "world-party-invite-", "bdv-touch-target")).toBe(true);
    expect(wears(desks.GamesPanels, "world-games-return", "bdv-touch-target")).toBe(true);
    expect(wearsDynamic(desks.GroupsDesk, "world-group-open-", "bdv-touch-target")).toBe(true);
  });

  it("social + shelf: DM gold family, shelf transport, comment post", () => {
    expect(constWears(desks.SocialDesk, "goldBtn", "bdv-touch-target")).toBe(true);
    expect(wears(desks.ShelfPlayer, "world-shelf-playpause", "bdv-touch-target")).toBe(true);
    expect(wears(desks.ShelfPlayer, "world-shelf-comment-post", "bdv-touch-target")).toBe(true);
    expect(wears(desks.ShelfPlayer, "world-shelf-queue-remove", "bdv-touch-box")).toBe(true);
  });

  it("quests + daily drop (the World's shared widgets)", () => {
    expect(wearsDynamic(quests, "world-daily-go-", "bdv-touch-target")).toBe(true);
    expect(wearsDynamic(quests, "world-quest-go-", "bdv-touch-target")).toBe(true);
    expect(dailyDrop.split("bdv-touch-target").length - 1).toBe(2);
  });

  it("advanced expander + draft toggle (CreateDeskShared chrome inside every create desk)", () => {
    expect(wears(desks.CreateDeskShared, "world-create-advanced-toggle", "bdv-touch-target")).toBe(true);
    /* The draft toggle's testid sits on the checkbox INSIDE its
     * label — the class rides the label, which opens BEFORE the
     * input, so this pin reads the label literal directly. */
    expect(desks.CreateDeskShared).toContain(
      'className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold bdv-touch-target"',
    );
    expect(desks.CreateDeskShared).toContain('data-testid="world-clip-draft-toggle"');
  });
});

describe("coverage floor — the pass is broad, not a token gesture", () => {
  const all = [walkIn, station, radio, bell, quests, dailyDrop, ...Object.values(desks)];
  it("at least 150 class applications across the pinned desk set", () => {
    const n = all.reduce(
      (sum, s) => sum + (s.split("bdv-touch-target").length - 1) + (s.split("bdv-touch-box").length - 1),
      0,
    );
    expect(n).toBeGreaterThanOrEqual(150);
  });

  it("every pinned desk file carries at least one application", () => {
    for (const [name, s] of Object.entries(desks)) {
      expect(s.includes("bdv-touch"), name).toBe(true);
    }
  });
});
