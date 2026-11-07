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
  buildRerollBody,
  formatRepurposeTime,
  isRepurposeJobSettled,
  repurposeJobOf,
  repurposeJobPath,
  repurposePackOf,
  rerollResultOf,
  rerolledThumbnailOf,
} from "./repurpose-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const route = read("../../../../api-server/src/routes/generate/repurpose.ts");
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
