/**
 * wave8-benches — Stack 400 world parity (census B-19) seam
 * pins. Every Wave8 single bench must ride its twin's own
 * rail at the registry's price, shape the payload exactly as
 * the twin shapes it, and hold every answer to the twin's
 * real response shape — a drifted payload parses to null,
 * never to a dressed-up result. The six rails span three
 * seam homes: four in wave8-benches.ts, the hook rewriter in
 * hook-desk.ts, the calendar auto-fill in scheduler-desk.ts.
 */
import { describe, expect, it } from "vitest";
import {
  WAVE8_ADLIB_ENERGIES,
  WAVE8_BENCH_RAILS,
  WAVE8_CAPTION_BURN_PATH,
  WAVE8_CAPTION_BURN_PRESETS,
  WAVE8_HIGHLIGHTS_PATH,
  WAVE8_HIGHLIGHT_TARGET_SECONDS,
  WAVE8_MEDIA_KIT_PATH,
  WAVE8_MEDIA_KIT_VAULTS_PATH,
  buildWave8AdlibPayload,
  buildWave8CaptionBurnPayload,
  buildWave8HighlightsPayload,
  buildWave8MediaKitPayload,
  wave8AdlibCost,
  wave8AdlibOf,
  wave8CaptionBurnCost,
  wave8CaptionBurnOf,
  wave8HighlightsCost,
  wave8HighlightsOf,
  wave8HighlightsReady,
  wave8MediaKitCost,
  wave8MediaKitOf,
  wave8VaultOptionsOf,
} from "./wave8-benches";
import {
  HOOK_REWRITER_PATH,
  buildHookRewriterPayload,
  hookRewriterCost,
  hookRewriterResultOf,
} from "./hook-desk";
import {
  CALENDAR_AUTOFILL_PATH,
  CALENDAR_SLOTS_PATH,
  buildCalendarAutofillPayload,
  calendarAutofillCost,
  calendarShiftWeek,
  calendarSlotBestTime,
  calendarSlotNotes,
  calendarSlotsOf,
  calendarSlotsPath,
  calendarWeekMonday,
  parseCalendarPillars,
} from "./scheduler-desk";
import { getCreditCost } from "../credit-costs";

describe("the six rails + the registry prices (census B-19)", () => {
  it("pins every rail's path and registry cost", () => {
    const expected: Array<[string, number]> = [
      ["/api/wave8/highlights/cut", 300],
      ["/api/wave8/hook-rewriter/rewrite", 50],
      ["/api/wave8/calendar/autofill", 150],
      ["/api/wave8/media-kit/generate", 100],
      ["/api/wave8/adlib/generate", 150],
      ["/api/wave8/caption-styler/burn", 100],
    ];
    for (const [path, cost] of expected) {
      expect(getCreditCost(path)?.cost, path).toBe(cost);
    }
    expect(WAVE8_BENCH_RAILS.map((r) => [r.path, r.cost()])).toEqual([
      ["/api/wave8/highlights/cut", 300],
      ["/api/wave8/media-kit/generate", 100],
      ["/api/wave8/adlib/generate", 150],
      ["/api/wave8/caption-styler/burn", 100],
    ]);
    expect(wave8HighlightsCost()).toBe(300);
    expect(hookRewriterCost()).toBe(50);
    expect(calendarAutofillCost()).toBe(150);
    expect(wave8MediaKitCost()).toBe(100);
    expect(wave8AdlibCost()).toBe(150);
    expect(wave8CaptionBurnCost()).toBe(100);
    expect(HOOK_REWRITER_PATH).toBe("/api/wave8/hook-rewriter/rewrite");
    expect(CALENDAR_AUTOFILL_PATH).toBe("/api/wave8/calendar/autofill");
    expect(WAVE8_MEDIA_KIT_VAULTS_PATH).toBe("/api/artist-vaults");
  });

  it("keeps the burn rail distinct from the Caption Styler bench's 300-Buc job rail", () => {
    expect(WAVE8_CAPTION_BURN_PATH).toBe("/api/wave8/caption-styler/burn");
    expect(getCreditCost("/api/caption-styler")?.cost).toBe(300);
    expect(wave8CaptionBurnCost()).not.toBe(getCreditCost("/api/caption-styler")?.cost);
  });
});

describe("highlights — the HighlightCutter's own shapes", () => {
  it("shapes the payload field for field, every text field trimmed", () => {
    expect(
      buildWave8HighlightsPayload({
        vodUrl: " https://twitch.tv/videos/1 ",
        vodTitle: " EP 12 ",
        chatLog: " 01:23 Pog ",
        transcript: " words ",
        targetSeconds: 90,
      }),
    ).toEqual({
      vodUrl: "https://twitch.tv/videos/1",
      vodTitle: "EP 12",
      chatLog: "01:23 Pog",
      transcript: "words",
      targetSeconds: 90,
    });
    expect(WAVE8_HIGHLIGHT_TARGET_SECONDS).toEqual([30, 60, 90, 120, 180]);
    expect(
      buildWave8HighlightsPayload({ vodUrl: "", vodTitle: "", chatLog: "", transcript: "", targetSeconds: 45 }).targetSeconds,
    ).toBe(60);
  });

  it("readiness needs at least one source, exactly like the page", () => {
    expect(wave8HighlightsReady({ vodUrl: " ", chatLog: "", transcript: "" })).toBe(false);
    expect(wave8HighlightsReady({ vodUrl: "", chatLog: "x", transcript: "" })).toBe(true);
    expect(wave8HighlightsReady({ vodUrl: "", chatLog: "", transcript: " x " })).toBe(true);
  });

  it("reads a real cut answer and refuses drift", () => {
    const ok = wave8HighlightsOf({
      moments: [{ startSec: 12, endSec: 47, score: 92, label: "Ace clutch", reason: "chat exploded" }],
      reelPlan: { totalSec: 35, segments: [{ startSec: 12, endSec: 47, caption: "The clutch" }] },
      summary: "One moment reel",
      creditsUsed: 300,
      creditsRemaining: 1200,
    });
    expect(ok?.moments).toHaveLength(1);
    expect(ok?.reelPlan.segments[0].caption).toBe("The clutch");
    expect(ok?.creditsRemaining).toBe(1200);
    expect(wave8HighlightsOf({ moments: [] })).toBeNull();
    expect(wave8HighlightsOf({ moments: [{ startSec: "12", endSec: 47, score: 92 }] })).toBeNull();
    expect(wave8HighlightsOf(null)).toBeNull();
    expect(wave8HighlightsOf({})).toBeNull();
  });
});

describe("hook rewriter — the HookRewriter's own shapes", () => {
  it("shapes the payload field for field (niche absent when blank)", () => {
    expect(buildHookRewriterPayload({ post: " my flop ", niche: " fitness " })).toEqual({
      post: "my flop",
      niche: "fitness",
    });
    expect(buildHookRewriterPayload({ post: "x", niche: "  " })).toEqual({ post: "x", niche: undefined });
  });

  it("holds the answer to the page's bar: exactly five variants", () => {
    const variant = { hook: "h", angle: "a", whyItWorks: "w" };
    expect(hookRewriterResultOf({ variants: [variant, variant, variant, variant, variant] })?.variants).toHaveLength(5);
    expect(hookRewriterResultOf({ variants: [variant, variant, variant, variant] })).toBeNull();
    expect(hookRewriterResultOf({ variants: [variant, variant, variant, variant, variant, variant] })).toBeNull();
    expect(hookRewriterResultOf({ variants: "five" })).toBeNull();
    expect(hookRewriterResultOf(null)).toBeNull();
  });
});

describe("calendar — the CalendarAutofill's own shapes", () => {
  it("parses pillars exactly like the page (split, trim, drop, cap six)", () => {
    expect(parseCalendarPillars(" a, b ,, c ")).toEqual(["a", "b", "c"]);
    expect(parseCalendarPillars("1,2,3,4,5,6,7")).toHaveLength(6);
    expect(parseCalendarPillars("")).toEqual([]);
  });

  it("shapes the autofill payload field for field (voice absent when blank)", () => {
    expect(
      buildCalendarAutofillPayload({ weekStart: "2026-11-09", pillarsText: "music, clips", voice: " bold " }),
    ).toEqual({ weekStart: "2026-11-09", pillars: ["music", "clips"], vaultVoice: "bold" });
    expect(buildCalendarAutofillPayload({ weekStart: "2026-11-09", pillarsText: "music", voice: "" })).toEqual({
      weekStart: "2026-11-09",
      pillars: ["music"],
      vaultVoice: undefined,
    });
  });

  it("does the page's Monday math (Mon = 0)", () => {
    // 2026-11-08 is a Sunday; its Monday is 2026-11-02. 2026-11-09 is a Monday.
    expect(calendarWeekMonday(new Date(2026, 10, 8))).toBe("2026-11-02");
    expect(calendarWeekMonday(new Date(2026, 10, 9))).toBe("2026-11-09");
    expect(calendarShiftWeek("2026-11-09", 1)).toBe("2026-11-16");
    expect(calendarShiftWeek("2026-11-09", -1)).toBe("2026-11-02");
    expect(calendarSlotsPath("2026-11-09")).toBe(`${CALENDAR_SLOTS_PATH}?weekStart=2026-11-09`);
  });

  it("reads slots through the one reader and refuses drift", () => {
    const slot = {
      id: 7,
      week_start: "2026-11-09",
      day_index: 2,
      position: 0,
      title: "Studio tour",
      post_type: "video",
      notes: "Suggested time: 18:30\nBring the new chain",
      status: "draft",
    };
    const parsed = calendarSlotsOf({ slots: [slot] });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]).toMatchObject({ id: "7", dayIndex: 2, title: "Studio tour", postType: "video" });
    expect(calendarSlotsOf({ slots: [{ ...slot, day_index: "2" }] })).toBeNull();
    expect(calendarSlotsOf({})).toBeNull();
    expect(calendarSlotsOf(null)).toBeNull();
    expect(calendarSlotsOf({ slots: [] })).toEqual([]);
  });

  it("splits the hidden suggested-time line from the visible brief, like the page", () => {
    const notes = "Suggested time: 18:30\nBring the new chain";
    expect(calendarSlotBestTime(notes)).toBe("18:30");
    expect(calendarSlotNotes(notes)).toBe("Bring the new chain");
    expect(calendarSlotBestTime("No time here")).toBeNull();
    expect(calendarSlotNotes("Just a brief")).toBe("Just a brief");
  });
});

describe("media kit — the MediaKitBuilder's own shapes", () => {
  it("shapes the payload: { vaultId } when picked, {} when auto-pick", () => {
    expect(buildWave8MediaKitPayload("v-1")).toEqual({ vaultId: "v-1" });
    expect(buildWave8MediaKitPayload(null)).toEqual({});
    expect(buildWave8MediaKitPayload("")).toEqual({});
  });

  it("reads the vault list in both of the page's answer shapes", () => {
    expect(wave8VaultOptionsOf({ vaults: [{ id: "a", artist_name: "Thy", genre: "Hip-Hop" }] })).toEqual([
      { id: "a", artistName: "Thy", genre: "Hip-Hop" },
    ]);
    expect(wave8VaultOptionsOf([{ id: 3, artist_name: "Two" }])).toEqual([{ id: "3", artistName: "Two", genre: "" }]);
    expect(wave8VaultOptionsOf(null)).toEqual([]);
    expect(wave8VaultOptionsOf({ nope: true })).toEqual([]);
  });

  it("reads a real kit and refuses a kit-less answer", () => {
    const kit = wave8MediaKitOf({
      kit: {
        artistName: "Thy Cheat Code",
        tagline: "The Content Creator's Cheat Code",
        bio: "bio",
        audience: "creators",
        rates: [{ tier: "Post", price: "$500" }],
        contact: "book@example.com",
        stats: { genre: "Hip-Hop", artistType: "Solo", visualStyle: "Gold", voiceStyle: "Bold" },
        generatedAt: "2026-11-08T00:00:00Z",
      },
    });
    expect(kit?.rates[0]).toEqual({ tier: "Post", price: "$500" });
    expect(kit?.stats.genre).toBe("Hip-Hop");
    expect(wave8MediaKitOf({})).toBeNull();
    expect(wave8MediaKitOf({ kit: null })).toBeNull();
    expect(wave8MediaKitOf(null)).toBeNull();
  });
});

describe("ad-libs — the AdLibGenerator's own shapes", () => {
  it("shapes the payload field for field, text trimmed, energy carried", () => {
    expect(
      buildWave8AdlibPayload({ lyrics: " la ", songTitle: " Song ", vaultVoice: " raspy ", energy: "dark" }),
    ).toEqual({ lyrics: "la", songTitle: "Song", vaultVoice: "raspy", energy: "dark" });
    expect(WAVE8_ADLIB_ENERGIES).toEqual(["chill", "hype", "dark"]);
  });

  it("holds the answer to the page's bar: a non-empty ad-libs list", () => {
    const ok = wave8AdlibOf({
      adlibs: [{ line: "yeah!", placement: "after hook", delivery: "whispered" }],
      stacks: [{ description: "triple", voices: "3" }],
      takeA: { style: "raw", notes: "one pass" },
      takeB: { style: "polished", notes: "comped" },
      creditsRemaining: 900,
    });
    expect(ok?.adlibs[0].line).toBe("yeah!");
    expect(ok?.takeB.style).toBe("polished");
    expect(wave8AdlibOf({ adlibs: [] })).toBeNull();
    expect(wave8AdlibOf({ adlibs: "none" })).toBeNull();
    expect(wave8AdlibOf(null)).toBeNull();
  });
});

describe("caption burn — the wave8 CaptionStyler's own shapes", () => {
  it("shapes the payload field for field (transcript trimmed)", () => {
    expect(
      buildWave8CaptionBurnPayload({ transcript: " hello world ", preset: "popin", wordsPerSecond: 4 }),
    ).toEqual({ transcript: "hello world", preset: "popin", wordsPerSecond: 4 });
    expect(WAVE8_CAPTION_BURN_PRESETS).toEqual(["karaoke", "popin", "lowerthird"]);
  });

  it("reads a real burn answer and refuses drift — a zero-word burn is a failure", () => {
    const ok = wave8CaptionBurnOf({
      words: [{ word: "hello", start: 0, end: 0.3 }],
      srt: "1\n00:00:00,000 --> 00:00:00,300\nhello",
      vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:00.300\nhello",
      preset: "karaoke",
      creditsRemaining: 500,
    });
    expect(ok?.words).toHaveLength(1);
    expect(ok?.creditsRemaining).toBe(500);
    expect(wave8CaptionBurnOf({ words: [], srt: "", vtt: "" })).toBeNull();
    expect(wave8CaptionBurnOf({ words: [{ word: "x", start: "0", end: 1 }], srt: "s", vtt: "v" })).toBeNull();
    expect(wave8CaptionBurnOf({ words: [{ word: "x", start: 0, end: 1 }] })).toBeNull();
    expect(wave8CaptionBurnOf(null)).toBeNull();
  });
});
