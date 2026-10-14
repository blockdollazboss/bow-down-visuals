/**
 * Behavioral tests for the free-AI rate limiters (lib/rate-limit.ts).
 *
 * POST /api/improve-prompt and POST /api/improve-style are FREE (no
 * credit charge) but call the paid text model on every request. They
 * are capped by freeAiLimiter: 30 requests/hour per user, keyed on
 * the authenticated userId. These tests mount the REAL routers with
 * the REAL limiter, a mocked requireAuth (controllable user) and a
 * mocked OpenAI client (no network, no provider spend):
 *
 *   - under the limit, requests pass (200)
 *   - the 31st request in the hour is a 429 with the { error } shape
 *   - the budget is per-user: a second user is unaffected
 *   - the budget is shared across both improve endpoints (one
 *     limiter instance = one free-AI budget per user)
 *
 * A final block guards the wiring of the other free endpoints that
 * were capped in the same pass (source-shape assertions, following
 * the gamers.test.ts precedent).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testState = vi.hoisted(() => ({
  userId: "user-a" as string | null,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!testState.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = testState.userId;
    next();
  },
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "polished result" } }],
        }),
      },
    },
  }),
  getTextModel: () => "test-model",
}));

import improvePromptRouter from "../improve-prompt";
import improveStyleRouter from "../improve-style";

let baseUrl = "";
let server: ReturnType<typeof express.application.listen>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Minimal stand-in for pino-http's req.log, used on error paths.
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(improvePromptRouter);
  app.use(improveStyleRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(pathname: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe("freeAiLimiter on the improve endpoints", () => {
  it("lets a user under the hourly limit through on /improve-style (200)", async () => {
    testState.userId = "user-style";
    const res = await post("/improve-style", { style: "dark rb slow vibes" });
    expect(res.status).toBe(200);
    expect(res.json?.improvedStyle).toBe("polished result");
  });

  it("429s the same user once 30 free calls are used in the hour", async () => {
    testState.userId = "user-style";
    // 1 call already made above; 29 more reach the cap of 30.
    for (let i = 0; i < 29; i++) {
      const res = await post("/improve-style", { style: "dark rb slow vibes" });
      expect(res.status).toBe(200);
    }
    const over = await post("/improve-style", { style: "dark rb slow vibes" });
    expect(over.status).toBe(429);
    expect(over.json?.error).toMatch(/hourly limit/i);
  });

  it("shares one budget across both improve endpoints", async () => {
    testState.userId = "user-style"; // already at the cap from the test above
    const res = await post("/improve-prompt", { prompt: "a singer on stage" });
    expect(res.status).toBe(429);
  });

  it("does not limit a different user (per-user isolation)", async () => {
    testState.userId = "user-other";
    const style = await post("/improve-style", { style: "lofi chill beats" });
    expect(style.status).toBe(200);
    const prompt = await post("/improve-prompt", { prompt: "a singer on stage" });
    expect(prompt.status).toBe(200);
    expect(prompt.json?.improvedPrompt).toBe("polished result");
  });
});

describe("the other capped free endpoints stay wired", () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const cases: Array<[string, string]> = [
    ["routes/analyze-sections.ts", "freeAiLimiter"],
    ["routes/generate/ai-edit-plan.ts", "freeAiLimiter"],
    ["routes/generate/auto-edit.ts", "freeAiLimiter"],
    ["routes/transcribe.ts", "freeAiLimiter"],
    ["routes/generate/demo-clip.ts", "freeExpensiveAiLimiter"],
    ["routes/lip-sync.ts", "freeExpensiveAiLimiter"],
    ["routes/artist-voices.ts", "freeExpensiveAiLimiter"],
  ];
  for (const [rel, limiter] of cases) {
    it(`${rel} applies ${limiter}`, () => {
      const src = readFileSync(path.join(srcRoot, rel), "utf8");
      expect(src).toContain(`import { ${limiter} } from`);
      expect(src).toContain(limiter);
      // Applied in a route chain, not merely imported.
      expect(src).toMatch(new RegExp(`requireAuth,[^)]*${limiter}`));
    });
  }
});
