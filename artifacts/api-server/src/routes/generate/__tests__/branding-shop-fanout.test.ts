/**
 * Branding order fan-out (stack1100 Y3). Printful webhook status
 * flips used to update branding_orders silently. Pins: the buyer is
 * told through the door seam when the status actually changes
 * (shipped with tracking, delivered, failed, canceled), duplicate
 * webhook deliveries stay silent (the flip is a status-change
 * claim), non-buyer-facing statuses (in_production) build no event,
 * and failed/canceled copy never promises a refund (no refund fires
 * on this rail).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router, {
  __setBrandingEventNotifier,
  buildBrandingOrderEvent,
  tellBrandingBuyer,
} from "../branding-shop";
import type { UserEventInput } from "../../../lib/push-events";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE branding_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  total_cents integer NOT NULL DEFAULT 0,
  name text, email text, address text, city text, state text, zip text,
  status text NOT NULL DEFAULT 'received',
  provider text, provider_order_id text,
  tracking_number text, tracking_url text,
  stripe_session_id text,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
const BUYER = randomUUID();
const PROVIDER_ORDER = "998877";

let events: UserEventInput[];

beforeAll(async () => {
  delete process.env["PRINTFUL_WEBHOOK_SECRET"];
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  __setBrandingEventNotifier(null);
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  testState.db = db;
  events = [];
  __setBrandingEventNotifier(async (input) => {
    events.push(input);
  });
  await testState.db.execute(sql`
    INSERT INTO branding_orders (id, user_id, status, provider_order_id)
    VALUES (${randomUUID()}, ${BUYER}, 'in_production', ${PROVIDER_ORDER})
  `);
});

async function webhook(type: string, shipment?: Record<string, string>) {
  const r = await realFetch(`${baseUrl}/branding-shop/webhooks/printful`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data: { order: { id: 998877 }, ...(shipment ? { shipment } : {}) } }),
  });
  return r.status;
}

describe("buildBrandingOrderEvent", () => {
  it("builds buyer-facing events for shipped/delivered/failed/canceled — money category, shop link", () => {
    const shipped = buildBrandingOrderEvent({ userId: "u", status: "shipped", trackingNumber: "1Z999" });
    expect(shipped).toMatchObject({ userId: "u", category: "money", kind: "branding_order_shipped", link: "/branding-kit?tab=shop" });
    expect(shipped!.body).toContain("1Z999");
    expect(buildBrandingOrderEvent({ userId: "u", status: "delivered" })?.kind).toBe("branding_order_delivered");
    expect(buildBrandingOrderEvent({ userId: "u", status: "failed" })?.kind).toBe("branding_order_failed");
    expect(buildBrandingOrderEvent({ userId: "u", status: "canceled" })?.kind).toBe("branding_order_canceled");
  });

  it("builds nothing for production-stage statuses", () => {
    expect(buildBrandingOrderEvent({ userId: "u", status: "in_production" })).toBeNull();
    expect(buildBrandingOrderEvent({ userId: "u", status: "received" })).toBeNull();
    expect(buildBrandingOrderEvent({ userId: "u", status: "pending_fulfillment" })).toBeNull();
  });

  it("failed/canceled copy never promises a refund", () => {
    for (const status of ["failed", "canceled"]) {
      const e = buildBrandingOrderEvent({ userId: "u", status });
      expect(e!.body.toLowerCase()).not.toContain("refund");
    }
  });

  it("tellBrandingBuyer routes through the seam and swallows failures", async () => {
    await tellBrandingBuyer({ userId: BUYER, status: "delivered" });
    expect(events).toHaveLength(1);
    __setBrandingEventNotifier(async () => {
      throw new Error("door exploded");
    });
    await expect(tellBrandingBuyer({ userId: BUYER, status: "delivered" })).resolves.toBeUndefined();
  });
});

describe("the Printful webhook", () => {
  it("a shipped event tells the buyer once — the duplicate delivery stays silent, tracking still lands", async () => {
    expect(await webhook("package_shipped", { tracking_number: "1Z999", tracking_url: "https://track.example/1Z999" })).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: BUYER, kind: "branding_order_shipped" });
    expect(events[0]!.body).toContain("1Z999");

    expect(await webhook("package_shipped", { tracking_number: "1Z999", tracking_url: "https://track.example/1Z999" })).toBe(200);
    expect(events).toHaveLength(1);

    const rows = await testState.db.execute(sql`SELECT status, tracking_number FROM branding_orders WHERE provider_order_id = ${PROVIDER_ORDER}`);
    expect(rows.rows[0]!["status"]).toBe("shipped");
    expect(rows.rows[0]!["tracking_number"]).toBe("1Z999");
  });

  it("delivered and failed transitions each tell once", async () => {
    expect(await webhook("package_shipped", { tracking_number: "1Z999" })).toBe(200);
    expect(await webhook("order_delivered")).toBe(200);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["branding_order_shipped", "branding_order_delivered"]);

    await testState.db.execute(sql`UPDATE branding_orders SET status = 'in_production' WHERE provider_order_id = ${PROVIDER_ORDER}`);
    expect(await webhook("order_failed")).toBe(200);
    expect(events.map((e) => e.kind)).toContain("branding_order_failed");
  });
});
