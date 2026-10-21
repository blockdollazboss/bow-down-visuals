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
import {
  db,
  playlistPitchesTable,
  pitchDeadlinesTable,
  distributionReleasesTable,
  creatorProfilesTable,
  presaveFollowsTable,
  presaveSharesTable,
  releaseLinkClicksTable,
} from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";

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
  Number(process.env["PLAYLIST_PITCH_CREDIT_COST"]) || 200;

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
        message: "You're out of Visual Bucs — top up to generate a pitch kit.",
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
          message: "You're out of Visual Bucs — top up to generate a pitch kit.",
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
      res.status(502).json({ error: "The pitch kit didn't come together — Visual Bucs refunded. Try again." });
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

/* ── Pitch packet from the release record (free — pure data) ───────────────
   Gap G7: until now the pitch kit was filled in by hand. The packet is
   assembled at read time from rows the house already keeps — the
   creator's distribution release record, their creator profile, and the
   release's real presave / smartlink stats. REAL DATA ONLY: a field the
   record doesn't hold comes back null/empty AND is named in `missing` —
   never filled with plausible text. (The release's presave_slug lives
   outside the drizzle schema — raw-SQL only in distribution.ts — so the
   packet links the artist-pasted streaming URLs + profile instead of
   guessing a smartlink URL.) */

export interface ReleaseRecordForPacket {
  id: string;
  title: string;
  artist_name: string;
  release_date: string | null;
  platforms: string[] | null;
  audio_url: string | null;
  artwork_url: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  presave_headline: string | null;
  presave_platform_links: Record<string, string> | null;
  presave_bonus_url: string | null;
}

export interface ProfileRecordForPacket {
  displayName: string;
  slug: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  followerCount: number;
  totalPlays: number;
  socialLinks: Record<string, string> | null;
}

export interface ReleaseStatsForPacket {
  presaves: number;
  shares: number;
  linkViews: number;
  linkClicks: number;
}

export interface PitchPacket {
  releaseId: string;
  artist: {
    name: string;
    profileSlug: string | null;
    profileUrl: string | null;
    bio: string | null;
    avatarUrl: string | null;
    followerCount: number | null;
    totalPlays: number | null;
    socialLinks: Record<string, string>;
  };
  release: {
    title: string;
    artistName: string;
    releaseDate: string | null;
    status: string;
    platforms: string[];
  };
  track: { title: string; audioUrl: string | null };
  genre: string[];
  description: string | null;
  links: {
    streaming: Record<string, string>;
    audioUrl: string | null;
    profileUrl: string | null;
  };
  stats: ReleaseStatsForPacket;
  pressAssets: {
    artworkUrl: string | null;
    headline: string | null;
    bonusUrl: string | null;
    bannerUrl: string | null;
    avatarUrl: string | null;
  };
  /* Dotted keys of promised fields the record does not hold. The UI
     renders each as "not on the record yet" — the honesty contract. */
  missing: string[];
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function buildPitchPacket(input: {
  release: ReleaseRecordForPacket;
  profile: ProfileRecordForPacket | null;
  stats: ReleaseStatsForPacket;
}): PitchPacket {
  const { release, profile, stats } = input;
  const missing: string[] = [];

  const meta = release.metadata ?? {};
  const genre = cleanStrArr(meta["genreTags"], 10);
  if (genre.length === 0) missing.push("genre");
  const description = nonEmpty(meta["description"]);
  if (!description) missing.push("description");
  if (!release.release_date) missing.push("releaseDate");
  if (!release.audio_url) missing.push("trackAudio");

  const streaming: Record<string, string> = {};
  for (const [k, v] of Object.entries(release.presave_platform_links ?? {})) {
    const url = nonEmpty(v);
    if (url) streaming[k] = url;
  }
  if (Object.keys(streaming).length === 0) missing.push("streamingLinks");
  if (!release.artwork_url) missing.push("artwork");
  if (!release.presave_headline) missing.push("headline");

  const profileUrl = profile ? `/artist/${profile.slug}` : null;
  if (!profile) missing.push("artistProfile");
  else if (!nonEmpty(profile.bio)) missing.push("artistBio");

  const socialLinks: Record<string, string> = {};
  for (const [k, v] of Object.entries(profile?.socialLinks ?? {})) {
    const url = nonEmpty(v);
    if (url) socialLinks[k] = url;
  }

  return {
    releaseId: release.id,
    artist: {
      name: profile?.displayName || release.artist_name,
      profileSlug: profile?.slug ?? null,
      profileUrl,
      bio: profile ? nonEmpty(profile.bio) : null,
      avatarUrl: profile?.avatarUrl ?? null,
      followerCount: profile?.followerCount ?? null,
      totalPlays: profile?.totalPlays ?? null,
      socialLinks,
    },
    release: {
      title: release.title,
      artistName: release.artist_name,
      releaseDate: release.release_date,
      status: release.status,
      platforms: Array.isArray(release.platforms) ? release.platforms : [],
    },
    track: { title: release.title, audioUrl: release.audio_url },
    genre,
    description,
    links: {
      streaming,
      audioUrl: release.audio_url,
      profileUrl,
    },
    stats,
    pressAssets: {
      artworkUrl: release.artwork_url,
      headline: release.presave_headline,
      bonusUrl: release.presave_bonus_url,
      bannerUrl: profile?.bannerUrl ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    },
    missing,
  };
}

/* The creator's own releases, for the packet + deadline pickers. */
router.get("/playlist-pitch/releases", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(distributionReleasesTable)
    .where(eq(distributionReleasesTable.user_id, req.userId!))
    .orderBy(desc(distributionReleasesTable.created_at))
    .limit(100);
  res.json({
    releases: rows.map((r) => ({
      id: r.id,
      title: r.title,
      artistName: r.artist_name,
      releaseDate: r.release_date,
      status: r.status,
    })),
  });
});

router.get("/playlist-pitch/packet/:releaseId", requireAuth, async (req, res) => {
  const releaseId = req.params["releaseId"] as string;
  const [release] = await db
    .select()
    .from(distributionReleasesTable)
    .where(
      and(
        eq(distributionReleasesTable.id, releaseId),
        eq(distributionReleasesTable.user_id, req.userId!),
      ),
    )
    .limit(1);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, req.userId!))
    .limit(1);

  const follows = await db
    .select({ id: presaveFollowsTable.id })
    .from(presaveFollowsTable)
    .where(eq(presaveFollowsTable.releaseId, releaseId));
  const shares = await db
    .select({ id: presaveSharesTable.id })
    .from(presaveSharesTable)
    .where(eq(presaveSharesTable.releaseId, releaseId));
  const linkRows = await db
    .select({ kind: releaseLinkClicksTable.kind })
    .from(releaseLinkClicksTable)
    .where(eq(releaseLinkClicksTable.releaseId, releaseId));

  const packet = buildPitchPacket({
    release,
    profile: profile ?? null,
    stats: {
      presaves: follows.length,
      shares: shares.length,
      linkViews: linkRows.filter((r) => r.kind === "view").length,
      linkClicks: linkRows.filter((r) => r.kind === "click").length,
    },
  });
  res.json({ packet });
});

/* ── Submission deadlines (free — in-app state only, migration 0198) ──────
   The pitch-window workflow: drafted → sent → followed_up → answered.
   Nothing here sends email or notifications — it is the creator's own
   board of what's due, visible in one place with what's due next. */

/* Deadline statuses — defined locally (not imported from @workspace/db)
   for the same worktree-test reason as PITCH_STATUSES above. Values
   match lib/db/src/schema/playlist-pitch.ts exactly. */
export const PITCH_DEADLINE_STATUSES = ["drafted", "sent", "followed_up", "answered"] as const;
export type PitchDeadlineStatus = (typeof PITCH_DEADLINE_STATUSES)[number];

export interface DeadlineApiRow {
  id: string;
  pitchId: string | null;
  releaseId: string | null;
  curatorName: string | null;
  playlistName: string;
  deadlineAt: string;
  status: string;
  notes: string | null;
  overdue: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

function deadlineTime(v: unknown): number {
  const t = v instanceof Date ? v.getTime() : new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toIsoOrNull(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/* Sort + summarize a creator's deadlines: soonest first, `dueNext` is
   the earliest still-open one (an overdue open deadline outranks a
   future one — it is the most urgent), answered rows never count. */
export function summarizeDeadlines(
  rows: Array<typeof pitchDeadlinesTable.$inferSelect>,
  now: Date,
): { deadlines: DeadlineApiRow[]; dueNext: DeadlineApiRow | null; overdueCount: number } {
  const deadlines: DeadlineApiRow[] = rows
    .map((row) => {
      const overdue =
        row.status !== "answered" && deadlineTime(row.deadline_at) < now.getTime();
      return {
        id: row.id,
        pitchId: row.pitch_id,
        releaseId: row.release_id,
        curatorName: row.curator_name,
        playlistName: row.playlist_name,
        deadlineAt: toIsoOrNull(row.deadline_at) ?? new Date(0).toISOString(),
        status: row.status,
        notes: row.notes,
        overdue,
        createdAt: toIsoOrNull(row.created_at),
        updatedAt: toIsoOrNull(row.updated_at),
      };
    })
    .sort((a, b) => deadlineTime(a.deadlineAt) - deadlineTime(b.deadlineAt));
  const open = deadlines.filter((d) => d.status !== "answered");
  return {
    deadlines,
    dueNext: open[0] ?? null,
    overdueCount: open.filter((d) => d.overdue).length,
  };
}

const deadlineCreateSchema = z.object({
  playlistName: z.string().min(1, "Playlist name is required.").max(200),
  curatorName: z.string().max(200).optional().default(""),
  deadlineAt: z.string().min(1, "Deadline date is required.").max(50),
  status: z.enum(PITCH_DEADLINE_STATUSES).optional().default("drafted"),
  notes: z.string().max(1000).optional().default(""),
  pitchId: z.string().min(1).max(100).optional(),
  releaseId: z.string().min(1).max(100).optional(),
});

const deadlineUpdateSchema = z.object({
  playlistName: z.string().min(1).max(200).optional(),
  curatorName: z.string().max(200).optional(),
  deadlineAt: z.string().min(1).max(50).optional(),
  status: z.enum(PITCH_DEADLINE_STATUSES).optional(),
  notes: z.string().max(1000).optional(),
  pitchId: z.string().min(1).max(100).nullable().optional(),
  releaseId: z.string().min(1).max(100).nullable().optional(),
});

function parseDeadlineDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/* A linked pitch/release must be the creator's own — a stranger's id is
   a 404, never a silent attach and never a leak. */
async function ownsPitch(userId: string, pitchId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: playlistPitchesTable.id })
    .from(playlistPitchesTable)
    .where(
      and(
        eq(playlistPitchesTable.id, pitchId),
        eq(playlistPitchesTable.user_id, userId),
      ),
    )
    .limit(1);
  return !!row;
}

async function ownsRelease(userId: string, releaseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: distributionReleasesTable.id })
    .from(distributionReleasesTable)
    .where(
      and(
        eq(distributionReleasesTable.id, releaseId),
        eq(distributionReleasesTable.user_id, userId),
      ),
    )
    .limit(1);
  return !!row;
}

router.get("/playlist-pitch/deadlines", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(pitchDeadlinesTable)
    .where(eq(pitchDeadlinesTable.user_id, req.userId!))
    .orderBy(asc(pitchDeadlinesTable.deadline_at))
    .limit(200);
  res.json(summarizeDeadlines(rows, new Date()));
});

router.post("/playlist-pitch/deadlines", requireAuth, async (req, res) => {
  const parsed = deadlineCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid deadline.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  const d = parsed.data;
  const when = parseDeadlineDate(d.deadlineAt);
  if (!when) {
    res.status(400).json({ error: "Deadline date is not a valid date." });
    return;
  }
  if (d.pitchId && !(await ownsPitch(req.userId!, d.pitchId))) {
    res.status(404).json({ error: "Pitch not found." });
    return;
  }
  if (d.releaseId && !(await ownsRelease(req.userId!, d.releaseId))) {
    res.status(404).json({ error: "Release not found." });
    return;
  }
  const [row] = await db
    .insert(pitchDeadlinesTable)
    .values({
      user_id: req.userId!,
      pitch_id: d.pitchId ?? null,
      release_id: d.releaseId ?? null,
      curator_name: d.curatorName.trim() || null,
      playlist_name: d.playlistName.trim(),
      deadline_at: when,
      status: d.status,
      notes: d.notes.trim() || null,
    })
    .returning();
  const { deadlines } = summarizeDeadlines([row!], new Date());
  res.status(201).json({ deadline: deadlines[0] });
});

router.patch("/playlist-pitch/deadlines/:id", requireAuth, async (req, res) => {
  const parsed = deadlineUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid deadline update.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof pitchDeadlinesTable.$inferInsert> = {
    updated_at: new Date(),
  };
  if (d.playlistName !== undefined) updates.playlist_name = d.playlistName.trim();
  if (d.curatorName !== undefined) updates.curator_name = d.curatorName.trim() || null;
  if (d.notes !== undefined) updates.notes = d.notes.trim() || null;
  if (d.status !== undefined) updates.status = d.status;
  if (d.deadlineAt !== undefined) {
    const when = parseDeadlineDate(d.deadlineAt);
    if (!when) {
      res.status(400).json({ error: "Deadline date is not a valid date." });
      return;
    }
    updates.deadline_at = when;
  }
  if (d.pitchId !== undefined) {
    if (d.pitchId !== null && !(await ownsPitch(req.userId!, d.pitchId))) {
      res.status(404).json({ error: "Pitch not found." });
      return;
    }
    updates.pitch_id = d.pitchId;
  }
  if (d.releaseId !== undefined) {
    if (d.releaseId !== null && !(await ownsRelease(req.userId!, d.releaseId))) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    updates.release_id = d.releaseId;
  }

  const [row] = await db
    .update(pitchDeadlinesTable)
    .set(updates)
    .where(
      and(
        eq(pitchDeadlinesTable.id, req.params["id"] as string),
        eq(pitchDeadlinesTable.user_id, req.userId!),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Deadline not found." });
    return;
  }
  const { deadlines } = summarizeDeadlines([row], new Date());
  res.json({ deadline: deadlines[0] });
});

router.delete("/playlist-pitch/deadlines/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .delete(pitchDeadlinesTable)
    .where(
      and(
        eq(pitchDeadlinesTable.id, req.params["id"] as string),
        eq(pitchDeadlinesTable.user_id, req.userId!),
      ),
    )
    .returning({ id: pitchDeadlinesTable.id });
  if (!row) {
    res.status(404).json({ error: "Deadline not found." });
    return;
  }
  res.json({ deleted: row.id });
});

export default router;
