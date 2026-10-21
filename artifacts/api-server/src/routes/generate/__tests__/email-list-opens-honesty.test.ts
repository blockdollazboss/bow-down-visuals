/**
 * Email engagement honesty — the tracked era (migration 0188).
 *
 * This file replaces the Stack-30 "opens are not tracked" contract:
 * tracking now EXISTS (house pixel + wrapped-link redirect on every
 * campaign send, plus the Svix-verified Resend webhook feeding the
 * same recorder), so the honesty contract moved:
 *
 *  - stats report opensTracked: false + openRate: null until a list
 *    has a tracked send — "never measured" is still never dressed up
 *    as 0%; once sends exist, the rate is computed from recorded
 *    signals only.
 *  - an open counts EXACTLY ONCE per delivered email, whichever
 *    signal path (pixel or webhook) reports first; a click counts
 *    once per delivery + link.
 *  - the webhook fails closed: no secret → 503, bad signature → 401,
 *    stale timestamp → 401, and nothing unverified is ever recorded.
 *  - the click redirect resolves its destination from the stored
 *    link row only — a caller-supplied destination is ignored.
 *  - unsubscribe suppression is absolute: an unsubscribed address is
 *    in NO audience — whole-list or segment — ever.
 *  - segment membership math: manual tags ALL, auto tags ALL, sources
 *    ANY, engagement states, and the derived auto tags (presave /
 *    member / buyer) come from rows the house already keeps.
 *  - lists, tags, and segments are owner-scoped; a segment from
 *    another list cannot address a campaign on this one.
 *
 * Fake-db style (the house pattern of drafts.test.ts /
 * fan-contests-hardening.test.ts): the REAL routers and libs run
 * against a fake db that implements the drizzle chains they use —
 * conditions are rendered with PgDialect and their params evaluated,
 * inserts honor the same unique constraints migration 0188 creates
 * (including the first-signal-wins partial uniques), and sql`col + 1`
 * counter increments are applied. (pg-mem can't serve this surface:
 * drizzle's query builder emits rowMode, which its adapter rejects.)
 * The only other fakes are auth, the mail provider (a recording
 * stub), and unrelated credit/AI rails.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

/* ── Hoisted test state ──────────────────────────────────────────── */
const auth = vi.hoisted(() => ({ userId: "" }));
const mail = vi.hoisted(() => ({
  configured: true,
  sends: [] as Array<Record<string, any>>,
}));

/* ── The fake db ─────────────────────────────────────────────────── */
const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };

type Row = Record<string, any>;

function buildFakeDb(actual: Record<string, any>) {
  /* Defined inside the builder: the vi.mock factory runs at import
     time, before module-level consts initialize. */
  const TABLE_NAMES = [
    "emailListsTable",
    "emailSubscribersTable",
    "emailCampaignsTable",
    "emailTagsTable",
    "emailSubscriberTagsTable",
    "emailSegmentsTable",
    "emailCampaignDeliveriesTable",
    "emailCampaignLinksTable",
    "emailEngagementEventsTable",
    "fanMembersTable",
    "shopEventsTable",
  ] as const;

  /* Unique constraints from migration 0188 (+ the pre-existing handle
     unique), expressed as DB column names with an optional row filter
     for the partial indexes. */
  const UNIQUE_SETS: Array<{ table: string; cols: string[]; when?: (r: Row) => boolean }> = [
    { table: "email_lists", cols: ["handle"] },
    { table: "email_tags", cols: ["list_id", "name"] },
    { table: "email_subscriber_tags", cols: ["subscriber_id", "tag_id"] },
    { table: "email_campaign_deliveries", cols: ["token"] },
    { table: "email_campaign_deliveries", cols: ["campaign_id", "subscriber_id"] },
    { table: "email_campaign_links", cols: ["token"] },
    { table: "email_campaign_links", cols: ["delivery_id", "target_url"] },
    { table: "email_engagement_events", cols: ["delivery_id", "kind"], when: (r) => r.kind !== "click" },
    { table: "email_engagement_events", cols: ["delivery_id", "kind", "link_id"], when: (r) => r.kind === "click" },
    { table: "email_engagement_events", cols: ["provider_event_id"], when: (r) => r["provider_event_id"] != null },
  ];
  const tables = new Map<string, any>(); /* db name -> table object */
  const stores = new Map<string, Row[]>(); /* db name -> rows */
  for (const name of TABLE_NAMES) {
    const t = actual[name];
    if (t) tables.set(getTableName(t), t);
  }
  const rowsOf = (table: any): Row[] => {
    const n = getTableName(table);
    if (!stores.has(n)) stores.set(n, []);
    return stores.get(n)!;
  };
  const keyByDbName = (table: any, dbName: string): string | null => {
    for (const [k, v] of Object.entries(table)) {
      if (v && typeof v === "object" && (v as any).name === dbName) return k;
    }
    return null;
  };
  const colTsKey = (col: any): string | null => keyByDbName(col.table, col.name);

  /* Parse a rendered drizzle condition into predicates and evaluate
     against a merged row ({ [dbTableName]: row }). */
  function splitTopLevelAnd(sql: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i]!;
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth === 0 && sql.startsWith(" and ", i)) {
        parts.push(cur);
        cur = "";
        i += 4;
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function stripOuterParens(s: string): string {
    let out = s.trim();
    while (out.startsWith("(") && out.endsWith(")")) {
      let depth = 0;
      let wraps = true;
      for (let i = 0; i < out.length; i++) {
        if (out[i] === "(") depth++;
        if (out[i] === ")") depth--;
        if (depth === 0 && i < out.length - 1) {
          wraps = false;
          break;
        }
      }
      if (!wraps) break;
      out = out.slice(1, -1).trim();
    }
    return out;
  }

  function evalCondition(merged: Record<string, Row>, cond: unknown): boolean {
    if (cond === undefined || cond === null) return true;
    const { sql, params } = render(cond);
    return splitTopLevelAnd(stripOuterParens(sql)).every((rawPred) => {
      const pred = stripOuterParens(rawPred);
      let m = pred.match(/^"(\w+)"\."(\w+)"\s+is\s+(not\s+)?null$/);
      if (m) {
        const row = merged[m[1]!];
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        const val = row && key ? row[key] : null;
        return m[3] ? val != null : val == null;
      }
      m = pred.match(/^"(\w+)"\."(\w+)"\s+in\s*\(([^)]*)\)$/);
      if (m) {
        const row = merged[m[1]!];
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        const idxs = [...m[3]!.matchAll(/\$(\d+)/g)].map((x) => Number(x[1]) - 1);
        return idxs.some((ix) => row && key && row[key] === params[ix]);
      }
      m = pred.match(/^"(\w+)"\."(\w+)"\s*=\s*"(\w+)"\."(\w+)"$/);
      if (m) {
        const k1 = keyByDbName(tables.get(m[1]!), m[2]!);
        const k2 = keyByDbName(tables.get(m[3]!), m[4]!);
        const r1 = merged[m[1]!];
        const r2 = merged[m[3]!];
        return !!(r1 && r2 && k1 && k2 && r1[k1] === r2[k2]);
      }
      m = pred.match(/^"(\w+)"\."(\w+)"\s*=\s*\$(\d+)$/);
      if (m) {
        const row = merged[m[1]!];
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        return !!(row && key && row[key] === params[Number(m[3]) - 1]);
      }
      throw new Error(`fake-db: unsupported predicate: ${pred}`);
    });
  }

  function projectRow(merged: Record<string, Row>, fields: Record<string, any>): Row {
    const out: Row = {};
    for (const [k, f] of Object.entries(fields)) {
      if (f && typeof f === "object" && "name" in f && "table" in f) {
        const src = merged[getTableName(f.table)];
        const key = colTsKey(f);
        out[k] = src && key ? src[key] : null;
      } else {
        out[k] = null; /* aggregates handled by callers that expect them */
      }
    }
    return out;
  }
  const isCountField = (f: any) =>
    f && typeof f === "object" && !("name" in f) && render(f).sql.includes("count(");

  function selectChain(fields?: Record<string, any>) {
    const st: any = { table: null, joins: [] as any[], cond: undefined, limitN: null as number | null, groupCols: [] as any[] };
    const exec = (): Row[] => {
      let merged: Array<Record<string, Row>> = rowsOf(st.table).map((r) => ({ [getTableName(st.table)]: structuredClone(r) }));
      for (const j of st.joins) {
        const next: Array<Record<string, Row>> = [];
        for (const m of merged) {
          for (const cand of rowsOf(j.table)) {
            const combo = { ...m, [getTableName(j.table)]: structuredClone(cand) };
            if (evalCondition(combo, j.cond)) next.push(combo);
          }
        }
        merged = next;
      }
      merged = merged.filter((m) => evalCondition(m, st.cond));
      let out: Row[];
      if (st.groupCols.length > 0 && fields) {
        const groups = new Map<string, { first: Record<string, Row>; n: number }>();
        for (const m of merged) {
          const keyVals = st.groupCols.map((c: any) => {
            const src = m[getTableName(c.table)];
            const k = colTsKey(c);
            return src && k ? src[k] : null;
          });
          const gk = JSON.stringify(keyVals);
          const g = groups.get(gk) ?? { first: m, n: 0 };
          g.n++;
          groups.set(gk, g);
        }
        out = [...groups.values()].map((g) => {
          const row = projectRow(g.first, fields);
          for (const [k, f] of Object.entries(fields)) if (isCountField(f)) row[k] = g.n;
          return row;
        });
      } else if (fields) {
        const countKeys = Object.entries(fields).filter(([, f]) => isCountField(f)).map(([k]) => k);
        if (countKeys.length > 0 && Object.keys(fields).length === countKeys.length) {
          const row: Row = {};
          for (const k of countKeys) row[k] = merged.length;
          out = [row];
        } else {
          out = merged.map((m) => projectRow(m, fields));
        }
      } else {
        const base = getTableName(st.table);
        out = merged.map((m) => m[base]!);
      }
      if (st.limitN !== null) out = out.slice(0, st.limitN);
      return out;
    };
    const chain: any = {
      from: (t: any) => {
        st.table = t;
        return chain;
      },
      innerJoin: (t: any, cond: any) => {
        st.joins.push({ table: t, cond });
        return chain;
      },
      leftJoin: (t: any, cond: any) => {
        st.joins.push({ table: t, cond });
        return chain;
      },
      where: (c: any) => {
        st.cond = c;
        return chain;
      },
      orderBy: (..._a: any[]) => chain,
      groupBy: (...cols: any[]) => {
        st.groupCols = cols;
        return chain;
      },
      limit: (n: number) => {
        st.limitN = n;
        return Promise.resolve(exec());
      },
      then: (res: any, rej: any) => Promise.resolve().then(exec).then(res, rej),
    };
    return chain;
  }

  function applyDefaults(table: any, row: Row): Row {
    const out = { ...row };
    for (const [k, col] of Object.entries(table)) {
      if (!col || typeof col !== "object" || !("name" in (col as any))) continue;
      if (out[k] !== undefined) continue;
      const c: any = col;
      if (c.default !== undefined) {
        if (c.default !== null && typeof c.default === "object") {
          const sqlText = render(c.default).sql;
          if (sqlText.includes("now()")) out[k] = new Date();
          else if (sqlText.includes("gen_random_uuid") || sqlText.includes("random")) out[k] = randomUUID();
        } else {
          out[k] = c.default;
        }
      } else if (c.hasDefault && c.defaultRandom !== undefined) {
        out[k] = randomUUID();
      }
      if (out[k] === undefined && c.primaryKey && c.default !== undefined) out[k] = randomUUID();
    }
    if (out["id"] === undefined) {
      /* uuid PKs in this schema default to gen_random_uuid */
      const idCol: any = (table as any).id;
      if (idCol && idCol.primaryKey) out["id"] = randomUUID();
    }
    return out;
  }

  function findConflict(table: any, row: Row): boolean {
    const dbName = getTableName(table);
    const existing = rowsOf(table);
    /* row keys are TS keys — compare through DB-name translation */
    const dbVal = (r: Row, dbCol: string) => {
      const key = keyByDbName(table, dbCol);
      return key ? r[key] : undefined;
    };
    return UNIQUE_SETS.filter((u) => u.table === dbName).some((u) => {
      const probe: Row = {};
      for (const c of u.cols) probe[c] = dbVal(row, c);
      if (u.when && !u.when(probe)) return false;
      return existing.some((r) => {
        const er: Row = {};
        for (const c of u.cols) er[c] = dbVal(r, c);
        if (u.when && !u.when(er)) return false;
        return u.cols.every((c) => er[c] === probe[c]);
      });
    });
  }

  function insertChain(table: any) {
    const st: any = { vals: null as any, conflictDoNothing: false };
    const doInsert = (): Row[] => {
      const list = Array.isArray(st.vals) ? st.vals : [st.vals];
      const inserted: Row[] = [];
      for (const v of list) {
        const row = applyDefaults(table, structuredClone(v));
        if (findConflict(table, row)) {
          if (st.conflictDoNothing) continue;
          throw new Error("fake-db: duplicate key value violates unique constraint");
        }
        rowsOf(table).push(row);
        inserted.push(structuredClone(row));
      }
      return inserted;
    };
    const chain: any = {
      values: (v: any) => {
        st.vals = v;
        return chain;
      },
      onConflictDoNothing: () => {
        st.conflictDoNothing = true;
        return chain;
      },
      returning: (fields?: Record<string, any>) => {
        const rows = doInsert();
        if (!fields) return Promise.resolve(rows);
        return Promise.resolve(
          rows.map((r) => {
            const out: Row = {};
            for (const [k, f] of Object.entries(fields)) {
              const key = f && typeof f === "object" && "name" in f ? colTsKey(f) : null;
              out[k] = key ? r[key] : null;
            }
            return out;
          }),
        );
      },
      then: (res: any, rej: any) =>
        Promise.resolve()
          .then(() => {
            doInsert();
            return [];
          })
          .then(res, rej),
    };
    return chain;
  }

  function updateChain(table: any) {
    const st: any = { setObj: null as any, cond: undefined };
    const doUpdate = (): Row[] => {
      const updated: Row[] = [];
      for (const row of rowsOf(table)) {
        if (!evalCondition({ [getTableName(table)]: row }, st.cond)) continue;
        for (const [k, v] of Object.entries(st.setObj)) {
          if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && "queryChunks" in (v as any)) {
            const sqlText = render(v).sql;
            const mInc = sqlText.match(/"(\w+)"\s*\+\s*1/);
            if (mInc) {
              const key = keyByDbName(table, mInc[1]!);
              if (key) row[key] = (row[key] ?? 0) + 1;
              continue;
            }
            throw new Error(`fake-db: unsupported set sql: ${sqlText}`);
          }
          row[k] = v;
        }
        updated.push(structuredClone(row));
      }
      return updated;
    };
    const chain: any = {
      set: (o: any) => {
        st.setObj = o;
        return chain;
      },
      where: (c: any) => {
        st.cond = c;
        return chain;
      },
      returning: (fields?: Record<string, any>) => {
        const rows = doUpdate();
        if (!fields) return Promise.resolve(rows);
        return Promise.resolve(
          rows.map((r) => {
            const out: Row = {};
            for (const [k, f] of Object.entries(fields)) {
              const key = f && typeof f === "object" && "name" in f ? colTsKey(f) : null;
              out[k] = key ? r[key] : null;
            }
            return out;
          }),
        );
      },
      then: (res: any, rej: any) =>
        Promise.resolve()
          .then(() => {
            doUpdate();
            return [];
          })
          .then(res, rej),
    };
    return chain;
  }

  function deleteChain(table: any) {
    const st: any = { cond: undefined };
    const doDelete = (): Row[] => {
      const store = rowsOf(table);
      const removed: Row[] = [];
      for (let i = store.length - 1; i >= 0; i--) {
        if (evalCondition({ [getTableName(table)]: store[i]! }, st.cond)) {
          removed.push(structuredClone(store[i]!));
          store.splice(i, 1);
        }
      }
      return removed;
    };
    const chain: any = {
      where: (c: any) => {
        st.cond = c;
        return chain;
      },
      returning: (fields?: Record<string, any>) => {
        const rows = doDelete();
        if (!fields) return Promise.resolve(rows);
        return Promise.resolve(
          rows.map((r) => {
            const out: Row = {};
            for (const [k, f] of Object.entries(fields)) {
              const key = f && typeof f === "object" && "name" in f ? colTsKey(f) : null;
              out[k] = key ? r[key] : null;
            }
            return out;
          }),
        );
      },
      then: (res: any, rej: any) =>
        Promise.resolve()
          .then(() => {
            doDelete();
            return [];
          })
          .then(res, rej),
    };
    return chain;
  }

  return {
    db: {
      select: (fields?: Record<string, any>) => selectChain(fields),
      insert: (t: any) => insertChain(t),
      update: (t: any) => updateChain(t),
      delete: (t: any) => deleteChain(t),
    },
    reset: () => stores.clear(),
  };
}

const fakeHolder = vi.hoisted(() => ({ reset: null as null | (() => void) }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fake = buildFakeDb(actual);
  fakeHolder.reset = fake.reset;
  return { ...actual, db: fake.db, __fakeReset: fake.reset };
});

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = auth.userId;
    req.userCredits = 100000;
    next();
  },
}));

vi.mock("../../../lib/email", () => ({
  isEmailConfigured: () => mail.configured,
  baseUrlForEmail: () => "https://test.example",
  escapeHtml: (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  sendEmail: vi.fn(async (opts: Record<string, any>) => {
    mail.sends.push(opts);
    return { sent: true, id: `msg_${mail.sends.length}` };
  }),
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => {
    throw new Error("no ai in email engagement tests");
  }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 100000),
  refundCredits: vi.fn(async () => 100000),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/payment-record", () => ({
  recordCreditUsage: vi.fn(async () => {}),
}));

import { resendWebhookHandler } from "../../../lib/resend-webhook";
import emailListRouter from "../email-list";
import emailTrackingRouter from "../../email-tracking";
import * as dbModule from "@workspace/db";
import {
  emailListsTable,
  emailSubscribersTable,
  emailCampaignsTable,
  emailCampaignDeliveriesTable,
  emailCampaignLinksTable,
  emailEngagementEventsTable,
  fanMembersTable,
  shopEventsTable,
} from "@workspace/db";

const db = (dbModule as any).db;

/* ── HTTP harness ────────────────────────────────────────────────── */
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.post("/api/resend-webhook", express.raw({ type: "application/json" }), resendWebhookHandler);
  app.use(express.json());
  app.use("/api/email-track", emailTrackingRouter);
  app.use("/api", emailListRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const OWNER = randomUUID();
const OTHER = randomUUID();
let listId = "";

const WEBHOOK_KEY = Buffer.from("0123456789abcdef0123456789abcdef");
const WEBHOOK_SECRET = `whsec_${WEBHOOK_KEY.toString("base64")}`;

beforeEach(async () => {
  (dbModule as any).__fakeReset();
  auth.userId = OWNER;
  mail.configured = true;
  mail.sends = [];
  process.env["RESEND_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
  const [list] = await db
    .insert(emailListsTable)
    .values({ userId: OWNER, name: "Fan List", handle: `fans-${randomUUID().slice(0, 8)}` })
    .returning();
  listId = list.id;
});

function signWebhook(body: string, id = `msg_${randomUUID()}`) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", WEBHOOK_KEY).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" };
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (redirects, pages) */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function addSubscriber(email: string, opts: { source?: string; unsubscribed?: boolean } = {}) {
  const [sub] = await db
    .insert(emailSubscribersTable)
    .values({
      listId,
      email,
      source: opts.source ?? "landing",
      confirmed: true,
      ...(opts.unsubscribed ? { unsubscribedAt: new Date() } : {}),
    })
    .returning();
  return sub;
}

async function eventCount() {
  const rows = await db.select().from(emailEngagementEventsTable);
  return rows.length;
}

async function deliveryFor(campaignId: string) {
  const rows = await db.select().from(emailCampaignDeliveriesTable);
  return rows.find((d: any) => d.campaignId === campaignId);
}

/* Send a campaign to the whole list through the real route + dispatch. */
async function sendCampaign(body = "New drop is live: https://example.com/drop — enjoy!") {
  const r = await post(`/api/email-list/lists/${listId}/campaigns`, {
    subject: "New drop",
    body,
    status: "queued",
  });
  expect(r.status).toBe(201);
  return r.json.campaign;
}

/* ── Stats honesty: null until measured, real once measured ──────── */

describe("subscribers stats honesty (tracked era)", () => {
  it("reports opensTracked false + null rate before any tracked send", async () => {
    await addSubscriber("a@x.com");
    await addSubscriber("b@x.com");
    const r = await api(`/api/email-list/lists/${listId}/subscribers`);
    expect(r.json.stats).toMatchObject({ total: 2, active: 2, openRate: null, opensTracked: false, totalOpens: 0 });
  });

  it("reports the measured rate once a real open is recorded", async () => {
    const a = await addSubscriber("a@x.com");
    await addSubscriber("b@x.com");
    const campaign = await sendCampaign();
    const delivery = await deliveryFor(campaign.id);
    const px = await api(`/api/email-track/o/${delivery.token}.gif`);
    expect(px.status).toBe(200);
    expect(px.headers.get("content-type")).toContain("image/gif");
    const r = await api(`/api/email-list/lists/${listId}/subscribers`);
    expect(r.json.stats.opensTracked).toBe(true);
    expect(r.json.stats.totalOpens).toBe(1);
    expect(r.json.stats.openRate).toBeCloseTo(0.5);
    const subA = r.json.subscribers.find((s: any) => s.id === a.id);
    expect(subA.opens).toBe(1);
  });
});

/* ── Recorded exactly once, whichever path reports first ─────────── */

describe("open/click dedupe — first signal wins", () => {
  it("pixel first, webhook second: one open, counters move once", async () => {
    await addSubscriber("a@x.com");
    const campaign = await sendCampaign();
    const delivery = await deliveryFor(campaign.id);
    await api(`/api/email-track/o/${delivery.token}.gif`);
    const body = JSON.stringify({ type: "email.opened", data: { email_id: delivery.providerMessageId } });
    const wh = await api(`/api/resend-webhook`, { method: "POST", headers: signWebhook(body), body });
    expect(wh.status).toBe(200);
    expect(await eventCount()).toBe(1);
    const [camp] = await db.select().from(emailCampaignsTable);
    expect(camp.openCount).toBe(1);
    const [sub] = await db.select().from(emailSubscribersTable);
    expect(sub.opens).toBe(1);
  });

  it("webhook first, pixel second: still one open", async () => {
    await addSubscriber("a@x.com");
    const campaign = await sendCampaign();
    const delivery = await deliveryFor(campaign.id);
    const body = JSON.stringify({ type: "email.opened", data: { email_id: delivery.providerMessageId } });
    await api(`/api/resend-webhook`, { method: "POST", headers: signWebhook(body), body });
    await api(`/api/email-track/o/${delivery.token}.gif`);
    expect(await eventCount()).toBe(1);
    const [camp] = await db.select().from(emailCampaignsTable);
    expect(camp.openCount).toBe(1);
  });

  it("the same webhook delivered twice (provider retry) records once", async () => {
    await addSubscriber("a@x.com");
    const campaign = await sendCampaign();
    const delivery = await deliveryFor(campaign.id);
    const body = JSON.stringify({ type: "email.opened", data: { email_id: delivery.providerMessageId } });
    const headers = signWebhook(body);
    await api(`/api/resend-webhook`, { method: "POST", headers, body });
    await api(`/api/resend-webhook`, { method: "POST", headers, body });
    expect(await eventCount()).toBe(1);
  });

  it("click redirect: stored target only, counted once, unknown token 404s", async () => {
    await addSubscriber("a@x.com");
    await sendCampaign();
    const links = await db.select().from(emailCampaignLinksTable);
    expect(links).toHaveLength(1);
    expect(links[0].targetUrl).toBe("https://example.com/drop");
    /* A caller-supplied destination must be ignored entirely. */
    const r1 = await api(`/api/email-track/c/${links[0].token}?to=https://evil.example`, { redirect: "manual" });
    expect(r1.status).toBe(302);
    expect(r1.headers.get("location")).toBe("https://example.com/drop");
    await api(`/api/email-track/c/${links[0].token}`, { redirect: "manual" });
    expect(await eventCount()).toBe(1);
    const [camp] = await db.select().from(emailCampaignsTable);
    expect(camp.clickCount).toBe(1);
    const bad = await api(`/api/email-track/c/nope`, { redirect: "manual" });
    expect(bad.status).toBe(404);
  });
});

/* ── Webhook verification discipline ─────────────────────────────── */

describe("resend webhook verification", () => {
  it("rejects a bad signature with 401 and records nothing", async () => {
    await addSubscriber("a@x.com");
    await sendCampaign();
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "msg_1" } });
    const headers = signWebhook(body);
    headers["svix-signature"] = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const r = await api(`/api/resend-webhook`, { method: "POST", headers, body });
    expect(r.status).toBe(401);
    expect(await eventCount()).toBe(0);
  });

  it("fails closed with 503 when the webhook secret is not configured", async () => {
    delete process.env["RESEND_WEBHOOK_SECRET"];
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "msg_1" } });
    const r = await api(`/api/resend-webhook`, { method: "POST", headers: signWebhook(body), body });
    expect(r.status).toBe(503);
    expect(await eventCount()).toBe(0);
  });

  it("rejects a stale timestamp even with a valid HMAC", async () => {
    await addSubscriber("a@x.com");
    await sendCampaign();
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "msg_1" } });
    const id = `msg_${randomUUID()}`;
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = createHmac("sha256", WEBHOOK_KEY).update(`${id}.${ts}.${body}`).digest("base64");
    const r = await api(`/api/resend-webhook`, {
      method: "POST",
      headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" },
      body,
    });
    expect(r.status).toBe(401);
    expect(await eventCount()).toBe(0);
  });

  it("a complaint suppresses the subscriber (absolute)", async () => {
    const sub = await addSubscriber("a@x.com");
    const campaign = await sendCampaign();
    const delivery = await deliveryFor(campaign.id);
    const body = JSON.stringify({ type: "email.complained", data: { email_id: delivery.providerMessageId } });
    const r = await api(`/api/resend-webhook`, { method: "POST", headers: signWebhook(body), body });
    expect(r.status).toBe(200);
    const subs = await db.select().from(emailSubscribersTable);
    const after = subs.find((s: any) => s.id === sub.id);
    expect(after.unsubscribedAt).not.toBeNull();
  });
});

/* ── Dispatch + absolute suppression ─────────────────────────────── */

describe("campaign dispatch", () => {
  it("sends to active subscribers only — unsubscribed get no delivery row, ever", async () => {
    await addSubscriber("a@x.com");
    await addSubscriber("b@x.com");
    await addSubscriber("gone@x.com", { unsubscribed: true });
    const campaign = await sendCampaign();
    expect(campaign.status).toBe("sent");
    expect(campaign.deliveredCount).toBe(2);
    expect(campaign.recipientCount).toBe(2);
    const deliveries = await db.select().from(emailCampaignDeliveriesTable);
    expect(deliveries.map((d: any) => d.email).sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(mail.sends.map((s) => s.to).sort()).toEqual(["a@x.com", "b@x.com"]);
    /* Sends carry provider tags the webhook joins on. */
    expect(mail.sends[0].tags).toContainEqual({ name: "campaign_id", value: campaign.id });
    /* The sent HTML carries the tracking pixel + disclosure footer. */
    expect(mail.sends[0].html).toContain("/api/email-track/o/");
    expect(mail.sends[0].html).toContain("Unsubscribe in one click");
    expect(mail.sends[0].html).toContain("tracked");
  });

  it("no provider configured: campaign lands failed, nothing is marked sent", async () => {
    mail.configured = false;
    await addSubscriber("a@x.com");
    const r = await post(`/api/email-list/lists/${listId}/campaigns`, {
      subject: "Hi",
      body: "body",
      status: "queued",
    });
    expect(r.json.dispatch.reason).toBe("no_provider");
    expect(r.json.campaign.status).toBe("failed");
    expect(r.json.campaign.deliveredCount).toBe(0);
    const deliveries = await db.select().from(emailCampaignDeliveriesTable);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("no_provider");
    expect(mail.sends).toHaveLength(0);
  });

  it("one-click unsubscribe endpoint suppresses the address", async () => {
    const sub = await addSubscriber("a@x.com");
    await sendCampaign();
    const [delivery] = await db.select().from(emailCampaignDeliveriesTable);
    const r = await post(`/api/email-track/u/${delivery.token}`, {});
    expect(r.status).toBe(200);
    const subs = await db.select().from(emailSubscribersTable);
    const after = subs.find((s: any) => s.id === sub.id);
    expect(after.unsubscribedAt).not.toBeNull();
  });
});

/* ── Segments: membership math + suppression + scoping ───────────── */

describe("segments", () => {
  async function seedAudience() {
    const vip = await addSubscriber("vip@x.com");
    const pre = await addSubscriber("pre@x.com", { source: "presave" });
    const mem = await addSubscriber("mem@x.com");
    const buy = await addSubscriber("buy@x.com");
    const gone = await addSubscriber("gone@x.com", { unsubscribed: true });
    await db.insert(fanMembersTable).values({
      user_id: OWNER,
      fan_label: "mem@x.com",
      status: "active",
    });
    await db.insert(shopEventsTable).values({
      user_id: OWNER,
      event_type: "sale",
      buyer_email: "buy@x.com",
    });
    const tagRes = await post(`/api/email-list/lists/${listId}/tags`, { name: "VIP" });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.json.tag.id;
    for (const s of [vip, gone]) {
      const r = await api(`/api/email-list/lists/${listId}/subscribers/${s.id}/tags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagIds: [tagId] }),
      });
      expect(r.status).toBe(200);
    }
    return { vip, pre, mem, buy, gone, tagId };
  }

  async function makeSegment(criteria: Record<string, unknown>) {
    const r = await post(`/api/email-list/lists/${listId}/segments`, { name: "seg", criteria });
    expect(r.status).toBe(201);
    return r.json.segment;
  }

  async function memberEmails(segId: string) {
    const r = await api(`/api/email-list/lists/${listId}/segments/${segId}/members`);
    expect(r.status).toBe(200);
    return r.json.members.map((m: any) => m.email).sort();
  }

  it("manual tags are ALL-match, and unsubscribed carriers are excluded absolutely", async () => {
    await seedAudience();
    const seg = await makeSegment({ tags: ["vip"] });
    expect(seg.size).toBe(1);
    expect(await memberEmails(seg.id)).toEqual(["vip@x.com"]);
  });

  it("derives presave / member / buyer auto tags from house rows", async () => {
    await seedAudience();
    expect(await memberEmails((await makeSegment({ autoTags: ["presave"] })).id)).toEqual(["pre@x.com"]);
    expect(await memberEmails((await makeSegment({ autoTags: ["member"] })).id)).toEqual(["mem@x.com"]);
    expect(await memberEmails((await makeSegment({ autoTags: ["buyer"] })).id)).toEqual(["buy@x.com"]);
  });

  it("sources match ANY; engagement none/opened follow recorded signals", async () => {
    const { vip } = await seedAudience();
    const srcSeg = await makeSegment({ sources: ["landing"] });
    expect(await memberEmails(srcSeg.id)).toEqual(["buy@x.com", "mem@x.com", "vip@x.com"]);
    const noneSeg = await makeSegment({ engagement: "none" });
    expect((await memberEmails(noneSeg.id)).length).toBe(4);
    await sendCampaign();
    const deliveries = await db.select().from(emailCampaignDeliveriesTable);
    const delivery = deliveries.find((d: any) => d.subscriberId === vip.id);
    await api(`/api/email-track/o/${delivery.token}.gif`);
    const openedSeg = await makeSegment({ engagement: "opened" });
    expect(await memberEmails(openedSeg.id)).toEqual(["vip@x.com"]);
    const engagedSeg = await makeSegment({ autoTags: ["engaged"] });
    expect(await memberEmails(engagedSeg.id)).toEqual(["vip@x.com"]);
    expect((await memberEmails(noneSeg.id)).length).toBe(3);
  });

  it("sending TO a segment reaches exactly its members", async () => {
    await seedAudience();
    const seg = await makeSegment({ autoTags: ["presave"] });
    const r = await post(`/api/email-list/lists/${listId}/campaigns`, {
      subject: "Presave fam",
      body: "early access",
      status: "queued",
      segmentId: seg.id,
    });
    expect(r.status).toBe(201);
    expect(mail.sends.map((s) => s.to)).toEqual(["pre@x.com"]);
    expect(r.json.campaign.deliveredCount).toBe(1);
  });

  it("rejects criteria naming a tag this list doesn't have", async () => {
    await seedAudience();
    const r = await post(`/api/email-list/lists/${listId}/segments`, { name: "x", criteria: { tags: ["nope"] } });
    expect(r.status).toBe(400);
  });

  it("owner scoping: another creator sees none of it; foreign segments can't address campaigns", async () => {
    await seedAudience();
    const seg = await makeSegment({ autoTags: ["presave"] });
    auth.userId = OTHER;
    expect((await api(`/api/email-list/lists/${listId}/subscribers`)).status).toBe(404);
    expect((await api(`/api/email-list/lists/${listId}/segments`)).status).toBe(404);
    expect((await post(`/api/email-list/lists/${listId}/tags`, { name: "x" })).status).toBe(404);
    auth.userId = OWNER;
    const [list2] = await db
      .insert(emailListsTable)
      .values({ userId: OWNER, name: "Second", handle: `second-${randomUUID().slice(0, 8)}` })
      .returning();
    const cross = await post(`/api/email-list/lists/${list2.id}/campaigns`, {
      subject: "x",
      body: "y",
      segmentId: seg.id,
    });
    expect(cross.status).toBe(400);
  });

  it("subscribers payload carries manual + derived tags", async () => {
    await seedAudience();
    const r = await api(`/api/email-list/lists/${listId}/subscribers`);
    const vip = r.json.subscribers.find((s: any) => s.email === "vip@x.com");
    expect(vip.tags).toEqual(["vip"]);
    const pre = r.json.subscribers.find((s: any) => s.email === "pre@x.com");
    expect(pre.autoTags).toContain("presave");
    const mem = r.json.subscribers.find((s: any) => s.email === "mem@x.com");
    expect(mem.autoTags).toContain("member");
    const buy = r.json.subscribers.find((s: any) => s.email === "buy@x.com");
    expect(buy.autoTags).toContain("buyer");
  });
});
