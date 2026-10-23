import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Stack-28 #52 (A5-P7) — witty-loader is poster-first; no preload=auto video. */
const src = readFileSync(new URL("../components/delight/witty-loader.tsx", import.meta.url), "utf8");

describe("witty-loader poster-first (Stack-28 #52)", () => {
  it("video is gated behind the wait-running state with preload=none", () => {
    expect(src).not.toContain('preload="auto"');
    expect(src).toContain('preload="none"');
    expect(src).toContain("videoReady &&");
    expect(src).toContain("setTimeout(() => setVideoReady(true), 600)");
  });
  it("poster img renders immediately", () => {
    expect(src).toContain('src={mediaUrl("images/loading-bg-light-throne.webp")}');
  });
});
