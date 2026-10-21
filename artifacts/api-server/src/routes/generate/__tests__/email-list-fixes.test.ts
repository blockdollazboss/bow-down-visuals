/**
 * Email list fix batch (Oct 20) — the three staging defects, driven
 * against the REAL router with a fake db:
 *
 * 1. "Invalid list." on real copy. PROVEN root cause (schema-level,
 *    pre-fix): the em-dash name parsed FINE — the sole failure was
 *    `description` capped at 500 chars while the house list's real
 *    offer copy is 649. The cap is now 2,000 (offer-length with
 *    headroom, still an abuse bound); welcome bodies 5,000 → 20,000.
 * 2. Welcome templates had no confirmed write path. The PATCH route
 *    (owner-scoped) is exercised here end-to-end for all six fields.
 * 3. Delete: the API half is exercised here (own list deletes, another
 *    user's 404s). The dead button was a UI defect — the page relied
 *    on the native confirm() dialog (auto-suppressed in some browser
 *    contexts, and the call sat OUTSIDE the try/catch, so a suppressed
 *    or thrown dialog failed with no visible error). The page now uses
 *    an inline confirm; a source contract below pins that.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { insertEmailListSchema } from "@workspace/db";

const h = vi.hoisted(() => ({
  lists: [] as Array<Record<string, any>>,
  subscribers: [] as Array<Record<string, any>>,
  campaigns: [] as Array<Record<string, any>>,
  userId: "",
}));

/** The house list's REAL offer copy — the exact class of text staging
 *  rejected. 649 chars, em dashes, apostrophe, emoji bullets. */
const FULL_OFFER =
  "Bow Down Visuals is The Content Creation Cheat Code — one AI studio where creators make the thumbnails, hooks, promo clips, and captions that get their work clicked, watched, and paid. Join the launch list and we'll hand you the Free Starter Pack today: 10 thumbnail templates + 10 scroll-stopping hooks you can steal and post this week.\n\n" +
  "🎁 The Free Starter Pack, right now — delivered to your inbox the second you join.\n" +
  "👑 Founding perks on launch day — first in the door on January 1, 2027.\n" +
  "🪙 First shot at the launch-day Visual Bucs drop.\n" +
  "📩 The weekly drop — new templates, creator challenges, and rewards. No spam, no selling your data. Ever.";

/* ── fake db: select/insert/update/delete over in-memory rows ──────── */

function collectEq(node: any, out: Record<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  const chunks: any[] = Array.isArray(node.queryChunks) ? node.queryChunks : [];
  let pendingCol: string | null = null;
  for (const ch of chunks) {
    if (ch && typeof ch === "object") {
      if (typeof ch.name === "string" && ch.table) { pendingCol = ch.name; continue; }
      if (ch.constructor?.name === "Param" && pendingCol) { out[pendingCol] = ch.value; pendingCol = null; continue; }
      if (Array.isArray(ch.queryChunks)) collectEq(ch, out);
      if (Array.isArray(ch.value)) for (const v of ch.value) collectEq(v, out);
    }
  }
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
function matches(row: Record<string, any>, cond: any): boolean {
  if (!cond) return true;
  const eqs: Record<string, unknown> = {};
  collectEq(cond, eqs);
  return Object.entries(eqs).every(([k, v]) => String(row[camel(k)] ?? row[k]) === String(v));
}
function tableRows(table: any): Array<Record<string, any>> {
  const g = globalThis as any;
  if (table === g.__emailListsTable) return h.lists;
  if (table === g.__emailCampaignsTable) return h.campaigns;
  return h.subscribers;
}
function fakeDb() {
  return {
    select: (fields?: Record<string, any>) => ({
      from: (table: any) => {
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = tableRows(table).filter((r) => matches(r, cond));
          if (lim !== null) rows = rows.slice(0, lim);
          if (fields) rows = rows.map((r) => Object.fromEntries(Object.keys(fields).map((k) => [k, r[k]])));
          return rows;
        };
        const chain: any = {
          where: (c: any) => { cond = c; return chain; },
          orderBy: (..._a: any[]) => chain,
          limit: async (n: number) => { lim = n; return run(); },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = { id: randomUUID(), createdAt: new Date(), ...v };
          tableRows(table).push(row);
          return [row];
        },
      }),
    }),
    update: (table: any) => ({
      set: (v: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            const hit = tableRows(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, v);
            return hit;
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: (cond: any) => ({
        returning: async (_fields?: any) => {
          const rows = tableRows(table);
          const hit = rows.filter((r) => matches(r, cond));
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          return hit.map((r) => ({ id: r.id }));
        },
      }),
    }),
  };
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = h.userId; req.userCredits = 100000; next(); },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  (globalThis as any).__emailListsTable = actual.emailListsTable;
  (globalThis as any).__emailCampaignsTable = actual.emailCampaignsTable;
  return { ...actual, db: fakeDb() };
});

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => { throw new Error("no ai in email-list-fixes tests"); }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));
vi.mock("../../../lib/rate-limit", () => ({ publicApiLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../lib/logger", () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));
vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 100000),
  refundCredits: vi.fn(async () => 100000),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));
vi.mock("../../../lib/payment-record", () => ({ recordCreditUsage: vi.fn(async () => {}) }));

import emailListRouter from "../email-list";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const OTHER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use(emailListRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  h.userId = USER;
  h.lists = [];
  h.subscribers = [];
  h.campaigns = [];
});

async function post(pathname: string, body: unknown, method = "POST") {
  const r = await realFetch(`${baseUrl}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as any };
}

/* ── 1. validation: the copy that failed on staging now passes ─────── */

describe("list create validation — real copy passes, junk still fails", () => {
  const create = insertEmailListSchema.omit({ userId: true });

  it("accepts the em-dash display name that staging rejected", () => {
    const r = create.safeParse({ name: "Bow Down Visuals — Launch List", handle: "bowdownvisuals", description: "The cheat code drops January 1. Get on the list." });
    expect(r.success).toBe(true);
  });

  it("accepts apostrophes, curly quotes and emoji in the name", () => {
    const r = create.safeParse({ name: "Thy's “Fin Fam” 🦈 — Vol. 2", handle: "fin-fam" });
    expect(r.success).toBe(true);
  });

  it("accepts the full real offer copy as the description (649 chars)", () => {
    expect(FULL_OFFER.length).toBeGreaterThan(500);
    const r = create.safeParse({ name: "Bow Down Visuals — Launch List", handle: "bowdownvisuals", description: FULL_OFFER });
    expect(r.success).toBe(true);
  });

  it("still rejects abuse-length descriptions, empty names, and bad handles", () => {
    expect(create.safeParse({ name: "X", handle: "ok-handle", description: "a".repeat(2001) }).success).toBe(false);
    expect(create.safeParse({ name: "", handle: "ok-handle" }).success).toBe(false);
    expect(create.safeParse({ name: "n".repeat(121), handle: "ok-handle" }).success).toBe(false);
    expect(create.safeParse({ name: "Ok", handle: "Bad Handle!" }).success).toBe(false);
    expect(create.safeParse({ name: "Ok", handle: "UPPER" }).success).toBe(false);
  });

  it("POST /lists stores the em-dash name + full offer verbatim (201)", async () => {
    const r = await post("/email-list/lists", { name: "Bow Down Visuals — Launch List", handle: "bowdownvisuals", description: FULL_OFFER });
    expect(r.status).toBe(201);
    expect(r.json.list.name).toBe("Bow Down Visuals — Launch List");
    expect(r.json.list.description).toBe(FULL_OFFER);
  });

  it("POST /lists with a 2001-char description is still a 400", async () => {
    const r = await post("/email-list/lists", { name: "Ok", handle: "ok-handle", description: "a".repeat(2001) });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("Invalid list.");
  });
});

/* ── 2. welcome templates: the PATCH write path, owner-only ────────── */

describe("PATCH /lists/:id — welcome sequence templates", () => {
  const WELCOME = {
    welcomeSubject: "Your free Starter Pack is here 🦈",
    welcomeBody: "Yo — welcome to the cheat code.\n\nYour Free Starter Pack is here.",
    welcome2Subject: "Why a shark runs a creator studio",
    welcome2Body: "Quick story.\n\nBow Down Visuals was built by a creator.",
    welcome3Subject: "Get paid in credits for sharing one link",
    welcome3Body: "Here's the deal nobody else gives you.",
  };

  async function seedList(owner: string) {
    h.userId = owner;
    const r = await post("/email-list/lists", { name: "Seed", handle: `seed-${owner.slice(0, 8)}` });
    expect(r.status).toBe(201);
    return r.json.list.id as string;
  }

  it("sets all six welcome fields on the owner's own list", async () => {
    const id = await seedList(USER);
    const r = await post(`/email-list/lists/${id}`, WELCOME, "PATCH");
    expect(r.status).toBe(200);
    for (const [k, v] of Object.entries(WELCOME)) expect(r.json.list[k]).toBe(v);
    expect(h.lists.find((l) => l.id === id)).toMatchObject(WELCOME);
  });

  it("404s for another user's list and writes nothing", async () => {
    const id = await seedList(USER);
    h.userId = OTHER;
    const r = await post(`/email-list/lists/${id}`, WELCOME, "PATCH");
    expect(r.status).toBe(404);
    expect(h.lists.find((l) => l.id === id)).not.toMatchObject(WELCOME);
  });

  it("accepts a full-length welcome body past the old 5,000 cap; rejects 20,001", async () => {
    const id = await seedList(USER);
    const longBody = "Welcome! ".repeat(900); // 8,100 chars
    const ok = await post(`/email-list/lists/${id}`, { welcomeBody: longBody }, "PATCH");
    expect(ok.status).toBe(200);
    const bad = await post(`/email-list/lists/${id}`, { welcomeBody: "a".repeat(20001) }, "PATCH");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("Invalid list update.");
    expect(bad.json.details?.[0]?.field).toBe("welcomeBody");
  });

  it("can clear a step by saving an empty body (sender skips empty steps)", async () => {
    const id = await seedList(USER);
    const r = await post(`/email-list/lists/${id}`, { welcome2Subject: "", welcome2Body: "" }, "PATCH");
    expect(r.status).toBe(200);
    expect(r.json.list.welcome2Body).toBe("");
  });
});

/* ── 3. delete: API half of the dead-button fix ─────────────────────── */

describe("DELETE /lists/:id", () => {
  it("deletes the owner's own list", async () => {
    h.userId = USER;
    const created = await post("/email-list/lists", { name: "Doomed", handle: "doomed" });
    const id = created.json.list.id;
    const r = await realFetch(`${baseUrl}/email-list/lists/${id}`, { method: "DELETE" });
    expect(r.status).toBe(200);
    expect(h.lists.find((l) => l.id === id)).toBeUndefined();
  });

  it("404s for another user's list and deletes nothing", async () => {
    h.userId = USER;
    const created = await post("/email-list/lists", { name: "Mine", handle: "mine" });
    const id = created.json.list.id;
    h.userId = OTHER;
    const r = await realFetch(`${baseUrl}/email-list/lists/${id}`, { method: "DELETE" });
    expect(r.status).toBe(404);
    expect(h.lists.find((l) => l.id === id)).toBeDefined();
  });
});

/* ── 4. UI source contracts: no native confirm, welcome UI, join ───── */

describe("frontend contracts", () => {
  const pageSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "..", "bow-down-visuals", "src", "pages", "email-list.tsx"),
    "utf8",
  );
  const joinSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "..", "bow-down-visuals", "src", "pages", "join.tsx"),
    "utf8",
  );

  it("delete no longer depends on the native confirm() dialog", () => {
    expect(pageSrc).not.toContain("!confirm(");
    expect(pageSrc).not.toContain("window.confirm");
    expect(pageSrc).toContain("confirmDeleteId");
    expect(pageSrc).toContain('method: "DELETE"');
  });

  it("the page saves welcome templates for all three steps via PATCH", () => {
    expect(pageSrc).toContain('method: "PATCH"');
    for (const f of ["welcomeSubject", "welcomeBody", "welcome2Subject", "welcome2Body", "welcome3Subject", "welcome3Body"]) {
      expect(pageSrc).toContain(f);
    }
  });

  it("the join page preserves line breaks in the offer text", () => {
    expect(joinSrc).toContain("whitespace-pre-wrap");
  });
});
