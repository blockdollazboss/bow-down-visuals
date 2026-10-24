/**
 * A-04 + A-05 (Stack-100 #3) — price-decision pins.
 *
 * A-04: the translator rail charges minutes × languages ×
 * VIDEO_TRANSLATOR_CREDITS_PER_MINUTE (500). Displays quote that
 * per-minute-per-language price — the FE registry/KB parity for the
 * display strings is pinned by operator-knowledge.test.ts; here the
 * rail's own constant is pinned so the quoted unit can never drift
 * from the charge.
 *
 * A-05: AI Upscale is officially 1,500 VB (owner-approved 2026-10-24) —
 * the charge stays and the "placeholder" framing is gone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { VIDEO_TRANSLATOR_CREDITS_PER_MINUTE } from "../generate/video-translator";
import { GENERATIVE_UPSCALE_CREDIT_COST } from "../generate/upscale-generative";

describe("A-04 — translator rail constant", () => {
  it("charges 500 VB per minute per language", () => {
    expect(VIDEO_TRANSLATOR_CREDITS_PER_MINUTE).toBe(500);
  });
});

describe("A-05 — AI Upscale price is official", () => {
  it("charges 1,500 VB", () => {
    expect(GENERATIVE_UPSCALE_CREDIT_COST).toBe(1500);
  });

  it("carries no placeholder framing", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../generate/upscale-generative.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/PLACEHOLDER/);
    expect(src).toMatch(/owner-approved 2026-10-24/);
  });
});
