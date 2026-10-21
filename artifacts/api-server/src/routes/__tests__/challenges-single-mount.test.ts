/**
 * Single-mount pin for the challenge engine (Wave 3 #12).
 *
 * THE HISTORY: routes/challenge-engine.ts was mounted TWICE — once by
 * the coordinator in routes/index.ts and once nested inside
 * routes/shorts.ts (router.use(challengeEngineRouter) at the bottom of
 * shorts). Every /challenges/* path therefore had two identical
 * resolution paths, and the shorts.ts header comment claimed challenge
 * routes that file never defined. Wave 3 #12 removed the nested mount:
 * the engine is mounted exactly once, in routes/index.ts, and shorts
 * imports only the engine's shared helpers (DTO / status / slug).
 *
 * THE PIN: two apps are built —
 *   (A) production wiring, mirrored from routes/index.ts: the engine
 *       mounted before shorts. /challenges/trending must resolve (200,
 *       snake_case DTO) and shorts' own /hashtag/:tag must still work
 *       in the same app.
 *   (B) shorts ALONE. /challenges/trending and POST /challenges must
 *       now be 404 — shorts carries no challenge routes of its own —
 *       while /hashtag/:tag still resolves. If anyone re-adds the
 *       nested mount (or challenge routes) to shorts, these fail.
 * A source-shape pin counts the mounts so the wiring can't silently
 * grow a second one again.
 *
 * Fake-db style mirrors routes/__tests__/challenges-dto.test.ts: real
 * table objects via importOriginal, a chainable select whose rows
 * dispatch on table identity.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";

const CH_ID = "33333333-3333-4333-8333-333333333333";
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

import shortsRouter from "../shorts";
import challengeEngineRouter from "../challenge-engine";

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

let prodServer: any;
let prodBase: string;
let shortsServer: any;
let shortsBase: string;

async function listen(app: express.Express): Promise<{ server: any; base: string }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` };
}

beforeAll(async () => {
  h.state.challengeRows = [challengeRow()];

  /* (A) production wiring, mirroring routes/index.ts mount order. */
  const prodApp = express();
  prodApp.use(express.json());
  prodApp.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  prodApp.use("/api", challengeEngineRouter);
  prodApp.use("/api", shortsRouter);
  ({ server: prodServer, base: prodBase } = await listen(prodApp));

  /* (B) shorts alone — no engine anywhere in the tree. */
  const shortsApp = express();
  shortsApp.use(express.json());
  shortsApp.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  shortsApp.use("/api", shortsRouter);
  ({ server: shortsServer, base: shortsBase } = await listen(shortsApp));
});

afterAll(async () => {
  await new Promise<void>((resolve) => prodServer.close(() => resolve()));
  await new Promise<void>((resolve) => shortsServer.close(() => resolve()));
});

describe("production wiring (engine mounted once, before shorts)", () => {
  it("serves GET /challenges/trending through the canonical engine mount", async () => {
    const res = await fetch(`${prodBase}/challenges/trending?limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.challenges)).toBe(true);
    expect(body.challenges).toHaveLength(1);
    expect(body.challenges[0].entry_count).toBe(42);
    expect(body.challenges[0].prize_text).toBe("1,000 Visual Bucs");
    expect(body.challenges[0]).not.toHaveProperty("entryCount");
  });

  it("still serves shorts' own /hashtag/:tag in the same app", async () => {
    const res = await fetch(`${prodBase}/hashtag/fridayfaceoff`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tag).toBe("fridayfaceoff");
    expect(body.challenges).toHaveLength(1);
    expect(body.challenges[0].entry_count).toBe(42);
  });
});

describe("shorts alone carries NO challenge routes (the duplicate mount is gone)", () => {
  it("404s GET /challenges/trending", async () => {
    const res = await fetch(`${shortsBase}/challenges/trending`);
    expect(res.status).toBe(404);
  });

  it("404s POST /challenges", async () => {
    const res = await fetch(`${shortsBase}/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("404s GET /challenges/:slug", async () => {
    const res = await fetch(`${shortsBase}/challenges/friday-faceoff`);
    expect(res.status).toBe(404);
  });

  it("still serves its own /hashtag/:tag", async () => {
    const res = await fetch(`${shortsBase}/hashtag/fridayfaceoff`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tag).toBe("fridayfaceoff");
  });
});

describe("source-shape pin — exactly one mount exists", () => {
  const indexSrc = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const shortsSrc = readFileSync(new URL("../shorts.ts", import.meta.url), "utf8");

  it("routes/index.ts mounts challengeEngineRouter exactly once", () => {
    expect(indexSrc.match(/router\.use\(challengeEngineRouter\)/g) ?? []).toHaveLength(1);
  });

  it("routes/shorts.ts never mounts the engine and never default-imports it", () => {
    expect(shortsSrc).not.toContain("router.use(challengeEngineRouter)");
    expect(shortsSrc).not.toContain("import challengeEngineRouter");
  });
});
