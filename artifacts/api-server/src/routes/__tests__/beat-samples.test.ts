/**
 * Beat Samples routes — HTTP over pg-mem (the dj-set-prep pattern).
 * Pins the contracts the Beat Studio library relies on:
 *  - sign-in is required on every route (401 without a user);
 *  - ownership is fail-closed: another account's sample reads as
 *    "not found" on get/complete/delete and never appears in a list;
 *  - format/size validation mirrors the loader's acceptance — a bad
 *    kind, an unlisted content type, an oversize or empty declaration
 *    is refused BEFORE any row or presigned URL exists;
 *  - the pending → ready handshake: /complete only turns a sample
 *    ready when the landed object's size matches the declaration;
 *    a missing object is a 409, a mismatched object is removed;
 *  - pending samples are invisible to list/get;
 *  - delete removes the caller's row and its stored object;
 *  - no charge rail exists anywhere in the route (source pin) —
 *    saving your own sounds is a free manual tool.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import express from "express";
import type { AddressInfo } from "node:net";
import { DataType } from "pg-mem";
import { getTableColumns } from "drizzle-orm";

const testState = vi.hoisted(() => ({ db: null as any }));
const r2State = vi.hoisted(() => ({
  configured: true,
  // storageKey -> byte size of the "landed" object (absent = no object)
  objects: new Map<string, number>(),
  deleted: [] as string[],
  presigned: [] as Array<{ key: string; contentType: string }>,
}));

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
vi.mock("../../lib/r2-client", () => ({
  isR2Configured: () => r2State.configured,
  r2GetPresignedPutUrl: async (key: string, contentType: string) => {
    r2State.presigned.push({ key, contentType });
    return `https://uploads.example.test/${key}?sig=fake`;
  },
  r2PublicUrl: (key: string) => `https://cdn.example.test/${key}`,
  r2ObjectSize: async (key: string) => {
    const size = r2State.objects.get(key);
    return size === undefined ? null : { size, contentType: "audio/wav" };
  },
  r2Delete: async (key: string) => {
    r2State.deleted.push(key);
    r2State.objects.delete(key);
  },
}));

import beatSamplesRouter from "../beat-samples";
import { createTestDb } from "../../lib/__tests__/test-db";
import { beatSamplesTable, BEAT_SAMPLE_MAX_BYTES } from "@workspace/db";

/* DDL synthesized from the real drizzle table — the routes select
 * whole rows, so the test table must carry every real column. */
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

const OWNER = randomUUID();
const STRANGER = randomUUID();
let server: any;
let baseUrl: string;

async function call(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const VALID = { name: "My Kick", kind: "kick", contentType: "audio/wav", sizeBytes: 44_100 };

/** Create + land + complete a sample for `user`; returns its DTO. */
async function makeReadySample(user: string, overrides: Partial<typeof VALID> = {}) {
  const body = { ...VALID, ...overrides };
  const created = await call("POST", "/beat-samples", { user, body });
  expect(created.status).toBe(201);
  const sample = created.data.sample;
  const key = `${user}/beat-samples/${sample.id}.wav`;
  r2State.objects.set(key, body.sizeBytes);
  const done = await call("POST", `/beat-samples/${sample.id}/complete`, { user });
  expect(done.status).toBe(200);
  return done.data.sample;
}

beforeAll(async () => {
  const t = createTestDb();
  testState.db = t.db;
  // pg-mem ships no gen_random_uuid — register it so the synthesized
  // DDL's uuid default works exactly like real Postgres.
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: DataType.uuid,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(ddlFor(beatSamplesTable, "beat_samples"));

  const app = express();
  app.use(express.json());
  app.use(beatSamplesRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  r2State.configured = true;
  r2State.objects.clear();
  r2State.deleted = [];
  r2State.presigned = [];
  const { db } = await import("@workspace/db");
  await db.delete(beatSamplesTable);
});

describe("auth — fail-closed", () => {
  it("every route 401s without a signed-in user", async () => {
    expect((await call("GET", "/beat-samples")).status).toBe(401);
    expect((await call("POST", "/beat-samples", { body: VALID })).status).toBe(401);
    expect((await call("POST", `/beat-samples/${randomUUID()}/complete`)).status).toBe(401);
    expect((await call("GET", `/beat-samples/${randomUUID()}`)).status).toBe(401);
    expect((await call("DELETE", `/beat-samples/${randomUUID()}`)).status).toBe(401);
  });
});

describe("create — validation mirrors the loader", () => {
  it("creates a pending row and returns a presigned PUT for the caller's own prefix", async () => {
    const res = await call("POST", "/beat-samples", { user: OWNER, body: VALID });
    expect(res.status).toBe(201);
    expect(res.data.sample).toMatchObject({
      name: "My Kick",
      kind: "kick",
      contentType: "audio/wav",
      sizeBytes: 44_100,
      status: "pending",
    });
    expect(res.data.sample.soundId).toBe(`upload:${res.data.sample.id}`);
    // No URL is promised before the bytes are confirmed.
    expect(res.data.sample.url).toBeUndefined();
    expect(res.data.uploadUrl).toContain("uploads.example.test");
    expect(r2State.presigned).toEqual([
      { key: `${OWNER}/beat-samples/${res.data.sample.id}.wav`, contentType: "audio/wav" },
    ]);
  });

  it("refuses a bad kind, an unlisted file type, an oversize and an empty declaration — minting nothing", async () => {
    const badBodies: unknown[] = [
      { ...VALID, kind: "gong" },
      { ...VALID, contentType: "video/mp4" },
      { ...VALID, contentType: "application/pdf" },
      { ...VALID, sizeBytes: BEAT_SAMPLE_MAX_BYTES + 1 },
      { ...VALID, sizeBytes: 0 },
      { ...VALID, sizeBytes: -5 },
      { ...VALID, sizeBytes: 1.5 },
      { ...VALID, name: "   " },
      { kind: "kick", contentType: "audio/wav", sizeBytes: 10 }, // no name
    ];
    for (const body of badBodies) {
      const res = await call("POST", "/beat-samples", { user: OWNER, body });
      expect(res.status).toBe(400);
      expect(typeof res.data.error).toBe("string");
    }
    expect(r2State.presigned).toEqual([]);
    const list = await call("GET", "/beat-samples", { user: OWNER });
    expect(list.data.samples).toEqual([]);
  });

  it("accepts the loader's formats case-insensitively and maps the extension", async () => {
    const res = await call("POST", "/beat-samples", {
      user: OWNER,
      body: { ...VALID, contentType: "Audio/MPEG", name: "Loop" },
    });
    expect(res.status).toBe(201);
    expect(r2State.presigned[0]!.key).toMatch(/\.mp3$/);
  });

  it("answers honestly when storage isn't configured", async () => {
    r2State.configured = false;
    const res = await call("POST", "/beat-samples", { user: OWNER, body: VALID });
    expect(res.status).toBe(503);
    expect(res.data.error).toContain("isn't available");
    expect(r2State.presigned).toEqual([]);
  });
});

describe("complete — the pending → ready handshake", () => {
  it("turns ready only when the landed object matches the declared size, then hands out the URL", async () => {
    const created = await call("POST", "/beat-samples", { user: OWNER, body: VALID });
    const id = created.data.sample.id;
    r2State.objects.set(`${OWNER}/beat-samples/${id}.wav`, VALID.sizeBytes);
    const done = await call("POST", `/beat-samples/${id}/complete`, { user: OWNER });
    expect(done.status).toBe(200);
    expect(done.data.sample.status).toBe("ready");
    expect(done.data.sample.url).toBe(`https://cdn.example.test/${OWNER}/beat-samples/${id}.wav`);
    // Idempotent: completing a ready sample returns it, no error.
    const again = await call("POST", `/beat-samples/${id}/complete`, { user: OWNER });
    expect(again.status).toBe(200);
    expect(again.data.sample.status).toBe("ready");
  });

  it("409s when the uploaded object never landed", async () => {
    const created = await call("POST", "/beat-samples", { user: OWNER, body: VALID });
    const res = await call("POST", `/beat-samples/${created.data.sample.id}/complete`, { user: OWNER });
    expect(res.status).toBe(409);
    expect(res.data.error).toContain("couldn't find the uploaded file");
  });

  it("removes a size-mismatched object and row instead of shelving a wrong sample", async () => {
    const created = await call("POST", "/beat-samples", { user: OWNER, body: VALID });
    const id = created.data.sample.id;
    const key = `${OWNER}/beat-samples/${id}.wav`;
    r2State.objects.set(key, VALID.sizeBytes + 7);
    const res = await call("POST", `/beat-samples/${id}/complete`, { user: OWNER });
    expect(res.status).toBe(409);
    expect(r2State.deleted).toContain(key);
    const after = await call("POST", `/beat-samples/${id}/complete`, { user: OWNER });
    expect(after.status).toBe(404);
  });

  it("a stranger cannot complete someone else's sample", async () => {
    const created = await call("POST", "/beat-samples", { user: OWNER, body: VALID });
    const id = created.data.sample.id;
    r2State.objects.set(`${OWNER}/beat-samples/${id}.wav`, VALID.sizeBytes);
    const res = await call("POST", `/beat-samples/${id}/complete`, { user: STRANGER });
    expect(res.status).toBe(404);
    // Still pending for the owner — the stranger's tap changed nothing.
    const list = await call("GET", "/beat-samples", { user: OWNER });
    expect(list.data.samples).toEqual([]);
  });
});

describe("list + get — owner-only, ready-only", () => {
  it("lists only the caller's ready samples", async () => {
    await makeReadySample(OWNER, { name: "Mine A" });
    await makeReadySample(OWNER, { name: "Mine B", kind: "snare" });
    await makeReadySample(STRANGER, { name: "Not Mine" });
    // A pending sample of the owner's stays invisible.
    await call("POST", "/beat-samples", { user: OWNER, body: { ...VALID, name: "Pending One" } });

    const list = await call("GET", "/beat-samples", { user: OWNER });
    expect(list.status).toBe(200);
    expect(list.data.samples.map((s: any) => s.name).sort()).toEqual(["Mine A", "Mine B"]);
    for (const s of list.data.samples) {
      expect(s.soundId).toBe(`upload:${s.id}`);
      expect(s.url).toContain("cdn.example.test");
    }
    const strangerList = await call("GET", "/beat-samples", { user: STRANGER });
    expect(strangerList.data.samples.map((s: any) => s.name)).toEqual(["Not Mine"]);
  });

  it("gets one of mine; a stranger's id and a pending id both read as not found", async () => {
    const mine = await makeReadySample(OWNER);
    const got = await call("GET", `/beat-samples/${mine.id}`, { user: OWNER });
    expect(got.status).toBe(200);
    expect(got.data.sample.id).toBe(mine.id);

    expect((await call("GET", `/beat-samples/${mine.id}`, { user: STRANGER })).status).toBe(404);

    const pending = await call("POST", "/beat-samples", { user: OWNER, body: VALID });
    expect((await call("GET", `/beat-samples/${pending.data.sample.id}`, { user: OWNER })).status).toBe(404);
  });
});

describe("delete — owner-only, removes row + object", () => {
  it("deletes my sample and its stored object", async () => {
    const mine = await makeReadySample(OWNER);
    const key = `${OWNER}/beat-samples/${mine.id}.wav`;
    const res = await call("DELETE", `/beat-samples/${mine.id}`, { user: OWNER });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(r2State.deleted).toContain(key);
    expect((await call("GET", `/beat-samples/${mine.id}`, { user: OWNER })).status).toBe(404);
    expect((await call("DELETE", `/beat-samples/${mine.id}`, { user: OWNER })).status).toBe(404);
  });

  it("a stranger cannot delete my sample", async () => {
    const mine = await makeReadySample(OWNER);
    expect((await call("DELETE", `/beat-samples/${mine.id}`, { user: STRANGER })).status).toBe(404);
    expect(r2State.deleted).toEqual([]);
    expect((await call("GET", `/beat-samples/${mine.id}`, { user: OWNER })).status).toBe(200);
  });
});

describe("lane boundaries", () => {
  it("no charges and no provider calls exist in the route", () => {
    const src = readFileSync(join(__dirname, "../beat-samples.ts"), "utf8");
    expect(src).not.toContain("chargeCredits");
    expect(src).not.toContain("deductCredits");
    expect(src).not.toContain("CREDIT_COSTS");
  });
});
