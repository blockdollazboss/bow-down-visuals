import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";

/* ─── Link to Hit ─────────────────────────────────────────────────────────
   /api/link-to-hit/analyze — 3 credits: the creator pastes a link (or
   just describes the video) plus top comments. The server tries public
   oEmbed (YouTube + TikTok only — Instagram needs a token, so it's
   skipped) with a 6s timeout; on ANY failure the source is null and the
   AI works from the description — NEVER invent titles/thumbnails.

   The AI then creates a COMEDY package:
   (a) a comedy video concept that intercuts ACTUAL source clips with
       AI-GENERATED comedic roast inserts (segments typed "source" or
       "generated" — only "generated" segments get an image/video prompt)
   (b) a FUNNY song: comedic lyrics + hook written FROM THE COMMENTS
       THEMES (a separate pipeline from the visuals — never blended)
   (c) a music-generation prompt embedding the chosen genre (default
       "Comedy Pop") for the ElevenLabs pipeline.

   TONE GUARDRAIL: playful parody — roast the CONTENT/situation, never
   punch down at real private individuals, no harassment. */

const router = Router();

/* 3 credits per analysis — env-overridable without a deploy. A full comedy
   package (concept + segments + full song lyrics + music prompt) is the
   longest structured GPT-6 Sol completion in this batch; 3 credits holds a
   deep margin — and honors the standing rule that every AI feature costs
   a fee. */
const ANALYZE_CREDITS = Number(process.env["LINK_TO_HIT_ANALYZE_CREDITS"]) || 300;

const analyzeSchema = z.object({
  url: z.string().url("Give a valid URL.").max(500).optional(),
  description: z.string().min(1, "Describe the video.").max(1000),
  comments: z.array(z.string().min(1).max(500)).max(20, "Max 20 comments.").optional().default([]),
  genre: z.string().max(60).optional().default(""),
});

interface LinkSource {
  title?: string;
  author?: string;
  thumbnail?: string;
}

interface SegmentItem {
  type: "source" | "generated";
  description: string;
  prompt?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/* Public oEmbed only, 6s timeout, fail soft. YouTube + TikTok have
   no-auth oEmbed endpoints; Instagram's needs a token, so it's skipped.
   Anything that isn't a YouTube/TikTok URL → null. Never invent. */
async function fetchOEmbed(sourceUrl: string): Promise<LinkSource | null> {
  let host = "";
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  let endpoint: string | null = null;
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
  } else if (host.includes("tiktok.com")) {
    endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
  } else {
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(endpoint, {
      signal: ctrl.signal,
      headers: { "User-Agent": "BowDownVisuals/1.0 (oembed lookup)" },
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as Record<string, unknown>;
    const out: LinkSource = {};
    if (typeof j["title"] === "string" && (j["title"] as string).trim()) {
      out.title = (j["title"] as string).trim().slice(0, 200);
    }
    if (typeof j["author_name"] === "string" && (j["author_name"] as string).trim()) {
      out.author = (j["author_name"] as string).trim().slice(0, 120);
    }
    if (typeof j["thumbnail_url"] === "string" && (j["thumbnail_url"] as string).trim()) {
      out.thumbnail = (j["thumbnail_url"] as string).trim().slice(0, 500);
    }
    if (!out.title && !out.author && !out.thumbnail) return null;
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseSegment(e: Record<string, unknown>): SegmentItem | null {
  const type = str(e["type"]).toLowerCase();
  if (type !== "source" && type !== "generated") return null;
  const description = str(e["description"]).slice(0, 800);
  if (!description) return null;
  const seg: SegmentItem = { type, description };
  /* Only "generated" segments get an image/video generation prompt —
     never put a prompt on source clips. */
  if (type === "generated") {
    const prompt = str(e["prompt"]).slice(0, 600);
    if (prompt) seg.prompt = prompt;
  }
  return seg;
}

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[link-to-hit] refund failed after generation error");
  }
}

/* POST /api/link-to-hit/analyze { url?, description, comments?, genre? }
   → 200 { source|null, comedyConcept, segments[{type,description,prompt?}], songTitle, hook, songLyrics, musicPrompt, creditsUsed, creditsRemaining }
   Paid: 3 credits. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/link-to-hit/analyze", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid link-to-hit request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < ANALYZE_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to turn this link into a hit.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, ANALYZE_CREDITS, { action: "Link to Hit — Analyze" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to turn this link into a hit.",
      });
      return;
    }
    throw err;
  }

  const { url, description, comments, genre } = parsed.data;
  const musicGenre = genre.trim() || "Comedy Pop";

  /* oEmbed lookup is fail-soft by design: any failure → source null,
     the AI works from the description. Never invent titles/thumbnails. */
  const source: LinkSource | null = url ? await fetchOEmbed(url.trim()) : null;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a comedy content director for independent creators. A creator gives you a video ` +
            `(title/author/thumbnail may be provided, or may be absent — work from their description ` +
            `either way) plus its top comments. You build a COMEDY package in three separate parts:\n\n` +
            `PART A — COMEDY VIDEO CONCEPT: "comedyConcept" (2-4 sentences) describing a comedy video ` +
            `that intercuts ACTUAL clips from the source video with AI-GENERATED comedic roast inserts ` +
            `(exaggerated reactions, absurd scenarios, comic-book-style visual pop-ups). Then "segments": ` +
            `an ordered array of 6-10 segments, each {"type": "source"|"generated", "description": "..."}. ` +
            `type "source" = a real moment from the source video, described plainly — NEVER give it a ` +
            `"prompt" (you cannot generate the source). type "generated" = your AI roast insert, described ` +
            `vividly, PLUS a "prompt" field: a prompt-level image/video generation prompt the creator can ` +
            `paste into an AI video generator for that insert. Alternate source and generated for rhythm.\n\n` +
            `PART B — FUNNY SONG: a separate comedic song concept. Read the COMMENTS, mine them for ` +
            `recurring themes and jokes, and write "songTitle", "hook" (the catchy comedic chorus hook, ` +
            `4-8 lines), and "songLyrics" (full funny lyrics: verse / chorus / verse / chorus / bridge / ` +
            `outro, written FROM THE COMMENTS THEMES). This is a SEPARATE pipeline from the visuals — do ` +
            `not blend the video concept into the song.\n\n` +
            `PART C — MUSIC PROMPT: "musicPrompt": a production-ready music-generation prompt for an ` +
            `ElevenLabs-style music pipeline — embed the genre "${musicGenre}" plus tempo, instrumentation, ` +
            `mood, and vocal style that fits a comedic track.\n\n` +
            `TONE GUARDRAIL: playful parody only — roast the CONTENT and the situation, never punch down ` +
            `at real private individuals, no harassment, no cruelty. If the source involves a real private ` +
            `person, keep the comedy aimed at the situation, not the person.\n` +
            `Return ONLY JSON: {"comedyConcept": "...", "segments": [{"type": "source", "description": "..."}, ` +
            `{"type": "generated", "description": "...", "prompt": "..."}, ...], "songTitle": "...", ` +
            `"hook": "...", "songLyrics": "...", "musicPrompt": "..."}.`,
        },
        {
          role: "user",
          content:
            `Turn this into a comedy hit.\n` +
            (source?.title ? `Source title: ${source.title}\n` : "") +
            (source?.author ? `Source author: ${source.author}\n` : "") +
            `What the video shows: ${description.trim()}\n` +
            `Top comments:\n${comments.length > 0 ? comments.map((c, i) => `${i + 1}. ${c.trim()}`).join("\n") : "(no comments provided — lean on the description)"}\n` +
            `Music genre: ${musicGenre}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
      temperature: 0.9,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let comedyConcept = "";
    let segments: SegmentItem[] = [];
    let songTitle = "";
    let hook = "";
    let songLyrics = "";
    let musicPrompt = "";
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      comedyConcept = str(j["comedyConcept"]).slice(0, 2000);
      if (Array.isArray(j["segments"])) {
        segments = (j["segments"] as unknown[])
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
          .map(parseSegment)
          .filter((s): s is SegmentItem => s !== null)
          .slice(0, 12);
      }
      songTitle = str(j["songTitle"]).slice(0, 120);
      hook = str(j["hook"]).slice(0, 1500);
      songLyrics = str(j["songLyrics"]).slice(0, 5000);
      musicPrompt = str(j["musicPrompt"]).slice(0, 1000);
    } catch {
      /* fall through to the empty check below */
    }
    if (!comedyConcept || segments.length === 0 || !songLyrics || !musicPrompt) {
      throw new Error("Model returned no usable comedy package");
    }

    res.json({
      source,
      comedyConcept,
      segments,
      songTitle,
      hook,
      songLyrics,
      musicPrompt,
      creditsUsed: ANALYZE_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, ANALYZE_CREDITS, "Link to Hit — Analyze");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[link-to-hit] OpenAI rate limit / quota");
      res.status(503).json({ error: "Link to hit is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[link-to-hit] analysis failed");
    res.status(502).json({ error: "Link to hit hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
