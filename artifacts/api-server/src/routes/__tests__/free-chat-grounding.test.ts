/**
 * Free-chat grounding (Stack-4 fix lane) — POST /api/free-chat driven over
 * HTTP against the REAL router.
 *
 * The route's model provider is reached through the global fetch; the stub
 * below intercepts ONLY the provider URL (recording the exact messages it
 * was handed and returning a scripted reply) and delegates everything else
 * to the real fetch. With no provider key set, the route answers from its
 * local fallback — which must be composed from the operator knowledge
 * base, never from hand-typed facts.
 *
 * Pins:
 * - grounding: the provider receives the SAME operator system prompt
 *   /api/chat uses (persona + feature index + verified facts for the
 *   matched feature, real path + code-sourced price)
 * - the dead facts are gone: the pre-x100 pack strings ("10 Visual Bucs
 *   — $9" … "500 Visual Bucs — $249"), "81 AI tools" and "25% commission"
 *   appear neither in the route source nor in any shipped reply
 * - no-invention: a provider reply quoting a VB figure the knowledge base
 *   doesn't vouch for is replaced by the shared PRICE_FALLBACK_REPLY
 * - fallback: with no provider (or a failed provider call), price and
 *   pack answers are composed from the knowledge base — KB figures only,
 *   pack sizes with no dollar prices; an unknown feature gets the honest
 *   no-match answer
 * - contract unchanged: { message, history? } → 200 { reply }, the same
 *   400 shape, the same 6-turn history cap, still free (no charge path)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

import freeChatRouter from "../free-chat";
import { PRICE_FALLBACK_REPLY } from "../../lib/operator-knowledge";

const PROVIDER_URL = "https://api.groq.com/openai/v1/chat/completions";
const realFetch = globalThis.fetch;

const state = {
  reply: "All good, fin-friend. 🦈",
  providerFails: false,
  calls: [] as { messages: { role: string; content: string }[] }[],
};

let server: any;
let baseUrl: string;
let savedGroqKey: string | undefined;

beforeAll(async () => {
  savedGroqKey = process.env["GROQ_API_KEY"];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === PROVIDER_URL) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      state.calls.push(body);
      if (state.providerFails) {
        return new Response("provider down", { status: 500 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: state.reply } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use("/api", freeChatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (savedGroqKey === undefined) delete process.env["GROQ_API_KEY"];
  else process.env["GROQ_API_KEY"] = savedGroqKey;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.calls = [];
  state.reply = "All good, fin-friend. 🦈";
  state.providerFails = false;
  process.env["GROQ_API_KEY"] = "test-key";
});

afterEach(() => {
  delete process.env["GROQ_API_KEY"];
});

async function postFreeChat(body: unknown) {
  const res = await realFetch(`${baseUrl}/api/free-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

function systemPrompt(): string {
  expect(state.calls.length).toBe(1);
  const sys = state.calls[0].messages.find((m) => m.role === "system");
  expect(sys).toBeTruthy();
  return sys!.content;
}

const DEAD_FRAGMENTS = [
  "10 Visual Bucs — $9",
  "50 Visual Bucs — $39",
  "150 Visual Bucs — $99",
  "500 Visual Bucs — $249",
  "81 AI tools",
  "25% commission",
];

describe("POST /api/free-chat — operator grounding (provider path)", () => {
  it("hands the provider the operator prompt with the song's verified facts", async () => {
    const { status, json } = await postFreeChat({ message: "How do I make a song, and what does it cost?" });
    expect(status).toBe(200);
    expect(Object.keys(json)).toEqual(["reply"]);
    const prompt = systemPrompt();
    expect(prompt).toContain("You are Thy Cheat Code");
    expect(prompt).toContain("FEATURE INDEX");
    expect(prompt).toContain("VERIFIED FACTS");
    expect(prompt).toContain("/create?panel=song");
    expect(prompt).toContain("Generate Song — 400 Visual Bucs");
    expect(prompt).toContain("Walk me through it");
    for (const dead of DEAD_FRAGMENTS) expect(prompt).not.toContain(dead);
    expect(prompt).not.toContain("Groq");
  });

  it("passes a reply whose figures are all knowledge-sourced", async () => {
    state.reply = "Making a song is 400 Visual Bucs — head to Create (/create?panel=song).";
    const { status, json } = await postFreeChat({ message: "How much is a song?" });
    expect(status).toBe(200);
    expect(json.reply).toBe(state.reply);
  });

  it("replaces a reply that quotes a price the knowledge base doesn't know", async () => {
    state.reply = "Easy — the flux pack runs 999 Visual Bucs.";
    const { status, json } = await postFreeChat({ message: "How much is the flux pack?" });
    expect(status).toBe(200);
    expect(json.reply).toBe(PRICE_FALLBACK_REPLY);
    expect(json.reply).not.toContain("999");
  });

  it("the old pack strings can never ship, even if the model recites them", async () => {
    state.reply =
      "Visual Buc packs: 10 Visual Bucs — $9, 50 Visual Bucs — $39, 150 Visual Bucs — $99, 500 Visual Bucs — $249.";
    const { status, json } = await postFreeChat({ message: "What packs do you sell?" });
    expect(status).toBe(200);
    expect(json.reply).toBe(PRICE_FALLBACK_REPLY);
    for (const dead of DEAD_FRAGMENTS) expect(json.reply).not.toContain(dead);
    expect(json.reply).not.toContain("$");
  });

  it("an unknown feature gets honest-refusal grounding, not invented facts", async () => {
    await postFreeChat({ message: "Do you have a quantum flux capacitor?" });
    const prompt = systemPrompt();
    expect(prompt).toContain("no feature in the index matches");
    expect(prompt).toContain("I don't have that one");
  });
});

describe("POST /api/free-chat — knowledge-base fallback (no provider)", () => {
  beforeEach(() => {
    delete process.env["GROQ_API_KEY"];
  });

  it("answers a song price question from the knowledge base", async () => {
    const { status, json } = await postFreeChat({ message: "How much does it cost to make a song?" });
    expect(status).toBe(200);
    expect(json.reply).toContain("Make a Song");
    expect(json.reply).toContain("/create?panel=song");
    expect(json.reply).toContain("Generate Song: 400 Visual Bucs");
    for (const dead of DEAD_FRAGMENTS) expect(json.reply).not.toContain(dead);
    expect(json.reply).not.toContain("$");
  });

  it("answers a pack question with KB pack sizes and no dollar prices", async () => {
    const { status, json } = await postFreeChat({ message: "What Visual Buc packs can I buy?" });
    expect(status).toBe(200);
    expect(json.reply).toContain("1,000 Visual Bucs");
    expect(json.reply).toContain("50,000 Visual Bucs");
    expect(json.reply).not.toContain("$");
    for (const dead of DEAD_FRAGMENTS) expect(json.reply).not.toContain(dead);
  });

  it("an unknown feature gets the honest no-match answer, with no figures", async () => {
    const { status, json } = await postFreeChat({ message: "Do you have a quantum flux capacitor?" });
    expect(status).toBe(200);
    expect(json.reply).toContain("I don't have that one");
    expect(json.reply).not.toMatch(/\d[\d,]*\s*(VB|Visual Bucs)/);
  });

  it("a failed provider call falls back to the knowledge base, not an error", async () => {
    process.env["GROQ_API_KEY"] = "test-key";
    state.providerFails = true;
    const { status, json } = await postFreeChat({ message: "How much does it cost to make a song?" });
    expect(status).toBe(200);
    expect(json.reply).toContain("Make a Song");
    expect(json.reply).toContain("400 Visual Bucs");
  });
});

describe("POST /api/free-chat — contract unchanged", () => {
  it("400s an empty message with the same error shape", async () => {
    const { status, json } = await postFreeChat({ message: "" });
    expect(status).toBe(400);
    expect(json.error).toBe("Invalid chat request.");
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("400s history beyond the 6-turn cap", async () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));
    const { status } = await postFreeChat({ message: "hi", history });
    expect(status).toBe(400);
  });

  it("forwards history turns to the provider in order, user message last and trimmed", async () => {
    const history = [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ];
    const { status } = await postFreeChat({ message: "  follow up  ", history });
    expect(status).toBe(200);
    expect(state.calls.length).toBe(1);
    const messages = state.calls[0].messages;
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[1].content).toBe("earlier question");
    expect(messages[2].content).toBe("earlier answer");
    expect(messages[3].content).toBe("follow up");
  });

  it("the route source carries none of the dead facts and keeps the rate limiter", () => {
    const source = readFileSync(fileURLToPath(new URL("../free-chat.ts", import.meta.url)), "utf8");
    for (const dead of DEAD_FRAGMENTS) expect(source).not.toContain(dead);
    expect(source).not.toContain("sales assistant");
    expect(source).not.toContain("getFaqReply");
    expect(source).not.toContain("SYSTEM_PROMPT");
    expect(source).toContain('router.post("/free-chat", publicApiLimiter');
    // The shared operator seams are imported, not forked:
    expect(source).toContain('from "../lib/ai-chat-assistant"');
    expect(source).toContain('from "../lib/operator-knowledge"');
  });
});
