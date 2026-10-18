/**
 * world-king-moment.ts — The King's daily moment (Ring 3, THE-GAME
 * §5 Q2 + §5(b); migration 0147, tables king_moments +
 * king_moment_claims).
 *
 * Once a day the King holds court: at the palace day-turn (00:00
 * UTC — the same boundary the site's daily claim flips on, so the
 * moment opens the palace's day) the hall is heralded through the
 * announce channel (Phase 1), the week's risers and tonight's
 * slate are named, and for one hour the members standing in the
 * Throne Hall may claim a small audience gift.
 *
 * THE MONEY RULE (owner-approved, THE-GAME §5 Q4 — read it before
 * touching a number): the gift is NOT new issuance. It pays out of
 * the existing weekly quest pool — the ≤300 VB/week envelope the
 * four weekly quests draw from (QUEST_DEFS in lib/retention: 40 +
 * 80 + 120 + 60 = 300, owner-approved 2026-10-09). The claimer
 * enforces, per member per week:
 *
 *     quest rewards claimed + King gifts claimed + gift ≤ 300
 *
 * A member who already earned the whole pool from quests is told
 * the pool is spent (reason "pool") — the moment still happens,
 * the court still gathers; the gift simply has nothing left to
 * draw from. The gift's size (KING_MOMENT_REWARD_VB) is the one
 * number no source named; 25 VB is deliberately small against the
 * 300 pool — a daily audience gift, never a second quest system.
 *
 * IDEMPOTENCY is structural, twice over: the firing is a primary-
 * key insert on the UTC date (king_moments.moment_date) — a
 * restart or a twin tick reads the row and repairs the room's
 * claim window instead of firing twice; the claim is a unique
 * (user, date) insert — a double claim conflicts, never double-
 * pays. The room serializes claims per member on top (its
 * reservation set, the drop pattern).
 *
 * Everything DB-shaped sits behind KingMomentStore so the
 * scheduler and the claimer are unit-tested against fakes; the
 * route layer wires the db store + the palace.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  kingMomentsTable,
  kingMomentClaimsTable,
  questProgressTable,
  creatorProfilesTable,
  worldEventsTable,
  type KingMoment as KingMomentRow,
} from "@workspace/db";
import { QUEST_DEFS } from "./retention";
import { PALACE_ROOM_DEFS, type WorldPalace } from "./world-palace";
import { WORLD_ROOM_ID, type WorldKingMomentClaimer } from "./world-room";
import { addCreditsAtomic } from "./supabase-admin";
import { logger } from "./logger";

/** The audience gift, in VB — drawn from the weekly quest pool
 *  (see the money rule above), never issued on top of it. */
export const KING_MOMENT_REWARD_VB = 25;

/** The weekly quest pool's ceiling (QUEST_DEFS sum; the moment's
 *  gifts and the quests share this one envelope per member). */
export const WEEKLY_QUEST_POOL_VB = 300;

/** How long after the firing the hall's claim window stands. */
export const KING_MOMENT_CLAIM_WINDOW_MS = 60 * 60_000;

/** The scheduler's tick. The moment is a daily appointment; a
 *  30 s tick keeps the firing on the minute without a cron. */
export const KING_MOMENT_TICK_MS = 30_000;

/** Risers named in the herald — the top of the week's board. */
export const KING_MOMENT_RISERS_NAMED = 3;

/* ── Dates (the palace day is the UTC day) ──────────────────────── */

/** The palace day a moment belongs to: the UTC date, YYYY-MM-DD —
 *  the same day key the site's daily claim uses. */
export function kingMomentDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week containing `now`, YYYY-MM-DD — the
 *  quest week's key, mirroring lib/retention's currentWeekStart
 *  math against an explicit clock so claims are testable. */
export function kingWeekStart(now: Date): string {
  const dayIdx = (now.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayIdx));
  return monday.toISOString().slice(0, 10);
}

/* ── The announcement (pure) ────────────────────────────────────── */

export interface KingMomentMaterial {
  kingName: string;
  risers: { name: string; score: number }[];
  tonight: { title: string; roomName: string; startsAt: string }[];
}

/**
 * The herald the palace hears when the moment fires. Built only
 * from the material the store read (risers = the weekly creation
 * leaderboard's top, the same score the Kingdom Board shows;
 * tonight = the palace calendar's next bookings). Empty parts are
 * omitted, never padded — a quiet day still gets its moment, just
 * a shorter one.
 */
export function kingAnnouncementText(material: KingMomentMaterial): string {
  const parts: string[] = [
    `The King holds court — ${material.kingName} takes the throne for the daily moment.`,
  ];
  const risers = material.risers.slice(0, KING_MOMENT_RISERS_NAMED);
  if (risers.length > 0) {
    parts.push(`This week's risers: ${risers.map((r) => r.name).join(", ")}.`);
  }
  const tonight = material.tonight[0];
  if (tonight) {
    parts.push(`Tonight at the palace: ${tonight.title} in the ${tonight.roomName}.`);
  }
  parts.push(
    `Stand in the hall within the hour and claim ${KING_MOMENT_REWARD_VB} VB from the week's quest pool.`,
  );
  return parts.join(" ");
}

/* ── The store ──────────────────────────────────────────────────── */

export interface KingMomentStore {
  /** The moment row for a palace day, if it has fired. */
  getMoment(date: string): Promise<KingMomentRow | null>;
  /** Record a firing. Returns false when the day already has its
   *  row (a twin tick fired first) — the caller then stays silent:
   *  one day, one moment, one herald. */
  markFired(row: {
    momentDate: string;
    firedAt: Date;
    claimDeadline: Date;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  /** VB this member has drawn from the week's quest pool through
   *  QUEST claims (claimed rows of the current quest week). */
  questClaimsVb(userId: string, weekStart: string): Promise<number>;
  /** VB this member has drawn from the pool through KING gifts
   *  in the week starting `weekStart` (a YYYY-MM-DD Monday). */
  kingClaimsVb(userId: string, weekStart: string): Promise<number>;
  /** Record a claim. Returns false on the (user, date) unique
   *  conflict — the member already claimed today's gift. */
  insertClaim(userId: string, date: string, amountVb: number): Promise<boolean>;
  /** Roll a claim row back (the grant failed after the insert). */
  deleteClaim(userId: string, date: string): Promise<void>;
  /** Pay the gift — the site's atomic credit grant. */
  grant(userId: string, amountVb: number): Promise<void>;
  /** The material the herald is built from. Each part degrades to
   *  empty on its own failure — the moment fires regardless. */
  momentMaterial(now: Date): Promise<KingMomentMaterial>;
}

const ROOM_NAMES = new Map(PALACE_ROOM_DEFS.map((r) => [r.roomId, r.name]));

export const dbKingMomentStore: KingMomentStore = {
  async getMoment(date) {
    const [row] = await db
      .select()
      .from(kingMomentsTable)
      .where(eq(kingMomentsTable.momentDate, date))
      .limit(1);
    return row ?? null;
  },

  async markFired(row) {
    const inserted = await db
      .insert(kingMomentsTable)
      .values(row)
      .onConflictDoNothing()
      .returning({ momentDate: kingMomentsTable.momentDate });
    return inserted.length > 0;
  },

  async questClaimsVb(userId, weekStart) {
    const rows = await db
      .select({ questKey: questProgressTable.questKey, claimedAt: questProgressTable.claimedAt })
      .from(questProgressTable)
      .where(
        and(eq(questProgressTable.userId, userId), eq(questProgressTable.weekStart, weekStart)),
      );
    let sum = 0;
    for (const r of rows) {
      if (!r.claimedAt) continue;
      sum += QUEST_DEFS.find((d) => d.key === r.questKey)?.reward ?? 0;
    }
    return sum;
  },

  async kingClaimsVb(userId, weekStart) {
    const rows = await db
      .select({ amountVb: kingMomentClaimsTable.amountVb })
      .from(kingMomentClaimsTable)
      .where(
        and(
          eq(kingMomentClaimsTable.userId, userId),
          gte(kingMomentClaimsTable.momentDate, weekStart),
        ),
      );
    return rows.reduce((s, r) => s + r.amountVb, 0);
  },

  async insertClaim(userId, date, amountVb) {
    const inserted = await db
      .insert(kingMomentClaimsTable)
      .values({ userId, momentDate: date, amountVb })
      .onConflictDoNothing()
      .returning({ id: kingMomentClaimsTable.id });
    return inserted.length > 0;
  },

  async deleteClaim(userId, date) {
    await db
      .delete(kingMomentClaimsTable)
      .where(
        and(eq(kingMomentClaimsTable.userId, userId), eq(kingMomentClaimsTable.momentDate, date)),
      );
  },

  async grant(userId, amountVb) {
    await addCreditsAtomic(userId, amountVb);
  },

  async momentMaterial(now) {
    let kingName = "The King";
    try {
      const [king] = await db
        .select({ displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.isOfficial, true))
        .limit(1);
      if (king?.displayName) kingName = king.displayName;
    } catch (err) {
      logger.warn({ err }, "[king-moment] king name read failed — the crown speaks unnamed");
    }

    let risers: KingMomentMaterial["risers"] = [];
    try {
      /* The weekly creation leaderboard's own score (the route's
       * formula in routes/retention: quest progress points, viral
       * shares weighted ×10, + 2 per claimed day) read over named
       * profiles — a riser the palace can't name can't be heralded.
       * The King's own account is the host, never a riser. */
      const res = await db.execute(/* sql */ `
        SELECT qp.user_id AS user_id, cp.display_name AS display_name,
          COALESCE(SUM(CASE WHEN qp.quest_key = 'viral-sharer' THEN qp.progress * 10 ELSE qp.progress END), 0)::int AS generations,
          COUNT(DISTINCT DATE(qp.claimed_at))::int FILTER (WHERE qp.claimed_at IS NOT NULL) AS active_days
        FROM quest_progress qp
        JOIN creator_profiles cp ON cp.user_id = qp.user_id
        WHERE cp.is_official IS NOT TRUE
        GROUP BY qp.user_id, cp.display_name
        ORDER BY (generations + active_days * 2) DESC
        LIMIT 8
      `);
      risers = (res.rows as any[])
        .map((r) => ({
          name: typeof r.display_name === "string" ? r.display_name : "",
          score: Number(r.generations ?? 0) + Number(r.active_days ?? 0) * 2,
        }))
        .filter((r) => r.name && r.score > 0)
        .slice(0, 5);
    } catch (err) {
      logger.warn({ err }, "[king-moment] risers read failed — the moment names none");
    }

    let tonight: KingMomentMaterial["tonight"] = [];
    try {
      const rows = await db
        .select()
        .from(worldEventsTable)
        .where(inArray(worldEventsTable.status, ["scheduled", "live"]));
      tonight = rows
        .filter((r) => new Date(r.endsAt).getTime() > now.getTime())
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        .slice(0, 3)
        .map((r) => ({
          title: r.title,
          roomName: ROOM_NAMES.get(r.roomId) ?? "the palace",
          startsAt: new Date(r.startsAt).toISOString(),
        }));
    } catch (err) {
      logger.warn({ err }, "[king-moment] tonight read failed — the moment names no slate");
    }

    return { kingName, risers, tonight };
  },
};

/* ── The claimer (the room's injected rail) ─────────────────────── */

/**
 * Build the hall's king.claim rail: the whole money rule in one
 * place. Order matters — window, then pool, then the idempotency
 * anchor (the claim row), then the grant; a failed grant rolls the
 * row back so the member may retry inside the window.
 */
export function createKingMomentClaimer(
  store: KingMomentStore = dbKingMomentStore,
): WorldKingMomentClaimer {
  return async (userId, date, nowMs) => {
    try {
      const moment = await store.getMoment(date);
      if (!moment || nowMs > new Date(moment.claimDeadline).getTime()) {
        return { ok: false, reason: "closed" };
      }
      const weekStart = kingWeekStart(new Date(nowMs));
      const [questVb, kingVb] = await Promise.all([
        store.questClaimsVb(userId, weekStart),
        store.kingClaimsVb(userId, weekStart),
      ]);
      if (questVb + kingVb + KING_MOMENT_REWARD_VB > WEEKLY_QUEST_POOL_VB) {
        return { ok: false, reason: "pool" };
      }
      const inserted = await store.insertClaim(userId, date, KING_MOMENT_REWARD_VB);
      if (!inserted) return { ok: false, reason: "already" };
      try {
        await store.grant(userId, KING_MOMENT_REWARD_VB);
      } catch (err) {
        await store.deleteClaim(userId, date).catch(() => undefined);
        logger.error({ err, userId, date }, "[king-moment] grant failed — claim rolled back");
        return { ok: false, reason: "error" };
      }
      return { ok: true, amountVb: KING_MOMENT_REWARD_VB };
    } catch (err) {
      logger.error({ err, userId, date }, "[king-moment] claim failed");
      return { ok: false, reason: "error" };
    }
  };
}

/* ── The scheduler ──────────────────────────────────────────────── */

export interface KingMomentSchedulerDeps {
  palace: WorldPalace;
  store?: KingMomentStore;
}

/**
 * The daily firing. One tick does exactly one of three things:
 * - the day hasn't fired and the palace is awake → fire it: record
 *   the row FIRST (the durable idempotency), herald the palace
 *   through the announce channel, and open the hall's claim window;
 * - the day has fired and its window stands → make sure the hall
 *   carries the window (a restart mid-window repairs the room
 *   state; the row, not the room, is the truth);
 * - the window has closed → sweep the hall's claim state.
 * A twin tick that loses the markFired race stays silent.
 */
export class KingMomentScheduler {
  private store: KingMomentStore;
  private ticking = false;

  constructor(private deps: KingMomentSchedulerDeps) {
    this.store = deps.store ?? dbKingMomentStore;
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date(nowMs);
      const date = kingMomentDate(now);
      const hall = this.deps.palace.room(WORLD_ROOM_ID);
      if (!hall) return;

      const existing = await this.store.getMoment(date);
      if (existing) {
        const deadlineMs = new Date(existing.claimDeadline).getTime();
        if (nowMs <= deadlineMs) {
          if (hall.activeKingMomentDate() !== date) {
            hall.beginKingMoment({ date, claimDeadlineMs: deadlineMs });
          }
        } else if (hall.activeKingMomentDate() === date) {
          hall.endKingMoment(date);
        }
        return;
      }

      const material = await this.store.momentMaterial(now);
      const text = kingAnnouncementText(material);
      const claimDeadline = new Date(nowMs + KING_MOMENT_CLAIM_WINDOW_MS);
      const inserted = await this.store.markFired({
        momentDate: date,
        firedAt: new Date(nowMs),
        claimDeadline,
        payload: { ...material, text },
      });
      if (!inserted) return; // a twin fired it — its herald stands
      this.deps.palace.announce({
        kind: "king",
        text,
        name: material.kingName,
        roomId: WORLD_ROOM_ID,
        roomName: "The King's Hall",
      });
      hall.beginKingMoment({ date, claimDeadlineMs: claimDeadline.getTime() });
    } catch (err) {
      logger.warn({ err }, "[king-moment] tick failed");
    } finally {
      this.ticking = false;
    }
  }
}
