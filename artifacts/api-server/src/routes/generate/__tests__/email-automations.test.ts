/**
 * Email automations (migration 0198) — the three starter sequences.
 *
 * The contract under test:
 *  - provisioning is lazy and safe: reading a list's automations
 *    materializes the three kinds with enabled = FALSE, and nothing
 *    ever sends for a creator who hasn't switched one on (the runner
 *    over a disabled automation is a hard zero: no claims, no
 *    deliveries, no mail).
 *  - triggers come only from rows the house already keeps: paid
 *    shop sales (one per checkout, however many lines), completed
 *    digital_sales (buyer email via the auth rail — stubbed here),
 *    pending shop checkouts that never flipped, canceled/expired
 *    fan_members. Legacy unpaid "sale" rows and refunded sales
 *    never fire.
 *  - the enabled_at gate: a trigger older than the switch-on moment
 *    never fires; the delay gate holds a trigger until it is due.
 *  - dedupe is the claim ledger: the same purchase / checkout /
 *    lapse can never email a fan twice, however often the runner
 *    runs; an unsubscribed fan records 'skipped_unsubscribed'
 *    instead of a send, and a buyer who isn't on the list is not
 *    actionable at all (no row, no send).
 *  - sends ride the tracked rail honestly: per-send carrier
 *    campaigns (hidden from campaign history, refused by manual
 *    dispatch AND by dispatchCampaign itself), and with no provider
 *    configured the outcome is recorded 'no_provider' — never a
 *    fake 'sent'.
 *  - everything is owner-scoped: another creator's list, shop,
 *    sales, and members never fire this creator's automations.
 *
 * Harness: the same fake-db style as email-list-opens-honesty.test.ts
 * (the real routers and libs run against a fake db that renders
 * drizzle conditions with PgDialect and evaluates them; inserts
 * honor the unique constraints of migrations 0189 + 0198). The only
 * other fakes are auth, the mail provider (a recording stub), the
 * auth-rail email lookup, and unrelated credit/AI rails.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
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
    "emailAutomationsTable",
    "emailAutomationSendsTable",
    "shopsTable",
    "creatorProfilesTable",
    "digitalSalesTable",
    "abandonedCheckoutsTable",
  ] as const;

  /* Unique constraints from migration 0189 (+ the pre-existing handle
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
    /* Migration 0198: one automation per (list, kind); the claim
       ledger's (automation, trigger ref) unique IS the dedupe law. */
    { table: "email_automations", cols: ["list_id", "kind"] },
    { table: "email_automation_sends", cols: ["automation_id", "trigger_ref"] },
    { table: "creator_profiles", cols: ["user_id"] },
    { table: "digital_sales", cols: ["stripe_session_id"], when: (r) => r["stripe_session_id"] != null },
    /* Migration 0204: one record per expired Stripe session — the
       webhook replay law for abandoned store/storefront checkouts. */
    { table: "abandoned_checkouts", cols: ["stripe_session_id"] },
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
    throw new Error("no ai in email automation tests");
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

/* The auth rail (Supabase admin getUserById in production): tests
   resolve exactly the user ids they seed into this map. */
const userEmails = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock("../../../lib/stripe-connect", () => ({
  getUserEmail: vi.fn(async (userId: string) => userEmails.map.get(userId) ?? null),
}));

import emailListRouter from "../email-list";
import * as dbModule from "@workspace/db";
import {
  emailListsTable,
  emailSubscribersTable,
  emailCampaignsTable,
  emailCampaignDeliveriesTable,
  emailAutomationsTable,
  emailAutomationSendsTable,
  shopsTable,
  shopEventsTable,
  creatorProfilesTable,
  digitalSalesTable,
  fanMembersTable,
  abandonedCheckoutsTable,
} from "@workspace/db";
import {
  runEmailAutomationsOnce,
  recordAbandonedStripeCheckout,
  classifyExpiredCheckout,
} from "../../../lib/email-automations";
import { dispatchCampaign } from "../../../lib/email-campaign-send";
import { eq } from "drizzle-orm";

const db = (dbModule as any).db;

/* ── HTTP harness ────────────────────────────────────────────────── */
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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
/* Fixed runner clock: later than any real enabled_at the PATCH route
   stamps, so API-enabled automations are inside their gate. */
const NOW = new Date("2026-10-21T16:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
let listId = "";

beforeEach(async () => {
  (dbModule as any).__fakeReset();
  auth.userId = OWNER;
  mail.configured = true;
  mail.sends = [];
  userEmails.map.clear();
  const [list] = await db
    .insert(emailListsTable)
    .values({ userId: OWNER, name: "Fan List", handle: `fans-${randomUUID().slice(0, 8)}` })
    .returning();
  listId = list.id;
});

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/* ── Seeds ───────────────────────────────────────────────────────── */

async function addSubscriber(email: string, opts: { list?: string; unsubscribed?: boolean } = {}) {
  const [sub] = await db
    .insert(emailSubscribersTable)
    .values({
      listId: opts.list ?? listId,
      email,
      source: "landing",
      confirmed: true,
      ...(opts.unsubscribed ? { unsubscribedAt: new Date() } : {}),
    })
    .returning();
  return sub;
}

async function makeList(owner: string) {
  const [list] = await db
    .insert(emailListsTable)
    .values({ userId: owner, name: "Other List", handle: `list-${randomUUID().slice(0, 8)}` })
    .returning();
  return list;
}

async function seedShop(owner: string) {
  const [shop] = await db
    .insert(shopsTable)
    .values({ user_id: owner, name: "Shop", handle: `shop-${randomUUID().slice(0, 8)}` })
    .returning();
  return shop;
}

async function seedShopEvent(
  shop: any,
  opts: {
    type: string;
    email?: string | null;
    at: Date;
    group?: string | null;
    session?: string | null;
    paid?: boolean;
  },
) {
  const [ev] = await db
    .insert(shopEventsTable)
    .values({
      shop_id: shop.id,
      user_id: shop.user_id,
      event_type: opts.type,
      product_id: randomUUID(),
      amount_cents: 2500,
      buyer_email: opts.email ?? null,
      payment_status: opts.type === "pending_sale" ? "pending" : opts.paid === false ? null : "paid",
      paid_at: opts.type === "sale" && opts.paid !== false ? opts.at : null,
      checkout_group_id: opts.group ?? null,
      stripe_session_id: opts.session ?? null,
      created_at: opts.at,
    })
    .returning();
  return ev;
}

async function seedProfile(owner: string) {
  /* The jsonb columns are passed explicitly: their drizzle defaults
     are raw values the fake db's default-renderer can't render (the
     opens-honesty harness never seeded a jsonb-defaulted table). */
  const [profile] = await db
    .insert(creatorProfilesTable)
    .values({
      userId: owner,
      slug: `p-${randomUUID().slice(0, 8)}`,
      displayName: "Creator",
      streamSchedule: [],
      themeConfig: {},
      sections: [],
      layoutBlocks: [],
      merchItems: [],
      profileEvents: [],
      series: [],
      socialPosts: [],
      socialLinks: {},
      topCreators: [],
    })
    .returning();
  return profile;
}

async function seedDigitalSale(profile: any, buyerUserId: string, opts: { at: Date; status?: string }) {
  const [sale] = await db
    .insert(digitalSalesTable)
    .values({
      buyerUserId,
      profileId: profile.id,
      itemKind: "track",
      itemId: randomUUID(),
      amountCents: 900,
      status: opts.status ?? "completed",
      createdAt: opts.at,
    })
    .returning();
  return sale;
}

async function seedMember(
  owner: string,
  opts: { label: string; userId?: string | null; status?: string; at: Date },
) {
  const [member] = await db
    .insert(fanMembersTable)
    .values({
      user_id: owner,
      tier_id: randomUUID(),
      fan_label: opts.label,
      fan_user_id: opts.userId ?? null,
      status: opts.status ?? "canceled",
      canceled_at: opts.at,
      created_at: opts.at,
      updated_at: opts.at,
    })
    .returning();
  return member;
}

/* ── Automation helpers ──────────────────────────────────────────── */

async function getAutomations(id = listId) {
  const r = await api(`/api/email-list/lists/${id}/automations`);
  expect(r.status).toBe(200);
  return r.json.automations as Array<Record<string, any>>;
}

async function automationRow(kind: string, id = listId) {
  const rows = await db
    .select()
    .from(emailAutomationsTable)
    .where(eq(emailAutomationsTable.listId, id));
  return rows.find((a: any) => a.kind === kind);
}

/** Enable through the real API, then (optionally) pin enabledAt /
   delay to fixture values the real clock can't express. */
async function enableAutomation(
  kind: string,
  opts: { delayHours?: number; enabledAt?: Date; id?: string } = {},
) {
  const id = opts.id ?? listId;
  await getAutomations(id); /* provision first */
  const r = await patch(`/api/email-list/lists/${id}/automations/${kind}`, {
    enabled: true,
    ...(opts.delayHours !== undefined ? { delayHours: opts.delayHours } : {}),
  });
  expect(r.status).toBe(200);
  if (opts.enabledAt) {
    const row = await automationRow(kind, id);
    await db
      .update(emailAutomationsTable)
      .set({ enabledAt: opts.enabledAt })
      .where(eq(emailAutomationsTable.id, row.id));
  }
  return automationRow(kind, id);
}

const runNow = () =>
  runEmailAutomationsOnce({
    now: () => NOW,
    resolveUserEmail: async (id: string) => userEmails.map.get(id) ?? null,
  });

async function sendRows() {
  return (await db.select().from(emailAutomationSendsTable)) as Array<Record<string, any>>;
}

async function deliveries() {
  return (await db.select().from(emailCampaignDeliveriesTable)) as Array<Record<string, any>>;
}

/* ── Provisioning + API ──────────────────────────────────────────── */

describe("provisioning + API", () => {
  it("provisions the three starters disabled, with defaults, exactly once", async () => {
    const first = await getAutomations();
    expect(first.map((a) => a.kind)).toEqual(["post_purchase", "abandoned_checkout", "membership_winback"]);
    for (const a of first) {
      expect(a.enabled).toBe(false);
      expect(a.subject.length).toBeGreaterThan(0);
      expect(a.body.length).toBeGreaterThan(0);
      expect(a.sent).toBe(0);
      expect(a.lastRunAt).toBeNull();
      expect(a.triggerNote.length).toBeGreaterThan(0);
    }
    const second = await getAutomations();
    expect(second.map((a) => a.id)).toEqual(first.map((a) => a.id));
    const all = await db.select().from(emailAutomationsTable);
    expect(all.length).toBe(3);
  });

  it("is owner-scoped: another creator gets 404 on read and patch", async () => {
    auth.userId = OTHER;
    const read = await api(`/api/email-list/lists/${listId}/automations`);
    expect(read.status).toBe(404);
    const write = await patch(`/api/email-list/lists/${listId}/automations/post_purchase`, { enabled: true });
    expect(write.status).toBe(404);
  });

  it("rejects unknown kinds and out-of-range patches", async () => {
    await getAutomations();
    const badKind = await patch(`/api/email-list/lists/${listId}/automations/welcome_series`, { enabled: true });
    expect(badKind.status).toBe(404);
    const badDelay = await patch(`/api/email-list/lists/${listId}/automations/post_purchase`, { delayHours: 721 });
    expect(badDelay.status).toBe(400);
    const badSubject = await patch(`/api/email-list/lists/${listId}/automations/post_purchase`, { subject: "" });
    expect(badSubject.status).toBe(400);
  });

  it("edits copy + delay, stamps enabled_at on switch-on, keeps it on switch-off", async () => {
    await getAutomations();
    const edited = await patch(`/api/email-list/lists/${listId}/automations/post_purchase`, {
      subject: "Thanks a ton!",
      body: "Custom body",
      delayHours: 5,
    });
    expect(edited.status).toBe(200);
    expect(edited.json.automation.subject).toBe("Thanks a ton!");
    expect(edited.json.automation.delayHours).toBe(5);
    expect(edited.json.automation.enabledAt).toBeNull();

    const before = Date.now();
    const on = await patch(`/api/email-list/lists/${listId}/automations/post_purchase`, { enabled: true });
    expect(on.status).toBe(200);
    expect(on.json.automation.enabled).toBe(true);
    const stamped = new Date(on.json.automation.enabledAt).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);

    const off = await patch(`/api/email-list/lists/${listId}/automations/post_purchase`, { enabled: false });
    expect(off.json.automation.enabled).toBe(false);
    expect(off.json.automation.enabledAt).toBe(on.json.automation.enabledAt);
  });
});

/* ── Runner: the master switch ───────────────────────────────────── */

describe("runner — disabled means zero", () => {
  it("sends nothing, claims nothing, for a creator who never switched on", async () => {
    await addSubscriber("buyer@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "buyer@x.com", at: hoursAgo(30), group: "g1" });
    await getAutomations(); /* provisioned, all disabled */
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
    expect(await deliveries()).toEqual([]);
    expect(mail.sends).toEqual([]);
    const row = await automationRow("post_purchase");
    /* The fake stores no key for a never-stamped nullable column —
       undefined here is PG's null. */
    expect(row.lastRunAt ?? null).toBeNull();
  });
});

/* ── Runner: post-purchase ───────────────────────────────────────── */

describe("runner — post-purchase thank-you", () => {
  it("sends ONE thank-you per checkout (not per line), and never twice", async () => {
    await addSubscriber("buyer@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "buyer@x.com", at: hoursAgo(30), group: "g-multi" });
    await seedShopEvent(shop, { type: "sale", email: "buyer@x.com", at: hoursAgo(30), group: "g-multi" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });

    const totals = await runNow();
    expect(totals.sent).toBe(1);
    expect(mail.sends.length).toBe(1);
    expect(mail.sends[0].to).toBe("buyer@x.com");
    const rows = await sendRows();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].triggerRef).toBe("shop_checkout:g-multi");
    const dels = await deliveries();
    expect(dels.length).toBe(1);
    expect(dels[0].status).toBe("sent");

    const again = await runNow();
    expect(again.sent).toBe(0);
    expect(mail.sends.length).toBe(1);
    expect((await sendRows()).length).toBe(1);

    const row = await automationRow("post_purchase");
    expect(row.lastRunAt).toEqual(NOW);
  });

  it("never fires for a sale older than the switch-on moment", async () => {
    await addSubscriber("buyer@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "buyer@x.com", at: hoursAgo(11), group: "g-old" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(10), delayHours: 0 });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
    expect(mail.sends).toEqual([]);
  });

  it("holds a fresh sale until the delay passes", async () => {
    await addSubscriber("fresh@x.com");
    await addSubscriber("ripe@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "fresh@x.com", at: hoursAgo(5), group: "g-fresh" });
    await seedShopEvent(shop, { type: "sale", email: "ripe@x.com", at: hoursAgo(30), group: "g-ripe" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72), delayHours: 24 });
    const totals = await runNow();
    expect(totals.sent).toBe(1);
    expect(mail.sends.map((s: any) => s.to)).toEqual(["ripe@x.com"]);
  });

  it("ignores legacy unpaid sale rows (no paid proof)", async () => {
    await addSubscriber("buyer@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "buyer@x.com", at: hoursAgo(30), group: "g-legacy", paid: false });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
  });

  it("fires for a completed digital sale via the auth-rail email; refunded and unresolvable buyers never fire", async () => {
    await addSubscriber("dl-buyer@x.com");
    const profile = await seedProfile(OWNER);
    const buyer = randomUUID();
    userEmails.map.set(buyer, "dl-buyer@x.com");
    await seedDigitalSale(profile, buyer, { at: hoursAgo(30) });
    const ghost = randomUUID(); /* no email resolvable */
    await seedDigitalSale(profile, ghost, { at: hoursAgo(30) });
    await addSubscriber("refund@x.com");
    const refundBuyer = randomUUID();
    userEmails.map.set(refundBuyer, "refund@x.com");
    await seedDigitalSale(profile, refundBuyer, { at: hoursAgo(30), status: "refunded" });

    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(1);
    expect(mail.sends.map((s: any) => s.to)).toEqual(["dl-buyer@x.com"]);
    const rows = await sendRows();
    expect(rows.length).toBe(1);
    expect(rows[0].triggerRef).toMatch(/^digital_sale:/);
  });
});

/* ── Runner: abandoned checkout ──────────────────────────────────── */

describe("runner — abandoned checkout", () => {
  it("fires once for a pending checkout that never paid; paid groups and emailless checkouts never fire", async () => {
    await addSubscriber("left@x.com");
    await addSubscriber("paid@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "pending_sale", email: "left@x.com", at: hoursAgo(30), group: "g-left", session: "s-left" });
    await seedShopEvent(shop, { type: "pending_sale", email: "paid@x.com", at: hoursAgo(30), group: "g-paid", session: "s-paid" });
    await seedShopEvent(shop, { type: "sale", email: "paid@x.com", at: hoursAgo(29), group: "g-paid", session: "s-paid" });
    await seedShopEvent(shop, { type: "pending_sale", email: null, at: hoursAgo(30), group: "g-anon", session: "s-anon" });
    await enableAutomation("abandoned_checkout", { enabledAt: hoursAgo(72), delayHours: 24 });

    const totals = await runNow();
    expect(totals.sent).toBe(1);
    expect(mail.sends.map((s: any) => s.to)).toEqual(["left@x.com"]);
    const rows = await sendRows();
    expect(rows.length).toBe(1);
    expect(rows[0].triggerRef).toBe("checkout:g-left");

    const again = await runNow();
    expect(again.sent).toBe(0);
    expect((await sendRows()).length).toBe(1);
  });
});

/* ── Runner: membership winback ──────────────────────────────────── */

describe("runner — membership winback", () => {
  it("fires for canceled members by recorded email and by account email; active members never fire", async () => {
    await addSubscriber("gone@x.com");
    await addSubscriber("gone2@x.com");
    await addSubscriber("stay@x.com");
    await seedMember(OWNER, { label: "gone@x.com", at: hoursAgo(80) });
    const fanUser = randomUUID();
    userEmails.map.set(fanUser, "gone2@x.com");
    await seedMember(OWNER, { label: "Fan Two", userId: fanUser, status: "expired", at: hoursAgo(80) });
    await seedMember(OWNER, { label: "stay@x.com", status: "active", at: hoursAgo(80) });
    await enableAutomation("membership_winback", { enabledAt: hoursAgo(100), delayHours: 72 });

    const totals = await runNow();
    expect(totals.sent).toBe(2);
    expect(mail.sends.map((s: any) => s.to).sort()).toEqual(["gone2@x.com", "gone@x.com"]);
  });
});

/* ── Runner: suppression + list membership ───────────────────────── */

describe("runner — suppression is absolute", () => {
  it("records skipped_unsubscribed instead of sending, and a later purchase after unsubscribing is skipped too", async () => {
    await addSubscriber("fan@x.com", { unsubscribed: true });
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "fan@x.com", at: hoursAgo(30), group: "g-unsub" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(totals.skippedUnsubscribed).toBe(1);
    expect(mail.sends).toEqual([]);
    expect(await deliveries()).toEqual([]);
    const rows = await sendRows();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("skipped_unsubscribed");
  });

  it("a buyer who is not on this list is not actionable — no claim, no send", async () => {
    const otherList = await makeList(OTHER);
    await addSubscriber("elsewhere@x.com", { list: otherList.id });
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "elsewhere@x.com", at: hoursAgo(30), group: "g-notmine" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
    expect(mail.sends).toEqual([]);
  });
});

/* ── Runner: honest failure + isolation ──────────────────────────── */

describe("runner — no provider + per-creator isolation", () => {
  it("records no_provider (never a fake sent) when no provider is configured", async () => {
    mail.configured = false;
    await addSubscriber("buyer@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "buyer@x.com", at: hoursAgo(30), group: "g-np" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(totals.noProvider).toBe(1);
    expect(mail.sends).toEqual([]);
    const rows = await sendRows();
    expect(rows[0].status).toBe("no_provider");
    const dels = await deliveries();
    expect(dels.length).toBe(1);
    expect(dels[0].status).toBe("no_provider");
  });

  it("two creators' automations fire only from their own shops, sales, and lists", async () => {
    const otherList = await makeList(OTHER);
    await addSubscriber("mine@x.com");
    await addSubscriber("theirs@x.com", { list: otherList.id });
    const myShop = await seedShop(OWNER);
    const theirShop = await seedShop(OTHER);
    await seedShopEvent(myShop, { type: "sale", email: "mine@x.com", at: hoursAgo(30), group: "g-mine" });
    await seedShopEvent(theirShop, { type: "sale", email: "theirs@x.com", at: hoursAgo(30), group: "g-theirs" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });
    auth.userId = OTHER;
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72), id: otherList.id });
    auth.userId = OWNER;

    const totals = await runNow();
    expect(totals.sent).toBe(2);
    expect(mail.sends.map((s: any) => s.to).sort()).toEqual(["mine@x.com", "theirs@x.com"]);
    const rows = await sendRows();
    expect(rows.length).toBe(2);
    const mine = await automationRow("post_purchase");
    const theirs = await automationRow("post_purchase", otherList.id);
    expect(rows.filter((r) => r.automationId === mine.id).length).toBe(1);
    expect(rows.filter((r) => r.automationId === theirs.id).length).toBe(1);
  });
});

/* ── Carrier hygiene ─────────────────────────────────────────────── */

describe("carrier campaigns are not newsletters", () => {
  it("stay out of campaign history and refuse manual dispatch at both doors", async () => {
    await addSubscriber("buyer@x.com");
    const shop = await seedShop(OWNER);
    await seedShopEvent(shop, { type: "sale", email: "buyer@x.com", at: hoursAgo(30), group: "g-carrier" });
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });
    await runNow();

    const carriers = (await db.select().from(emailCampaignsTable)) as Array<Record<string, any>>;
    expect(carriers.length).toBe(1);
    const carrier = carriers[0];
    expect(carrier.automationId).not.toBeNull();
    expect(carrier.status).toBe("sent");

    const history = await api(`/api/email-list/lists/${listId}/campaigns`);
    expect(history.status).toBe(200);
    expect(history.json.campaigns).toEqual([]);

    const manual = await post(`/api/email-list/lists/${listId}/campaigns/${carrier.id}/send`, {});
    expect(manual.status).toBe(409);
    expect(manual.json.code).toBe("automation_carrier");

    const direct = await dispatchCampaign(carrier.id);
    expect(direct.ok).toBe(false);
    expect(direct.reason).toBe("automation_carrier");
  });
});

/* ── Abandoned checkout: Stripe store/storefront expiries (0204) ────
   The shop pending rows were only half the picture: the digital store
   and the profile storefront write nothing when a checkout starts, so
   their abandonments arrive as checkout.session.expired webhooks and
   land in abandoned_checkouts. The recorder is the webhook's half
   (classification + per-session idempotency); the runner's half is
   the same claim/carrier path every other trigger rides. */

const BUYER = randomUUID();

function storefrontSession(profileId: string, over: Record<string, any> = {}) {
  return {
    id: `cs_test_sf_${randomUUID().slice(0, 8)}`,
    payment_status: "unpaid",
    amount_total: 2500,
    metadata: {
      type: "storefront_purchase",
      buyer_user_id: BUYER,
      profile_id: profileId,
      product_id: randomUUID(),
      product_kind: "digital",
    },
    ...over,
  };
}

function storeSession(profileId: string, over: Record<string, any> = {}) {
  const itemId = randomUUID();
  return {
    id: `cs_test_st_${randomUUID().slice(0, 8)}`,
    payment_status: "unpaid",
    amount_total: 900,
    metadata: {
      buyer_user_id: BUYER,
      profile_id: profileId,
      item_kind: "track",
      item_id: itemId,
      platform_fee_cents: "45",
      creator_amount_cents: "855",
    },
    ...over,
  };
}

async function abandonedRows() {
  return (await db.select().from(abandonedCheckoutsTable)) as Array<Record<string, any>>;
}

/** File a record through the real recorder, then pin its created_at
 *  to the fixture moment (the fake db can't render the column's
 *  defaultNow; real PG stamps it at insert). */
async function recordAt(session: Record<string, any>, at: Date) {
  const recorded = await recordAbandonedStripeCheckout(session as any);
  expect(recorded).toBe(true);
  await db
    .update(abandonedCheckoutsTable)
    .set({ createdAt: at })
    .where(eq(abandonedCheckoutsTable.stripeSessionId, session.id));
}

describe("abandoned checkout — expired-session classification", () => {
  it("classifies storefront and digital-store sessions from their stamped metadata", () => {
    const profileId = randomUUID();
    expect(classifyExpiredCheckout(storefrontSession(profileId) as any)).toMatchObject({
      rail: "storefront",
      profileId,
      buyerUserId: BUYER,
    });
    const st = storeSession(profileId);
    expect(classifyExpiredCheckout(st as any)).toMatchObject({
      rail: "store",
      profileId,
      buyerUserId: BUYER,
      itemRef: `track:${st.metadata.item_id}`,
    });
  });

  it("classifies nothing for paid sessions, other rails, or unlinked sessions", () => {
    const profileId = randomUUID();
    /* A paid session in an expiry event is a contradiction — no record. */
    expect(classifyExpiredCheckout(storefrontSession(profileId, { payment_status: "paid" }) as any)).toBeNull();
    /* Marketplace already has its pending rows — recording it too
       would double-fire the fan. */
    expect(
      classifyExpiredCheckout({
        id: "cs_test_mp",
        payment_status: "unpaid",
        metadata: { type: "marketplace_shop_purchase", shop_id: randomUUID(), checkout_group_id: "g1" },
      } as any),
    ).toBeNull();
    /* Other typed rails (tips, shoutouts, tiers) are not this trigger. */
    expect(
      classifyExpiredCheckout({
        id: "cs_test_tip",
        payment_status: "unpaid",
        metadata: { type: "tip_jar", tipId: randomUUID() },
      } as any),
    ).toBeNull();
    /* No signed-in buyer / no creator profile — nothing to fire for. */
    expect(
      classifyExpiredCheckout({
        id: "cs_test_anon",
        payment_status: "unpaid",
        metadata: { type: "storefront_purchase", profile_id: profileId },
      } as any),
    ).toBeNull();
    expect(classifyExpiredCheckout({ id: "cs_test_bare", payment_status: "unpaid", metadata: {} } as any)).toBeNull();
  });
});

describe("abandoned checkout — the recorder (webhook's half)", () => {
  it("files one record per session; a replayed webhook files nothing twice", async () => {
    const profile = await seedProfile(OWNER);
    const session = storefrontSession(profile.id);
    expect(await recordAbandonedStripeCheckout(session as any)).toBe(true);
    expect(await recordAbandonedStripeCheckout(session as any)).toBe(false);
    const rows = await abandonedRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      stripeSessionId: session.id,
      rail: "storefront",
      profileId: profile.id,
      buyerUserId: BUYER,
      amountCents: 2500,
    });
  });

  it("records nothing for a paid session or a marketplace session", async () => {
    const profile = await seedProfile(OWNER);
    expect(
      await recordAbandonedStripeCheckout(storefrontSession(profile.id, { payment_status: "paid" }) as any),
    ).toBe(false);
    expect(
      await recordAbandonedStripeCheckout({
        id: "cs_test_mp_2",
        payment_status: "unpaid",
        metadata: { type: "marketplace_shop_purchase", shop_id: randomUUID(), checkout_group_id: "g9" },
      } as any),
    ).toBe(false);
    expect(await abandonedRows()).toEqual([]);
  });
});

describe("abandoned checkout — the runner fires the recorded expiry once", () => {
  it("sends exactly one carrier for a recorded storefront expiry; replays and re-runs never double-send", async () => {
    const profile = await seedProfile(OWNER);
    await addSubscriber("buyer@x.com");
    userEmails.map.set(BUYER, "buyer@x.com");
    const session = storefrontSession(profile.id);
    await recordAt(session, hoursAgo(30));
    /* The same webhook landing again after filing: still one record. */
    expect(await recordAbandonedStripeCheckout(session as any)).toBe(false);
    expect((await abandonedRows()).length).toBe(1);

    const abandoned = await enableAutomation("abandoned_checkout", { enabledAt: hoursAgo(72) });
    /* A second automation rides along to prove the other triggers are
       untouched: no sales exist, so it must stay silent. */
    await enableAutomation("post_purchase", { enabledAt: hoursAgo(72) });

    const totals = await runNow();
    expect(totals.sent).toBe(1);
    const carriers = (await db.select().from(emailCampaignsTable)) as Array<Record<string, any>>;
    expect(carriers.length).toBe(1);
    expect(carriers[0].automationId).toBe(abandoned.id);
    const claims = await sendRows();
    expect(claims.length).toBe(1);
    expect(claims[0]).toMatchObject({
      triggerKind: "abandoned_checkout",
      triggerRef: `stripe_checkout:${session.id}`,
      status: "sent",
    });
    expect(mail.sends.length).toBe(1);

    /* The sweeper running again owns nothing new: the claim ledger
       already holds this checkout. */
    const again = await runNow();
    expect(again.sent).toBe(0);
    expect((await db.select().from(emailCampaignsTable)).length).toBe(1);
    expect((await sendRows()).length).toBe(1);
    expect(mail.sends.length).toBe(1);
  });

  it("fires for a digital-store expiry too, addressed through the auth rail", async () => {
    const profile = await seedProfile(OWNER);
    await addSubscriber("fan@y.com");
    userEmails.map.set(BUYER, "fan@y.com");
    await recordAt(storeSession(profile.id), hoursAgo(30));
    await enableAutomation("abandoned_checkout", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(1);
    const claims = await sendRows();
    expect(claims.length).toBe(1);
    expect(claims[0].triggerKind).toBe("abandoned_checkout");
    expect(claims[0].recipientEmail).toBe("fan@y.com");
  });

  it("sends nothing while the automation is off, however real the abandonment", async () => {
    const profile = await seedProfile(OWNER);
    await addSubscriber("buyer@x.com");
    userEmails.map.set(BUYER, "buyer@x.com");
    await recordAt(storefrontSession(profile.id), hoursAgo(30));
    await getAutomations(); /* provisioned, still disabled */
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
    expect(await db.select().from(emailCampaignsTable)).toEqual([]);
    expect(mail.sends).toEqual([]);
  });

  it("never fires for an abandonment older than the switch-on moment", async () => {
    const profile = await seedProfile(OWNER);
    await addSubscriber("buyer@x.com");
    userEmails.map.set(BUYER, "buyer@x.com");
    await recordAt(storefrontSession(profile.id), hoursAgo(30));
    await enableAutomation("abandoned_checkout", { enabledAt: hoursAgo(1) });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
    expect(mail.sends).toEqual([]);
  });

  it("is not actionable when the buyer isn't a subscriber — no claim, no send", async () => {
    const profile = await seedProfile(OWNER);
    userEmails.map.set(BUYER, "stranger@x.com");
    await recordAt(storefrontSession(profile.id), hoursAgo(30));
    await enableAutomation("abandoned_checkout", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
    expect(mail.sends).toEqual([]);
  });

  it("is owner-scoped: another creator's expired checkout never fires this list", async () => {
    const othersProfile = await seedProfile(OTHER);
    await addSubscriber("buyer@x.com");
    userEmails.map.set(BUYER, "buyer@x.com");
    await recordAt(storefrontSession(othersProfile.id), hoursAgo(30));
    await enableAutomation("abandoned_checkout", { enabledAt: hoursAgo(72) });
    const totals = await runNow();
    expect(totals.sent).toBe(0);
    expect(await sendRows()).toEqual([]);
    expect(mail.sends).toEqual([]);
  });
});
