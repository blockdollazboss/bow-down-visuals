/**
 * Tests for the AI Page Designer (POST /api/ai-page-designer/*).
 *
 * Heavy modules (auth, credits ledger, OpenAI, Supabase) are mocked; the real
 * Express router runs against a local ephemeral server. Covers:
 *  - GET /vertical-hints: all 9 verticals, free, no auth charge
 *  - POST /theme: schema validation, 402 pre-check, 400 VB charge,
 *    hero-first enforcement, provider failure → refund + 502
 *  - POST /bio: 402 pre-check, 100 VB charge, happy path
 *  - POST /banner: 402 pre-check (upload/storage mocked out of scope)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userCredits: 1000,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  modelPayload: "",
  modelThrows: false,
  lastCompletionArgs: null as any,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = testState.userCredits;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: vi.fn(async (userId: string, amount: number) => {
    testState.chargeCalls.push({ userId, amount });
    testState.userCredits -= amount;
    return testState.userCredits;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number) => {
    testState.refundCalls.push({ userId, amount });
    testState.userCredits += amount;
  }),
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-6-sol",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async (args: any) => {
          testState.lastCompletionArgs = args;
          if (testState.modelThrows) throw new Error("provider exploded");
          return { choices: [{ message: { content: testState.modelPayload } }] };
        }),
      },
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("not used in these tests");
  },
}));

import router from "../ai-page-designer";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/ai-page-designer", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai-page-designer`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const VALID_DESIGN = {
  themeConfig: {
    themeId: "custom",
    colors: {
      background: "#0a0a0b", surface: "#121214", primary: "#d4af37", accent: "#f5d67b",
      text: "#f5f1e6", mutedText: "#a8a29e", cardBg: "#161618", border: "#2a2416",
    },
    fonts: { heading: "Cinzel", body: "Inter" },
    banner: { layout: "full-bleed", overlayOpacity: 0.5 },
    spacing: "comfortable",
    cornerRadius: "sharp",
  },
  sections: [
    { id: "videos-0", type: "videos", title: "Videos", visible: true },
    { id: "hero-0", type: "hero", title: "Featured", visible: true },
  ],
  rationale: "Stream-first, loud, unforgettable.",
};

beforeEach(() => {
  testState.userId = "user-1";
  testState.userCredits = 1000;
  testState.chargeCalls = [];
  testState.refundCalls = [];
  testState.modelPayload = JSON.stringify(VALID_DESIGN);
  testState.modelThrows = false;
  testState.lastCompletionArgs = null;
  vi.clearAllMocks();
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("GET /vertical-hints", () => {
  it("returns all 9 verticals with layout order, labels, voice, and tip", async () => {
    const res = await fetch(`${baseUrl}/vertical-hints?vertical=gaming`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.vertical).toBe("gaming");
    expect(json.verticals).toHaveLength(9);
    const ids = json.verticals.map((v: any) => v.id);
    for (const id of ["music", "video", "gaming", "podcast", "film", "tv", "influencer", "education", "other"]) {
      expect(ids).toContain(id);
    }
    const gaming = json.verticals.find((v: any) => v.id === "gaming");
    expect(gaming.sectionOrder[0]).toBe("hero");
    expect(gaming.sectionOrder).toContain("schedule");
    expect(typeof gaming.tip).toBe("string");
  });

  it("defaults to music on a bad vertical", async () => {
    const res = await fetch(`${baseUrl}/vertical-hints?vertical=nonsense`);
    const json = (await res.json()) as any;
    expect(json.vertical).toBe("music");
  });
});

describe("POST /theme", () => {
  const validBody = {
    vertical: "gaming",
    vibe: "High-octane neon arcade energy — clutch plays, loud chat, zero chill.",
    displayName: "FragMaster",
  };

  it("rejects a bad vertical and a too-short vibe", async () => {
    const bad = await post("/theme", { ...validBody, vertical: "chef" });
    expect(bad.status).toBe(400);
    const short = await post("/theme", { ...validBody, vibe: "cool" });
    expect(short.status).toBe(400);
  });

  it("402s when the balance is short — no charge attempted", async () => {
    testState.userCredits = 100;
    const r = await post("/theme", validBody);
    expect(r.status).toBe(402);
    expect(r.json.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toHaveLength(0);
  });

  it("charges 400 VB, enforces hero-first, and returns the design", async () => {
    const r = await post("/theme", validBody);
    expect(r.status).toBe(200);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 400 }]);
    expect(r.json.sections[0].type).toBe("hero");
    expect(r.json.themeConfig.colors.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(r.json.creditsUsed).toBe(400);
    /* Never max_tokens — always max_completion_tokens. */
    expect(testState.lastCompletionArgs.max_completion_tokens).toBeGreaterThan(0);
    expect(testState.lastCompletionArgs.max_tokens).toBeUndefined();
  });

  it("refunds on provider failure and 502s", async () => {
    testState.modelThrows = true;
    const r = await post("/theme", validBody);
    expect(r.status).toBe(502);
    expect(r.json.refunded).toBe(true);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 400 }]);
  });

  it("refunds when the model returns an unusable design", async () => {
    testState.modelPayload = JSON.stringify({ nope: true });
    const r = await post("/theme", validBody);
    expect(r.status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
  });
});

describe("POST /bio", () => {
  const validBody = {
    vertical: "influencer",
    displayName: "GlamGuide",
    facts: "500K followers, honest reviews, morning routines, brand collabs with streetwear labels.",
  };

  it("402s when short and charges 100 VB on success", async () => {
    testState.userCredits = 50;
    const short = await post("/bio", validBody);
    expect(short.status).toBe(402);

    testState.userCredits = 1000;
    testState.modelPayload = JSON.stringify({ bio: "GlamGuide keeps it real." });
    const r = await post("/bio", validBody);
    expect(r.status).toBe(200);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 100 }]);
    expect(r.json.bio).toContain("GlamGuide");
  });

  it("refunds on provider failure", async () => {
    testState.modelThrows = true;
    const r = await post("/bio", validBody);
    expect(r.status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
  });
});

describe("POST /banner", () => {
  it("402s when short — before any image call", async () => {
    testState.userCredits = 50;
    const r = await post("/banner", {
      vertical: "film",
      vibe: "Cinematic noir with gold light leaks.",
    });
    expect(r.status).toBe(402);
    expect(r.json.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toHaveLength(0);
  });

  it("400s on a bad vertical", async () => {
    const r = await post("/banner", { vertical: "chef", vibe: "Cinematic noir with gold light leaks." });
    expect(r.status).toBe(400);
  });
});
