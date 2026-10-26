import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, SITE_LAUNCH_PROMO, SPOTLIGHT_OFFER, LOADING_SCREEN_OFFER } from "@workspace/db";
import {
  buildMicBandPromos,
  type MicBandJackpotSnapshot,
} from "../lib/mic-band-promos";

const router = Router();

/* Contract with the hero HangingMic promo band:
   GET /api/mic-band/promos → 200 { promos: MicBandPromo[] }

   The band rotates standing promotions only, all read live from their
   sources of truth: SITE_LAUNCH_PROMO, SPOTLIGHT_OFFER and
   LOADING_SCREEN_OFFER (the same constants the takeover inquiry
   modals serve) plus the current Cheat Code Jackpot event (the same
   event GET /api/cheat-code/status spotlights). Read-only — this
   endpoint never creates a jackpot event and never exposes the
   event's code hash or sequence (those columns are never selected). */

interface JackpotRow {
  name: string;
  prize_credits: number;
  starts_at: string | Date;
  ends_at: string | Date;
  winner_display_name: string | null;
}

function toISO(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Spotlight selection mirroring cheat-code.ts: live, else upcoming,
    else the most recent claimed event. Null when nothing promotable —
    and null on ANY read failure, so a missing table can never take
    the band (or invent a jackpot). */
async function getJackpotSnapshot(): Promise<MicBandJackpotSnapshot | null> {
  try {
    const now = new Date();
    const cols = sql`name, prize_credits, starts_at, ends_at, winner_display_name`;

    const liveRes = await db.execute(sql`
      SELECT ${cols} FROM cheat_code_events
      WHERE is_active = true AND starts_at <= ${now} AND ends_at > ${now}
      ORDER BY starts_at DESC LIMIT 1
    `);
    const live = (liveRes.rows as unknown as JackpotRow[])[0];
    if (live) {
      return {
        phase: live.winner_display_name ? "claimed" : "live",
        name: live.name,
        prizeCredits: live.prize_credits,
        startsAt: toISO(live.starts_at),
        endsAt: toISO(live.ends_at),
        winnerDisplayName: live.winner_display_name,
      };
    }

    const upcomingRes = await db.execute(sql`
      SELECT ${cols} FROM cheat_code_events
      WHERE is_active = true AND starts_at > ${now}
      ORDER BY starts_at ASC LIMIT 1
    `);
    const upcoming = (upcomingRes.rows as unknown as JackpotRow[])[0];
    if (upcoming) {
      return {
        phase: "upcoming",
        name: upcoming.name,
        prizeCredits: upcoming.prize_credits,
        startsAt: toISO(upcoming.starts_at),
        endsAt: toISO(upcoming.ends_at),
        winnerDisplayName: upcoming.winner_display_name,
      };
    }

    const claimedRes = await db.execute(sql`
      SELECT ${cols} FROM cheat_code_events
      WHERE ends_at <= ${now} AND winner_display_name IS NOT NULL
      ORDER BY ends_at DESC LIMIT 1
    `);
    const claimed = (claimedRes.rows as unknown as JackpotRow[])[0];
    if (claimed) {
      return {
        phase: "claimed",
        name: claimed.name,
        prizeCredits: claimed.prize_credits,
        startsAt: toISO(claimed.starts_at),
        endsAt: toISO(claimed.ends_at),
        winnerDisplayName: claimed.winner_display_name,
      };
    }

    return null;
  } catch {
    return null;
  }
}

router.get("/mic-band/promos", async (req: Request, res: Response) => {
  try {
    const jackpot = await getJackpotSnapshot();
    const promos = buildMicBandPromos({
      now: new Date(),
      launch: SITE_LAUNCH_PROMO,
      spotlight: SPOTLIGHT_OFFER,
      loadingScreen: LOADING_SCREEN_OFFER,
      jackpot,
    });
    res.json({ promos });
  } catch (err) {
    req.log?.error?.({ err }, "mic-band/promos error");
    res.status(500).json({ error: "Could not load promotions." });
  }
});

export default router;
