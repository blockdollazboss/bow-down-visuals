/**
 * Route tests for DM attachments (World Ring 2, item 2.17) + the
 * comment-replies price meta (item 2.19's honest-price rail).
 *
 * The REAL community router (and the real comment-replies router for
 * its meta) run over an ephemeral server against a cond-aware fake
 * db, in the house style of social-notification-links.test.ts.
 * Storage + mirroring are mocked at the lib seam: uploads record the
 * object name they were handed, the mirror records its calls, and
 * URL refreshing is a visible prefix so tests can prove reads mint
 * fresh URLs from the stored permanent ref.
 *
 * Pins:
 *  - upload lands under the sender's own dm/<userId>/ prefix via the
 *    permanent-storage pipeline, typed + titled;
 *  - send accepts the sender's own ref, an attachment with no words,
 *    and an external URL (mirrored at send); it refuses someone
 *    else's upload, a bad type, an empty send, non-participants,
 *    blocked threads and unanswered requests;
 *  - thread fetch returns the attachment titled, typed, and with a
 *    freshly-minted URL; the conversation preview names the work;
 *  - GET /comment-replies/meta reports the exact price the POST
 *    charges (100 VB default), from the server.
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
const CONV_BLOCKED_ID = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  state: {
    conversations: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    uploads: [] as Array<{ objectName: string; contentType: string }>,
    mirrors: [] as Array<{ url: unknown; kind: string; ownerKey: string }>,
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
  uploadMediaToSupabaseStorage: async (objectName: string, _buf: Buffer, contentType: string) => {
    h.state.uploads.push({ objectName, contentType });
    return `r2://generated-clips/${objectName}`;
  },
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? `https://signed.example/${v}`
      : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown, opts: { kind: string; ownerKey: string }) => {
    h.state.mirrors.push({ url: v, kind: opts.kind, ownerKey: opts.ownerKey });
    return `r2://generated-clips/mirrored/${opts.ownerKey}/beat.mp3`;
  },
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
  const { conversationsTable, messagesTable } = actual;

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
    delete: (_table: unknown) => ({ where: (_cond: unknown) => thenable({ returning: async () => [] }) }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import communityRouter from "../community";
import commentRepliesRouter from "../generate/comment-replies";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", communityRouter);
  app.use("/api", commentRepliesRouter);
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
    convRow(CONV_BLOCKED_ID, "blocked", OTHER),
  ];
  s.messages = [];
  s.uploads = [];
  s.mirrors = [];
  s.seq = 0;
});

async function send(convId: string, body: unknown, userId: string = ME) {
  const r = await realFetch(`${baseUrl}/dm/${convId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /dm/attachments/upload — the parcel window", () => {
  it("stores the sender's file in permanent storage under their own prefix", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }), "my-beat.mp3");
    const r = await realFetch(`${baseUrl}/dm/attachments/upload`, {
      method: "POST", headers: { "x-user-id": ME }, body: form,
    });
    const json = (await r.json()) as any;
    expect(r.status).toBe(201);
    expect(json.type).toBe("audio");
    expect(json.name).toBe("my-beat.mp3");
    expect(json.ref).toContain(`/dm/${ME}/audio/`);
    expect(json.url).toContain("https://signed.example/");
    expect(h.state.uploads).toHaveLength(1);
    expect(h.state.uploads[0]!.objectName).toMatch(new RegExp(`^dm/${ME}/audio/`));
  });

  it("rejects a non-media file", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
    const r = await realFetch(`${baseUrl}/dm/attachments/upload`, {
      method: "POST", headers: { "x-user-id": ME }, body: form,
    });
    expect(r.status).toBe(400);
    expect(h.state.uploads).toHaveLength(0);
  });

  it("rejects guests — the desk is members-only", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1])], { type: "audio/mpeg" }), "b.mp3");
    const r = await realFetch(`${baseUrl}/dm/attachments/upload`, {
      method: "POST", headers: { "x-anon": "1" }, body: form,
    });
    expect(r.status).toBe(401);
  });
});

describe("POST /dm/:id/send with an attachment", () => {
  const ownRef = `r2://generated-clips/dm/${ME}/audio/beat.mp3`;

  it("sends words + work together, storing the permanent ref", async () => {
    const { status, json } = await send(CONV_ID, {
      body: "cooked this for you",
      attachment: { url: ownRef, type: "audio", name: "beat.mp3" },
    });
    expect(status).toBe(201);
    expect(json.message.attachment_type).toBe("audio");
    expect(json.message.attachment_name).toBe("beat.mp3");
    /* The response URL is freshly minted; the ROW keeps the ref. */
    expect(json.message.attachment_url).toBe(`https://signed.example/${ownRef}`);
    expect(h.state.messages[0]!["attachmentUrl"]).toBe(ownRef);
  });

  it("sends work with no words at all", async () => {
    const { status } = await send(CONV_ID, {
      attachment: { url: ownRef, type: "audio", name: "beat.mp3" },
    });
    expect(status).toBe(201);
    expect(h.state.messages[0]!["body"]).toBe("");
  });

  it("still sends plain text (the v1 rail, unchanged)", async () => {
    const { status, json } = await send(CONV_ID, { body: "just words" });
    expect(status).toBe(201);
    expect(json.message.body).toBe("just words");
    expect(json.message.attachment_url).toBeNull();
  });

  it("refuses someone else's upload — sender ownership is enforced", async () => {
    const { status, json } = await send(CONV_ID, {
      attachment: { url: `r2://generated-clips/dm/${OTHER}/audio/stolen.mp3`, type: "audio", name: "stolen.mp3" },
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/your own uploads/i);
    expect(h.state.messages).toHaveLength(0);
  });

  it("mirrors an external URL into permanent storage at send time", async () => {
    const { status } = await send(CONV_ID, {
      body: "my cover",
      attachment: { url: "https://example.com/cover.jpg", type: "image", name: "cover.jpg" },
    });
    expect(status).toBe(201);
    expect(h.state.mirrors).toEqual([{ url: "https://example.com/cover.jpg", kind: "image", ownerKey: ME }]);
    expect(h.state.messages[0]!["attachmentUrl"]).toBe(`r2://generated-clips/mirrored/${ME}/beat.mp3`);
  });

  it("rejects a bad attachment type and an empty send", async () => {
    const bad = await send(CONV_ID, { attachment: { url: ownRef, type: "document", name: "x.pdf" } });
    expect(bad.status).toBe(400);
    const empty = await send(CONV_ID, { body: "   " });
    expect(empty.status).toBe(400);
    expect(h.state.messages).toHaveLength(0);
  });

  it("forbids non-participants, blocked threads, and unanswered requests", async () => {
    const att = { attachment: { url: ownRef, type: "audio", name: "beat.mp3" } };
    expect((await send(CONV_ID, att, THIRD)).status).toBe(403);
    expect((await send(CONV_BLOCKED_ID, att)).status).toBe(403);
    expect((await send(CONV_REQUEST_ID, att)).status).toBe(403);
    expect(h.state.messages).toHaveLength(0);
  });
});

describe("GET /dm/:id/messages + conversation preview", () => {
  it("returns the attachment titled + typed with a fresh URL, and the preview names the work", async () => {
    const ownRef = `r2://generated-clips/dm/${ME}/video/clip.mp4`;
    await send(CONV_ID, { attachment: { url: ownRef, type: "video", name: "clip.mp4" } });

    const r = await realFetch(`${baseUrl}/dm/${CONV_ID}/messages`, { headers: { "x-user-id": ME } });
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].attachment_url).toBe(`https://signed.example/${ownRef}`);
    expect(json.messages[0].attachment_type).toBe("video");
    expect(json.messages[0].attachment_name).toBe("clip.mp4");

    const list = await realFetch(`${baseUrl}/dm/conversations`, { headers: { "x-user-id": ME } });
    const listJson = (await list.json()) as any;
    const inboxRow = listJson.inbox.find((c: any) => c.id === CONV_ID);
    expect(inboxRow.last_message.attachment_type).toBe("video");
    expect(inboxRow.last_message.attachment_name).toBe("clip.mp4");
  });
});

describe("GET /comment-replies/meta — the drafting price, from the server", () => {
  it("reports the exact charge the POST makes", async () => {
    const r = await realFetch(`${baseUrl}/comment-replies/meta`, { headers: { "x-user-id": ME } });
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.cost).toBe(100);
    expect(json.tones).toEqual(["hype", "grateful", "playful", "professional"]);
    expect(json.maxComments).toBe(10);
  });
});
