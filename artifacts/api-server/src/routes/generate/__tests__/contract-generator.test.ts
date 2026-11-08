/**
 * Contract Generator rail (Stack 300, crew 29 — owner ruling Nov 7,
 * 2026: "Build it — contract generation too").
 *
 * The generator mirrors the analyzer rail's charging discipline:
 * charge BEFORE the model call, refund in full when generation
 * fails. These tests fake the credits seam and the AI client at
 * their module boundaries and pin:
 *  - the status endpoint reports the charged constant itself, so the
 *    displayed price IS the charged price (price-display parity);
 *  - success → one charge at CONTRACT_GENERATION_CREDITS, no refund,
 *    and the returned draft carries the house disclaimer verbatim
 *    (prepended by the rail when the model leaves it out);
 *  - provider failure / unparseable output → full refund, 500;
 *  - out of credits → 402 before any charge sticks;
 *  - invalid input → 400, never charged;
 *  - the template family is the analyzer's 7 types, unchanged.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-contract-gen-1";

/* The analyzer's legal copy, pinned verbatim — the generator reuses
   it and may never drift from it. */
const ANALYZER_DISCLAIMER =
  "This is an AI reading, not legal advice. Have an entertainment lawyer review before signing anything.";

const h = vi.hoisted(() => ({
  balance: 1000,
  charges: [] as Array<{ cost: number; action: string }>,
  refunds: [] as Array<{ cost: number; action: string }>,
  events: [] as string[],
  /* The ledger's landed idempotency keys — the mock charge honors
     them exactly like the real one: a replay under a landed key is
     an idempotent success and records NO second charge. */
  landedKeys: new Set<string>(),
  providerMode: "ok" as "ok" | "fail" | "garbage" | "no-disclaimer" | "empty-draft",
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
    chargeCredits: vi.fn(
      async (
        _userId: string,
        cost: number,
        rec: { action: string },
        opts?: { idempotencyKey?: string | null },
      ) => {
        const key = opts?.idempotencyKey?.trim() || null;
        if (key && h.landedKeys.has(key)) {
          h.events.push("charge-suppressed");
          return h.balance;
        }
        if (h.balance < cost) throw new actual.OutOfCreditsError();
        h.balance -= cost;
        if (key) h.landedKeys.add(key);
        h.charges.push({ cost, action: rec.action });
        h.events.push("charge");
        return h.balance;
      },
    ),
    refundCredits: vi.fn(async (_userId: string, cost: number, rec: { action: string }) => {
      h.balance += cost;
      h.refunds.push({ cost, action: rec.action });
      h.events.push("refund");
    }),
    voidChargeIdempotencyKey: vi.fn(async (key: string) => {
      const had = h.landedKeys.delete(key);
      if (had) h.events.push("void");
      return had;
    }),
  };
});

vi.mock("../../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.events.push("ai");
          if (h.providerMode === "fail") throw new Error("provider exploded");
          if (h.providerMode === "garbage") {
            return { choices: [{ message: { content: "not json at all" } }] };
          }
          if (h.providerMode === "empty-draft") {
            return {
              choices: [
                { message: { content: JSON.stringify({ title: "X", draft: "   ", summary: "" }) } },
              ],
            };
          }
          const withDisclaimer = h.providerMode === "ok";
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Brand Sponsorship Agreement",
                    draft: withDisclaimer
                      ? "This draft is not legal advice. Have an entertainment lawyer review before signing.\n\nBRAND SPONSORSHIP AGREEMENT\n\n1. Parties…"
                      : "BRAND SPONSORSHIP AGREEMENT\n\n1. Parties…",
                    summary: "Drafted from your deal points; payment timing left blank.",
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

import contractGeneratorRouter, {
  CONTRACT_GENERATION_CREDITS,
  CONTRACT_TYPES,
  CONTRACT_DISCLAIMER,
  generateSchema,
} from "../contract-generator";

let server: any;
let base = "";

const GOOD_BODY = {
  contractType: "brand-deal",
  creatorName: "Thy Cheat Code",
  counterpartyName: "Example Brand LLC",
  paymentTerms: "$5,000 flat, half up front, half on delivery",
  term: "6 months",
  territory: "Worldwide",
  exclusivity: "Non-exclusive",
  rightsGranted: "Two sponsored posts and one story, 30-day usage",
  termination: "Either side, 14 days written notice",
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/contracts", contractGeneratorRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.balance = 1000;
  h.charges = [];
  h.refunds = [];
  h.events = [];
  h.landedKeys.clear();
  h.providerMode = "ok";
});

async function postGenerate(body: unknown) {
  const res = await fetch(`${base}/contracts/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

describe("contract generator — status (displayed price == charged price)", () => {
  it("reports the charged constant, the analyzer's 7 types, and the verbatim disclaimer", async () => {
    const res = await fetch(`${base}/contracts/generate/status`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(CONTRACT_GENERATION_CREDITS).toBe(300);
    expect(data.creditCost).toBe(CONTRACT_GENERATION_CREDITS);
    expect(data.contractTypes.map((t: any) => t.key)).toEqual([
      "record-deal",
      "brand-deal",
      "sync-license",
      "management",
      "publishing",
      "distribution",
      "other",
    ]);
    expect(data.disclaimer).toBe(ANALYZER_DISCLAIMER);
    expect(CONTRACT_DISCLAIMER).toBe(ANALYZER_DISCLAIMER);
    expect([...CONTRACT_TYPES]).toEqual([
      "record-deal",
      "brand-deal",
      "sync-license",
      "management",
      "publishing",
      "distribution",
      "other",
    ]);
  });
});

describe("contract generator — charge / refund discipline", () => {
  it("success: charges once at the constant BEFORE the model call, never refunds", async () => {
    const { status, data } = await postGenerate(GOOD_BODY);
    expect(status).toBe(200);
    expect(h.charges).toEqual([{ cost: CONTRACT_GENERATION_CREDITS, action: "Contract Generation" }]);
    expect(h.refunds).toEqual([]);
    expect(h.events).toEqual(["charge", "ai"]);
    expect(h.balance).toBe(1000 - CONTRACT_GENERATION_CREDITS);
    expect(data.creditsCharged).toBe(CONTRACT_GENERATION_CREDITS);
    expect(data.contractType).toBe("brand-deal");
    expect(data.disclaimer).toBe(ANALYZER_DISCLAIMER);
    expect(data.generation.title).toBe("Brand Sponsorship Agreement");
    expect(data.generation.draft).toContain("BRAND SPONSORSHIP AGREEMENT");
  });

  it("a draft the model already framed is returned without a doubled disclaimer", async () => {
    const { status, data } = await postGenerate(GOOD_BODY);
    expect(status).toBe(200);
    expect(data.generation.draft.startsWith(ANALYZER_DISCLAIMER)).toBe(false);
    expect(data.generation.draft).toContain("not legal advice");
  });

  it("a draft missing the framing gets the verbatim disclaimer prepended by the rail", async () => {
    h.providerMode = "no-disclaimer";
    const { status, data } = await postGenerate(GOOD_BODY);
    expect(status).toBe(200);
    expect(data.generation.draft.startsWith(ANALYZER_DISCLAIMER)).toBe(true);
  });

  it("provider failure: 500, full refund, balance restored", async () => {
    h.providerMode = "fail";
    const { status, data } = await postGenerate(GOOD_BODY);
    expect(status).toBe(500);
    expect(data.error).toBe("generation_failed");
    expect(h.refunds).toEqual([
      { cost: CONTRACT_GENERATION_CREDITS, action: "Contract Generation (refund: generation failed)" },
    ]);
    expect(h.balance).toBe(1000);
  });

  it("unparseable model output: 500, full refund", async () => {
    h.providerMode = "garbage";
    const { status } = await postGenerate(GOOD_BODY);
    expect(status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.balance).toBe(1000);
  });

  it("empty draft from the model: treated as failure — 500, full refund", async () => {
    h.providerMode = "empty-draft";
    const { status } = await postGenerate(GOOD_BODY);
    expect(status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.balance).toBe(1000);
  });

  it("out of credits: 402, nothing charged, nothing refunded, model never called", async () => {
    h.balance = CONTRACT_GENERATION_CREDITS - 1;
    const { status, data } = await postGenerate(GOOD_BODY);
    expect(status).toBe(402);
    expect(data.error).toBe("out_of_credits");
    expect(h.charges).toEqual([]);
    expect(h.refunds).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("invalid input (no creator name): 400, never charged", async () => {
    const { status, data } = await postGenerate({ ...GOOD_BODY, creatorName: "  " });
    expect(status).toBe(400);
    expect(data.error).toBe("invalid_input");
    expect(h.charges).toEqual([]);
  });
});

describe("contract generator — exactly-once (idempotency)", () => {
  it("the same client intent key submitted twice charges exactly once", async () => {
    const body = { ...GOOD_BODY, idempotencyKey: "gen-intent-abc12345" };
    const first = await postGenerate(body);
    const second = await postGenerate(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.balance).toBe(1000 - CONTRACT_GENERATION_CREDITS);
    expect(second.data.generation.draft).toContain("BRAND SPONSORSHIP AGREEMENT");
  });

  it("a keyless identical retry derives the same key and charges once", async () => {
    const first = await postGenerate(GOOD_BODY);
    const second = await postGenerate(GOOD_BODY);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.balance).toBe(1000 - CONTRACT_GENERATION_CREDITS);
  });

  it("different deal points are a different intent — charged separately", async () => {
    await postGenerate(GOOD_BODY);
    const other = await postGenerate({ ...GOOD_BODY, term: "12 months" });
    expect(other.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(1000 - 2 * CONTRACT_GENERATION_CREDITS);
  });

  it("a refunded failure voids its key — the retry with the same key charges fresh", async () => {
    const body = { ...GOOD_BODY, idempotencyKey: "gen-intent-retry-99" };
    h.providerMode = "fail";
    const failed = await postGenerate(body);
    expect(failed.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.balance).toBe(1000);
    h.providerMode = "ok";
    const retried = await postGenerate(body);
    expect(retried.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(1000 - CONTRACT_GENERATION_CREDITS);
  });
});

describe("contract generator — schema", () => {
  it("requires both parties, defaults the optional deal points", () => {
    const ok = generateSchema.safeParse({
      contractType: "record-deal",
      creatorName: "A",
      counterpartyName: "B",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.paymentTerms).toBe("");
      expect(ok.data.term).toBe("");
    }
    expect(generateSchema.safeParse({ creatorName: "A" }).success).toBe(false);
    expect(
      generateSchema.safeParse({ creatorName: "A", counterpartyName: "B", contractType: "nope" })
        .success,
    ).toBe(false);
  });
});
