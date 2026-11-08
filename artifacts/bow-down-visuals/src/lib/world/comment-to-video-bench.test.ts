/**
 * comment-to-video-bench — Stack 300 world parity (Lane B
 * item 9) seam pins. The bench mirrors the section: the
 * route's price as the override (this rail has no registry
 * entry — the page's override is the house pattern for it),
 * the page's comment caps, its post body, and a whole-script
 * answer guard. Copy: the commentToVideo namespace is new
 * to the catalogs with this bench — en values are the
 * section's own literals; the other nine catalogs carry
 * them English-verbatim UNREVIEWED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMMENT_TO_VIDEO_COST,
  COMMENT_TO_VIDEO_MAX_COMMENTS,
  COMMENT_TO_VIDEO_PATH,
  addBenchComment,
  buildCommentVideoPayload,
  commentVideoInputReady,
  commentVideoScriptCopyText,
  commentVideoScriptsOf,
  type CommentVideoScript,
} from "./comment-to-video-bench";

const SCRIPT: CommentVideoScript = {
  title: "Answering THAT comment",
  hook: "You asked, I delivered",
  script: "Full script here",
  visualPlan: "Close-up, then the drop",
  cta: "Follow for part 2",
};

describe("the rail + the price", () => {
  it("posts where the section posts, at the route's 200", () => {
    expect(COMMENT_TO_VIDEO_PATH).toBe("/api/comment-to-video/scripts");
    expect(COMMENT_TO_VIDEO_COST).toBe(200);
  });

  it("shapes the section's post body", () => {
    expect(buildCommentVideoPayload([" one ", "two"], " drill ")).toEqual({
      comments: [" one ", "two"],
      niche: "drill",
      count: 3,
    });
  });
});

describe("the comment adder — the section's rules", () => {
  it("trims, refuses blanks, and stops at 20", () => {
    expect(addBenchComment([], "  hello  ")).toEqual(["hello"]);
    expect(addBenchComment([], "   ")).toBeNull();
    const full = Array.from({ length: COMMENT_TO_VIDEO_MAX_COMMENTS }, (_, i) => `c${i}`);
    expect(addBenchComment(full, "one more")).toBeNull();
    expect(commentVideoInputReady([])).toBe(false);
    expect(commentVideoInputReady(["x"])).toBe(true);
  });
});

describe("the answer guard", () => {
  it("takes whole scripts only", () => {
    expect(commentVideoScriptsOf({ scripts: [SCRIPT] })).toEqual([SCRIPT]);
    expect(commentVideoScriptsOf({ scripts: [{ ...SCRIPT, cta: 7 }] })).toBeNull();
    expect(commentVideoScriptsOf({ scripts: [] })).toBeNull();
    expect(commentVideoScriptsOf({})).toBeNull();
  });

  it("copies a script in the section's own format", () => {
    expect(commentVideoScriptCopyText(SCRIPT)).toBe(
      "Answering THAT comment\n\nHOOK: You asked, I delivered\n\nFull script here\n\nVISUALS: Close-up, then the drop\n\nCTA: Follow for part 2",
    );
  });
});

describe("the copy — the namespace, verbatim in every catalog until reviewed", () => {
  it("commentToVideo + worldBenches300 ride all ten catalogs identically", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    expect(en.commentToVideo.title).toBe("Comment-to-Video");
    expect(en.commentToVideo.generate).toBe("Write Response Scripts");
    expect(en.worldBenches300.outOfBucs).toContain("Treasury");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.commentToVideo, loc).toEqual(en.commentToVideo);
      expect(cat.worldBenches300, loc).toEqual(en.worldBenches300);
    }
  });
});
