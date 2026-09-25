/**
 * Tests for the Music Distribution hub (/api/distribution/*).
 *
 * Covers:
 * - pricing constants (AI 1 credit, packaging 10 credits, env-overridable)
 * - platform list integrity (8 platforms, every key has a label)
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
  metadataSchema,
  strategySchema,
  createReleaseSchema,
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
  updated_at timestamptz NOT NULL DEFAULT now()
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
  testState.db = db;
  testState.userId = USER_A;
  testState.userCredits = 100;
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

async function seedRelease(userId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO distribution_releases (id, user_id, title, artist_name, status, platforms)
    VALUES (${id}, ${userId}, ${"Test Track"}, ${"Test Artist"}, ${(overrides["status"] as string) ?? "draft"}, ${JSON.stringify(["spotify"])})
  `);
  return { id };
}

/* ─── pricing & platform constants ───────────────────────────────────────── */

describe("pricing constants", () => {
  it("charges 1 credit per AI generation", () => {
    expect(AI_CREDIT_COST).toBe(1);
  });
  it("charges 10 credits per release packaging", () => {
    expect(DISTRIBUTION_RELEASE_CREDITS).toBe(10);
  });
});

describe("platform list", () => {
  it("covers 8 platforms with a label for each", () => {
    expect(DISTRIBUTION_PLATFORMS).toHaveLength(8);
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
  it("402s when the user can't afford the packaging fee", async () => {
    testState.userCredits = 5;
    const { id } = await seedRelease(USER_A);
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

  it("charges the fee, marks the release packaged, and stays honest about delivery", async () => {
    const { id } = await seedRelease(USER_A);
    const { status, json } = await req("POST", `/distribution/releases/${id}/submit`);
    expect(status).toBe(200);
    expect(chargeCredits).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chargeCredits).mock.calls[0]?.[1]).toBe(DISTRIBUTION_RELEASE_CREDITS);
    expect(json.release.status).toBe("packaged");
    expect(json.release.creditsCharged).toBe(DISTRIBUTION_RELEASE_CREDITS);
    expect(json.creditsUsed).toBe(DISTRIBUTION_RELEASE_CREDITS);
    /* Honesty: the notice must not claim platform delivery happened. */
    expect(json.notice).toMatch(/coming soon/i);
    expect(json.notice).not.toMatch(/has been delivered|is now live on/i);
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
