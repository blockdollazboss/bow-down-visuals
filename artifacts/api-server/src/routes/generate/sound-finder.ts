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

const router = Router();

/* ── Curated trending-sound starter database ──────────────────────────────
   This is a STARTER list of sound TYPES that trend on TikTok/Reels/Shorts
   (not live chart data). The UI marks it clearly as a curated starter
   database — it gives creators a browsing starting point while the AI
   matcher tailors picks to their actual video idea. */

const NICHES = [
  "music-promo",
  "fitness",
  "comedy",
  "lifestyle",
  "gaming",
  "beauty",
  "business",
  "food",
] as const;
type Niche = (typeof NICHES)[number];

const MOODS = ["hype", "chill", "emotional", "funny", "luxury", "nostalgic"] as const;
type Mood = (typeof MOODS)[number];

export interface TrendingSound {
  id: string;
  title: string;
  artist: string;
  niche: Niche[];
  mood: Mood[];
  platforms: ("tiktok" | "instagram" | "youtube")[];
  whyTrending: string;
  bestFor: string;
  hookWindow: string; // the part of the sound creators use, e.g. "0:08–0:15 drop"
}

const TRENDING_SOUNDS: TrendingSound[] = [
  {
    id: "ts-01",
    title: "Golden Hour Drop",
    artist: "Type Beat — Cinematic",
    niche: ["music-promo", "lifestyle"],
    mood: ["luxury", "emotional"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "Cinematic drop format — creators pair the swell with reveal moments.",
    bestFor: "Luxury reveals, before/after transformations, artist announcements",
    hookWindow: "0:10–0:18 crescendo into drop",
  },
  {
    id: "ts-02",
    title: "Sped-Up Night Drive",
    artist: "Phonk Collective",
    niche: ["fitness", "gaming", "lifestyle"],
    mood: ["hype", "chill"],
    platforms: ["tiktok", "instagram", "youtube"],
    whyTrending: "Sped-up phonk edits dominate gym and car content right now.",
    bestFor: "Gym edits, night-drive clips, montage cuts",
    hookWindow: "0:00–0:08 punchy intro loop",
  },
  {
    id: "ts-03",
    title: "POV Story Beat",
    artist: "Lo-Fi Storyteller",
    niche: ["comedy", "lifestyle", "business"],
    mood: ["funny", "nostalgic"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "The go-to bed for POV skits and storytime formats.",
    bestFor: "POV skits, storytimes, day-in-my-life vlogs",
    hookWindow: "Full loop — works under talking head",
  },
  {
    id: "ts-04",
    title: "Boss Walk Anthem",
    artist: "Trap Brass Ensemble",
    niche: ["business", "fitness", "music-promo"],
    mood: ["hype", "luxury"],
    platforms: ["tiktok", "instagram", "youtube"],
    whyTrending: "Brass stabs + heavy 808s — the 'main character entrance' sound.",
    bestFor: "Entrance videos, wins, glow-ups, promo teasers",
    hookWindow: "0:05–0:15 brass hit section",
  },
  {
    id: "ts-05",
    title: "Soft Piano Confessional",
    artist: "Ambient Keys",
    niche: ["lifestyle", "beauty", "business"],
    mood: ["emotional", "chill"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "Underpins vulnerable storytimes and advice content that saves well.",
    bestFor: "Advice videos, vulnerable stories, GRWM voiceovers",
    hookWindow: "Full loop — sits under voiceover",
  },
  {
    id: "ts-06",
    title: "Comedy Record Scratch",
    artist: "Classic Meme Cuts",
    niche: ["comedy", "gaming"],
    mood: ["funny"],
    platforms: ["tiktok", "youtube"],
    whyTrending: "The timeless 'plot twist' sting — instantly signals a punchline.",
    bestFor: "Fail compilations, expectation-vs-reality, reaction cuts",
    hookWindow: "0:00–0:04 sting",
  },
  {
    id: "ts-07",
    title: "Afrobeats Sunrise",
    artist: "Lagos Groove Lab",
    niche: ["music-promo", "lifestyle", "food"],
    mood: ["hype", "chill"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "Afrobeats rhythms keep crossing into dance and food content.",
    bestFor: "Dance challenges, cooking transitions, travel clips",
    hookWindow: "0:12–0:25 hook section",
  },
  {
    id: "ts-08",
    title: "Nostalgia Tape Hiss",
    artist: "VHS Memories",
    niche: ["lifestyle", "beauty", "comedy"],
    mood: ["nostalgic", "chill"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "Y2K/throwback edits pair tape-hiss textures with old footage.",
    bestFor: "Throwback edits, photo dumps, aesthetic montages",
    hookWindow: "Full loop — texture bed",
  },
  {
    id: "ts-09",
    title: "Epic Trailer Build",
    artist: "Cinematic Hits",
    niche: ["gaming", "music-promo", "business"],
    mood: ["hype", "luxury"],
    platforms: ["tiktok", "youtube"],
    whyTrending: "Trailer-style builds make announcements feel like movie premieres.",
    bestFor: "Big announcements, launches, cinematic gaming clips",
    hookWindow: "0:15–0:30 riser into hit",
  },
  {
    id: "ts-10",
    title: "Whisper ASMR Bed",
    artist: "Soft Focus Audio",
    niche: ["beauty", "lifestyle", "food"],
    mood: ["chill"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "Low-volume beds boost watch time on tutorial and process content.",
    bestFor: "Tutorials, process videos, unboxings",
    hookWindow: "Full loop — stays out of the way",
  },
  {
    id: "ts-11",
    title: "Drill Bounce",
    artist: "UK Drill Kit",
    niche: ["fitness", "music-promo", "gaming"],
    mood: ["hype"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "Sliding 808s drive sync-cut edits across sport and music clips.",
    bestFor: "Sync-cut edits, sports highlights, rap snippets",
    hookWindow: "0:08–0:20 slide section",
  },
  {
    id: "ts-12",
    title: "Jazz Café Loop",
    artist: "Blue Note Vibes",
    niche: ["business", "food", "lifestyle"],
    mood: ["chill", "luxury"],
    platforms: ["tiktok", "instagram"],
    whyTrending: "Sophisticated backdrop for 'quiet luxury' and founder content.",
    bestFor: "Founder stories, café content, product showcases",
    hookWindow: "Full loop — classy bed",
  },
];

export const SOUND_NICHES: readonly string[] = NICHES;
export const SOUND_MOODS: readonly string[] = MOODS;
export function getTrendingSounds(): TrendingSound[] {
  return TRENDING_SOUNDS;
}

/* GET /api/sounds/trending — free, public. Browsing costs nothing
   (pure UI — no compute, no AI). Optional ?niche= & ?mood= filters. */
router.get("/sounds/trending", publicApiLimiter, async (req, res) => {
  const niche = typeof req.query["niche"] === "string" ? req.query["niche"] : "";
  const mood = typeof req.query["mood"] === "string" ? req.query["mood"] : "";

  let sounds = TRENDING_SOUNDS;
  if (niche && (NICHES as readonly string[]).includes(niche)) {
    sounds = sounds.filter((s) => s.niche.includes(niche as Niche));
  }
  if (mood && (MOODS as readonly string[]).includes(mood)) {
    sounds = sounds.filter((s) => s.mood.includes(mood as Mood));
  }

  res.json({
    sounds,
    niches: NICHES,
    moods: MOODS,
    disclaimer:
      "Curated starter database of trending sound types — not live chart data. Trends move fast; always check the sound's current usage on-platform.",
  });
});

/* ── AI sound match ───────────────────────────────────────────────────────
   1 credit per match — env-overridable. A short GPT-6 Sol completion
   (fraction of a cent), so 1 credit holds a deep margin while honoring the
   standing rule that every AI feature costs a fee. */

const SOUND_MATCH_CREDITS = Number(process.env["SOUND_MATCH_CREDIT_COST"]) || 1;
export const SOUND_MATCH_CREDIT_COST = SOUND_MATCH_CREDITS;

const matchSchema = z.object({
  videoIdea: z.string().min(1, "Describe your video idea.").max(600),
  niche: z.enum(NICHES).optional().default("lifestyle"),
  platform: z.enum(["tiktok", "instagram", "youtube"]).optional().default("tiktok"),
});

export interface SoundMatch {
  soundType: string;
  why: string;
  searchTerms: string[];
  timingTip: string;
}

/* POST /api/sound-finder/match { videoIdea, niche, platform } → 200 { matches, ... }
   Paid: 1 credit. Charge-before-generate; auto-refund on provider failure
   or unusable output. Auth required. */
router.post("/sound-finder/match", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = matchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid sound match request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < SOUND_MATCH_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep matching sounds.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SOUND_MATCH_CREDITS, {
      action: "Viral Sound Match",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep matching sounds.",
      });
      return;
    }
    throw err;
  }

  async function refundAndFail(status: number, message: string) {
    try {
      await refundCredits(req.userId!, SOUND_MATCH_CREDITS, {
        action: "Viral Sound Match — Refund (match failed)",
      });
      creditsRemaining = balance;
    } catch (refundErr) {
      logger.error({ refundErr, userId: req.userId }, "[sound-finder] refund failed after match failure");
    }
    res.status(status).json({ error: message, creditsRemaining });
  }

  try {
    const { videoIdea, niche, platform } = parsed.data;

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a TikTok/Reels/Shorts sound strategist for independent music creators. ` +
            `Given a creator's video idea, recommend exactly 3 trending SOUND TYPES (not specific ` +
            `copyrighted songs — describe the sound style, e.g. "sped-up phonk edit", "cinematic ` +
            `brass drop", "soft piano voiceover bed"). For each: why it fits THIS video idea, 2-3 ` +
            `search terms the creator can type into TikTok/Instagram to find real trending sounds ` +
            `of that type, and one timing tip (which part of the sound to use). Be specific to ` +
            `the idea — no generic advice. Honest framing: trends move fast, so tell them to ` +
            `check current usage on-platform. ` +
            `Return ONLY JSON: {"matches": [{"soundType": "...", "why": "...", ` +
            `"searchTerms": ["...", "..."], "timingTip": "..."}, ...]} with exactly 3 matches.`,
        },
        {
          role: "user",
          content: `Video idea: "${videoIdea}"\nNiche: ${niche}\nPlatform: ${platform}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let matches: SoundMatch[] = [];
    try {
      const parsedJson = JSON.parse(raw) as { matches?: unknown };
      if (Array.isArray(parsedJson.matches)) {
        matches = parsedJson.matches
          .filter(
            (m): m is Record<string, unknown> =>
              !!m && typeof (m as { soundType?: unknown }).soundType === "string",
          )
          .map((m) => {
            const rec = m as {
              soundType: string;
              why?: unknown;
              searchTerms?: unknown;
              timingTip?: unknown;
            };
            return {
              soundType: rec.soundType.trim(),
              why: typeof rec.why === "string" ? rec.why.trim() : "",
              searchTerms: Array.isArray(rec.searchTerms)
                ? rec.searchTerms
                    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
                    .map((t) => t.trim())
                    .slice(0, 3)
                : [],
              timingTip: typeof rec.timingTip === "string" ? rec.timingTip.trim() : "",
            };
          })
          .filter((m) => m.soundType.length > 0 && m.why.length > 0)
          .slice(0, 3);
      }
    } catch {
      /* fall through to the empty check below */
    }

    if (matches.length === 0) {
      await refundAndFail(502, "The matcher came up empty — credits refunded, try again.");
      return;
    }

    res.json({
      matches,
      creditsUsed: SOUND_MATCH_CREDITS,
      creditsRemaining,
      disclaimer:
        "AI suggestions based on sound-type trends — not a virality guarantee. Check each sound's current usage on-platform before posting.",
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[sound-finder] OpenAI rate limit / quota");
      await refundAndFail(503, "The matcher is catching its breath — credits refunded, try again in a moment.");
      return;
    }
    logger.error({ err }, "[sound-finder] match failed");
    await refundAndFail(502, "The matcher hiccupped — credits refunded, try again.");
  }
});

export default router;
