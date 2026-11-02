/**
 * QC-200 PRE-PROOF Q166 — the NEGATIVE rail (stack1200 qcproof-money-b).
 *
 * Ledger claim: routes/spotlight.ts and routes/loading-screen.ts are
 * storage-only — no Stripe import, no charge call anywhere in either
 * file; submitting one inquiry inserts exactly that inquiry and
 * produces ZERO Stripe sessions and ZERO Visual Bucs movement; the
 * served quotes are the ruled constants ($1,000 spotlight /
 * $2,500 loading screen).
 *
 * Proven two ways:
 *  1. STATIC — both route sources are read from disk and scanned for
 *     any Stripe / charge machinery (import or call).
 *  2. BEHAVIOURAL — both routers are mounted with a counting Stripe
 *     fake and a counting credits fake wired at the module boundary,
 *     plus a fake db recording inserts. One inquiry per rail must
 *     land exactly one inquiry row and move nothing.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  stripeSessionsCreated: 0,
  stripeClientsBuilt: 0,
  creditCharges: 0,
  creditRefunds: 0,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    constructor() {
      h.stripeClientsBuilt += 1;
    }
    checkout = {
      sessions: {
        create: async () => {
          h.stripeSessionsCreated += 1;
          return { id: "cs_should_never_exist", url: "https://checkout.example/never" };
        },
      },
    };
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => {
    h.creditCharges += 1;
    return 0;
  }),
  refundCredits: vi.fn(async () => {
    h.creditRefunds += 1;
    return 0;
  }),
  voidChargeIdempotencyKey: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        const name =
          table === actual.spotlightInquiriesTable
            ? "spotlight_inquiries"
            : table === actual.loadingScreenInquiriesTable
              ? "loading_screen_inquiries"
              : "unknown";
        h.inserts.push({ table: name, values });
        return [];
      },
    }),
  };
  return { ...actual, db: fakeDb };
});

import spotlightRouter from "../spotlight";
import loadingScreenRouter from "../loading-screen";
import { SPOTLIGHT_OFFER, LOADING_SCREEN_OFFER } from "@workspace/db";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("QC-200 Q166 — static: no money machinery in either route file", () => {
  it.each([
    ["spotlight", "../spotlight.ts"],
    ["loading-screen", "../loading-screen.ts"],
  ])("%s.ts contains no Stripe import and no charge call", (_name, rel) => {
    const src = readFileSync(path.join(here, rel), "utf8");
    expect(src).not.toMatch(/from\s+["']stripe["']/);
    expect(src).not.toMatch(/require\(["']stripe["']\)/);
    expect(src).not.toMatch(/stripe/i);
    expect(src).not.toMatch(/chargeCredits|refundCredits|createPaymentCheckout|checkout\.sessions\.create/);
    expect(src).not.toMatch(/SPONSOR|fee|commission/i);
  });

  it("the ruled quote constants are $1,000 and $2,500", () => {
    expect(SPOTLIGHT_OFFER.priceDollars).toBe(1000);
    expect(LOADING_SCREEN_OFFER.priceDollars).toBe(2500);
  });
});

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", spotlightRouter);
  app.use("/api", loadingScreenRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.inserts = [];
  h.stripeSessionsCreated = 0;
  h.stripeClientsBuilt = 0;
  h.creditCharges = 0;
  h.creditRefunds = 0;
});

async function call(method: string, p: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("QC-200 Q166 — behavioural: one inquiry moves no money", () => {
  it("spotlight: offer serves $1,000; one inquiry inserts one row, zero Stripe, zero VB", async () => {
    const offer = await call("GET", "/spotlight/offer");
    expect(offer.status).toBe(200);
    expect(offer.json.offer.priceDollars).toBe(1000);

    const res = await call("POST", "/spotlight/inquire", {
      name: "QC Proof",
      email: "qc@example.com",
      videoUrl: "https://cdn.example.com/promo.mp4",
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]!.table).toBe("spotlight_inquiries");
    expect(h.stripeSessionsCreated).toBe(0);
    expect(h.stripeClientsBuilt).toBe(0);
    expect(h.creditCharges).toBe(0);
    expect(h.creditRefunds).toBe(0);
  });

  it("loading screen: offer serves $2,500; one inquiry inserts one row, zero Stripe, zero VB", async () => {
    const offer = await call("GET", "/loading-screen/offer");
    expect(offer.status).toBe(200);
    expect(offer.json.offer.priceDollars).toBe(2500);

    const res = await call("POST", "/loading-screen/inquire", {
      name: "QC Proof",
      email: "qc@example.com",
      videoUrl: "https://cdn.example.com/intro.mp4",
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]!.table).toBe("loading_screen_inquiries");
    expect(h.stripeSessionsCreated).toBe(0);
    expect(h.stripeClientsBuilt).toBe(0);
    expect(h.creditCharges).toBe(0);
    expect(h.creditRefunds).toBe(0);
  });
});
