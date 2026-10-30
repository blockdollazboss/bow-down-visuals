/**
 * Stack1000 N4 — touch patterns 2.5: M4's named observations,
 * adopted. M4 landed the pattern families and deliberately left
 * three remainders; this lane is those remainders, class-string
 * only:
 *
 *  1. The five identical h-6 w-11 hand-rolled switches on the 2D
 *     site that M4's census listed but its brief didn't cover.
 *     Four are button-is-track and adopt .bdv-touch-switch (hit
 *     height 44 on coarse pointers, drawn box unmoved). The
 *     fifth — LeaderboardWidget — differs in structure: its
 *     track is a visual span inside a full-row button ≈56px
 *     tall, so the control already clears the floor; it is
 *     exempt and the exemption is pinned below.
 *
 *  2. The w-10 h-6 sibling tracks M4's literal census missed
 *     (spelled width-first, or w-10 wide): seven more
 *     button-is-track switches at the same 24px height. They
 *     adopt the same class; the halo lands their hit HEIGHT on
 *     44 while their drawn width stays 40 — the pins record
 *     both halves of that.
 *
 *  3. M4's two observed controls: ReportButton's text variant
 *     (~16px) and post.tsx's filled CTA pill (36px — two
 *     instances of one string). Both are standalone controls;
 *     both take the K2 negative-margin pattern with the slot
 *     math pinned so no page's spacing moves.
 *
 *  Plus the labelled inline switch buttons (label + h-5 w-9
 *  track in one flex button, ~20px): QuestsWidget already wore
 *  bdv-touch-target for this exact markup; its unwearing twins
 *  (CreationStreakWidget, SceneStudio draft-mode) adopt it.
 *
 *  JOIN NOTE: the .bdv-touch-switch rules are replicated here
 *  byte-for-byte from M4 (this lane branches off origin/main,
 *  which does not carry M4's unmerged CSS — the E2/D2 stack900
 *  precedent). At the stack1000 join keep exactly ONE copy.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const css = read("../index.css");
const finalVideoExport = read("../components/FinalVideoExport.tsx");
const dropsWire = read("../components/discovery/DropsWire.tsx");
const generateAudio = read("../components/editor/music/GenerateAudio.tsx");
const yourOwnTag = read("../components/producer-tag/YourOwnTag.tsx");
const leaderboardWidget = read("../components/retention/LeaderboardWidget.tsx");
const discordAnnounce = read("../components/DiscordAnnounceModal.tsx");
const discordWebhook = read("../components/DiscordWebhookSettings.tsx");
const goLive = read("../pages/go-live.tsx");
const broadcastStudio = read("../components/go-live/BroadcastStudio.tsx");
const liveStageDesk = read("../components/go-live/LiveStageDesk.tsx");
const creationStreak = read("../components/CreationStreakWidget.tsx");
const quests = read("../components/QuestsWidget.tsx");
const sceneStudio = read("../components/SceneStudio.tsx");
const reportButton = read("../components/social/ReportButton.tsx");
const post = read("../pages/post.tsx");
const uiSwitch = read("../components/ui/switch.tsx");
const wallpapersDesk = read("../components/wallpapers/WallpapersDesk.tsx");
const carouselMaker = read("../pages/carousel-maker.tsx");

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe("touch patterns 2.5: the switch utility (replicated from M4)", () => {
  it("defines the switch utility exactly once, inside the coarse block", () => {
    expect(count(css, "\n  .bdv-touch-switch {")).toBe(1);
    expect(count(css, "\n  .bdv-touch-switch::after {")).toBe(1);
    const mediaIdx = css.indexOf("@media (pointer: coarse)");
    expect(mediaIdx).toBeGreaterThan(-1);
    expect(css.indexOf(".bdv-touch-switch {")).toBeGreaterThan(mediaIdx);
  });

  it("the halo is 10px above and below — 24 + 10 + 10 = a 44px hit height", () => {
    expect(css).toContain("inset: -10px 0");
  });

  it("the switch rules paint nothing — no background, no colour, no border", () => {
    const start = css.indexOf(".bdv-touch-switch {");
    const rules = css.slice(start, css.indexOf("\n}\n", start));
    for (const banned of ["background", "color:", "border"]) {
      expect(rules.includes(banned), banned).toBe(false);
    }
  });
});

describe("touch patterns 2.5: the named five h-6 w-11 switches", () => {
  it("FinalVideoExport's watermark switch wears the halo, drawn box unmoved", () => {
    expect(finalVideoExport).toContain(
      "h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer bdv-touch-switch",
    );
    expect(finalVideoExport).toContain("top-0.5 h-5 w-5");
  });

  it("DropsWire's For You switch — both colour arms wear it", () => {
    expect(count(dropsWire, "h-6 w-11")).toBe(2);
    expect(count(dropsWire, "bdv-touch-switch")).toBe(2);
    expect(dropsWire).toContain("top-0.5 h-5 w-5");
  });

  it("GenerateAudio's instrumental switch wears the halo", () => {
    expect(generateAudio).toContain("h-6 w-11 rounded-full transition bdv-touch-switch");
    expect(generateAudio).toContain("top-0.5 h-5 w-5");
  });

  it("YourOwnTag's stamp switch wears the halo", () => {
    expect(yourOwnTag).toContain("transition-colors shrink-0 bdv-touch-switch");
    expect(yourOwnTag).toContain("top-0.5 h-5 w-5");
  });

  it("LeaderboardWidget is exempt: its track is a span inside a ~56px full-row button", () => {
    expect(leaderboardWidget).not.toContain("bdv-touch-switch");
    /* the control is the row button (py-2.5 + two-line label), not the span */
    expect(leaderboardWidget).toContain(
      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5",
    );
    expect(leaderboardWidget).toContain(
      "relative h-6 w-11 shrink-0 rounded-full transition-colors",
    );
  });
});

describe("touch patterns 2.5: the w-10 h-6 sibling tracks (sweep finds)", () => {
  it("the three @everyone toggles wear the halo — every instance, no bare left", () => {
    for (const src of [discordAnnounce, discordWebhook, goLive]) {
      expect(count(src, "w-10 h-6")).toBe(1);
      expect(count(src, "bdv-touch-switch")).toBe(1);
      expect(src).toContain(
        "w-10 h-6 rounded-full transition-colors relative bdv-touch-switch",
      );
    }
  });

  it("BroadcastStudio's mirror / ticketed / isClass tracks all wear it", () => {
    expect(count(broadcastStudio, "h-6 w-10")).toBe(3);
    expect(count(broadcastStudio, "bdv-touch-switch")).toBe(3);
  });

  it("LiveStageDesk's shared Toggle wears it once — every rider rides it", () => {
    expect(count(liveStageDesk, "h-6 w-10")).toBe(1);
    expect(count(liveStageDesk, "bdv-touch-switch")).toBe(1);
  });
});

describe("touch patterns 2.5: labelled inline switch buttons (the QuestsWidget pattern)", () => {
  it("QuestsWidget already wore bdv-touch-target for this exact markup", () => {
    expect(quests).toContain("transition-colors bdv-touch-target");
    expect(quests).toContain("h-5 w-9");
  });

  it("CreationStreakWidget's twin toggle adopts it, track unmoved", () => {
    expect(creationStreak).toContain(
      "hover:text-white/80 transition-colors bdv-touch-target",
    );
    expect(creationStreak).toContain("h-5 w-9");
  });

  it("SceneStudio's draft-mode toggle adopts it, track unmoved", () => {
    expect(sceneStudio).toContain("hover:text-white transition bdv-touch-target");
    expect(sceneStudio).toContain("h-5 w-9");
  });
});

describe("touch patterns 2.5: M4's two observed controls", () => {
  it("ReportButton's text variant lands on 44 (py-3.5 -my-3.5), footprint unchanged", () => {
    expect(reportButton).toContain(
      "inline-flex items-center gap-1 py-3.5 -my-3.5 text-[11px] font-semibold",
    );
    expect(reportButton).not.toContain(
      "gap-1 text-[11px] font-semibold text-white/35 transition",
    );
  });

  it("ReportButton's icon default is untouched by this lane", () => {
    expect(reportButton).toContain("rounded-full p-2 text-neutral-400");
  });

  it("post.tsx's filled CTA pill — both instances land on 44, slot rebalanced", () => {
    expect(count(post, "px-5 py-3 text-sm font-bold")).toBe(2);
    expect(count(post, "px-5 py-2 text-sm font-bold")).toBe(0);
    expect(count(post, "mt-4 -mb-1 inline-flex")).toBe(2);
  });
});

describe("touch patterns 2.5: the exempt set stays exempt (different shapes)", () => {
  it("the Radix ui/switch primitive (h-5 w-9) is a design-system contract, untouched", () => {
    expect(uiSwitch).toContain("h-5 w-9");
    expect(uiSwitch).not.toContain("bdv-touch-switch");
  });

  it("the h-7 w-12 tracks (WallpapersDesk ×2, carousel-maker) — the halo is calibrated for h-6", () => {
    expect(count(wallpapersDesk, "h-7 w-12")).toBe(2);
    expect(wallpapersDesk).not.toContain("bdv-touch-switch");
    expect(carouselMaker).not.toContain("bdv-touch-switch");
  });

  it("BroadcastStudio's hotkeys track (h-5 w-9, button-is-track) is a different height class", () => {
    expect(broadcastStudio).toContain("h-5 w-9 rounded-full transition ${hotkeysOn");
    expect(broadcastStudio).not.toContain(
      "h-5 w-9 rounded-full transition bdv-touch-switch",
    );
  });
});
