/**
 * Cloud Operator Phase 1 — POST /api/chat driven over HTTP against the
 * REAL router, with only the model client mocked (it records the exact
 * system prompt it was handed and returns a scripted reply).
 *
 * Pins:
 * - grounding: the system prompt for a feature question carries that
 *   feature's verified facts (real path + code-sourced price + guide +
 *   journey handoff) and the full feature index
 * - no-invention: an unknown feature gets the honest-refusal grounding;
 *   a model reply quoting a VB figure that exists nowhere in the
 *   knowledge base is replaced, never shipped
 * - the stale hand-typed knowledge is gone (no dead prices, no provider
 *   names) and the route contract is unchanged ({ reply, model,
 *   creditCost }, /chat/status, 400 on a bad body)
 *
 * Free mode (CHAT_CREDIT_COST=0) is set before the router module loads,
 * so no auth or ledger is in play — the paid path is untouched by
 * Phase 1 and keeps its own behavior.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => {
  process.env.CHAT_CREDIT_COST = "0";
  return {
    reply: "All good, fin-friend. 🦈",
    calls: [] as { messages: { role: string; content: string }[] }[],
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async (args: any) => {
          state.calls.push(args);
          return { choices: [{ message: { content: state.reply } }] };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
}));

import chatRouter from "../chat";
import { PRICE_FALLBACK_REPLY } from "../../lib/operator-knowledge";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", chatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.calls = [];
  state.reply = "All good, fin-friend. 🦈";
});

async function postChat(message: string) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

function systemPrompt(): string {
  expect(state.calls.length).toBe(1);
  const sys = state.calls[0].messages.find((m) => m.role === "system");
  expect(sys).toBeTruthy();
  return sys!.content;
}

describe("POST /api/chat — operator grounding", () => {
  it("answers a song question with the song panel's verified facts", async () => {
    const { status, json } = await postChat("How do I make a song, and what does it cost?");
    expect(status).toBe(200);
    expect(json.model).toBe("test-model");
    expect(json.creditCost).toBe(0);
    const prompt = systemPrompt();
    expect(prompt).toContain("FEATURE INDEX");
    expect(prompt).toContain("VERIFIED FACTS");
    expect(prompt).toContain("/create?panel=song");
    expect(prompt).toContain("Generate Song — 400 Visual Bucs");
    // Guide handoff (deliverable 3): the Make a Song guide rides along.
    expect(prompt).toContain("Walk me through it");
    // Journey handoff: CREATE hands off to BRAND.
    expect(prompt).toContain("Branding Kit (/branding-kit)");
  });

  it("grounds brand-deal facts with finder price and guide", async () => {
    await postChat("How do brand deals work?");
    const prompt = systemPrompt();
    expect(prompt).toContain("/brand-deals");
    expect(prompt).toContain("Brand Deal Finder — 200 Visual Bucs");
    expect(prompt).toContain("Brand Deal Finder");
  });

  it("an unknown feature gets honest-refusal grounding, not invented facts", async () => {
    await postChat("Do you have a quantum flux capacitor?");
    const prompt = systemPrompt();
    expect(prompt).toContain("no feature in the index matches");
    expect(prompt).toContain("does not exist");
    expect(prompt).toContain("I don't have that one");
  });

  it("the persona is Thy Cheat Code and the stale knowledge is gone", async () => {
    await postChat("What is this site?");
    const prompt = systemPrompt();
    expect(prompt).toContain("You are Thy Cheat Code");
    // Dead facts from the old hand-typed knowledge block:
    expect(prompt).not.toContain("Seedance");
    expect(prompt).not.toContain("Sync Labs");
    expect(prompt).not.toContain("5 credits per song");
    expect(prompt).not.toContain("$9 = 10 credits");
    expect(prompt).not.toContain("GPT Image");
  });

  it("the knowledge-only limit is stated: no hands yet", async () => {
    await postChat("Make me a song right now.");
    const prompt = systemPrompt();
    expect(prompt).toContain("NO HANDS YET");
  });
});

describe("POST /api/chat — the no-invention guard on replies", () => {
  it("replaces a reply that quotes a price the knowledge base doesn't know", async () => {
    state.reply = "That will cost you 999 VB, easy.";
    const { status, json } = await postChat("How much is the flux capacitor?");
    expect(status).toBe(200);
    expect(json.reply).toBe(PRICE_FALLBACK_REPLY);
    expect(json.reply).not.toContain("999");
  });

  it("passes a reply whose figures are all knowledge-sourced", async () => {
    state.reply = "Making a song is 400 Visual Bucs — head to Create (/create?panel=song).";
    const { status, json } = await postChat("How much is a song?");
    expect(status).toBe(200);
    expect(json.reply).toBe(state.reply);
  });
});

describe("POST /api/chat — contract unchanged", () => {
  it("400s an empty message", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/chat/status still reports the per-message cost", async () => {
    const res = await fetch(`${baseUrl}/api/chat/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ creditCost: 0 });
  });
});
