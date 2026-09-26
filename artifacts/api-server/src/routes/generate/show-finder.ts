import { Router, type Request, type Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* ─── Show Finder ───────────────────────────────────────────────────────────
   AI-curated performance opportunities so creators GET NOTICED: open mics,
   showcases, festivals, venue gigs, radio guest spots, podcast appearances.
   - POST /api/show-finder        → 2 credits per search
   - POST /api/show-finder/pitch  → 1 credit per pitch draft
   Honest framing: the model has no live event database. It must prefer
   well-known, recurring opportunities (established festivals, long-running
   open-mic nights, major stations with public submission programs), attach
   a verifyNote to every result, and the frontend carries the disclaimer
   that dates/contacts must be verified before acting. Never present
   specifics as verified fact. */

/* 2 credits per finder search — env-overridable without a deploy. One search
   is a single structured GPT-6 Sol completion (a fraction of a cent in
   provider fees), so 2 credits holds a deep margin while staying an impulse
   buy — and honors the standing rule that every AI feature costs a fee. */
export const SHOW_FINDER_CREDIT_COST =
  Number(process.env["SHOW_FINDER_CREDIT_COST"]) || 2;

export const SHOW_FINDER_PITCH_CREDIT_COST =
  Number(process.env["SHOW_FINDER_PITCH_CREDIT_COST"]) || 1;

const OPPORTUNITY_TYPES = [
  "open-mic",
  "showcase",
  "festival",
  "venue-gig",
  "radio",
  "podcast",
] as const;
type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

const OPPORTUNITY_LABEL: Record<OpportunityType, string> = {
  "open-mic": "Open Mic",
  showcase: "Showcase",
  festival: "Festival",
  "venue-gig": "Venue Gig",
  radio: "Radio Spot",
  podcast: "Podcast Guest",
};

const DATE_WINDOWS = ["next-30-days", "next-90-days", "next-6-months"] as const;

const finderSchema = z.object({
  location: z.string().min(1, "Location is required.").max(120),
  genre: z.string().min(1, "Genre is required.").max(80),
  opportunityTypes: z.array(z.enum(OPPORTUNITY_TYPES)).min(1, "Pick at least one opportunity type.").max(6),
  dateWindow: z.enum(DATE_WINDOWS).optional().default("next-90-days"),
  artistBio: z.string().max(600).optional().default(""),
});

const pitchSchema = z.object({
  opportunityTitle: z.string().min(1, "Opportunity title is required.").max(200),
  opportunityType: z.enum(OPPORTUNITY_TYPES),
  organizer: z.string().max(200).optional().default(""),
  creatorName: z.string().min(1, "Creator name is required.").max(100),
  genre: z.string().min(1, "Genre is required.").max(80),
  artistBio: z.string().max(600).optional().default(""),
  location: z.string().max(120).optional().default(""),
});

export interface ShowOpportunity {
  title: string;
  type: string;
  organizer: string;
  location: string;
  dateWindow: string;
  whyFit: string;
  howToApply: string;
  verifyNote: string;
}

const VERIFY_DISCLAIMER =
  "Opportunities are AI-curated from public knowledge as of 2026 — dates, lineups, and submission details change. Verify everything on the organizer's official page before you apply or travel.";

function clampText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function parseOpportunities(raw: string): ShowOpportunity[] {
  try {
    const j = JSON.parse(raw) as { opportunities?: unknown };
    if (!Array.isArray(j.opportunities)) return [];
    return j.opportunities
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .map((o) => ({
        title: clampText(o["title"], 160),
        type: clampText(o["type"], 40),
        organizer: clampText(o["organizer"], 160),
        location: clampText(o["location"], 160),
        dateWindow: clampText(o["dateWindow"], 160),
        whyFit: clampText(o["whyFit"], 400),
        howToApply: clampText(o["howToApply"], 400),
        verifyNote: clampText(o["verifyNote"], 300),
      }))
      .filter((o) => o.title && o.whyFit && o.howToApply)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function preCharge(
  req: Request,
  cost: number,
  action: string,
  res: Response,
): Promise<number | null> {
  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to keep hunting." });
    return null;
  }
  try {
    return await chargeCredits(req.userId!, cost, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to keep hunting." });
      return null;
    }
    throw err;
  }
}

async function refund(userId: string, cost: number, action: string) {
  try {
    await refundCredits(userId, cost, { action: `${action} — Refund (generation failed)` });
  } catch (refundErr) {
    void refundErr; // logged inside refundCredits; don't mask the original failure
  }
}

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/show-finder { location, genre, opportunityTypes, dateWindow, artistBio }
   → 200 { opportunities[], disclaimer, creditsUsed, creditsRemaining }
   Paid: 2 credits per search. Auth required; credits are deducted BEFORE the
   model call and refunded if generation fails. */
router.post("/show-finder", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = finderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid show finder request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await preCharge(req, SHOW_FINDER_CREDIT_COST, "Show Finder", res);
  if (creditsRemaining === null) return;

  const d = parsed.data;
  const typeLines = d.opportunityTypes.map((t) => OPPORTUNITY_LABEL[t]).join(", ");
  const bioLine = d.artistBio.trim() ? ` Artist bio: ${d.artistBio.trim()}` : "";

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 2500,
      response_format: { type: "json_object" },
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are a booking-savvy talent scout for independent music creators. " +
            "You surface performance opportunities that help artists GET NOTICED. " +
            "You have no live event database: prefer well-known, recurring opportunities " +
            "(established festivals, long-running open-mic nights, venues known for emerging acts, " +
            "major radio stations or podcasts with public submission/guest programs). " +
            "Never invent a specific one-off event with an exact date as verified fact — " +
            "use date windows (e.g. 'typically held each spring') and tell the creator to verify. " +
            "Every opportunity gets a verifyNote naming exactly what to check (official site, submission deadline, age/genre rules). " +
            "The whyFit must tie the opportunity to THIS creator's genre and bio. " +
            "The howToApply must be concrete: where to submit, what to send (EPK, live video, press one-sheet). " +
            "Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Find performance opportunities for this creator.\n` +
            `Location: ${d.location.trim()}\n` +
            `Genre: ${d.genre.trim()}\n` +
            `Opportunity types wanted: ${typeLines}\n` +
            `Date window: ${d.dateWindow}\n${bioLine}\n\n` +
            `Return JSON with exactly this shape:\n` +
            `{"opportunities": [ {"title": string, "type": string (one of: Open Mic, Showcase, Festival, Venue Gig, Radio Spot, Podcast Guest), ` +
            `"organizer": string, "location": string, "dateWindow": string (e.g. "typically March each year — verify"), ` +
            `"whyFit": string (2-3 sentences tying it to THIS creator), ` +
            `"howToApply": string (concrete steps: where to submit, what to send), ` +
            `"verifyNote": string (exactly what to double-check before acting)} ]}\n` +
            `Return 5 to 8 opportunities, ordered by best fit first.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const opportunities = parseOpportunities(raw);
    if (opportunities.length === 0) {
      await refund(req.userId!, SHOW_FINDER_CREDIT_COST, "Show Finder");
      res.status(502).json({
        error: "generation_failed",
        message: "The scout came back empty — your credits were refunded. Try broadening the filters.",
      });
      return;
    }

    await recordCreditUsage({ userId: req.userId!, action: "Show Finder", creditsUsed: SHOW_FINDER_CREDIT_COST });
    res.json({
      opportunities,
      disclaimer: VERIFY_DISCLAIMER,
      creditsUsed: SHOW_FINDER_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[show-finder] OpenAI rate limit / quota");
      res.status(503).json({ error: "The scout is catching its breath — try again in a moment." });
      return;
    }
    await refund(req.userId!, SHOW_FINDER_CREDIT_COST, "Show Finder");
    logger.error({ err }, "[show-finder] generation failed, credits refunded");
    res.status(502).json({ error: "The scout hiccupped — credits refunded, try again." });
  }
});

/* POST /api/show-finder/pitch { opportunityTitle, opportunityType, organizer, creatorName, genre, artistBio, location }
   → 200 { pitch: { subject, body }, tips[], creditsUsed, creditsRemaining }
   Paid: 1 credit per pitch draft. Auth required; refunded on failure. */
router.post("/show-finder/pitch", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = pitchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid pitch request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await preCharge(req, SHOW_FINDER_PITCH_CREDIT_COST, "Show Finder Pitch", res);
  if (creditsRemaining === null) return;

  try {
    const d = parsed.data;
    const orgLine = d.organizer.trim() ? ` Organizer: ${d.organizer.trim()}.` : "";
    const bioLine = d.artistBio.trim() ? ` Bio: ${d.artistBio.trim()}` : "";
    const locLine = d.location.trim() ? ` Based in ${d.location.trim()}.` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "You write booking pitches for independent music creators. Sound like a confident " +
            "working artist, not a desperate fan. Lead with what the BOOKER gets (draw, energy, " +
            "professionalism), keep it short, name the specific opportunity, and end with one " +
            "clear low-friction call to action (e.g. 'happy to send a 2-song live video'). " +
            "Never invent fake credentials, numbers, or past shows. Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Write an application/pitch for this opportunity.\n` +
            `Opportunity: ${d.opportunityTitle.trim()} (${OPPORTUNITY_LABEL[d.opportunityType]}).${orgLine}\n` +
            `Creator: ${d.creatorName.trim()} — ${d.genre.trim()} artist.${locLine}${bioLine}\n\n` +
            `Return JSON with exactly these keys:\n` +
            `- "subject": string (under 70 chars — the email subject line)\n` +
            `- "body": string (under 220 words: hook, why-this-opportunity, what-they-get, one CTA)\n` +
            `- "tips": array of 3 short strings (what to attach/send with this pitch: live video, EPK, stage plot, etc.)`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    let pitch = { subject: "", body: "" };
    let tips: string[] = [];
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      pitch = {
        subject: clampText(j["subject"], 120),
        body: clampText(j["body"], 2000),
      };
      if (Array.isArray(j["tips"])) {
        tips = j["tips"]
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 200))
          .slice(0, 3);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (!pitch.subject || !pitch.body) {
      await refund(req.userId!, SHOW_FINDER_PITCH_CREDIT_COST, "Show Finder Pitch");
      res.status(502).json({
        error: "generation_failed",
        message: "The pitch came back unusable — your credit was refunded. Try again.",
      });
      return;
    }

    await recordCreditUsage({ userId: req.userId!, action: "Show Finder Pitch", creditsUsed: SHOW_FINDER_PITCH_CREDIT_COST });
    res.json({ pitch, tips, creditsUsed: SHOW_FINDER_PITCH_CREDIT_COST, creditsRemaining });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[show-finder/pitch] OpenAI rate limit / quota");
      res.status(503).json({ error: "The writer is catching its breath — try again in a moment." });
      return;
    }
    await refund(req.userId!, SHOW_FINDER_PITCH_CREDIT_COST, "Show Finder Pitch");
    logger.error({ err }, "[show-finder/pitch] generation failed, credits refunded");
    res.status(502).json({ error: "The writer hiccupped — credit refunded, try again." });
  }
});

export default router;
