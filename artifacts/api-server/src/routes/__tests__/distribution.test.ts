/**
 * Tests for the Music Distribution hub (/api/distribution/*).
 *
 * Covers:
 * - pricing constants (AI 1 credit, packaging 10 credits, env-overridable)
 * - platform list integrity (9 platforms, every key has a label)
 * - the v1 honesty contract: RELEASE_STATUSES has no "delivered" status,
 *   and the route source uses max_completion_tokens (GPT-6 rejects max_tokens)
 * - release CRUD with real DB semantics via pg-mem: auth scoping,
 *   validation, draft locking, delete rules
 * - submit: 402 when out of credits, 409 when already packaged,
 *   charge-then-package on success
 * - AI endpoints: 400 on invalid input, 402 when out of credits,
 *   refund on provider failure
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userCredits: 0,
  chargeImpl: null as null | ((userId: string, cost: number, record: any) => Promise<number>),
  refundCalls: [] as Array<{ userId: string; amount: number; record: any }>,
  openAiImpl: null as null | (() => Promise<any>),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = testState.userCredits;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (userId: string, cost: number, record: any) => {
    if (testState.chargeImpl) return testState.chargeImpl(userId, cost, record);
    return 100 - cost;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number, record: any) => {
    testState.refundCalls.push({ userId, amount, record });
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-6-sol",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async (_args: any) => {
          if (testState.openAiImpl) return testState.openAiImpl();
          throw new Error("openAiImpl not set");
        },
      },
    },
  }),
}));

import router, {
  AI_CREDIT_COST,
  DISTRIBUTION_RELEASE_CREDITS,
  DISTRIBUTION_PLATFORMS,
  PLATFORM_LABEL,
  RELEASE_STATUSES,
  RELEASE_TIER_CREDITS,
  metadataSchema,
  strategySchema,
  createReleaseSchema,
  isValidUpc,
  generateInternalBarcode,
  upcACheckDigit,
  ean13CheckDigit,
} from "../generate/distribution";
import { chargeCredits } from "../../lib/credits";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const RELEASES_DDL = `
CREATE TABLE distribution_releases (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  artist_name text NOT NULL,
  release_date text,
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_url text,
  artwork_url text,
  metadata jsonb,
  strategy jsonb,
  status text NOT NULL DEFAULT 'draft',
  credits_charged integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  release_type text NOT NULL DEFAULT 'single',
  isrc text,
  genre text,
  explicit boolean NOT NULL DEFAULT false,
  explicit_declared boolean NOT NULL DEFAULT false,
  upc text,
  label text,
  copyright_line text,
  song_id uuid,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  aggregator text NOT NULL DEFAULT 'none',
  aggregator_release_id text,
  platform_statuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  presave_slug text,
  split_share_slug text,
  /* Release Metadata Manager (migration 0079) */
  upc_kind text NOT NULL DEFAULT 'internal',
  label_imprint text,
  copyright_c_line text,
  copyright_p_line text,
  subgenre text,
  original_release_date text,
  preorder_date text,
  territories_mode text NOT NULL DEFAULT 'worldwide',
  territories jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Pre-save upgrades (migration 0082, sibling worker) */
  presave_headline text,
  presave_platform_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  presave_bonus_url text
);`;

const PRESAVE_TABLES_DDL = `
CREATE TABLE presave_follows (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL,
  email text NOT NULL,
  name text,
  platform text,
  source text NOT NULL DEFAULT 'presave',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, email)
);
CREATE TABLE presave_shares (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL,
  channel text,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const SPLITS_DDL = `
CREATE TABLE distribution_royalty_splits (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL,
  user_id uuid NOT NULL,
  payee_name text NOT NULL,
  role text,
  share_pct numeric(5,2) NOT NULL,
  payee_email text,
  invite_status text NOT NULL DEFAULT 'not_invited',
  invite_token text,
  agreement_version integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

/* Minimal songs table — only the columns the songId ownership check reads. */
const SONGS_DDL = `
CREATE TABLE songs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  audio_url text NOT NULL
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const USER_A = randomUUID();
const USER_B = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(RELEASES_DDL);
  mem.public.none(SPLITS_DDL);
  mem.public.none(SONGS_DDL);
  mem.public.none(PRESAVE_TABLES_DDL);
  testState.db = db;
  testState.userId = USER_A;
  testState.userCredits = 10000;
  testState.chargeImpl = null;
  testState.refundCalls = [];
  testState.openAiImpl = null;
  vi.clearAllMocks();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function futureDate(daysOut: number): string {
  const d = new Date(Date.now() + daysOut * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function seedRelease(userId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  /* `complete: true` fills every checklist field so submit can proceed. */
  const complete = overrides["complete"] === true;
  const releaseType = (overrides["release_type"] as string) ?? "single";
  const trackCount = releaseType === "album" ? 7 : releaseType === "ep" ? 3 : 1;
  const tracks = complete
    ? JSON.stringify(
        Array.from({ length: trackCount }, (_, i) => ({ title: `Track ${i + 1}` })),
      )
    : "[]";
  await testState.db.execute(sql`
    INSERT INTO distribution_releases
      (id, user_id, title, artist_name, status, platforms, release_type,
       audio_url, artwork_url, release_date, explicit_declared, genre, tracks)
    VALUES (
      ${id}, ${userId}, ${"Test Track"}, ${"Test Artist"},
      ${(overrides["status"] as string) ?? "draft"},
      ${JSON.stringify(["spotify"])},
      ${releaseType},
      ${complete ? "https://example.com/audio.mp3" : null},
      ${complete ? "https://example.com/art.jpg" : null},
      ${complete ? futureDate(30) : null},
      ${complete},
      ${complete ? "Hip-Hop" : null},
      ${tracks}::jsonb
    )
  `);
  return { id };
}

/* ─── pricing & platform constants ───────────────────────────────────────── */

describe("pricing constants", () => {
  it("charges 1 credit per AI generation", () => {
    expect(AI_CREDIT_COST).toBe(100);
  });
  it("charges 10 credits per release packaging", () => {
    expect(DISTRIBUTION_RELEASE_CREDITS).toBe(1000);
  });
});

describe("platform list", () => {
  it("covers 9 platforms with a label for each", () => {
    expect(DISTRIBUTION_PLATFORMS).toHaveLength(9);
    for (const key of DISTRIBUTION_PLATFORMS) {
      expect(PLATFORM_LABEL[key]).toBeTruthy();
    }
  });
  it("includes the big three streaming services", () => {
    expect(DISTRIBUTION_PLATFORMS).toContain("spotify");
    expect(DISTRIBUTION_PLATFORMS).toContain("apple_music");
    expect(DISTRIBUTION_PLATFORMS).toContain("youtube_music");
  });
});

describe("v1 honesty contract", () => {
  it("has no 'delivered' status — v1 prepares, it does not claim delivery", () => {
    expect(RELEASE_STATUSES).toEqual(["draft", "packaged"]);
    expect(RELEASE_STATUSES).not.toContain("delivered");
  });
  it("uses max_completion_tokens, never max_tokens (GPT-6 rejects max_tokens)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "generate", "distribution.ts"), "utf8");
    expect(src).toContain("max_completion_tokens");
    /* No `max_tokens:` call-site parameter (the bare word may appear in
       comments explaining why max_completion_tokens is used instead). */
    expect(src).not.toMatch(/[^_]max_tokens\s*:/);
  });
});

/* ─── schema validation ──────────────────────────────────────────────────── */

describe("metadataSchema", () => {
  it("accepts a vibe-only request", () => {
    expect(metadataSchema.safeParse({ vibe: "dark trap" }).success).toBe(true);
  });
  it("rejects an empty vibe", () => {
    expect(metadataSchema.safeParse({ vibe: "" }).success).toBe(false);
  });
  it("rejects an overlong vibe", () => {
    expect(metadataSchema.safeParse({ vibe: "x".repeat(501) }).success).toBe(false);
  });
});

describe("strategySchema", () => {
  it("rejects an unknown platform", () => {
    expect(
      strategySchema.safeParse({ title: "T", artistName: "A", platforms: ["myspace"] }).success,
    ).toBe(false);
  });
  it("accepts valid platforms", () => {
    expect(
      strategySchema.safeParse({ title: "T", artistName: "A", platforms: ["spotify", "tidal"] }).success,
    ).toBe(true);
  });
});

describe("createReleaseSchema", () => {
  it("requires title and artist name", () => {
    expect(createReleaseSchema.safeParse({ title: "", artistName: "A" }).success).toBe(false);
    expect(createReleaseSchema.safeParse({ title: "T", artistName: "" }).success).toBe(false);
  });
  it("rejects a malformed audio URL", () => {
    expect(
      createReleaseSchema.safeParse({ title: "T", artistName: "A", audioUrl: "not-a-url" }).success,
    ).toBe(false);
  });
  it("accepts empty-string URLs (treated as unset)", () => {
    const r = createReleaseSchema.safeParse({ title: "T", artistName: "A", audioUrl: "" });
    expect(r.success).toBe(true);
  });
});

/* ─── release CRUD ───────────────────────────────────────────────────────── */

describe("POST /api/distribution/releases", () => {
  it("creates a draft release (free — no credit charge)", async () => {
    const { status, json } = await req("POST", "/distribution/releases", {
      title: "Midnight Frequencies",
      artistName: "Shark King",
      releaseDate: "2026-11-01",
      platforms: ["spotify", "apple_music"],
    });
    expect(status).toBe(201);
    expect(json.release.title).toBe("Midnight Frequencies");
    expect(json.release.status).toBe("draft");
    expect(json.release.platforms).toEqual(["spotify", "apple_music"]);
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("returns 400 when the title is missing", async () => {
    const { status } = await req("POST", "/distribution/releases", { artistName: "A" });
    expect(status).toBe(400);
  });

  it("returns 400 for an unknown platform", async () => {
    const { status } = await req("POST", "/distribution/releases", {
      title: "T",
      artistName: "A",
      platforms: ["napster"],
    });
    expect(status).toBe(400);
  });
});

describe("GET /api/distribution/releases", () => {
  it("returns only the caller's releases", async () => {
    await seedRelease(USER_A);
    await seedRelease(USER_B);
    const { status, json } = await req("GET", "/distribution/releases");
    expect(status).toBe(200);
    expect(json.releases).toHaveLength(1);
    expect(json.releases[0].artistName).toBe("Test Artist");
  });

  it("returns an empty list when the user has none", async () => {
    const { status, json } = await req("GET", "/distribution/releases");
    expect(status).toBe(200);
    expect(json.releases).toEqual([]);
  });
});

describe("GET /api/distribution/releases/:id", () => {
  it("404s for another user's release", async () => {
    const { id } = await seedRelease(USER_B);
    const { status } = await req("GET", `/distribution/releases/${id}`);
    expect(status).toBe(404);
  });
});

describe("PATCH /api/distribution/releases/:id", () => {
  it("updates a draft", async () => {
    const { id } = await seedRelease(USER_A);
    const { status, json } = await req("PATCH", `/distribution/releases/${id}`, {
      title: "Renamed Track",
    });
    expect(status).toBe(200);
    expect(json.release.title).toBe("Renamed Track");
  });

  it("409s when the release is already packaged", async () => {
    const { id } = await seedRelease(USER_A, { status: "packaged" });
    const { status } = await req("PATCH", `/distribution/releases/${id}`, { title: "Nope" });
    expect(status).toBe(409);
  });
});

describe("DELETE /api/distribution/releases/:id", () => {
  it("deletes a draft", async () => {
    const { id } = await seedRelease(USER_A);
    const { status } = await req("DELETE", `/distribution/releases/${id}`);
    expect(status).toBe(200);
    const check = await req("GET", `/distribution/releases/${id}`);
    expect(check.status).toBe(404);
  });

  it("409s when the release is already packaged", async () => {
    const { id } = await seedRelease(USER_A, { status: "packaged" });
    const { status } = await req("DELETE", `/distribution/releases/${id}`);
    expect(status).toBe(409);
  });
});

/* ─── submit (paid packaging) ────────────────────────────────────────────── */

describe("POST /api/distribution/releases/:id/submit", () => {
  it("400s when the release checklist is incomplete", async () => {
    const { id } = await seedRelease(USER_A);
    const { status, json } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(400);
    expect(json.checklist).toBeDefined();
    expect(json.checklist.some((c: any) => c.key === "audio" && !c.ok)).toBe(true);
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("402s when the user can't afford the tier fee", async () => {
    testState.userCredits = 500;
    const { id } = await seedRelease(USER_A, { complete: true });
    const { status, json } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("409s when the release is already packaged (no double charge)", async () => {
    const { id } = await seedRelease(USER_A, { status: "packaged" });
    const { status } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(409);
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("404s for another user's release", async () => {
    const { id } = await seedRelease(USER_B);
    const { status } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(404);
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("charges the single-tier fee, marks packaged, queues platform delivery", async () => {
    const { id } = await seedRelease(USER_A, { complete: true });
    const { status, json } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(200);
    expect(chargeCredits).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chargeCredits).mock.calls[0]?.[1]).toBe(RELEASE_TIER_CREDITS.single);
    expect(json.release.status).toBe("packaged");
    expect(json.release.creditsCharged).toBe(RELEASE_TIER_CREDITS.single);
    expect(json.creditsUsed).toBe(RELEASE_TIER_CREDITS.single);
    expect(json.release.aggregator).toBe("mock");
    expect(json.release.aggregatorReleaseId).toBeTruthy();
    expect(json.release.platformStatuses).toHaveLength(1);
    expect(json.release.platformStatuses[0].status).toBe("queued");
    /* Honesty: the notice must not claim platform delivery happened. */
    expect(json.notice).toMatch(/sandbox/i);
    expect(json.notice).not.toMatch(/has been delivered|is now live on/i);
  });

  it("charges the EP tier (20 credits) for EPs", async () => {
    const { id } = await seedRelease(USER_A, { complete: true, release_type: "ep" });
    const { status, json } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(200);
    expect(vi.mocked(chargeCredits).mock.calls[0]?.[1]).toBe(RELEASE_TIER_CREDITS.ep);
    expect(json.creditsUsed).toBe(2000);
  });

  it("refunds when the aggregator submission fails", async () => {
    const { id } = await seedRelease(USER_A, { complete: true });
    testState.userCredits = 10000;
    const { getAggregator } = await import("../../lib/distribution-aggregator");
    const agg = getAggregator();
    const spy = vi.spyOn(agg, "submitRelease").mockRejectedValueOnce(new Error("boom"));
    const { status } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(502);
    const { refundCredits } = await import("../../lib/credits");
    expect(vi.mocked(refundCredits)).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

/* ─── AI endpoints ───────────────────────────────────────────────────────── */

describe("POST /api/distribution/metadata", () => {
  it("400s on an empty vibe", async () => {
    const { status } = await req("POST", "/distribution/metadata", { vibe: "" });
    expect(status).toBe(400);
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("402s when out of credits (no charge attempted)", async () => {
    testState.userCredits = 0;
    const { status, json } = await req("POST", "/distribution/metadata", { vibe: "dark trap" });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("returns parsed metadata on success", async () => {
    testState.openAiImpl = async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              titleOptions: ["Midnight Tide", "Gold Water"],
              description: "A dark luxury trap anthem.",
              genreTags: ["trap", "phonk"],
            }),
          },
        },
      ],
    });
    const { status, json } = await req("POST", "/distribution/metadata", { vibe: "dark trap" });
    expect(status).toBe(200);
    expect(json.titleOptions).toEqual(["Midnight Tide", "Gold Water"]);
    expect(json.description).toBe("A dark luxury trap anthem.");
    expect(json.genreTags).toEqual(["trap", "phonk"]);
    expect(json.creditsUsed).toBe(AI_CREDIT_COST);
    expect(chargeCredits).toHaveBeenCalledTimes(1);
  });

  it("refunds the credit when the provider fails", async () => {
    testState.openAiImpl = async () => {
      throw new Error("provider exploded");
    };
    const { status } = await req("POST", "/distribution/metadata", { vibe: "dark trap" });
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.refundCalls[0]?.amount).toBe(AI_CREDIT_COST);
  });

  it("refunds the credit when the model returns garbage", async () => {
    testState.openAiImpl = async () => ({ choices: [{ message: { content: "not json at all" } }] });
    const { status } = await req("POST", "/distribution/metadata", { vibe: "dark trap" });
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
  });
});

describe("POST /api/distribution/strategy", () => {
  it("400s when the title is missing", async () => {
    const { status } = await req("POST", "/distribution/strategy", { artistName: "A" });
    expect(status).toBe(400);
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("402s when out of credits", async () => {
    testState.userCredits = 0;
    const { status, json } = await req("POST", "/distribution/strategy", {
      title: "T",
      artistName: "A",
    });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
  });

  it("returns a parsed strategy on success", async () => {
    testState.openAiImpl = async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              timing: "Release on Friday.",
              promoPlan: ["Tease on TikTok", "Pre-save push"],
              checklist: ["Artwork 3000x3000", "ISRC codes"],
            }),
          },
        },
      ],
    });
    const { status, json } = await req("POST", "/distribution/strategy", {
      title: "T",
      artistName: "A",
      platforms: ["spotify"],
    });
    expect(status).toBe(200);
    expect(json.timing).toBe("Release on Friday.");
    expect(json.promoPlan).toHaveLength(2);
    expect(json.checklist).toHaveLength(2);
    expect(json.creditsUsed).toBe(AI_CREDIT_COST);
  });

  it("refunds the credit when the provider fails", async () => {
    testState.openAiImpl = async () => {
      throw new Error("provider exploded");
    };
    const { status } = await req("POST", "/distribution/strategy", { title: "T", artistName: "A" });
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.refundCalls[0]?.amount).toBe(AI_CREDIT_COST);
  });
});

/* ─── v2: tiered pricing ──────────────────────────────────────────────────── */

describe("tiered release pricing", () => {
  it("single 1,000 / EP 2,000 / album 3,000 Visual Bucs", () => {
    expect(RELEASE_TIER_CREDITS.single).toBe(1000);
    expect(RELEASE_TIER_CREDITS.ep).toBe(2000);
    expect(RELEASE_TIER_CREDITS.album).toBe(3000);
  });

  it("GET /api/distribution/pricing exposes live tiers", async () => {
    const { status, json } = await req("GET", "/distribution/pricing");
    expect(status).toBe(200);
    expect(json.tiers).toHaveLength(3);
    expect(json.tiers.find((t: any) => t.type === "album").credits).toBe(3000);
    expect(json.annualPlan.comingSoon).toBe(true);
    expect(json.aggregator).toBe("mock");
    expect(json.aggregatorLive).toBe(false);
  });
});

/* ─── v2: ISRC validation on create ───────────────────────────────────────── */

/* ─── Release Metadata Manager: barcode helpers ─────────────────────────── */

describe("barcode helpers", () => {
  it("computes correct GS1 check digits", () => {
    expect(upcACheckDigit("03600029145")).toBe("2"); // classic UPC-A example
    expect(ean13CheckDigit("590123412345")).toBe("7"); // classic EAN-13 example
  });

  it("mints valid-format internal UPC-A placeholders in the 09 range", () => {
    for (let i = 0; i < 25; i++) {
      const code = generateInternalBarcode();
      expect(code).toMatch(/^09\d{10}$/);
      expect(upcACheckDigit(code.slice(0, 11))).toBe(code[11]);
    }
  });

  it("validates UPC-A and EAN-13 check digits, rejects garbage", () => {
    expect(isValidUpc("036000291452")).toBe(true);
    expect(isValidUpc("036000291453")).toBe(false); // bad check digit
    expect(isValidUpc("5901234123457")).toBe(true);
    expect(isValidUpc("5901234123458")).toBe(false);
    expect(isValidUpc("123")).toBe(false);
    expect(isValidUpc("")).toBe(true); // optional
    expect(isValidUpc(null)).toBe(true);
  });

  it("generate-barcode endpoint mints an internal barcode (free, draft only)", async () => {
    const { id } = await seedRelease(USER_A);
    const { status, json } = await req("POST", `/distribution/releases/${id}/generate-barcode`);
    expect(status).toBe(200);
    expect(json.barcode).toMatch(/^09\d{10}$/);
    expect(json.kind).toBe("internal");
    expect(json.release.upc).toBe(json.barcode);
    expect(json.release.upcKind).toBe("internal");
    expect(String(json.notice)).toMatch(/Internal catalog ID/i);
  });

  it("generate-barcode refuses to overwrite an official UPC", async () => {
    const { id } = await seedRelease(USER_A);
    await req("PATCH", `/distribution/releases/${id}`, {
      upc: "036000291452",
      upcKind: "official",
    });
    const { status, json } = await req("POST", `/distribution/releases/${id}/generate-barcode`);
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/official UPC/i);
  });

  it("rejects a malformed UPC on create", async () => {
    const { status } = await req("POST", "/distribution/releases", {
      title: "Test Track",
      artistName: "Test Artist",
      upc: "12345",
    });
    expect(status).toBe(400);
  });

  it("stores metadata fields (imprint, ©/℗ lines, subgenre, dates, territories)", async () => {
    const { status, json } = await req("POST", "/distribution/releases", {
      title: "Metadata Track",
      artistName: "Test Artist",
      labelImprint: "Gold Fin Records",
      copyrightCLine: "© 2026 Gold Fin Records",
      copyrightPLine: "℗ 2026 Gold Fin Records",
      subgenre: "Dark Trap",
      originalReleaseDate: "2026-09-01",
      preorderDate: "2026-10-01",
      territoriesMode: "exclude",
      territories: ["KP", "IR"],
    });
    expect(status).toBe(201);
    expect(json.release.labelImprint).toBe("Gold Fin Records");
    expect(json.release.copyrightCLine).toBe("© 2026 Gold Fin Records");
    expect(json.release.copyrightPLine).toBe("℗ 2026 Gold Fin Records");
    expect(json.release.subgenre).toBe("Dark Trap");
    expect(json.release.originalReleaseDate).toBe("2026-09-01");
    expect(json.release.preorderDate).toBe("2026-10-01");
    expect(json.release.territoriesMode).toBe("exclude");
    expect(json.release.territories).toEqual(["KP", "IR"]);
    expect(json.release.upcKind).toBe("internal");
  });
});

describe("ISRC validation", () => {
  it("rejects a malformed release ISRC", async () => {
    const { status } = await req("POST", "/distribution/releases", {
      title: "Test Track",
      artistName: "Test Artist",
      isrc: "not-an-isrc",
    });
    expect(status).toBe(400);
  });

  it("accepts a valid 12-char ISRC (dashes/spaces tolerated)", async () => {
    const { status, json } = await req("POST", "/distribution/releases", {
      title: "Test Track",
      artistName: "Test Artist",
      isrc: "us-abc24 12345",
    });
    expect(status).toBe(201);
    expect(json.release.isrc).toBe("USABC2412345");
  });

  it("rejects another user's songId", async () => {
    const { status } = await req("POST", "/distribution/releases", {
      title: "Test Track",
      artistName: "Test Artist",
      songId: randomUUID(),
    });
    expect(status).toBe(400);
  });

  it("prefills audio from an owned library song", async () => {
    const songId = randomUUID();
    await testState.db.execute(sql`
      INSERT INTO songs (id, user_id, title, audio_url)
      VALUES (${songId}, ${USER_A}, ${"My Song"}, ${"https://example.com/mysong.mp3"})
    `);
    const { status, json } = await req("POST", "/distribution/releases", {
      title: "My Song",
      artistName: "Test Artist",
      songId,
    });
    expect(status).toBe(201);
    expect(json.release.audioUrl).toBe("https://example.com/mysong.mp3");
    expect(json.release.songId).toBe(songId);
  });
});

/* ─── v2: royalty splits ──────────────────────────────────────────────────── */

describe("PUT /api/distribution/releases/:id/splits", () => {
  it("400s when shares don't total 100", async () => {
    const { id } = await seedRelease(USER_A);
    const { status, json } = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [
        { name: "Me", share: 60 },
        { name: "Producer", share: 30 },
      ],
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/100%/);
  });

  it("saves splits that total 100 and returns them on detail", async () => {
    const { id } = await seedRelease(USER_A);
    const { status, json } = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [
        { name: "Me", role: "Artist", share: 70 },
        { name: "Producer", role: "Producer", share: 30 },
      ],
    });
    expect(status).toBe(200);
    expect(json.splits).toHaveLength(2);
    const detail = await req("GET", `/distribution/releases/${id}`);
    expect(detail.json.release.royaltySplits).toHaveLength(2);
    expect(detail.json.release.royaltySplits[0].share).toBe(70);
  });

  it("404s for another user's release", async () => {
    const { id } = await seedRelease(USER_B);
    const { status } = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [{ name: "Me", share: 100 }],
    });
    expect(status).toBe(404);
  });

  it("versions agreements: re-saving supersedes the old version (future earnings only)", async () => {
    const { id } = await seedRelease(USER_A);
    const first = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [
        { name: "Me", role: "artist", share: 70 },
        { name: "Producer", role: "producer", email: "prod@example.com", share: 30 },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.json.agreementVersion).toBe(1);
    expect(first.json.splits[1].email).toBe("prod@example.com");

    const second = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [
        { name: "Me", role: "artist", share: 60 },
        { name: "Producer", role: "producer", share: 40 },
      ],
    });
    expect(second.status).toBe(200);
    expect(second.json.agreementVersion).toBe(2);
    /* Detail returns only the active (newest) version. */
    const detail = await req("GET", `/distribution/releases/${id}`);
    expect(detail.json.release.royaltySplits).toHaveLength(2);
    expect(detail.json.release.royaltySplits.find((s: any) => s.name === "Producer").share).toBe(40);
  });

  it("400s on an invalid email or role", async () => {
    const { id } = await seedRelease(USER_A);
    const badEmail = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [{ name: "Me", email: "not-an-email", share: 100 }],
    });
    expect(badEmail.status).toBe(400);
    const badRole = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [{ name: "Me", role: "alien", share: 100 }],
    });
    expect(badRole.status).toBe(400);
  });
});

/* ─── splits: share link, public summary, invites ────────────────────────── */

describe("splits share links + invites", () => {
  it("mints an idempotent share slug and serves the agreement publicly", async () => {
    const { id } = await seedRelease(USER_A);
    await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [{ name: "Me", role: "artist", share: 100 }],
    });
    const minted = await req("POST", `/distribution/releases/${id}/splits/share-link`);
    expect(minted.status).toBe(200);
    expect(minted.json.slug).toMatch(/^[a-f0-9]{10}$/);
    const again = await req("POST", `/distribution/releases/${id}/splits/share-link`);
    expect(again.json.slug).toBe(minted.json.slug);
    /* Public endpoint (no auth middleware in this router for the GET). */
    const pub = await req("GET", `/distribution/splits/${minted.json.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.json.title).toBeTruthy();
    expect(pub.json.splits).toHaveLength(1);
    expect(pub.json.disclaimer).toMatch(/distribution partner/i);
    const bogus = await req("GET", `/distribution/splits/deadbeef00`);
    expect(bogus.status).toBe(404);
  });

  it("records invites and fails clearly without an email provider", async () => {
    const { id } = await seedRelease(USER_A);
    const saved = await req("PUT", `/distribution/releases/${id}/splits`, {
      splits: [
        { name: "Me", share: 80 },
        { name: "Writer", role: "writer", email: "writer@example.com", share: 20 },
      ],
    });
    const writer = saved.json.splits.find((s: any) => s.name === "Writer");
    const invited = await req("POST", `/distribution/releases/${id}/splits/invite`, {
      splitId: writer.id,
    });
    /* No email provider in test env: 501, invite still recorded. */
    expect(invited.status).toBe(501);
    expect(invited.json.recorded).toBe(true);
    expect(invited.json.emailSent).toBe(false);
    expect(invited.json.error).toMatch(/email provider/i);
    const me = saved.json.splits.find((s: any) => s.name === "Me");
    const noEmail = await req("POST", `/distribution/releases/${id}/splits/invite`, {
      splitId: me.id,
    });
    expect(noEmail.status).toBe(400);
    expect(noEmail.json.error).toMatch(/email/i);
  });
});

/* ─── v2: pre-save links ──────────────────────────────────────────────────── */

describe("pre-save links", () => {
  it("mints a slug and serves it publicly", async () => {
    const { id } = await seedRelease(USER_A);
    const minted = await req("POST", `/distribution/releases/${id}/presave`);
    expect(minted.status).toBe(200);
    expect(minted.json.slug).toMatch(/^[a-f0-9]{10}$/);
    expect(minted.json.url).toContain(minted.json.slug);
    /* Idempotent — same slug on re-mint. */
    const again = await req("POST", `/distribution/releases/${id}/presave`);
    expect(again.json.slug).toBe(minted.json.slug);
    /* Public lookup needs no auth scoping tricks — plain fetch. */
    const pub = await req("GET", `/distribution/presave/${minted.json.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.json.presave.title).toBe("Test Track");
    expect(pub.json.presave.artistName).toBe("Test Artist");
    expect(pub.json.presave).not.toHaveProperty("creditsCharged");
  });

  it("404s for an unknown slug", async () => {
    const { status } = await req("GET", "/distribution/presave/nope-not-real");
    expect(status).toBe(404);
  });
});

/* ─── v2: platform delivery polling ───────────────────────────────────────── */

describe("GET /api/distribution/releases/:id/platforms", () => {
  it("returns queued statuses right after submit", async () => {
    const { id } = await seedRelease(USER_A, { complete: true });
    await req("POST", `/distribution/releases/${id}/submit`);
    const { status, json } = await req("GET", `/distribution/releases/${id}/platforms`);
    expect(status).toBe(200);
    expect(json.aggregator).toBe("mock");
    expect(json.platformStatuses).toHaveLength(1);
    expect(json.platformStatuses[0]).toMatchObject({ platform: "spotify", status: "queued" });
  });

  it("404s for another user's release", async () => {
    const { id } = await seedRelease(USER_B);
    const { status } = await req("GET", `/distribution/releases/${id}/platforms`);
    expect(status).toBe(404);
  });
});

/* ─── mock aggregator lifecycle ───────────────────────────────────────────── */

describe("mock aggregator", () => {
  it("advances queued → pending → delivered → live on its clock", async () => {
    const { MockAggregatorAdapter } = await import("../../lib/distribution-aggregator");
    const agg = new MockAggregatorAdapter();
    expect(agg.live).toBe(false);
    const sub = await agg.submitRelease({
      clientReleaseId: randomUUID(),
      title: "T",
      artistName: "A",
      releaseType: "single",
      releaseDate: "2026-12-01",
      explicit: false,
      tracks: [{ title: "T", audioUrl: "https://example.com/a.mp3", explicit: false }],
      artworkUrl: "https://example.com/art.jpg",
      platforms: ["spotify"],
    });
    let statuses = await agg.fetchPlatformStatuses(sub.aggregatorReleaseId);
    expect(statuses[0]?.status).toBe("queued");
    /* Fast-forward the in-memory clock past every step. */
    const job = (agg as unknown as { jobs: Map<string, { submittedAt: number }> }).jobs.get(
      sub.aggregatorReleaseId,
    );
    expect(job).toBeDefined();
    job!.submittedAt = Date.now() - 300_000;
    statuses = await agg.fetchPlatformStatuses(sub.aggregatorReleaseId);
    expect(statuses[0]?.status).toBe("live");
  });
});
