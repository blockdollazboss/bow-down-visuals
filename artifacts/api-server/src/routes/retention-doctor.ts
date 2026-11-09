import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
} from "../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../lib/generation-stored-results";

const router = Router();

/* ─── AI Retention Doctor ────────────────────────────────────────────────
   Creators paste their timestamped drop-off points (e.g. "40% leave at
   0:12") and get a diagnosis + concrete prescription per drop-off. Each
   prescription deep-links to a fix tool whose receiver is verified:
     hook   → /hooks?topic=           (verified ?topic= receiver)
     script → /script-writer?topic=   (verified ?topic= receiver)
     editor → /video-editor?tab=timeline (verified ?tab= receiver) */

const MM_SS = /^\d{1,3}:[0-5]\d$/;

const dropOffSchema = z.object({
  at: z
    .string()
    .trim()
    .regex(MM_SS, "Timestamp must be mm:ss, e.g. 0:12."),
  dropPct: z
    .number()
    .min(1, "Drop-off % must be at least 1.")
    .max(99, "Drop-off % can't exceed 99.")
    .refine((n) => Number.isFinite(n), "Drop-off % must be a number."),
});

const retentionSchema = z.object({
  title: z.string().trim().min(3, "Give the video a title or topic.").max(200),
  dropOffs: z
    .array(dropOffSchema)
    .min(1, "Add at least one drop-off point.")
    .max(8, "Keep it to the 8 biggest drop-offs."),
  totalLength: z.string().trim().regex(MM_SS, "Length must be mm:ss.").optional(),
  niche: z.string().trim().max(100).optional(),
  videoType: z
    .enum(["music-video", "tutorial", "vlog", "short", "promo", "livestream-clip", "other"])
    .optional(),
  platform: z.enum(["tiktok", "instagram", "youtube", "x"]).optional(),
  context: z.string().trim().max(500).optional(),
});

type DropOff = z.infer<typeof dropOffSchema>;

const FIX_ACTIONS = ["hook", "script", "editor"] as const;
type FixAction = (typeof FIX_ACTIONS)[number];

/* 150 Visual Bucs per diagnosis — env-overridable without a deploy. A
   diagnosis call is a medium-length GPT-6 Sol completion (a fraction of a
   cent in provider fees), so 150 holds a deep margin while honoring the
   standing rule that every AI feature costs a fee. */
const RETENTION_DOCTOR_CREDITS = Number(process.env["RETENTION_DOCTOR_CREDIT_COST"]) || 150;

interface Diagnosis {
  at: string;
  dropPct: number;
  causeCategory: string;
  causeLabel: string;
  diagnosis: string;
  prescription: string;
  fixAction: FixAction;
  fixLabel: string;
  fixUrl: string;
}

interface ReportCard {
  grade: string;
  score: number;
  headline: string;
}

function fixUrlFor(action: FixAction, title: string): string {
  const q = encodeURIComponent(title);
  switch (action) {
    case "hook":
      return `/hooks?topic=${q}`;
    case "script":
      return `/script-writer?topic=${q}`;
    case "editor":
      return "/video-editor?tab=timeline";
  }
}

function fixLabelFor(action: FixAction): string {
  switch (action) {
    case "hook":
      return "Rewrite the hook";
    case "script":
      return "Tighten the script";
    case "editor":
      return "Open the video editor";
  }
}

const CAUSE_CATEGORIES = [
  "weak-hook",
  "slow-pacing",
  "no-pattern-interrupt",
  "payoff-delay",
  "confusion",
  "audio-issue",
  "weak-cta",
  "tangent",
];

/* Text model: centralized in getTextModel() (default gpt-6.1-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* Replay safety (CA-7): the diagnosis charge keys on a server-derived
   idempotency key over the parsed request intent, so a re-ask of the
   same request (double-tap, retry, timeout resend) is answered from
   the stored result instead of charging again. The refund path VOIDS
   the key (only when the refund landed), so a refunded request always
   runs fresh on retry. Fresh responses are byte-identical to before;
   stored lookups fail open. */
const RETENTION_DOCTOR_SCOPE = "retention-doctor";
const RETENTION_REPLAY_NOTE =
  "This is the diagnosis you already got for this video — change the drop-offs for a fresh one.";
const REPLAY_STORE_MAX = 500;
const storedRetentionResults = new Map<string, Record<string, unknown>>();
const inFlightRetention = new Map<string, Promise<Record<string, unknown>>>();

function storeRetentionInProcess(key: string, body: Record<string, unknown>): void {
  if (storedRetentionResults.size >= REPLAY_STORE_MAX) {
    const first = storedRetentionResults.keys().next().value;
    if (first !== undefined) storedRetentionResults.delete(first);
  }
  storedRetentionResults.set(key, body);
}

export function __resetRetentionDoctorReplayCache(): void {
  storedRetentionResults.clear();
  inFlightRetention.clear();
}

/* POST /api/retention-doctor { title, dropOffs, ... } → 200
   { reportCard, summary, diagnoses, creditsUsed, creditsRemaining }
   Paid: 150 Visual Bucs per diagnosis. Auth required; credits are deducted
   BEFORE the model call and REFUNDED on model failure, using the same
   pre-check + chargeCredits + refundCredits pattern as the paid routes. */
router.post("/retention-doctor", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = retentionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid retention doctor request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < RETENTION_DOCTOR_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to run the AI Retention Doctor.",
    });
    return;
  }

  const key = buildChargeIdempotencyKey(RETENTION_DOCTOR_SCOPE, req.userId!, undefined, parsed.data);
  const durable = await findStoredGenerationResult(RETENTION_DOCTOR_SCOPE, key, req.userId!);
  if (durable) {
    res.json({ ...durable, replayed: true, replayNote: RETENTION_REPLAY_NOTE });
    return;
  }
  const local = storedRetentionResults.get(key);
  if (local) {
    res.json({ ...local, replayed: true, replayNote: RETENTION_REPLAY_NOTE });
    return;
  }
  const pending = inFlightRetention.get(key);
  if (pending) {
    try {
      const twinBody = await pending;
      const stored = storedRetentionResults.get(key) ?? twinBody;
      res.json({ ...stored, replayed: true, replayNote: RETENTION_REPLAY_NOTE });
      return;
    } catch {
      /* The twin failed and refunded (voiding the key) — run fresh. */
    }
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, RETENTION_DOCTOR_CREDITS, {
      action: "AI Retention Doctor — Drop-off Diagnosis",
    }, { idempotencyKey: key });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to run the AI Retention Doctor.",
      });
      return;
    }
    throw err;
  }

  let resolveFlight: (body: Record<string, unknown>) => void = () => {};
  let rejectFlight: (err: unknown) => void = () => {};
  const flight = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveFlight = resolve;
    rejectFlight = reject;
  });
  flight.catch(() => {});
  inFlightRetention.set(key, flight);

  try {
    const { title, dropOffs, totalLength, niche, videoType, platform, context } = parsed.data;
    const dropLines = (dropOffs as DropOff[])
      .map((d) => `- ${d.dropPct}% of viewers leave at ${d.at}`)
      .join("\n");
    const metaLines = [
      niche ? `Niche: ${niche}` : null,
      videoType ? `Video type: ${videoType}` : null,
      platform ? `Platform: ${platform}` : null,
      totalLength ? `Total video length: ${totalLength}` : null,
      context ? `Creator context: ${context}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are the AI Retention Doctor — a ruthless audience-retention specialist for ` +
            `content creators. You receive a video's title and its timestamped drop-off points ` +
            `(what % of the audience leaves at which moment) and must diagnose WHY viewers ` +
            `leave at each point and prescribe a concrete fix. Ground every diagnosis in the ` +
            `creator's actual numbers — cite the timestamp and the drop % — no generic advice, ` +
            `no made-up stats, no virality guarantees. Prescriptions must be specific and ` +
            `actionable: what to cut, what to add, what to re-record, and at which timestamp. ` +
            `Cause categories, pick exactly one per drop-off: ${CAUSE_CATEGORIES.join(", ")}. ` +
            `Fix actions, pick exactly one per drop-off: "hook" (opening-line problem — rewrite ` +
            `in Hook Studio), "script" (wording/pacing/structure problem — tighten in Script ` +
            `Writer), "editor" (visual/audio/pattern-interrupt problem — fix in the video ` +
            `editor). The first drop-off under 0:30 is almost always a weak hook or slow ` +
            `opening; mid-video drops are usually pacing, tangents, or delayed payoff; late ` +
            `drops are usually a weak payoff or CTA. ` +
            `Return ONLY JSON: { ` +
            `"reportCard": { "grade": "<A-F retention grade for the whole video>", ` +
            `"score": <0-100 retention score>, ` +
            `"headline": "<one punchy sentence on the video's retention health>" }, ` +
            `"summary": "<2-3 sentences on the overall retention pattern across all drop-offs>", ` +
            `"diagnoses": [ { "at": "<mm:ss — copy the creator's timestamp exactly>", ` +
            `"dropPct": <copy the creator's drop %>, ` +
            `"causeCategory": "<one of the categories above>", ` +
            `"causeLabel": "<short human label, e.g. 'Payoff delay'>", ` +
            `"diagnosis": "<2-3 sentences: why viewers leave at this exact moment, referencing their numbers>", ` +
            `"prescription": "<concrete fix: what to change at this timestamp and how>", ` +
            `"fixAction": "<hook | script | editor>" } ] }.`,
        },
        {
          role: "user",
          content:
            `Video: "${title}"\n${metaLines ? `${metaLines}\n` : ""}\n` +
            `Drop-off points:\n${dropLines}\n\nDiagnose my retention.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1400,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let reportCard: ReportCard | null = null;
    let summary = "";
    let diagnoses: Diagnosis[] = [];
    try {
      const parsedJson = JSON.parse(raw) as {
        reportCard?: { grade?: unknown; score?: unknown; headline?: unknown };
        summary?: unknown;
        diagnoses?: Array<Record<string, unknown>>;
      };
      const rc = parsedJson.reportCard;
      if (
        rc &&
        typeof rc.grade === "string" &&
        /^[A-F][+-]?$/.test(rc.grade.trim().toUpperCase()) &&
        typeof rc.score === "number" &&
        rc.score >= 0 &&
        rc.score <= 100 &&
        typeof rc.headline === "string" &&
        rc.headline.trim()
      ) {
        reportCard = {
          grade: rc.grade.trim().toUpperCase(),
          score: Math.round(rc.score),
          headline: rc.headline.trim(),
        };
      }
      if (typeof parsedJson.summary === "string" && parsedJson.summary.trim()) {
        summary = parsedJson.summary.trim();
      }
      if (Array.isArray(parsedJson.diagnoses)) {
        diagnoses = parsedJson.diagnoses
          .map((d) => {
            const at = typeof d.at === "string" ? d.at.trim() : "";
            const dropPct = typeof d.dropPct === "number" ? Math.round(d.dropPct) : NaN;
            const causeCategory =
              typeof d.causeCategory === "string" &&
              CAUSE_CATEGORIES.includes(d.causeCategory.trim())
                ? d.causeCategory.trim()
                : "slow-pacing";
            const causeLabel =
              typeof d.causeLabel === "string" && d.causeLabel.trim()
                ? d.causeLabel.trim()
                : "Retention leak";
            const diagnosis =
              typeof d.diagnosis === "string" && d.diagnosis.trim() ? d.diagnosis.trim() : "";
            const prescription =
              typeof d.prescription === "string" && d.prescription.trim() ? d.prescription.trim() : "";
            const fixAction: FixAction =
              typeof d.fixAction === "string" &&
              (FIX_ACTIONS as readonly string[]).includes(d.fixAction.trim())
                ? (d.fixAction.trim() as FixAction)
                : "editor";
            if (!at || !Number.isFinite(dropPct) || !diagnosis || !prescription) return null;
            return {
              at,
              dropPct,
              causeCategory,
              causeLabel,
              diagnosis,
              prescription,
              fixAction,
              fixLabel: fixLabelFor(fixAction),
              fixUrl: fixUrlFor(fixAction, title),
            } as Diagnosis;
          })
          .filter((d): d is Diagnosis => d !== null)
          .slice(0, 8);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (!reportCard || !summary || diagnoses.length === 0) {
      throw new Error("Model returned no usable diagnosis");
    }

    const body: Record<string, unknown> = {
      reportCard,
      summary,
      diagnoses,
      creditsUsed: RETENTION_DOCTOR_CREDITS,
      creditsRemaining,
    };
    storeRetentionInProcess(key, body);
    await storeGenerationResult(RETENTION_DOCTOR_SCOPE, key, req.userId!, body);
    resolveFlight(body);
    if (inFlightRetention.get(key) === flight) inFlightRetention.delete(key);
    const storedBody = storedRetentionResults.get(key);
    if (storedBody && storedBody !== body) {
      res.json({ ...storedBody, replayed: true, replayNote: RETENTION_REPLAY_NOTE });
      return;
    }
    res.json(body);
  } catch (err) {
    rejectFlight(err);
    if (inFlightRetention.get(key) === flight) inFlightRetention.delete(key);
    /* The charge was taken before the model call — give it back so a
       provider failure never costs the creator. */
    let refunded = false;
    try {
      await refundCredits(req.userId!, RETENTION_DOCTOR_CREDITS, {
        action: "AI Retention Doctor — Refund (diagnosis failed)",
      });
      refunded = true;
    } catch (refundErr) {
      logger.error(
        { err: refundErr, userId: req.userId },
        "[retention-doctor] refund failed after generation failure"
      );
    }
    /* The refund landed — void the charge key so a retry charges fresh. */
    if (refunded) await voidChargeIdempotencyKey(key);

    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[retention-doctor] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[retention-doctor] diagnosis failed");
    res.status(502).json({ error: "The studio hiccupped — try again." });
  }
});

export default router;
