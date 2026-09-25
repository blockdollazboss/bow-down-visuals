/**
 * Money-integrity + validation tests for the Press Kit Builder.
 *
 * Covers: the 3-credit generation / 1-credit bio-refresh pricing, the
 * max_completion_tokens contract (never max_tokens), handle validation,
 * the public-kit shape (never leaks user_id), and request schema guards.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod/v4";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  pressKitsTable: { id: "id", handle: "handle", user_id: "user_id" },
  artistVaultsTable: { id: "id", user_id: "user_id" },
  pressKitHandleSchema: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
}));

import {
  PRESS_KIT_GENERATE_CREDITS,
  PRESS_KIT_BIO_REFRESH_CREDITS,
  generatePressKitSchema,
  updatePressKitSchema,
  regenerateBioSchema,
  toPublicKit,
} from "../press-kit";
import * as fs from "fs";
import * as path from "path";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("press-kit pricing", () => {
  it("charges 3 credits for full kit generation", () => {
    expect(PRESS_KIT_GENERATE_CREDITS).toBe(3);
  });

  it("charges 1 credit for a bio refresh", () => {
    expect(PRESS_KIT_BIO_REFRESH_CREDITS).toBe(1);
  });

  it("both prices are env-overridable numbers", () => {
    expect(Number.isFinite(PRESS_KIT_GENERATE_CREDITS)).toBe(true);
    expect(Number.isFinite(PRESS_KIT_BIO_REFRESH_CREDITS)).toBe(true);
  });
});

describe("token parameter contract", () => {
  it("uses max_completion_tokens and never max_tokens", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "press-kit.ts"), "utf8");
    expect(src).toContain("max_completion_tokens");
    expect(src).not.toMatch(/\bmax_tokens\b/);
  });
});

describe("generatePressKitSchema", () => {
  const valid = {
    handle: "shark-king",
    artist_name: "Thy Cheat Code",
  };

  it("accepts a minimal valid request", () => {
    const r = generatePressKitSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects an invalid handle", () => {
    const r = generatePressKitSchema.safeParse({ ...valid, handle: "Bad Handle!" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing artist name", () => {
    const r = generatePressKitSchema.safeParse({ handle: "shark-king" });
    expect(r.success).toBe(false);
  });

  it("rejects more than 12 photos", () => {
    const r = generatePressKitSchema.safeParse({
      ...valid,
      photo_urls: Array.from({ length: 13 }, (_, i) => `https://example.com/p${i}.jpg`),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a track with a non-URL", () => {
    const r = generatePressKitSchema.safeParse({
      ...valid,
      top_tracks: [{ title: "Anthem", url: "not-a-url" }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid tracks, quotes, and achievements", () => {
    const r = generatePressKitSchema.safeParse({
      ...valid,
      achievements: ["Headlined the Abyss Arena"],
      press_quotes: [{ quote: "A force of nature.", source: "Bass Magazine" }],
      top_tracks: [{ title: "Anthem", url: "https://open.spotify.com/track/abc" }],
    });
    expect(r.success).toBe(true);
  });

  it("caps achievements at 20", () => {
    const r = generatePressKitSchema.safeParse({
      ...valid,
      achievements: Array.from({ length: 21 }, (_, i) => `Win ${i}`),
    });
    expect(r.success).toBe(false);
  });
});

describe("updatePressKitSchema", () => {
  it("allows partial updates including a free bio edit", () => {
    const r = updatePressKitSchema.safeParse({ bio: "Edited bio text.", is_public: false });
    expect(r.success).toBe(true);
  });

  it("still validates handle on update", () => {
    const r = updatePressKitSchema.safeParse({ handle: "UPPERCASE" });
    expect(r.success).toBe(false);
  });
});

describe("regenerateBioSchema", () => {
  it("defaults tone to professional", () => {
    const r = regenerateBioSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tone).toBe("professional");
  });

  it("rejects an unknown tone", () => {
    const r = regenerateBioSchema.safeParse({ tone: "mysterious" });
    expect(r.success).toBe(false);
  });
});

describe("toPublicKit", () => {
  it("strips user_id from the public shape", () => {
    const row = {
      id: "kit-1",
      user_id: "user-123",
      handle: "shark-king",
      artist_name: "Thy Cheat Code",
    } as never;
    const pub = toPublicKit(row) as Record<string, unknown>;
    expect(pub).not.toHaveProperty("user_id");
    expect(pub["handle"]).toBe("shark-king");
    expect(pub["id"]).toBe("kit-1");
  });
});
