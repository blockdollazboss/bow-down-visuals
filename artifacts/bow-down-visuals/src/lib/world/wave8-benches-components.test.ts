/**
 * wave8-benches-components — Stack 400 world parity (census
 * B-19) source-contract pins. The six Wave8 single benches
 * must stack at their desks in StationPanel as ({ isLight })
 * benches, run every charged rail through the confirmed-spend
 * seam at the registry price, wire the NativeStates trio, and
 * read their bench-only copy from the worldWave8Bench
 * namespace in all ten catalogs — with light/dark parity via
 * their isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const hookBenches = read("../../components/world/native/Wave8HookBenches.tsx");
const repurposeBenches = read("../../components/world/native/Wave8RepurposeBenches.tsx");
const musicBenches = read("../../components/world/native/Wave8MusicBenches.tsx");
const businessBenches = read("../../components/world/native/Wave8BusinessBenches.tsx");
const panel = read("../../components/world/StationPanel.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "hi", "ar"] as const;
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(read(`../../locales/${l}.json`)) as Record<string, unknown>]),
);

const BENCHES: Array<{
  name: string;
  source: string;
  testId: string;
  path: string;
  costFn: string;
  feature: string;
}> = [
  { name: "HookRewriterBench", source: hookBenches, testId: "world-wave8-hook-rewriter-bench", path: "/api/wave8/hook-rewriter/rewrite", costFn: "hookRewriterCost()", feature: "Hook Rewriter" },
  { name: "CaptionBurnBench", source: hookBenches, testId: "world-wave8-caption-burn-bench", path: "/api/wave8/caption-styler/burn", costFn: "wave8CaptionBurnCost()", feature: "Styled Caption Burn-in" },
  { name: "HighlightsBench", source: repurposeBenches, testId: "world-wave8-highlights-bench", path: "/api/wave8/highlights/cut", costFn: "wave8HighlightsCost()", feature: "Stream Highlight Auto-Editor" },
  { name: "AdLibBench", source: musicBenches, testId: "world-wave8-adlib-bench", path: "/api/wave8/adlib/generate", costFn: "wave8AdlibCost()", feature: "Ad-Lib Generator" },
  { name: "MediaKitBench", source: businessBenches, testId: "world-wave8-media-kit-bench", path: "/api/wave8/media-kit/generate", costFn: "wave8MediaKitCost()", feature: "Media Kit Builder" },
  { name: "CalendarAutofillBench", source: businessBenches, testId: "world-wave8-calendar-bench", path: "/api/wave8/calendar/autofill", costFn: "calendarAutofillCost()", feature: "Content Calendar Auto-Fill" },
];

describe("the bench shapes", () => {
  it("every bench is a named ({ isLight }) export rooted at its testid", () => {
    expect(hookBenches).toContain("data-testid={testId}");
    for (const b of BENCHES) {
      expect(b.source, b.name).toContain(`export function ${b.name}({ isLight }: { isLight: boolean })`);
      expect(b.source, b.name).toContain(`testId="${b.testId}"`);
      expect(b.source, b.name).toContain(`testId="${b.testId.replace("-bench", "-run")}"`);
    }
  });

  it("the shared chrome lives in the Hook benches file and the sibling files use it", () => {
    expect(hookBenches).toContain("export function BenchShell(");
    expect(hookBenches).toContain("export function BenchRunButton(");
    expect(hookBenches).toContain("export function BenchNotices(");
    for (const src of [repurposeBenches, musicBenches, businessBenches]) {
      expect(src).toContain('from "./Wave8HookBenches"');
    }
  });
});

describe("every run rides the confirmed-spend seam at the registry price", () => {
  it("each bench confirmedFetches its own rail with its registry cost", () => {
    for (const b of BENCHES) {
      expect(b.source, b.name).toContain(b.costFn);
      expect(b.source, b.name).toContain("overrideCost: cost");
      expect(b.source, b.name).toContain(`overrideFeature: "${b.feature}"`);
      expect(b.source, b.name).toContain(`feature="${b.feature}"`);
      expect(b.source, b.name).toContain("res.status === 402");
    }
    // The seam-constant rails are fetched through their constants.
    expect(hookBenches).toContain("confirmedFetch(HOOK_REWRITER_PATH, {");
    expect(hookBenches).toContain("confirmedFetch(WAVE8_CAPTION_BURN_PATH, {");
    expect(repurposeBenches).toContain("confirmedFetch(WAVE8_HIGHLIGHTS_PATH, {");
    expect(musicBenches).toContain("confirmedFetch(WAVE8_ADLIB_PATH, {");
    expect(businessBenches).toContain("confirmedFetch(WAVE8_MEDIA_KIT_PATH, {");
    expect(businessBenches).toContain("confirmedFetch(CALENDAR_AUTOFILL_PATH, {");
  });

  it("payloads are shaped by the seam builders, never hand-rolled in the components", () => {
    expect(hookBenches).toContain("buildHookRewriterPayload({ post, niche })");
    expect(hookBenches).toContain("buildWave8CaptionBurnPayload({ transcript, preset, wordsPerSecond })");
    expect(repurposeBenches).toContain("buildWave8HighlightsPayload({ vodUrl, vodTitle, chatLog, transcript, targetSeconds })");
    expect(musicBenches).toContain("buildWave8AdlibPayload({ lyrics, songTitle, vaultVoice, energy })");
    expect(businessBenches).toContain("buildWave8MediaKitPayload(vaultId || null)");
    expect(businessBenches).toContain("buildCalendarAutofillPayload({ weekStart, pillarsText, voice })");
  });

  it("results flow into the hub project as script assets", () => {
    for (const src of [hookBenches, repurposeBenches, musicBenches, businessBenches]) {
      expect(src).toContain('kind: "script"');
      expect(src).toContain("addAsset({");
    }
    expect(hookBenches).toContain('data-testid="world-wave8-hook-rewriter-result"');
    expect(hookBenches).toContain('data-testid="world-wave8-caption-burn-result"');
    expect(repurposeBenches).toContain('data-testid="world-wave8-highlights-result"');
    expect(musicBenches).toContain('data-testid="world-wave8-adlib-result"');
    expect(businessBenches).toContain('data-testid="world-wave8-media-kit-result"');
    expect(businessBenches).toContain('data-testid="world-wave8-calendar-result"');
  });

  it("the free reads never ride the confirm rail's charge path", () => {
    // The vault pick is a plain fetch, exactly like the page.
    expect(businessBenches).toContain("fetch(WAVE8_MEDIA_KIT_VAULTS_PATH, { credentials: \"include\" })");
    expect(businessBenches).not.toContain("confirmedFetch(WAVE8_MEDIA_KIT_VAULTS_PATH");
    // The week's slot read is the page's skip-confirm read.
    expect(businessBenches).toContain("confirmedFetch(calendarSlotsPath(ws), { skipConfirm: true })");
  });

  it("client-side refusals happen before any charge", () => {
    // Caption burn: an empty transcript is refused in words.
    expect(hookBenches).toContain('setError(t("wave8.captionStyler.errorEmpty"))');
    // Highlights: no source, no run.
    expect(repurposeBenches).toContain('setError(t("wave8.highlights.errorNoSource"))');
    expect(repurposeBenches).toContain("wave8HighlightsReady({ vodUrl, chatLog, transcript })");
    // Calendar: no pillars, no autofill (the run stays disabled).
    expect(businessBenches).toContain("disabled={!pillarsReady}");
  });
});

describe("the NativeStates trio is wired", () => {
  it("loading, empty and error states render through NativeStates", () => {
    for (const src of [hookBenches, repurposeBenches, musicBenches, businessBenches]) {
      expect(src).toContain("NativeLoadingState");
      expect(src).toContain("NativeEmptyState");
    }
    expect(hookBenches).toContain("NativeErrorState");
    expect(businessBenches).toContain("NativeErrorState");
  });
});

describe("the StationPanel mounts [STATION MOUNT ○]", () => {
  it("lazy-imports all six benches", () => {
    for (const b of BENCHES) {
      expect(panel, b.name).toContain(`const ${b.name} = lazy(() => import("@/components/world/native/`);
      expect(panel, b.name).toContain(`<${b.name} isLight={isLight} />`);
    }
  });

  it("stacks each bench at its own desk with its own reset key", () => {
    for (const key of [
      "wave8-hook-rewriter",
      "wave8-caption-burn",
      "wave8-highlights",
      "wave8-adlib",
      "wave8-media-kit",
      "wave8-calendar",
    ]) {
      expect(panel, key).toContain(`resetKey={\`\${station.id}:${key}\`}`);
    }
    // The press-kit branch became a stack so the kit bench sits under the desk.
    expect(panel).toContain('station.id === "press-kit-desk"');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("every bench file branches its surfaces on isLight", () => {
    for (const src of [hookBenches, repurposeBenches, musicBenches, businessBenches]) {
      expect(src).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
      expect(src).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
    }
  });
});

describe("the worldWave8Bench namespace", () => {
  const KEYS = [
    "rewriteRun",
    "hookEmpty",
    "presetStyleLabel",
    "captionBurnRun",
    "captionEmpty",
    "creditsRemaining",
    "highlightsRun",
    "highlightsEmpty",
    "adlibRun",
    "adlibEmpty",
    "mediaKitEmpty",
    "calendarRun",
    "bestTime",
  ];

  it("exists in all ten catalogs with the English source verbatim (unreviewed — house law)", () => {
    const en = catalogs.en.worldWave8Bench as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual([...KEYS].sort());
    for (const l of LOCALES) {
      expect(catalogs[l].worldWave8Bench, l).toEqual(en);
    }
  });

  it("every key is used by a bench (no dead copy)", () => {
    const all = [hookBenches, repurposeBenches, musicBenches, businessBenches].join("\n");
    for (const k of KEYS) {
      expect(all, k).toContain(`worldWave8Bench.${k}`);
    }
  });
});

describe("owned files stay untouched by this lane", () => {
  it("no bench file edits the Caption Styler bench, SchedulerDesk, or the desk panels", () => {
    for (const src of [hookBenches, repurposeBenches, musicBenches, businessBenches]) {
      expect(src).not.toContain("caption-styler-bench");
      expect(src).not.toContain("SchedulerDesk");
      expect(src).not.toContain("AudioDesk");
      expect(src).not.toContain("CreateDesks");
    }
  });

  it("the burn bench never touches the 300-Buc job rail", () => {
    expect(hookBenches).not.toContain('"/api/caption-styler"');
    expect(hookBenches).not.toContain("captionStylerCost");
  });
});
