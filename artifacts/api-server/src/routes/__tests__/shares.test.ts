/**
 * Route tests for POST /api/shares — the tracked share rail
 * (World Ring 4 round 2: completable quests).
 *
 * This rail is the ONLY door a share walks through to become
 * quest progress: the handler writes one share_events row and
 * fires lib/retention's recordShareEvent, which advances the
 * weekly Viral Sharer and the Daily Trio's Loudmouth through the
 * existing machinery (that hook's own progress/claim behavior is
 * pinned in lib/__tests__/retention-quest-bell.test.ts — here we
 * pin the door, not the room behind it).
 *
 * The regression these tests exist for: the clients' share
 * vocabulary (ShareMenu's ShareContentType, the palace desks'
 * buildShareTrackPayload) includes "image" — cover art shares —
 * but the route's enum didn't, so every image share was a 400
 * the clients swallowed and NO in-world share ever counted. The
 * enum now carries the clients' full vocabulary; a type nobody
 * speaks is still a 400 that records nothing.
 *
 * House fake-db style: real table objects via importOriginal,
 * requireAuth mocked at the same seam as the other route suites.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  inserted: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  hookCalls: [] as string[],
}));

const USER_A = "00000000-0000-4000-8000-0000000000a1";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.headers["x-test-user"];
    if (typeof userId !== "string" || !userId) {
      res.status(401).json({ error: "Sign in first." });
      return;
    }
    req.userId = userId;
    next();
  },
}));

/* The quest hook is the existing machinery behind the door —
   a recording stand-in at the module seam; its real behavior
   (progress, claims, the shared pool) is pinned by the
   retention suites. */
vi.mock("../../lib/retention", () => ({
  recordShareEvent: async (userId: string) => {
    h.hookCalls.push(userId);
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb: any = {
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        h.inserted.push({ table, values });
      },
    }),
  };
  return { ...actual, db: fakeDb };
});

import { shareEventsTable } from "@workspace/db";
import router from "../shares";

const realFetch = globalThis.fetch;
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

beforeEach(() => {
  h.inserted = [];
  h.hookCalls = [];
});

async function postShare(body: unknown, userId?: string) {
  const r = await realFetch(`${baseUrl}/shares`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /api/shares — the tracked share rail", () => {
  it("refuses the signed-out: 401, nothing recorded, no quest hook", async () => {
    const { status } = await postShare({ content_type: "song", channel: "copy" });
    expect(status).toBe(401);
    expect(h.inserted).toHaveLength(0);
    expect(h.hookCalls).toHaveLength(0);
  });

  it("records an image share — the Cover Art Desk's vocabulary — and fires the quest hook", async () => {
    const { status, json } = await postShare(
      { content_type: "image", content_id: null, channel: "copy" },
      USER_A,
    );
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]!.table).toBe(shareEventsTable);
    expect(h.inserted[0]!.values).toMatchObject({
      userId: USER_A,
      contentType: "image",
      channel: "copy",
    });
    expect(h.hookCalls).toEqual([USER_A]);
  });

  it("still records the established vocabulary (a song share)", async () => {
    const { status } = await postShare(
      { content_type: "song", content_id: "track-1", channel: "native" },
      USER_A,
    );
    expect(status).toBe(200);
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]!.values).toMatchObject({ contentType: "song", contentId: "track-1" });
    expect(h.hookCalls).toEqual([USER_A]);
  });

  it("a content type nobody speaks is a 400 that records nothing", async () => {
    const { status, json } = await postShare(
      { content_type: "hologram", channel: "copy" },
      USER_A,
    );
    expect(status).toBe(400);
    expect(json.error).toBe("Invalid share event");
    expect(h.inserted).toHaveLength(0);
    expect(h.hookCalls).toHaveLength(0);
  });

  it("an unknown channel is a 400 that records nothing", async () => {
    const { status } = await postShare(
      { content_type: "song", channel: "smoke-signal" },
      USER_A,
    );
    expect(status).toBe(400);
    expect(h.inserted).toHaveLength(0);
    expect(h.hookCalls).toHaveLength(0);
  });
});
