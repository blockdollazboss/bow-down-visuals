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
import { db, labelPitchesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

/* Submission statuses — defined locally (not imported from @workspace/db)
   so the module evaluates cleanly in worktree test environments where the
   symlinked @workspace/db predates the label_pitches table. Values match
   lib/db/src/schema/label-pitch.ts exactly. */
export const LABEL_PITCH_STATUSES = ["sent", "pending", "signed", "passed"] as const;
export type LabelPitchStatus = (typeof LABEL_PITCH_STATUSES)[number];

const router = Router();

/* ─── Label Pitch ─────────────────────────────────────────────────────────
   AI helps independent artists pitch demos to record labels: song analysis
   (genre/mood/energy/comparable artists) + a professional demo submission
   package — submission email, artist one-sheet/bio, and follow-up template.

   Pricing: 3 credits per demo kit (bigger package than playlist pitch).
   The label directory and the submission tracker are free — pure data,
   no compute.

   HONESTY RULE: labels rarely sign from cold demos. The UI must carry the
   disclaimer that relationships, buzz, and timing matter most. Never invent
   fake label contact emails or A&R names — every directory entry carries
   submission-channel guidance instead of a fabricated personal email. */

/* 3 credits per demo kit — env-overridable without a deploy. One GPT-6 Sol
   JSON completion per kit; the margin holds comfortably at 3 credits. */
export const LABEL_PITCH_CREDIT_COST =
  Number(process.env["LABEL_PITCH_CREDIT_COST"]) || 3;

export const DEMO_KIT_DISCLAIMER =
  "Labels rarely sign from cold demos — this gives you the most professional " +
  "package possible, but relationships, buzz, and timing matter most. " +
  "Build your audience, get your music heard, and let the package open doors " +
  "that talent alone can't.";

/* ── Label directory (starter list) ──────────────────────────────────────
   Major labels, key imprints, and notable independents, tagged by genre
   focus so the frontend can filter. Every entry carries honest
   submission-channel guidance — NEVER a fabricated personal email or A&R
   name. The UI must show the starter-list banner. */
export interface LabelEntry {
  id: string;
  name: string;
  parent: string;
  type: "major" | "imprint" | "indie";
  genres: string[];
  knownFor: string;
  submitVia: string;
  starter: true;
}

export const LABEL_GENRE_FILTERS = [
  "all",
  "hip-hop",
  "r&b",
  "pop",
  "rock",
  "country",
  "latin",
  "afrobeats",
  "edm",
] as const;
export type LabelGenreFilter = (typeof LABEL_GENRE_FILTERS)[number];

export const LABEL_STARTER_LIST: LabelEntry[] = [
  /* ── The Big Three ── */
  {
    id: "umg",
    name: "Universal Music Group",
    parent: "Independent (largest major)",
    type: "major",
    genres: ["hip-hop", "r&b", "pop", "rock", "country", "latin", "afrobeats", "edm"],
    knownFor: "The world's largest music company — home to the biggest global stars across every genre.",
    submitVia: "Unsolicited demos not accepted — you need a referral from an entertainment lawyer, manager, or trusted industry contact.",
    starter: true,
  },
  {
    id: "sony-music",
    name: "Sony Music Entertainment",
    parent: "Independent (major)",
    type: "major",
    genres: ["hip-hop", "r&b", "pop", "rock", "country", "latin", "afrobeats", "edm"],
    knownFor: "One of the Big Three — powerhouse across pop, hip-hop, and R&B with deep global reach.",
    submitVia: "Unsolicited demos not accepted — you need a referral from an entertainment lawyer, manager, or trusted industry contact.",
    starter: true,
  },
  {
    id: "warner-music",
    name: "Warner Music Group",
    parent: "Independent (major)",
    type: "major",
    genres: ["hip-hop", "r&b", "pop", "rock", "country", "latin", "afrobeats", "edm"],
    knownFor: "The third major — artist-development reputation, strong in hip-hop, pop, and alternative.",
    submitVia: "Unsolicited demos not accepted — you need a referral from an entertainment lawyer, manager, or trusted industry contact.",
    starter: true,
  },
  /* ── Key imprints ── */
  {
    id: "def-jam",
    name: "Def Jam Recordings",
    parent: "Universal Music Group",
    type: "imprint",
    genres: ["hip-hop", "r&b"],
    knownFor: "The legendary hip-hop label — the name alone carries weight in rap culture.",
    submitVia: "Unsolicited demos not accepted — A&R scouts from buzz, streaming numbers, and trusted referrals.",
    starter: true,
  },
  {
    id: "interscope",
    name: "Interscope Records",
    parent: "Universal Music Group",
    type: "imprint",
    genres: ["hip-hop", "pop", "r&b"],
    knownFor: "Home to era-defining pop and hip-hop acts — big budgets, big rollouts.",
    submitVia: "Unsolicited demos not accepted — A&R scouts from buzz, streaming numbers, and trusted referrals.",
    starter: true,
  },
  {
    id: "republic",
    name: "Republic Records",
    parent: "Universal Music Group",
    type: "imprint",
    genres: ["pop", "hip-hop", "r&b"],
    knownFor: "Chart-dominating pop and hip-hop — one of the most commercially successful imprints in the world.",
    submitVia: "Unsolicited demos not accepted — A&R scouts from buzz, streaming numbers, and trusted referrals.",
    starter: true,
  },
  {
    id: "atlantic",
    name: "Atlantic Records",
    parent: "Warner Music Group",
    type: "imprint",
    genres: ["hip-hop", "pop", "r&b"],
    knownFor: "Historic label with deep R&B roots — now a hip-hop and pop powerhouse.",
    submitVia: "Unsolicited demos not accepted — A&R scouts from buzz, streaming numbers, and trusted referrals.",
    starter: true,
  },
  {
    id: "columbia",
    name: "Columbia Records",
    parent: "Sony Music Entertainment",
    type: "imprint",
    genres: ["pop", "hip-hop", "rock", "r&b"],
    knownFor: "One of the oldest labels in the world — massive pop, rock, and hip-hop roster.",
    submitVia: "Unsolicited demos not accepted — A&R scouts from buzz, streaming numbers, and trusted referrals.",
    starter: true,
  },
  {
    id: "rca",
    name: "RCA Records",
    parent: "Sony Music Entertainment",
    type: "imprint",
    genres: ["pop", "r&b", "hip-hop"],
    knownFor: "Pop and R&B hitmaker — known for developing long-term superstar careers.",
    submitVia: "Unsolicited demos not accepted — A&R scouts from buzz, streaming numbers, and trusted referrals.",
    starter: true,
  },
  {
    id: "300-elektra",
    name: "300 Elektra Entertainment",
    parent: "Warner Music Group",
    type: "imprint",
    genres: ["hip-hop", "pop", "r&b"],
    knownFor: "Born from 300 Entertainment's indie hustle — street-level A&R with major backing.",
    submitVia: "Unsolicited demos not accepted — A&R scouts from buzz, streaming numbers, and trusted referrals.",
    starter: true,
  },
  /* ── Notable independents ── */
  {
    id: "empire",
    name: "EMPIRE",
    parent: "Independent",
    type: "indie",
    genres: ["hip-hop", "r&b", "afrobeats", "latin"],
    knownFor: "Independent distribution and label services — broke major hip-hop acts without a major deal.",
    submitVia: "Submissions via the EMPIRE website — they review demos through their official submission channel.",
    starter: true,
  },
  {
    id: "alamo",
    name: "Alamo Records",
    parent: "Sony Music (joint venture)",
    type: "indie",
    genres: ["hip-hop"],
    knownFor: "Hip-hop focused — built stars from the ground up with an artist-first reputation.",
    submitVia: "Primarily via industry referral — build buzz and connect through a lawyer or manager.",
    starter: true,
  },
  {
    id: "quality-control",
    name: "Quality Control Music",
    parent: "HYBE America",
    type: "indie",
    genres: ["hip-hop"],
    knownFor: "Atlanta hip-hop institution — known for developing raw talent into superstars.",
    submitVia: "Primarily via industry referral — A&R scouts from the Atlanta scene and viral momentum.",
    starter: true,
  },
];

export function getLabelsByGenre(genre: string): LabelEntry[] {
  const g = genre.trim().toLowerCase();
  if (!g || g === "all") return LABEL_STARTER_LIST;
  return LABEL_STARTER_LIST.filter((l) =>
    l.genres.some((lg) => lg === g || g.includes(lg) || lg.includes(g)),
  );
}

/* ── Demo kit generation ───────────────────────────────────────────────── */

const demoKitSchema = z.object({
  songTitle: z.string().min(1, "Song title is required.").max(200),
  artistName: z.string().max(200).optional().default(""),
  songDescription: z.string().max(1000).optional().default(""),
  genre: z.string().max(100).optional().default(""),
  mood: z.string().max(200).optional().default(""),
  energy: z.number().min(0).max(100).optional(),
  tempo: z.string().max(50).optional().default(""),
  lyrics: z.string().max(5000).optional().default(""),
  artistBio: z.string().max(2000).optional().default(""),
  socialStats: z.string().max(500).optional().default(""),
  labelName: z.string().max(200).optional().default(""),
});

export interface DemoSongAnalysis {
  genre: string;
  mood: string;
  energy: number;
  tempoFeel: string;
  comparableArtists: string[];
  labelFit: string[];
  oneLiner: string;
}

export interface DemoKit {
  analysis: DemoSongAnalysis;
  submissionEmail: { subject: string; body: string };
  oneSheet: string;
  followUp: string;
  disclaimer: string;
}

export function buildDemoKitPrompt(input: z.infer<typeof demoKitSchema>): string {
  const lines: string[] = [
    `Song title: "${input.songTitle}"`,
  ];
  if (input.artistName.trim()) lines.push(`Artist: "${input.artistName.trim()}"`);
  if (input.genre.trim()) lines.push(`Stated genre: "${input.genre.trim()}"`);
  if (input.mood.trim()) lines.push(`Stated mood: "${input.mood.trim()}"`);
  if (typeof input.energy === "number") lines.push(`Self-rated energy: ${input.energy}/100`);
  if (input.tempo.trim()) lines.push(`Tempo: "${input.tempo.trim()}"`);
  if (input.songDescription.trim()) lines.push(`Creator's description: "${input.songDescription.trim()}"`);
  if (input.artistBio.trim()) lines.push(`Artist bio (use facts from this): """${input.artistBio.trim().slice(0, 1500)}"""`);
  if (input.socialStats.trim()) lines.push(`Social/streaming stats: "${input.socialStats.trim()}"`);
  if (input.lyrics.trim()) lines.push(`Lyrics (analyze themes): """${input.lyrics.trim().slice(0, 3000)}"""`);
  const labelLine = input.labelName.trim()
    ? `\nSubmitting to: ${input.labelName.trim()}. Personalize the greeting and one line of the email to this label's roster and reputation.`
    : `\nNo specific label named — write the email with a [Label Name] placeholder the artist can fill in.`;
  return (
    `Analyze this independent artist's song and write a professional record-label demo submission package.\n\n` +
    lines.join("\n") + labelLine + `\n\n` +
    `Return ONLY JSON with this shape:\n` +
    `{\n` +
    `  "analysis": {\n` +
    `    "genre": "<primary genre + sub-genre, e.g. 'Trap / melodic rap'>",\n` +
    `    "mood": "<2-4 mood words>",\n` +
    `    "energy": <0-100>,\n` +
    `    "tempoFeel": "<e.g. 'slow burn', 'driving 4-on-the-floor'>",\n` +
    `    "comparableArtists": ["<3 well-known artists this actually sounds like>"],\n` +
    `    "labelFit": ["<3-5 label TYPES or imprints this fits, e.g. 'hip-hop imprints like Def Jam / 300 Elektra'>"],\n` +
    `    "oneLiner": "<one sentence describing the song like a publicist would>"\n` +
    `  },\n` +
    `  "submissionEmail": {\n` +
    `    "subject": "<under 60 chars, professional — format: 'Demo Submission: [Artist] — [Song]' style>",\n` +
    `    "body": "<200-280 words. Professional greeting, the one-liner, 2-3 sentences on the song's commercial potential and why it fits THIS label, artist background in 2 sentences (use bio facts if given, otherwise [bracketed placeholders]), streaming/social proof line (use stats if given, otherwise [bracketed placeholder]), private streaming link placeholder [Private Streaming Link], polite sign-off with contact placeholders [Phone] [Email]. Confident, never begging. No hype words like 'fire', 'banger', 'smash hit'.>"\n` +
    `  },\n` +
    `  "oneSheet": "<a concise artist one-sheet: ARTIST NAME header, then 3 short sections — 'THE SOUND' (2-3 sentences), 'THE STORY' (3-4 sentences, use bio facts or [placeholders]), 'THE NUMBERS' (bullet-style lines for streams/followers, use stats or [placeholders]). Under 250 words total.>",\n` +
    `  "followUp": "<under 60 words — polite 10-day follow-up nudge for a label A&R, professional tone>"\n` +
    `}\n\n` +
    `Rules: be specific, never generic. Never guarantee a deal — the music industry doesn't work that way. ` +
    `Write like a real artist manager, not a template. Where facts are missing, use [BRACKETED PLACEHOLDERS] ` +
    `rather than inventing achievements, numbers, or credentials.`
  );
}

function clampNum(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(100, Math.round(n)))
    : fallback;
}

function cleanStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanStrArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

export function parseDemoKitResponse(raw: string): DemoKit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const p = parsed as {
    analysis?: unknown; submissionEmail?: unknown; oneSheet?: unknown; followUp?: unknown;
  };
  const a = (p.analysis ?? {}) as Record<string, unknown>;
  const e = (p.submissionEmail ?? {}) as Record<string, unknown>;

  const comparableArtists = cleanStrArr(a["comparableArtists"], 3);
  const labelFit = cleanStrArr(a["labelFit"], 5);
  const oneLiner = cleanStr(a["oneLiner"]);
  const subject = cleanStr(e["subject"]);
  const body = cleanStr(e["body"]);
  const oneSheet = cleanStr(p.oneSheet);
  const followUp = cleanStr(p.followUp);

  if (!oneLiner || !subject || !body || !oneSheet) {
    throw new Error("Model returned an incomplete demo kit");
  }

  return {
    analysis: {
      genre: cleanStr(a["genre"]) || "Unspecified",
      mood: cleanStr(a["mood"]) || "Unspecified",
      energy: clampNum(a["energy"], 50),
      tempoFeel: cleanStr(a["tempoFeel"]) || "—",
      comparableArtists,
      labelFit,
      oneLiner,
    },
    submissionEmail: { subject, body },
    oneSheet,
    followUp: followUp || "Following up on the demo I sent over — would love your take when you have a moment.",
    disclaimer: DEMO_KIT_DISCLAIMER,
  };
}

/* POST /api/label-pitch/kit — 3 credits.
   Body: song details (+ optional label to personalize).
   Returns: { kit, creditsUsed, creditsRemaining } */
router.post(
  "/label-pitch/kit",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = demoKitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid demo kit request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < LABEL_PITCH_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to generate a demo kit.",
      });
      return;
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, LABEL_PITCH_CREDIT_COST, {
        action: "Label Pitch Demo Kit",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to generate a demo kit.",
        });
        return;
      }
      throw err;
    }

    const refundOnFailure = async () => {
      try {
        await refundCredits(req.userId!, LABEL_PITCH_CREDIT_COST, {
          action: "Label Pitch Demo Kit — Refund (generation failed)",
        });
      } catch (refundErr) {
        logger.error(
          { err: refundErr, userId: req.userId },
          "[label-pitch] refund failed after generation error",
        );
      }
    };

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              "You are an artist manager who has gotten independent artists " +
              "signed to major labels. You write demo submission packages " +
              "that get opened: specific, professional, respectful of the " +
              "A&R's time. You never use hype slang, never beg, never invent " +
              "fake achievements or numbers — you use bracketed placeholders " +
              "where facts are missing. You are honest that no package " +
              "guarantees a deal.",
          },
          { role: "user", content: buildDemoKitPrompt(parsed.data) },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
        temperature: 0.7,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const kit = parseDemoKitResponse(raw);

      res.json({
        kit,
        creditsUsed: LABEL_PITCH_CREDIT_COST,
        creditsRemaining,
      });
    } catch (err) {
      await refundOnFailure();
      if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
        logger.warn({ err }, "[label-pitch] OpenAI rate limit / quota");
        res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
        return;
      }
      logger.error({ err }, "[label-pitch] demo kit generation failed");
      res.status(502).json({ error: "The demo kit didn't come together — credits refunded. Try again." });
    }
  },
);

/* ── Label directory (free — pure data) ──────────────────────────────────── */

router.get("/label-pitch/labels", requireAuth, (req, res) => {
  const genre = typeof req.query["genre"] === "string" ? req.query["genre"] : "all";
  const type = typeof req.query["type"] === "string" ? req.query["type"] : "all";
  let labels = getLabelsByGenre(genre);
  if (type !== "all") {
    labels = labels.filter((l) => l.type === type);
  }
  res.json({
    labels,
    starterList: true,
    notice:
      "Starter list — verify each label's current submission policy before " +
      "sending anything. Major labels almost never accept unsolicited demos; " +
      "relationships and referrals matter most.",
  });
});

/* ── Submission tracker (free — pure data) ───────────────────────────────── */

const trackerCreateSchema = z.object({
  songTitle: z.string().min(1, "Song title is required.").max(200),
  artistName: z.string().max(200).optional().default(""),
  labelName: z.string().min(1, "Label name is required.").max(200),
  status: z.enum(LABEL_PITCH_STATUSES).optional().default("sent"),
  notes: z.string().max(1000).optional().default(""),
  contactedAt: z.string().max(50).optional(),
});

const trackerUpdateSchema = z.object({
  status: z.enum(LABEL_PITCH_STATUSES).optional(),
  notes: z.string().max(1000).optional(),
  labelName: z.string().min(1).max(200).optional(),
  contactedAt: z.string().max(50).optional().nullable(),
});

function toApiRow(row: typeof labelPitchesTable.$inferSelect) {
  return {
    id: row.id,
    songTitle: row.song_title,
    artistName: row.artist_name,
    labelName: row.label_name,
    status: row.status,
    notes: row.notes,
    contactedAt: row.contacted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/label-pitch/tracker", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(labelPitchesTable)
    .where(eq(labelPitchesTable.user_id, req.userId!))
    .orderBy(desc(labelPitchesTable.updated_at))
    .limit(200);
  res.json({ pitches: rows.map(toApiRow) });
});

router.post("/label-pitch/tracker", requireAuth, async (req, res) => {
  const parsed = trackerCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid submission entry.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(labelPitchesTable)
    .values({
      user_id: req.userId!,
      song_title: d.songTitle.trim(),
      artist_name: d.artistName.trim() || null,
      label_name: d.labelName.trim(),
      status: d.status,
      notes: d.notes.trim() || null,
      contacted_at: d.contactedAt ? new Date(d.contactedAt) : new Date(),
    })
    .returning();
  res.status(201).json({ pitch: toApiRow(row!) });
});

router.patch("/label-pitch/tracker/:id", requireAuth, async (req, res) => {
  const parsed = trackerUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid submission update.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof labelPitchesTable.$inferInsert> = {
    updated_at: new Date(),
  };
  if (d.status) updates.status = d.status;
  if (d.notes !== undefined) updates.notes = d.notes.trim() || null;
  if (d.labelName !== undefined) updates.label_name = d.labelName.trim();
  if (d.contactedAt !== undefined) {
    updates.contacted_at = d.contactedAt ? new Date(d.contactedAt) : null;
  }

  const [row] = await db
    .update(labelPitchesTable)
    .set(updates)
    .where(
      and(
        eq(labelPitchesTable.id, req.params["id"] as string),
        eq(labelPitchesTable.user_id, req.userId!),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Submission not found." });
    return;
  }
  res.json({ pitch: toApiRow(row) });
});

router.delete("/label-pitch/tracker/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .delete(labelPitchesTable)
    .where(
      and(
        eq(labelPitchesTable.id, req.params["id"] as string),
        eq(labelPitchesTable.user_id, req.userId!),
      ),
    )
    .returning({ id: labelPitchesTable.id });
  if (!row) {
    res.status(404).json({ error: "Submission not found." });
    return;
  }
  res.json({ deleted: row.id });
});

export default router;
