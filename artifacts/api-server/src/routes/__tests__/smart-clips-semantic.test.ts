/**
 * Tests for the semantic clip finder on the general long-form → shorts
 * rail (artifacts/api-server/src/routes/generate/video-to-shorts.ts) and
 * the shared detector it ports from the streamer rail
 * (artifacts/api-server/src/lib/semantic-highlights.ts).
 *
 * Covers: score parsing/honesty (never fabricated), score+reason on
 * every semantic candidate, best-first ranking, free-text moment search
 * reaching the right span of a fixture transcript, semantic picks
 * outranking the energy-only signal, the honest no-transcript energy
 * fallback, and the rail's auth gate + per-clip price pin.
 *
 * The propose → approve → render contract is pinned too: proposals come
 * from the analysis step (which never charges and never renders), and
 * the render step accepts ONLY an explicit approved-clips list — there
 * is no request shape that makes the server choose moments itself.
 */
import { describe, it, expect } from "vitest";
import {
  parseSemanticScore,
  parseSemanticHighlights,
  detectSemanticHighlights,
} from "../../lib/semantic-highlights";
import smartClipsRouter, {
  selectClipCandidates,
  pickEnergySegments,
  normalizeApprovedClips,
  analysisMethodOf,
  smartClipsRenderSchema,
  APPROVED_CLIP_MIN_SEC,
  APPROVED_CLIP_MAX_SEC,
  SMART_CLIPS_PER_CLIP,
  type ClipCandidate,
} from "../generate/video-to-shorts";
import { requireAuth } from "../../middlewares/require-auth";

describe("parseSemanticScore — honest scores only", () => {
  it("clamps real numbers to 0–100 integers", () => {
    expect(parseSemanticScore(87.6)).toBe(88);
    expect(parseSemanticScore(150)).toBe(100);
    expect(parseSemanticScore(-4)).toBe(0);
    expect(parseSemanticScore(0)).toBe(0);
  });
  it("returns null (never a fabricated number) for unusable values", () => {
    expect(parseSemanticScore(undefined)).toBeNull();
    expect(parseSemanticScore(null)).toBeNull();
    expect(parseSemanticScore("high")).toBeNull();
    expect(parseSemanticScore(NaN)).toBeNull();
    expect(parseSemanticScore(Infinity)).toBeNull();
  });
});

describe("parseSemanticHighlights", () => {
  const opts = { clipLength: 30, maxClips: 5, durationSec: 3600 };

  it("keeps score + reason + quote on every candidate", () => {
    const raw = JSON.stringify({
      highlights: [
        { startSec: 61, endSec: 91, score: 92, title: "Clutch win", reason: "Insane comeback", quote: "no way!" },
      ],
    });
    const out = parseSemanticHighlights(raw, opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      startSec: 61,
      endSec: 91,
      score: 92,
      title: "Clutch win",
      reason: "Insane comeback",
      quote: "no way!",
    });
  });

  it("ranks best-first: higher score first, unscored last, timeline breaks ties", () => {
    const raw = JSON.stringify({
      highlights: [
        { startSec: 500, score: 40, title: "Weak", reason: "r", quote: "" },
        { startSec: 300, score: 95, title: "Best late", reason: "r", quote: "" },
        { startSec: 100, score: 95, title: "Best early", reason: "r", quote: "" },
        { startSec: 50, title: "Unscored", reason: "r", quote: "" },
      ],
    });
    const out = parseSemanticHighlights(raw, opts);
    expect(out.map((h) => h.title)).toEqual(["Best early", "Best late", "Weak", "Unscored"]);
    expect(out[3]!.score).toBeNull();
  });

  it("drops junk, dedupes near-identical starts, and survives invalid JSON", () => {
    expect(parseSemanticHighlights("not json", opts)).toEqual([]);
    const raw = JSON.stringify({
      highlights: [
        { startSec: -3, score: 90, title: "Negative", reason: "r", quote: "" },
        { startSec: 100, score: 90, title: "", reason: "r", quote: "" },
        { startSec: 100, score: 90, title: "Real", reason: "r", quote: "" },
        { startSec: 103, score: 80, title: "Dupe", reason: "r", quote: "" },
      ],
    });
    const out = parseSemanticHighlights(raw, opts);
    expect(out.map((h) => h.title)).toEqual(["Real"]);
  });
});

const FIXTURE_TRANSCRIPT = [
  "[00:05] welcome back everyone, today we are touring the studio",
  "[02:00] this is the part where I explain pricing for the course",
  "[02:20] the price breaks down into three simple tiers",
  "[07:30] here is a funny story about a refund that went wrong",
].join("\n");

/** A model stub that behaves like a real search: it reads the direction
 *  out of the system prompt, finds the transcript line carrying the
 *  query's key word, and returns that span. If the query names a topic
 *  that is not in the transcript, it honestly returns nothing. */
function queryDrivenModelStub(captured: Array<Array<{ role: string; content: string }>>) {
  return async (messages: Array<{ role: string; content: string }>) => {
    captured.push(messages);
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const queryMatch = /creator: "([^"]+)"/.exec(system);
    const query = queryMatch?.[1] ?? "";
    const keyWord = query.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? "";
    const line = user.split("\n").find((l) => keyWord && l.toLowerCase().includes(keyWord.toLowerCase()));
    if (!line) return JSON.stringify({ highlights: [] });
    const ts = /\[(\d+):(\d+)\]/.exec(line);
    const startSec = ts ? Number(ts[1]) * 60 + Number(ts[2]) : 0;
    return JSON.stringify({
      highlights: [
        {
          startSec,
          score: 88,
          title: "The pricing breakdown",
          reason: "Direct match for the requested moment",
          quote: line.replace(/^\[\d+:\d+\]\s*/, "").slice(0, 60),
        },
      ],
    });
  };
}

describe("detectSemanticHighlights — free-text moment search", () => {
  it("finds the right span for a creator's description, with score + reason", async () => {
    const captured: Array<Array<{ role: string; content: string }>> = [];
    const out = await detectSemanticHighlights(
      FIXTURE_TRANSCRIPT,
      { clipLength: 30, maxClips: 5, durationSec: 900, query: "explain pricing" },
      queryDrivenModelStub(captured),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.startSec).toBe(120); // the [02:00] pricing line, not the refund story
    expect(out[0]!.score).toBe(88);
    expect(out[0]!.reason).toContain("match");
    // The creator's words actually reached the model.
    expect(captured[0]!.find((m) => m.role === "system")!.content).toContain("explain pricing");
  });

  it("returns nothing (honest no-match) when the described moment is absent", async () => {
    const captured: Array<Array<{ role: string; content: string }>> = [];
    const out = await detectSemanticHighlights(
      FIXTURE_TRANSCRIPT,
      { clipLength: 30, maxClips: 5, durationSec: 900, query: "cooking segment" },
      queryDrivenModelStub(captured),
    );
    expect(out).toEqual([]);
  });
});

describe("selectClipCandidates — semantic outranks energy, fallback stays honest", () => {
  const windows = [
    { start: 600, energy: -5 }, // loudest window in the video
    { start: 300, energy: -10 },
    { start: 120, energy: -8 },
    { start: 60, energy: -20 },
  ];

  it("semantic picks win their slots; energy only fills the rest", () => {
    const picks = selectClipCandidates({
      semantic: [
        { id: "s1", startSec: 120, endSec: 150, title: "Pricing breakdown", reason: "Direct match", quote: "q", score: 92 },
      ],
      energyWindows: windows,
      count: 3,
      clipDuration: 30,
      durationSec: 900,
      outcome: "ok",
      query: "explain pricing",
    });
    expect(picks).toHaveLength(3);
    // Timeline order for viewing; the semantic moment is present and the
    // loudest energy window (600) did not displace it.
    expect(picks.map((p) => p.start)).toEqual([120, 290, 590]);
    const semanticPick = picks.find((p) => p.method === "semantic")!;
    expect(semanticPick).toMatchObject({ start: 120, score: 92, title: "Pricing breakdown" });
    expect(semanticPick.reason).toBe("Direct match");
    for (const p of picks.filter((p) => p.method === "energy")) {
      expect(p.score).toBeNull(); // energy never masquerades as a quality score
    }
  });

  it("no-transcript fallback: all energy, no scores, reason says why", () => {
    const picks = selectClipCandidates({
      semantic: [],
      energyWindows: [
        { start: 100, energy: -5 },
        { start: 400, energy: -9 },
      ],
      count: 2,
      clipDuration: 30,
      durationSec: 600,
      outcome: "no-speech",
    });
    expect(picks).toHaveLength(2);
    for (const p of picks) {
      expect(p.method).toBe("energy");
      expect(p.score).toBeNull();
      expect(p.reason).toContain("no speech was detected");
    }
  });

  it("no-match fallback names the creator's search in the reason", () => {
    const picks = selectClipCandidates({
      semantic: [],
      energyWindows: [{ start: 100, energy: -5 }],
      count: 1,
      clipDuration: 30,
      durationSec: 600,
      outcome: "no-match",
      query: "explain pricing",
    });
    expect(picks).toHaveLength(1);
    expect(picks[0]!.reason).toContain('No moment matched "explain pricing"');
  });

  it("short/silent video still yields the opening segment, honestly labeled", () => {
    const picks: ClipCandidate[] = selectClipCandidates({
      semantic: [],
      energyWindows: [],
      count: 3,
      clipDuration: 45,
      durationSec: 20,
      outcome: "no-speech",
    });
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ start: 0, method: "energy", score: null });
  });
});

describe("pickEnergySegments — original detector math preserved", () => {
  it("centers clips on the loudest non-overlapping windows", () => {
    const picked = pickEnergySegments(
      [
        { start: 0, energy: -30 },
        { start: 100, energy: -5 },
        { start: 110, energy: -6 },
        { start: 300, energy: -12 },
      ],
      2,
      30,
      900,
    );
    // Loudest window 100 → clip centered at 90; 110 overlaps it; next is 300 → 290.
    expect(picked.map((p) => p.start)).toEqual([90, 290]);
  });
});

describe("rail guards", () => {
  it("pins the per-clip price (a margin change must be a deliberate edit)", () => {
    expect(SMART_CLIPS_PER_CLIP).toBe(200);
  });

  it("POST /smart-clips sits behind requireAuth — clips are only ever cut for their owner", () => {
    const stack = (smartClipsRouter as unknown as { stack: Array<any> }).stack;
    const layer = stack.find(
      (l) => l.route?.path === "/smart-clips" && l.route?.methods?.post,
    );
    expect(layer).toBeTruthy();
    const handlers = layer.route.stack.map((s: any) => s.handle);
    expect(handlers).toContain(requireAuth);
  });

  it("POST /smart-clips/propose sits behind requireAuth too", () => {
    const stack = (smartClipsRouter as unknown as { stack: Array<any> }).stack;
    const layer = stack.find(
      (l) => l.route?.path === "/smart-clips/propose" && l.route?.methods?.post,
    );
    expect(layer).toBeTruthy();
    const handlers = layer.route.stack.map((s: any) => s.handle);
    expect(handlers).toContain(requireAuth);
  });
});

describe("propose step — analysis only, never charges, never renders", () => {
  function handlerFor(path: string) {
    const stack = (smartClipsRouter as unknown as { stack: Array<any> }).stack;
    const layer = stack.find((l) => l.route?.path === path && l.route?.methods?.post);
    expect(layer).toBeTruthy();
    const handlers = layer.route.stack.map((s: any) => s.handle as Function);
    return handlers[handlers.length - 1]!;
  }

  it("the propose handler touches no charge, render, or upload rail", () => {
    const src = handlerFor("/smart-clips/propose").toString();
    expect(src).not.toContain("chargeCredits");
    expect(src).not.toContain("refundCredits");
    expect(src).not.toContain("execFileAsync"); // no ffmpeg → nothing renders
    expect(src).not.toContain("uploadMediaToSupabaseStorage");
    expect(src).toContain("analyzeClipCandidates");
  });

  it("the render handler is the one that charges (200 VB per approved clip)", () => {
    const src = handlerFor("/smart-clips").toString();
    expect(src).toContain("chargeCredits");
    expect(src).toContain("normalizeApprovedClips");
  });
});

describe("render contract — no approved list, no render (no auto-render path)", () => {
  it("refuses a request with no clips field at all", () => {
    const out = smartClipsRenderSchema.safeParse({ videoUrl: "https://x/v.mp4" });
    expect(out.success).toBe(false);
  });

  it("refuses an empty clips list", () => {
    const out = smartClipsRenderSchema.safeParse({ videoUrl: "https://x/v.mp4", clips: [] });
    expect(out.success).toBe(false);
  });

  it("refuses more clips than the rail's per-job cap", () => {
    const clip = { startTime: 0, endTime: 30 };
    const out = smartClipsRenderSchema.safeParse({
      videoUrl: "https://x/v.mp4",
      clips: [clip, clip, clip, clip, clip, clip],
    });
    expect(out.success).toBe(false);
  });

  it("accepts an explicit approved window with its proposal metadata", () => {
    const out = smartClipsRenderSchema.safeParse({
      videoUrl: "https://x/v.mp4",
      clips: [
        {
          startTime: 120,
          endTime: 150,
          title: "The pricing breakdown",
          reason: "Direct match",
          quote: "the price breaks down into three simple tiers",
          score: 88,
          method: "semantic",
        },
      ],
    });
    expect(out.success).toBe(true);
  });
});

describe("normalizeApprovedClips — renders exactly what the creator approved", () => {
  it("keeps a valid approved window with its metadata, in timeline order", () => {
    const out = normalizeApprovedClips(
      [
        { startTime: 300, endTime: 330, title: "Later", reason: "r2", quote: "q2", score: 70, method: "semantic" },
        { startTime: 120, endTime: 150, title: "Pricing breakdown", reason: "Direct match", quote: "q1", score: 92, method: "semantic" },
      ],
      900,
    );
    expect(out.map((c) => c.start)).toEqual([120, 300]);
    expect(out[0]).toMatchObject({ end: 150, title: "Pricing breakdown", score: 92, method: "semantic" });
  });

  it("honors a creator trim (shorter than the proposed window)", () => {
    const out = normalizeApprovedClips(
      [{ startTime: 122, endTime: 140, title: "Trimmed", method: "semantic", score: 80 }],
      900,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 122, end: 140 });
  });

  it("clamps an end past the video's end to the video end", () => {
    const out = normalizeApprovedClips(
      [{ startTime: 880, endTime: 990, title: "Tail", method: "semantic", score: 60 }],
      900,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.end).toBe(900);
  });

  it("caps an over-long window at the max clip length", () => {
    const out = normalizeApprovedClips(
      [{ startTime: 0, endTime: 900, title: "Everything", method: "semantic", score: 50 }],
      900,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.end - out[0]!.start).toBe(APPROVED_CLIP_MAX_SEC);
  });

  it("drops windows trimmed below the minimum length — and a fully-invalid set yields nothing to render", () => {
    const tooShort = normalizeApprovedClips(
      [{ startTime: 100, endTime: 100 + APPROVED_CLIP_MIN_SEC - 1, title: "Stub", method: "semantic" }],
      900,
    );
    expect(tooShort).toEqual([]);
    const beyondVideo = normalizeApprovedClips(
      [{ startTime: 950, endTime: 980, title: "Ghost", method: "semantic" }],
      900,
    );
    expect(beyondVideo).toEqual([]);
    expect(normalizeApprovedClips([], 900)).toEqual([]);
  });

  it("collapses duplicate windows so the same moment is never rendered (or charged) twice", () => {
    const clip = { startTime: 120, endTime: 150, title: "Once", method: "semantic" as const, score: 90 };
    const out = normalizeApprovedClips([clip, { ...clip }], 900);
    expect(out).toHaveLength(1);
  });

  it("an energy window can never gain a score at render time (honesty pin)", () => {
    const out = normalizeApprovedClips(
      [{ startTime: 60, endTime: 90, title: "Loud part", method: "energy", score: 99 }],
      900,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeNull();
  });
});

describe("analysisMethodOf — the set label both steps share", () => {
  it("labels homogeneous and mixed sets", () => {
    expect(analysisMethodOf([{ method: "semantic" }, { method: "semantic" }])).toBe("semantic");
    expect(analysisMethodOf([{ method: "energy" }])).toBe("energy");
    expect(analysisMethodOf([{ method: "semantic" }, { method: "energy" }])).toBe("mixed");
  });
});
