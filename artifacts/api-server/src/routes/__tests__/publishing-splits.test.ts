/**
 * Publishing splits registry routes (Stack-100 #3 Wave 3, #22).
 *
 * Pins:
 *  - sum validation at the door (400 with the real total);
 *  - ownership: a creator can only register splits for THEIR OWN song
 *    (someone else's release/song → 404, nothing created);
 *  - confirm/dispute over HTTP: a linked writer confirms their share;
 *    a dispute flags the registration and the share NEVER moves;
 *  - non-participants can't even see a registration exists (404);
 *  - the owner revision resets confirmations and clears the dispute;
 *  - the split sheet export carries the partner-gated collection
 *    notice verbatim and no account ids;
 *  - pre-migration honesty: writes answer 503 publishing_splits_not_ready
 *    and /mine degrades to an empty, not-ready registry.
 *
 * Harness: the real router over an ephemeral server against pg-mem,
 * house style of distribution.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  withRegistryTables: true,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = 1000;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
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

import router from "../publishing-splits";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const REGISTRY_DDL = `
CREATE TABLE publishing_split_registrations (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'release',
  song_id uuid NOT NULL,
  song_title text NOT NULL DEFAULT '',
  has_dispute boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE publishing_split_writers (
  id uuid PRIMARY KEY,
  registration_id uuid NOT NULL,
  writer_name text NOT NULL,
  writer_user_id uuid,
  writer_profile_id uuid,
  share_pct numeric(5,2) NOT NULL,
  confirmation_status text NOT NULL DEFAULT 'pending',
  dispute_note text,
  confirmed_at timestamptz,
  disputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

const WORLD_DDL = `
CREATE TABLE distribution_releases (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL
);
CREATE TABLE songs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, kind text NOT NULL,
  title text NOT NULL, body text NOT NULL DEFAULT '', link text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);`;

const OWNER = randomUUID();
const CO = randomUUID();
const STRANGER = randomUUID();
const OWNER_PROFILE = randomUUID();
const CO_PROFILE = randomUUID();
const NOTICE = "Registered — collection activates when publishing administration is connected.";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let releaseId: string;
let foreignReleaseId: string;
let songId: string;

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

async function seedWorld(withRegistry: boolean) {
  const { db, mem } = createTestDb();
  mem.public.none(WORLD_DDL);
  if (withRegistry) mem.public.none(REGISTRY_DDL);
  testState.db = db;
  testState.userId = OWNER;
  releaseId = randomUUID();
  foreignReleaseId = randomUUID();
  songId = randomUUID();
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${OWNER_PROFILE}, ${OWNER}), (${CO_PROFILE}, ${CO})`);
  await db.execute(sql`INSERT INTO distribution_releases (id, user_id, title) VALUES (${releaseId}, ${OWNER}, 'Midnight Tide'), (${foreignReleaseId}, ${CO}, 'Not Yours')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title) VALUES (${songId}, ${OWNER}, 'Library Song')`);
}

beforeEach(async () => {
  await seedWorld(testState.withRegistryTables);
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

async function as(userId: string, method: string, path: string, body?: unknown) {
  testState.userId = userId;
  return req(method, path, body);
}

const SPLIT_BODY = () => ({
  song_kind: "release",
  song_id: releaseId,
  writers: [
    { name: "Owner Writer", user_id: OWNER, share_pct: 60 },
    { name: "Co Writer", user_id: CO, share_pct: 40 },
  ],
});

async function registerOk() {
  const { status, json } = await as(OWNER, "POST", "/publishing-splits", SPLIT_BODY());
  expect(status).toBe(201);
  return json.registration as any;
}

describe("POST /publishing-splits — validation + ownership", () => {
  it("rejects a split that doesn't sum to 100, naming the total, and creates nothing", async () => {
    const body = SPLIT_BODY();
    body.writers[1]!.share_pct = 30;
    const { status, json } = await as(OWNER, "POST", "/publishing-splits", body);
    expect(status).toBe(400);
    expect(json.error).toBe("split_sum");
    expect(json.message).toContain("90.00%");
    const mine = await as(OWNER, "GET", "/publishing-splits/mine");
    expect(mine.json.registrations).toHaveLength(0);
  });

  it("refuses to register splits on someone else's release (404)", async () => {
    const body = { ...SPLIT_BODY(), song_id: foreignReleaseId };
    const { status, json } = await as(OWNER, "POST", "/publishing-splits", body);
    expect(status).toBe(404);
    expect(json.error).toBe("song_not_found");
  });

  it("refuses an unresolvable writer account link (400, no ghost links)", async () => {
    const body = SPLIT_BODY();
    (body.writers[1] as any).user_id = randomUUID();
    const { status, json } = await as(OWNER, "POST", "/publishing-splits", body);
    expect(status).toBe(400);
    expect(json.error).toBe("writer_not_found");
  });

  it("registers my release: my row confirmed, co-writer pending, honest collection status", async () => {
    const reg = await registerOk();
    expect(reg.song_title).toBe("Midnight Tide");
    expect(reg.state).toBe("awaiting_confirmations");
    expect(reg.collection_status).toBe("not_connected");
    expect(reg.collection_notice).toBe(NOTICE);
    const owner = reg.writers.find((w: any) => w.name === "Owner Writer");
    const co = reg.writers.find((w: any) => w.name === "Co Writer");
    expect(owner.confirmation_status).toBe("confirmed");
    expect(co.confirmation_status).toBe("pending");
    expect(co.share_pct).toBe(40);
    /* a non-owner viewer never sees another writer's raw account id */
    testState.userId = CO;
    const seen = await req("GET", `/publishing-splits/${reg.id}`);
    const coView = seen.json.registration.writers.find((w: any) => w.name === "Owner Writer");
    expect(coView.user_id).toBeNull();
    expect(coView.is_linked).toBe(true);
  });

  it("registers a library song too (song_kind 'song')", async () => {
    const { status, json } = await as(OWNER, "POST", "/publishing-splits", {
      song_kind: "song",
      song_id: songId,
      writers: [{ name: "Owner Writer", user_id: OWNER, share_pct: 100 }],
    });
    expect(status).toBe(201);
    expect(json.registration.song_title).toBe("Library Song");
    expect(json.registration.state).toBe("confirmed");
  });

  it("a name-only writer is recorded as unlinked", async () => {
    const { status, json } = await as(OWNER, "POST", "/publishing-splits", {
      song_kind: "release",
      song_id: releaseId,
      writers: [
        { name: "Owner Writer", user_id: OWNER, share_pct: 70 },
        { name: "Off Platform Pete", share_pct: 30 },
      ],
    });
    expect(status).toBe(201);
    const pete = json.registration.writers.find((w: any) => w.name === "Off Platform Pete");
    expect(pete.confirmation_status).toBe("unlinked");
    expect(json.registration.state).toBe("registered");
  });
});

describe("confirm / dispute over HTTP", () => {
  it("the co-writer sees the song in /mine with their share, then confirms it", async () => {
    const reg = await registerOk();
    const mine = await as(CO, "GET", "/publishing-splits/mine");
    expect(mine.json.registrations).toHaveLength(1);
    expect(mine.json.registrations[0].my_share_pct).toBe(40);
    expect(mine.json.registrations[0].my_writer_status).toBe("pending");
    const confirmed = await as(CO, "POST", `/publishing-splits/${reg.id}/confirm`, {});
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.registration.state).toBe("confirmed");
  });

  it("a dispute flags the registration and NEVER moves the share", async () => {
    const reg = await registerOk();
    const disputed = await as(CO, "POST", `/publishing-splits/${reg.id}/dispute`, { note: "I wrote the bridge." });
    expect(disputed.status).toBe(200);
    expect(disputed.json.registration.state).toBe("disputed");
    expect(disputed.json.registration.has_dispute).toBe(true);
    const co = disputed.json.registration.writers.find((w: any) => w.name === "Co Writer");
    expect(co.share_pct).toBe(40);
    expect(co.dispute_note).toBe("I wrote the bridge.");
    /* and confirming afterwards resolves it, share still 40 */
    const resolved = await as(CO, "POST", `/publishing-splits/${reg.id}/confirm`, {});
    expect(resolved.json.registration.has_dispute).toBe(false);
    expect(resolved.json.registration.writers.find((w: any) => w.name === "Co Writer").share_pct).toBe(40);
  });

  it("a stranger gets 404 on read, confirm, dispute, amend and sheet — existence never leaks", async () => {
    const reg = await registerOk();
    expect((await as(STRANGER, "GET", `/publishing-splits/${reg.id}`)).status).toBe(404);
    expect((await as(STRANGER, "POST", `/publishing-splits/${reg.id}/confirm`, {})).status).toBe(404);
    expect((await as(STRANGER, "POST", `/publishing-splits/${reg.id}/dispute`, {})).status).toBe(404);
    expect((await as(STRANGER, "GET", `/publishing-splits/${reg.id}/sheet`)).status).toBe(404);
    const mine = await as(STRANGER, "GET", "/publishing-splits/mine");
    expect(mine.json.registrations).toHaveLength(0);
  });

  it("the owner revision resets confirmations and clears the dispute", async () => {
    const reg = await registerOk();
    await as(CO, "POST", `/publishing-splits/${reg.id}/dispute`, { note: "no" });
    const amended = await as(OWNER, "POST", `/publishing-splits/${reg.id}/amend`, {
      writers: [
        { name: "Owner Writer", user_id: OWNER, share_pct: 50 },
        { name: "Co Writer", profile_id: CO_PROFILE, share_pct: 50 },
      ],
    });
    expect(amended.status).toBe(200);
    expect(amended.json.registration.has_dispute).toBe(false);
    expect(amended.json.registration.state).toBe("awaiting_confirmations");
    const co = amended.json.registration.writers.find((w: any) => w.name === "Co Writer");
    expect(co.share_pct).toBe(50);
    expect(co.confirmation_status).toBe("pending");
    expect(co.is_linked).toBe(true);
  });

  it("a non-owner cannot amend (404)", async () => {
    const reg = await registerOk();
    const { status } = await as(CO, "POST", `/publishing-splits/${reg.id}/amend`, { writers: SPLIT_BODY().writers });
    expect(status).toBe(404);
  });
});

describe("GET /publishing-splits/:id/sheet — the shareable record", () => {
  it("exports the sheet with shares, states, and the collection notice verbatim", async () => {
    const reg = await registerOk();
    const { status, json } = await as(CO, "GET", `/publishing-splits/${reg.id}/sheet`);
    expect(status).toBe(200);
    expect(json.sheet_code).toMatch(/^BDV-PUBSPLIT-/);
    expect(json.sheet_text).toContain("Midnight Tide");
    expect(json.sheet_text).toContain("Co Writer — 40.00%");
    expect(json.sheet_text).toContain(NOTICE);
    expect(json.sheet_text).toContain("does not collect or pay royalties");
    expect(json.sheet_text).not.toContain(CO);
    expect(json.sheet_text).not.toContain(OWNER);
  });
});

describe("pre-migration honesty (registry tables absent)", () => {
  beforeEach(async () => {
    /* Runs after the outer beforeEach: rebuild WITHOUT the registry
       tables so every probe hits a genuine 42P01. */
    await seedWorld(false);
  });

  it("writes answer 503 publishing_splits_not_ready and create nothing", async () => {
    const { status, json } = await as(OWNER, "POST", "/publishing-splits", SPLIT_BODY());
    expect(status).toBe(503);
    expect(json.error).toBe("publishing_splits_not_ready");
    expect(json.collection_notice).toBe(NOTICE);
  });

  it("/mine degrades to an honest empty registry (200, registry_ready false)", async () => {
    const { status, json } = await as(OWNER, "GET", "/publishing-splits/mine");
    expect(status).toBe(200);
    expect(json.registry_ready).toBe(false);
    expect(json.registrations).toEqual([]);
    expect(json.collection_notice).toBe(NOTICE);
  });
});
