import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { resolveOptionalSession } from "../lib/optional-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  LiveBattleError,
  dbLiveBattleStore as store,
  isParticipant,
  liveBattleService as svc,
  roundAt,
  sideOf,
  tallyVotes,
  type BattleRow,
  type BattleSide,
  type ProfileCardRow,
} from "../lib/live-battles";

/* ─── Live Battles (Stack-200 TRULY NEW #154) ────────────────────────────
   Two creators, one theme, timed rounds, live audience voting —
   docked inside the EXISTING live surfaces (the watch page and the
   Go Live hub), never a standalone page.

   POST /api/live-battles                    challenge a creator by slug (auth)
   GET  /api/live-battles/mine               my battles, newest first (auth)
   GET  /api/live-battles/crown              the Charts crown slot (public)
   GET  /api/live-battles/by-stream/:id      the battle riding a stream
                                             (public — guests watch)
   GET  /api/live-battles/:id                one battle + live tally
                                             (public — guests watch)
   GET  /api/live-battles/:id/tally          the tally alone (public)
   POST /api/live-battles/:id/accept         opponent answers yes (auth)
   POST /api/live-battles/:id/decline        opponent answers no (auth)
   POST /api/live-battles/:id/cancel         challenger calls it off (auth)
   POST /api/live-battles/:id/start          open the battle on a live
                                             stream owned by a battler (auth)
   POST /api/live-battles/:id/vote           cast/move ONE fan voice (auth —
                                             recorded interactions only)
   POST /api/live-battles/:id/finalize       close the battle and declare
                                             the result (auth, battlers only)

   Rules carried from the service (lib/live-battles), never re-invented
   here:
   - Votes are recorded interaction rows ONLY. The tally in every DTO
     is a COUNT of live_battle_votes rows (tallyVotes over listVotes) —
     never a stored counter, never tips. Tips keep moving on the
     existing live-tips / stage-tips rails (TEST MODE Visual Bucs,
     splits/fees unchanged) and NEVER count as votes.
   - Guests are watch-only: every read is public, every write is
     auth-gated, and the two battlers can never vote in their own
     battle (the service refuses participant votes).
   - Blocks sever: every read and mutation passes through the
     service's settle/sever path, so a block landing mid-flight
     voids the battle before anything else happens.
   - NO PRICES: nothing here charges, prices or pays out. The prize
     is the crown slot (the most recent completed battle's winner)
     and the World spectacle the service speaks on finalize. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  opponent_slug: z.string().trim().min(1).max(80),
});
const startSchema = z.object({
  stream_id: z.string().uuid(),
});
const voteSchema = z.object({
  side: z.enum(["challenger", "opponent"]),
});

const ERROR_STATUS: Record<LiveBattleError["code"], number> = {
  not_found: 404,
  no_profile: 403,
  self_battle: 400,
  blocked: 403,
  already_active: 409,
  too_many_pending: 409,
  not_participant: 403,
  not_opponent: 403,
  not_challenger: 403,
  bad_status: 409,
  stream_not_live: 409,
  stream_not_participant: 403,
  participant_vote: 403,
  not_live: 409,
  ended: 409,
};

function fail(res: Response, err: unknown, scope: string) {
  if (err instanceof LiveBattleError) {
    res.status(ERROR_STATUS[err.code] ?? 400).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[live-battles] ${scope} failed`);
  res.status(500).json({ error: "Something went wrong on our end. Try again." });
}

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function cardDto(card: ProfileCardRow | null) {
  if (!card) return null;
  return {
    user_id: card.userId,
    profile_id: card.profileId,
    display_name: card.displayName,
    slug: card.slug,
    avatar_url: card.avatarUrl,
  };
}

export interface BattleDto {
  id: string;
  theme: string;
  status: BattleRow["status"];
  round_count: number;
  round_seconds: number;
  stream_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  result: BattleRow["result"];
  winner_user_id: string | null;
  void_reason: string | null;
  spectacle_announced_at: string | null;
  challenger: ReturnType<typeof cardDto>;
  opponent: ReturnType<typeof cardDto>;
  /* The tally — always a fresh COUNT of the recorded vote rows. */
  tally: ReturnType<typeof tallyVotes>;
  current_round: number | null;
  viewer_side: BattleSide | null;
  my_vote: BattleSide | null;
  created_at: string;
  updated_at: string;
}

async function battleDto(battle: BattleRow, viewerUserId: string | null): Promise<BattleDto> {
  const [challenger, opponent, votes] = await Promise.all([
    store.profileById(battle.challengerProfileId),
    store.profileById(battle.opponentProfileId),
    store.listVotes(battle.id),
  ]);
  const myVoteRow = viewerUserId ? votes.find((v) => v.voterUserId === viewerUserId) ?? null : null;
  return {
    id: battle.id,
    theme: battle.theme,
    status: battle.status,
    round_count: battle.roundCount,
    round_seconds: battle.roundSeconds,
    stream_id: battle.streamId,
    starts_at: battle.startsAt ? battle.startsAt.toISOString() : null,
    ends_at: battle.endsAt ? battle.endsAt.toISOString() : null,
    result: battle.result,
    winner_user_id: battle.winnerUserId,
    void_reason: battle.voidReason,
    spectacle_announced_at: battle.spectacleAnnouncedAt ? battle.spectacleAnnouncedAt.toISOString() : null,
    challenger: cardDto(challenger),
    opponent: cardDto(opponent),
    tally: tallyVotes(votes, battle.roundCount),
    current_round: battle.status === "live" ? roundAt(battle, new Date()) : null,
    viewer_side: viewerUserId ? sideOf(battle, viewerUserId) : null,
    my_vote: myVoteRow ? myVoteRow.side : null,
    created_at: battle.createdAt.toISOString(),
    updated_at: battle.updatedAt.toISOString(),
  };
}

/** Load + settle (block-sever, auto-finalize past the window) or 404. */
async function settledBattle(id: string): Promise<BattleRow> {
  const battle = await store.getBattle(id);
  if (!battle) throw new LiveBattleError("not_found", "That battle doesn't exist.");
  return svc.settle(battle);
}

/* POST /api/live-battles — challenge a creator by their profile slug */
router.post("/live-battles", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Name the creator you're challenging.", code: "invalid" });
    }
    const battle = await svc.createChallenge({
      challengerUserId: req.userId!,
      opponentSlug: parsed.data.opponent_slug,
    });
    return res.status(201).json({ battle: await battleDto(battle, req.userId!) });
  } catch (err) {
    return fail(res, err, "create challenge");
  }
});

/* GET /api/live-battles/mine — every battle I'm a side of */
router.get("/live-battles/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const rows = await store.listBattlesForUser(req.userId!);
    const settled: BattleRow[] = [];
    for (const row of rows) settled.push(await svc.settle(row));
    const battles = await Promise.all(settled.map((b) => battleDto(b, req.userId!)));
    return res.json({ battles });
  } catch (err) {
    return fail(res, err, "mine");
  }
});

/* GET /api/live-battles/crown — the Charts crown slot: the winner of
   the most recent completed battle holds it until the next battle
   completes (a tie moves nothing — the service's getCrown reads only
   completed battles WITH a winner). Public: guests read the honours. */
router.get("/live-battles/crown", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await resolveOptionalSession(req);
    const crown = await svc.getCrown();
    if (!crown) return res.json({ crown: null });
    return res.json({
      crown: {
        battle: await battleDto(crown.battle, req.userId ?? null),
        winner: cardDto(crown.winner),
        holder_since: crown.holderSince.toISOString(),
      },
    });
  } catch (err) {
    return fail(res, err, "crown");
  }
});

/* GET /api/live-battles/by-stream/:streamId — the battle riding this
   stream (the watch page's door). Public: guests watch the tally. */
router.get("/live-battles/by-stream/:streamId", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await resolveOptionalSession(req);
    const streamId = param(req, "streamId");
    if (!UUID_RE.test(streamId)) return res.json({ battle: null });
    const found = await store.battleForStream(streamId);
    if (!found) return res.json({ battle: null });
    const battle = await svc.settle(found);
    return res.json({ battle: await battleDto(battle, req.userId ?? null) });
  } catch (err) {
    return fail(res, err, "by-stream");
  }
});

/* GET /api/live-battles/:id — one battle, settled, with its tally */
router.get("/live-battles/:id", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await resolveOptionalSession(req);
    const id = param(req, "id");
    if (!UUID_RE.test(id)) return res.status(404).json({ error: "That battle doesn't exist.", code: "not_found" });
    const battle = await settledBattle(id);
    return res.json({ battle: await battleDto(battle, req.userId ?? null) });
  } catch (err) {
    return fail(res, err, "get battle");
  }
});

/* GET /api/live-battles/:id/tally — the recorded-interactions tally
   alone (the lightweight poll the watch panel rides). */
router.get("/live-battles/:id/tally", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    if (!UUID_RE.test(id)) return res.status(404).json({ error: "That battle doesn't exist.", code: "not_found" });
    const battle = await settledBattle(id);
    const votes = await store.listVotes(battle.id);
    return res.json({
      battle_id: battle.id,
      status: battle.status,
      result: battle.result,
      winner_user_id: battle.winnerUserId,
      tally: tallyVotes(votes, battle.roundCount),
      current_round: battle.status === "live" ? roundAt(battle, new Date()) : null,
    });
  } catch (err) {
    return fail(res, err, "tally");
  }
});

function respondRoute(accept: boolean) {
  return async (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      if (!UUID_RE.test(id)) return res.status(404).json({ error: "That battle doesn't exist.", code: "not_found" });
      const battle = await svc.respond({ battleId: id, userId: req.userId!, accept });
      return res.json({ battle: await battleDto(battle, req.userId!) });
    } catch (err) {
      return fail(res, err, accept ? "accept" : "decline");
    }
  };
}

router.post("/live-battles/:id/accept", requireAuth, publicApiLimiter, respondRoute(true));
router.post("/live-battles/:id/decline", requireAuth, publicApiLimiter, respondRoute(false));

/* POST /api/live-battles/:id/cancel — the challenger calls it off */
router.post("/live-battles/:id/cancel", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    if (!UUID_RE.test(id)) return res.status(404).json({ error: "That battle doesn't exist.", code: "not_found" });
    const battle = await svc.cancel({ battleId: id, userId: req.userId! });
    return res.json({ battle: await battleDto(battle, req.userId!) });
  } catch (err) {
    return fail(res, err, "cancel");
  }
});

/* POST /api/live-battles/:id/start — open the battle on a live stream
   owned by one of the two battlers (the service checks both). */
router.post("/live-battles/:id/start", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    if (!UUID_RE.test(id)) return res.status(404).json({ error: "That battle doesn't exist.", code: "not_found" });
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Start needs the live stream it rides.", code: "invalid" });
    }
    const battle = await svc.start({ battleId: id, userId: req.userId!, streamId: parsed.data.stream_id });
    return res.json({ battle: await battleDto(battle, req.userId!) });
  } catch (err) {
    return fail(res, err, "start");
  }
});

/* POST /api/live-battles/:id/vote — ONE signed-in fan, ONE voice,
   recorded as a vote row. Moving the voice moves the count — the
   service upserts the voter's single row, never a second one.
   Battlers can never vote (participant_vote); guests never reach
   here (requireAuth) — they watch only. */
router.post("/live-battles/:id/vote", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    if (!UUID_RE.test(id)) return res.status(404).json({ error: "That battle doesn't exist.", code: "not_found" });
    const parsed = voteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Pick a side to vote for.", code: "invalid" });
    }
    const { battle, tally, mySide } = await svc.castVote({
      battleId: id,
      voterUserId: req.userId!,
      side: parsed.data.side as BattleSide,
    });
    return res.json({
      battle: await battleDto(battle, req.userId!),
      tally,
      my_vote: mySide,
    });
  } catch (err) {
    return fail(res, err, "vote");
  }
});

/* POST /api/live-battles/:id/finalize — close the battle and declare
   the result from the recorded rows. Battlers only (the service's
   finalize is also reachable through settle once the window has
   closed, so a result never waits on a manual close). */
router.post("/live-battles/:id/finalize", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    if (!UUID_RE.test(id)) return res.status(404).json({ error: "That battle doesn't exist.", code: "not_found" });
    const existing = await store.getBattle(id);
    if (!existing) throw new LiveBattleError("not_found", "That battle doesn't exist.");
    if (!isParticipant(existing, req.userId!)) {
      throw new LiveBattleError("not_participant", "Only the two battlers can close this battle.");
    }
    const battle = await svc.finalize(id);
    return res.json({ battle: await battleDto(battle, req.userId!) });
  } catch (err) {
    return fail(res, err, "finalize");
  }
});

export default router;
