/**
 * Tests for POST /api/director-look — the AI Director proposal rail.
 *
 * The guarantees that matter:
 * - a proposal is validated against the rail vocabularies (invented keys
 *   from the model are dropped, never passed through),
 * - reasons ride along per accepted rail,
 * - an empty scene is a 400 (nothing to direct),
 * - a model reply with zero valid picks is a 502, not a fake proposal,
 * - the route is auth-gated and proposes only — it writes nothing.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "net";

const h = vi.hoisted(() => ({ completion: null as any, createCalls: [] as any[] }));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  freeAiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async (args: any) => {
          h.createCalls.push(args);
          if (h.completion instanceof Error) throw h.completion;
          return { choices: [{ message: { content: h.completion } }] };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
}));

import directorLookRouter, { parseDirectorProposal, directorVocabularyPrompt } from "../director-look";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use("/api", directorLookRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.completion = null;
  h.createCalls = [];
});

async function post(path: string, body: unknown, authed = true) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authed ? { "x-test-user": "user-1" } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const GOOD_REPLY = JSON.stringify({
  picks: { genre: "noir", era: "eighties", lens: "anamorphic", lighting: "neonNight", emotion: "tense" },
  reasons: {
    genre: "A rain-slick alley confession begs for noir shadows.",
    era: "The synth hook is pure 1985.",
    lens: "Anamorphic streaks sell the neon.",
    lighting: "Signage is the only light source here.",
    emotion: "The verse sits on a held breath.",
  },
});

describe("parseDirectorProposal", () => {
  it("parses a clean JSON reply", () => {
    const proposal = parseDirectorProposal(GOOD_REPLY);
    expect(proposal?.picks).toEqual({
      genre: "noir", era: "eighties", lens: "anamorphic", lighting: "neonNight", emotion: "tense",
    });
    expect(proposal?.reasons.genre).toContain("noir");
  });

  it("strips code fences and surrounding prose", () => {
    const proposal = parseDirectorProposal("Here you go:\n```json\n" + GOOD_REPLY + "\n```");
    expect(proposal?.picks.genre).toBe("noir");
  });

  it("drops invented keys and keeps the valid rails", () => {
    const proposal = parseDirectorProposal(JSON.stringify({
      picks: { genre: "western", aperture: "f1.8", lens: "tele85" },
      reasons: { lens: "Compression flatters the close-up." },
    }));
    expect(proposal?.picks).toEqual({ lens: "tele85" });
    expect(proposal?.reasons).toEqual({ lens: "Compression flatters the close-up." });
  });

  it("returns null when nothing valid survives", () => {
    expect(parseDirectorProposal(JSON.stringify({ picks: { genre: "western" } }))).toBeNull();
    expect(parseDirectorProposal("not json at all")).toBeNull();
    expect(parseDirectorProposal("")).toBeNull();
  });

  it("clips a runaway reason to one line", () => {
    const proposal = parseDirectorProposal(JSON.stringify({
      picks: { genre: "drama" },
      reasons: { genre: `word ${"x".repeat(500)}\nsecond line` },
    }));
    expect(proposal?.reasons.genre?.length).toBeLessThanOrEqual(200);
    expect(proposal?.reasons.genre).not.toContain("\n");
  });
});

describe("directorVocabularyPrompt", () => {
  it("lists every rail with its keys — and only its keys", () => {
    const text = directorVocabularyPrompt();
    for (const key of ["noir", "eighties", "anamorphic", "goldenHour", "melancholic"]) {
      expect(text).toContain(key);
    }
    expect(text).not.toContain("western");
  });
});

describe("POST /api/director-look", () => {
  it("401s without auth", async () => {
    const { status } = await post("/api/director-look", { prompt: "x" }, false);
    expect(status).toBe(401);
  });

  it("400s an empty scene — nothing to direct", async () => {
    const { status, body } = await post("/api/director-look", {});
    expect(status).toBe(400);
    expect(body.error).toContain("Describe the scene first");
    expect(h.createCalls).toHaveLength(0);
  });

  it("returns a validated proposal and sends the vocabularies to the model", async () => {
    h.completion = GOOD_REPLY;
    const { status, body } = await post("/api/director-look", {
      prompt: "the artist leans on a car in a rainy alley",
      mood: "",
    });
    expect(status).toBe(200);
    expect(body.proposal.picks.lens).toBe("anamorphic");
    expect(body.proposal.reasons.era).toContain("1985");
    const system = h.createCalls[0].messages[0].content as string;
    expect(system).toContain("anamorphic");
    expect(system).toContain("never invent keys");
  });

  it("502s when the model returns no valid picks", async () => {
    h.completion = JSON.stringify({ picks: { genre: "western" } });
    const { status, body } = await post("/api/director-look", { prompt: "a scene" });
    expect(status).toBe(502);
    expect(body.error).toContain("could not settle");
  });

  it("rejects an out-of-vocabulary currentLook on the wire", async () => {
    const { status } = await post("/api/director-look", {
      prompt: "a scene",
      currentLook: { genre: "western" },
    });
    expect(status).toBe(400);
  });
});
