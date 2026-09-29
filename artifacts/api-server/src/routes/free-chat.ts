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


/** Local FAQ fallback — works with zero external APIs. Matches keywords to answers. */
function getFaqReply(userMessage: string): string | null {
  const msg = userMessage.toLowerCase();

  // Greetings
  if (/^(hi|hey|hello|yo|sup|howdy|good\s?(morning|afternoon|evening))\b/.test(msg) && msg.length < 30) {
    return "Hey! Welcome to Bow Down Visuals. I can help with our AI tools, Visual Buc credit packs, booking, or how everything works — what do you want to know?";
  }

  // Pricing / Visual Buc packs
  if (/pric|pack|buc|cost|much|pay|price|\$/.test(msg)) {
    return "We offer Visual Buc credit packs: 10, 50, 150, and 500 Bucs, ranging from $39 to $249. Each AI tool costs a set number of Bucs per use. You can see the full breakdown and grab a pack on the Pricing page — want me to point you there?";
  }

  // Services / what they do
  if (/service|offer|what.*do|tool|create|make|video|music|content/.test(msg)) {
    return "Bow Down Visuals is an AI-powered creative studio. We offer 81 AI tools for creating music videos, content, graphics, and more. You use Visual Bucs to run the tools — pick a pack, choose your tool, and start creating. What kind of content are you looking to make?";
  }

  // Booking / get started / sign up
  if (/book|start|sign\s?up|join|register|account|claim|access/.test(msg)) {
    return "Getting started is easy: hit 'Claim your access' on the homepage to create your account, grab a Visual Buc pack that fits your needs, then dive into the Creator Vault and start making content. Anything specific you want help with?";
  }

  // Support / contact / help
  if (/support|contact|help|email|human|person|issue|problem/.test(msg)) {
    return "For support, email us at support@bowdownvisuals.com and we'll get back to you. If you're asking about the site or tools, I can probably help right here — what's going on?";
  }

  // How it works
  if (/how.*work|how.*it/.test(msg)) {
    return "It's 3 steps: 1) Claim your access and create an account. 2) Grab a Visual Buc pack. 3) Pick an AI tool from the Creator Vault and start creating. Each tool costs a few Bucs per use. Simple as that!";
  }

  // Thanks
  if (/thank|thanks|thx|appreciated/.test(msg)) {
    return "Anytime! Let me know if you need anything else.";
  }

  // Bye
  if (/^(bye|goodbye|see\s?ya|later)\b/.test(msg)) {
    return "See you soon! Come back anytime you need help.";
  }

  return null;
}

/** Try Groq → Pollinations POST → Pollinations GET → local FAQ. */
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

  try {
    const reply = await callPollinationsGet(messages);
    return { reply, provider: "pollinations-get" };
  } catch (err) {
    logger.warn({ err }, "[chat] Pollinations GET failed, falling back to local FAQ");
  }

  // Final fallback: local FAQ (no external API needed)
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
  const faqReply = getFaqReply(lastUserMsg);
  if (faqReply) {
    return { reply: faqReply, provider: "local-faq" };
  }
  // Generic fallback if no FAQ match
  return {
    reply: "I'm having trouble connecting right now, but I can still help! Ask me about our Visual Buc packs, AI tools, getting started, or support — or email support@bowdownvisuals.com.",
    provider: "local-fallback"
  };
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
