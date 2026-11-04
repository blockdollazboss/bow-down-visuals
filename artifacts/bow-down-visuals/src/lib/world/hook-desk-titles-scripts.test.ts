/**
 * hook-desk-titles-scripts.test.ts — Stack-100 item 30 [B6]: the
 * Titles bench + Script Writer bench in the Hook Desk.
 *
 * Traced from the 2D surfaces: the /hooks page's Titles tab posts
 * { topic, platform, tone, keywords } to POST /api/title-studio
 * (100 Visual Bucs — the route's TITLE_STUDIO_CREDITS default and
 * the credit registry agree), and /script-writer posts
 * { platform, length, topic, tone, audience, ctaGoal } to
 * POST /api/script-writer (200 Visual Bucs — SCRIPT_WRITER_CREDIT_COST
 * + registry). Both routes charge → generate → REFUND on failure;
 * a response with no usable payload is a 502 server-side, so the
 * desk's guards hold the same bar: drift is a failed make (null),
 * never rows dressed as a result. These tests pin the seam to the
 * rails (route sources read directly), the registry prices, the
 * page-mirrored payloads, the strict response guards, and the
 * component's wiring (confirmedFetch, per-bench forms, in-panel
 * results, session history).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";

/* JOIN SWEEP (phase-2 repair #6): the benches' strings now resolve
   through worldJoinSweep — pins assert the key references in the
   source and the en values in the catalog. */
const SWEEP = (en as { worldJoinSweep: Record<string, string> }).worldJoinSweep;
import {
  SCRIPT_LENGTHS,
  SCRIPT_PLATFORMS,
  SCRIPT_TONES,
  SCRIPT_WRITER_PATH,
  TITLE_PLATFORMS,
  TITLE_TONES,
  TITLE_STUDIO_PATH,
  buildScriptPayload,
  buildTitlePayload,
  hookDeskInputReady,
  hookDeskModeCost,
  hookDeskModePath,
  pushHookHistory,
  scriptOfResponse,
  scriptWriterCost,
  titleStudioCost,
  titlesOfResponse,
  type HookHistoryEntry,
} from "./hook-desk";
import { getCreditCost } from "../credit-costs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/HookDesk.tsx");
const titleRouteSrc = read("../../../../api-server/src/routes/generate/title-studio.ts");
const scriptRouteSrc = read("../../../../api-server/src/routes/generate/script-writer.ts");

describe("prices — the registry's, matching the routes' defaults", () => {
  it("titles are 100 VB and scripts are 200 VB, from the registry", () => {
    expect(TITLE_STUDIO_PATH).toBe("/api/title-studio");
    expect(SCRIPT_WRITER_PATH).toBe("/api/script-writer");
    expect(titleStudioCost()).toBe(100);
    expect(scriptWriterCost()).toBe(200);
    expect(titleStudioCost()).toBe(getCreditCost("/api/title-studio")!.cost);
    expect(scriptWriterCost()).toBe(getCreditCost("/api/script-writer")!.cost);
    expect(getCreditCost("/api/title-studio")!.feature).toBe("Title Studio");
    expect(getCreditCost("/api/script-writer")!.feature).toBe("Script Writer");
    expect(hookDeskModeCost("titles")).toBe(100);
    expect(hookDeskModeCost("scripts")).toBe(200);
    expect(hookDeskModePath("titles")).toBe(TITLE_STUDIO_PATH);
    expect(hookDeskModePath("scripts")).toBe(SCRIPT_WRITER_PATH);
  });

  it("the routes' own defaults agree — and both routes refund on failure", () => {
    expect(titleRouteSrc).toContain('process.env["TITLE_STUDIO_CREDIT_COST"]) || 100');
    expect(scriptRouteSrc).toContain('process.env["SCRIPT_WRITER_CREDIT_COST"]) || 200');
    expect(titleRouteSrc).toContain("refundCredits");
    expect(scriptRouteSrc).toContain("refundCredits");
    expect(titleRouteSrc).toContain('action: "Title Studio"');
    expect(scriptRouteSrc).toContain('action: "AI Script Writer"');
  });
});

describe("enums — the routes' own, verbatim (pinned against route source)", () => {
  it("title platforms + tones match title-studio.ts", () => {
    expect(TITLE_PLATFORMS).toEqual(["youtube", "tiktok", "instagram"]);
    expect(TITLE_TONES).toEqual(["hype", "professional", "funny"]);
    expect(titleRouteSrc).toContain('const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;');
    expect(titleRouteSrc).toContain('const TONES = ["hype", "professional", "funny"] as const;');
  });

  it("script platforms, lengths + tones match script-writer.ts", () => {
    expect(SCRIPT_PLATFORMS).toEqual(["youtube", "tiktok", "reels"]);
    expect(SCRIPT_LENGTHS).toEqual(["short", "medium", "long", "deep"]);
    expect(SCRIPT_TONES).toEqual(["educational", "entertaining", "inspirational", "controversial"]);
    expect(scriptRouteSrc).toContain('SCRIPT_WRITER_PLATFORMS = ["youtube", "tiktok", "reels"] as const;');
    expect(scriptRouteSrc).toContain('SCRIPT_WRITER_LENGTHS = ["short", "medium", "long", "deep"] as const;');
    expect(scriptRouteSrc).toContain('"educational"');
    expect(scriptRouteSrc).toContain('"controversial"');
  });
});

describe("payloads — the 2D surfaces' posts, field for field", () => {
  it("titles: hooks.tsx TitlesTab's { topic, platform, tone, keywords }, trimmed", () => {
    expect(
      buildTitlePayload({ topic: "  my new single ", platform: "tiktok", tone: "funny", keywords: " drill, uk " }),
    ).toEqual({ topic: "my new single", platform: "tiktok", tone: "funny", keywords: "drill, uk" });
    expect(
      buildTitlePayload({ topic: "x", platform: "youtube", tone: "hype", keywords: "" }),
    ).toEqual({ topic: "x", platform: "youtube", tone: "hype", keywords: "" });
  });

  it("scripts: script-writer.tsx's { platform, length, topic, tone, audience, ctaGoal }", () => {
    expect(
      buildScriptPayload({
        platform: "reels",
        length: "short",
        topic: "  studio tour ",
        tone: "entertaining",
        audience: " producers ",
        ctaGoal: " follow ",
      }),
    ).toEqual({
      platform: "reels",
      length: "short",
      topic: "studio tour",
      tone: "entertaining",
      audience: "producers",
      ctaGoal: "follow",
    });
    /* The optionals ride as empty strings, exactly as the page posts
       them — the route defaults them the same way. */
    expect(
      buildScriptPayload({ platform: "youtube", length: "medium", topic: "x", tone: "educational", audience: "", ctaGoal: "" }),
    ).toEqual({ platform: "youtube", length: "medium", topic: "x", tone: "educational", audience: "", ctaGoal: "" });
  });

  it("input readiness mirrors the routes' zod minimums (topic min 1)", () => {
    expect(hookDeskInputReady("titles", { topic: "", title: "" })).toBe(false);
    expect(hookDeskInputReady("titles", { topic: "  ", title: "" })).toBe(false);
    expect(hookDeskInputReady("titles", { topic: "x", title: "" })).toBe(true);
    expect(hookDeskInputReady("scripts", { topic: "", title: "" })).toBe(false);
    expect(hookDeskInputReady("scripts", { topic: "x", title: "" })).toBe(true);
  });
});

describe("titles guard — the route's parse discipline; drift is a failed make", () => {
  const good = {
    titles: [
      { title: " I Tried Producing Blindfolded ", score: 142, why: " curiosity gap " },
      { title: "Second Best", score: "high", why: 42 },
      { title: "   ", score: 10, why: "blank drops, as the route drops it" },
      "not-a-row",
    ],
    description: " Hook line.\n\nBody copy. ",
    tags: ["#drill", "uk drill", "  ", "#"],
    note: " Estimates, not guarantees. ",
  };

  it("a real pack lands: rows cleaned, scores clamped, tags shed #'s", () => {
    expect(titlesOfResponse(good)).toEqual({
      titles: [
        { title: "I Tried Producing Blindfolded", score: 100, why: "curiosity gap" },
        { title: "Second Best", score: 0, why: "" },
      ],
      description: "Hook line.\n\nBody copy.",
      tags: ["drill", "uk drill"],
      note: "Estimates, not guarantees.",
    });
  });

  it("caps hold at the route's 10 titles / 15 tags", () => {
    const many = {
      titles: Array.from({ length: 14 }, (_, i) => ({ title: `T${i}`, score: 50, why: "" })),
      description: "d",
      tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
    };
    const parsed = titlesOfResponse(many)!;
    expect(parsed.titles).toHaveLength(10);
    expect(parsed.tags).toHaveLength(15);
  });

  it("no titles or no description is null — the route refuses the same shape", () => {
    expect(titlesOfResponse({ titles: [], description: "d" })).toBeNull();
    expect(titlesOfResponse({ titles: [{ title: "x" }], description: "  " })).toBeNull();
    expect(titlesOfResponse({ titles: [{ title: "x" }] })).toBeNull();
    expect(titlesOfResponse({ description: "d" })).toBeNull();
    expect(titlesOfResponse({ titles: "nope", description: "d" })).toBeNull();
    expect(titlesOfResponse(null)).toBeNull();
    expect(titlesOfResponse("titles")).toBeNull();
  });
});

describe("script guard — hook + usable beats or null, like the route", () => {
  const good = {
    title: " The Title ",
    hook: " Stop scrolling — watch this. ",
    beats: [
      { timestamp: " 0:00 ", spoken: " Stop scrolling ", visualCue: " face cam ", broll: " studio wide " },
      { timestamp: "0:30", spoken: "The drop hits", visualCue: 7, broll: null },
      { timestamp: "0:45", spoken: "   " },
      { spoken: "no timestamp — drops, as the route drops it" },
    ],
    retentionBeats: [
      { at: " 0:30 ", tactic: " open loop ", line: " but wait for the switch " },
      { at: "1:00", tactic: "re-hook", line: " " },
    ],
    cta: " Follow for part two ",
    teleprompter: " Stop scrolling. The drop hits. ",
  };

  it("a real script lands: beats cleaned to the route's shape", () => {
    expect(scriptOfResponse(good)).toEqual({
      title: "The Title",
      hook: "Stop scrolling — watch this.",
      beats: [
        { timestamp: "0:00", spoken: "Stop scrolling", visualCue: "face cam", broll: "studio wide" },
        { timestamp: "0:30", spoken: "The drop hits", visualCue: "", broll: "" },
      ],
      retentionBeats: [{ at: "0:30", tactic: "open loop", line: "but wait for the switch" }],
      cta: "Follow for part two",
      teleprompter: "Stop scrolling. The drop hits.",
    });
  });

  it("caps hold at the route's 40 beats / 20 retention beats", () => {
    const many = {
      hook: "h",
      beats: Array.from({ length: 45 }, (_, i) => ({ timestamp: `0:${i}`, spoken: `line ${i}` })),
      retentionBeats: Array.from({ length: 25 }, (_, i) => ({ at: `0:${i}`, line: `keep ${i}` })),
    };
    const parsed = scriptOfResponse(many)!;
    expect(parsed.beats).toHaveLength(40);
    expect(parsed.retentionBeats).toHaveLength(20);
  });

  it("no hook or no usable beats is null — never an empty script as a result", () => {
    expect(scriptOfResponse({ beats: [{ timestamp: "0:00", spoken: "x" }] })).toBeNull();
    expect(scriptOfResponse({ hook: "  ", beats: [{ timestamp: "0:00", spoken: "x" }] })).toBeNull();
    expect(scriptOfResponse({ hook: "h", beats: [] })).toBeNull();
    expect(scriptOfResponse({ hook: "h", beats: [{ timestamp: "0:00", spoken: " " }] })).toBeNull();
    expect(scriptOfResponse({ hook: "h" })).toBeNull();
    expect(scriptOfResponse(null)).toBeNull();
  });
});

describe("session history — the benches' makes ride whole", () => {
  it("titles + scripts entries restore their structured results, deduped", () => {
    const titles = titlesOfResponse({
      titles: [{ title: "T", score: 90, why: "w" }],
      description: "d",
      tags: [],
    })!;
    const script = scriptOfResponse({
      hook: "h",
      beats: [{ timestamp: "0:00", spoken: "s" }],
    })!;
    let h: HookHistoryEntry[] = [];
    h = pushHookHistory(h, { mode: "titles", label: "topic a", lines: ["T"], titlesResult: titles });
    h = pushHookHistory(h, { mode: "scripts", label: "topic b", lines: ["s"], scriptResult: script });
    expect(h.map((e) => e.mode)).toEqual(["scripts", "titles"]);
    expect(h[1]!.titlesResult).toEqual(titles);
    expect(h[0]!.scriptResult).toEqual(script);
    h = pushHookHistory(h, { mode: "titles", label: "topic a", lines: ["T"], titlesResult: titles });
    expect(h).toHaveLength(2);
    expect(h[0]!.mode).toBe("titles");
  });
});

describe("the benches in the component (source pins)", () => {
  it("both benches are tabs on the desk, priced from the seam", () => {
    /* Join repoint (stack100 phase-2): the tab labels render through
       the catalog since locale unit 38 — the pin now holds the
       labelKey wiring (en values pinned in the unit-38 i18n pin). */
    expect(deskSrc).toContain('{ key: "titles", labelKey: "worldCreateMedia.hookModeTitles"');
    expect(deskSrc).toContain('{ key: "scripts", labelKey: "worldCreateMedia.hookModeScripts"');
    expect(deskSrc).toContain("hookDeskModeCost(mode)");
  });

  it("runs ride the standing confirmation path with the seam's payloads + guards", () => {
    expect(deskSrc).toContain("buildTitlePayload");
    expect(deskSrc).toContain("buildScriptPayload");
    expect(deskSrc).toContain("titlesOfResponse");
    expect(deskSrc).toContain("scriptOfResponse");
    expect(deskSrc).toContain("confirmedFetch(path");
    expect(deskSrc).toContain("hookDeskModePath(mode)");
    /* Honest failures: a guard-null reads as a refunded failed make. */
    expect(deskSrc).toContain('t("worldJoinSweep.tsbEmptyTitles")');
    expect(SWEEP.tsbEmptyTitles).toBe("The titles came back empty — a failed make is refunded. Try again.");
    expect(deskSrc).toContain('t("worldJoinSweep.tsbEmptyScript")');
    expect(SWEEP.tsbEmptyScript).toBe("The script came back empty — a failed make is refunded. Try again.");
  });

  it("each bench keeps its own topic + the routes' fields, results in-panel", () => {
    expect(deskSrc).toContain("tsTopic");
    expect(deskSrc).toContain("swTopic");
    expect(deskSrc).toContain("TITLE_PLATFORMS");
    expect(deskSrc).toContain("TITLE_TONES");
    expect(deskSrc).toContain("SCRIPT_PLATFORMS");
    expect(deskSrc).toContain("SCRIPT_LENGTHS");
    expect(deskSrc).toContain("SCRIPT_TONES");
    /* The script's teleprompter + beats render in the panel. */
    expect(deskSrc).toContain('t("worldJoinSweep.tsbTeleprompterLabel")');
    expect(SWEEP.tsbTeleprompterLabel).toBe("Teleprompter");
    expect(deskSrc).toContain('t("worldJoinSweep.tsbRetentionLabel")');
    expect(SWEEP.tsbRetentionLabel).toBe("Retention beats");
    /* Titles render ranked with their readiness scores. */
    expect(deskSrc).toContain('t("worldJoinSweep.tsbReadinessLine"');
    expect(SWEEP.tsbReadinessLine).toBe("{{rank}} · readiness {{score}}/100");
  });
});
