/**
 * Sound-fit routes — HTTP over pg-mem. Pins:
 *  - fit results contain ONLY analysed sounds (BPM + readable key),
 *    ranked, with the coverage counts stated in every response;
 *  - an unanalysed source is refused honestly (422 source_unanalysed),
 *    for both a beat listing missing BPM/key and an own song with no
 *    DJ analysis — and a stranger's song is a 404, never a leak;
 *  - the stack leaves slots empty rather than filling them with a
 *    clash, and suggests the sample-pack fill in the source's key;
 *  - sold-exclusive beats never appear as buyable fits;
 *  - no charge rail exists in the route (source pin) — discovery free.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import express from "express";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

import soundFitRouter from "../sound-fit";
import { createTestDb } from "../../lib/__tests__/test-db";
import { getTableColumns } from "drizzle-orm";
import { beatsTable, songsTable, songDjAnalysisTable } from "@workspace/db";

const TYPE_MAP: Record<string, string> = {
  PgUUID: "uuid", PgText: "text", PgVarchar: "text", PgChar: "text",
  PgInteger: "integer", PgSerial: "integer", PgBigInt53: "bigint", PgBigInt64: "bigint",
  PgDoublePrecision: "double precision", PgReal: "real", PgNumeric: "numeric",
  PgBoolean: "boolean", PgTimestamp: "timestamptz", PgDate: "date",
  PgJsonb: "jsonb", PgJson: "jsonb",
};
function ddlFor(table: any, name: string): string {
  const parts: string[] = [];
  for (const col of Object.values<any>(getTableColumns(table))) {
    // mood_tags is a text[] column.
    const type = col.name === "mood_tags" ? "text[]" : (TYPE_MAP[col.columnType] ?? "text");
    let def = "";
    if (col.columnType === "PgTimestamp" && col.hasDefault) def = " DEFAULT now()";
    else if (col.columnType === "PgUUID" && col.hasDefault) def = " DEFAULT gen_random_uuid()";
    else if (col.hasDefault && typeof col.default === "number") def = ` DEFAULT ${col.default}`;
    else if (col.hasDefault && typeof col.default === "boolean") def = ` DEFAULT ${col.default}`;
    else if (col.hasDefault && typeof col.default === "string") def = ` DEFAULT '${col.default}'`;
    else if (col.name === "mood_tags") def = " DEFAULT '{}'";
    parts.push(
      `"${col.name}" ${type}` +
      `${col.primary ? " PRIMARY KEY" : ""}` +
      `${col.notNull && !col.primary ? " NOT NULL" : ""}${def}`,
    );
  }
  return `CREATE TABLE ${name} (${parts.join(", ")});`;
}
const DDL = [ddlFor(beatsTable, "beats"), ddlFor(songsTable, "songs"), ddlFor(songDjAnalysisTable, "song_dj_analysis")].join("\n");

const OWNER = randomUUID();
const STRANGER = randomUUID();
const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: (o: any, m?: any) => console.error("[sound-fit-route]", m ?? "", o?.err ?? o), info: () => {} }; next(); });
  app.use(soundFitRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID(), impure: true,
  });
  mem.public.none(DDL);
  testState.db = db;
});

async function call(user: string | null, method: string, path: string, body?: unknown) {
  return realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ids = {
  sourceBeat: randomUUID(), perfect: randomUUID(), near: randomUUID(),
  noBpm: randomUUID(), noKey: randomUUID(), badKey: randomUUID(), sold: randomUUID(),
  ownSong: randomUUID(), ownSongRaw: randomUUID(), foreignSong: randomUUID(),
  drums: randomUUID(), bass: randomUUID(),
};
async function seed() {
  const db = testState.db;
  const { sql } = await import("drizzle-orm");
  const beat = (id: string, title: string, bpm: number | null, key: string | null, extra = "") =>
    db.execute(sql`INSERT INTO beats (id, user_id, title, audio_url, genre, bpm, musical_key, mood_tags, basic_price_cents, exclusive_sold)
      VALUES (${id}, ${STRANGER}, ${title}, ${`https://cdn/${id}.mp3`}, 'trap', ${bpm}, ${key}, ARRAY['dark'], 2999, ${extra === "sold"})`);
  await beat(ids.sourceBeat, "Source Beat", 140, "A min");
  await beat(ids.perfect, "Perfect Fit Beat", 140, "A min");
  await beat(ids.near, "Near Fit Beat", 138, "E min");
  await beat(ids.noBpm, "No Tempo Beat", null, "A min");
  await beat(ids.noKey, "No Key Beat", 140, null);
  await beat(ids.badKey, "Unreadable Key Beat", 140, "dark vibes");
  await beat(ids.sold, "Sold Exclusive Beat", 140, "A min", "sold");
  await beat(ids.drums, "Trap Drum Loop", 141, "A min");
  await beat(ids.bass, "Sub Bass Loop", 139, "E min");
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source, genre) VALUES (${ids.ownSong}, ${OWNER}, 'My Song', 'https://cdn/s.mp3', 'generated', 'trap')`);
  await db.execute(sql`INSERT INTO song_dj_analysis (song_id, user_id, bpm, bpm_confidence, key_root, key_mode, key_label, camelot, key_score, key_confidence, duration_sec) VALUES (${ids.ownSong}, ${OWNER}, 140, 'high', 9, 'minor', 'A minor', '8A', 0.9, 'high', 200)`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source, genre) VALUES (${ids.ownSongRaw}, ${OWNER}, 'My Raw Song', 'https://cdn/s2.mp3', 'upload', 'trap')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source, genre) VALUES (${ids.foreignSong}, ${STRANGER}, 'Not Mine', 'https://cdn/x.mp3', 'upload', 'trap')`);
}

describe("POST /sound-fit/fit", () => {
  it("requires auth", async () => {
    const r = await call(null, "POST", "/sound-fit/fit", { source: { kind: "custom", bpm: 140, musicalKey: "Am" } });
    expect(r.status).toBe(401);
  });

  it("ranks only analysed catalog sounds and states coverage honestly", async () => {
    await seed();
    const r = await call(OWNER, "POST", "/sound-fit/fit", { source: { kind: "beat", id: ids.sourceBeat } });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.method).toContain("Metadata fit only");
    const resultIds = body.results.map((x: any) => x.id);
    expect(resultIds[0]).toBe(ids.perfect);
    expect(resultIds).toContain(ids.near);
    expect(resultIds).not.toContain(ids.sourceBeat); // never fits against itself
    expect(resultIds).not.toContain(ids.noBpm);
    expect(resultIds).not.toContain(ids.noKey);
    expect(resultIds).not.toContain(ids.badKey);
    expect(resultIds).not.toContain(ids.sold);
    // Coverage: 8 buyable beats (sold excluded) + 2 own songs = 10 total;
    // analysed = 5 beats with bpm+readable key + 1 analysed song.
    expect(body.coverage.total).toBe(10);
    expect(body.coverage.analysed).toBe(6);
    expect(body.coverage.unanalysed).toBe(4);
    const perfect = body.results[0];
    // 50 key + 30 tempo + 15 tag (same genre 10 + one shared "dark" tag 5).
    expect(perfect.fit.score).toBe(95);
    expect(perfect.basicPriceCents).toBe(2999); // price exactly as listed
  });

  it("custom source (a just-generated pack's bpm/key) works", async () => {
    await seed();
    const r = await call(OWNER, "POST", "/sound-fit/fit", { source: { kind: "custom", bpm: 140, musicalKey: "Am", genre: "trap", tags: ["dark"] } });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.source.camelot).toBe("8A");
    expect(body.results.length).toBeGreaterThan(0);
  });

  it("custom source with an unreadable key is refused, not guessed", async () => {
    await seed();
    const r = await call(OWNER, "POST", "/sound-fit/fit", { source: { kind: "custom", bpm: 140, musicalKey: "dark vibes" } });
    expect(r.status).toBe(400);
    expect((await r.json() as any).code).toBe("source_key_unreadable");
  });

  it("an unanalysed beat source is a 422 source_unanalysed", async () => {
    await seed();
    const r = await call(OWNER, "POST", "/sound-fit/fit", { source: { kind: "beat", id: ids.noBpm } });
    expect(r.status).toBe(422);
    expect((await r.json() as any).code).toBe("source_unanalysed");
  });

  it("an own song with no DJ analysis is a 422; a stranger's song is a 404", async () => {
    await seed();
    const raw = await call(OWNER, "POST", "/sound-fit/fit", { source: { kind: "song", id: ids.ownSongRaw } });
    expect(raw.status).toBe(422);
    expect((await raw.json() as any).code).toBe("source_unanalysed");
    const foreign = await call(OWNER, "POST", "/sound-fit/fit", { source: { kind: "song", id: ids.foreignSong } });
    expect(foreign.status).toBe(404);
  });

  it("an analysed own song as source finds its fits", async () => {
    await seed();
    const r = await call(OWNER, "POST", "/sound-fit/fit", { source: { kind: "song", id: ids.ownSong } });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.results.map((x: any) => x.id)).toContain(ids.perfect);
  });
});

describe("POST /sound-fit/stack + GET /sound-fit/coverage", () => {
  it("builds drums + bass slots that fit, states the melodic slot honestly", async () => {
    await seed();
    const r = await call(OWNER, "POST", "/sound-fit/stack", { source: { kind: "beat", id: ids.sourceBeat } });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    const roles = body.stack.slots.map((s: any) => s.role);
    expect(roles).toContain("drums");
    expect(roles).toContain("bass");
    expect(body.stack.missing.map((m: any) => m.role)).toContain("melodic");
    expect(body.stack.fillSuggestion).toEqual({ genre: "trap", bpm: 140, musicalKey: "A" });
  });

  it("coverage endpoint reports the same honest counts", async () => {
    await seed();
    const r = await call(OWNER, "GET", "/sound-fit/coverage");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.coverage).toMatchObject({ total: 10, analysed: 6, unanalysed: 4 });
    expect(body.coverage.beats.total).toBe(8);
    expect(body.coverage.ownSongs.total).toBe(2);
  });
});

describe("charge discipline", () => {
  it("the sound-fit route carries no charge rail — discovery is free", () => {
    const src = readFileSync(join(__dirname, "..", "sound-fit.ts"), "utf8");
    expect(src).not.toContain("chargeCredits");
    expect(src).not.toContain("refundCredits");
  });
});
