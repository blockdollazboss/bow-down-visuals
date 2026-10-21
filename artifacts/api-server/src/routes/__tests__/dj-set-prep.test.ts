/**
 * DJ Set-Prep routes — HTTP over pg-mem (the catalog-export-builder
 * pattern). Pins the contracts the UI and DJs rely on:
 *  - the library and analysis only ever touch the CALLER's songs
 *    (a stranger's song analyzes as "not_found", never leaks);
 *  - analysis results carry their honesty labels end-to-end;
 *  - a crate PATCH naming someone else's song is refused WHOLE —
 *    the crate keeps its previous order, nothing partially applies;
 *  - propose-order is a DRAFT: the crate's saved order does not move
 *    until the creator saves the proposal via PATCH (the DJ's own
 *    order is never overwritten silently);
 *  - exports stream the crate in its saved play order, in both
 *    formats, and a stranger can't export what isn't theirs;
 *  - no charge rail exists anywhere in the DJ routes (source pin) —
 *    set prep rides the creator's own library, free.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import express from "express";
import http from "http";
import type { AddressInfo } from "node:net";
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

import djRouter from "../dj";
import { createTestDb } from "../../lib/__tests__/test-db";
import { getTableColumns } from "drizzle-orm";
import {
  songsTable,
  songDjAnalysisTable,
  djCratesTable,
  djCrateItemsTable,
} from "@workspace/db";

/* DDL synthesized from the real drizzle tables — the routes select whole
 * rows, so the test tables must carry every real column, not a hand-
 * picked subset that drifts from the schema. */
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
    let def = "";
    if (col.columnType === "PgTimestamp" && col.hasDefault) def = " DEFAULT now()";
    else if (col.columnType === "PgUUID" && col.hasDefault) def = " DEFAULT gen_random_uuid()";
    else if (col.hasDefault && typeof col.default === "number") def = ` DEFAULT ${col.default}`;
    else if (col.hasDefault && typeof col.default === "boolean") def = ` DEFAULT ${col.default}`;
    else if (col.hasDefault && typeof col.default === "string") def = ` DEFAULT '${col.default}'`;
    parts.push(
      `"${col.name}" ${TYPE_MAP[col.columnType] ?? "text"}` +
      `${col.primary ? " PRIMARY KEY" : ""}` +
      `${col.notNull && !col.primary ? " NOT NULL" : ""}${def}`,
    );
  }
  return `CREATE TABLE ${name} (${parts.join(", ")});`;
}
const DDL = [
  ddlFor(songsTable, "songs"),
  ddlFor(songDjAnalysisTable, "song_dj_analysis"),
  ddlFor(djCratesTable, "dj_crates"),
  ddlFor(djCrateItemsTable, "dj_crate_items"),
  `CREATE UNIQUE INDEX dj_crate_items_crate_song_idx ON dj_crate_items (crate_id, song_id);`,
].join("\n");

const OWNER = randomUUID();
const STRANGER = randomUUID();
const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let audioServer: any;
let audioBase = "";

/* ── WAV fixture: an A-minor progression with known ground truth ────── */
const SR = 22050;
function midiHz(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }
function progressionWav(): Buffer {
  const chords: Array<{ notes: number[]; sec: number }> = [
    { notes: [45, 57, 60, 64], sec: 3 },
    { notes: [53, 65, 69, 72], sec: 2 },
    { notes: [48, 60, 64, 67], sec: 2 },
    { notes: [55, 67, 71, 74], sec: 2 },
    { notes: [45, 57, 60, 64], sec: 3 },
  ];
  const total = chords.reduce((s, c) => s + c.sec, 0);
  const pcm = new Float32Array(Math.floor(total * SR));
  let cursor = 0;
  for (const chord of chords) {
    const len = Math.floor(chord.sec * SR);
    const fade = Math.floor(0.03 * SR);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / fade, (len - i) / fade);
      let v = 0;
      for (const m of chord.notes) {
        const f = midiHz(m);
        v += Math.sin(2 * Math.PI * f * (i / SR)) * 0.22;
        v += Math.sin(2 * Math.PI * f * 2 * (i / SR)) * 0.1;
        v += Math.sin(2 * Math.PI * f * 3 * (i / SR)) * 0.05;
      }
      pcm[cursor + i] = v * Math.max(0, env);
    }
    cursor += len;
  }
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
const WAV = progressionWav();

beforeAll(async () => {
  audioServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "audio/wav" });
    res.end(WAV);
  });
  await new Promise<void>((r) => audioServer.listen(0, "127.0.0.1", r));
  audioBase = `http://127.0.0.1:${(audioServer.address() as AddressInfo).port}`;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: (o: any, m?: any) => console.error("[dj-route]", m ?? "", o?.err ?? o), info: () => {} }; next(); });
  app.use(djRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => audioServer.close(() => r()));
});
beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    /* impure: otherwise pg-mem constant-folds the default and every
     * inserted row shares one uuid (the hub-projects.test.ts lesson). */
    impure: true,
  });
  mem.public.none(DDL);
  testState.db = db;
});

async function call(user: string | null, method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r;
}

const songIds = { a: randomUUID(), b: randomUUID(), c: randomUUID(), foreign: randomUUID() };
async function seedSongs() {
  const db = testState.db;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source) VALUES (${songIds.a}, ${OWNER}, 'Alpha', ${`${audioBase}/a.wav`}, 'generated')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source) VALUES (${songIds.b}, ${OWNER}, 'Beta', ${`${audioBase}/b.wav`}, 'upload')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source) VALUES (${songIds.c}, ${OWNER}, 'Gamma', ${`${audioBase}/c.wav`}, 'upload')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source) VALUES (${songIds.foreign}, ${STRANGER}, 'Not Mine', ${`${audioBase}/x.wav`}, 'upload')`);
}

async function makeCrateWith(ids: string[]): Promise<string> {
  const r = await call(OWNER, "POST", "/dj/crates", { name: "Friday Warm-Up" });
  expect(r.status).toBe(200);
  const { crate } = await r.json() as any;
  const p = await call(OWNER, "PATCH", `/dj/crates/${crate.id}`, { songIds: ids });
  expect(p.status).toBe(200);
  return crate.id as string;
}

describe("DJ library + analysis", () => {
  it("library returns exactly the caller's songs, stranger's excluded", async () => {
    await seedSongs();
    const r = await call(OWNER, "GET", "/dj/library");
    expect(r.status).toBe(200);
    const { tracks } = await r.json() as any;
    expect(tracks.map((t: any) => t.title).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(tracks.every((t: any) => t.analysis === null)).toBe(true);
  });

  it("requires auth", async () => {
    const r = await call(null, "GET", "/dj/library");
    expect(r.status).toBe(401);
  });

  it("analyzes an owned song and stores key + Camelot + confidence", async () => {
    await seedSongs();
    const r = await call(OWNER, "POST", "/dj/analyze", { songIds: [songIds.a] });
    expect(r.status).toBe(200);
    const { results } = await r.json() as any;
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("analyzed");
    expect(results[0].analysis.keyLabel).toBe("A minor");
    expect(results[0].analysis.camelot).toBe("8A");
    expect(["high", "medium"]).toContain(results[0].analysis.keyConfidence);
    expect(results[0].analysis.keyScore).toBeGreaterThan(0.5);
    // …and the library now serves it back.
    const lib = await (await call(OWNER, "GET", "/dj/library")).json() as any;
    const alpha = lib.tracks.find((t: any) => t.id === songIds.a);
    expect(alpha.analysis.camelot).toBe("8A");
  }, 60_000);

  it("a stranger's song analyzes as not_found and stores nothing", async () => {
    await seedSongs();
    const r = await call(OWNER, "POST", "/dj/analyze", { songIds: [songIds.foreign] });
    const { results } = await r.json() as any;
    expect(results[0].status).toBe("not_found");
    const lib = await (await call(STRANGER, "GET", "/dj/library")).json() as any;
    expect(lib.tracks[0].analysis).toBeNull();
  });
});

describe("DJ crates", () => {
  it("PATCH with a foreign song is refused whole — prior order intact", async () => {
    await seedSongs();
    const crateId = await makeCrateWith([songIds.a, songIds.b]);
    const r = await call(OWNER, "PATCH", `/dj/crates/${crateId}`, {
      songIds: [songIds.c, songIds.foreign],
    });
    expect(r.status).toBe(400);
    const body = await r.json() as any;
    expect(body.code).toBe("foreign_song");
    const { crates } = await (await call(OWNER, "GET", "/dj/crates")).json() as any;
    expect(crates[0].tracks.map((t: any) => t.songId)).toEqual([songIds.a, songIds.b]);
  });

  it("propose-order is a draft — the saved order moves only on PATCH", async () => {
    await seedSongs();
    const { sql } = await import("drizzle-orm");
    const db = testState.db;
    // Seed analysis directly: a=130 BPM 8A, b=118 BPM 8A, c=126 BPM 8B.
    for (const [id, bpm, camelot] of [
      [songIds.a, 130, "8A"], [songIds.b, 118, "8A"], [songIds.c, 126, "8B"],
    ] as const) {
      await db.execute(sql`INSERT INTO song_dj_analysis (song_id, user_id, bpm, bpm_confidence, key_root, key_mode, key_label, camelot, key_score, key_confidence, duration_sec) VALUES (${id}, ${OWNER}, ${bpm}, 'high', 9, 'minor', 'A minor', ${camelot}, 0.9, 'high', 200)`);
    }
    const crateId = await makeCrateWith([songIds.a, songIds.b, songIds.c]);

    const r = await call(OWNER, "POST", `/dj/crates/${crateId}/propose-order`);
    expect(r.status).toBe(200);
    const { proposal } = await r.json() as any;
    // Opens on the lowest tempo (b, 118) and annotates every transition.
    expect(proposal.order[0]).toBe(songIds.b);
    expect([...proposal.order].sort()).toEqual([songIds.a, songIds.b, songIds.c].sort());
    expect(proposal.transitions).toHaveLength(2);

    // The crate itself has NOT moved — the proposal is a draft.
    const { crates } = await (await call(OWNER, "GET", "/dj/crates")).json() as any;
    expect(crates[0].tracks.map((t: any) => t.songId)).toEqual([songIds.a, songIds.b, songIds.c]);

    // Saving the proposal via PATCH is what moves it.
    const save = await call(OWNER, "PATCH", `/dj/crates/${crateId}`, { songIds: proposal.order });
    expect(save.status).toBe(200);
    const after = await (await call(OWNER, "GET", "/dj/crates")).json() as any;
    expect(after.crates[0].tracks.map((t: any) => t.songId)).toEqual(proposal.order);
  });

  it("a stranger sees none of the owner's crates and cannot export them", async () => {
    await seedSongs();
    const crateId = await makeCrateWith([songIds.a]);
    const list = await (await call(STRANGER, "GET", "/dj/crates")).json() as any;
    expect(list.crates).toEqual([]);
    const exp = await call(STRANGER, "GET", `/dj/crates/${crateId}/export?format=m3u`);
    expect(exp.status).toBe(404);
  });
});

describe("DJ exports", () => {
  it("rekordbox XML is well-formed and in crate order; M3U matches", async () => {
    await seedSongs();
    const { sql } = await import("drizzle-orm");
    const db = testState.db;
    await db.execute(sql`INSERT INTO song_dj_analysis (song_id, user_id, bpm, bpm_confidence, key_root, key_mode, key_label, camelot, key_score, key_confidence, duration_sec) VALUES (${songIds.b}, ${OWNER}, 122, 'high', 9, 'minor', 'A minor', '8A', 0.9, 'high', 187)`);
    const crateId = await makeCrateWith([songIds.b, songIds.a]);

    const xr = await call(OWNER, "GET", `/dj/crates/${crateId}/export?format=rekordbox`);
    expect(xr.status).toBe(200);
    expect(xr.headers.get("content-type")).toContain("application/xml");
    expect(xr.headers.get("content-disposition")).toContain(".rekordbox.xml");
    const xml = await xr.text();
    expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
    expect(xml).toContain(`<DJ_PLAYLISTS Version="1.0.0">`);
    expect(xml.trimEnd().endsWith("</DJ_PLAYLISTS>")).toBe(true);
    expect(xml).toContain(`<COLLECTION Entries="2">`);
    expect(xml).toContain(`AverageBpm="122.00"`);
    expect(xml).toContain(`Tonality="Am"`);
    // Playlist order = crate order: Beta (Key 1) before Alpha (Key 2).
    expect(xml.indexOf(`Name="Beta"`)).toBeLessThan(xml.indexOf(`Name="Alpha"`));

    const mr = await call(OWNER, "GET", `/dj/crates/${crateId}/export?format=m3u`);
    expect(mr.status).toBe(200);
    const m3u = await mr.text();
    expect(m3u.startsWith("#EXTM3U")).toBe(true);
    expect(m3u).toContain("# Bow Down Visuals: 122 BPM · A minor · Camelot 8A");
    expect(m3u.indexOf("Beta")).toBeLessThan(m3u.indexOf("Alpha"));
  });

  it("an empty crate refuses export honestly", async () => {
    await seedSongs();
    const r = await call(OWNER, "POST", "/dj/crates", { name: "Empty" });
    const { crate } = await r.json() as any;
    const exp = await call(OWNER, "GET", `/dj/crates/${crate.id}/export?format=m3u`);
    expect(exp.status).toBe(400);
  });
});

describe("charge discipline", () => {
  it("the DJ routes carry no charge rail — set prep is free", () => {
    const src = readFileSync(join(__dirname, "..", "dj.ts"), "utf8");
    expect(src).not.toContain("chargeCredits");
    expect(src).not.toContain("credits");
  });
});
