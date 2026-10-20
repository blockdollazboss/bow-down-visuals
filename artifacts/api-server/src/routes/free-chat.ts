import { Router } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { buildChatSystemPrompt } from "../lib/ai-chat-assistant";
import {
  OPERATOR_KB,
  findFeatures,
  findInventedPrice,
  PRICE_FALLBACK_REPLY,
  type OperatorFeature,
} from "../lib/operator-knowledge";

const router = Router();

/* Contract with the website chat widget:
   POST /api/free-chat { message, history? } → 200 { reply }
   - message: string, 1–2000 chars
   - history: optional array of { role: "user" | "assistant", content: string }, max 6 turns
   - always FREE: no auth, no credit charge (pricing for chat is an owner
     decision; this route stays free until he rules otherwise)

   Brain (Cloud Operator): the system prompt is the SAME operator prompt
   /api/chat uses — persona + rules + grounding built per message from the
   generated feature knowledge base (lib/operator-knowledge.ts). There is
   no hand-typed fact sheet in this file anymore: the old hardcoded prompt
   quoted pre-x100 pack prices and stale claims, and the keyword-FAQ that
   backed it up carried the same era's facts. Both are deleted.

   Answer path:
   1. Free-tier model provider — if its API key env var is set. The reply
      passes through the shared no-invention price guard before it ships.
   2. Local fallback — a reply composed from the knowledge base itself
      (lib/operator-knowledge data, read at runtime), so it cannot drift
      from the operator's facts. No external calls. */

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

const chatSchema = z.object({
  message: z.string().min(1, "Message is required.").max(2000, "Message is too long (max 2000 characters)."),
  history: z.array(historyItemSchema).max(6, "Too many history turns (max 6).").optional().default([]),
});

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 45_000;

interface ChatMessage {
  role: string;
  content: string;
}

function extractReply(data: unknown): string {
  const choices = (data as { choices?: { message?: { content?: string } }[] })?.choices;
  const reply = choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("Empty reply from AI provider");
  }
  return reply;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`AI provider error ${res.status}: ${text.slice(0, 200)}`);
      (err as NodeJS.ErrnoException & { status?: number }).status = res.status;
      throw err;
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not set");
  }
  const data = await postJson(
    GROQ_URL,
    { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    {
      model: "openai/gpt-oss-120b",
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }
  );
  return extractReply(data);
}

/* ─── Local fallback, composed from the operator knowledge base ──────────
   Every fact below — names, paths, descriptions, prices, pack sizes — is
   read from the generated KB at runtime. Nothing is hand-typed, so this
   fallback stays exactly as current as the operator's own knowledge. */

function describeFeature(f: OperatorFeature): string {
  const sentences: string[] = [`${f.name} — ${f.path}`];
  if (f.description) sentences.push(f.description);
  if (f.prices.length > 0) {
    const prices = f.prices
      .slice(0, 6)
      .map((p) => (p.vb === 0 ? `${p.feature}: free` : `${p.feature}: ${p.vb.toLocaleString("en-US")} Visual Bucs`));
    sentences.push(`Prices: ${prices.join("; ")}.`);
  }
  if (f.guide) {
    sentences.push(`Open the page and tap "Walk me through it" for a step-by-step guide.`);
  }
  if (f.nextSteps.length > 0) {
    sentences.push(`Next step after that: ${f.nextSteps[0].label} (${f.nextSteps[0].path}).`);
  }
  return sentences.join(" ");
}

function packFacts(): string {
  return `Visual Buc packs come in ${OPERATOR_KB.packs.map((p) => p.label).join(", ")} — dollar prices are set at checkout on the Pricing page (/pricing).`;
}

function getKnowledgeReply(userMessage: string): string {
  const matches = findFeatures(userMessage);
  const asksAboutPacks = /\b(packs?|pricing|credits?|visual bucs?|bucs?)\b/i.test(userMessage);

  if (matches.length > 0) {
    const parts = matches.slice(0, 2).map(describeFeature);
    if (asksAboutPacks) parts.push(packFacts());
    return parts.join("\n");
  }
  if (asksAboutPacks) {
    return `${packFacts()} Every tool's exact price in Visual Bucs is on its page before you spend anything — ask me about a specific tool and I'll give you its price.`;
  }
  return "I don't have that one — I'm Thy Cheat Code, and I can help with anything that IS on Bow Down Visuals: making songs and videos, branding, promoting your work, and getting paid. Ask me about a tool, what it costs, or how to get started. For account problems, the Contact page (/contact) is the fastest door. 🦈";
}

/** Try the model provider first (if its key is set), then fall back to the
    knowledge-base reply. Whichever path answered, the reply passes the
    shared no-invention price guard before it ships — the same treatment
    /api/chat gets (Cloud Operator Phase 1). */
async function getChatReply(messages: ChatMessage[]): Promise<{ reply: string; provider: string }> {
  let result: { reply: string; provider: string } | null = null;

  const groqKey = process.env["GROQ_API_KEY"];
  if (groqKey) {
    try {
      const reply = await callGroq(messages);
      result = { reply, provider: "groq" };
    } catch (err) {
      logger.warn({ err }, "[chat] Groq failed, falling back to knowledge base");
    }
  }

  if (!result) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    result = { reply: getKnowledgeReply(lastUserMsg), provider: "knowledge-base" };
  }

  const invented = findInventedPrice(result.reply);
  if (invented !== null) {
    logger.warn(
      { invented, provider: result.provider },
      "[chat] free-chat reply quoted a price outside the knowledge base — replaced",
    );
    return { reply: PRICE_FALLBACK_REPLY, provider: `${result.provider}+guard` };
  }
  return result;
}

router.post("/free-chat", publicApiLimiter, async (req, res) => {
  const parsed = chatSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid chat request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { message, history } = parsed.data;

  const messages: { role: string; content: string }[] = [
    { role: "system", content: buildChatSystemPrompt(message) },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message.trim() },
  ];

  try {
    const { reply, provider } = await getChatReply(messages);
    logger.info({ provider }, "[chat] reply generated");
    res.json({ reply });
  } catch (err: unknown) {
    logger.error({ err }, "[chat] failed to get chatbot reply");
    if (err instanceof Error && err.name === "AbortError") {
      res.status(504).json({ error: "The assistant took too long to respond. Please try again." });
      return;
    }
    res.status(502).json({ error: "The assistant is temporarily unavailable. Please try again later." });
  }
});

export default router;
