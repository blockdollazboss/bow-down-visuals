/**
 * Pack-lock reference assembly — route-level tests
 * (POST /api/pre-production/pack/:id/finalize).
 *
 * Pins:
 *  - Finalize assembles each shot's REFERENCE SET from the caller's OWN
 *    vault / locations / brand kit and persists it on the locked pack's
 *    ingredients (with plain-language gaps).
 *  - Another member's vault NEVER enters the set: when the pack's
 *    artist_vault_id points at a vault owned by someone else, the set
 *    has no character reference and the gap says so. The same holds for
 *    the other member's locations library.
 *
 * Fake-db style (mirrors drafts.test.ts): the REAL router + REAL table
 * objects from @workspace/db (so eq/and/isNull render real conditions,
 * read back via PgDialect), with a fake db implementing only the chains
 * this handler uses — full/partial selects filtered by the rendered
 * WHERE params (flat ANDs of `= $n` / `is null` predicates) and an
 * update…returning that applies the set values. (pg-mem can't serve
 * this route: drizzle builder queries carry rowMode, which the pg-mem
 * adapter rejects — pg-mem is reserved for raw-SQL surfaces.) Values
 * are JSON round-tripped on write and read, matching jsonb storage
 * semantics. AI, credits, storage, mirroring, and the brand-record
 * reader are mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const testState = vi.hoisted(() => ({
  tables: new Map<unknown, Array<Record<string, any>>>(),
  brandKit: null as any,
  db: null as any,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u);
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => ({})),
  getTextModel: vi.fn(() => "test-model"),
}));

vi.mock("../../lib/co-stars", () => ({
  buildCoStarContext: vi.fn(async () => ""),
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 99_000),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "supabase://generated-clips/x.png"),
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (v: any) => v),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (url: string) => url),
}));

vi.mock("../../lib/brand-record", () => ({
  readBrandKit: vi.fn(async () => testState.brandKit),
}));

import preProductionRouter from "../generate/pre-production";
import {
  preproductionPacksTable,
  artistVaultsTable,
  locationsTable,
} from "@workspace/db";

/* ── Fake db ──────────────────────────────────────────────────────────── */

const dialect = new PgDialect();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function rowsFor(table: unknown): Array<Record<string, any>> {
  let rows = testState.tables.get(table);
  if (!rows) { rows = []; testState.tables.set(table, rows); }
  return rows;
}

/** Evaluate the handler's WHERE shapes: flat ANDs of `"t"."c" = $n` and
 * `"t"."c" is null` predicates, params taken from the rendered query. */
function matches(cond: unknown, row: Record<string, any>): boolean {
  if (cond == null) return true;
  const q = dialect.sqlToQuery(cond as never);
  const params = q.params as unknown[];
  let ok = true;
  const eqRe = /"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = eqRe.exec(q.sql))) {
    if (row[m[1]] !== params[Number(m[2]) - 1]) ok = false;
  }
  const nullRe = /"[^"]+"\."([^"]+)"\s+is\s+null/gi;
  while ((m = nullRe.exec(q.sql))) {
    if (row[m[1]] != null) ok = false;
  }
  return ok;
}

function project(row: Record<string, any>, fields?: Record<string, unknown>) {
  if (!fields) return clone(row);
  const out: Record<string, any> = {};
  for (const [key, col] of Object.entries(fields)) {
    out[key] = clone(row[(col as { name: string }).name]);
  }
  return out;
}

function buildFakeDb() {
  return {
    select: (fields?: Record<string, unknown>) => {
      let table: unknown;
      let cond: unknown;
      let limitN: number | undefined;
      const exec = () => {
        const rows = rowsFor(table).filter((r) => matches(cond, r));
        const sliced = limitN != null ? rows.slice(0, limitN) : rows;
        return sliced.map((r) => project(r, fields));
      };
      const chain: any = {
        from: (t: unknown) => { table = t; return chain; },
        where: (c: unknown) => { cond = c; return chain; },
        orderBy: () => chain,
        limit: (n: number) => { limitN = n; return chain; },
        then: (resolve: any, reject: any) =>
          Promise.resolve().then(exec).then(resolve, reject),
      };
      return chain;
    },
    update: (table: unknown) => {
      let setVals: Record<string, any> = {};
      let cond: unknown;
      const chain: any = {
        set: (v: Record<string, any>) => { setVals = v; return chain; },
        where: (c: unknown) => { cond = c; return chain; },
        returning: async () => {
          const out: Array<Record<string, any>> = [];
          for (const row of rowsFor(table)) {
            if (matches(cond, row)) {
              Object.assign(row, clone(setVals));
              out.push(clone(row));
            }
          }
          return out;
        },
      };
      return chain;
    },
  };
}

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const OWNER = randomUUID();
const STRANGER = randomUUID();
const VAULT_URL = "https://img.example/vault-photo.jpg";
const STRANGER_VAULT_URL = "https://img.example/stranger-vault.jpg";
const CROWN_URL = "https://img.example/gold-crown.jpg";
const THRONE_URL = "https://img.example/throne-room.jpg";
const STRANGER_LOC_URL = "https://img.example/stranger-place.jpg";
const LOGO_URL = "https://img.example/brand-logo.png";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: () => {}, warn: () => {}, error: () => {} };
    next();
  });
  app.use("/api", preProductionRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  testState.tables.clear();
  testState.db = buildFakeDb();
  testState.brandKit = { logoUrl: LOGO_URL };
});

function seedPack(vaultId: string | null) {
  const packId = randomUUID();
  const bible = { concept: "c", visualStyle: "s", colorPalette: "p", locations: "Throne Room", wardrobe: "w", propsNeeded: "Gold Crown", cast: "king", mood: "m", doNotChange: "d" };
  const storyboard = [{ shotNumber: 1, description: "The king enters the throne room wearing the crown", cameraAngle: "low dolly", durationSec: 5 }];
  const ingredients = [{ shotNumber: 1, prompt: "Locked prompt", negativePrompt: "", referenceAssetUrls: [], continuityNotes: "", model: "seedance2_5", durationSec: 5, ratio: "720:1280" }];
  rowsFor(preproductionPacksTable).push({
    id: packId,
    user_id: OWNER,
    project_id: null,
    artist_vault_id: vaultId,
    song_title: null,
    genre: null,
    mood: null,
    bible,
    storyboard,
    props: [],
    ingredients,
    assets: [],
    status: "ready",
    credits_charged: null,
    locked_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return packId;
}

async function finalize(packId: string) {
  const res = await fetch(`${baseUrl}/api/pre-production/pack/${packId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": OWNER },
    body: JSON.stringify({
      props: [{ name: "Gold Crown", description: "gold crown", shots: [1], assetImageUrl: CROWN_URL }],
      assets: [],
      propNameRefs: { "1": ["Gold Crown"] },
    }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("POST /pre-production/pack/:id/finalize — reference assembly", () => {
  it("assembles and persists the shot's reference set from the owner's own vault, locations, props, and brand kit", async () => {
    const vaultId = randomUUID();
    rowsFor(artistVaultsTable).push({ id: vaultId, user_id: OWNER, artist_name: "King Test", reference_image_url: VAULT_URL, deleted_at: null });
    rowsFor(locationsTable).push({ id: randomUUID(), user_id: OWNER, label: "Throne Room", image_url: THRONE_URL, image_path: null });
    const packId = seedPack(vaultId);

    const { status, json } = await finalize(packId);
    expect(status).toBe(200);
    expect(json.pack.status).toBe("locked");
    const ing = json.pack.ingredients[0];
    expect(ing.referenceSet.map((r: any) => r.role)).toEqual(["character", "location", "product", "style"]);
    expect(ing.referenceSet.map((r: any) => r.url)).toEqual([VAULT_URL, THRONE_URL, CROWN_URL, LOGO_URL]);
    expect(ing.referenceGaps).toEqual([]);
    /* The set is on the persisted row, not just the response. */
    const stored = rowsFor(preproductionPacksTable).find((r) => r.id === packId);
    expect(stored?.ingredients[0].referenceSet).toHaveLength(4);
  });

  it("another member's vault and locations NEVER enter the set — the gap says what's missing instead", async () => {
    const strangerVaultId = randomUUID();
    rowsFor(artistVaultsTable).push({ id: strangerVaultId, user_id: STRANGER, artist_name: "Stranger", reference_image_url: STRANGER_VAULT_URL, deleted_at: null });
    rowsFor(locationsTable).push({ id: randomUUID(), user_id: STRANGER, label: "Throne Room", image_url: STRANGER_LOC_URL, image_path: null });
    const packId = seedPack(strangerVaultId);

    const { status, json } = await finalize(packId);
    expect(status).toBe(200);
    const ing = json.pack.ingredients[0];
    const serialized = JSON.stringify(json.pack);
    expect(serialized).not.toContain(STRANGER_VAULT_URL);
    expect(serialized).not.toContain(STRANGER_LOC_URL);
    expect(ing.referenceSet.find((r: any) => r.role === "character")).toBeUndefined();
    expect(ing.referenceSet.find((r: any) => r.role === "location")).toBeUndefined();
    expect(ing.referenceGaps.join(" ")).toMatch(/No character reference/);
    expect(ing.referenceGaps).toContain("No location reference for this scene.");
    /* The owner's own material still assembles. */
    expect(ing.referenceSet.map((r: any) => r.url)).toEqual([CROWN_URL, LOGO_URL]);
  });
});
