/**
 * Admin truth C3 (stack1100 lane W6) — the /email-list dashboard
 * figures must be the list's real numbers.
 *
 * The subscribers handler computed "Total signups" / "Active
 * subscribers" / opens / clicks from the 500-row display page
 * (`.limit(500)` + array lengths), so any list past 500 subscribers
 * showed capped figures under total labels — including under the
 * "of 1,000 free" line the plan limit reads against. The handler now
 * takes total/active from full-table COUNT aggregates and the
 * engagement counters from an uncapped counters-only read over
 * ACTIVE subscribers (the counters' definition is unchanged).
 *
 * This suite seeds 505 subscribers — with the heavy counters on the
 * OLDEST rows, which fall off the display page — and pins the stats
 * to the full-table truth while the row page stays 500.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";

const OWNER_ID = "00000000-0000-4000-8000-0000000000e1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000e2";
const LIST_ID = "00000000-0000-4000-8000-0000000000e3";

const h = vi.hoisted(() => ({
  lists: [] as Array<Record<string, any>>,
  subscribers: [] as Array<Record<string, any>>,
  campaigns: [] as Array<Record<string, any>>,
  deliveries: [] as Array<Record<string, any>>,
}));

/* ── minimal fake db: just the shapes this handler runs ──────────── */
const dialect = new PgDialect();

function colProps(table: any): Map<string, string> {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const m = new Map<string, string>();
  for (const [prop, col] of Object.entries(cols)) m.set(col.name, prop);
  return m;
}

function render(node: any): { sql: string; params: unknown[] } {
  try {
    const q = dialect.sqlToQuery(node);
    return { sql: q.sql, params: q.params as unknown[] };
  } catch {
    return { sql: "", params: [] };
  }
}

/** Evaluate a rendered WHERE against one row of `table`: supports
 *  `"col" = $n` and `"col" is null` predicates joined by AND. */
function matches(table: any, row: Record<string, any>, cond: any): boolean {
  if (!cond) return true;
  const { sql, params } = render(cond);
  const props = colProps(table);
  const preds = sql.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  for (const p of preds) {
    const eqM = p.match(/"(\w+)"\s*=\s*\$(\d+)/);
    if (eqM) {
      const prop = props.get(eqM[1]!) ?? eqM[1]!;
      if (String(row[prop] ?? "") !== String(params[Number(eqM[2]) - 1] ?? "")) return false;
      continue;
    }
    const nullM = p.match(/"(\w+)"\s+is null/i);
    if (nullM) {
      const prop = props.get(nullM[1]!) ?? nullM[1]!;
      if (row[prop] !== null && row[prop] !== undefined) return false;
      continue;
    }
    throw new Error(`stats-truth fake: unsupported predicate ${p} in ${sql}`);
  }
  return true;
}

function isCountField(f: any): boolean {
  return !!f && typeof f === "object" && !("name" in f) && render(f).sql.includes("count(");
}

function fakeDb(actual: any) {
  const rowsOf = (table: any): Array<Record<string, any>> => {
    if (table === actual.emailListsTable) return h.lists;
    if (table === actual.emailSubscribersTable) return h.subscribers;
    if (table === actual.emailCampaignsTable) return h.campaigns;
    if (table === actual.emailCampaignDeliveriesTable) return h.deliveries;
    return [];
  };
  return {
    select: (fields?: Record<string, any>) => {
      const st: any = { table: null, cond: undefined, limitN: null as number | null, join: null as any };
      const exec = (): Array<Record<string, any>> => {
        let rows = rowsOf(st.table).filter((r) => matches(st.table, r, st.cond));
        if (st.join) {
          /* innerJoin(campaigns, deliveries.campaignId = campaigns.id):
             the handler's only join — a delivery counts when its
             campaign belongs to the filtered list (the WHERE renders
             against the joined table here, so evaluate it on the
             campaign rows and keep deliveries paired to them). */
          const campaignIds = new Set(
            rowsOf(st.join.table)
              .filter((c) => matches(st.join.table, c, st.cond))
              .map((c) => c["id"]),
          );
          rows = rowsOf(st.table).filter((d) => campaignIds.has(d["campaignId"]));
        }
        if (fields) {
          const keys = Object.keys(fields);
          if (keys.length > 0 && keys.every((k) => isCountField(fields[k]))) {
            return [Object.fromEntries(keys.map((k) => [k, rows.length]))];
          }
          const props = colProps(st.table);
          rows = rows.map((r) => {
            const out: Record<string, any> = {};
            for (const [k, f] of Object.entries(fields)) {
              const colName = (f as any)?.name as string | undefined;
              out[k] = colName ? (r[props.get(colName) ?? colName] ?? null) : null;
            }
            return out;
          });
        }
        if (st.limitN !== null) rows = rows.slice(0, st.limitN);
        return rows;
      };
      const chain: any = {
        from: (t: any) => { st.table = t; return chain; },
        innerJoin: (t: any, cond: any) => { st.join = { table: t, cond }; return chain; },
        where: (c: any) => { st.cond = c; return chain; },
        orderBy: (..._a: any[]) => chain,
        limit: (n: number) => { st.limitN = n; return Promise.resolve(exec()); },
        then: (res: any, rej: any) => Promise.resolve().then(exec).then(res, rej),
      };
      return chain;
    },
  };
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(user);
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));
vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => { throw new Error("no ai in stats tests"); },
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));
vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));
vi.mock("../../../lib/email-campaign-sender", () => ({ queueWelcomeSequence: vi.fn(async () => {}) }));
vi.mock("../../../lib/email-campaign-send", () => ({ dispatchCampaign: vi.fn(async () => {}) }));
vi.mock("../../../lib/email-automations", () => ({
  ensureAutomationsForList: vi.fn(async () => {}),
  automationDto: (a: any) => a,
}));
vi.mock("../../../lib/email-segments", () => ({
  autoTagsFor: () => [],
  evaluateSegment: () => [],
  loadListFacts: async () => new Map(),
  normalizeCriteria: (c: any) => c,
  parseStoredCriteria: (c: any) => c,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, db: fakeDb(actual) };
});

import emailListRouter from "../email-list";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  h.lists = [{ id: LIST_ID, userId: OWNER_ID, name: "House list", handle: "house-list" }];
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  h.subscribers = Array.from({ length: 505 }, (_, i) => ({
    id: `sub-${i}`,
    listId: LIST_ID,
    email: `fan${i}@example.test`,
    name: null,
    source: "landing",
    confirmed: true,
    opens: i < 5 ? 10 : 0,          // heavy counters on the OLDEST rows (off the display page)
    clicks: i < 5 ? 2 : 0,
    subscribedAt: new Date(base + i * 60_000),
    unsubscribedAt: i >= 503 ? new Date(base + 600_000) : null, // two newest are unsubscribed
  }));
  // An unsubscribed row's counters must NOT enter the engagement sums.
  h.subscribers[503]!.opens = 99;
  h.subscribers[503]!.clicks = 99;
  h.campaigns = [];
  h.deliveries = [];

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }; next(); });
  app.use("/api", emailListRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getSubscribers(who: string, listId = LIST_ID) {
  const res = await fetch(`${baseUrl}/api/email-list/lists/${listId}/subscribers`, {
    headers: { "x-test-user": who },
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("GET /email-list/lists/:id/subscribers — dashboard stats (C3)", () => {
  it("reports full-table totals, not the 500-row page's arithmetic", async () => {
    const { status, json } = await getSubscribers(OWNER_ID);
    expect(status).toBe(200);
    expect(json.subscribers).toHaveLength(500); // the display page is unchanged
    expect(json.stats.total).toBe(505);
    expect(json.stats.active).toBe(503);
    expect(json.stats.unsubscribed).toBe(2);
  });

  it("sums engagement counters over ALL active subscribers, on- and off-page", async () => {
    const { json } = await getSubscribers(OWNER_ID);
    expect(json.stats.totalOpens).toBe(50);  // 5 oldest × 10 — all off-page pre-fix
    expect(json.stats.totalClicks).toBe(10); // 5 oldest × 2; the unsubscribed 99s excluded
    expect(json.stats.opensTracked).toBe(false);
    expect(json.stats.openRate).toBeNull();  // never measured ≠ 0%
  });

  it("another member's list still 404s (owner scoping intact)", async () => {
    const { status } = await getSubscribers(OTHER_ID);
    expect(status).toBe(404);
  });
});
