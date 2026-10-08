import { Router, type Request, type Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  challengesTable,
  challengeEntriesTable,
  challengePrizesTable,
  challengeVotesTable,
  challengeWinnersTable,
  creatorProfilesTable,
  profileVideosTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";

/* ─── Challenge engine 2.0 — prizes, judging, winners' circle ─────────────
   The competitive layer on top of challenges (0091):
     GET  /challenges/:slug/prizes         public prize pool (shown upfront)
     POST /challenges/:slug/vote           community voting, 1/user/entry (auth)
     GET  /challenges/:slug/winners        public winners (SEO page data)
     GET  /challenges/hall-of-fame        all-time winners
     GET  /challenges/wins/:slug           a creator's wins (profile badges)
     GET  /challenges/live-now             upcoming + live challenges (CTAs)
     POST /admin/challenges/:slug/prizes    configure the prize pool (admin)
     POST /admin/challenges/:slug/lifecycle upcoming→live→judging→winners (admin)
     POST /admin/challenges/:slug/judge     finalize winners, auto-pay (admin)

   Money rules (Visual Bucs x100 — amounts are always multiples of 100):
   - Prizes are configured up front and shown publicly before anyone enters.
   - The judge endpoint pays prizes idempotently: each winner row is claimed
     with UPDATE ... WHERE paid_at IS NULL, so concurrent judges can never
     double-pay. A prize pool cannot be edited after winners are announced.
   - Every grant goes through the strict credit ledger (negative creditsUsed)
     with rollback, same as admin credit grants.
   NOTE: the GET /challenges/:slug detail endpoint in shorts.ts is extended
   in place (lifecycle fields, prize list, vote counts, viewer votes).
*/

const router = Router();

const voteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Easy, champ — votes need a breather. 🦈" },
});

const adminWriteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Too many admin moves, too fast." },
});

type Lifecycle = "upcoming" | "live" | "judging" | "winners";
const LIFECYCLES: Lifecycle[] = ["upcoming", "live", "judging", "winners"];

/** Derived lifecycle: dates auto-advance upcoming→live→judging; 'winners' sticks. */
export function effectiveStatus(ch: {
  status: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
}): Lifecycle {
  const now = Date.now();
  if (ch.status === "winners") return "winners";
  if (ch.endsAt && new Date(ch.endsAt).getTime() <= now) return "judging";
  if (ch.startsAt && new Date(ch.startsAt).getTime() > now) return "upcoming";
  return ch.status === "judging" ? "judging" : "live";
}

async function getChallenge(slug: string) {
  const [ch] = await db
    .select()
    .from(challengesTable)
    .where(eq(challengesTable.slug, slug))
    .limit(1);
  return ch ?? null;
}

function shapePrize(p: typeof challengePrizesTable.$inferSelect) {
  return {
    place: p.place,
    prize_credits: p.prizeCredits,
    description: p.description,
  };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}

/** Grant Visual Bucs with the strict ledger + rollback pattern (admin-grant style). */
async function grantVisualBucs(
  req: Request,
  userId: string,
  amount: number,
  action: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: profile, error: fetchErr } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  if (fetchErr || !profile) throw fetchErr ?? new Error("profile missing for prize payout");
  const oldBalance = profile.credits ?? 0;
  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ credits: oldBalance + amount })
    .eq("id", userId);
  if (updateErr) throw updateErr;
  try {
    await recordCreditUsageStrict({ userId, action, creditsUsed: -amount });
  } catch (ledgerErr) {
    req.log.error({ err: ledgerErr, userId, amount }, "challenge prize: ledger failed — rolling back grant");
    await supabase.from("profiles").update({ credits: oldBalance }).eq("id", userId);
    throw ledgerErr;
  }
}

/** Best-effort notification batch; never fails the request. */
async function notifyMany(
  items: Array<{ userId: string; kind: string; title: string; body?: string; link?: string }>,
) {
  if (!items.length) return;
  try {
    await db.insert(notificationsTable).values(
      items.map((n) => ({
        userId: n.userId,
        kind: n.kind,
        title: n.title,
        body: n.body ?? "",
        link: n.link ?? "",
      })),
    );
  } catch { /* notifications are non-critical */ }
}

/* ── GET /challenges/:slug/prizes — the prize pool, shown upfront ───────── */
router.get("/challenges/:slug/prizes", async (req, res) => {
  try {
    const ch = await getChallenge(String(req.params["slug"]));
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name." });
      return;
    }
    const prizes = await db
      .select()
      .from(challengePrizesTable)
      .where(eq(challengePrizesTable.challengeId, ch.id))
      .orderBy(challengePrizesTable.place);
    res.json({
      challenge_slug: ch.slug,
      total_credits: prizes.reduce((s, p) => s + p.prizeCredits, 0),
      prizes: prizes.map(shapePrize),
    });
  } catch (err) {
    req.log.error({ err }, "challenge prizes error");
    res.status(500).json({ error: "Couldn't load the prize pool." });
  }
});

/* ── POST /challenges/:slug/vote — one vote per user per entry (toggle) ────
   Anti-spam: rate-limited, no self-votes, voting only while live/judging,
   and a per-user cap of 100 votes per challenge. */
const voteSchema = z.object({ video_id: z.string().uuid() });
const MAX_VOTES_PER_USER_PER_CHALLENGE = 100;

router.post("/challenges/:slug/vote", requireAuth, voteLimiter, async (req, res) => {
  try {
    const userId = req.userId!;
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "video_id is required — which entry gets your vote?" });
      return;
    }
    const ch = await getChallenge(String(req.params["slug"]));
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name." });
      return;
    }
    const status = effectiveStatus(ch);
    if (status !== "live" && status !== "judging") {
      res.status(409).json({
        error:
          status === "upcoming"
            ? "Voting opens when the challenge goes live. Soon. 🦈"
            : "Voting's closed — the winners are crowned.",
      });
      return;
    }
    const videoId = parsed.data.video_id;

    // Must be an entry of THIS challenge.
    const [entry] = await db
      .select({ videoId: challengeEntriesTable.videoId })
      .from(challengeEntriesTable)
      .where(and(eq(challengeEntriesTable.challengeId, ch.id), eq(challengeEntriesTable.videoId, videoId)))
      .limit(1);
    if (!entry) {
      res.status(404).json({ error: "That video isn't in this challenge." });
      return;
    }

    // No self-votes.
    const [video] = await db
      .select({ profileId: profileVideosTable.profileId })
      .from(profileVideosTable)
      .where(eq(profileVideosTable.id, videoId))
      .limit(1);
    if (video) {
      const [prof] = await db
        .select({ userId: creatorProfilesTable.userId })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.id, video.profileId))
        .limit(1);
      if (prof?.userId === userId) {
        res.status(403).json({ error: "Can't vote your own entry — your fans have to do that. 🦈" });
        return;
      }
    }

    const out = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: challengeVotesTable.id })
        .from(challengeVotesTable)
        .where(and(eq(challengeVotesTable.userId, userId), eq(challengeVotesTable.videoId, videoId)))
        .limit(1);
      const bump = and(
        eq(challengeEntriesTable.challengeId, ch.id),
        eq(challengeEntriesTable.videoId, videoId),
      );
      if (existing) {
        // Toggle off.
        await tx.delete(challengeVotesTable).where(eq(challengeVotesTable.id, existing.id));
        await tx
          .update(challengeEntriesTable)
          .set({ voteCount: sql`GREATEST(${challengeEntriesTable.voteCount} - 1, 0)` })
          .where(bump);
        return { voted: false };
      }
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(challengeVotesTable)
        .where(and(eq(challengeVotesTable.challengeId, ch.id), eq(challengeVotesTable.userId, userId)));
      if ((n ?? 0) >= MAX_VOTES_PER_USER_PER_CHALLENGE) {
        throw Object.assign(new Error("vote-cap"), { statusCode: 429 });
      }
      try {
        await tx.insert(challengeVotesTable).values({ challengeId: ch.id, videoId, userId });
      } catch (e) {
        // Raced with a double-tap: the unique constraint won elsewhere.
        if (e instanceof Error && /duplicate|unique/i.test(e.message)) return { voted: false };
        throw e;
      }
      await tx
        .update(challengeEntriesTable)
        .set({ voteCount: sql`${challengeEntriesTable.voteCount} + 1` })
        .where(bump);
      return { voted: true };
    });

    const [{ vote_count }] = await db
      .select({ vote_count: challengeEntriesTable.voteCount })
      .from(challengeEntriesTable)
      .where(and(eq(challengeEntriesTable.challengeId, ch.id), eq(challengeEntriesTable.videoId, videoId)))
      .limit(1);
    res.json({ voted: out.voted, vote_count: vote_count ?? 0 });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    if (statusCode !== 500) {
      res.status(statusCode).json({ error: "You've hit the vote cap for this challenge. Spread the love elsewhere. 🦈" });
      return;
    }
    req.log.error({ err }, "challenge vote error");
    res.status(500).json({ error: "The vote didn't land. Try again." });
  }
});

/* ── GET /challenges/:slug/winners — public winners, SEO page data ───────── */
router.get("/challenges/:slug/winners", async (req, res) => {
  try {
    const ch = await getChallenge(String(req.params["slug"]));
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name." });
      return;
    }
    const rows = await db.execute(sql`
      SELECT w.place, w.prize_credits, w.paid_at, w.announced_at,
             pv.id AS video_id, pv.title AS video_title, pv.video_url, pv.thumbnail_url,
             cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar
      FROM challenge_winners w
      JOIN profile_videos pv ON pv.id = w.video_id
      LEFT JOIN creator_profiles cp ON cp.id = w.profile_id
      WHERE w.challenge_id = ${ch.id}
      ORDER BY w.place ASC
    `);
    res.json({
      challenge: {
        slug: ch.slug, title: ch.title, hashtag: ch.hashtag, cover_url: ch.coverUrl,
        status: effectiveStatus(ch),
      },
      announced: rows.rows.length > 0,
      winners: (rows.rows as Record<string, unknown>[]).map((r) => ({
        place: Number(r["place"]),
        prize_credits: Number(r["prize_credits"] ?? 0),
        announced_at: r["announced_at"],
        video: {
          id: r["video_id"], title: r["video_title"],
          video_url: r["video_url"], thumbnail_url: r["thumbnail_url"],
        },
        creator: {
          slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"],
        },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "challenge winners error");
    res.status(500).json({ error: "Couldn't load the winners." });
  }
});

/* ── GET /challenges/hall-of-fame — all-time winners, newest first ───────── */
router.get("/challenges/hall-of-fame", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 1), 100);
    const rows = await db.execute(sql`
      SELECT w.place, w.prize_credits, w.announced_at,
             c.slug AS challenge_slug, c.title AS challenge_title, c.hashtag AS challenge_hashtag,
             pv.id AS video_id, pv.title AS video_title, pv.thumbnail_url,
             cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar
      FROM challenge_winners w
      JOIN challenges c ON c.id = w.challenge_id
      JOIN profile_videos pv ON pv.id = w.video_id
      LEFT JOIN creator_profiles cp ON cp.id = w.profile_id
      ORDER BY w.announced_at DESC
      LIMIT ${limit}
    `);
    res.json({
      winners: (rows.rows as Record<string, unknown>[]).map((r) => ({
        place: Number(r["place"]),
        prize_credits: Number(r["prize_credits"] ?? 0),
        announced_at: r["announced_at"],
        challenge: {
          slug: r["challenge_slug"], title: r["challenge_title"], hashtag: r["challenge_hashtag"],
        },
        video: { id: r["video_id"], title: r["video_title"], thumbnail_url: r["thumbnail_url"] },
        creator: {
          slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"],
        },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "hall of fame error");
    res.status(500).json({ error: "Couldn't load the hall of fame." });
  }
});

/* ── GET /challenges/wins/:slug — a creator's challenge wins (badges) ────── */
router.get("/challenges/wins/:slug", async (req, res) => {
  try {
    const slug = String(req.params["slug"]);
    const [prof] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, slug))
      .limit(1);
    if (!prof) {
      res.status(404).json({ error: "No creator by that name." });
      return;
    }
    const rows = await db.execute(sql`
      SELECT w.place, w.prize_credits, w.announced_at,
             c.slug AS challenge_slug, c.title AS challenge_title
      FROM challenge_winners w
      JOIN challenges c ON c.id = w.challenge_id
      WHERE w.profile_id = ${prof.id}
      ORDER BY w.announced_at DESC
    `);
    const wins = (rows.rows as Record<string, unknown>[]).map((r) => ({
      place: Number(r["place"]),
      prize_credits: Number(r["prize_credits"] ?? 0),
      announced_at: r["announced_at"],
      challenge_slug: r["challenge_slug"],
      challenge_title: r["challenge_title"],
    }));
    res.json({
      profile_slug: slug,
      win_count: wins.length,
      total_prize_credits: wins.reduce((s, w) => s + w.prize_credits, 0),
      wins,
    });
  } catch (err) {
    req.log.error({ err }, "creator wins error");
    res.status(500).json({ error: "Couldn't load those wins." });
  }
});

/* ── GET /challenges/live-now — upcoming + live challenges for CTAs ──────── */
router.get("/challenges/live-now", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "12"), 10) || 12, 1), 30);
    const rows = await db
      .select({
        id: challengesTable.id, slug: challengesTable.slug, title: challengesTable.title,
        hashtag: challengesTable.hashtag, coverUrl: challengesTable.coverUrl,
        status: challengesTable.status, startsAt: challengesTable.startsAt,
        endsAt: challengesTable.endsAt, entryCount: challengesTable.entryCount,
        prizePoolCredits: challengesTable.prizePoolCredits,
      })
      .from(challengesTable)
      .where(sql`${challengesTable.status} IN ('upcoming', 'live')`)
      .orderBy(challengesTable.endsAt)
      .limit(limit * 2);
    const shaped = rows
      .map((r) => ({ ...r, effective: effectiveStatus(r) }))
      .filter((r) => r.effective === "upcoming" || r.effective === "live")
      .sort((a, b) => (a.effective === b.effective ? 0 : a.effective === "live" ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({
        slug: r.slug, title: r.title, hashtag: r.hashtag, cover_url: r.coverUrl,
        status: r.effective, starts_at: r.startsAt, ends_at: r.endsAt,
        entry_count: r.entryCount, prize_pool_credits: r.prizePoolCredits,
      }));
    res.json({ challenges: shaped });
  } catch (err) {
    req.log.error({ err }, "live challenges error");
    res.status(500).json({ error: "Couldn't load live challenges." });
  }
});

/* ── Admin: configure the prize pool ──────────────────────────────────────
   Replaces the whole pool (idempotent). Locked once winners are announced.
   Visual Bucs x100: every prize must be a multiple of 100. */
const prizeSchema = z.object({
  prizes: z
    .array(
      z.object({
        place: z.number().int().min(1).max(10),
        prize_credits: z.number().int().min(100).max(10_000_000),
        description: z.string().trim().max(200).optional().default(""),
      }),
    )
    .min(1)
    .max(10)
    .refine((ps) => new Set(ps.map((p) => p.place)).size === ps.length, {
      message: "Each place can only appear once.",
    })
    .refine((ps) => ps.every((p) => p.prize_credits % 100 === 0), {
      message: "Prizes are Visual Bucs (x100) — multiples of 100 only.",
    }),
});

router.post("/admin/challenges/:slug/prizes", requireAuth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const ch = await getChallenge(String(req.params["slug"]));
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name." });
      return;
    }
    const parsed = prizeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Bad prize pool.", details: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const [announced] = await db
      .select({ id: challengeWinnersTable.id })
      .from(challengeWinnersTable)
      .where(eq(challengeWinnersTable.challengeId, ch.id))
      .limit(1);
    if (announced) {
      res.status(409).json({ error: "Winners are already announced — the pool is locked. Pay the crown what it's owed. 🦈" });
      return;
    }
    const prizes = [...parsed.data.prizes].sort((a, b) => a.place - b.place);
    const total = prizes.reduce((s, p) => s + p.prize_credits, 0);
    await db.transaction(async (tx) => {
      await tx.delete(challengePrizesTable).where(eq(challengePrizesTable.challengeId, ch.id));
      await tx.insert(challengePrizesTable).values(
        prizes.map((p) => ({
          challengeId: ch.id,
          place: p.place,
          prizeCredits: p.prize_credits,
          description: p.description ?? "",
        })),
      );
      await tx
        .update(challengesTable)
        .set({ prizePoolCredits: total })
        .where(eq(challengesTable.id, ch.id));
    });
    req.log.info({ admin: req.userEmail, slug: ch.slug, total }, "admin: challenge prize pool set");
    res.json({ ok: true, total_credits: total, prizes: prizes.map((p) => ({ ...p })) });
  } catch (err) {
    req.log.error({ err }, "admin prize pool error");
    res.status(500).json({ error: "Couldn't save the prize pool." });
  }
});

/* ── Admin: lifecycle transitions ─────────────────────────────────────────
   upcoming → live → judging → winners. Dates auto-advance the state, so
   this is for scheduling and manual overrides. 'winners' can only be set
   via /judge — that's what pays the prizes. */
const lifecycleSchema = z.object({
  status: z.enum(LIFECYCLES).optional(),
  starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  judging_ends_at: z.string().datetime({ offset: true }).nullable().optional(),
});

router.post("/admin/challenges/:slug/lifecycle", requireAuth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const ch = await getChallenge(String(req.params["slug"]));
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name." });
      return;
    }
    const parsed = lifecycleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Bad lifecycle payload.", details: parsed.error.issues.map((i) => i.message) });
      return;
    }
    if (ch.status === "winners") {
      res.status(409).json({ error: "Winners are announced — history doesn't rewind. 🦈" });
      return;
    }
    if (parsed.data.status === "winners") {
      res.status(400).json({ error: "Use /judge to crown winners — that's what pays the prizes." });
      return;
    }
    const startsAt = parsed.data.starts_at === undefined ? ch.startsAt : parsed.data.starts_at ? new Date(parsed.data.starts_at) : null;
    const endsAt = parsed.data.ends_at === undefined ? ch.endsAt : parsed.data.ends_at ? new Date(parsed.data.ends_at) : null;
    const judgingEndsAt = parsed.data.judging_ends_at === undefined ? ch.judgingEndsAt : parsed.data.judging_ends_at ? new Date(parsed.data.judging_ends_at) : null;
    if (startsAt && endsAt && endsAt <= startsAt) {
      res.status(400).json({ error: "ends_at must be after starts_at." });
      return;
    }
    if (endsAt && judgingEndsAt && judgingEndsAt <= endsAt) {
      res.status(400).json({ error: "judging_ends_at must be after ends_at." });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) patch["status"] = parsed.data.status;
    if (parsed.data.starts_at !== undefined) patch["startsAt"] = startsAt;
    if (parsed.data.ends_at !== undefined) patch["endsAt"] = endsAt;
    if (parsed.data.judging_ends_at !== undefined) patch["judgingEndsAt"] = judgingEndsAt;
    if (Object.keys(patch).length) {
      await db.update(challengesTable).set(patch).where(eq(challengesTable.id, ch.id));
    }
    const [updated] = await db.select().from(challengesTable).where(eq(challengesTable.id, ch.id)).limit(1);
    req.log.info({ admin: req.userEmail, slug: ch.slug, patch }, "admin: challenge lifecycle updated");
    res.json({
      ok: true,
      status: updated!.status,
      effective_status: effectiveStatus(updated!),
      starts_at: updated!.startsAt,
      ends_at: updated!.endsAt,
      judging_ends_at: updated!.judgingEndsAt,
    });
  } catch (err) {
    req.log.error({ err }, "admin lifecycle error");
    res.status(500).json({ error: "Couldn't update the lifecycle." });
  }
});

/* ── Admin: judge — crown winners, auto-pay prizes, notify entrants ───────
   Ranking defaults to community votes (tiebreak: views). Idempotent:
   - winner rows: UNIQUE(challenge_id, place) + ON CONFLICT DO NOTHING.
   - payouts: each row is claimed with UPDATE ... WHERE paid_at IS NULL,
     so concurrent judges can never double-pay.
   - re-running after announcement only retries unpaid prizes. */
const judgeSchema = z.object({
  places: z.number().int().min(1).max(10).optional().default(3),
  winners: z
    .array(z.object({ place: z.number().int().min(1).max(10), video_id: z.string().uuid() }))
    .max(10)
    .optional(),
});

router.post("/admin/challenges/:slug/judge", requireAuth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const ch = await getChallenge(String(req.params["slug"]));
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name." });
      return;
    }
    const parsed = judgeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Bad judge payload.", details: parsed.error.issues.map((i) => i.message) });
      return;
    }

    // Resolve the ranking: explicit list, or community votes (tiebreak views).
    let ranking: Array<{ place: number; videoId: string }>;
    if (parsed.data.winners) {
      const places = parsed.data.winners.map((w) => w.place);
      if (new Set(places).size !== places.length) {
        res.status(400).json({ error: "Each place can only appear once." });
        return;
      }
      const entryIds = new Set(
        (await db.select({ videoId: challengeEntriesTable.videoId })
          .from(challengeEntriesTable)
          .where(eq(challengeEntriesTable.challengeId, ch.id))).map((r) => r.videoId),
      );
      for (const w of parsed.data.winners) {
        if (!entryIds.has(w.video_id)) {
          res.status(400).json({ error: `Video ${w.video_id} isn't an entry of this challenge.` });
          return;
        }
      }
      ranking = parsed.data.winners.map((w) => ({ place: w.place, videoId: w.video_id }));
    } else {
      const top = await db
        .select({
          videoId: challengeEntriesTable.videoId,
          votes: challengeEntriesTable.voteCount,
          views: profileVideosTable.viewCount,
        })
        .from(challengeEntriesTable)
        .innerJoin(profileVideosTable, eq(profileVideosTable.id, challengeEntriesTable.videoId))
        .where(eq(challengeEntriesTable.challengeId, ch.id))
        .orderBy(desc(challengeEntriesTable.voteCount), desc(profileVideosTable.viewCount))
        .limit(parsed.data.places!);
      if (!top.length) {
        res.status(409).json({ error: "No entries to judge yet." });
        return;
      }
      ranking = top.map((r, i) => ({ place: i + 1, videoId: r.videoId }));
    }

    // Prize lookup per place.
    const prizes = await db
      .select()
      .from(challengePrizesTable)
      .where(eq(challengePrizesTable.challengeId, ch.id));
    const prizeByPlace = new Map(prizes.map((p) => [p.place, p.prizeCredits]));

    // Profile + owner user for each winning video.
    const videoIds = ranking.map((r) => r.videoId);
    const vids = await db.execute(sql`
      SELECT pv.id AS video_id, pv.profile_id, cp.user_id AS owner_user_id
      FROM profile_videos pv
      LEFT JOIN creator_profiles cp ON cp.id = pv.profile_id
      WHERE pv.id = ANY(${videoIds}::uuid[])
    `);
    const ownerByVideo = new Map(
      (vids.rows as Record<string, unknown>[]).map((r) => [
        String(r["video_id"]),
        { profileId: (r["profile_id"] as string) ?? null, userId: (r["owner_user_id"] as string) ?? null },
      ]),
    );

    // Insert winners (idempotent) + flip the challenge to winners.
    await db.transaction(async (tx) => {
      for (const r of ranking) {
        const owner = ownerByVideo.get(r.videoId);
        await tx
          .insert(challengeWinnersTable)
          .values({
            challengeId: ch.id,
            place: r.place,
            videoId: r.videoId,
            profileId: owner?.profileId ?? null,
            userId: owner?.userId ?? null,
            prizeCredits: prizeByPlace.get(r.place) ?? 0,
          })
          .onConflictDoNothing();
      }
      await tx.update(challengesTable).set({ status: "winners" }).where(eq(challengesTable.id, ch.id));
    });

    // Payout pass: claim each unpaid row, then grant. Never double-pays.
    const unpaid = await db
      .select()
      .from(challengeWinnersTable)
      .where(and(eq(challengeWinnersTable.challengeId, ch.id), sql`${challengeWinnersTable.paidAt} IS NULL`));
    let paid = 0;
    let alreadyPaid = 0;
    const payoutErrors: string[] = [];
    for (const w of unpaid) {
      const claimed = await db.execute(sql`
        UPDATE challenge_winners SET paid_at = now()
        WHERE id = ${w.id} AND paid_at IS NULL
        RETURNING id
      `);
      if (!claimed.rows.length) {
        alreadyPaid++;
        continue; // another judge claimed it concurrently
      }
      if (!w.userId || w.prizeCredits <= 0) continue; // no prize configured for this place
      try {
        await grantVisualBucs(req, w.userId, w.prizeCredits, `Challenge prize — ${ch.title} (${ordinal(w.place)} place)`);
        paid++;
      } catch (e) {
        // Roll the claim back so a retry can pay it.
        await db.execute(sql`UPDATE challenge_winners SET paid_at = NULL WHERE id = ${w.id}`);
        payoutErrors.push(`${ordinal(w.place)}: ${e instanceof Error ? e.message : "payout failed"}`);
        req.log.error({ err: e, winnerId: w.id }, "challenge prize payout failed");
      }
    }

    // Notify every entrant: winners get the crown, everyone else the results.
    const entrants = await db.execute(sql`
      SELECT DISTINCT cp.user_id AS user_id, cp.slug AS creator_slug
      FROM challenge_entries ce
      JOIN profile_videos pv ON pv.id = ce.video_id
      JOIN creator_profiles cp ON cp.id = pv.profile_id
      WHERE ce.challenge_id = ${ch.id} AND cp.user_id IS NOT NULL
    `);
    const winnerUserByPlace = new Map(
      (await db.select().from(challengeWinnersTable).where(eq(challengeWinnersTable.challengeId, ch.id)))
        .filter((w) => w.userId)
        .map((w) => [w.userId!, w]),
    );
    const notes: Array<{ userId: string; kind: string; title: string; body?: string; link?: string }> = [];
    for (const r of entrants.rows as Record<string, unknown>[]) {
      const uid = String(r["user_id"]);
      const win = winnerUserByPlace.get(uid);
      if (win) {
        notes.push({
          userId: uid,
          kind: "challenge_win",
          title: `🏆 You took ${ordinal(win.place)} place in "${ch.title}"!`,
          body: win.prizeCredits > 0
            ? `${win.prizeCredits.toLocaleString("en-US")} Visual Bucs just landed in your balance. Wear the crown.`
            : "The crown is yours. Wear it loud.",
          link: `/challenge/${ch.slug}/winners`,
        });
      } else {
        notes.push({
          userId: uid,
          kind: "challenge_results",
          title: `Winners just dropped for "${ch.title}" 🏆`,
          body: "See who took the crown — then run it back in the next one.",
          link: `/challenge/${ch.slug}/winners`,
        });
      }
    }
    await notifyMany(notes);

    req.log.info(
      { admin: req.userEmail, slug: ch.slug, paid, alreadyPaid, errors: payoutErrors.length },
      "admin: challenge judged",
    );
    const finalWinners = await db
      .select()
      .from(challengeWinnersTable)
      .where(eq(challengeWinnersTable.challengeId, ch.id))
      .orderBy(challengeWinnersTable.place);
    res.json({
      ok: true,
      status: "winners",
      paid,
      already_paid: alreadyPaid,
      payout_errors: payoutErrors,
      notified: notes.length,
      winners: finalWinners.map((w) => ({
        place: w.place,
        video_id: w.videoId,
        prize_credits: w.prizeCredits,
        paid_at: w.paidAt,
        announced_at: w.announcedAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "challenge judge error");
    res.status(500).json({ error: "Judging failed. The crown waits." });
  }
});

export default router;
