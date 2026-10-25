/**
 * Copyright Assistant refund-on-failure leg (D5, payments sweep).
 *
 * Both paid endpoints charge BEFORE the model call (chargeOr402). Before
 * this leg, a provider failure answered 502/503 and KEPT the member's
 * 100 VB — a silent charge. These tests fake the credits seam and the
 * AI client at their module boundaries and pin:
 *  - provider failure on /draft → refundCredits called with the full
 *    draft cost, response says the Bucs were refunded;
 *  - provider failure on /ask → same for the ask cost;
 *  - success → NO refund, charge stands.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-copyright-1";

const h = vi.hoisted(() => ({
  balance: 1000,
  charges: [] as Array<{ cost: number; action: string }>,
  refunds: [] as Array<{ cost: number; action: string }>,
  providerFails: true,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    next();
  },
}));

vi.mock("../../../lib/credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeCredits: vi.fn(async (_userId: string, cost: number, rec: { action: string }) => {
      if (h.balance < cost) throw new actual.OutOfCreditsError();
      h.balance -= cost;
      h.charges.push({ cost, action: rec.action });
      return h.balance;
    }),
    refundCredits: vi.fn(async (_userId: string, cost: number, rec: { action: string }) => {
      h.balance += cost;
      h.refunds.push({ cost, action: rec.action });
    }),
  };
});

vi.mock("../../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          if (h.providerFails) throw new Error("provider exploded");
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    description: "A formal description of the work.",
                    filingNotes: ["File the Standard Application"],
                    answer: "Here is the answer.",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  }),
}));

import copyrightRouter from "../copyright";

let server: any;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", copyrightRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.balance = 1000;
  h.charges = [];
  h.refunds = [];
  h.providerFails = true;
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const DRAFT_BODY = {
  workType: "song",
  title: "Midnight Crown",
  authors: "Jane Doe",
  creationDate: "2026",
  published: false,
  publishedDate: "",
  notes: "",
};

describe("copyright refund-on-failure leg (D5)", () => {
  it("draft: provider failure refunds the full 100 VB and says so", async () => {
    const r = await post("/copyright/draft", DRAFT_BODY);
    expect(r.status).toBe(502);
    expect(r.json.error).toContain("refunded");
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([
      { cost: 100, action: "Copyright Assistant Draft (provider failure refund)" },
    ]);
    expect(h.balance).toBe(1000);
  });

  it("ask: provider failure refunds the full 100 VB and says so", async () => {
    const r = await post("/copyright/ask", { question: "Who owns a beat I bought?", history: [] });
    expect(r.status).toBe(502);
    expect(r.json.error).toContain("refunded");
    expect(h.refunds).toEqual([
      { cost: 100, action: "Copyright Assistant Ask (provider failure refund)" },
    ]);
    expect(h.balance).toBe(1000);
  });

  it("draft success: the charge stands and nothing is refunded", async () => {
    h.providerFails = false;
    const r = await post("/copyright/draft", DRAFT_BODY);
    expect(r.status).toBe(200);
    expect(r.json.description).toContain("formal description");
    expect(h.refunds).toHaveLength(0);
    expect(h.balance).toBe(900);
  });
});
