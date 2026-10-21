/**
 * Route tests for DM reply drafts (STACK-20 item #15 — the
 * persistence half of UPGRADE-PROGRAM 2.19).
 *
 * The REAL community router runs over an ephemeral server against a
 * cond-aware fake db, in the house style of dm-attachments.test.ts.
 * The fake implements the drafts table honestly (upsert on the
 * (conversation, author) pair + real deletes), so the pins below are
 * about the HANDLER's behavior, not the fake's.
 *
 * Pins:
 *  - a draft saves, reads back verbatim, and a second save replaces
 *    it — still ONE row per member per thread;
 *  - saving an empty/whitespace body clears; DELETE clears (and is
 *    a calm no-op when nothing is saved);
 *  - the draft is private scratch: the other participant reads only
 *    their OWN (empty) slot and their save never touches mine;
 *    a non-participant gets 403 on read/save/clear and changes
 *    nothing; guests get 401; unknown conversations get 404;
 *  - the composer's 2,000-char cap is enforced (2,000 ok, 2,001 no);
 *  - a landed send retires the SENDER's draft and only the sender's —
 *    the other participant's saved words survive my send;
 *  - a request thread's recipient can hold a draft too (the gate is
 *    participation, not send permission).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const CONV_ID = "44444444-4444-4444-8444-444444444444";
const CONV_REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const CONV_UNKNOWN_ID = "77777777-7777-4777-8777-777777777777";

const h = vi.hoisted(() => ({
  state: {
    conversations: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    drafts: [] as Array<Record<string, unknown>>,
    seq: 0,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers["x-anon"]) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = req.headers["x-user-id"] ?? ME;
    req.userCredits = 1000;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `r2://generated-clips/${objectName}`,
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async () => null,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: async () => 900,
  refundCredits: async () => undefined,
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => { throw new Error("no AI in route tests"); },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { conversationsTable, messagesTable, dmDraftsTable } = actual;

  function nextId(): string {
    state.seq += 1;
    return `99999999-9999-4999-8999-${String(state.seq).padStart(12, "0")}`;
  }

  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    if (table === conversationsTable) {
      if (cond === undefined || cond === null) return state.conversations;
      const { params } = render(cond);
      const byId = state.conversations.filter((c) => params.some((x) => String(x) === String(c["id"])));
      if (byId.length > 0) return byId;
      return state.conversations.filter(
        (c) => String(c["participantA"]) === String(params[0]) || String(c["participantB"]) === String(params[0]),
      );
    }
    if (table === messagesTable) {
      if (cond === undefined || cond === null) return state.messages;
      const { params } = render(cond);
      return state.messages.filter((m) => params.some((x) => String(x) === String(m["conversationId"])));
    }
    if (table === dmDraftsTable) {
      if (cond === undefined || cond === null) return state.drafts;
      const { params } = render(cond);
      /* Draft reads are and(eq(conversationId), eq(userId)) — params
         arrive in that order; both must match the row. */
      return state.drafts.filter(
        (d) => String(d["conversationId"]) === String(params[0]) && String(d["userId"]) === String(params[1]),
      );
    }
    return [];
  }

  function chain(table: unknown): any {
    let cond: unknown;
    const c: any = {
      where: (w: unknown) => { cond = w; return c; },
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table, cond).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return c;
  }

  function thenable(extra: Record<string, unknown> = {}): any {
    return { ...extra, then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === dmDraftsTable) {
          /* Upsert on (conversationId, userId): insert when the pair
             is new, apply the conflict set when it already exists. */
          const settle = (set?: Record<string, unknown>) => {
            const existing = state.drafts.find(
              (d) => d["conversationId"] === v["conversationId"] && d["userId"] === v["userId"],
            );
            if (existing) {
              if (set) Object.assign(existing, set);
              return existing;
            }
            const full = { id: nextId(), ...v };
            state.drafts.push(full);
            return full;
          };
          return {
            returning: async () => [settle()],
            onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => ({
              returning: async () => [settle(cfg.set)],
            }),
          };
        }
        const full = {
          id: nextId(), isRead: false, createdAt: new Date(),
          attachmentUrl: null, attachmentType: null, attachmentName: null, ...v,
        };
        if (table === messagesTable) state.messages.push(full);
        if (table === conversationsTable) state.conversations.push(full);
        return thenable({ returning: async () => [full] });
      },
    }),
    update: (_table: unknown) => ({
      set: (_patch: unknown) => ({ where: (_cond: unknown) => thenable({ returning: async () => [] }) }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        if (table === dmDraftsTable && cond !== undefined && cond !== null) {
          const { params } = render(cond);
          state.drafts = state.drafts.filter(
            (d) => !(String(d["conversationId"]) === String(params[0]) && String(d["userId"]) === String(params[1])),
          );
        }
        return thenable({ returning: async () => [] });
      },
    }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import communityRouter from "../community";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", communityRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function convRow(id: string, status: string, requestedBy: string): Record<string, unknown> {
  return {
    id, participantA: ME, participantB: OTHER, status, requestedBy,
    lastMessageAt: new Date(), createdAt: new Date(),
  };
}

beforeEach(() => {
  const s = h.state;
  s.conversations = [
    convRow(CONV_ID, "inbox", OTHER),
    convRow(CONV_REQUEST_ID, "request", OTHER),
  ];
  s.messages = [];
  s.drafts = [];
  s.seq = 0;
});

async function draftReq(
  method: "GET" | "PUT" | "DELETE",
  convId: string,
  opts: { userId?: string; anon?: boolean; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.anon) headers["x-anon"] = "1";
  else headers["x-user-id"] = opts.userId ?? ME;
  const r = await realFetch(`${baseUrl}/dm/${convId}/draft`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("GET/PUT /dm/:id/draft — save and restore", () => {
  it("starts empty: no draft reads as null, not an error", async () => {
    const { status, json } = await draftReq("GET", CONV_ID);
    expect(status).toBe(200);
    expect(json.draft).toBeNull();
  });

  it("saves a draft and reads it back verbatim, spacing and all", async () => {
    const put = await draftReq("PUT", CONV_ID, { body: { body: "  half a thought…  " } });
    expect(put.status).toBe(200);
    expect(put.json.draft.body).toBe("  half a thought…  ");
    expect(typeof put.json.draft.updated_at).toBe("string");

    const get = await draftReq("GET", CONV_ID);
    expect(get.status).toBe(200);
    expect(get.json.draft.body).toBe("  half a thought…  ");
  });

  it("a second save replaces the first — still one row for the pair", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "first take" } });
    const put = await draftReq("PUT", CONV_ID, { body: { body: "second take" } });
    expect(put.status).toBe(200);
    expect(put.json.draft.body).toBe("second take");
    expect(h.state.drafts).toHaveLength(1);

    const get = await draftReq("GET", CONV_ID);
    expect(get.json.draft.body).toBe("second take");
  });

  it("the composer's 2,000-char cap is the draft cap too", async () => {
    const ok = await draftReq("PUT", CONV_ID, { body: { body: "x".repeat(2000) } });
    expect(ok.status).toBe(200);
    const tooLong = await draftReq("PUT", CONV_ID, { body: { body: "x".repeat(2001) } });
    expect(tooLong.status).toBe(400);
    /* The refused save changed nothing — the good draft still stands. */
    const get = await draftReq("GET", CONV_ID);
    expect(get.json.draft.body).toHaveLength(2000);
  });
});

describe("clearing — blank save, explicit delete", () => {
  it("saving an empty body clears the saved draft", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "words" } });
    const put = await draftReq("PUT", CONV_ID, { body: { body: "" } });
    expect(put.status).toBe(200);
    expect(put.json.draft).toBeNull();
    expect(h.state.drafts).toHaveLength(0);
    expect((await draftReq("GET", CONV_ID)).json.draft).toBeNull();
  });

  it("saving all-whitespace clears too — blanks never resurrect", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "words" } });
    await draftReq("PUT", CONV_ID, { body: { body: "   " } });
    expect(h.state.drafts).toHaveLength(0);
  });

  it("DELETE clears, and clearing nothing is a calm 200", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "words" } });
    const del = await draftReq("DELETE", CONV_ID);
    expect(del.status).toBe(200);
    expect(del.json.ok).toBe(true);
    expect((await draftReq("GET", CONV_ID)).json.draft).toBeNull();

    const again = await draftReq("DELETE", CONV_ID);
    expect(again.status).toBe(200);
  });
});

describe("privacy — a draft is the author's own scratch", () => {
  it("the other participant reads only their own empty slot, never my words", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "my private draft" } });
    const otherGet = await draftReq("GET", CONV_ID, { userId: OTHER });
    expect(otherGet.status).toBe(200);
    expect(otherGet.json.draft).toBeNull();
  });

  it("the other participant's save never overwrites mine — two rows, two authors", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "mine" } });
    await draftReq("PUT", CONV_ID, { userId: OTHER, body: { body: "theirs" } });
    expect(h.state.drafts).toHaveLength(2);
    expect((await draftReq("GET", CONV_ID)).json.draft.body).toBe("mine");
    expect((await draftReq("GET", CONV_ID, { userId: OTHER })).json.draft.body).toBe("theirs");

    /* Their clear removes only their row. */
    await draftReq("DELETE", CONV_ID, { userId: OTHER });
    expect(h.state.drafts).toHaveLength(1);
    expect((await draftReq("GET", CONV_ID)).json.draft.body).toBe("mine");
  });

  it("a non-participant is refused on read, save and clear — and changes nothing", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "mine" } });
    expect((await draftReq("GET", CONV_ID, { userId: THIRD })).status).toBe(403);
    expect((await draftReq("PUT", CONV_ID, { userId: THIRD, body: { body: "intrusion" } })).status).toBe(403);
    expect((await draftReq("DELETE", CONV_ID, { userId: THIRD })).status).toBe(403);
    expect(h.state.drafts).toHaveLength(1);
    expect((await draftReq("GET", CONV_ID)).json.draft.body).toBe("mine");
  });

  it("guests are refused outright — the desk is members-only", async () => {
    expect((await draftReq("GET", CONV_ID, { anon: true })).status).toBe(401);
    expect((await draftReq("PUT", CONV_ID, { anon: true, body: { body: "x" } })).status).toBe(401);
    expect((await draftReq("DELETE", CONV_ID, { anon: true })).status).toBe(401);
    expect(h.state.drafts).toHaveLength(0);
  });

  it("an unknown conversation is a 404 on every verb", async () => {
    expect((await draftReq("GET", CONV_UNKNOWN_ID)).status).toBe(404);
    expect((await draftReq("PUT", CONV_UNKNOWN_ID, { body: { body: "x" } })).status).toBe(404);
    expect((await draftReq("DELETE", CONV_UNKNOWN_ID)).status).toBe(404);
  });

  it("a request thread's recipient can hold a draft before answering", async () => {
    const put = await draftReq("PUT", CONV_REQUEST_ID, { body: { body: "thinking it over" } });
    expect(put.status).toBe(200);
    expect((await draftReq("GET", CONV_REQUEST_ID)).json.draft.body).toBe("thinking it over");
  });
});

describe("send retires the sender's draft", () => {
  async function send(convId: string, body: unknown, userId: string = ME) {
    const r = await realFetch(`${baseUrl}/dm/${convId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  }

  it("a landed send clears my draft — and only mine", async () => {
    await draftReq("PUT", CONV_ID, { body: { body: "my half-written reply" } });
    await draftReq("PUT", CONV_ID, { userId: OTHER, body: { body: "their half-written reply" } });

    const sent = await send(CONV_ID, { body: "my half-written reply" });
    expect(sent.status).toBe(201);

    expect((await draftReq("GET", CONV_ID)).json.draft).toBeNull();
    expect((await draftReq("GET", CONV_ID, { userId: OTHER })).json.draft.body)
      .toBe("their half-written reply");
    expect(h.state.drafts).toHaveLength(1);
  });

  it("a refused send keeps the draft — the words weren't delivered", async () => {
    await draftReq("PUT", CONV_REQUEST_ID, { body: { body: "not yet" } });
    /* ME didn't start this request and hasn't accepted — send is 403. */
    const sent = await send(CONV_REQUEST_ID, { body: "not yet" });
    expect(sent.status).toBe(403);
    expect((await draftReq("GET", CONV_REQUEST_ID)).json.draft.body).toBe("not yet");
  });
});
