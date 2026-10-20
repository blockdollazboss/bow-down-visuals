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
  // Mirrors lib/db/src/schema/press-kits.ts (the route builds its update
  // schema from it at module level).
  pressKitLayoutSchema: z
    .array(
      z.object({
        key: z.enum(["bio", "achievements", "press_quotes", "top_tracks", "photos", "contact"]),
        visible: z.boolean(),
      }),
    )
    .max(6)
    .superRefine((entries, ctx) => {
      const seen = new Set<string>();
      entries.forEach((entry, i) => {
        if (seen.has(entry.key)) {
          ctx.addIssue({ code: "custom", path: [i, "key"], message: `Duplicate press-kit section: ${entry.key}` });
        }
        seen.add(entry.key);
      });
    }),
  pressKitReleaseSchema: z.object({
    id: z.string().min(1).max(64),
    headline: z.string().min(1).max(200),
    body: z.string().min(1).max(20000),
    announcementType: z.string().min(1).max(40),
    social: z.string().min(1).max(320),
    createdAt: z.string().min(1).max(40),
  }),
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
    expect(PRESS_KIT_GENERATE_CREDITS).toBe(300);
  });

  it("charges 1 credit for a bio refresh", () => {
    expect(PRESS_KIT_BIO_REFRESH_CREDITS).toBe(100);
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

describe("updatePressKitSchema — page layout", () => {
  const fullLayout = [
    { key: "top_tracks", visible: true },
    { key: "bio", visible: true },
    { key: "achievements", visible: false },
    { key: "press_quotes", visible: true },
    { key: "photos", visible: true },
    { key: "contact", visible: true },
  ];

  it("accepts a full reordered layout with a hidden section", () => {
    const r = updatePressKitSchema.safeParse({ layout: fullLayout });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.layout).toEqual(fullLayout);
  });

  it("accepts a partial layout (a subset of sections)", () => {
    const r = updatePressKitSchema.safeParse({ layout: [{ key: "photos", visible: false }] });
    expect(r.success).toBe(true);
  });

  it("accepts layout: null — clearing back to the default render", () => {
    const r = updatePressKitSchema.safeParse({ layout: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.layout).toBeNull();
  });

  it("rejects an unknown section key", () => {
    const r = updatePressKitSchema.safeParse({ layout: [{ key: "merch_table", visible: true }] });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate section keys", () => {
    const r = updatePressKitSchema.safeParse({
      layout: [
        { key: "bio", visible: true },
        { key: "bio", visible: false },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more entries than there are sections", () => {
    const r = updatePressKitSchema.safeParse({
      layout: [...fullLayout, { key: "bio", visible: true }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-boolean visible flag", () => {
    const r = updatePressKitSchema.safeParse({ layout: [{ key: "bio", visible: "yes" }] });
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

  it("carries the saved layout to the public shape", () => {
    const layout = [
      { key: "photos", visible: true },
      { key: "bio", visible: false },
    ];
    const row = {
      id: "kit-1",
      user_id: "user-123",
      handle: "shark-king",
      artist_name: "Thy Cheat Code",
      layout,
    } as never;
    const pub = toPublicKit(row) as Record<string, unknown>;
    expect(pub["layout"]).toEqual(layout);
    expect(pub).not.toHaveProperty("user_id");
  });

  it("serves layout as null when the kit never saved one", () => {
    const row = {
      id: "kit-1",
      user_id: "user-123",
      handle: "shark-king",
      artist_name: "Thy Cheat Code",
      layout: undefined,
    } as never;
    const pub = toPublicKit(row) as Record<string, unknown>;
    expect(pub["layout"]).toBeNull();
  });
});
