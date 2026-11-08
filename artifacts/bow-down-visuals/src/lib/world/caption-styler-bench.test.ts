/**
 * caption-styler-bench — Stack 300 world parity (Lane B
 * item 7) seam pins. The bench must ride the styler page's
 * own rail at the registry's price, shape the multipart
 * fields exactly as the page appends them, and hold every
 * job answer to the page's real statuses — a drifted
 * payload parses to null, never to a dressed-up status.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPTION_STYLER_FONT_SIZES,
  CAPTION_STYLER_MAX_BYTES,
  CAPTION_STYLER_PATH,
  CAPTION_STYLER_POSITIONS,
  CAPTION_STYLER_STYLE_LABEL_KEYS,
  CAPTION_STYLER_STYLES,
  captionStylerCost,
  captionStylerFileVerdict,
  captionStylerFormFields,
  captionStylerJobOf,
  captionStylerJobPath,
  captionStylerStartedOf,
  isCaptionStylerBusyStatus,
} from "./caption-styler-bench";
import { getCreditCost } from "../credit-costs";

describe("the rail + the price", () => {
  it("posts where the page posts, at the registry's 300", () => {
    expect(CAPTION_STYLER_PATH).toBe("/api/caption-styler");
    expect(getCreditCost(CAPTION_STYLER_PATH)?.cost).toBe(300);
    expect(captionStylerCost()).toBe(300);
    expect(captionStylerJobPath("job 1")).toBe("/api/caption-styler/job%201");
  });

  it("carries the page's enums verbatim", () => {
    expect(CAPTION_STYLER_STYLES).toEqual(["hormozi", "minimal", "karaoke", "neon", "luxury-gold"]);
    expect(CAPTION_STYLER_POSITIONS).toEqual(["top", "middle", "bottom"]);
    expect(CAPTION_STYLER_FONT_SIZES).toEqual(["small", "medium", "large"]);
    expect(CAPTION_STYLER_STYLE_LABEL_KEYS["luxury-gold"]).toBe("luxuryGold");
  });
});

describe("the upload rules — the page's pickFile, shared", () => {
  it("accepts a video under 80 MB and refuses the rest", () => {
    expect(captionStylerFileVerdict({ type: "video/mp4", size: 1024 })).toBe("ok");
    expect(captionStylerFileVerdict({ type: "video/mp4", size: CAPTION_STYLER_MAX_BYTES })).toBe("ok");
    expect(captionStylerFileVerdict({ type: "video/mp4", size: CAPTION_STYLER_MAX_BYTES + 1 })).toBe("too-large");
    expect(captionStylerFileVerdict({ type: "image/png", size: 1024 })).toBe("not-video");
  });

  it("shapes the multipart fields in the page's append order", () => {
    expect(
      captionStylerFormFields({ style: "karaoke", position: "top", fontSize: "large", withEmoji: true }),
    ).toEqual([
      ["style", "karaoke"],
      ["position", "top"],
      ["fontSize", "large"],
      ["withEmoji", "true"],
    ]);
    expect(
      captionStylerFormFields({ style: "minimal", position: "bottom", fontSize: "small", withEmoji: false })[3],
    ).toEqual(["withEmoji", "false"]);
  });
});

describe("the job guards", () => {
  it("a start answer needs a job id", () => {
    expect(captionStylerStartedOf({ jobId: "j1", status: "queued", creditsRemaining: 900 })).toEqual({
      jobId: "j1",
      status: "queued",
      creditsRemaining: 900,
    });
    expect(captionStylerStartedOf({ status: "queued" })).toBeNull();
    expect(captionStylerStartedOf(null)).toBeNull();
    expect(captionStylerStartedOf("nope")).toBeNull();
  });

  it("poll answers hold the real statuses only", () => {
    expect(captionStylerJobOf({ status: "transcribing" })).toEqual({ status: "transcribing", outputUrl: null });
    expect(captionStylerJobOf({ status: "done", outputUrl: "https://x/v.mp4" })).toEqual({
      status: "done",
      outputUrl: "https://x/v.mp4",
    });
    expect(captionStylerJobOf({ status: "failed" })).toEqual({ status: "failed", outputUrl: null });
    expect(captionStylerJobOf({ status: "mystery" })).toBeNull();
    expect(captionStylerJobOf({})).toBeNull();
    expect(isCaptionStylerBusyStatus("rendering")).toBe(true);
    expect(isCaptionStylerBusyStatus("done")).toBe(false);
  });
});

describe("the copy — the page's namespace, present in every catalog", () => {
  it("the bench's captionStyler keys resolve in en and ride all ten catalogs", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    for (const key of ["styleButton", "errorJobFailed", "statusTranscribing", "doneTitle", "infoText"]) {
      expect(typeof en.captionStyler[key], key).toBe("string");
    }
    expect(en.captionStyler.styles.luxuryGold.label).toBe("Luxury Gold");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.captionStyler.styleButton, loc).toBeTruthy();
    }
  });
});
