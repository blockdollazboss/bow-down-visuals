/**
 * Route tests for GET /api/discovery/notifications (routes/discovery).
 *
 * THE REGRESSION: the handler returned db.select() rows unshaped, so
 * items carried the camelCase table keys (isRead, createdAt) while the
 * frontend NotificationsBell contract is snake_case (is_read,
 * created_at). Every notification therefore rendered permanently
 * "unread" (n.is_read always undefined) and its timestamp parsed to
 * NaN — the bell's timeAgo showed "NaNd". The handler now maps items
 * field-by-field to the declared NotificationItem shape.
 *
 * Fake-db style mirrors routes/__tests__/creator-profile-public.test.ts:
 * real table objects via importOriginal, a chainable select whose rows
 * dispatch on table identity, and db.execute answered for the unread
 * COUNT query.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const NOTE_ID = "44444444-4444-4444-8444-444444444444";
const CREATED = new Date("2026-10-14T16:30:00.000Z");

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

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { notificationsTable } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === notificationsTable) return state.notifications;
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
    execute: async (_q: unknown) => ({
      rows: [{ n: state.notifications.filter((n) => n["isRead"] === false).length }],
    }),
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

beforeEach(() => {
  h.state.notifications = [
    {
      id: NOTE_ID,
      userId: VIEWER_ID,
      kind: "follow",
      title: "New follower 💬",
      body: "Some Creator followed you",
      link: "/artist/some-creator",
      isRead: false,
      createdAt: CREATED,
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      userId: VIEWER_ID,
      kind: "release",
      title: "New release",
      body: "",
      link: "",
      isRead: true,
      createdAt: new Date("2026-10-13T09:00:00.000Z"),
    },
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/discovery/notifications — item DTO contract", () => {
  it("ships is_read + created_at (snake_case) so the bell can render read state and time", async () => {
    const { status, json } = await get("/notifications");

    expect(status).toBe(200);
    expect(json.unread).toBe(1);
    expect(json.items).toHaveLength(2);

    const first = json.items[0];
    expect(first.id).toBe(NOTE_ID);
    expect(first.kind).toBe("follow");
    expect(first.title).toBe("New follower 💬");
    expect(first.body).toBe("Some Creator followed you");
    expect(first.link).toBe("/artist/some-creator");
    // The regression pins: read flag + parseable timestamp.
    expect(first.is_read).toBe(false);
    expect(first.created_at).toBe("2026-10-14T16:30:00.000Z");
    expect(Number.isNaN(new Date(first.created_at).getTime())).toBe(false);
    expect(json.items[1].is_read).toBe(true);

    // The camelCase table keys must NOT leak through the DTO.
    expect(first).not.toHaveProperty("isRead");
    expect(first).not.toHaveProperty("createdAt");
    expect(first).not.toHaveProperty("userId");
  });
});
