/**
 * Website Builder — build-from-the-creator (stack5/w3-builder-creator).
 *
 * POST /api/website-builder/generate + /edit over HTTP against pg-mem,
 * with the OpenAI client stubbed to CAPTURE the exact prompts it would
 * send. Pins the competitor-gap fix:
 *  - the generation context carries the creator's REAL material (brand
 *    kit colors/fonts/logo/tagline, catalog titles, product names with
 *    real prices, real upcoming shows, profile facts)
 *  - the system prompt FORBIDS inventing facts (the old prompt literally
 *    instructed the model to "invent plausible" show dates/song titles)
 *  - missing material is named as NOT PROVIDED and steered to honest,
 *    visibly-labeled placeholders
 *  - another member's material NEVER leaks into a build
 *  - charge discipline is untouched (3,000 VB build / 200 VB edit)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({
  db: null as any,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  lastCompletionArgs: null as any,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: vi.fn(async (userId: string, amount: number) => {
    testState.chargeCalls.push({ userId, amount });
    return 0;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number) => {
    testState.refundCalls.push({ userId, amount });
  }),
}));

const FIXTURE_SITE = JSON.stringify({
  "index.html": "<!doctype html><html><head></head><body>Nova</body></html>",
  "about.html": "<!doctype html><html><body>About</body></html>",
  "styles.css": "body { background: #000; }",
  "script.js": "",
  "README.md": "# Site\n\n## Placeholders to replace\n- none",
});

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-test",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async (args: any) => {
          testState.lastCompletionArgs = args;
          return { choices: [{ message: { content: FIXTURE_SITE } }] };
        }),
      },
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_q: any, _s: any, n: any) => n(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

import websiteBuilderRouter from "../generate/website-builder";
import { createTestDb } from "../../lib/__tests__/test-db";
import { buildSeedContext, emptyCreatorSeed, seedSummary } from "../../lib/website-builder-seed";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, display_name text NOT NULL,
  bio text NOT NULL DEFAULT '', vertical text NOT NULL DEFAULT 'music',
  avatar_url text, banner_url text,
  social_links jsonb NOT NULL DEFAULT '{}', theme_config jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE songs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL,
  genre text, cover_art_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE generated_clips (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text,
  thumbnail_url text, video_url text, status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_products (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, kind text NOT NULL,
  title text NOT NULL, description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tour_dates (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, city text NOT NULL,
  venue text NOT NULL, show_date timestamptz NOT NULL, notes text,
  status text NOT NULL DEFAULT 'upcoming', created_at timestamptz NOT NULL DEFAULT now()
);
`;

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const OWNER_EMPTY = randomUUID();
const PROFILE_A = randomUUID();

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  app.use("/api/website-builder", websiteBuilderRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/website-builder`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  testState.db = db;
  testState.chargeCalls = [];
  testState.refundCalls = [];
  testState.lastCompletionArgs = null;
});

async function seedOwnerA() {
  const db = testState.db;
  const brandKit = {
    brandName: "Nova Reign",
    vibe: "royal, cinematic",
    industry: "music",
    colors: [
      { hex: "#D4AF37", name: "Royal Gold", role: "primary" },
      { hex: "#0B0B0F", name: "Midnight", role: "background" },
    ],
    fonts: [{ heading: "Cinzel", body: "Inter", usage: "headings/body" }],
    logoPrompt: "a crown",
    taglines: ["Crowned in gold."],
    selectedTagline: "Crowned in gold.",
    logoUrl: "https://cdn.example.com/nova/logo.png",
    bioLines: ["Atlanta-born. Crown-wearing."],
    pressFacts: ["Sold out The Loft in 2025"],
    generatedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, display_name, bio, vertical, avatar_url, social_links, theme_config)
    VALUES (${PROFILE_A}, ${OWNER_A}, 'Nova Reign', 'Hip-hop artist from Atlanta.', 'music',
      'https://cdn.example.com/nova/avatar.jpg',
      ${JSON.stringify({ youtube: "https://youtube.com/@novareign", instagram: "https://instagram.com/novareign" })}::jsonb,
      ${JSON.stringify({ brandKit })}::jsonb)
  `);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, genre, cover_art_url) VALUES (${randomUUID()}, ${OWNER_A}, 'Midnight Crown', 'Hip-Hop', 'https://cdn.example.com/nova/crown.jpg')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title) VALUES (${randomUUID()}, ${OWNER_A}, 'Second Verse')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title) VALUES (${randomUUID()}, ${OWNER_B}, 'Stranger Song')`);
  await db.execute(sql`INSERT INTO generated_clips (id, user_id, title, status, thumbnail_url, video_url) VALUES (${randomUUID()}, ${OWNER_A}, 'Crown (Official Video)', 'completed', 'https://cdn.example.com/nova/thumb.jpg', 'https://cdn.example.com/nova/clip.mp4')`);
  await db.execute(sql`INSERT INTO generated_clips (id, user_id, title, status) VALUES (${randomUUID()}, ${OWNER_A}, 'Unfinished Draft', 'processing')`);
  await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents, is_active) VALUES (${randomUUID()}, ${PROFILE_A}, 'download', 'Crown Beat Pack', 4900, true)`);
  await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents, is_active) VALUES (${randomUUID()}, ${PROFILE_A}, 'merch', 'Retired Merch', 2500, false)`);
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  await db.execute(sql`INSERT INTO tour_dates (id, user_id, city, venue, show_date, status) VALUES (${randomUUID()}, ${OWNER_A}, 'Atlanta, GA', 'The Loft', ${future}::timestamptz, 'confirmed')`);
  await db.execute(sql`INSERT INTO tour_dates (id, user_id, city, venue, show_date, status) VALUES (${randomUUID()}, ${OWNER_A}, 'Ghost City', 'Old Barn', ${past}::timestamptz, 'upcoming')`);
}

async function post(user: string, path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

const GENERATE_BODY = {
  template: "artist-site",
  businessName: "Nova Reign",
  description: "Homepage for my music — latest single up front, videos, store, and my upcoming shows.",
};

function promptParts() {
  const args = testState.lastCompletionArgs;
  expect(args).toBeTruthy();
  const system = args.messages.find((m: any) => m.role === "system")?.content as string;
  const user = args.messages.find((m: any) => m.role === "user")?.content as string;
  return { system, user };
}

describe("POST /generate — seeded from the creator's real material", () => {
  it("carries brand kit, catalog, products, and real shows into the prompt — and only the caller's", async () => {
    await seedOwnerA();
    const r = await post(OWNER_A, "/generate", GENERATE_BODY);
    expect(r.status).toBe(200);
    expect(testState.chargeCalls).toEqual([{ userId: OWNER_A, amount: 3000 }]);
    expect(r.json.seededFrom).toEqual({
      profile: true,
      brandKit: true,
      songs: 2,
      videos: 1,
      products: 1,
      shows: 1,
    });

    const { system, user } = promptParts();
    /* Anti-fabrication law is in force; the old invent-it instruction is gone. */
    expect(system).toContain("NEVER INVENT FACTS");
    expect(system).toContain("Placeholders to replace");
    expect(system).not.toContain("invent plausible");

    /* Real material is in the generation context. */
    expect(user).toContain("Midnight Crown");
    expect(user).toContain("Second Verse");
    expect(user).toContain("#D4AF37");
    expect(user).toContain("Cinzel");
    expect(user).toContain("https://cdn.example.com/nova/logo.png");
    expect(user).toContain("Crowned in gold.");
    expect(user).toContain("Crown Beat Pack");
    expect(user).toContain("$49.00");
    expect(user).toContain("Atlanta, GA");
    expect(user).toContain("The Loft");
    expect(user).toContain("youtube.com/@novareign");

    /* Nothing that is not the caller's real, current material. */
    expect(user).not.toContain("Stranger Song");
    expect(user).not.toContain("Unfinished Draft");
    expect(user).not.toContain("Retired Merch");
    expect(user).not.toContain("Ghost City");
  });

  it("an empty-catalog creator gets the honest-placeholder path, named section by section", async () => {
    await seedOwnerA();
    const r = await post(OWNER_EMPTY, "/generate", {
      ...GENERATE_BODY,
      businessName: "Brand New",
    });
    expect(r.status).toBe(200);
    expect(r.json.seededFrom).toEqual({
      profile: false,
      brandKit: false,
      songs: 0,
      videos: 0,
      products: 0,
      shows: 0,
    });
    const { system, user } = promptParts();
    expect(system).toContain("NEVER INVENT FACTS");
    expect(user).toContain("NOT PROVIDED");
    expect(user).toContain("NEVER a made-up date");
    expect(user).toContain("[Placeholder");
    expect(user).not.toContain("Midnight Crown");
  });

  it("member B's build contains B's material and none of A's", async () => {
    await seedOwnerA();
    const r = await post(OWNER_B, "/generate", {
      ...GENERATE_BODY,
      businessName: "Someone Else",
    });
    expect(r.status).toBe(200);
    const { user } = promptParts();
    expect(user).toContain("Stranger Song");
    expect(user).not.toContain("Midnight Crown");
    expect(user).not.toContain("Crown Beat Pack");
    expect(user).not.toContain("Crowned in gold.");
  });
});

describe("POST /edit — fact rules hold for conversational edits", () => {
  it("edit prompt forbids introducing new facts and charges the unchanged 200 VB", async () => {
    await seedOwnerA();
    const r = await post(OWNER_A, "/edit", {
      template: "artist-site",
      businessName: "Nova Reign",
      currentFiles: { "index.html": "<html></html>", "styles.css": "body{}" },
      editRequest: "Make the hero darker",
    });
    expect(r.status).toBe(200);
    expect(testState.chargeCalls).toEqual([{ userId: OWNER_A, amount: 200 }]);
    const { system, user } = promptParts();
    expect(system).toContain("NEVER INVENT FACTS");
    expect(user).toContain("Do not introduce any new facts");
  });
});

describe("seed context rendering (pure)", () => {
  it("empty seed renders the full NOT PROVIDED list with labeled-placeholder steering", () => {
    const ctx = buildSeedContext(emptyCreatorSeed());
    expect(ctx).toContain("CREATOR'S REAL MATERIAL");
    expect(ctx).toContain("NOT PROVIDED");
    expect(ctx).toContain("labeled placeholder");
    expect(seedSummary(emptyCreatorSeed())).toEqual({
      profile: false,
      brandKit: false,
      songs: 0,
      videos: 0,
      products: 0,
      shows: 0,
    });
  });
});
