/**
 * upscale-generative (Q182 / ruling A-05) — the 1,500 VB price is
 * OFFICIAL everywhere, and no placeholder mechanism remains:
 *
 *  - GET /api/ai-upscale/status reports creditCost 1,500 (== the rail
 *    constant) and classicCost 300, and carries NO `pricePlaceholder`
 *    property at all — the field was removed, not flipped (the API
 *    must never again self-describe the ruled price as a placeholder)
 *  - unconfigured provider → 503, no charge
 *  - balance < 1,500 → 402 quoting 1,500 needed, no charge, no submit
 *  - success → exactly one charge of exactly 1,500 VB; the job records
 *    creditsCharged 1,500 (displayed/quoted == charged == 1,500)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  balance: 5000,
  charges: [] as number[],
  refunds: [] as number[],
  configured: true,
  submitCalls: 0,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: { userId?: string; userCredits?: number }, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    req.userCredits = state.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {
    readonly code = "OUT_OF_CREDITS";
  }
  class LedgerWriteError extends Error {
    readonly code = "LEDGER_ERROR";
  }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    chargeCredits: async (_userId: string, cost: number) => {
      if (state.balance < cost) throw new OutOfCreditsError("out_of_credits");
      state.balance -= cost;
      state.charges.push(cost);
      return state.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      state.balance += amount;
      state.refunds.push(amount);
      return state.balance;
    },
  };
});

vi.mock("../../lib/generative-upscale-client", () => {
  class GenerativeUpscaleNotConfiguredError extends Error {
    readonly code = "GENERATIVE_UPSCALE_NOT_CONFIGURED";
    constructor() {
      super("not configured");
      this.name = "GenerativeUpscaleNotConfiguredError";
    }
  }
  return {
    GenerativeUpscaleNotConfiguredError,
    generativeUpscaleConfigured: () => state.configured,
    submitGenerativeUpscale: async () => {
      state.submitCalls += 1;
      return { providerJobId: "provider-job-1", status: "done", videoUrl: "https://cdn.example/upscaled.mp4" };
    },
  };
});

import upscaleGenerativeRouter, {
  GENERATIVE_UPSCALE_CREDIT_COST,
  __clearGenerativeUpscaleJobs,
} from "../generate/upscale-generative";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(upscaleGenerativeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  state.balance = 5000;
  state.charges = [];
  state.refunds = [];
  state.configured = true;
  state.submitCalls = 0;
  __clearGenerativeUpscaleJobs();
});

async function post(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const validBody = { sourceVideoUrl: "https://videos.example/source.mp4", target: "1080p" };

describe("GET /ai-upscale/status — Q182: official price, no placeholder mechanism", () => {
  it("reports 1,500 VB and NO pricePlaceholder property", async () => {
    const res = await fetch(`${base}/ai-upscale/status`);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json["configured"]).toBe(true);
    expect(json["creditCost"]).toBe(1500);
    expect(json["creditCost"]).toBe(GENERATIVE_UPSCALE_CREDIT_COST);
    expect(json["classicCost"]).toBe(300);
    expect(json).not.toHaveProperty("pricePlaceholder");
    expect(JSON.stringify(json)).not.toMatch(/placeholder/i);
  });

  it("still reports the official 1,500 (and no placeholder) when unconfigured", async () => {
    state.configured = false;
    const res = await fetch(`${base}/ai-upscale/status`);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json["configured"]).toBe(false);
    expect(json["creditCost"]).toBe(1500);
    expect(json).not.toHaveProperty("pricePlaceholder");
  });
});

describe("POST /ai-upscale — charge rail agrees at 1,500 VB", () => {
  it("unconfigured → 503, no charge, no submit", async () => {
    state.configured = false;
    const r = await post("/ai-upscale", validBody);
    expect(r.status).toBe(503);
    expect(r.json?.["error"]).toBe("GENERATIVE_UPSCALE_NOT_CONFIGURED");
    expect(state.charges).toEqual([]);
    expect(state.submitCalls).toBe(0);
  });

  it("balance 1,499 → 402 quoting 1,500 needed, no charge, no submit", async () => {
    state.balance = 1499;
    const r = await post("/ai-upscale", validBody);
    expect(r.status).toBe(402);
    expect(r.json?.["error"]).toBe("OUT_OF_CREDITS");
    expect(r.json?.["creditsNeeded"]).toBe(1500);
    expect(state.charges).toEqual([]);
    expect(state.submitCalls).toBe(0);
  });

  it("success charges exactly 1,500 VB once; job records creditsCharged 1,500", async () => {
    const r = await post("/ai-upscale", validBody);
    expect(r.status).toBe(202);
    expect(state.charges).toEqual([1500]);
    expect(state.balance).toBe(3500);

    const jobId = String(r.json?.["jobId"]);
    const deadline = Date.now() + 5_000;
    let job: Record<string, unknown> | null = null;
    for (;;) {
      const res = await fetch(`${base}/ai-upscale/${jobId}`);
      job = (await res.json()) as Record<string, unknown>;
      if (job["status"] === "done" || job["status"] === "failed") break;
      if (Date.now() > deadline) throw new Error("job never reached a terminal state");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(job["status"]).toBe("done");
    expect(job["creditsCharged"]).toBe(1500);
    expect(state.submitCalls).toBe(1);
    expect(state.refunds).toEqual([]);
  });
});
