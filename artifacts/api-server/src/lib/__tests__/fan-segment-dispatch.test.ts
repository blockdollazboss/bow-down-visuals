/**
 * Fan-segment dispatch — the desk adapter's contract
 * (lib/email-campaign-send.dispatchCampaignToAudience).
 *
 * The REAL dispatch + per-recipient rail run against a small fake
 * db; the only other fake is the mail provider (a recording stub).
 * Pins:
 *   - a fan_segment campaign sends through sendCampaignDelivery:
 *     one delivery row per recipient, mail via the house sendEmail,
 *     campaign lands "sent" with measured counts;
 *   - the generic dispatchCampaign REFUSES a fan_segment campaign
 *     (it can never be widened to the whole list), and this door
 *     refuses plain campaigns and automation carriers in return;
 *   - fan campaigns are claimed draft|failed → sending — never via
 *     "queued", the state the poller drain claims;
 *   - no provider → deliveries recorded no_provider, campaign
 *     "failed", reason no_provider — never a fake "sent";
 *   - an empty audience is an honest failure, zero mail;
 *   - a re-dispatch skips already-sent recipients (no double email).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const mail = vi.hoisted(() => ({
  configured: true,
  sends: [] as Array<Record<string, any>>,
}));

vi.mock("../email", () => ({
  isEmailConfigured: () => mail.configured,
  sendEmail: async (input: Record<string, any>) => {
    mail.sends.push(input);
    return { sent: true, id: `msg-${mail.sends.length}` };
  },
  baseUrlForEmail: () => "https://bowdownvisuals.com",
}));

/* ── Small fake db: select / insert / update over 4 tables ───────── */
const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
type Row = Record<string, any>;

function buildFakeDb(actual: Record<string, any>) {
  const TABLE_NAMES = ["emailCampaignsTable", "emailListsTable", "emailCampaignDeliveriesTable", "emailCampaignLinksTable"] as const;
  const tables = new Map<string, any>();
  const stores = new Map<string, Row[]>();
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
        if (depth === 0 && i < out.length - 1) { wraps = false; break; }
      }
      if (!wraps) break;
      out = out.slice(1, -1).trim();
    }
    return out;
  }
  function evalCondition(table: any, row: Row, cond: unknown): boolean {
    if (cond === undefined || cond === null) return true;
    const { sql, params } = render(cond);
    return splitTopLevelAnd(stripOuterParens(sql)).every((rawPred) => {
      const pred = stripOuterParens(rawPred);
      let m = pred.match(/^"(\w+)"\."(\w+)"\s+is\s+(not\s+)?null$/);
      if (m) {
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        const val = key ? row[key] : null;
        return m[3] ? val != null : val == null;
      }
      m = pred.match(/^"(\w+)"\."(\w+)"\s+in\s*\(([^)]*)\)$/);
      if (m) {
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        const idxs = [...m[3]!.matchAll(/\$(\d+)/g)].map((x) => Number(x[1]) - 1);
        return idxs.some((ix) => key && row[key] === params[ix]);
      }
      m = pred.match(/^"(\w+)"\."(\w+)"\s*=\s*\$(\d+)$/);
      if (m) {
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        return !!(key && row[key] === params[Number(m[3]) - 1]);
      }
      throw new Error(`fake-db: unsupported predicate: ${pred}`);
    });
  }
  function projectRow(row: Row, table: any, fields: Record<string, any>): Row {
    const out: Row = {};
    for (const [k, f] of Object.entries(fields)) {
      if (f && typeof f === "object" && "name" in f && "table" in f) {
        const key = keyByDbName(table, (f as any).name);
        out[k] = key ? row[key] : null;
      } else out[k] = null;
    }
    return out;
  }

  const db = {
    select: (fields?: Record<string, any>) => ({
      from: (table: any) => {
        let cond: unknown;
        let lim: number | undefined;
        const chain: any = {
          where: (c: unknown) => { cond = c; return chain; },
          limit: (n: number) => { lim = n; return chain; },
          then: (onF: any, onR: any) => {
            let rows = rowsOf(table).filter((r) => evalCondition(table, r, cond));
            if (lim !== undefined) rows = rows.slice(0, lim);
            const out = rows.map((r) => (fields ? projectRow(structuredClone(r), table, fields) : structuredClone(r)));
            return Promise.resolve(out).then(onF, onR);
          },
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (vals: Row) => {
        const doInsert = (): Row[] => {
          const rows = rowsOf(table);
          // Unique (campaign_id, subscriber_id) on deliveries and
          // (delivery_id, target_url) on links — the resumability law.
          const tname = getTableName(table);
          if (tname === "email_campaign_deliveries" && rows.some((r) => r.campaignId === vals.campaignId && r.subscriberId === vals.subscriberId)) return [];
          if (tname === "email_campaign_links" && rows.some((r) => r.deliveryId === vals.deliveryId && r.targetUrl === vals.targetUrl)) return [];
          const row: Row = { id: randomUUID(), createdAt: new Date(), ...structuredClone(vals) };
          rows.push(row);
          return [structuredClone(row)];
        };
        const chain: any = {
          onConflictDoNothing: () => chain,
          returning: async () => doInsert(),
          then: (onF: any, onR: any) => Promise.resolve(doInsert()).then(onF, onR),
        };
        return chain;
      },
    }),
    update: (table: any) => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => {
          const apply = (): Row[] => {
            const matched = rowsOf(table).filter((r) => evalCondition(table, r, cond));
            for (const r of matched) Object.assign(r, structuredClone(patch));
            return matched.map((r) => structuredClone(r));
          };
          const chain: any = {
            returning: async (fields?: Record<string, any>) => {
              const matched = apply();
              return fields ? matched.map((r) => projectRow(r, table, fields)) : matched;
            },
            then: (onF: any, onR: any) => Promise.resolve(apply()).then(onF, onR),
          };
          return chain;
        },
      }),
    }),
  };
  const seed = (table: any, rows: Row[]) => { stores.set(getTableName(table), rows.map((r) => ({ ...r }))); };
  const all = (table: any): Row[] => rowsOf(table);
  const reset = () => stores.clear();
  return { db, seed, all, reset };
}

const fakeHolder = vi.hoisted(() => ({ seed: null as any, all: null as any, reset: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fake = buildFakeDb(actual);
  fakeHolder.seed = fake.seed;
  fakeHolder.all = fake.all;
  fakeHolder.reset = fake.reset;
  return { ...actual, db: fake.db };
});

import { dispatchCampaign, dispatchCampaignToAudience } from "../email-campaign-send";
import * as dbModule from "@workspace/db";

const LIST = "list-1";
const CAMP = "camp-1";

function seedCampaign(overrides: Row = {}) {
  const t = dbModule as any;
  fakeHolder.seed(t.emailListsTable, [{ id: LIST, userId: "creator-1", name: "Fans", handle: "fans" }]);
  fakeHolder.seed(t.emailCampaignsTable, [
    {
      id: CAMP, listId: LIST, subject: "Big news", body: "Hello fans",
      kind: "fan_segment", status: "draft", segmentId: null, automationId: null,
      recipientCount: 0, deliveredCount: 0, sentAt: null, createdAt: new Date(),
      ...overrides,
    },
  ]);
  fakeHolder.seed(t.emailCampaignDeliveriesTable, []);
  fakeHolder.seed(t.emailCampaignLinksTable, []);
}

const audience = [
  { id: "s-bea", email: "bea@x.io" },
  { id: "s-dee", email: "dee@x.io" },
];

beforeEach(() => {
  fakeHolder.reset();
  mail.configured = true;
  mail.sends = [];
  seedCampaign();
});

describe("dispatchCampaignToAudience", () => {
  it("sends through the tracked rail: one delivery + one email per recipient, campaign lands sent", async () => {
    const result = await dispatchCampaignToAudience(CAMP, audience);
    expect(result).toEqual({ ok: true, audience: 2, sent: 2, failed: 0 });
    expect(mail.sends.map((s) => s.to).sort()).toEqual(["bea@x.io", "dee@x.io"]);
    expect(mail.sends[0]!.subject).toBe("Big news");
    expect(mail.sends[0]!.tags).toContainEqual({ name: "campaign_id", value: CAMP });

    const t = dbModule as any;
    const deliveries = fakeHolder.all(t.emailCampaignDeliveriesTable);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d: Row) => d.status === "sent")).toBe(true);
    const [campaign] = fakeHolder.all(t.emailCampaignsTable);
    expect(campaign.status).toBe("sent");
    expect(campaign.recipientCount).toBe(2);
    expect(campaign.deliveredCount).toBe(2);
  });

  it("the generic dispatchCampaign refuses a fan_segment campaign — it can never widen to the whole list", async () => {
    const t = dbModule as any;
    // Even in a dispatchable-looking state, the generic door refuses.
    fakeHolder.seed(t.emailCampaignsTable, [
      { id: CAMP, listId: LIST, subject: "Big news", body: "Hello fans", kind: "fan_segment", status: "queued", segmentId: null, automationId: null, recipientCount: 0, deliveredCount: 0, sentAt: null, createdAt: new Date() },
    ]);
    const result = await dispatchCampaign(CAMP);
    expect(result).toEqual({ ok: false, reason: "fan_segment_audience", audience: 0, sent: 0, failed: 0 });
    expect(mail.sends).toEqual([]);
  });

  it("refuses plain campaigns and automation carriers", async () => {
    seedCampaign({ kind: "campaign" });
    expect((await dispatchCampaignToAudience(CAMP, audience)).reason).toBe("not_fan_segment");
    seedCampaign({ kind: "fan_segment", automationId: "auto-1" });
    expect((await dispatchCampaignToAudience(CAMP, audience)).reason).toBe("automation_carrier");
    expect(mail.sends).toEqual([]);
  });

  it("refuses a campaign that is not in a sendable state", async () => {
    seedCampaign({ status: "sent" });
    const result = await dispatchCampaignToAudience(CAMP, audience);
    expect(result.reason).toBe("not_dispatchable:sent");
    expect(mail.sends).toEqual([]);
  });

  it("an empty audience fails honestly — campaign failed, zero mail", async () => {
    const result = await dispatchCampaignToAudience(CAMP, []);
    expect(result).toEqual({ ok: false, reason: "empty_audience", audience: 0, sent: 0, failed: 0 });
    expect(mail.sends).toEqual([]);
    const t = dbModule as any;
    expect(fakeHolder.all(t.emailCampaignsTable)[0].status).toBe("failed");
  });

  it("no provider configured: deliveries are no_provider, campaign failed, nothing fake-sent", async () => {
    mail.configured = false;
    const result = await dispatchCampaignToAudience(CAMP, audience);
    expect(result).toEqual({ ok: false, reason: "no_provider", audience: 2, sent: 0, failed: 2 });
    expect(mail.sends).toEqual([]);
    const t = dbModule as any;
    const deliveries = fakeHolder.all(t.emailCampaignDeliveriesTable);
    expect(deliveries.every((d: Row) => d.status === "no_provider")).toBe(true);
    expect(fakeHolder.all(t.emailCampaignsTable)[0].status).toBe("failed");
  });

  it("a re-dispatch after a crash skips already-sent recipients (no double email)", async () => {
    const first = await dispatchCampaignToAudience(CAMP, audience);
    expect(first.ok).toBe(true);
    // A crashed-then-failed retry path: the campaign is re-marked
    // failed (the /send door's retry state) and dispatched again;
    // delivery-level already-sent skips must hold.
    seedCampaignKeepDeliveries();
    mail.sends = [];
    const second = await dispatchCampaignToAudience(CAMP, audience);
    expect(second.sent).toBe(2); // counted as sent…
    expect(mail.sends).toEqual([]); // …without re-emailing anyone

    function seedCampaignKeepDeliveries() {
      const t = dbModule as any;
      const deliveries = fakeHolder.all(t.emailCampaignDeliveriesTable);
      seedCampaign({ status: "failed" });
      fakeHolder.seed(t.emailCampaignDeliveriesTable, deliveries);
    }
  });
});
