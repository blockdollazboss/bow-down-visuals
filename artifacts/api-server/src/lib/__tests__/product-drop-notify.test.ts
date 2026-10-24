import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  createDrizzleProductDropNotifyStore,
  notifyDropFansForDrop,
  sweepDueProductDrops,
  buildProductDropEmail,
  type DueProductDrop,
  type ProductDropNotifyStore,
} from "../product-drop-notify";
import { createTestDb, type TestDb } from "./test-db";
import { DataType } from "pg-mem";

/* Drop-day product notifications (Stack-100 #3 #25).
 *
 * These tests run the REAL drizzle store against pg-mem — the claim
 * discipline (status-guarded live flip, insert-first ON CONFLICT DO
 * NOTHING, status-guarded retry UPDATEs) is SQL, so a fake store would
 * test nothing about it. Only the sender is faked (deps.send), which is
 * the seam the lib exposes for exactly this. A "restart" is a fresh
 * store instance over the same durable rows. */

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL
);
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
  compare_at_cents integer, inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  drop_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'cancelled')),
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_drops_product_ux ON product_drops (product_id);
CREATE TABLE product_drop_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES product_drops(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  email text NOT NULL, name text, source text NOT NULL DEFAULT 'drop',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drop_id, email)
);
CREATE TABLE product_drop_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES product_drops(id) ON DELETE CASCADE,
  capture_id uuid REFERENCES product_drop_captures(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  provider_id text, last_error text, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_drop_deliveries_drop_email_idx ON product_drop_deliveries (drop_id, email);
`;

/* Fixed clock: the standard fixture drop landed an hour ago. */
const NOW = new Date("2026-11-10T12:00:00Z");
const DROP_AT = new Date("2026-11-10T11:00:00Z");

let t: TestDb;
let store: ProductDropNotifyStore;
const PROFILE_ID = randomUUID();
const CREATOR = randomUUID();

beforeEach(() => {
  t = createTestDb();
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(DDL);
  store = createDrizzleProductDropNotifyStore(t.db as never);
});

async function seedDrop(overrides: Record<string, unknown> = {}): Promise<{ dropId: string; productId: string }> {
  const productId = randomUUID();
  const dropId = randomUUID();
  const pick = (key: string, fallback: unknown) => (key in overrides ? overrides[key] : fallback);
  await t.db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name)
    VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')
    ON CONFLICT (id) DO NOTHING
  `);
  await t.db.execute(sql`
    INSERT INTO store_products (id, profile_id, kind, title, price_cents)
    VALUES (${productId}, ${PROFILE_ID}, 'digital', ${pick("title", "Midnight Pack") as string}, 1999)
  `);
  await t.db.execute(sql`
    INSERT INTO product_drops (id, product_id, profile_id, user_id, drop_at, status)
    VALUES (${dropId}, ${productId}, ${PROFILE_ID}, ${CREATOR},
      ${(pick("drop_at", DROP_AT) as Date).toISOString()}::timestamptz,
      ${pick("status", "scheduled") as string})
  `);
  return { dropId, productId };
}

async function seedCapture(dropId: string, productId: string, email: string, createdAt: string, name: string | null = null): Promise<string> {
  const id = randomUUID();
  await t.db.execute(sql`
    INSERT INTO product_drop_captures (id, drop_id, product_id, email, name, created_at)
    VALUES (${id}, ${dropId}, ${productId}, ${email}, ${name}, ${createdAt}::timestamptz)
  `);
  return id;
}

async function deliveries(dropId: string) {
  const r = await t.db.execute(sql`
    SELECT email, status, attempts, provider_id, last_error FROM product_drop_deliveries
    WHERE drop_id = ${dropId} ORDER BY email
  `);
  return r.rows as Array<{ email: string; status: string; attempts: number; provider_id: string | null; last_error: string | null }>;
}

async function dropRow(dropId: string) {
  const r = await t.db.execute(sql`SELECT status, notified_at FROM product_drops WHERE id = ${dropId}`);
  return r.rows[0] as { status: string; notified_at: string | null };
}

function recordingSender(impl?: (to: string) => { sent: boolean; id?: string; reason?: string }) {
  const calls: string[] = [];
  const send = async (opts: { to: string }) => {
    calls.push(opts.to);
    const r = impl?.(opts.to) ?? { sent: true, id: `msg-${calls.length}` };
    return r;
  };
  return { calls, send };
}

const dueDrop = (dropId: string, productId: string): DueProductDrop => ({
  id: dropId,
  productId,
  title: "Midnight Pack",
  creatorName: "Queen Creator",
  creatorSlug: "queen-creator",
  dropAt: DROP_AT,
});

describe("due-drop selection + live flip", () => {
  it("only scheduled drops whose moment has arrived are due; cancelled and future drops are not", async () => {
    const due = await seedDrop();
    await seedDrop({ drop_at: new Date("2026-12-01T00:00:00Z") });
    await seedDrop({ status: "cancelled" });
    await seedDrop({ status: "live" });

    const rows = await store.listDueDrops(NOW);
    expect(rows.map((r) => r.id)).toEqual([due.dropId]);
    expect(rows[0]).toMatchObject({ productId: due.productId, title: "Midnight Pack", creatorName: "Queen Creator" });
  });

  it("never publishes early: a drop one minute out is not due and cannot be claimed live by the sweep", async () => {
    const { dropId } = await seedDrop({ drop_at: new Date(NOW.getTime() + 60_000) });
    const sender = recordingSender();
    const r = await sweepDueProductDrops({ store, send: sender.send, now: NOW });
    expect(r.drops).toBe(0);
    expect(sender.calls).toHaveLength(0);
    expect((await dropRow(dropId)).status).toBe("scheduled");
  });

  it("claimLive is winner-only: the second claim loses", async () => {
    const { dropId } = await seedDrop();
    expect(await store.claimLive(dropId, NOW)).toBe(true);
    expect(await store.claimLive(dropId, NOW)).toBe(false);
    expect((await dropRow(dropId)).status).toBe("live");
  });
});

describe("drop-day fan-out", () => {
  it("flips live and emails every eligible fan exactly once — a restart + replay sends nothing twice", async () => {
    const { dropId, productId } = await seedDrop();
    await seedCapture(dropId, productId, "a@fan.test", "2026-11-01T00:00:00Z");
    await seedCapture(dropId, productId, "b@fan.test", "2026-11-05T00:00:00Z");
    await seedCapture(dropId, productId, "c@fan.test", "2026-11-10T12:00:00Z"); // drop-day, inside grace
    const sender = recordingSender();

    const first = await sweepDueProductDrops({ store, send: sender.send, now: NOW });
    expect(first).toMatchObject({ drops: 1, captures: 3, sent: 3, failed: 0 });
    expect(sender.calls.sort()).toEqual(["a@fan.test", "b@fan.test", "c@fan.test"]);
    const rows = await deliveries(dropId);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect(rows.every((r) => r.provider_id && r.attempts === 1)).toBe(true);
    const dr = await dropRow(dropId);
    expect(dr.status).toBe("live");
    expect(dr.notified_at).not.toBeNull();

    /* Restart: fresh store instance, same durable rows, sweep again. */
    const store2 = createDrizzleProductDropNotifyStore(t.db as never);
    const second = await sweepDueProductDrops({ store: store2, send: sender.send, now: NOW });
    expect(second).toMatchObject({ drops: 0, sent: 0 });
    expect(sender.calls).toHaveLength(3);
  });

  it("excludes fans who captured long after the drop — they joined the list, not the drop list", async () => {
    const { dropId, productId } = await seedDrop();
    await seedCapture(dropId, productId, "early@fan.test", "2026-11-01T00:00:00Z");
    await seedCapture(dropId, productId, "late@fan.test", "2026-11-16T00:00:00Z"); // 6 days after
    const sender = recordingSender();

    const r = await notifyDropFansForDrop(dueDrop(dropId, productId), { store, send: sender.send, now: NOW });
    expect(r.captures).toBe(1);
    expect(sender.calls).toEqual(["early@fan.test"]);
  });

  it("failure isolation + retry sweep: a refusal retries to sent on the live-drop retry pass; the sent fan is never re-emailed", async () => {
    const { dropId, productId } = await seedDrop();
    await seedCapture(dropId, productId, "good@fan.test", "2026-11-01T00:00:00Z");
    await seedCapture(dropId, productId, "flaky@fan.test", "2026-11-02T00:00:00Z");

    let flakyFixed = false;
    const sender = recordingSender((to) => {
      if (to === "flaky@fan.test" && !flakyFixed) return { sent: false, reason: "provider-error" };
      return { sent: true, id: "msg-ok" };
    });

    const first = await sweepDueProductDrops({ store, send: sender.send, now: NOW });
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    let rows = await deliveries(dropId);
    expect(rows.find((r) => r.email === "flaky@fan.test")).toMatchObject({ status: "failed", last_error: "provider-error", attempts: 1 });

    flakyFixed = true;
    const second = await sweepDueProductDrops({ store, send: sender.send, now: new Date(NOW.getTime() + 20 * 60 * 1000) });
    expect(second).toMatchObject({ sent: 1, failed: 0 });
    rows = await deliveries(dropId);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(sender.calls.filter((c) => c === "good@fan.test")).toHaveLength(1);
  });

  it("no-provider gap: attempts ledger 'failed' with the reason, cap turns the row 'dead', then no more attempts", async () => {
    const { dropId, productId } = await seedDrop();
    await seedCapture(dropId, productId, "a@fan.test", "2026-11-01T00:00:00Z");
    const sender = recordingSender(() => ({ sent: false, reason: "no-provider" }));

    for (let pass = 0; pass < 3; pass++) {
      await notifyDropFansForDrop(dueDrop(dropId, productId), { store, send: sender.send, now: NOW, maxAttempts: 3 });
    }
    const rows = await deliveries(dropId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "dead", attempts: 3, last_error: "no-provider" });
    expect(sender.calls).toHaveLength(3);

    const fourth = await notifyDropFansForDrop(dueDrop(dropId, productId), { store, send: sender.send, now: NOW, maxAttempts: 3 });
    expect(fourth).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(sender.calls).toHaveLength(3);
  });

  it("racing fan-outs still email each fan exactly once", async () => {
    const { dropId, productId } = await seedDrop();
    await seedCapture(dropId, productId, "a@fan.test", "2026-11-01T00:00:00Z");
    await seedCapture(dropId, productId, "b@fan.test", "2026-11-02T00:00:00Z");
    const sender = recordingSender();

    await Promise.all([
      notifyDropFansForDrop(dueDrop(dropId, productId), { store, send: sender.send, now: NOW }),
      notifyDropFansForDrop(dueDrop(dropId, productId), { store, send: sender.send, now: NOW }),
    ]);
    expect(sender.calls.sort()).toEqual(["a@fan.test", "b@fan.test"]);
    const rows = await deliveries(dropId);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("graceful degradation: with the drop tables missing, the sweep returns empty totals and never throws", async () => {
    const bare = createTestDb();
    const bareStore = createDrizzleProductDropNotifyStore(bare.db as never);
    const sender = recordingSender();
    const r = await sweepDueProductDrops({ store: bareStore, send: sender.send, now: NOW });
    expect(r).toEqual({ drops: 0, captures: 0, sent: 0, failed: 0, skipped: 0 });
    expect(sender.calls).toHaveLength(0);
  });
});

describe("buildProductDropEmail", () => {
  it("carries the product link and escapes creator-controlled strings", () => {
    const mail = buildProductDropEmail(
      {
        id: "d1",
        productId: "11111111-1111-4111-8111-111111111111",
        title: 'Midnight <script>alert(1)</script> Pack',
        creatorName: "Queen & Co",
        creatorSlug: "queen-co",
        dropAt: DROP_AT,
      },
      { email: "fan@test", name: "Jo <Fan>" },
    );
    expect(mail.to).toBe("fan@test");
    expect(mail.subject).toContain("Midnight");
    expect(mail.html).toContain("/storefront/product/11111111-1111-4111-8111-111111111111");
    expect(mail.html).not.toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Queen &amp; Co");
    expect(mail.html).toContain("Jo &lt;Fan&gt;");
    expect(mail.text).toContain("/storefront/product/11111111-1111-4111-8111-111111111111");
  });
});
