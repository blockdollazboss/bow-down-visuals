/**
 * video-studio-desk — stack200 world parity lane B1, census
 * item 5 pins. The Video Studio desk is the video-studio
 * page's hub surface:
 * - its pickers' data lives in data/video-studio.ts, moved
 *   VERBATIM off the unrouted page (the desk never imports
 *   the page — a sibling lane deletes it);
 * - the submit body is the page's exact shape (camera prompt
 *   folded in, the page's ratio rule, gen4.5, reference only
 *   in image mode) on the registry-priced runway-clip rail;
 * - the poll verdicts are the page's: succeeded+url = done,
 *   succeeded without a url = the honest "empty" failure,
 *   failed/cancelled = failure, anything else = still working;
 * - the hub spine is the page's: project picks fill only an
 *   empty prompt, the Thumbnail winner is taken one-shot off
 *   the shared key, and the finished clip's hub record
 *   carries the RAIL's duration — never the picker's.
 *
 * TRANSLATION STATUS: worldVideoStudio.* is en-source; the
 * other nine catalogs carry the English VERBATIM, flagged
 * UNREVIEWED here and in the components pin. Camera/preset
 * labels are DATA (data/video-studio.ts), not extracted copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAMERA_MOVEMENTS,
  ONE_CLICK_PRESETS,
  VIDEO_STUDIO_ASPECTS,
  VIDEO_STUDIO_DURATIONS,
} from "@/data/video-studio";
import { THUMBNAIL_WINNER_HANDOFF_KEY, videoClipCost } from "./create-desks";
import {
  VIDEO_STUDIO_CLIP_PATH,
  buildStudioClipBody,
  cameraMovementOf,
  interpretStudioPoll,
  ratioForAspect,
  studioClipAsset,
  studioProjectPick,
  studioSubmitOf,
  takeThumbnailWinner,
  videoStudioTaskPath,
} from "./video-studio-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../../pages/video-studio.tsx");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

describe("the shared data — verbatim off the page", () => {
  it("the camera catalog is the page's twelve movements, prompts included", () => {
    expect(CAMERA_MOVEMENTS).toHaveLength(12);
    for (const c of CAMERA_MOVEMENTS) {
      expect(page, c.id).toContain(`id: "${c.id}"`);
      expect(page, c.id).toContain(`prompt: "${c.prompt}"`);
    }
    expect(cameraMovementOf("push-in")?.prompt).toBe("slow push in, dolly forward");
    expect(cameraMovementOf("nope")).toBeNull();
  });

  it("presets, durations and aspects match the page's tables", () => {
    expect(ONE_CLICK_PRESETS.map((p) => p.id)).toEqual([
      "cinematic-intro",
      "product-showcase",
      "social-teaser",
      "music-clip",
    ]);
    for (const p of ONE_CLICK_PRESETS) {
      expect(page).toContain(`id: "${p.id}"`);
      expect(page).toContain(`camera: "${p.camera}"`);
    }
    expect(VIDEO_STUDIO_DURATIONS).toEqual([5, 10, 15, 30]);
    expect(VIDEO_STUDIO_ASPECTS.map((a) => a.id)).toEqual(["16:9", "9:16", "1:1"]);
  });

  it("the price is the registry's runway-clip row, read through the create seam", () => {
    expect(videoClipCost()).toBe(400);
    expect(VIDEO_STUDIO_CLIP_PATH).toBe("/api/generate-runway-clip");
    expect(videoStudioTaskPath("t 1")).toBe("/api/generate-runway-clip/t%201");
  });
});

describe("the submit — the page's exact body", () => {
  it("folds the camera prompt into the prompt text, gen4.5, no reference in text mode", () => {
    expect(buildStudioClipBody({ prompt: " a stage ", cameraId: "orbit-left", aspectId: "16:9" })).toEqual({
      promptText: "a stage, orbit around subject to the left",
      ratio: "1280:720",
      referenceImageUrl: undefined,
      model: "gen4.5",
    });
  });

  it("the ratio rule is the page's: only 9:16 is portrait — 1:1 rides landscape", () => {
    expect(ratioForAspect("9:16")).toBe("720:1280");
    expect(ratioForAspect("16:9")).toBe("1280:720");
    expect(ratioForAspect("1:1")).toBe("1280:720");
    expect(buildStudioClipBody({ prompt: "x", cameraId: "static", aspectId: "1:1" }).ratio).toBe("1280:720");
  });

  it("image mode carries the reference; an unknown camera folds in nothing", () => {
    const body = buildStudioClipBody({
      prompt: "x",
      cameraId: "gone",
      aspectId: "9:16",
      referenceImageUrl: "https://img/r.jpg",
    });
    expect(body.referenceImageUrl).toBe("https://img/r.jpg");
    expect(body.promptText).toBe("x, ");
  });

  it("a submit without a task id parses to null; the duration defaults to the rail's 5", () => {
    expect(studioSubmitOf({ taskId: "t1", durationSec: 5 })).toEqual({ taskId: "t1", durationSec: 5 });
    expect(studioSubmitOf({ taskId: "t1" })).toEqual({ taskId: "t1", durationSec: 5 });
    expect(studioSubmitOf({ error: "nope" })).toBeNull();
    expect(studioSubmitOf(null)).toBeNull();
  });
});

describe("the poll — the page's verdicts", () => {
  it("succeeded with a url is done; succeeded without one is the honest empty failure", () => {
    expect(interpretStudioPoll({ status: "succeeded", url: "https://v/c.mp4" })).toEqual({
      state: "done",
      url: "https://v/c.mp4",
    });
    expect(interpretStudioPoll({ status: "succeeded", url: null })).toEqual({ state: "empty" });
    expect(interpretStudioPoll({ status: "succeeded" })).toEqual({ state: "empty" });
  });

  it("failed/cancelled fail; anything else is still working — never a premature done", () => {
    expect(interpretStudioPoll({ status: "failed", error: "boom" })).toEqual({
      state: "failed",
      message: "boom",
    });
    expect(interpretStudioPoll({ status: "cancelled" })).toEqual({ state: "failed", message: null });
    for (const s of ["queued", "processing", "running", ""]) {
      expect(interpretStudioPoll({ status: s })).toEqual({ state: "working" });
    }
    expect(interpretStudioPoll(null)).toEqual({ state: "working" });
  });
});

describe("the hub spine — the page's rules", () => {
  it("a song fills only an EMPTY prompt (idea first, fallback line second) and sets 16:9", () => {
    const song = { kind: "song" as const, label: "My Track", url: "https://x/s.mp3", meta: { musicVideoIdea: "neon rooftop" } };
    expect(studioProjectPick(song, "")).toEqual({ prompt: "neon rooftop", aspect: "16:9" });
    expect(studioProjectPick(song, "already writing")).toEqual({ prompt: undefined, aspect: "16:9" });
    expect(studioProjectPick({ ...song, meta: {} }, "")).toEqual({
      prompt: "My Track — cinematic music video shot",
      aspect: "16:9",
    });
  });

  it("a script fills an empty prompt from its hook; a thumbnail anchors image mode", () => {
    const script = { kind: "script" as const, label: "S", url: "https://x/s", meta: { hook: "a hook" } };
    expect(studioProjectPick(script, "")).toEqual({ prompt: "Cinematic visual for: a hook" });
    expect(studioProjectPick(script, "busy")).toEqual({ prompt: undefined });
    const thumb = { kind: "thumbnail" as const, label: "T", url: "https://x/t.jpg", meta: {} };
    expect(studioProjectPick(thumb, "")).toEqual({ referenceImage: "https://x/t.jpg" });
    expect(studioProjectPick({ kind: "video" as const, label: "V", url: "https://x/v", meta: {} }, "")).toBeNull();
  });

  it("the winner pickup is one-shot off the shared key and never throws on dead storage", () => {
    expect(THUMBNAIL_WINNER_HANDOFF_KEY).toBe("wave8_thumbnail_winner");
    const store = new Map<string, string>([[THUMBNAIL_WINNER_HANDOFF_KEY, "https://x/win.jpg"]]);
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => void store.delete(k),
    };
    expect(takeThumbnailWinner(storage)).toBe("https://x/win.jpg");
    expect(takeThumbnailWinner(storage)).toBeNull();
    const dead = {
      getItem: () => {
        throw new Error("no storage");
      },
      removeItem: () => undefined,
    };
    expect(takeThumbnailWinner(dead)).toBeNull();
  });

  it("the finished clip's hub record carries the RAIL's duration, never the picker's", () => {
    const asset = studioClipAsset({
      url: "https://v/c.mp4",
      prompt: "  a stage performance ",
      cameraId: "tracking",
      aspectId: "9:16",
      durationSec: 5,
    });
    expect(asset.kind).toBe("video");
    expect(asset.detail).toBe("5s · 9:16 · tracking");
    expect(asset.meta).toEqual({ prompt: "a stage performance", camera: "tracking", duration: "5", aspect: "9:16" });
    expect(asset.label).toBe("a stage performance");
  });
});

describe("copy — en source, English verbatim UNREVIEWED in the other nine", () => {
  it("worldVideoStudio matches across catalogs and carries the page's failure wording", () => {
    const en = readJson("../../locales/en.json");
    expect(en.worldVideoStudio.emptySuccess).toBe(
      "Generation finished without a clip — no Visual Bucs were charged.",
    );
    expect(page).toContain("Generation finished without a clip — no Visual Bucs were charged.");
    expect(en.worldVideoStudio.timedOut).toBe(
      "Generation timed out — the clip may still finish in the background.",
    );
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      expect(readJson(`../../locales/${loc}.json`).worldVideoStudio, loc).toEqual(en.worldVideoStudio);
    }
  });
});
