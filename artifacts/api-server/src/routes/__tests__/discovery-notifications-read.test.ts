/**
 * Route tests for POST /api/discovery/notifications/read
 * (routes/discovery) — the mark-read rail behind both bells.
 *
 * THE DEFECT CONTEXT (stack29): the header bell never sent per-item
 * reads, so this endpoint's { ids } branch was exercised only by the
 * World bell. These pins lock the rail contract the fixed header
 * bell now rides:
 *   { ids: [one] }  → exactly that notification flips; the unread
 *                     count drops by one; other rows — including
 *                     another user's — are untouched.
 *   {} / { ids: [] } → every unread notification of the CALLER
 *                     flips (mark-all); other users untouched.
 *
 * Fake-db style mirrors discovery-notifications-dto.test.ts, extended:
 * db.execute flattens the drizzle SQL template to text and emulates
 * the two UPDATE shapes the handler emits (id-scoped `id = ANY(...)`
 * vs the blanket caller-scoped update), plus the GET COUNT query.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const OTHER_ID = "00000000-0000-4000-8000-000000000077";
const NOTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOTE_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  state: {
    notifications: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

/** Flatten a drizzle sql`` template (StringChunks + sql.raw literals)
 *  to plain text so the fake can tell the handler's two UPDATE
 *  shapes apart and lift the id list out of the ARRAY[...] literal. */
function flattenSql(q: unknown): string {
  if (q == null) return "";
  if (typeof q === "string") return q;
  if (Array.isArray(q)) return q.map(flattenSql).join("");
  if (typeof q === "object") {
    const o = q as { queryChunks?: unknown; value?: unknown };
    if (Array.isArray(o.queryChunks)) return o.queryChunks.map(flattenSql).join("");
    if (o.value !== undefined) return flattenSql(o.value);
    return "";
  }
  return "";
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { notificationsTable } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === notificationsTable) {
      return state.notifications.filter((n) => n["userId"] === VIEWER_ID);
    }
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
      const text = flattenSql(q);
      if (text.includes("COUNT(*)")) {
        return {
          rows: [{ n: state.notifications.filter((n) => n["userId"] === VIEWER_ID && n["isRead"] === false).length }],
        };
      }
      if (text.includes("UPDATE notifications")) {
        if (text.includes("id = ANY")) {
          const ids = [...text.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map((m) => m[1]);
          for (const row of state.notifications) {
            if (row["userId"] === VIEWER_ID && ids.includes(row["id"] as string)) row["isRead"] = true;
          }
        } else {
          for (const row of state.notifications) {
            if (row["userId"] === VIEWER_ID) row["isRead"] = true;
          }
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../discovery";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/discovery", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discovery`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const note = (id: string, userId: string, isRead: boolean, day: string) => ({
  id,
  userId,
  kind: "follow",
  title: `Note ${id.slice(0, 1)}`,
  body: "",
  link: "/artist/some-creator",
  isRead,
  createdAt: new Date(day),
});

beforeEach(() => {
  // Newest first, as the rail serves them: B (unread), A (unread),
  // C (already read) for the viewer; D unread for ANOTHER user.
  h.state.notifications = [
    note(NOTE_B, VIEWER_ID, false, "2026-10-15T09:00:00.000Z"),
    note(NOTE_A, VIEWER_ID, false, "2026-10-14T16:30:00.000Z"),
    note(NOTE_C, VIEWER_ID, true, "2026-10-13T09:00:00.000Z"),
    note(NOTE_D, OTHER_ID, false, "2026-10-15T10:00:00.000Z"),
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function postRead(body: unknown) {
  const r = await realFetch(`${baseUrl}/notifications/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /api/discovery/notifications/read — per-item and mark-all contract", () => {
  it("marks exactly the opened notification read; the unread count drops by one", async () => {
    const before = await get("/notifications");
    expect(before.json.unread).toBe(2);

    const res = await postRead({ ids: [NOTE_A] });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);

    const after = await get("/notifications");
    expect(after.json.unread).toBe(1);
    const byId = Object.fromEntries(after.json.items.map((i: any) => [i.id, i.is_read]));
    expect(byId[NOTE_A]).toBe(true);
    expect(byId[NOTE_B]).toBe(false);
    expect(byId[NOTE_C]).toBe(true);
  });

  it("an unknown id is a harmless no-op — nothing flips, nothing errors", async () => {
    const res = await postRead({ ids: [UNKNOWN_ID] });
    expect(res.status).toBe(200);

    const after = await get("/notifications");
    expect(after.json.unread).toBe(2);
  });

  it("with no ids it marks ALL of the caller's notifications read (mark-all)", async () => {
    const res = await postRead({});
    expect(res.status).toBe(200);

    const after = await get("/notifications");
    expect(after.json.unread).toBe(0);
    expect(after.json.items.every((i: any) => i.is_read)).toBe(true);
  });

  it("an empty ids list behaves as mark-all — the rail's documented contract", async () => {
    const res = await postRead({ ids: [] });
    expect(res.status).toBe(200);

    const after = await get("/notifications");
    expect(after.json.unread).toBe(0);
  });

  it("never touches another user's notifications, on either branch", async () => {
    await postRead({ ids: [NOTE_A] });
    await postRead({});

    const other = h.state.notifications.find((n) => n["id"] === NOTE_D);
    expect(other?.["isRead"]).toBe(false);
  });
});
