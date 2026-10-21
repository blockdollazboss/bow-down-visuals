/**
 * Viral Effects rail route pins (routes/generate/scene-effects.ts):
 *  - GET /scene-effects/recipes serves the full library + stack cap +
 *    the camera-move keyword map the client's conflict rule runs on;
 *  - POST /scene-effects/match returns PROPOSALS ONLY (applied: false,
 *    no task/generation fields, no charge fields) — the creator approves
 *    a pick in Scene Studio before anything is applied;
 *  - the matcher cites only trends the creator supplied: when AI polish
 *    invents a citation, the deterministic core's reason stands; when AI
 *    is down, the library match answers with source "library".
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  aiMode: "down" as "down" | "grounded" | "invented",
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => {
    if (h.aiMode === "down") throw new Error("OPENAI_API_KEY is not configured");
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    picks: [
                      h.aiMode === "grounded"
                        ? {
                            effectId: "earth-zoom-out",
                            trendReason:
                              'Riding "Earth zoom-out reveals" — the scale-flip opener is peaking with tracked creators right now.',
                            fitReason: "The rooftop scene begs for a scale reveal.",
                          }
                        : {
                            effectId: "earth-zoom-out",
                            trendReason:
                              'Riding "Underwater ASMR loops" — a totally made-up trend the creator never supplied.',
                            fitReason: "The rooftop scene begs for a scale reveal.",
                          },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    };
  },
  getTextModel: () => "test-model",
}));

import sceneEffectsRouter from "../scene-effects";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(sceneEffectsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  h.aiMode = "down";
});

const TREND = {
  trend: "Earth zoom-out reveals",
  confidence: 82,
  timeframe: "2-4 weeks",
  reasoning: "Creators open on a face, then reveal the whole city — the scale flip stops thumbs.",
  earlySignals: ["#earthzoom", "drone reveals"],
};

async function postMatch(body: unknown) {
  const res = await fetch(`${baseUrl}/scene-effects/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("GET /scene-effects/recipes", () => {
  it("serves the library, the stack cap, and the conflict keyword map", async () => {
    const res = await fetch(`${baseUrl}/scene-effects/recipes`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.recipes.length).toBeGreaterThanOrEqual(20);
    expect(json.maxStack).toBe(2);
    expect(Array.isArray(json.moveKeywords)).toBe(true);
    const bullet = json.recipes.find((r: any) => r.id === "bullet-time-freeze");
    expect(bullet.weave.length).toBeGreaterThanOrEqual(120);
    expect(bullet.conflictsWithMoves).toContain("static-wide");
  });
});

describe("POST /scene-effects/match", () => {
  it("AI down → library match, top proposal cites the supplied trend", async () => {
    const { status, json } = await postMatch({
      promptText: "Singer performs on a rooftop at night",
      mood: "epic",
      trends: [TREND],
    });
    expect(status).toBe(200);
    expect(json.source).toBe("library");
    expect(json.applied).toBe(false);
    expect(json.disclaimer).toContain("not a guarantee");
    const top = json.proposals[0];
    expect(top.effectId).toBe("earth-zoom-out");
    expect(top.trendReason).toContain("Earth zoom-out reveals");
    expect(top.trendReason).toContain("82% confidence");
    expect(top.bestFor.length).toBeGreaterThan(0);
  });

  it("proposals only: no generation or charge fields ride the response", async () => {
    const { json } = await postMatch({ promptText: "glitch edm drop performance", mood: "intense" });
    expect(json.taskId).toBeUndefined();
    expect(json.creditsUsed).toBeUndefined();
    expect(json.creditsRemaining).toBeUndefined();
    for (const p of json.proposals) {
      expect(p.trendReason === null || typeof p.trendReason === "string").toBe(true);
      expect(typeof p.fitReason).toBe("string");
    }
  });

  it("AI polish with a grounded citation → source ai, reason survives", async () => {
    h.aiMode = "grounded";
    const { status, json } = await postMatch({
      promptText: "Singer performs on a rooftop at night",
      mood: "epic",
      trends: [TREND],
    });
    expect(status).toBe(200);
    expect(json.source).toBe("ai");
    expect(json.proposals[0].effectId).toBe("earth-zoom-out");
    expect(json.proposals[0].trendReason).toContain("Earth zoom-out reveals");
    expect(json.proposals[0].fitReason).toContain("rooftop");
  });

  it("AI polish inventing a trend citation → the core's grounded reason stands", async () => {
    h.aiMode = "invented";
    const { status, json } = await postMatch({
      promptText: "Singer performs on a rooftop at night",
      mood: "epic",
      trends: [TREND],
    });
    expect(status).toBe(200);
    const top = json.proposals[0];
    expect(top.effectId).toBe("earth-zoom-out");
    expect(top.trendReason).not.toContain("Underwater ASMR");
    expect(top.trendReason).toContain("Earth zoom-out reveals");
  });

  it("no signals at all → honest starter proposals, no invented trend", async () => {
    const { status, json } = await postMatch({ promptText: "A quiet interview in a plain room" });
    expect(status).toBe(200);
    expect(json.proposals.length).toBe(3);
    for (const p of json.proposals) {
      expect(p.trendReason).toBeNull();
      expect(p.fitReason).toContain("proven viral starter");
    }
  });

  it("rejects a malformed trends payload", async () => {
    const { status } = await postMatch({ promptText: "x", trends: [{ trend: "", confidence: 900 }] });
    expect(status).toBe(400);
  });
});
