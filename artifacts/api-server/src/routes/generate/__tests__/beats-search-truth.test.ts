/**
 * Beats browse search truth (Stack1100 lane Y5) — GET /api/beats?search=.
 *
 * THE DISEASE: browse search matched the whole query as one ILIKE
 * phrase against title/description only. "dark trap" found nothing
 * (the words live in different fields), genre/key/mood words typed
 * into the search box were invisible to it, and producer names could
 * not be searched at all.
 *
 * THE FIX (lib/search-match): token-AND over title, description,
 * genre, musical key and mood tags, PLUS the producer's display name
 * resolved per token — every token must hit the beat's text or its
 * producer. Harness mirrors beats-plain-offers (fake db over table
 * stores); here the fake RECORDS every where() condition flattened
 * (PgDialect) and evaluates the producer condition with the real
 * fold, so the wiring — not a re-implementation — is what's pinned.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import { foldSearchText } from "../../../lib/search-match";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  userId: "",
  stores: new Map<string, Array<Record<string, any>>>(),
  conds: [] as Array<{ table: string; text: string; params: unknown[] }>,
}));

function storeFor(table: unknown): Array<Record<string, any>> {
  const name = getTableName(table as never);
  if (!h.stores.has(name)) h.stores.set(name, []);
  return h.stores.get(name)!;
}

/* The producer-resolution condition is a token-AND of %token% ILIKE
   params over display_name — evaluate exactly that against the store
   with the real fold. Any other table's where() is a pass-through
   (its condition is asserted by shape, below). */
function evaluate(table: unknown, cond: unknown): Array<Record<string, any>> {
  const rows = storeFor(table).map((r) => ({ ...r }));
  if (getTableName(table as never) !== "creator_profiles" || !cond) return rows;
  const { sql: text, params } = dialect.sqlToQuery(cond as never);
  void text;
  const tokens = (params as unknown[])
    .filter((p): p is string => typeof p === "string" && p.startsWith("%") && p.endsWith("%"))
    .map((p) => p.slice(1, -1).replace(/\\(.)/g, "$1"));
  if (tokens.length === 0) return rows;
  return rows.filter((r) => {
    const name = foldSearchText(String(r["display_name"] ?? ""));
    return tokens.every((t) => name.includes(t));
  });
}

function selectChain(table: unknown, fields?: Record<string, any>) {
  let cond: unknown;
  let lim = Number.POSITIVE_INFINITY;
  let off = 0;
  /* A fields-select projects rows the way drizzle does: result keys
     are the selection's keys, values read from the column's DB name. */
  const project = (rows: Array<Record<string, any>>) => {
    if (!fields) return rows;
    return rows.map((r) => {
      const out: Record<string, any> = {};
      for (const [key, col] of Object.entries(fields)) {
        out[key] = r[(col as { name: string }).name] ?? r[key];
      }
      return out;
    });
  };
  const chain: any = {
    where: (c: unknown) => {
      cond = c;
      if (c) {
        const { sql: text, params } = dialect.sqlToQuery(c as never);
        h.conds.push({ table: getTableName(table as never), text, params: params as unknown[] });
      }
      return chain;
    },
    orderBy: (..._a: unknown[]) => chain,
    limit: (n: number) => {
      lim = n;
      return chain;
    },
    offset: (n: number) => {
      off = n;
      return chain;
    },
    then: (resolve: (v: unknown) => void) =>
      resolve(project(evaluate(table, cond)).slice(off, off + lim)),
  };
  return chain;
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  generationLimiter: (_req: any, _res: any, next: any) => next(),
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-test"),
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (u: string) => u),
  isStorageRef: (u: string) => typeof u === "string" && (u.startsWith("r2://") || u.startsWith("supabase://")),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async () => ({ sessionId: "cs_test", url: "https://checkout.example.com/pay" })),
  retrieveCheckoutSession: vi.fn(async () => null),
  refundCheckoutSessionPayment: vi.fn(async () => true),
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb: any = {
    select: (fields?: Record<string, any>) => ({
      from: (table: unknown) => selectChain(table, fields),
    }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../beats";

const PRODUCER = randomUUID();
const PRODUCER_PROFILE_ID = randomUUID();

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedBeat(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: randomUUID(),
    user_id: PRODUCER,
    title: "Trap Nights",
    audio_url: "https://cdn.example.com/beat.mp3",
    audio_path: null,
    preview_url: "https://cdn.example.com/preview.mp3",
    genre: "trap",
    bpm: 140,
    musical_key: "C min",
    mood_tags: ["dark", "moody"],
    description: "Hard drums",
    basic_price_cents: 2999,
    premium_price_cents: 9999,
    exclusive_price_cents: 49999,
    exclusive_sold: false,
    plays: 10,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  h.stores.clear();
  h.conds.length = 0;
  h.stores.set("beats", [seedBeat()]);
  h.stores.set("creator_profiles", [
    { id: PRODUCER_PROFILE_ID, user_id: PRODUCER, display_name: "King Shark", slug: "king-shark" },
  ]);
  h.stores.set("beat_license_templates", []);
});

function beatsCond(): { text: string; params: unknown[] } {
  const c = h.conds.filter((x) => x.table === "beats");
  expect(c.length).toBeGreaterThan(0);
  return c[c.length - 1]!;
}

describe("GET /beats?search= — token-AND over the beat's own text", () => {
  it("builds per-token folded conditions across title/description/genre/key/moods — never one phrase", async () => {
    const res = await fetch(`${baseUrl}/beats?search=${encodeURIComponent("dark trap")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { beats: unknown[] };
    expect(body.beats).toHaveLength(1);
    const cond = beatsCond();
    expect(cond.text).toContain("translate(lower(");
    expect(cond.text).toContain("array_to_string");
    expect(cond.text).toMatch(/\) and \(/); // drizzle renders the token join lowercase
    expect(cond.params).toContain("%dark%");
    expect(cond.params).toContain("%trap%");
    expect(cond.params).not.toContain("%dark trap%");
    // five text fields per token → each token pattern appears 5 times
    expect(cond.params.filter((p) => p === "%dark%")).toHaveLength(5);
    expect(cond.params.filter((p) => p === "%trap%")).toHaveLength(5);
  });

  it("folds the query (accented producer / title words pattern folded)", async () => {
    const res = await fetch(`${baseUrl}/beats?search=${encodeURIComponent("beyoncé")}`);
    expect(res.status).toBe(200);
    expect(beatsCond().params).toContain("%beyonce%");
  });
});

describe("GET /beats?search= — producer names are searchable, per token", () => {
  it("resolves the producer per token and ORs their id into that token's group", async () => {
    const res = await fetch(`${baseUrl}/beats?search=${encodeURIComponent("dark shark")}`);
    expect(res.status).toBe(200);
    // a creator_profiles read happened per token, carrying the token patterns
    const profConds = h.conds.filter((x) => x.table === "creator_profiles");
    expect(profConds.length).toBe(2);
    expect(profConds[0]!.params).toContain("%dark%");
    expect(profConds[1]!.params).toContain("%shark%");
    // "shark" matched the producer → their user id rides the beats condition;
    // "dark" did not match any producer name → no id for that token.
    const cond = beatsCond();
    expect(cond.params).toContain(PRODUCER);
    expect(cond.text).toMatch(/in \(\$|IN \(/);
  });

  it("no producer match → no id smuggled into the condition", async () => {
    const res = await fetch(`${baseUrl}/beats?search=${encodeURIComponent("dark zzz")}`);
    expect(res.status).toBe(200);
    expect(beatsCond().params).not.toContain(PRODUCER);
  });
});

describe("GET /beats — no search, no search machinery", () => {
  it("runs no producer resolution and no text condition without ?search", async () => {
    const res = await fetch(`${baseUrl}/beats`);
    expect(res.status).toBe(200);
    expect(h.conds.filter((x) => x.table === "creator_profiles")).toHaveLength(0);
    const beatsConds = h.conds.filter((x) => x.table === "beats");
    expect(beatsConds).toHaveLength(0); // no where() call at all
  });
});
