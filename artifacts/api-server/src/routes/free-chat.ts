import { Router } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

/* Contract with the website chat widget:
   POST /api/chat { message, history? } → 200 { reply }
   - message: string, 1–2000 chars
   - history: optional array of { role: "user" | "assistant", content: string }, max 6 turns
   Free tier providers (tried in order):
   1. Groq (https://api.groq.com) — if GROQ_API_KEY env var is set. Fast, reliable, generous free tier.
   2. Pollinations AI (https://text.pollinations.ai/openai) — no API key required.
   Set POLLINATIONS_API_KEY env var for higher Pollinations rate limits if available. */

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

const chatSchema = z.object({
  message: z.string().min(1, "Message is required.").max(2000, "Message is too long (max 2000 characters)."),
  history: z.array(historyItemSchema).max(6, "Too many history turns (max 6).").optional().default([]),
});

const SYSTEM_PROMPT = `You are the Bow Down Visuals sales assistant on bowdownvisuals.com. Bow Down Visuals is an AI music-and-video studio built around the artist blockdollazboss. You help visitors understand the services and decide what to buy.

Key facts:
- Tagline: "Your competitors will think you hired a team." / "THIS FEELS LIKE CHEATING. THAT'S THE POINT."
- Creator Vault: 81 AI tools for content creators.
- Visual Buc packs (one-time credit packs): 10 credits $39, 50 credits $149, 150 credits $249, 500 credits $499. Credits are used to generate songs, videos, thumbnails, promo clips, etc.
- Refer & Earn: 25% commission for referrals.
- Creator Academy: training for creators.
- Support email: support@bowdownvisuals.com.

Rules:
- Be concise, friendly, and helpful. Match the site's bold, confident tone but stay professional.
- Answer questions about services, pricing, how it works, and what credits buy.
- If asked something you don't know, say so and point them to support@bowdownvisuals.com.
- Never invent prices, features, or policies not listed above.
- Never ask for payment details, passwords, or personal information.
- Keep replies under 150 words unless the question needs more detail.`;

const POLLINATIONS_URL = "https://text.pollinations.ai/openai";
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
      model: "llama-3.1-8b-instant",
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }
  );
  return extractReply(data);
}

async function callPollinations(messages: ChatMessage[]): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env["POLLINATIONS_API_KEY"];
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const data = await postJson(
    POLLINATIONS_URL,
    headers,
    {
      model: "openai",
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }
  );
  return extractReply(data);
}

/**
 * Last-resort Pollinations fallback using the plain GET endpoint.
 * The ?system= query param currently triggers a server-side disk error,
 * so the system prompt is baked directly into the prompt text instead.
 */
async function callPollinationsGet(messages: ChatMessage[]): Promise<string> {
  const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
  const conversation = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const prompt = systemPrompt
    ? `${systemPrompt}\n\n${conversation}\nAssistant:`
    : `${conversation}\nAssistant:`;
  const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pollinations GET error ${res.status}: ${text.slice(0, 200)}`);
    }
    const text = (await res.text()).trim();
    // The GET endpoint may return a JSON error payload instead of text
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) throw new Error(`Pollinations GET error: ${parsed.error.slice(0, 200)}`);
      } catch {
        // Not JSON with an error field — treat as text below
      }
    }
    if (!text) {
      throw new Error("Empty reply from Pollinations GET endpoint");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Try Groq first (if key is set), then Pollinations POST, then Pollinations GET. */
async function getChatReply(messages: ChatMessage[]): Promise<{ reply: string; provider: string }> {
  const groqKey = process.env["GROQ_API_KEY"];
  if (groqKey) {
    try {
      const reply = await callGroq(messages);
      return { reply, provider: "groq" };
    } catch (err) {
      logger.warn({ err }, "[chat] Groq failed, falling back to Pollinations");
    }
  }

  try {
    const reply = await callPollinations(messages);
    return { reply, provider: "pollinations-openai" };
  } catch (err) {
    logger.warn({ err }, "[chat] Pollinations POST failed, falling back to Pollinations GET");
  }

  const reply = await callPollinationsGet(messages);
  return { reply, provider: "pollinations-get" };
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
    { role: "system", content: SYSTEM_PROMPT },
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
