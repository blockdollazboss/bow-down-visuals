/**
 * Route tests for the challenge-card DTO contract (routes/shorts).
 *
 * THE REGRESSION: GET /challenges/trending spread the raw Drizzle rows
 * ({ ...r, effective_status }) and GET /hashtag/:tag passed its challenge
 * rows through untouched — so both wire payloads carried camelCase table
 * keys (entryCount, prizeText, prizePoolCredits, coverUrl) while every
 * client (pages/shorts.tsx ShortsMenu, pages/challenge.tsx "More
 * challenges", pages/hashtag.tsx challenge cards) reads snake_case
 * (entry_count, prize_text, prize_pool_credits, cover_url). Nothing
 * errored: the cards just printed "undefined entries" and the prize line
 * never rendered. toChallengeDto now builds the payload field-by-field;
 * these tests pin the snake_case keys AND the absence of camelCase leaks
 * on both endpoints.
 *
 * Fake-db style mirrors routes/__tests__/creator-profile-public.test.ts:
 * real table objects via importOriginal, a chainable select whose rows
 * dispatch on table identity.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const CH_ID = "33333333-3333-4333-8333-333333333333";
const CH2_ID = "44444444-4444-4444-8444-444444444444";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const CREATED = new Date("2026-10-14T15:04:05.000Z");

const h = vi.hoisted(() => ({
  state: {
    challengeRows: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
}));

vi.mock("../admin", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (u: string | null) => u ?? null,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (x: unknown) => x,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { challengesTable } = actual;

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        const rows = () => (table === challengesTable ? h.state.challengeRows : []);
        const chain: any = {
          where: (_cond: unknown) => chain,
          orderBy: (..._args: unknown[]) => chain,
          limit: async (_n: number) => rows(),
          then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
        };
        return chain;
      },
    }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../shorts";

let server: any;
let baseUrl: string;

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

/** A challenges-table row exactly as Drizzle returns it (camelCase). */
function challengeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CH_ID,
    slug: "friday-faceoff",
    title: "Friday Faceoff",
    description: "Best 15-second hook wins.",
    hashtag: "fridayfaceoff",
    coverUrl: "https://cdn.example.com/covers/friday.jpg",
    prizeText: "1,000 Visual Bucs",
    entryCount: 42,
    totalViews: 9001,
    createdAt: CREATED,
    creatorProfileId: PROFILE_ID,
    status: "live",
    startsAt: new Date("2026-10-13T00:00:00.000Z"),
    endsAt: new Date("2027-01-01T00:00:00.000Z"),
    judgingEndsAt: new Date("2027-01-03T00:00:00.000Z"),
    prizePoolCredits: 1000,
    ...overrides,
  };
}

const CAMEL_KEYS = [
  "entryCount", "prizeText", "prizePoolCredits", "coverUrl", "totalViews",
  "createdAt", "creatorProfileId", "startsAt", "endsAt", "judgingEndsAt",
];

function expectChallengeDto(c: any) {
  expect(c.id).toBe(CH_ID);
  expect(c.slug).toBe("friday-faceoff");
  expect(c.title).toBe("Friday Faceoff");
  expect(c.description).toBe("Best 15-second hook wins.");
  expect(c.hashtag).toBe("fridayfaceoff");
  expect(c.cover_url).toBe("https://cdn.example.com/covers/friday.jpg");
  expect(c.prize_text).toBe("1,000 Visual Bucs");
  expect(c.entry_count).toBe(42);
  expect(typeof c.entry_count).toBe("number");
  expect(c.total_views).toBe(9001);
  expect(c.prize_pool_credits).toBe(1000);
  expect(c.created_at).toBe(CREATED.toISOString());
  expect(c.starts_at).toBe("2026-10-13T00:00:00.000Z");
  expect(c.ends_at).toBe("2027-01-01T00:00:00.000Z");
  expect(c.judging_ends_at).toBe("2027-01-03T00:00:00.000Z");
  expect(c.creator_profile_id).toBe(PROFILE_ID);
  expect(c.status).toBe("live");
  expect(c.effective_status).toBe("live");
  for (const k of CAMEL_KEYS) {
    expect(c, `camelCase key ${k} must not leak`).not.toHaveProperty(k);
  }
}

beforeEach(() => {
  h.state.challengeRows = [
    challengeRow(),
    challengeRow({
      id: CH2_ID,
      slug: "next-week-remix",
      title: "Next Week Remix",
      hashtag: "nextweekremix",
      status: "upcoming",
      startsAt: new Date("2027-02-01T00:00:00.000Z"),
      endsAt: new Date("2027-02-08T00:00:00.000Z"),
      judgingEndsAt: new Date("2027-02-10T00:00:00.000Z"),
    }),
  ];
});

describe("GET /challenges/trending — challenge DTO", () => {
  it("emits snake_case fields the cards read, with no camelCase leaks", async () => {
    const res = await fetch(`${baseUrl}/challenges/trending?limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.challenges)).toBe(true);
    expect(body.challenges).toHaveLength(2);
    expectChallengeDto(body.challenges[0]);
  });

  it("keeps effective_status derived per challenge (live vs upcoming)", async () => {
    const res = await fetch(`${baseUrl}/challenges/trending`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.challenges[0].effective_status).toBe("live");
    expect(body.challenges[1].effective_status).toBe("upcoming");
    expect(body.challenges[1].status).toBe("upcoming");
  });
});

describe("GET /hashtag/:tag — challenge DTO", () => {
  it("emits the same snake_case challenge DTO in the hashtag hub", async () => {
    const res = await fetch(`${baseUrl}/hashtag/fridayfaceoff`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tag).toBe("fridayfaceoff");
    expect(Array.isArray(body.shorts)).toBe(true);
    expect(Array.isArray(body.videos)).toBe(true);
    expect(Array.isArray(body.tracks)).toBe(true);
    expect(body.challenges).toHaveLength(2);
    expectChallengeDto(body.challenges[0]);
    expect(body.challenges[1].effective_status).toBe("upcoming");
  });
});
