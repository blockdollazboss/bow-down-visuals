/**
 * cheat-code.ts — Cheat Code Jackpot promotional event.
 *
 * One secret directional-pad sequence per 6-month cycle. The first signed-in
 * player to enter it wins prize_credits (100). One winner per cycle — an
 * atomic conditional UPDATE is the claim, so races can't double-award.
 *
 * Security contract:
 *  - The secret sequence is NEVER stored in plaintext (the repo is public);
 *    only a SHA-256 hash of the canonical encoding is persisted.
 *  - The public status endpoint never exposes the hash or the code — only
 *    the code LENGTH (a game hint) plus dates/prize/winner info.
 *  - Attempts are rate-limited per user and per IP.
 *
 * Queries use raw SQL via db.execute(sql``) rather than the drizzle query
 * builder: the builder emits `rowMode: "array"`, which pg-mem (the $0 test
 * DB) does not support.
 *
 *  GET    /api/cheat-code/status                 public event status
 *  POST   /api/cheat-code/attempt                { sequence: [...] } (auth)
 *  GET    /api/cheat-code/admin/events           list cycles (admin)
 *  POST   /api/cheat-code/admin/events           create a cycle (admin)
 *  POST   /api/cheat-code/admin/events/:id/activate    (admin)
 *  POST   /api/cheat-code/admin/events/:id/deactivate  (admin)
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  db,
  CHEAT_CODE_DIRECTIONS,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { addCreditsToProfile, getSupabaseAdmin } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";

const router = Router();

/* ------------------------------------------------------------------ */
/* Code hashing                                                        */
/* ------------------------------------------------------------------ */

/** Domain separator so this hash can't be confused with any other. */
const HASH_DOMAIN = "bowdown-cheatcode-v1:";

/**
 * Canonical encoding of a direction sequence, then SHA-256 hex.
 * The optional CHEAT_CODE_PEPPER env var hardens the stored hash.
 */
export function hashCodeSequence(sequence: readonly string[]): string {
  const pepper = process.env["CHEAT_CODE_PEPPER"] ?? "";
  const canonical = `${HASH_DOMAIN}${pepper}${JSON.stringify([...sequence])}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function sequencesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const DirectionSchema = z.enum(CHEAT_CODE_DIRECTIONS);
const SequenceSchema = z
  .array(DirectionSchema)
  .min(4, "Sequence must be at least 4 moves.")
  .max(10, "Sequence must be at most 10 moves.");

/* ------------------------------------------------------------------ */
/* Row shapes                                                          */
/* ------------------------------------------------------------------ */

/** Raw row from cheat_code_events (snake_case, as Postgres returns it). */
interface CheatCodeEventRow {
  id: string;
  name: string;
  code_hash: string;
  code_length: number;
  prize_credits: number;
  starts_at: string | Date;
  ends_at: string | Date;
  is_active: boolean;
  winner_user_id: string | null;
  winner_display_name: string | null;
  claimed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

/* Timestamp columns arrive as Date objects from pg-mem and as ISO strings
   from node-postgres (drizzle's type parser returns the raw string). */
function toISO(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(String(v));
}

const EVENT_COLUMNS = sql`id, name, code_hash, code_length, prize_credits, starts_at, ends_at, is_active, winner_user_id, winner_display_name, claimed_at, created_at, updated_at`;

async function getEventById(id: string): Promise<CheatCodeEventRow | null> {
  const result = await db.execute(sql`
    SELECT ${EVENT_COLUMNS} FROM cheat_code_events WHERE id = ${id} LIMIT 1
  `);
  const rows = result.rows as unknown as CheatCodeEventRow[];
  return rows[0] ?? null;
}

type JackpotPhase = "live" | "claimed" | "upcoming" | "ended" | "none";

/** True when the event is active and inside its [starts_at, ends_at) window. */
function isLiveWindow(event: CheatCodeEventRow, now: Date = new Date()): boolean {
  return (
    event.is_active &&
    toDate(event.starts_at).getTime() <= now.getTime() &&
    toDate(event.ends_at).getTime() > now.getTime()
  );
}

/**
 * The single event the public status should spotlight:
 *  1. a live event (active + within its window), else
 *  2. a scheduled/upcoming active event, else
 *  3. the most recently finished event (for the winner spotlight), else
 *  4. null.
 */
async function getSpotlightEvent(): Promise<{
  event: CheatCodeEventRow | null;
  phase: JackpotPhase;
}> {
  const now = new Date();

  const liveRes = await db.execute(sql`
    SELECT ${EVENT_COLUMNS} FROM cheat_code_events
    WHERE is_active = true AND starts_at <= ${now} AND ends_at > ${now}
    ORDER BY starts_at DESC LIMIT 1
  `);
  const live = (liveRes.rows as unknown as CheatCodeEventRow[])[0];
  if (live) {
    return { event: live, phase: live.winner_user_id ? "claimed" : "live" };
  }

  const upcomingRes = await db.execute(sql`
    SELECT ${EVENT_COLUMNS} FROM cheat_code_events
    WHERE is_active = true AND starts_at > ${now}
    ORDER BY starts_at ASC LIMIT 1
  `);
  const upcoming = (upcomingRes.rows as unknown as CheatCodeEventRow[])[0];
  if (upcoming) return { event: upcoming, phase: "upcoming" };

  const recentRes = await db.execute(sql`
    SELECT ${EVENT_COLUMNS} FROM cheat_code_events
    ORDER BY ends_at DESC LIMIT 1
  `);
  const recent = (recentRes.rows as unknown as CheatCodeEventRow[])[0];
  if (recent) {
    return { event: recent, phase: recent.winner_user_id ? "claimed" : "ended" };
  }

  return { event: null, phase: "none" };
}

/** Public shape — code_hash is deliberately never included. */
function publicEvent(event: CheatCodeEventRow, phase: JackpotPhase) {
  return {
    phase,
    name: event.name,
    prizeCredits: event.prize_credits,
    codeLength: event.code_length,
    startsAt: toISO(event.starts_at),
    endsAt: toISO(event.ends_at),
    /* The next code drops when this cycle ends — same instant as endsAt. */
    resetsAt: toISO(event.ends_at),
    winnerDisplayName: event.winner_display_name,
    claimedAt: toISO(event.claimed_at),
  };
}

/* ------------------------------------------------------------------ */
/* GET /api/cheat-code/status — public                                  */
/* ------------------------------------------------------------------ */

router.get("/cheat-code/status", async (req: Request, res: Response) => {
  try {
    const { event, phase } = await getSpotlightEvent();
    if (!event) {
      res.json({ phase: "none" satisfies JackpotPhase });
      return;
    }
    res.json(publicEvent(event, phase));
  } catch (err) {
    req.log?.error?.({ err }, "cheat-code/status error");
    res.status(500).json({ error: "Could not load jackpot status." });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/cheat-code/attempt — auth, rate-limited                    */
/* ------------------------------------------------------------------ */

/* Game rules: 3 tries per player per day, spread out — a cooldown between
   tries keeps them from being burned back-to-back. */
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TRIES_PER_DAY = 3;
const TRY_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP_PER_DAY = 60;

const AttemptSchema = z.object({ sequence: SequenceSchema });

interface AttemptStats {
  count: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

/** Tries by this player on this event in the last 24h, with first/last times. */
async function getUserAttemptStats(
  userId: string,
  eventId: string,
): Promise<AttemptStats> {
  const dayAgo = new Date(Date.now() - DAY_MS);
  const result = await db.execute(sql`
    SELECT COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
    FROM cheat_code_attempts
    WHERE user_id = ${userId} AND event_id = ${eventId} AND created_at > ${dayAgo}
  `);
  const row = (result.rows as unknown as { n: string | number; first_at: string | Date | null; last_at: string | Date | null }[])[0];
  const toD = (v: string | Date | null | undefined): Date | null => {
    if (v == null) return null;
    return v instanceof Date ? v : new Date(String(v));
  };
  return { count: Number(row?.n ?? 0), firstAt: toD(row?.first_at), lastAt: toD(row?.last_at) };
}

function retryAfterSeconds(target: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - Date.now()) / 1000));
}

async function resolveDisplayName(
  userId: string,
  email: string | undefined,
): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    const name = (data as { display_name?: string } | null)?.display_name?.trim();
    if (name) return name;
  } catch {
    /* fall through to email fallback */
  }
  if (email) {
    const local = email.split("@")[0]?.trim();
    if (local) return local;
  }
  return "Anonymous Shark";
}

router.post(
  "/cheat-code/attempt",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = AttemptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Invalid sequence. Send 4–10 moves, each one of: up, down, left, right.",
      });
      return;
    }
    const userId = req.userId!;
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() || req.ip;

    try {
      const { event } = await getSpotlightEvent();
      /* A claimed-but-still-live event reports "already claimed"; anything
         outside the live window is a 404. */
      if (!event || !isLiveWindow(event)) {
        res.status(404).json({ error: "No live cheat code event right now." });
        return;
      }

      if (event.winner_user_id) {
        res.json({
          correct: false,
          claimed: true,
          winnerDisplayName: event.winner_display_name,
          message: "Someone already cracked it — better luck next season.",
        });
        return;
      }

      /* 3 tries per day, spread out: a cooldown between tries keeps them
         from being burned back-to-back. */
      const stats = await getUserAttemptStats(userId, event.id);
      const triesLeft = Math.max(0, MAX_TRIES_PER_DAY - stats.count);
      if (stats.count >= MAX_TRIES_PER_DAY && stats.firstAt) {
        res.status(429).json({
          error:
            "That's your 3 tries for today — come back tomorrow for 3 more.",
          retryAfterSeconds: retryAfterSeconds(
            new Date(stats.firstAt.getTime() + DAY_MS),
          ),
          triesLeft: 0,
        });
        return;
      }
      if (stats.lastAt && Date.now() - stats.lastAt.getTime() < TRY_COOLDOWN_MS) {
        res.status(429).json({
          error:
            "Not so fast — give it a rest before your next try.",
          retryAfterSeconds: retryAfterSeconds(
            new Date(stats.lastAt.getTime() + TRY_COOLDOWN_MS),
          ),
          triesLeft,
        });
        return;
      }

      /* Loose per-IP guard against distributed guessing. */
      if (ip) {
        const dayAgo = new Date(Date.now() - DAY_MS);
        const ipRes = await db.execute(sql`
          SELECT COUNT(*) AS n FROM cheat_code_attempts
          WHERE ip = ${ip} AND created_at > ${dayAgo}
        `);
        const ipCount = Number(
          (ipRes.rows as unknown as { n: string | number }[])[0]?.n ?? 0,
        );
        if (ipCount >= MAX_ATTEMPTS_PER_IP_PER_DAY) {
          res.status(429).json({
            error:
              "Too many attempts from this network today. Try again tomorrow.",
            triesLeft: 0,
          });
          return;
        }
      }

      const attemptHash = hashCodeSequence(parsed.data.sequence);
      const codeMatched = sequencesEqual(attemptHash, event.code_hash);

      const logAttempt = (won: boolean) =>
        db.execute(sql`
          INSERT INTO cheat_code_attempts (id, event_id, user_id, ip, success)
          VALUES (${randomUUID()}, ${event.id}, ${userId}, ${ip ?? null}, ${won})
        `);

      if (!codeMatched) {
        await logAttempt(false);
        res.json({
          correct: false,
          claimed: false,
          triesLeft: Math.max(0, triesLeft - 1),
        });
        return;
      }

      /* Atomic claim: exactly one UPDATE can win. The WHERE clause is the
         lock — concurrent correct attempts all race here, only one row
         matches (winner_user_id IS NULL flips on the first).
         `success` is logged only after the claim resolves, so it means
         "actually won the jackpot", not merely "entered the right code". */
      const winnerDisplayName = await resolveDisplayName(userId, req.userEmail);
      const now = new Date();
      const claimRes = await db.execute(sql`
        UPDATE cheat_code_events
        SET winner_user_id = ${userId},
            winner_display_name = ${winnerDisplayName},
            claimed_at = ${now},
            updated_at = ${now}
        WHERE id = ${event.id}
          AND winner_user_id IS NULL
          AND is_active = true
          AND ends_at > ${now}
        RETURNING id
      `);
      const claimedRows = claimRes.rows as unknown as { id: string }[];
      const won = claimedRows.length > 0;
      await logAttempt(won);

      if (!won) {
        /* Lost the race (or the event ended mid-flight). */
        const refreshed = await getSpotlightEvent();
        res.json({
          correct: false,
          claimed: true,
          winnerDisplayName:
            refreshed.event?.winner_display_name ?? event.winner_display_name,
          message: "So close — someone else claimed it first.",
        });
        return;
      }

      /* Winner! Grant the prize. If anything in the grant fails, reverse
         the credit delta (best-effort) and roll the claim back so the
         jackpot stays winnable and no free credits leak. */
      const prize = event.prize_credits;
      let creditsGranted = false;
      try {
        const { newCredits: newBalance } = await addCreditsToProfile(userId, prize);
        creditsGranted = true;

        await recordCreditUsageStrict({
          userId,
          action: "Cheat Code Jackpot",
          creditsUsed: -prize,
        });

        req.log?.info?.(
          { userId, eventId: event.id, prize, newBalance },
          "cheat-code: jackpot claimed",
        );
        res.json({
          correct: true,
          claimed: true,
          prizeCredits: prize,
          winnerDisplayName,
          newBalance,
        });
      } catch (grantErr) {
        req.log?.error?.(
          { err: grantErr, userId, eventId: event.id },
          "cheat-code: prize grant failed — reversing",
        );
        if (creditsGranted) {
          /* Reverse the delta (not a set-to-old-balance) so any concurrent
             legitimate spending by the player is preserved. */
          try {
            await addCreditsToProfile(userId, -prize);
          } catch (revertErr) {
            req.log?.error?.(
              { err: revertErr, userId, prize },
              "cheat-code: credit revert failed — manual reconciliation needed",
            );
          }
        }
        await db.execute(sql`
          UPDATE cheat_code_events
          SET winner_user_id = NULL,
              winner_display_name = NULL,
              claimed_at = NULL,
              updated_at = ${new Date()}
          WHERE id = ${event.id} AND winner_user_id = ${userId}
        `);
        res.status(500).json({
          error:
            "The code was right but the prize couldn't be granted. Try again.",
        });
      }
    } catch (err) {
      req.log?.error?.({ err }, "cheat-code/attempt error");
      res.status(500).json({ error: "Could not check the code. Try again." });
    }
  },
);

/* ------------------------------------------------------------------ */
/* Admin — manage cycles                                               */
/* ------------------------------------------------------------------ */

const CreateEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  codeSequence: SequenceSchema,
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime(),
  prizeCredits: z.number().int().min(1).max(10000).default(100),
});

/** Admin shape — code_hash is never serialized. */
function adminEventShape(event: CheatCodeEventRow) {
  return {
    id: event.id,
    name: event.name,
    codeLength: event.code_length,
    prizeCredits: event.prize_credits,
    startsAt: toISO(event.starts_at),
    endsAt: toISO(event.ends_at),
    isActive: event.is_active,
    winnerUserId: event.winner_user_id,
    winnerDisplayName: event.winner_display_name,
    claimedAt: toISO(event.claimed_at),
    createdAt: toISO(event.created_at),
    updatedAt: toISO(event.updated_at),
  };
}

router.get(
  "/cheat-code/admin/events",
  requireAuth,
  requireAdmin,
  async (_req: Request, res: Response) => {
    try {
      const result = await db.execute(sql`
        SELECT ${EVENT_COLUMNS} FROM cheat_code_events ORDER BY starts_at DESC
      `);
      const rows = result.rows as unknown as CheatCodeEventRow[];
      res.json({ events: rows.map(adminEventShape) });
    } catch (err) {
      res.status(500).json({ error: "Could not list jackpot events." });
    }
  },
);

router.post(
  "/cheat-code/admin/events",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = CreateEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid event. Check name, code, and dates." });
      return;
    }
    const { name, codeSequence, prizeCredits } = parsed.data;
    const startsAt = parsed.data.startsAt
      ? new Date(parsed.data.startsAt)
      : new Date();
    const endsAt = new Date(parsed.data.endsAt);
    if (!(endsAt.getTime() > startsAt.getTime())) {
      res.status(400).json({ error: "endsAt must be after startsAt." });
      return;
    }

    try {
      const result = await db.execute(sql`
        INSERT INTO cheat_code_events
          (id, name, code_hash, code_length, prize_credits, starts_at, ends_at, is_active)
        VALUES
          (${randomUUID()}, ${name}, ${hashCodeSequence(codeSequence)}, ${codeSequence.length}, ${prizeCredits}, ${startsAt}, ${endsAt}, false)
        RETURNING ${EVENT_COLUMNS}
      `);
      const rows = result.rows as unknown as CheatCodeEventRow[];
      res.status(201).json({ event: adminEventShape(rows[0]) });
    } catch (err: unknown) {
      if (err instanceof Error && /duplicate key|unique/i.test(err.message)) {
        res
          .status(409)
          .json({ error: "An event with that name already exists." });
        return;
      }
      res.status(500).json({ error: "Could not create jackpot event." });
    }
  },
);

router.post(
  "/cheat-code/admin/events/:id/activate",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const event = await getEventById(req.params["id"] as string);
      if (!event) {
        res.status(404).json({ error: "Event not found." });
        return;
      }
      if (toDate(event.ends_at).getTime() <= Date.now()) {
        res.status(400).json({ error: "That event already ended." });
        return;
      }
      const now = new Date();
      /* One live event at a time. A single UPDATE keeps the invariant under
         concurrency: concurrent activations serialize on the row locks and
         the last writer wins, so two cycles can never both be active. */
      await db.execute(sql`
        UPDATE cheat_code_events
        SET is_active = (id = ${event.id}), updated_at = ${now}
        WHERE is_active = true OR id = ${event.id}
      `);
      const updated = await getEventById(event.id);
      res.json({ event: updated ? adminEventShape(updated) : null });
    } catch (err) {
      res.status(500).json({ error: "Could not activate event." });
    }
  },
);

router.post(
  "/cheat-code/admin/events/:id/deactivate",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const result = await db.execute(sql`
        UPDATE cheat_code_events
        SET is_active = false, updated_at = ${new Date()}
        WHERE id = ${req.params["id"] as string}
        RETURNING ${EVENT_COLUMNS}
      `);
      const rows = result.rows as unknown as CheatCodeEventRow[];
      if (!rows[0]) {
        res.status(404).json({ error: "Event not found." });
        return;
      }
      res.json({ event: adminEventShape(rows[0]) });
    } catch (err) {
      res.status(500).json({ error: "Could not deactivate event." });
    }
  },
);

export default router;
