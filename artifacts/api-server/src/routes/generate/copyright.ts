import { Router, type Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Copyright Filing Assistant ──────────────────────────────────────────
   AI layer for the /copyright page (per the standing "everything AI-powered"
   rule). Two paid endpoints, both 1 credit on GPT-6:

   POST /api/copyright/draft — work details in, AI-written formal "description
     of work" + filing notes out (what application to pick, what deposit to
     upload, authorship/AI-disclosure notes).
   POST /api/copyright/ask  — "Ask about copyright" Q&A box.

   The form itself is free UI; only the AI calls cost credits. Both endpoints
   follow the hook-studio money pattern: balance pre-check, deduct BEFORE the
   model call, 402 when broke. Uses max_completion_tokens (GPT-6 does not
   accept max_tokens). */

export const COPYRIGHT_DRAFT_CREDITS = Number(process.env["COPYRIGHT_DRAFT_CREDIT_COST"]) || 1;
export const COPYRIGHT_ASK_CREDITS = Number(process.env["COPYRIGHT_ASK_CREDIT_COST"]) || 1;

export const WORK_TYPES = [
  "song",
  "sound-recording",
  "lyrics",
  "music-video",
  "album",
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export function isWorkTypeKey(v: unknown): v is WorkType {
  return typeof v === "string" && (WORK_TYPES as readonly string[]).includes(v);
}

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  song: "Song (musical composition — melody + lyrics)",
  "sound-recording": "Sound recording (the recorded track/master)",
  lyrics: "Lyrics (words only, no melody claimed)",
  "music-video": "Music video (audiovisual work)",
  album: "Album / EP (group of works released together)",
};

export const DRAFT_SYSTEM_PROMPT = `You are a copyright registration assistant for independent music creators. ` +
  `You help creators prepare U.S. Copyright Office (eCO) applications. You are NOT a lawyer and every ` +
  `response must end with: "This is general information, not legal advice. For complex situations, consult an intellectual property attorney."\n\n` +
  `Given the creator's work details, produce TWO things:\n` +
  `1. "description": a formal, 2-4 sentence "description of work" suitable for pasting into the eCO ` +
  `application — precise, neutral, third-person, naming the work type, the authorship claimed ` +
  `(music, lyrics, sound recording, audiovisual authorship as appropriate), and the creation/publication facts.\n` +
  `2. "filingNotes": 4-7 short bullet-ready filing notes covering: (a) which application to file — ` +
  `Standard Application ($65 electronic, covers one work or a group sharing author/owner/release) vs Single ` +
  `Application ($45, one work, one author who is also the sole claimant); (b) what deposit copy to upload ` +
  `(e.g. MP3 for a sound recording, lyric sheet PDF for lyrics, the video file for a music video); ` +
  `(c) authorship notes — only HUMAN authorship is registrable; AI-assisted works must disclaim AI-generated ` +
  `portions per the Copyright Office's March 2023 AI guidance, and AI systems cannot be listed as authors; ` +
  `(d) timing — register before infringement happens to preserve eligibility for statutory damages and ` +
  `attorney's fees; (e) anything specific to the facts given.\n\n` +
  `Return ONLY JSON: {"description": "...", "filingNotes": ["...", "..."]}.`;

export const ASK_SYSTEM_PROMPT = `You are a copyright Q&A assistant for independent music creators, answering ` +
  `questions about U.S. copyright registration (fees, timelines, single vs group applications, what to do if ` +
  `someone steals a work, deposits, authorship, AI-assisted works). Be accurate, practical, and concise — ` +
  `2-5 sentences unless the question needs more. Ground fee/timeline answers in current Copyright Office ` +
  `practice (Standard Application $65 electronic; processing typically 1-4 months; ~$800+ special handling for ` +
  `expedited). Note that fees and processing times change — tell the user to confirm at copyright.gov before ` +
  `filing. You are NOT a lawyer: every answer must end with "This is general information, not legal advice." ` +
  `Never invent case law or statute numbers you are unsure of.`;

const MAX_HISTORY_TURNS = 6;

const draftSchema = z.object({
  workType: z.enum(WORK_TYPES),
  title: z.string().min(1, "Give the work a title.").max(200),
  authors: z.string().max(500).optional().default(""),
  creationDate: z.string().max(20).optional().default(""),
  published: z.boolean().optional().default(false),
  publishedDate: z.string().max(20).optional().default(""),
  notes: z.string().max(1000).optional().default(""),
});

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

const askSchema = z.object({
  question: z.string().min(1, "Ask a question first.").max(1000),
  history: z.array(historyItemSchema).max(12).optional().default([]),
});

export interface DraftDetails {
  workType: WorkType;
  title: string;
  authors: string;
  creationDate: string;
  published: boolean;
  publishedDate: string;
  notes: string;
}

/* Pure prompt builder — exported for tests. Caps every field (injection hygiene). */
export function buildDraftPrompt(d: DraftDetails): string {
  const lines = [
    `Work type: ${WORK_TYPE_LABELS[d.workType]}`,
    `Title: ${d.title.slice(0, 200)}`,
    d.authors.trim() ? `Author(s)/claimant(s): ${d.authors.slice(0, 500)}` : null,
    d.creationDate.trim() ? `Year/date of creation: ${d.creationDate.slice(0, 20)}` : null,
    d.published
      ? `Publication status: PUBLISHED${d.publishedDate.trim() ? ` (date: ${d.publishedDate.slice(0, 20)})` : ""}`
      : "Publication status: UNPUBLISHED",
    d.notes.trim() ? `Creator notes: ${d.notes.slice(0, 1000)}` : null,
  ].filter(Boolean);
  return (
    `Draft the eCO application description and filing notes for this work:\n` +
    lines.join("\n")
  );
}

const router = Router();

async function chargeOr402(
  userId: string,
  balance: number,
  cost: number,
  res: Response
): Promise<number | null> {
  if (balance < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep using the Copyright Assistant.",
    });
    return null;
  }
  try {
    return await chargeCredits(userId, cost, { action: "Copyright Assistant" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep using the Copyright Assistant.",
      });
      return null;
    }
    throw err;
  }
}

/* POST /api/copyright/draft → 200 { description, filingNotes, creditsUsed, creditsRemaining } */
router.post("/copyright/draft", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid draft request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await chargeOr402(req.userId!, req.userCredits ?? 0, COPYRIGHT_DRAFT_CREDITS, res);
  if (creditsRemaining === null) return;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: DRAFT_SYSTEM_PROMPT },
        { role: "user", content: buildDraftPrompt(parsed.data) },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 900,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let description = "";
    let filingNotes: string[] = [];
    try {
      const j = JSON.parse(raw) as { description?: unknown; filingNotes?: unknown };
      if (typeof j.description === "string" && j.description.trim()) {
        description = j.description.trim().slice(0, 2000);
      }
      if (Array.isArray(j.filingNotes)) {
        filingNotes = j.filingNotes
          .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
          .map((n) => n.trim().slice(0, 500))
          .slice(0, 8);
      }
    } catch {
      /* fall through to the empty check */
    }
    if (!description) {
      throw new Error("Model returned no usable description");
    }

    res.json({ description, filingNotes, creditsUsed: COPYRIGHT_DRAFT_CREDITS, creditsRemaining });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[copyright] OpenAI rate limit / quota");
      res.status(503).json({ error: "The assistant is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[copyright] draft failed");
    res.status(502).json({ error: "The assistant hiccupped — try again." });
  }
});

/* POST /api/copyright/ask → 200 { answer, creditsUsed, creditsRemaining } */
router.post("/copyright/ask", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = askSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid question.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await chargeOr402(req.userId!, req.userCredits ?? 0, COPYRIGHT_ASK_CREDITS, res);
  if (creditsRemaining === null) return;

  try {
    const history = parsed.data.history.slice(-MAX_HISTORY_TURNS);
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: ASK_SYSTEM_PROMPT },
        ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
        { role: "user", content: parsed.data.question.slice(0, 1000) },
      ],
      max_completion_tokens: 700,
      temperature: 0.4,
    });

    const answer = (completion.choices[0]?.message?.content ?? "").trim();
    if (!answer) {
      throw new Error("Model returned no answer");
    }

    res.json({ answer, creditsUsed: COPYRIGHT_ASK_CREDITS, creditsRemaining });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[copyright] OpenAI rate limit / quota");
      res.status(503).json({ error: "The assistant is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[copyright] ask failed");
    res.status(502).json({ error: "The assistant hiccupped — try again." });
  }
});

export default router;
