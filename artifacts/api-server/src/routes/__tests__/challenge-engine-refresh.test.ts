/**
 * Route tests for challenge-engine storage-ref refresh.
 *
 * THE DEFECT: three public payloads in routes/challenge-engine.ts hand
 * clients RAW storage refs (r2://… / supabase://…) in URL fields —
 * unplayable / unrenderable — because the file never imports the
 * storage refresh helper that sibling read endpoints wrap their
 * payloads with (precedent: routes/social /saves/mine, commit 7306cfa8):
 *   GET /challenges/:slug/winners — challenge.cover_url,
 *     winners[].video.video_url, winners[].video.thumbnail_url,
 *     winners[].creator.avatar_url
 *   GET /challenges/hall-of-fame — winners[].video.thumbnail_url,
 *     winners[].creator.avatar_url
 *   GET /challenges/weekly — challenge.cover_url,
 *     challenge.winners[] + last_week.winners[] video.thumbnail_url
 *     + creator.avatar_url
 *
 * The objectStorage mock below SIMULATES the real helper's contract
 * (a ref string becomes a fresh signed https URL; everything else,
 * including Dates and already-https URLs, passes through untouched)
 * rather than mocking it as identity — an identity mock could never
 * catch a missing refresh call.
 *
 * Fake-db style mirrors routes/__tests__/challenges-dto.test.ts and
 * saves-mine-refresh.test.ts: real table objects via importOriginal,
 * a chainable select whose rows dispatch on table identity, and
 * db.execute dispatched on the raw SQL text the handler emitted.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const CH_ID = "33333333-3333-4333-8333-333333333333";
const WEEK_ID = "44444444-4444-4444-8444-444444444444";
const LAST_WEEK_ID = "55555555-5555-4555-8555-555555555555";
const VIDEO_ID = "66666666-6666-4666-8666-666666666666";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  state: {
    challenges: [] as Array<Record<string, unknown>>,
    prizes: [] as Array<Record<string, unknown>>,
    winnerRows: [] as Array<Record<string, unknown>>,
    hallRows: [] as Array<Record<string, unknown>>,
    lastWeekRows: [] as Array<Record<string, unknown>>,
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

/* Simulated refresh: refs (r2:// / supabase://) become signed https
   URLs; plain objects/arrays are walked; Dates and other values pass
   through untouched — mirroring refreshSupabaseStorageUrlsDeep. */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}
async function deepRefresh(v: unknown): Promise<unknown> {
  if (typeof v === "string") {
    return v.startsWith("r2://") || v.startsWith("supabase://") ? signedFor(v) : v;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => deepRefresh(x)));
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const entries = await Promise.all(
        Object.entries(v as Record<string, unknown>).map(
          async ([k, val]) => [k, await deepRefresh(val)] as const,
        ),
      );
      return Object.fromEntries(entries);
    }
  }
  return v;
}

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? signedFor(v)
      : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { challengesTable, challengePrizesTable } = actual;

  function rowsFor(table: unknown): Array<Record<string, unknown>> {
    if (table === challengesTable) return state.challenges;
    if (table === challengePrizesTable) return state.prizes;
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    execute: async (q: unknown) => {
      const { sql: text } = dialect.sqlToQuery(q as never);
      // Last-week lookup: raw SQL over challenges (is_weekly / week_key).
      if (text.includes("is_weekly")) return { rows: state.lastWeekRows };
      // Hall of fame carries the joined challenge_* columns.
      if (text.includes("challenge_title")) return { rows: state.hallRows };
      // Every other raw query here is a challenge_winners read
      // (winners page + getWeeklyWinners for this/last week).
      if (text.includes("challenge_winners")) return { rows: state.winnerRows };
      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../challenge-engine";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null — assertions on status/body will surface it */
  }
  return { status: r.status, text, json };
}

function expectNoRawRefs(text: string) {
  expect(text).not.toContain("r2://");
  expect(text).not.toContain("supabase://");
}

/** A challenges-table row exactly as Drizzle returns it (camelCase). */
function challengeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CH_ID,
    slug: "friday-faceoff",
    title: "Friday Faceoff",
    description: "Best 15-second hook wins.",
    hashtag: "fridayfaceoff",
    coverUrl: "r2://media/covers/friday.jpg",
    status: "winners",
    startsAt: new Date("2026-10-13T00:00:00.000Z"),
    endsAt: new Date("2026-10-14T00:00:00.000Z"),
    judgingEndsAt: new Date("2026-10-16T00:00:00.000Z"),
    entryCount: 42,
    prizePoolCredits: 1000,
    isWeekly: false,
    weekKey: null,
    ...overrides,
  };
}

/** A raw-SQL winner row exactly as node-postgres returns it. */
function winnerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    place: 1,
    prize_credits: 500,
    paid_at: "2026-10-14T16:00:00.000Z",
    announced_at: "2026-10-14T16:00:00.000Z",
    video_id: VIDEO_ID,
    video_title: "Winning Entry",
    video_url: "r2://media/videos/winning.mp4",
    thumbnail_url: "supabase://media/thumbs/winning.jpg",
    creator_slug: "winning-creator",
    creator_name: "Winning Creator",
    creator_avatar: "r2://media/avatars/winner.png",
    ...overrides,
  };
}

beforeEach(() => {
  h.state.challenges = [challengeRow()];
  h.state.prizes = [];
  h.state.winnerRows = [winnerRow()];
  h.state.hallRows = [];
  h.state.lastWeekRows = [];
});

describe("GET /challenges/:slug/winners — storage refs refreshed at the response boundary", () => {
  it("refreshes challenge.cover_url, video.video_url, video.thumbnail_url and creator.avatar_url", async () => {
    const { status, text, json } = await get("/challenges/friday-faceoff/winners");

    expect(status).toBe(200);
    expectNoRawRefs(text);

    expect(json.challenge.slug).toBe("friday-faceoff");
    expect(json.challenge.cover_url).toBe(
      "https://signed.example.com/media/covers/friday.jpg?sig=test",
    );

    expect(json.announced).toBe(true);
    expect(json.winners).toHaveLength(1);
    const w = json.winners[0];
    expect(w.place).toBe(1);
    expect(w.prize_credits).toBe(500);
    expect(w.video.id).toBe(VIDEO_ID);
    expect(w.video.video_url).toBe(
      "https://signed.example.com/media/videos/winning.mp4?sig=test",
    );
    expect(w.video.thumbnail_url).toBe(
      "https://signed.example.com/media/thumbs/winning.jpg?sig=test",
    );
    expect(w.creator.slug).toBe("winning-creator");
    expect(w.creator.avatar_url).toBe(
      "https://signed.example.com/media/avatars/winner.png?sig=test",
    );
  });
});

describe("GET /challenges/hall-of-fame — storage refs refreshed at the response boundary", () => {
  it("refreshes winners[].video.thumbnail_url and winners[].creator.avatar_url", async () => {
    h.state.hallRows = [
      winnerRow({
        challenge_slug: "friday-faceoff",
        challenge_title: "Friday Faceoff",
        challenge_hashtag: "fridayfaceoff",
        thumbnail_url: "r2://media/thumbs/hall.jpg",
        creator_avatar: "supabase://media/avatars/hall.png",
      }),
    ];

    const { status, text, json } = await get("/challenges/hall-of-fame");

    expect(status).toBe(200);
    expectNoRawRefs(text);

    expect(json.winners).toHaveLength(1);
    const w = json.winners[0];
    expect(w.place).toBe(1);
    expect(w.challenge.slug).toBe("friday-faceoff");
    expect(w.video.id).toBe(VIDEO_ID);
    expect(w.video.thumbnail_url).toBe(
      "https://signed.example.com/media/thumbs/hall.jpg?sig=test",
    );
    expect(w.creator.slug).toBe("winning-creator");
    expect(w.creator.avatar_url).toBe(
      "https://signed.example.com/media/avatars/hall.png?sig=test",
    );
  });
});

describe("GET /challenges/weekly — storage refs refreshed at the response boundary", () => {
  it("refreshes challenge.cover_url and the thumbnail/avatar of challenge.winners and last_week.winners", async () => {
    h.state.challenges = [
      challengeRow({
        id: WEEK_ID,
        slug: "weekly-contest-2026-w42",
        title: "Golden Hour Glow — Weekly Creator Contest",
        hashtag: "goldenhourglow",
        coverUrl: "supabase://media/covers/weekly.jpg",
        isWeekly: true,
        weekKey: "2026-W42",
      }),
    ];
    h.state.prizes = [
      { place: 1, prizeCredits: 500, description: "Weekly Creator Contest — Champion" },
    ];
    h.state.winnerRows = [
      winnerRow({
        thumbnail_url: "r2://media/thumbs/weekly-win.jpg",
        creator_avatar: "supabase://media/avatars/weekly-win.png",
      }),
    ];
    h.state.lastWeekRows = [
      {
        id: LAST_WEEK_ID,
        slug: "weekly-contest-2026-w41",
        title: "One Light, One Take — Weekly Creator Contest",
        hashtag: "onelightonetak",
        week_key: "2026-W41",
      },
    ];

    const { status, text, json } = await get("/challenges/weekly");

    expect(status).toBe(200);
    expectNoRawRefs(text);

    expect(json.challenge.slug).toBe("weekly-contest-2026-w42");
    expect(json.challenge.cover_url).toBe(
      "https://signed.example.com/media/covers/weekly.jpg?sig=test",
    );
    expect(json.challenge.winners).toHaveLength(1);
    expect(json.challenge.winners[0].video.thumbnail_url).toBe(
      "https://signed.example.com/media/thumbs/weekly-win.jpg?sig=test",
    );
    expect(json.challenge.winners[0].creator.avatar_url).toBe(
      "https://signed.example.com/media/avatars/weekly-win.png?sig=test",
    );

    expect(json.last_week.challenge_slug).toBe("weekly-contest-2026-w41");
    expect(json.last_week.winners).toHaveLength(1);
    expect(json.last_week.winners[0].video.thumbnail_url).toBe(
      "https://signed.example.com/media/thumbs/weekly-win.jpg?sig=test",
    );
    expect(json.last_week.winners[0].creator.avatar_url).toBe(
      "https://signed.example.com/media/avatars/weekly-win.png?sig=test",
    );
  });
});
