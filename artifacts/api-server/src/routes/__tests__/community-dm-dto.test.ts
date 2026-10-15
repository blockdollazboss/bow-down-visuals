/**
 * Route tests for the DM message DTO contract (routes/community).
 *
 * THE REGRESSION: GET /dm/:id/messages sent the raw Drizzle message
 * rows — camelCase createdAt — while the frontend thread view
 * (pages/messages.tsx, `interface Msg { … created_at: string }`) reads
 * created_at for timeAgo(). created_at was undefined, so every DM
 * timestamp rendered blank (""). toMessageDto now builds the payload
 * field-by-field at the API boundary, like toGroupDto/toEventDto in
 * the same file.
 *
 * Fake-db style mirrors community-groups-dto.test.ts: real table
 * objects via importOriginal, a chainable select whose rows dispatch
 * on table identity.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "33333333-3333-4333-8333-333333333333";
const CREATED = new Date("2026-10-01T12:34:56.000Z");

const h = vi.hoisted(() => ({
  state: {
    conversations: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = ME;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { conversationsTable, messagesTable } = actual;

  function rowsFor(table: unknown): Array<Record<string, unknown>> {
    if (table === conversationsTable) return state.conversations;
    if (table === messagesTable) return state.messages;
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
    select: (_fields?: Record<string, unknown>) => ({
      from: (table: unknown) => chain(table),
    }),
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(),
      }),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../community";

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
  h.state.conversations = [
    { id: CONV_ID, participantA: ME, participantB: OTHER, status: "inbox", requestedBy: ME, lastMessageAt: CREATED },
  ];
  h.state.messages = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      conversationId: CONV_ID,
      senderUserId: OTHER,
      body: "see you at the show",
      isRead: false,
      createdAt: CREATED,
    },
  ];
});

describe("GET /api/dm/:id/messages — message DTO contract", () => {
  it("ships created_at (snake_case) so the client's timeAgo renders", async () => {
    const r = await realFetch(`${baseUrl}/dm/${CONV_ID}/messages`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as any;
    expect(json.messages).toHaveLength(1);
    const msg = json.messages[0];
    // The regression pin: the client reads created_at.
    expect(msg.created_at).toBe("2026-10-01T12:34:56.000Z");
    // The rest of the thread-view contract rides along.
    expect(msg.id).toBe("44444444-4444-4444-8444-444444444444");
    expect(msg.body).toBe("see you at the show");
    expect(msg.senderUserId).toBe(OTHER);
    expect(msg.sender_user_id).toBe(OTHER);
    expect(msg.conversation_id).toBe(CONV_ID);
    expect(msg.is_read).toBe(false);
    // The raw camelCase timestamp key must not be the only timestamp.
    expect(msg).not.toHaveProperty("createdAt");
  });
});
