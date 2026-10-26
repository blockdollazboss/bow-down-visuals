import { eq, and, asc, isNull } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveChatMessagesTable,
  songRequestRulesTable,
  songRequestsTable,
  songsTable,
  creatorProfilesTable,
  creditUsageTable,
  notificationsTable,
  type LiveStream,
  type Song,
  type SongRequest,
  type SongRequestRules,
} from "@workspace/db";
import {
  chargeCredits,
  refundCredits,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
  LedgerWriteError,
} from "./credits";
import { addCreditsAtomic } from "./supabase-admin";
import { recordCreditUsageStrict } from "./payment-record";
import { LIVE_TIP_MINIMUM_VB, LIVE_TIP_MAXIMUM_VB } from "./live-config";
import { isTicketed, canEnterStream } from "./live-tickets";
import { isUndefinedTable } from "./pg-errors";
import { logger } from "./logger";

/* ── Song Requests, Live (Stack-200 N18) — the queue service ─────────────
   Everything about the tipped song-request queue lives here, behind
   plain functions, so the Stage Manager (#166) can run the same queue
   later without touching a route or a page: read the rules, submit a
   request, list the queue, play-next, skip, close/expire. Routes are
   thin HTTP shells over this module; the two docked surfaces (fan
   panel on the watch page, creator desk on the go-live page) are
   thinner still.

   Money: the tip rides the EXISTING live-tips rail mechanics
   (routes/live-tips.ts) — chargeCredits / refundCredits /
   addCreditsAtomic / recordCreditUsageStrict with scoped idempotency
   keys. No second charge path exists here. The one deliberate shape
   difference from a plain tip, stated plainly: a plain tip credits
   the creator immediately because it is a gift; a request tip is a
   tip for a PLAY, so the fan's debit is held against the request row
   and the creator is credited exactly once when the song actually
   starts playing. If it never plays (skipped per the creator's rules,
   or still queued when the stream ends / the queue closes), the fan
   is refunded in full, exactly once. Fans see exactly that on the
   request surface before they tip. */

const MAX_LIVE_MS = 12 * 60 * 60 * 1000; // matches live-chat / live-streams lifecycle cap

export type SongRequestStatus = "queued" | "playing" | "played" | "skipped" | "expired";

export interface CreatorRequestRules {
  requestsOpen: boolean;
  catalogOnly: boolean;
  excludedSongIds: string[];
  /** Creator-set minimum tip in VB, or null = no creator minimum. */
  minTipVb: number | null;
}

export const DEFAULT_REQUEST_RULES: CreatorRequestRules = {
  requestsOpen: true,
  catalogOnly: true,
  excludedSongIds: [],
  minTipVb: null,
};

/** The up-front words every fan sees before tipping — one source, so
 *  the surface copy and the enforced behavior can never drift. */
export const SONG_REQUEST_REFUND_COPY =
  "Your tip pays when the song plays. If the creator skips your request, or the stream ends before it plays, your tip is refunded in full.";

export function streamIsLive(stream: Pick<LiveStream, "status" | "started_at">): boolean {
  if (stream.status !== "live") return false;
  const started = stream.started_at ? new Date(stream.started_at).getTime() : 0;
  if (started && Date.now() - started > MAX_LIVE_MS) return false;
  return true;
}

function rulesFromRow(row: SongRequestRules | undefined): CreatorRequestRules {
  if (!row) return { ...DEFAULT_REQUEST_RULES };
  return {
    requestsOpen: row.requests_open,
    catalogOnly: row.catalog_only,
    excludedSongIds: Array.isArray(row.excluded_song_ids) ? row.excluded_song_ids : [],
    minTipVb: row.min_tip_vb ?? null,
  };
}

export async function getCreatorRequestRules(creatorUserId: string): Promise<CreatorRequestRules> {
  const rows = await db
    .select()
    .from(songRequestRulesTable)
    .where(eq(songRequestRulesTable.creator_user_id, creatorUserId))
    .limit(1);
  return rulesFromRow(rows[0]);
}

export async function upsertCreatorRequestRules(
  creatorUserId: string,
  rules: CreatorRequestRules,
): Promise<CreatorRequestRules> {
  const existing = await db
    .select()
    .from(songRequestRulesTable)
    .where(eq(songRequestRulesTable.creator_user_id, creatorUserId))
    .limit(1);
  if (existing[0]) {
    const updated = await db
      .update(songRequestRulesTable)
      .set({
        requests_open: rules.requestsOpen,
        catalog_only: rules.catalogOnly,
        excluded_song_ids: rules.excludedSongIds,
        min_tip_vb: rules.minTipVb,
        updated_at: new Date(),
      })
      .where(eq(songRequestRulesTable.id, existing[0].id))
      .returning();
    return rulesFromRow(updated[0] ?? existing[0]);
  }
  const inserted = await db
    .insert(songRequestRulesTable)
    .values({
      creator_user_id: creatorUserId,
      requests_open: rules.requestsOpen,
      catalog_only: rules.catalogOnly,
      excluded_song_ids: rules.excludedSongIds,
      min_tip_vb: rules.minTipVb,
    })
    .returning();
  return rulesFromRow(inserted[0]);
}

/** The creator's own catalog (songs rows they own), newest first. */
export async function getCreatorCatalog(creatorUserId: string): Promise<Song[]> {
  const rows = await db.select().from(songsTable).where(eq(songsTable.user_id, creatorUserId));
  return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getSongById(songId: string): Promise<Song | null> {
  const rows = await db.select().from(songsTable).where(eq(songsTable.id, songId)).limit(1);
  return rows[0] ?? null;
}

export type RuleCheck = { ok: true } | { ok: false; code: string; error: string };

/** Pure rule gate — every decline that can be known BEFORE money moves
 *  is decided here, so a rule-declined request is refused at submission
 *  and never charged (no refund needed, ever). */
export function checkSongAgainstRules(
  rules: CreatorRequestRules,
  song: Pick<Song, "id" | "user_id">,
  creatorUserId: string,
  amountVb: number,
): RuleCheck {
  if (!rules.requestsOpen) {
    return { ok: false, code: "REQUESTS_CLOSED", error: "Song requests are closed for this stream." };
  }
  if (rules.catalogOnly && song.user_id !== creatorUserId) {
    return {
      ok: false,
      code: "NOT_IN_CATALOG",
      error: "Requests are for songs from this creator's own catalog.",
    };
  }
  if (rules.excludedSongIds.includes(song.id)) {
    return {
      ok: false,
      code: "SONG_EXCLUDED",
      error: "The creator has taken that song out of requests.",
    };
  }
  if (rules.minTipVb !== null && amountVb < rules.minTipVb) {
    return {
      ok: false,
      code: "BELOW_CREATOR_MINIMUM",
      error: `This creator's minimum tip for a request is ${rules.minTipVb.toLocaleString("en-US")} Visual Bucs.`,
    };
  }
  return { ok: true };
}

export interface SongRequestDto {
  id: string;
  streamId: string;
  songId: string | null;
  songTitle: string;
  amountVb: number;
  status: SongRequestStatus;
  /** 1-based place among the still-queued requests; null once decided. */
  position: number | null;
  fan: { displayName: string; avatarUrl: string | null; slug: string | null };
  refunded: boolean;
  createdAt: string;
  playedAt: string | null;
}

async function fanCard(userId: string) {
  const rows = await db
    .select({
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
      slug: creatorProfilesTable.slug,
    })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  const r = rows[0];
  return r
    ? { displayName: r.displayName, avatarUrl: r.avatarUrl ?? null, slug: r.slug ?? null }
    : { displayName: "Someone", avatarUrl: null, slug: null };
}

async function toDto(row: SongRequest, position: number | null): Promise<SongRequestDto> {
  return {
    id: row.id,
    streamId: row.stream_id,
    songId: row.song_id ?? null,
    songTitle: row.song_title,
    amountVb: row.amount_vb,
    status: row.status as SongRequestStatus,
    position,
    fan: await fanCard(row.fan_user_id),
    refunded: !!row.refunded_at,
    createdAt: new Date(row.created_at).toISOString(),
    playedAt: row.played_at ? new Date(row.played_at).toISOString() : null,
  };
}

/** The full visible queue for a stream: now-playing first, then the
 *  ordered line, then this stream's decided requests (played / skipped
 *  / expired) so fans can see their request's fate honestly. */
export async function listQueue(streamId: string): Promise<SongRequestDto[]> {
  const rows = await db
    .select()
    .from(songRequestsTable)
    .where(eq(songRequestsTable.stream_id, streamId))
    .orderBy(asc(songRequestsTable.created_at));
  const playing = rows.filter((r) => r.status === "playing");
  const queued = rows.filter((r) => r.status === "queued");
  const decided = rows
    .filter((r) => r.status !== "playing" && r.status !== "queued")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const out: SongRequestDto[] = [];
  for (const r of playing) out.push(await toDto(r, null));
  for (let i = 0; i < queued.length; i++) out.push(await toDto(queued[i]!, i + 1));
  for (const r of decided) out.push(await toDto(r, null));
  return out;
}

export type ServiceFailure = { ok: false; status: number; code: string; error: string };
function fail(status: number, code: string, error: string): ServiceFailure {
  return { ok: false, status, code, error };
}

export async function getStreamRow(streamId: string): Promise<LiveStream | null> {
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
  return rows[0] ?? null;
}

export interface SubmitResult {
  ok: true;
  request: SongRequestDto;
  duplicate: boolean;
  announcementMessageId: string | null;
}

/** Submit a tipped request. Rule declines are refused BEFORE the
 *  charge; the charge itself is the live-tips rail (chargeCredits
 *  under a scoped idempotency key + a UNIQUE request-row key as the
 *  second gate), so a retry is a no-op, never a second charge. */
export async function submitSongRequest(args: {
  stream: LiveStream;
  fanUserId: string;
  songId: string;
  amountVb: number;
  idempotencyKey: string;
}): Promise<SubmitResult | ServiceFailure> {
  const { stream, fanUserId, amountVb } = args;
  const creatorUserId = stream.user_id;

  if (!streamIsLive(stream)) return fail(409, "STREAM_NOT_LIVE", "Requests open while the stream is live.");
  if (creatorUserId === fanUserId) {
    return fail(400, "SELF_REQUEST", "You can't request a song on your own stream.");
  }
  if (!Number.isInteger(amountVb) || amountVb < LIVE_TIP_MINIMUM_VB || amountVb > LIVE_TIP_MAXIMUM_VB) {
    return fail(
      400,
      "BAD_AMOUNT",
      `Request tips run ${LIVE_TIP_MINIMUM_VB}–${LIVE_TIP_MAXIMUM_VB.toLocaleString("en-US")} Visual Bucs.`,
    );
  }
  /* The ticket door is the same one tips and chat consult — no entry,
     no request. */
  if (isTicketed(stream) && !(await canEnterStream(stream, fanUserId))) {
    return fail(402, "TICKET_REQUIRED", "This show is ticketed — your ticket opens the room, requests included.");
  }

  const song = await getSongById(args.songId);
  if (!song) return fail(404, "SONG_NOT_FOUND", "That song doesn't exist.");

  const rules = await getCreatorRequestRules(creatorUserId);
  const check = checkSongAgainstRules(rules, song, creatorUserId, amountVb);
  if (!check.ok) return fail(403, check.code, check.error);

  const scopedKey = buildChargeIdempotencyKey("song-request", fanUserId, args.idempotencyKey, {
    streamId: stream.id,
    songId: song.id,
    amountVb,
  });

  // Resume gate: an existing request row for this key means a previous
  // attempt already debited (chargeCredits dedupes the debit too).
  const existing = await db
    .select()
    .from(songRequestsTable)
    .where(eq(songRequestsTable.idempotency_key, scopedKey))
    .limit(1);
  if (existing[0]) {
    const queue = await listQueue(stream.id);
    const dto = queue.find((q) => q.id === existing[0]!.id) ?? (await toDto(existing[0], null));
    return { ok: true, request: dto, duplicate: true, announcementMessageId: null };
  }

  // 1) Debit the fan on the tip rail (idempotent on scopedKey).
  try {
    await chargeCredits(
      fanUserId,
      amountVb,
      { action: "Song Request Tip" },
      { personalOnly: true, idempotencyKey: scopedKey },
    );
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return fail(402, "INSUFFICIENT_BALANCE", "Not enough Visual Bucs for that tip — your balance hasn't changed.");
    }
    if (err instanceof CreditsDisabledError) {
      return fail(403, "CREDITS_DISABLED", "Requests aren't available on your account right now.");
    }
    if (err instanceof LedgerWriteError) {
      return fail(500, "LEDGER_FAILED", "That request couldn't be recorded safely, so it wasn't charged. Try again.");
    }
    throw err;
  }

  // 2) The request row. If the insert fails after the debit landed,
  // refund immediately and void the debit key (the live-tips F6
  // discipline) so a retry starts clean.
  let row: SongRequest | null = null;
  try {
    const inserted = await db
      .insert(songRequestsTable)
      .values({
        stream_id: stream.id,
        creator_user_id: creatorUserId,
        fan_user_id: fanUserId,
        song_id: song.id,
        song_title: song.title,
        amount_vb: amountVb,
        status: "queued",
        idempotency_key: scopedKey,
      })
      .returning();
    row = inserted[0] ?? null;
    if (!row) throw new Error("song request insert returned no row");
  } catch (insertErr) {
    logger.error({ insertErr }, "song request: record failed after debit — refunding the fan");
    let refundOk = false;
    try {
      await refundCredits(fanUserId, amountVb, { action: "Song Request — Refund (record failed)" });
      refundOk = true;
    } catch (refundErr) {
      logger.error({ refundErr }, "song request: CRITICAL refund after record failure also failed — manual reconciliation required");
    }
    if (refundOk) await voidChargeIdempotencyKey(scopedKey);
    return fail(
      500,
      "RECORD_FAILED",
      refundOk
        ? "That request couldn't be recorded, so you've been refunded in full."
        : "That request couldn't be recorded and the refund didn't land either — it's been flagged for reconciliation.",
    );
  }

  // 3) Announce in the stream's own chat (the existing live-chat
  // channel — the route broadcasts the row) + the creator's bell.
  // Best-effort: neither failure fails the request.
  let announcementMessageId: string | null = null;
  try {
    const fan = await fanCard(fanUserId);
    const insertedMessage = await db
      .insert(liveChatMessagesTable)
      .values({
        stream_id: stream.id,
        user_id: fanUserId,
        body: `${fan.displayName} requested "${song.title}" — ${amountVb.toLocaleString("en-US")} VB tip`,
        kind: "song_request",
        tip_amount_vb: amountVb,
      })
      .returning();
    announcementMessageId = insertedMessage[0]?.id ?? null;
  } catch (annErr) {
    logger.warn({ annErr, requestId: row.id }, "song request: chat announcement failed (request itself landed)");
  }
  try {
    const fan = await fanCard(fanUserId);
    await db.insert(notificationsTable).values({
      userId: creatorUserId,
      kind: "song_request",
      title: `${fan.displayName} requested "${song.title}"`,
      body: `${amountVb.toLocaleString("en-US")} Visual Bucs tip — it's in your request queue.`,
      link: `/live/${stream.id}`,
    });
  } catch (notifyErr) {
    logger.warn({ notifyErr, requestId: row.id }, "song request: bell notification failed (request itself landed)");
  }

  const queue = await listQueue(stream.id);
  const dto = queue.find((q) => q.id === row!.id) ?? (await toDto(row, null));
  return { ok: true, request: dto, duplicate: false, announcementMessageId };
}

/** Credit the creator for a request that is starting to play — the
 *  live-tips step-3 shape: derived ledger key checked first, balance
 *  credit + strict ledger row, compensation reversal if the ledger
 *  write fails after the balance landed. Exactly once, guarded by the
 *  row's creator_credited_at stamp set only on success. */
async function creditCreatorForPlay(row: SongRequest): Promise<boolean> {
  if (row.creator_credited_at) return true;
  const creditKey = `${row.idempotency_key}:credit`;
  const prior = await db
    .select({ id: creditUsageTable.id })
    .from(creditUsageTable)
    .where(eq(creditUsageTable.idempotencyKey, creditKey))
    .limit(1)
    .catch(() => [] as Array<{ id: string }>);
  let creditLanded = false;
  try {
    if (!prior[0]) {
      await addCreditsAtomic(row.creator_user_id, row.amount_vb);
      creditLanded = true;
      await recordCreditUsageStrict({
        userId: row.creator_user_id,
        action: "Song Request Tip — Received",
        creditsUsed: -row.amount_vb,
        idempotencyKey: creditKey,
      });
    }
  } catch (err) {
    logger.error({ err, requestId: row.id }, "song request: creator credit failed — reversing any landed credit");
    if (creditLanded) {
      try {
        await addCreditsAtomic(row.creator_user_id, -row.amount_vb);
      } catch (revErr) {
        logger.error({ revErr, requestId: row.id }, "song request: CRITICAL creator-credit reversal failed — manual reconciliation required");
      }
    }
    return false;
  }
  await db
    .update(songRequestsTable)
    .set({ creator_credited_at: new Date(), updated_at: new Date() })
    .where(eq(songRequestsTable.id, row.id));
  return true;
}

/** Refund a decided (skipped / expired) request's tip to the fan,
 *  exactly once: the refunded_at stamp is claimed with a conditional
 *  update first, so concurrent/repeat calls after the claim are
 *  no-ops; a failed refund releases the claim so a later call can
 *  retry. The fan's bell is best-effort. */
export async function refundRequestIfNeeded(row: SongRequest, reason: "skipped" | "expired"): Promise<boolean> {
  if (row.refunded_at || row.creator_credited_at) return !!row.refunded_at;
  const claimed = await db
    .update(songRequestsTable)
    .set({ refunded_at: new Date(), updated_at: new Date() })
    .where(and(eq(songRequestsTable.id, row.id), isNull(songRequestsTable.refunded_at)))
    .returning();
  if (!claimed[0]) return true; // another caller claimed (and owns) the refund
  try {
    await refundCredits(row.fan_user_id, row.amount_vb, {
      action: reason === "skipped" ? "Song Request — Refund (skipped)" : "Song Request — Refund (never played)",
    });
  } catch (err) {
    logger.error({ err, requestId: row.id }, "song request: CRITICAL refund failed — releasing claim for retry");
    await db
      .update(songRequestsTable)
      .set({ refunded_at: null, updated_at: new Date() })
      .where(eq(songRequestsTable.id, row.id))
      .catch(() => {});
    return false;
  }
  try {
    await db.insert(notificationsTable).values({
      userId: row.fan_user_id,
      kind: "song_request_refund",
      title: `Your request tip was refunded`,
      body: `"${row.song_title}" didn't play, so your ${row.amount_vb.toLocaleString("en-US")} Visual Bucs tip is back in your balance.`,
      link: `/live/${row.stream_id}`,
    });
  } catch (notifyErr) {
    logger.warn({ notifyErr, requestId: row.id }, "song request: refund bell failed (refund itself landed)");
  }
  return true;
}

export interface PlayNextResult {
  ok: true;
  /** The request that finished (was playing), if any. */
  finished: SongRequestDto | null;
  /** The request now playing, if any. */
  nowPlaying: SongRequestDto | null;
  announcementMessageId: string | null;
}

/** Advance the queue: the playing request (if any) is played; the head
 *  of the line starts playing and its tip pays the creator. This is
 *  THE operation the Stage Manager will call — order and money are
 *  decided here, never in a page. */
export async function playNextRequest(
  stream: LiveStream,
  actorUserId: string,
): Promise<PlayNextResult | ServiceFailure> {
  if (stream.user_id !== actorUserId) return fail(403, "NOT_YOUR_STREAM", "That's not your stream.");
  const rows = await db
    .select()
    .from(songRequestsTable)
    .where(eq(songRequestsTable.stream_id, stream.id))
    .orderBy(asc(songRequestsTable.created_at));
  const now = new Date();
  let finished: SongRequestDto | null = null;
  for (const playing of rows.filter((r) => r.status === "playing")) {
    const updated = await db
      .update(songRequestsTable)
      .set({ status: "played", decided_at: now, updated_at: now })
      .where(and(eq(songRequestsTable.id, playing.id), eq(songRequestsTable.status, "playing")))
      .returning();
    if (updated[0]) finished = await toDto(updated[0], null);
  }
  const next = rows.find((r) => r.status === "queued");
  if (!next) return { ok: true, finished, nowPlaying: null, announcementMessageId: null };

  // Claim the head of the line before money moves.
  const claimed = await db
    .update(songRequestsTable)
    .set({ status: "playing", played_at: now, updated_at: now })
    .where(and(eq(songRequestsTable.id, next.id), eq(songRequestsTable.status, "queued")))
    .returning();
  if (!claimed[0]) return { ok: true, finished, nowPlaying: null, announcementMessageId: null };

  const paid = await creditCreatorForPlay(claimed[0]);
  if (!paid) {
    // Un-claim: the request goes back to the head of the line so the
    // creator can retry — the fan is never charged twice (the debit
    // stands against this same row) and never loses the request.
    await db
      .update(songRequestsTable)
      .set({ status: "queued", played_at: null, updated_at: new Date() })
      .where(eq(songRequestsTable.id, next.id))
      .catch(() => {});
    return fail(502, "CREDIT_FAILED", "The tip payout step hiccuped — the request is back at the head of the queue. Try again.");
  }

  let announcementMessageId: string | null = null;
  try {
    const insertedMessage = await db
      .insert(liveChatMessagesTable)
      .values({
        stream_id: stream.id,
        user_id: stream.user_id,
        body: `Now playing: "${claimed[0].song_title}" — by request`,
        kind: "song_request",
        tip_amount_vb: claimed[0].amount_vb,
      })
      .returning();
    announcementMessageId = insertedMessage[0]?.id ?? null;
  } catch (annErr) {
    logger.warn({ annErr, requestId: next.id }, "song request: now-playing announcement failed (play itself landed)");
  }
  return { ok: true, finished, nowPlaying: await toDto(claimed[0], null), announcementMessageId };
}

/** Skip a still-queued request per the creator's rules: the request is
 *  declined and its tip refunded in full, exactly once. Replaying the
 *  skip on an already-decided request is a no-op that re-answers the
 *  current row. */
export async function skipSongRequest(
  requestId: string,
  actorUserId: string,
): Promise<{ ok: true; request: SongRequestDto } | ServiceFailure> {
  const rows = await db.select().from(songRequestsTable).where(eq(songRequestsTable.id, requestId)).limit(1);
  const row = rows[0];
  if (!row) return fail(404, "REQUEST_NOT_FOUND", "That request doesn't exist.");
  if (row.creator_user_id !== actorUserId) return fail(403, "NOT_YOUR_STREAM", "That's not your stream.");
  if (row.status === "playing" || row.status === "played") {
    return fail(409, "ALREADY_PLAYING", "That request already played — its tip has been earned. Use play-next to move on.");
  }
  if (row.status === "queued") {
    const now = new Date();
    const claimed = await db
      .update(songRequestsTable)
      .set({ status: "skipped", decided_at: now, updated_at: now })
      .where(and(eq(songRequestsTable.id, row.id), eq(songRequestsTable.status, "queued")))
      .returning();
    if (claimed[0]) {
      await refundRequestIfNeeded(claimed[0], "skipped");
      const fresh = await db.select().from(songRequestsTable).where(eq(songRequestsTable.id, row.id)).limit(1);
      return { ok: true, request: await toDto(fresh[0] ?? claimed[0], null) };
    }
  }
  // Already skipped/expired: make sure the refund landed (exactly-once
  // guarded inside), then answer the current row.
  await refundRequestIfNeeded(row, row.status === "expired" ? "expired" : "skipped");
  const fresh = await db.select().from(songRequestsTable).where(eq(songRequestsTable.id, row.id)).limit(1);
  return { ok: true, request: await toDto(fresh[0] ?? row, null) };
}

/** Close out a stream's queue: the playing request counts as played;
 *  every still-queued request expires and its tip is refunded in full,
 *  exactly once. Called when the creator closes the queue mid-stream
 *  and from the stream-end lifecycle (routes/live-streams endStreamRow),
 *  so no path can strand a fan's tip on an unplayed request. Safe to
 *  call repeatedly — decided rows are untouched. */
export async function expireQueuedRequests(
  streamId: string,
): Promise<{ expired: number; refunded: number; playedOut: number }> {
  const rows = await db
    .select()
    .from(songRequestsTable)
    .where(eq(songRequestsTable.stream_id, streamId))
    .orderBy(asc(songRequestsTable.created_at));
  let expired = 0;
  let refunded = 0;
  let playedOut = 0;
  const now = new Date();
  for (const row of rows) {
    if (row.status === "playing") {
      const updated = await db
        .update(songRequestsTable)
        .set({ status: "played", decided_at: now, updated_at: now })
        .where(and(eq(songRequestsTable.id, row.id), eq(songRequestsTable.status, "playing")))
        .returning();
      if (updated[0]) playedOut++;
    } else if (row.status === "queued") {
      const claimed = await db
        .update(songRequestsTable)
        .set({ status: "expired", decided_at: now, updated_at: now })
        .where(and(eq(songRequestsTable.id, row.id), eq(songRequestsTable.status, "queued")))
        .returning();
      if (claimed[0]) {
        expired++;
        if (await refundRequestIfNeeded(claimed[0], "expired")) refunded++;
      }
    }
  }
  return { expired, refunded, playedOut };
}

export { isUndefinedTable };
