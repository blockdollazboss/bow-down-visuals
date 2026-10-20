/**
 * Cloud Operator Phase 2 Lane C — Tier 1 DOORS, driven over HTTP against
 * the REAL /api/chat and /api/free-chat routers (model client mocked for
 * /api/chat; the provider fetch stubbed for /api/free-chat, exactly as
 * the sibling grounding suites do).
 *
 * The door contract pinned here:
 * - a reply carries doors ONLY when the knowledge base matches the
 *   member's message to a feature with a real path — unmatched or
 *   gibberish messages get no `doors` key at all
 * - the open door's path is the feature's knowledge-base path VERBATIM
 *   (deep links — ?tab= / ?panel= — ride along untouched); the label is
 *   "Open <feature name>"
 * - a second door (kind "guide", label "Walk me through it", same path)
 *   rides ONLY when the matched feature's page has a guide
 * - at most two doors; doors are computed from the member's message by
 *   the shared implementation, so both routes attach identical doors to
 *   identical questions
 * - a reply replaced by the no-invention guard still carries its doors
 *   when a real match backs them (the door is the page that shows the
 *   true price); an unmatched invented-price reply gets none
 * - existing contracts are untouched: { reply, model, creditCost } on
 *   /api/chat, { reply } on /api/free-chat, doors purely additive
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
import freeChatRouter from "../free-chat";
import { buildReplyDoors } from "../../lib/operator-chat";
import {
  OPERATOR_FEATURES,
  PRICE_FALLBACK_REPLY,
} from "../../lib/operator-knowledge";

/* ── Servers ─────────────────────────────────────────────────────────── */

let chatServer: any;
let chatBase: string;
let freeServer: any;
let freeBase: string;

const PROVIDER_URL = "https://api.groq.com/openai/v1/chat/completions";
const realFetch = globalThis.fetch;
const provider = { reply: "All good, fin-friend. 🦈" };
let savedGroqKey: string | undefined;

beforeAll(async () => {
  savedGroqKey = process.env["GROQ_API_KEY"];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === PROVIDER_URL) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: provider.reply } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const app1 = express();
  app1.use(express.json());
  app1.use("/api", chatRouter);
  await new Promise<void>((resolve) => {
    chatServer = app1.listen(0, () => resolve());
  });
  chatBase = `http://127.0.0.1:${(chatServer.address() as AddressInfo).port}`;

  const app2 = express();
  app2.use(express.json());
  app2.use("/api", freeChatRouter);
  await new Promise<void>((resolve) => {
    freeServer = app2.listen(0, () => resolve());
  });
  freeBase = `http://127.0.0.1:${(freeServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (savedGroqKey === undefined) delete process.env["GROQ_API_KEY"];
  else process.env["GROQ_API_KEY"] = savedGroqKey;
  await new Promise<void>((resolve) => chatServer.close(() => resolve()));
  await new Promise<void>((resolve) => freeServer.close(() => resolve()));
});

beforeEach(() => {
  state.calls = [];
  state.reply = "All good, fin-friend. 🦈";
  provider.reply = "All good, fin-friend. 🦈";
  process.env["GROQ_API_KEY"] = "test-key";
});

async function post(base: string, path: string, message: string) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

function kbFeature(name: string) {
  const f = OPERATOR_FEATURES.find((x) => x.name === name);
  expect(f, `KB feature ${name}`).toBeTruthy();
  return f!;
}

/* ── The builder, unit-pinned ────────────────────────────────────────── */

describe("buildReplyDoors — the shared door contract", () => {
  it("a guided deep-link feature gets an open door + a guide door, path verbatim", () => {
    const f = kbFeature("Thumbnail Maker");
    expect(f.path).toBe("/thumbnail-studio?tab=generate");
    expect(f.guide).toBeTruthy();
    expect(buildReplyDoors("Take me to make a thumbnail")).toEqual([
      { kind: "open", label: "Open Thumbnail Maker", path: f.path },
      { kind: "guide", label: "Walk me through it", path: f.path },
    ]);
  });

  it("a guided plain-path feature gets both doors on its real path", () => {
    const f = kbFeature("Brand Deals");
    expect(buildReplyDoors("How do brand deals work?")).toEqual([
      { kind: "open", label: "Open Brand Deals", path: "/brand-deals" },
      { kind: "guide", label: "Walk me through it", path: "/brand-deals" },
    ]);
    expect(f.path).toBe("/brand-deals");
  });

  it("a feature with no guide gets exactly one door", () => {
    const f = kbFeature("Earnings");
    expect(f.guide).toBeUndefined();
    expect(buildReplyDoors("Show me my earnings")).toEqual([
      { kind: "open", label: "Open Earnings", path: "/earnings" },
    ]);
  });

  it("unmatched, gibberish, and empty messages get no doors", () => {
    expect(buildReplyDoors("Do you have a quantum flux capacitor?")).toEqual([]);
    expect(buildReplyDoors("asdf qwer zzzz")).toEqual([]);
    expect(buildReplyDoors("")).toEqual([]);
    expect(buildReplyDoors("yes")).toEqual([]);
  });

  /* Regression (Oct 20 staging verification): "Where is my music
     library?" answered correctly in text (My Music, /my-music) but the
     door under it opened AI Music Video Maker — the matcher had scored
     the message like a creation question because the possessive signal
     never reached it. These pins hold the locator family: the door must
     name the member's own collection page for the content they asked
     about, and creation/pricing questions must keep their doors. */
  it("a music-library locator gets the My Music door, not a creation tool", () => {
    const f = kbFeature("My Music");
    expect(f.path).toBe("/my-music");
    expect(buildReplyDoors("Where is my music library?")).toEqual([
      { kind: "open", label: "Open My Music", path: "/my-music" },
    ]);
    expect(buildReplyDoors("Where are my songs?")).toEqual([
      { kind: "open", label: "Open My Music", path: "/my-music" },
    ]);
  });

  it("a video-library locator gets the My Clips door", () => {
    const f = kbFeature("My Clips");
    expect(f.path).toBe("/my-projects?tab=myclips");
    expect(buildReplyDoors("Where is my video library?")).toEqual([
      { kind: "open", label: "Open My Clips", path: "/my-projects?tab=myclips" },
    ]);
    expect(buildReplyDoors("Where are my videos?")).toEqual([
      { kind: "open", label: "Open My Clips", path: "/my-projects?tab=myclips" },
    ]);
  });

  it("a music-video CREATION question keeps the maker door (no collection hijack)", () => {
    expect(buildReplyDoors("How do I make a music video?")).toEqual([
      { kind: "open", label: "Open AI Music Video Maker", path: "/tools/ai-music-video-maker" },
    ]);
  });

  it("a pricing question keeps its creation door", () => {
    expect(buildReplyDoors("How do I make a song, and what does it cost?")).toEqual([
      { kind: "open", label: "Open Make a Song", path: "/create?panel=song" },
      { kind: "guide", label: "Walk me through it", path: "/create?panel=song" },
    ]);
  });

  it("sweep: every door ever built points at a real KB path, verbatim, at most two", () => {
    const kbPaths = new Set(OPERATOR_FEATURES.map((f) => f.path));
    const kbNames = new Set(OPERATOR_FEATURES.map((f) => f.name));
    for (const f of OPERATOR_FEATURES) {
      const doors = buildReplyDoors(f.name);
      expect(doors.length).toBeLessThanOrEqual(2);
      for (const d of doors) {
        expect(kbPaths.has(d.path)).toBe(true);
      }
      if (doors.length) {
        expect(doors[0].kind).toBe("open");
        expect(doors[0].label.startsWith("Open ")).toBe(true);
        expect(kbNames.has(doors[0].label.slice("Open ".length))).toBe(true);
      }
      if (doors.length === 2) {
        expect(doors[1]).toEqual({
          kind: "guide",
          label: "Walk me through it",
          path: doors[0].path,
        });
        /* the guide door exists only because the matched feature has one */
        const matched = OPERATOR_FEATURES.find((x) => x.path === doors[0].path && x.name === doors[0].label.slice(5));
        expect(matched?.guide).toBeTruthy();
      }
    }
  });
});

/* ── /api/chat over HTTP ─────────────────────────────────────────────── */

describe("POST /api/chat — doors ride the reply", () => {
  it("a thumbnail answer carries the desk door and the guide door", async () => {
    const { status, json } = await post(chatBase, "/api/chat", "Take me to make a thumbnail");
    expect(status).toBe(200);
    expect(json.reply).toBe(state.reply);
    expect(json.model).toBe("test-model");
    expect(json.creditCost).toBe(0);
    expect(json.doors).toEqual([
      { kind: "open", label: "Open Thumbnail Maker", path: "/thumbnail-studio?tab=generate" },
      { kind: "guide", label: "Walk me through it", path: "/thumbnail-studio?tab=generate" },
    ]);
  });

  it("an unguided feature's answer carries exactly one door", async () => {
    const { json } = await post(chatBase, "/api/chat", "Show me my earnings");
    expect(json.doors).toEqual([
      { kind: "open", label: "Open Earnings", path: "/earnings" },
    ]);
  });

  it("the staging defect, end to end: a music-library answer carries the My Music door", async () => {
    const { status, json } = await post(chatBase, "/api/chat", "Where is my music library?");
    expect(status).toBe(200);
    expect(json.doors).toEqual([
      { kind: "open", label: "Open My Music", path: "/my-music" },
    ]);
  });

  it("an unmatched question carries no doors key at all", async () => {
    const { status, json } = await post(chatBase, "/api/chat", "Do you have a quantum flux capacitor?");
    expect(status).toBe(200);
    expect("doors" in json).toBe(false);
  });

  it("a guard-replaced reply keeps its doors when a real match backs them", async () => {
    state.reply = "That will cost you 999 VB, easy.";
    const { json } = await post(chatBase, "/api/chat", "How do I make a song, and what does it cost?");
    expect(json.reply).toBe(PRICE_FALLBACK_REPLY);
    expect(json.doors).toEqual([
      { kind: "open", label: "Open Make a Song", path: "/create?panel=song" },
      { kind: "guide", label: "Walk me through it", path: "/create?panel=song" },
    ]);
  });

  it("a guard-replaced reply with no match carries no doors", async () => {
    state.reply = "That will cost you 999 VB, easy.";
    const { json } = await post(chatBase, "/api/chat", "How much is the flux capacitor?");
    expect(json.reply).toBe(PRICE_FALLBACK_REPLY);
    expect("doors" in json).toBe(false);
  });
});

/* ── /api/free-chat over HTTP — same doors, same questions ───────────── */

describe("POST /api/free-chat — doors ride the reply", () => {
  it("provider path: a brand-deals answer carries both doors", async () => {
    const { status, json } = await post(freeBase, "/api/free-chat", "How do brand deals work?");
    expect(status).toBe(200);
    expect(json.reply).toBe(provider.reply);
    expect(json.doors).toEqual([
      { kind: "open", label: "Open Brand Deals", path: "/brand-deals" },
      { kind: "guide", label: "Walk me through it", path: "/brand-deals" },
    ]);
  });

  it("knowledge-base fallback: a song answer carries the panel door + guide door", async () => {
    delete process.env["GROQ_API_KEY"];
    const { status, json } = await post(
      freeBase,
      "/api/free-chat",
      "How do I make a song, and what does it cost?",
    );
    expect(status).toBe(200);
    expect(json.reply).toContain("Make a Song");
    expect(json.doors).toEqual([
      { kind: "open", label: "Open Make a Song", path: "/create?panel=song" },
      { kind: "guide", label: "Walk me through it", path: "/create?panel=song" },
    ]);
  });

  it("an unmatched question carries no doors key at all", async () => {
    const { status, json } = await post(freeBase, "/api/free-chat", "Do you have a quantum flux capacitor?");
    expect(status).toBe(200);
    expect("doors" in json).toBe(false);
  });

  it("both routes attach identical doors to the same question", async () => {
    const a = await post(chatBase, "/api/chat", "Take me to make a thumbnail");
    const b = await post(freeBase, "/api/free-chat", "Take me to make a thumbnail");
    expect(a.json.doors).toEqual(b.json.doors);
  });
});
