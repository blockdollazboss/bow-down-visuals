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
import { db, playlistPitchesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

/* Pitch statuses — defined locally (not imported from @workspace/db) so the
   module evaluates cleanly in worktree test environments where the symlinked
   @workspace/db predates the playlist_pitches table. Values match
   lib/db/src/schema/playlist-pitch.ts exactly. */
export const PITCH_STATUSES = ["sent", "pending", "accepted", "rejected"] as const;
export type PitchStatus = (typeof PITCH_STATUSES)[number];

const router = Router();

/* ─── Playlist Pitcher ────────────────────────────────────────────────────
   AI helps independent musicians pitch songs to Spotify/editorial
   playlists: song analysis (genre/mood/energy/comparable artists) +
   a professional pitch email + a short DM version, tailored per kit.

   Pricing: 2 credits per pitch kit (analysis + pitch draft). The curator
   directory and the pitch tracker are free — pure data, no compute. */

/* 2 credits per pitch kit — env-overridable without a deploy. One GPT-6 Sol
   JSON completion per kit; the margin holds comfortably at 2 credits. */
export const PLAYLIST_PITCH_CREDIT_COST =
  Number(process.env["PLAYLIST_PITCH_CREDIT_COST"]) || 2;

export const PITCH_KIT_DISCLAIMER =
  "Pitching improves your odds — it never guarantees placement. " +
  "Curators say yes based on fit, timing, and taste; no AI can promise a slot.";

/* ── Curator starter list ──────────────────────────────────────────────────
   Honest, verifiable pitching channels independent artists actually use,
   tagged by genre focus so the frontend can filter. This is a STARTER
   list — every entry carries submission-channel guidance instead of a
   fabricated personal email, and the UI must show the starter-list banner.
   Never add a fake curator name or email here. */
export interface CuratorEntry {
  id: string;
  name: string;
  platform: string;
  genres: string[];
  focus: string;
  submitVia: string;
  starter: true;
}

export const GENRE_FILTERS = [
  "all",
  "hip-hop",
  "r&b",
  "pop",
  "edm",
  "rock",
  "indie",
  "country",
  "latin",
  "afrobeats",
] as const;
export type GenreFilter = (typeof GENRE_FILTERS)[number];

export const CURATOR_STARTER_LIST: CuratorEntry[] = [
  {
    id: "spotify-for-artists",
    name: "Spotify for Artists — Editorial Pitching",
    platform: "Spotify",
    genres: ["hip-hop", "r&b", "pop", "edm", "rock", "indie", "country", "latin", "afrobeats"],
    focus: "Official Spotify editorial playlists (RapCaviar, Today's Top Hits, etc.)",
    submitVia: "Free pitch inside Spotify for Artists — submit unreleased music at least 7 days before release day.",
    starter: true,
  },
  {
    id: "submithub",
    name: "SubmitHub",
    platform: "Multi-platform",
    genres: ["hip-hop", "r&b", "pop", "edm", "rock", "indie", "country", "latin", "afrobeats"],
    focus: "Independent playlist curators, blogs, and influencers who guarantee a listen",
    submitVia: "Create a campaign on SubmitHub — pick curators by genre, pay per submission, get feedback either way.",
    starter: true,
  },
  {
    id: "groover",
    name: "Groover",
    platform: "Multi-platform",
    genres: ["hip-hop", "r&b", "pop", "edm", "rock", "indie", "country", "latin", "afrobeats"],
    focus: "Curators, radio stations, and playlisters with guaranteed 7-day feedback",
    submitVia: "Send your track on Groover to genre-matched curators — you get heard or your credits come back.",
    starter: true,
  },
  {
    id: "daily-playlists",
    name: "Daily Playlists",
    platform: "Spotify",
    genres: ["hip-hop", "r&b", "pop", "edm", "rock", "indie", "latin", "afrobeats"],
    focus: "Free curator submissions across hundreds of independent Spotify playlists",
    submitVia: "Submit free on Daily Playlists — match your genre, follow each curator's rules.",
    starter: true,
  },
  {
    id: "playlist-push",
    name: "Playlist Push",
    platform: "Spotify / TikTok",
    genres: ["hip-hop", "r&b", "pop", "edm", "indie", "latin", "afrobeats"],
    focus: "Paid campaigns to vetted independent curators with real audiences",
    submitVia: "Launch a Playlist Push campaign — curators opt in, placements are earned, never bought.",
    starter: true,
  },
  {
    id: "user-curated-hiphop",
    name: "Independent Hip-Hop Playlists (user-curated)",
    platform: "Spotify",
    genres: ["hip-hop"],
    focus: "Independent curators running underground / new-rap / boom-bap lists",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
  {
    id: "user-curated-rnb",
    name: "Independent R&B Playlists (user-curated)",
    platform: "Spotify",
    genres: ["r&b"],
    focus: "Slow-jam, alt-R&B, and late-night vibe curators",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
  {
    id: "user-curated-pop",
    name: "Independent Pop Playlists (user-curated)",
    platform: "Spotify",
    genres: ["pop"],
    focus: "Rising-pop and hyperpop curators hunting fresh singles",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
  {
    id: "user-curated-edm",
    name: "Independent EDM Playlists (user-curated)",
    platform: "Spotify",
    genres: ["edm"],
    focus: "House, phonk, dubstep, and festival-energy curators",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
  {
    id: "user-curated-indie",
    name: "Independent Indie Playlists (user-curated)",
    platform: "Spotify",
    genres: ["indie", "rock"],
    focus: "Indie rock, bedroom pop, and shoegaze curators",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
  {
    id: "user-curated-country",
    name: "Independent Country Playlists (user-curated)",
    platform: "Spotify",
    genres: ["country"],
    focus: "Modern country and country-pop curators",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
  {
    id: "user-curated-latin",
    name: "Independent Latin Playlists (user-curated)",
    platform: "Spotify",
    genres: ["latin"],
    focus: "Reggaeton, Latin pop, and regional Mexican curators",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
  {
    id: "user-curated-afrobeats",
    name: "Independent Afrobeats Playlists (user-curated)",
    platform: "Spotify",
    genres: ["afrobeats"],
    focus: "Afrobeats, amapiano, and Afro-fusion curators",
    submitVia: "Search Spotify for your sub-genre + filter by Playlists — find the curator's Instagram in the playlist description and pitch there.",
    starter: true,
  },
];

export function getCuratorsByGenre(genre: string): CuratorEntry[] {
  const g = genre.trim().toLowerCase();
  if (!g || g === "all") return CURATOR_STARTER_LIST;
  return CURATOR_STARTER_LIST.filter((c) =>
    c.genres.some((cg) => cg === g || g.includes(cg) || cg.includes(g)),
  );
}

/* ── Pitch kit generation ────────────────────────────────────────────────── */

const pitchKitSchema = z.object({
  songTitle: z.string().min(1, "Song title is required.").max(200),
  artistName: z.string().max(200).optional().default(""),
  songDescription: z.string().max(1000).optional().default(""),
  genre: z.string().max(100).optional().default(""),
  mood: z.string().max(200).optional().default(""),
  energy: z.number().min(0).max(100).optional(),
  tempo: z.string().max(50).optional().default(""),
  lyrics: z.string().max(5000).optional().default(""),
  releaseDate: z.string().max(50).optional().default(""),
  curatorName: z.string().max(200).optional().default(""),
  playlistName: z.string().max(200).optional().default(""),
});

export interface SongAnalysis {
  genre: string;
  mood: string;
  energy: number;
  tempoFeel: string;
  comparableArtists: string[];
  playlistFit: string[];
  oneLiner: string;
}

export interface PitchKit {
  analysis: SongAnalysis;
  pitchEmail: { subject: string; body: string };
  dmPitch: string;
  followUp: string;
  disclaimer: string;
}

export function buildPitchKitPrompt(input: z.infer<typeof pitchKitSchema>): string {
  const lines: string[] = [
    `Song title: "${input.songTitle}"`,
  ];
  if (input.artistName.trim()) lines.push(`Artist: "${input.artistName.trim()}"`);
  if (input.genre.trim()) lines.push(`Stated genre: "${input.genre.trim()}"`);
  if (input.mood.trim()) lines.push(`Stated mood: "${input.mood.trim()}"`);
  if (typeof input.energy === "number") lines.push(`Self-rated energy: ${input.energy}/100`);
  if (input.tempo.trim()) lines.push(`Tempo: "${input.tempo.trim()}"`);
  if (input.releaseDate.trim()) lines.push(`Release timing: "${input.releaseDate.trim()}"`);
  if (input.songDescription.trim()) lines.push(`Creator's description: "${input.songDescription.trim()}"`);
  if (input.lyrics.trim()) lines.push(`Lyrics (analyze themes): """${input.lyrics.trim().slice(0, 3000)}"""`);
  const curatorLine = input.curatorName.trim() || input.playlistName.trim()
    ? `\nPitching to: ${[input.curatorName.trim(), input.playlistName.trim()].filter(Boolean).join(" — ")}. Personalize the greeting and one line of the email to this curator/playlist.`
    : `\nNo specific curator named — write the pitch with [Curator Name] and [Playlist Name] placeholders the artist can fill in.`;
  return (
    `Analyze this independent artist's song and write a professional playlist pitch kit.\n\n` +
    lines.join("\n") + curatorLine + `\n\n` +
    `Return ONLY JSON with this shape:\n` +
    `{\n` +
    `  "analysis": {\n` +
    `    "genre": "<primary genre + sub-genre, e.g. 'Alt R&B / bedroom pop'>",\n` +
    `    "mood": "<2-4 mood words>",\n` +
    `    "energy": <0-100>,\n` +
    `    "tempoFeel": "<e.g. 'slow burn', 'driving 4-on-the-floor'>",\n` +
    `    "comparableArtists": ["<3 well-known artists this actually sounds like>"],\n` +
    `    "playlistFit": ["<3-5 specific playlist TYPES this fits, e.g. 'late-night R&B Spotify editorial'>"],\n` +
    `    "oneLiner": "<one sentence describing the song like a publicist would>"\n` +
    `  },\n` +
    `  "pitchEmail": {\n` +
    `    "subject": "<under 60 chars, specific — never 'Check out my song'>",\n` +
    `    "body": "<150-220 words. Short personalized greeting, the one-liner, 2-3 sentences on why it fits THIS playlist, release timing + link placeholder [Streaming Link], one-line artist bio, polite sign-off. Confident, never begging. No hype words like 'fire', 'banger', 'smash hit'.>"\n` +
    `  },\n` +
    `  "dmPitch": "<under 60 words for Instagram/Twitter DMs — casual, specific, includes [Streaming Link] placeholder>",\n` +
    `  "followUp": "<under 50 words — polite 7-day follow-up nudge>"\n` +
    `}\n\n` +
    `Rules: be specific, never generic. Never guarantee placement. Write like a real publicist, not a template.`
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

export function parsePitchKitResponse(raw: string): PitchKit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const p = parsed as {
    analysis?: unknown; pitchEmail?: unknown; dmPitch?: unknown; followUp?: unknown;
  };
  const a = (p.analysis ?? {}) as Record<string, unknown>;
  const e = (p.pitchEmail ?? {}) as Record<string, unknown>;

  const comparableArtists = cleanStrArr(a["comparableArtists"], 3);
  const playlistFit = cleanStrArr(a["playlistFit"], 5);
  const oneLiner = cleanStr(a["oneLiner"]);
  const subject = cleanStr(e["subject"]);
  const body = cleanStr(e["body"]);
  const dmPitch = cleanStr(p.dmPitch);
  const followUp = cleanStr(p.followUp);

  if (!oneLiner || !subject || !body || !dmPitch) {
    throw new Error("Model returned an incomplete pitch kit");
  }

  return {
    analysis: {
      genre: cleanStr(a["genre"]) || "Unspecified",
      mood: cleanStr(a["mood"]) || "Unspecified",
      energy: clampNum(a["energy"], 50),
      tempoFeel: cleanStr(a["tempoFeel"]) || "—",
      comparableArtists,
      playlistFit,
      oneLiner,
    },
    pitchEmail: { subject, body },
    dmPitch,
    followUp: followUp || "Just floating this back up in case it got buried — would love your take when you have a moment.",
    disclaimer: PITCH_KIT_DISCLAIMER,
  };
}

/* POST /api/playlist-pitch/kit — 2 credits.
   Body: song details (+ optional curator/playlist to personalize).
   Returns: { kit, creditsUsed, creditsRemaining } */
router.post(
  "/playlist-pitch/kit",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = pitchKitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid pitch kit request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < PLAYLIST_PITCH_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to generate a pitch kit.",
      });
      return;
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, PLAYLIST_PITCH_CREDIT_COST, {
        action: "Playlist Pitch Kit",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to generate a pitch kit.",
        });
        return;
      }
      throw err;
    }

    const refundOnFailure = async () => {
      try {
        await refundCredits(req.userId!, PLAYLIST_PITCH_CREDIT_COST, {
          action: "Playlist Pitch Kit — Refund (generation failed)",
        });
      } catch (refundErr) {
        logger.error(
          { err: refundErr, userId: req.userId },
          "[playlist-pitch] refund failed after generation error",
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
              "You are a music publicist who has placed independent artists on " +
              "Spotify editorial and major independent playlists. You write " +
              "pitches that get opened: specific, confident, respectful of the " +
              "curator's time. You never use hype slang, never beg, and never " +
              "promise placement.",
          },
          { role: "user", content: buildPitchKitPrompt(parsed.data) },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1500,
        temperature: 0.7,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const kit = parsePitchKitResponse(raw);

      res.json({
        kit,
        creditsUsed: PLAYLIST_PITCH_CREDIT_COST,
        creditsRemaining,
      });
    } catch (err) {
      await refundOnFailure();
      if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
        logger.warn({ err }, "[playlist-pitch] OpenAI rate limit / quota");
        res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
        return;
      }
      logger.error({ err }, "[playlist-pitch] pitch kit generation failed");
      res.status(502).json({ error: "The pitch kit didn't come together — credits refunded. Try again." });
    }
  },
);

/* ── Curator directory (free — pure data) ────────────────────────────────── */

router.get("/playlist-pitch/curators", requireAuth, (req, res) => {
  const genre = typeof req.query["genre"] === "string" ? req.query["genre"] : "all";
  res.json({
    curators: getCuratorsByGenre(genre),
    starterList: true,
    notice:
      "Starter list — verify each curator's current submission guidelines " +
      "before pitching. Never pay for guaranteed placements.",
  });
});

/* ── Pitch tracker (free — pure data) ────────────────────────────────────── */

const trackerCreateSchema = z.object({
  songTitle: z.string().min(1, "Song title is required.").max(200),
  artistName: z.string().max(200).optional().default(""),
  curatorName: z.string().max(200).optional().default(""),
  playlistName: z.string().min(1, "Playlist name is required.").max(200),
  status: z.enum(PITCH_STATUSES).optional().default("sent"),
  notes: z.string().max(1000).optional().default(""),
  contactedAt: z.string().max(50).optional(),
});

const trackerUpdateSchema = z.object({
  status: z.enum(PITCH_STATUSES).optional(),
  notes: z.string().max(1000).optional(),
  curatorName: z.string().max(200).optional(),
  playlistName: z.string().min(1).max(200).optional(),
  contactedAt: z.string().max(50).optional().nullable(),
});

function toApiRow(row: typeof playlistPitchesTable.$inferSelect) {
  return {
    id: row.id,
    songTitle: row.song_title,
    artistName: row.artist_name,
    curatorName: row.curator_name,
    playlistName: row.playlist_name,
    status: row.status,
    notes: row.notes,
    contactedAt: row.contacted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/playlist-pitch/tracker", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(playlistPitchesTable)
    .where(eq(playlistPitchesTable.user_id, req.userId!))
    .orderBy(desc(playlistPitchesTable.updated_at))
    .limit(200);
  res.json({ pitches: rows.map(toApiRow) });
});

router.post("/playlist-pitch/tracker", requireAuth, async (req, res) => {
  const parsed = trackerCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid pitch entry.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(playlistPitchesTable)
    .values({
      user_id: req.userId!,
      song_title: d.songTitle.trim(),
      artist_name: d.artistName.trim() || null,
      curator_name: d.curatorName.trim() || null,
      playlist_name: d.playlistName.trim(),
      status: d.status,
      notes: d.notes.trim() || null,
      contacted_at: d.contactedAt ? new Date(d.contactedAt) : new Date(),
    })
    .returning();
  res.status(201).json({ pitch: toApiRow(row!) });
});

router.patch("/playlist-pitch/tracker/:id", requireAuth, async (req, res) => {
  const parsed = trackerUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid pitch update.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof playlistPitchesTable.$inferInsert> = {
    updated_at: new Date(),
  };
  if (d.status) updates.status = d.status;
  if (d.notes !== undefined) updates.notes = d.notes.trim() || null;
  if (d.curatorName !== undefined) updates.curator_name = d.curatorName.trim() || null;
  if (d.playlistName !== undefined) updates.playlist_name = d.playlistName.trim();
  if (d.contactedAt !== undefined) {
    updates.contacted_at = d.contactedAt ? new Date(d.contactedAt) : null;
  }

  const [row] = await db
    .update(playlistPitchesTable)
    .set(updates)
    .where(
      and(
        eq(playlistPitchesTable.id, req.params["id"] as string),
        eq(playlistPitchesTable.user_id, req.userId!),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Pitch not found." });
    return;
  }
  res.json({ pitch: toApiRow(row) });
});

router.delete("/playlist-pitch/tracker/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .delete(playlistPitchesTable)
    .where(
      and(
        eq(playlistPitchesTable.id, req.params["id"] as string),
        eq(playlistPitchesTable.user_id, req.userId!),
      ),
    )
    .returning({ id: playlistPitchesTable.id });
  if (!row) {
    res.status(404).json({ error: "Pitch not found." });
    return;
  }
  res.json({ deleted: row.id });
});

export default router;
