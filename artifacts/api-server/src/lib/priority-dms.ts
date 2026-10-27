import { createHash } from "crypto";

/**
 * Paid Priority DMs (Wave-4 #44) — the core.
 *
 * A fan pays Visual Bucs to land one message in a creator's priority
 * inbox lane inside Messages. THE HONESTY RULE IS THE FEATURE:
 *   - the price is the platform's ruled price — 100 VB per priority
 *     message (owner ruling 2026-10-27) — stated before the fan pays;
 *   - the reply window is the creator's own stated window, shown
 *     before the fan pays;
 *   - unanswered inside the window = full auto-refund, exactly once;
 *   - a block always wins: blocked fans cannot buy, and a delivery
 *     refused by a block refunds exactly once.
 *
 * PRICE + GATE — OWNER RULED 2026-10-27: the gate is OPEN and the
 * price is 100 VB per priority message. `PRIORITY_DM_ENABLED` remains
 * as the ops kill switch: exactly "false" closes the gate, anything
 * else (including unset) leaves it open. The creator-stated
 * `minPriceVb` setting from the gated era is kept stored for compat
 * but no longer sets or gates the charge — the ruled platform price
 * is the only price ever charged or displayed.
 *
 * Money shape (escrow, TEST MODE Visual Bucs on the existing rails):
 * the fan's charge is HELD (row status 'held'); it pays out to the
 * creator only when a creator reply lands inside the window, and it
 * returns to the fan on expiry or block. Money moves ONLY on a
 * held -> terminal status transition, and the store's transition is
 * conditional on the row still being 'held', so a settle sweep, a
 * retry, and a block racing each other can never move money twice.
 * Charges additionally ride chargeCredits' idempotency key, and the
 * priority row's own UNIQUE idempotency key makes a retried purchase
 * return the original row instead of charging again.
 *
 * This module is DB-free: the route supplies a store + credits port
 * (see routes/priority-dms.ts), tests supply fakes.
 */

export const PRIORITY_DM_GATE_ENV = "PRIORITY_DM_ENABLED";

/** Platform gate: OPEN (owner ruling 2026-10-27). Only the exact
 *  kill-switch value "false" closes it; unset means open. */
export function isPriorityDmPlatformEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[PRIORITY_DM_GATE_ENV] !== "false";
}

/* ── Creator-stated values (validated, never invented) ───────────────── */

export const PRIORITY_DM_MIN_PRICE_VB = 1;
export const PRIORITY_DM_MAX_PRICE_VB = 1_000_000;
export const PRIORITY_DM_MIN_WINDOW_HOURS = 12;
export const PRIORITY_DM_MAX_WINDOW_HOURS = 168; // one week, stated plainly
export const PRIORITY_DM_BODY_MAX = 2000;

/** A creator price is sellable only when the creator typed a whole
 *  number of Visual Bucs in range. Anything else (null, 0, fractional,
 *  text) means "no price set" — never substituted with a default. */
export function isValidCreatorPrice(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= PRIORITY_DM_MIN_PRICE_VB &&
    v <= PRIORITY_DM_MAX_PRICE_VB
  );
}

export function isValidReplyWindowHours(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= PRIORITY_DM_MIN_WINDOW_HOURS &&
    v <= PRIORITY_DM_MAX_WINDOW_HOURS
  );
}

export interface PriorityDmSettingsLike {
  creatorUserId: string;
  optedIn: boolean;
  minPriceVb: number | null;
  replyWindowHours: number;
}

/* ── The ruled platform price (owner ruling 2026-10-27) ────────────── */

export const PRIORITY_DM_PRICE_ENV = "PRIORITY_DM_PRICE_VB";

/** THE price: 100 VB per priority message. This is the only price a
 *  fan is ever charged or shown for a priority DM. */
export const PRIORITY_DM_PRICE_VB = 100;

/** The live price: the ruled 100, env-overridable without a deploy.
 *  An invalid override falls back to the ruled 100 — never to a
 *  creator-stated price. */
export function priorityDmPriceVb(
  env: Record<string, string | undefined> = process.env,
): number {
  const v = Number(env[PRIORITY_DM_PRICE_ENV]);
  return isValidCreatorPrice(v) ? v : PRIORITY_DM_PRICE_VB;
}

export type PriorityDmSellable =
  | { sellable: true; priceVb: number; replyWindowHours: number }
  | { sellable: false; reason: "gate_off" | "not_opted_in" | "no_price" | "bad_window" };

/** Can this creator currently sell a priority DM? The gate is checked
 *  first so a gated-off platform never leaks a price as if it were
 *  purchasable. The price is the platform's ruled price — the
 *  creator's stored minPriceVb no longer sets or gates it. ("no_price"
 *  remains in the reason union for API compat; it is never returned.) */
export function evaluateSellable(
  settings: PriorityDmSettingsLike | null,
  platformEnabled: boolean,
  priceVb: number = PRIORITY_DM_PRICE_VB,
): PriorityDmSellable {
  if (!platformEnabled) return { sellable: false, reason: "gate_off" };
  if (!settings || !settings.optedIn) return { sellable: false, reason: "not_opted_in" };
  if (!isValidReplyWindowHours(settings.replyWindowHours)) return { sellable: false, reason: "bad_window" };
  return { sellable: true, priceVb, replyWindowHours: settings.replyWindowHours };
}

/* ── Rows + ports ────────────────────────────────────────────────────── */

export type PriorityDmStatus = "held" | "replied" | "refunded_expired" | "refunded_blocked";

export interface PriorityDmRow {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  senderUserId: string;
  creatorUserId: string;
  amountVb: number;
  status: PriorityDmStatus;
  idempotencyKey: string;
  replyDeadline: Date;
  repliedAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
}

export interface PriorityConversationLike {
  id: string;
  status: string; // "inbox" | "request" | "blocked"
}

export interface PriorityDmStore {
  getSettings(creatorUserId: string): Promise<PriorityDmSettingsLike | null>;
  findByIdempotencyKey(key: string): Promise<PriorityDmRow | null>;
  insertPriorityDm(input: {
    conversationId: string | null;
    messageId: string | null;
    senderUserId: string;
    creatorUserId: string;
    amountVb: number;
    status: PriorityDmStatus;
    idempotencyKey: string;
    replyDeadline: Date;
  }): Promise<PriorityDmRow>;
  /** Conditional transition: resolves true only for the caller that
   *  actually moved the row out of 'held' — the exactly-once guard. */
  transitionFromHeld(
    id: string,
    to: Exclude<PriorityDmStatus, "held">,
    patch: { repliedAt?: Date | null; settledAt?: Date | null; messageId?: string | null; conversationId?: string | null },
  ): Promise<boolean>;
  setDelivery(id: string, conversationId: string, messageId: string): Promise<void>;
  listHeld(filter: { creatorUserId?: string; senderUserId?: string }): Promise<PriorityDmRow[]>;
  findConversationBetween(aUserId: string, bUserId: string): Promise<PriorityConversationLike | null>;
  getOrCreateInboxConversation(aUserId: string, bUserId: string, requestedBy: string): Promise<PriorityConversationLike>;
  insertMessage(conversationId: string, senderUserId: string, body: string): Promise<{ id: string }>;
  getConversationById(id: string): Promise<PriorityConversationLike | null>;
  /** The creator's first reply in this conversation at/after `since`, if any. */
  creatorReplyAt(conversationId: string, creatorUserId: string, since: Date): Promise<Date | null>;
}

export interface PriorityDmCredits {
  /** Throws on insufficient balance. Idempotent per key (rail-level). */
  charge(userId: string, amountVb: number, idempotencyKey: string): Promise<void>;
  refund(userId: string, amountVb: number, rowId: string): Promise<void>;
  payout(userId: string, amountVb: number, rowId: string): Promise<void>;
}

export interface PriorityDmDeps {
  store: PriorityDmStore;
  credits: PriorityDmCredits;
  platformEnabled: boolean;
  /** The charge/display price; defaults to the ruled 100 VB. */
  priceVb?: number;
  now?: () => Date;
}

/* ── Idempotency keys ────────────────────────────────────────────────── */

/** One key per (sender, purchase intent). A client key (>= 8 chars)
 *  wins; otherwise the key is derived from the intent itself, so an
 *  identical retry hashes to the identical key. */
export function buildPriorityDmKey(senderUserId: string, clientKey: unknown, intent: unknown): string {
  if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
    return `priority-dm:${senderUserId}:client:${clientKey.trim()}`;
  }
  const intentJson = typeof intent === "string" ? intent : (JSON.stringify(intent) ?? "");
  const hash = createHash("sha256").update(intentJson).digest("hex").slice(0, 32);
  return `priority-dm:${senderUserId}:${hash}`;
}

export function replyDeadlineFor(now: Date, replyWindowHours: number): Date {
  return new Date(now.getTime() + replyWindowHours * 3600 * 1000);
}

export function isExpired(row: Pick<PriorityDmRow, "status" | "replyDeadline">, now: Date): boolean {
  return row.status === "held" && row.replyDeadline.getTime() <= now.getTime();
}

/* ── Send ────────────────────────────────────────────────────────────── */

export type SendPriorityDmOutcome =
  | { kind: "gate_off" }
  | { kind: "invalid"; message: string }
  | { kind: "not_available"; reason: "not_opted_in" | "no_price" | "bad_window" }
  | { kind: "blocked" }
  | { kind: "duplicate"; row: PriorityDmRow }
  | { kind: "refunded_blocked"; row: PriorityDmRow }
  | { kind: "sent"; row: PriorityDmRow };

export async function sendPriorityDm(
  deps: PriorityDmDeps,
  input: { senderUserId: string; creatorUserId: string; body: string; clientKey?: unknown },
): Promise<SendPriorityDmOutcome> {
  const now = deps.now ? deps.now() : new Date();
  if (!deps.platformEnabled) return { kind: "gate_off" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > PRIORITY_DM_BODY_MAX) {
    return { kind: "invalid", message: `Keep your priority message between 1 and ${PRIORITY_DM_BODY_MAX} characters.` };
  }
  if (input.senderUserId === input.creatorUserId) {
    return { kind: "invalid", message: "You can't send a priority DM to yourself." };
  }

  const settings = await deps.store.getSettings(input.creatorUserId);
  const sellable = evaluateSellable(settings, true, deps.priceVb ?? PRIORITY_DM_PRICE_VB);
  if (!sellable.sellable) {
    // gate_off cannot occur here (checked above); map the rest plainly.
    return { kind: "not_available", reason: sellable.reason === "gate_off" ? "not_opted_in" : sellable.reason };
  }

  /* Block always wins — checked BEFORE any money moves. A blocked fan
     is refused outright and is never charged. */
  const existingConv = await deps.store.findConversationBetween(input.senderUserId, input.creatorUserId);
  if (existingConv?.status === "blocked") return { kind: "blocked" };

  const key = buildPriorityDmKey(input.senderUserId, input.clientKey, {
    creatorUserId: input.creatorUserId,
    body,
  });
  const prior = await deps.store.findByIdempotencyKey(key);
  if (prior) return { kind: "duplicate", row: prior };

  /* Charge exactly once: the rail suppresses a replayed key, and the
     row insert below is UNIQUE on the same key. Personal balance only
     (enforced by the route's credits adapter) so the refund leg is
     always symmetric with the charge leg. */
  await deps.credits.charge(input.senderUserId, sellable.priceVb, key);

  let row: PriorityDmRow;
  try {
    row = await deps.store.insertPriorityDm({
      conversationId: existingConv?.id ?? null,
      messageId: null,
      senderUserId: input.senderUserId,
      creatorUserId: input.creatorUserId,
      amountVb: sellable.priceVb,
      status: "held",
      idempotencyKey: key,
      replyDeadline: replyDeadlineFor(now, sellable.replyWindowHours),
    });
  } catch {
    /* The row never landed (e.g. a concurrent retry won the UNIQUE
       key): re-read — if the winner's row exists this was a duplicate
       and the rail already suppressed a second charge. Otherwise the
       charge has no row: refund it so money never sits without a
       record, then surface the duplicate/failure honestly. */
    const winner = await deps.store.findByIdempotencyKey(key);
    if (winner) return { kind: "duplicate", row: winner };
    await deps.credits.refund(input.senderUserId, sellable.priceVb, key);
    throw new Error("priority_dm_row_insert_failed_refunded");
  }

  /* Delivery re-check: a block that landed between the pre-check and
     the charge still wins — the message is NOT delivered and the fan
     is refunded exactly once (only the caller that wins the
     held -> refunded_blocked transition moves the money). */
  const convNow = existingConv
    ? await deps.store.getConversationById(existingConv.id)
    : await deps.store.findConversationBetween(input.senderUserId, input.creatorUserId);
  if (convNow?.status === "blocked") {
    const won = await deps.store.transitionFromHeld(row.id, "refunded_blocked", { settledAt: now });
    if (won) await deps.credits.refund(input.senderUserId, row.amountVb, row.id);
    return { kind: "refunded_blocked", row: { ...row, status: "refunded_blocked", settledAt: now } };
  }

  const conv = convNow ?? (await deps.store.getOrCreateInboxConversation(input.senderUserId, input.creatorUserId, input.senderUserId));
  const msg = await deps.store.insertMessage(conv.id, input.senderUserId, body);
  await deps.store.setDelivery(row.id, conv.id, msg.id);
  return { kind: "sent", row: { ...row, conversationId: conv.id, messageId: msg.id } };
}

/* ── Settle (reply payout / expiry refund / block refund) ────────────── */

export interface SettleSummary {
  replied: number;
  refundedExpired: number;
  refundedBlocked: number;
  stillHeld: number;
}

/**
 * Settle held rows in scope. For each held row, in order:
 *   1. conversation blocked  -> refund the fan (block always wins);
 *   2. creator replied at/before the deadline -> pay the creator;
 *   3. deadline passed unanswered -> refund the fan in full.
 * A reply that arrived after the deadline does NOT earn the payout —
 * the window the fan paid for is the contract. Money moves only for
 * the caller that wins the conditional transition, so concurrent
 * settles are safe and re-running settle is a no-op.
 */
export async function settlePriorityDms(
  deps: PriorityDmDeps,
  filter: { creatorUserId?: string; senderUserId?: string },
): Promise<SettleSummary> {
  const now = deps.now ? deps.now() : new Date();
  const summary: SettleSummary = { replied: 0, refundedExpired: 0, refundedBlocked: 0, stillHeld: 0 };
  const held = await deps.store.listHeld(filter);
  for (const row of held) {
    const conv = row.conversationId ? await deps.store.getConversationById(row.conversationId) : null;
    if (conv?.status === "blocked") {
      const won = await deps.store.transitionFromHeld(row.id, "refunded_blocked", { settledAt: now });
      if (won) {
        await deps.credits.refund(row.senderUserId, row.amountVb, row.id);
        summary.refundedBlocked++;
      }
      continue;
    }
    if (row.conversationId) {
      const repliedAt = await deps.store.creatorReplyAt(row.conversationId, row.creatorUserId, row.createdAt);
      if (repliedAt && repliedAt.getTime() <= row.replyDeadline.getTime()) {
        const won = await deps.store.transitionFromHeld(row.id, "replied", { repliedAt, settledAt: now });
        if (won) {
          await deps.credits.payout(row.creatorUserId, row.amountVb, row.id);
          summary.replied++;
        }
        continue;
      }
    }
    if (isExpired(row, now)) {
      const won = await deps.store.transitionFromHeld(row.id, "refunded_expired", { settledAt: now });
      if (won) {
        await deps.credits.refund(row.senderUserId, row.amountVb, row.id);
        summary.refundedExpired++;
      }
      continue;
    }
    summary.stillHeld++;
  }
  return summary;
}

/* ── Settings validation (creator controls) ──────────────────────────── */

export type UpdateSettingsOutcome =
  | { ok: true; settings: { optedIn: boolean; minPriceVb: number | null; replyWindowHours: number } }
  | { ok: false; message: string };

/** Validate a creator settings update. Since the 2026-10-27 ruling
 *  the price is the platform's (100 VB), so opting in requires only a
 *  stated reply window. A supplied legacy price is still shape-checked
 *  and stored, but it never sets or gates the charge. Opting out is
 *  always allowed and keeps the stated values for when they return. */
export function validateSettingsUpdate(
  current: PriorityDmSettingsLike | null,
  input: { opted_in?: unknown; min_price_vb?: unknown; reply_window_hours?: unknown },
): UpdateSettingsOutcome {
  const optedIn = typeof input.opted_in === "boolean" ? input.opted_in : (current?.optedIn ?? false);
  let minPriceVb: number | null = current?.minPriceVb ?? null;
  if (input.min_price_vb !== undefined) {
    if (input.min_price_vb === null) minPriceVb = null;
    else if (isValidCreatorPrice(input.min_price_vb)) minPriceVb = input.min_price_vb;
    else return { ok: false, message: `Price must be a whole number of Visual Bucs between ${PRIORITY_DM_MIN_PRICE_VB} and ${PRIORITY_DM_MAX_PRICE_VB}, or blank.` };
  }
  let replyWindowHours = current?.replyWindowHours ?? 48;
  if (input.reply_window_hours !== undefined) {
    if (isValidReplyWindowHours(input.reply_window_hours)) replyWindowHours = input.reply_window_hours;
    else return { ok: false, message: `Reply window must be a whole number of hours between ${PRIORITY_DM_MIN_WINDOW_HOURS} and ${PRIORITY_DM_MAX_WINDOW_HOURS}.` };
  }
  if (optedIn && !isValidReplyWindowHours(replyWindowHours)) {
    return { ok: false, message: "State your reply window before turning priority DMs on." };
  }
  return { ok: true, settings: { optedIn, minPriceVb, replyWindowHours } };
}
