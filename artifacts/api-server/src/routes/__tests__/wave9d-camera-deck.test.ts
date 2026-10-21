/**
 * Tests for the Director's Camera Deck routes (wave9d-camera.ts grown).
 *
 * Heavy modules (auth, credits ledger, OpenAI) are mocked; the real
 * Express router runs against a local ephemeral server. Covers:
 *  - GET /presets: the full 47-preset deck, free, with conflict map;
 *  - POST /prompt legacy shape: the model input is BYTE-IDENTICAL to
 *    the pre-deck route (system + user content), one 100 VB charge;
 *  - POST /prompt stack shape: a single legacy move via `moves` is ALSO
 *    byte-identical; a 3-stack composes in order under one charge;
 *  - conflicts / static / over-length / unknown / duplicate → 400 with
 *    the rule stated and ZERO charges;
 *  - provider failure on a stack → refund;
 *  - POST /design (Turbo Shot Designer): free proposal with reasons,
 *    illegal proposals adjusted openly, malformed → 502, never a charge.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userCredits: 1000,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  modelPayload: "A woven cinematic prompt.",
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

import router from "../wave9d-camera";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/wave9d/camera`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  testState.userId = "user-1";
  testState.userCredits = 1000;
  testState.chargeCalls = [];
  testState.refundCalls = [];
  testState.modelPayload = "A woven cinematic prompt.";
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
  return { status: res.status, json: (await res.json()) as any };
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, json: (await res.json()) as any };
}

/* The pre-deck system prompt, verbatim from the original route. */
const LEGACY_SYSTEM =
  "You are a cinematography prompt specialist for Bow Down Visuals. Your job is " +
  "to take an image-to-video prompt and weave a specific CAMERA MOVE into it so " +
  "the video model performs that camera motion. This is PROMPT ENRICHMENT only — " +
  "you never generate video.\n\n" +
  "Rules:\n" +
  "- Preserve the subject, action, lighting, and mood of the base prompt — " +
  "  enrich it, never replace it.\n" +
  "- Express the camera move with concrete video-model vocabulary " +
  "  (e.g. 'slow dolly push-in', 'smooth orbital arc', 'gentle rising crane').\n" +
  "- Match the requested INTENSITY — do not escalate a subtle move into a dramatic one.\n" +
  "- One paragraph, 60–150 words, present tense, comma-separated descriptive " +
  "  phrases. Plain text only, no markdown, no commentary.\n" +
  "Return ONLY the enriched prompt text, nothing else.";

const LEGACY_USER =
  "Camera move: ORBIT — the camera arcs in a slow circle around the subject, revealing them in three dimensions.\n" +
  "Intensity: DRAMATIC — bold, sweeping camera motion: maximum cinematic energy, make it a moment.\n" +
  "Scene context: rooftop stage — electric\n" +
  "Base prompt:\na singer owning a rooftop stage at dusk\n\n" +
  "Enrich the base prompt with the camera move.";

describe("GET /presets — the deck", () => {
  it("serves all 47 presets with categories, conflicts, and the stated rule — free", async () => {
    const { status, json } = await get("/presets");
    expect(status).toBe(200);
    expect(json.presets).toHaveLength(47);
    expect(json.maxStack).toBe(3);
    expect(json.stackRule).toContain("3 moves");
    expect(json.buildCredits).toBe(100);
    const ids = json.presets.map((p: any) => p.id);
    for (const legacy of ["dolly-in", "orbit", "crane-up", "handheld", "static-wide"]) {
      expect(ids).toContain(legacy);
    }
    const dollyIn = json.presets.find((p: any) => p.id === "dolly-in");
    expect(dollyIn.conflictsWith).toContain("dolly-out");
    expect(dollyIn.conflictsWith).toContain("static-wide");
    expect(testState.chargeCalls).toEqual([]);
  });
});

describe("POST /prompt — legacy byte-stability", () => {
  it("the legacy { move } shape builds the model input byte-identically", async () => {
    const { status, json } = await post("/prompt", {
      move: "orbit",
      intensity: "dramatic",
      basePrompt: "a singer owning a rooftop stage at dusk",
      sceneContext: "rooftop stage — electric",
    });
    expect(status).toBe(200);
    expect(json.enrichedPrompt).toBe("A woven cinematic prompt.");
    expect(json.creditsUsed).toBe(100);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 100 }]);

    const args = testState.lastCompletionArgs;
    expect(args.messages[0].content).toBe(LEGACY_SYSTEM);
    expect(args.messages[1].content).toBe(LEGACY_USER);
    expect(args.temperature).toBe(0.6);
    expect(args.max_completion_tokens).toBe(400);
  });

  it("a single legacy move sent as a stack is ALSO byte-identical", async () => {
    const { status } = await post("/prompt", {
      moves: [{ preset: "orbit" }],
      intensity: "dramatic",
      basePrompt: "a singer owning a rooftop stage at dusk",
      sceneContext: "rooftop stage — electric",
    });
    expect(status).toBe(200);
    const args = testState.lastCompletionArgs;
    expect(args.messages[0].content).toBe(LEGACY_SYSTEM);
    expect(args.messages[1].content).toBe(LEGACY_USER);
  });

  it("defaults hold: no intensity → natural, no scene context → no context line", async () => {
    const { status } = await post("/prompt", {
      move: "dolly-in",
      basePrompt: "a poet at a grand piano",
    });
    expect(status).toBe(200);
    const user = testState.lastCompletionArgs.messages[1].content as string;
    expect(user).toBe(
      "Camera move: DOLLY IN — the camera glides steadily toward the subject, closing distance with smooth, cinematic intent.\n" +
        "Intensity: NATURAL — confident, balanced camera motion that serves the scene without showboating.\n" +
        "Base prompt:\na poet at a grand piano\n\n" +
        "Enrich the base prompt with the camera move.",
    );
  });
});

describe("POST /prompt — stacks", () => {
  it("composes a 3-stack in order, under one 100 VB charge", async () => {
    const { status, json } = await post("/prompt", {
      moves: [{ preset: "snap-zoom" }, { preset: "orbit" }, { preset: "crane-up" }],
      intensity: "natural",
      basePrompt: "the singer hits the final note",
      sceneContext: "main stage — triumphant",
    });
    expect(status).toBe(200);
    expect(json.stacked).toBe(true);
    expect(json.moves.map((m: any) => m.preset)).toEqual(["snap-zoom", "orbit", "crane-up"]);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 100 }]);

    const args = testState.lastCompletionArgs;
    expect(args.messages[0].content).toContain("CAMERA STACK");
    const user = args.messages[1].content as string;
    expect(user).toContain("ONE continuous camera path");
    const i1 = user.indexOf("1. SNAP ZOOM");
    const i2 = user.indexOf("2. ORBIT");
    const i3 = user.indexOf("3. CRANE UP");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(user).toContain("Stack intensity: NATURAL");
    expect(user).toContain("Enrich the base prompt with the camera stack.");
  });

  it("refuses conflict, static-mixing, over-length, duplicate, unknown — 400, rule stated, zero charges", async () => {
    const cases: { body: any; mustContain: string[] }[] = [
      {
        body: { moves: [{ preset: "dolly-in" }, { preset: "dolly-out" }], basePrompt: "x scene" },
        mustContain: ["Dolly In", "Dolly Out", "opposite directions"],
      },
      {
        body: { moves: [{ preset: "static-wide" }, { preset: "orbit" }], basePrompt: "x scene" },
        mustContain: ["never moves"],
      },
      {
        body: {
          moves: [{ preset: "dolly-in" }, { preset: "orbit" }, { preset: "crane-up" }, { preset: "pan-left" }],
          basePrompt: "x scene",
        },
        mustContain: [],
      },
      {
        body: { moves: [{ preset: "orbit" }, { preset: "orbit" }], basePrompt: "x scene" },
        mustContain: ["already in the stack"],
      },
      {
        body: { moves: [{ preset: "moonwalk-cam" }], basePrompt: "x scene" },
        mustContain: ["Unknown camera move"],
      },
      {
        body: { move: "orbit", moves: [{ preset: "orbit" }], basePrompt: "x scene" },
        mustContain: ["not both"],
      },
    ];
    for (const c of cases) {
      const { status, json } = await post("/prompt", c.body);
      expect(status, JSON.stringify(c.body)).toBe(400);
      for (const s of c.mustContain) expect(json.error, JSON.stringify(c.body)).toContain(s);
    }
    expect(testState.chargeCalls).toEqual([]);
    expect(testState.lastCompletionArgs).toBeNull();
  });

  it("refunds the full charge when the provider fails on a stack", async () => {
    testState.modelThrows = true;
    const { status, json } = await post("/prompt", {
      moves: [{ preset: "orbit" }, { preset: "crane-up" }],
      basePrompt: "a drummer mid-solo",
    });
    expect(status).toBe(500);
    expect(json.refunded).toBe(true);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 100 }]);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 100 }]);
  });
});

describe("POST /design — Turbo Shot Designer", () => {
  it("returns a free proposal with per-move reasons, charging nothing", async () => {
    testState.modelPayload = JSON.stringify({
      stack: [
        { preset: "slow-creep", intensity: "subtle", reason: "The verse is fragile — let the tension creep." },
        { preset: "snap-zoom", intensity: "dramatic", reason: "The drop lands — punch in on the face." },
      ],
      summary: "Creep through the verse, strike on the drop.",
    });
    const { status, json } = await post("/design", {
      basePrompt: "a singer whispering a verse before the drop",
      sceneContext: "dark studio — tense",
    });
    expect(status).toBe(200);
    expect(json.creditsUsed).toBe(0);
    expect(json.adjusted).toBe(false);
    expect(json.proposal.moves).toHaveLength(2);
    expect(json.proposal.moves[0]).toMatchObject({
      preset: "slow-creep",
      intensity: "subtle",
      reason: "The verse is fragile — let the tension creep.",
    });
    expect(json.proposal.summary).toContain("Creep through the verse");
    expect(testState.chargeCalls).toEqual([]);
  });

  it("adjusts an illegal proposal openly — conflicts and unknown ids dropped with notes", async () => {
    testState.modelPayload = JSON.stringify({
      stack: [
        { preset: "dolly-in", intensity: "natural", reason: "Close in on the confession." },
        { preset: "dolly-out", intensity: "natural", reason: "Then pull away." },
        { preset: "warp-drive", intensity: "dramatic", reason: "?" },
        { preset: "orbit", intensity: "natural", reason: "Circle the aftermath." },
      ],
      summary: "In, out, around.",
    });
    const { status, json } = await post("/design", { basePrompt: "a confession scene" });
    expect(status).toBe(200);
    expect(json.adjusted).toBe(true);
    expect(json.proposal.moves.map((m: any) => m.preset)).toEqual(["dolly-in", "orbit"]);
    expect(json.notes.join(" ")).toContain("Dolly Out");
    expect(json.notes.join(" ")).toContain("warp-drive");
    expect(testState.chargeCalls).toEqual([]);
  });

  it("a malformed proposal → 502, honestly, still no charge", async () => {
    testState.modelPayload = "definitely not json";
    const { status, json } = await post("/design", { basePrompt: "any scene at all" });
    expect(status).toBe(502);
    expect(json.error).toContain("nothing was charged");
    expect(testState.chargeCalls).toEqual([]);
  });
});
