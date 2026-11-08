/**
 * repurpose-desk — stack200 world parity lane B1, census
 * item 4 pins. The Repurpose desk is the repurpose page's
 * Content Pack mode on the /api/repurpose rails:
 * - the prices are the ROUTE's own constants (the rails are
 *   not in the credit registry) — pinned to the route source;
 * - an analyze response without its analysis block parses to
 *   null (a failure), never a half-built pack; malformed rows
 *   inside a real analysis drop, never estimated;
 * - a job reads settled only at done/failed, and a garbled
 *   status reads as still-working — finished work is claimed
 *   only off a real "done";
 * - the reroll body is the page's exact shape, and a reroll
 *   result whose shape doesn't match its kind parses to null.
 *
 * TRANSLATION STATUS: the desk's framing (worldRepurposeDesk.*)
 * is en-source; the other nine catalogs carry the English
 * VERBATIM, flagged UNREVIEWED here and in the components
 * pin. All rail copy rides the page's repurpose.* keys.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  REPURPOSE_ANALYZE_PATH,
  REPURPOSE_MAX_VIDEO_BYTES,
  REPURPOSE_PACK_COST_VB,
  REPURPOSE_REROLL_COST_VB,
  REPURPOSE_REROLL_PATH,
  REPURPOSE_REROLL_THUMBNAIL_PATH,
  SMART_CLIP_COUNTS,
  SMART_CLIP_LENGTHS,
  SMART_PROPOSE_PATH,
  SMART_RENDER_COST_PER_CLIP_VB,
  SMART_RENDER_PATH,
  STREAM_ANALYZE_COST_VB,
  STREAM_ANALYZE_PATH,
  STREAM_CLIP_LENGTHS,
  STREAM_CUT_COST_PER_CLIP_VB,
  STREAM_CUT_PATH,
  STREAM_MAX_CLIPS,
  buildRerollBody,
  buildSmartRenderBody,
  buildStreamCutBody,
  formatRepurposeTime,
  isRepurposeJobSettled,
  isStreamCutJobSettled,
  keptSmartDrafts,
  parseSmartTimeText,
  repurposeJobOf,
  repurposeJobPath,
  repurposePackOf,
  rerollResultOf,
  rerolledThumbnailOf,
  smartClipsOf,
  smartDraftOf,
  smartDraftWindow,
  smartProposalsOf,
  streamAnalysisOf,
  streamCutJobOf,
  streamCutJobPath,
  type SmartDraft,
} from "./repurpose-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const route = read("../../../../api-server/src/routes/generate/repurpose.ts");
const streamRoute = read("../../../../api-server/src/routes/generate/streamer-clips.ts");
const smartRoute = read("../../../../api-server/src/routes/generate/video-to-shorts.ts");
const creditCosts = read("../../lib/credit-costs.ts");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

describe("prices + paths — the route is the truth", () => {
  it("the pack and reroll constants are the route's env-default figures", () => {
    expect(REPURPOSE_PACK_COST_VB).toBe(500);
    expect(REPURPOSE_REROLL_COST_VB).toBe(100);
    expect(route).toContain("REPURPOSE_PACK_CREDITS");
    expect(route).toContain("REPURPOSE_REROLL_CREDITS");
    expect(route).toMatch(/REPURPOSE_PACK_CREDITS[^\n]*\|\| 500/);
    expect(route).toMatch(/REPURPOSE_REROLL_CREDITS[^\n]*\|\| 100/);
  });

  it("the paths are the route's mounts; the size cap is the page's 80 MB", () => {
    expect(REPURPOSE_ANALYZE_PATH).toBe("/api/repurpose/analyze");
    expect(REPURPOSE_REROLL_PATH).toBe("/api/repurpose/reroll");
    expect(REPURPOSE_REROLL_THUMBNAIL_PATH).toBe("/api/repurpose/reroll-thumbnail");
    expect(repurposeJobPath("job 1")).toBe("/api/repurpose/jobs/job%201");
    expect(REPURPOSE_MAX_VIDEO_BYTES).toBe(80 * 1024 * 1024);
  });
});

describe("repurposePackOf — analyze honesty", () => {
  const good = {
    videoRef: "uploads/v.mp4",
    durationSec: 95,
    transcript: "hello world",
    clipJobId: "cj1",
    thumbnailJobId: "tj1",
    analysis: {
      videoTitle: "My Song",
      summary: "A performance video.",
      moments: [
        { id: "m1", startSec: 10, endSec: 25, title: "Hook", reason: "Energy", quote: "yeah" },
        { id: "m2", startSec: 1, endSec: 2 },
        "junk",
      ],
      captions: [
        { caption: "Watch this", hashtags: ["music", 42, "fyp"] },
        { hashtags: [] },
      ],
      descriptions: { tiktok: "TT desc", reels: 7, x: "X desc" },
      thumbnailPrompts: ["gold stage", "", 3],
    },
  };

  it("parses a real pack, dropping malformed rows and never inventing fields", () => {
    const pack = repurposePackOf(good);
    expect(pack).not.toBeNull();
    expect(pack!.analysis.videoTitle).toBe("My Song");
    expect(pack!.analysis.moments).toHaveLength(1);
    expect(pack!.analysis.captions).toEqual([{ caption: "Watch this", hashtags: ["music", "fyp"] }]);
    expect(pack!.analysis.descriptions).toEqual({ tiktok: "TT desc", x: "X desc" });
    expect(pack!.analysis.thumbnailPrompts).toEqual(["gold stage"]);
    expect(pack!.clipJobId).toBe("cj1");
    expect(pack!.durationSec).toBe(95);
  });

  it("no analysis block → null, however official the rest looks", () => {
    for (const bad of [null, 42, {}, { error: "boom" }, { analysis: null }, { analysis: { summary: "x" } }]) {
      expect(repurposePackOf(bad)).toBeNull();
    }
  });
});

describe("repurposeJobOf — finished work only off a real done", () => {
  it("parses clips/thumbnails off a done job, dropping rows without media", () => {
    const job = repurposeJobOf({
      jobId: "j1",
      kind: "clips",
      status: "done",
      clips: [
        { title: "Hook", startSec: 5, endSec: 20, outputUrl: "https://x/c.mp4" },
        { title: "No file", startSec: 0, endSec: 1 },
      ],
    });
    expect(job.status).toBe("done");
    expect(job.clips).toHaveLength(1);
    expect(isRepurposeJobSettled(job.status)).toBe(true);
  });

  it("a garbled or missing status reads as still working, never done", () => {
    expect(repurposeJobOf({ status: "complete" }).status).toBe("queued");
    expect(repurposeJobOf(null).status).toBe("queued");
    expect(repurposeJobOf({ status: "processing" }).status).toBe("processing");
    expect(isRepurposeJobSettled("processing")).toBe(false);
    expect(isRepurposeJobSettled("failed")).toBe(true);
  });
});

describe("rerolls — the page's shapes", () => {
  it("the body is { transcript, kind, durationSec } with a 0 fallback", () => {
    expect(buildRerollBody("captions", "words", 42)).toEqual({
      transcript: "words",
      kind: "captions",
      durationSec: 42,
    });
    expect(buildRerollBody("moments", "words", null).durationSec).toBe(0);
  });

  it("a result parses per kind; a mismatched shape parses to null", () => {
    expect(rerollResultOf("captions", { result: [{ caption: "Hi", hashtags: [] }] })).toEqual([
      { caption: "Hi", hashtags: [] },
    ]);
    expect(rerollResultOf("captions", { result: { nope: true } })).toBeNull();
    expect(rerollResultOf("descriptions", { result: { tiktok: "d" } })).toEqual({ tiktok: "d" });
    expect(rerollResultOf("thumbnailPrompts", { result: ["a", 2] })).toEqual(["a"]);
    expect(rerollResultOf("moments", { result: "nope" })).toBeNull();
  });

  it("a re-rolled thumbnail reads its imageUrl, null when absent", () => {
    expect(rerolledThumbnailOf({ imageUrl: "https://x/t.jpg" })).toBe("https://x/t.jpg");
    expect(rerolledThumbnailOf({})).toBeNull();
  });

  it("formatRepurposeTime is m:ss", () => {
    expect(formatRepurposeTime(0)).toBe("0:00");
    expect(formatRepurposeTime(65)).toBe("1:05");
    expect(formatRepurposeTime(600)).toBe("10:00");
  });
});

describe("copy — en source, English verbatim UNREVIEWED in the other nine", () => {
  it("worldRepurposeDesk matches across catalogs; rail copy is the page's", () => {
    const en = readJson("../../locales/en.json");
    expect(en.worldRepurposeDesk.title).toBe("Content Repurposer");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      expect(readJson(`../../locales/${loc}.json`).worldRepurposeDesk, loc).toEqual(en.worldRepurposeDesk);
    }
  });
});

/* ════════════════════════════════════════════════════════════
   Stack 300 items 94/95 — the desk's Stream VOD + Smart Clips
   modes ride the page's rails with the page's honesty rules.
   ════════════════════════════════════════════════════════════ */

describe("stream prices + paths — routes and registry are the truth (item 94)", () => {
  it("analyze 300 / cut 200-per-clip match the streamer-clips route env defaults", () => {
    expect(STREAM_ANALYZE_COST_VB).toBe(300);
    expect(STREAM_CUT_COST_PER_CLIP_VB).toBe(200);
    expect(streamRoute).toMatch(/STREAMER_CLIPS_ANALYZE_CREDITS[^\n]*\|\| 300/);
    expect(streamRoute).toMatch(/STREAMER_CLIPS_CUT_CREDITS[^\n]*\|\| 200/);
  });

  it("the analyze rail is registry-priced at the same 300 the desk label shows", () => {
    expect(creditCosts).toContain('"/api/streamer-clips/analyze": { cost: 300');
    expect(creditCosts).toContain('"/api/streamer-clips/cut": { cost: 200');
  });

  it("paths + preference shelves mirror the page", () => {
    expect(STREAM_ANALYZE_PATH).toBe("/api/streamer-clips/analyze");
    expect(STREAM_CUT_PATH).toBe("/api/streamer-clips/cut");
    expect(streamCutJobPath("job 1")).toBe("/api/streamer-clips/cut/job%201");
    expect(STREAM_CLIP_LENGTHS).toEqual([15, 30, 60]);
    expect(STREAM_MAX_CLIPS).toBe(8);
  });
});

describe("streamAnalysisOf — analyze honesty (item 94)", () => {
  const good = {
    videoRef: "uploads/vod.mp4",
    durationSec: 3600,
    highlights: [
      { id: "h1", startSec: 10, endSec: 40, title: "Clutch", reason: "Crowd pops", quote: "let's go" },
      { id: "h2", startSec: 1, endSec: 2 },
      { startSec: 3, endSec: 4, title: "No id" },
      "junk",
    ],
  };

  it("parses a real analysis, dropping malformed highlight rows", () => {
    const a = streamAnalysisOf(good);
    expect(a).not.toBeNull();
    expect(a!.videoRef).toBe("uploads/vod.mp4");
    expect(a!.highlights).toHaveLength(1);
    expect(a!.highlights[0]!.title).toBe("Clutch");
  });

  it("an empty highlight list is a FAILURE, never an empty success", () => {
    expect(streamAnalysisOf({ videoRef: "uploads/v.mp4", highlights: [] })).toBeNull();
    expect(streamAnalysisOf({ videoRef: "uploads/v.mp4" })).toBeNull();
    expect(streamAnalysisOf({ highlights: good.highlights })).toBeNull();
    expect(streamAnalysisOf(null)).toBeNull();
    expect(streamAnalysisOf({ error: "boom" })).toBeNull();
  });

  it("the cut body is the page's exact shape, in pick order", () => {
    const a = streamAnalysisOf(good)!;
    expect(buildStreamCutBody(a.videoRef, a.highlights)).toEqual({
      videoRef: "uploads/vod.mp4",
      clips: [{ startSec: 10, endSec: 40, title: "Clutch" }],
    });
  });
});

describe("streamCutJobOf — finished work only off a real done (item 94)", () => {
  it("parses a done job; clips without a rendered file stay null-output", () => {
    const job = streamCutJobOf({
      jobId: "j1",
      status: "done",
      clips: [
        { title: "A", startSec: 0, endSec: 30, outputUrl: "https://x/a.mp4" },
        { title: "B", startSec: 5, endSec: 9 },
      ],
    });
    expect(job.status).toBe("done");
    expect(job.clips).toHaveLength(2);
    expect(job.clips[0]!.outputUrl).toBe("https://x/a.mp4");
    expect(job.clips[1]!.outputUrl).toBeNull();
    expect(isStreamCutJobSettled(job.status)).toBe(true);
  });

  it("a garbled status reads as still working, never done", () => {
    expect(streamCutJobOf({ status: "complete" }).status).toBe("queued");
    expect(streamCutJobOf(null).status).toBe("queued");
    expect(isStreamCutJobSettled("processing")).toBe(false);
    expect(isStreamCutJobSettled("failed")).toBe(true);
  });
});

describe("smart prices + paths — the route constant is the truth (item 95)", () => {
  it("render is 200 per clip, pinned to SMART_CLIPS_PER_CLIP; propose is its own free path", () => {
    expect(SMART_RENDER_COST_PER_CLIP_VB).toBe(200);
    expect(smartRoute).toContain("const SMART_CLIPS_PER_CLIP = 200");
    expect(SMART_PROPOSE_PATH).toBe("/api/smart-clips/propose");
    expect(SMART_RENDER_PATH).toBe("/api/smart-clips");
    expect(SMART_CLIP_LENGTHS).toEqual([15, 30, 45, 60]);
    expect(SMART_CLIP_COUNTS).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("smart proposals — the rail's honesty pins (item 95)", () => {
  const body = {
    proposals: [
      { startTime: 10, endTime: 55, title: "Hook", score: 91, reason: "r", quote: "q", method: "semantic" },
      { startTime: 70, endTime: 100, title: "Loud part", score: 88, reason: "r2", quote: "", method: "energy" },
      { startTime: "x", endTime: 5, title: "Broken" },
    ],
    analysisMethod: "mixed",
    durationSec: 600,
  };

  it("parses proposals; an energy pick NEVER gains a score", () => {
    const parsed = smartProposalsOf(body);
    expect(parsed).not.toBeNull();
    expect(parsed!.proposals).toHaveLength(2);
    expect(parsed!.proposals[0]!.score).toBe(91);
    expect(parsed!.proposals[1]!.score).toBeNull();
    expect(parsed!.analysisMethod).toBe("mixed");
  });

  it("an empty proposals list is a REAL answer (empty set), not a failure", () => {
    const parsed = smartProposalsOf({ proposals: [] });
    expect(parsed).not.toBeNull();
    expect(parsed!.proposals).toEqual([]);
    expect(smartProposalsOf(null)).toBeNull();
    expect(smartProposalsOf({})).toBeNull();
    expect(smartProposalsOf("nope")).toBeNull();
  });

  it("a fresh draft is kept, with the page's m:ss text times", () => {
    const d = smartDraftOf(smartProposalsOf(body)!.proposals[0]!);
    expect(d.keep).toBe(true);
    expect(d.startText).toBe("0:10");
    expect(d.endText).toBe("0:55");
  });
});

describe("smart drafts — only kept, valid windows ever render (item 95)", () => {
  const draft = (patch: Partial<SmartDraft>): SmartDraft => ({
    startTime: 0,
    endTime: 45,
    title: "T",
    score: 50,
    reason: "",
    quote: "",
    method: "semantic",
    keep: true,
    startText: "0:00",
    endText: "0:45",
    ...patch,
  });

  it("parseSmartTimeText reads m:ss and bare seconds; junk is null", () => {
    expect(parseSmartTimeText("1:05")).toBe(65);
    expect(parseSmartTimeText("90")).toBe(90);
    expect(parseSmartTimeText("0:45")).toBe(45);
    expect(parseSmartTimeText("1:75")).toBeNull();
    expect(parseSmartTimeText("")).toBeNull();
    expect(parseSmartTimeText("abc")).toBeNull();
  });

  it("the window must sit inside the rail's 5–120s", () => {
    expect(smartDraftWindow(draft({}))).toEqual({ start: 0, end: 45 });
    expect(smartDraftWindow(draft({ endText: "0:03" }))).toBeNull();
    expect(smartDraftWindow(draft({ endText: "2:30" }))).toBeNull();
    expect(smartDraftWindow(draft({ startText: "x" }))).toBeNull();
    expect(smartDraftWindow(draft({ startText: "0:50", endText: "0:40" }))).toBeNull();
  });

  it("keptSmartDrafts drops the unkept and the invalid", () => {
    const kept = keptSmartDrafts([
      draft({ title: "A" }),
      draft({ title: "B", keep: false }),
      draft({ title: "C", endText: "0:02" }),
    ]);
    expect(kept.map((k) => k.draft.title)).toEqual(["A"]);
  });

  it("the render body is the page's exact shape, tenths-rounded", () => {
    const kept = keptSmartDrafts([draft({ startText: "0:10", endText: "0:55" })]);
    expect(buildSmartRenderBody("https://x/v.mp4", kept)).toEqual({
      videoUrl: "https://x/v.mp4",
      clips: [{ startTime: 10, endTime: 55, title: "T", reason: "", quote: "", score: 50, method: "semantic" }],
    });
  });

  it("rendered clips parse; rows without a file drop; energy scores stay null", () => {
    const clips = smartClipsOf({
      clips: [
        { url: "https://x/c1.mp4", startTime: 0, endTime: 30, title: "One", score: 77, method: "semantic" },
        { url: "https://x/c2.mp4", startTime: 5, endTime: 20, title: "Two", score: 99, method: "energy" },
        { startTime: 0, endTime: 1, title: "No file" },
      ],
    });
    expect(clips).toHaveLength(2);
    expect(clips[0]!.score).toBe(77);
    expect(clips[1]!.score).toBeNull();
    expect(smartClipsOf(null)).toEqual([]);
    expect(smartClipsOf({})).toEqual([]);
  });
});

describe("item 118 copy — Check again, never refresh", () => {
  it("the lost-jobs copy names the Check again action in en and all nine verbatim catalogs", () => {
    const en = readJson("../../locales/en.json");
    expect(en.repurpose.error.lostJobs).toContain("Check again");
    expect(en.repurpose.error.lostJobs.toLowerCase()).not.toContain("refresh");
    expect(en.worldRepurposeDesk.checkAgain).toBe("Check again");
    expect(en.worldRepurposeDesk.checkingJobs).toBeTruthy();
    expect(en.worldRepurposeDesk.streamOutOfBucs).toBeTruthy();
    expect(en.worldRepurposeDesk.smartOutOfBucs).toBeTruthy();
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.repurpose.error.lostJobs, loc).toBe(en.repurpose.error.lostJobs);
    }
  });
});
