/* ─── Cloud Operator Phase 2, Lane G — the automatic duties ──────────
   Thy Cheat Code keeps the peace in the palace. These are the jobs he
   does on his own watch, with nobody asking: remind the palace before
   a booked event, herald the winners humans decided, and file trouble
   into the moderators' queue for a human to judge.

   THE CEILING (owner law, Oct 20 — "he managed the peace in the
   room"): a duty NEVER punishes. No auto-mute, no auto-kick, no
   auto-remove, no auto-lock, no charge, no member state changed —
   the strongest thing a duty can do is FILE A FLAG for a human.
   Punishment verbs exist only as Tier-4 admin commands (Lane F),
   fired by an admin's word, never by a duty's judgment.

   THE SWITCHES (standing law: every automated behavior has an off):
   a master switch, OPERATOR_DUTIES_ENABLED, plus one per duty —
   OPERATOR_DUTY_HOST_REMINDERS_ENABLED, OPERATOR_DUTY_WINNER_HERALDS
   _ENABLED, OPERATOR_DUTY_TROUBLE_FLAGGING_ENABLED. All default ON;
   0/false/off stills them. A duty whose switch is off does not fire
   and writes nothing — silence, not a refusal row.

   THE TRAIL: every firing writes one operator_actions row with
   channel 'automatic' (migration 0180), tier 0 (nothing charged,
   nothing punished, nobody's state mutated — the tier ladder is for
   member-invoked tools; the channel + the duty.* tool ids are what
   mark these rows), and a target naming the subject (event / contest
   / season / member). The rows double as the duties' memory: dedupe
   and rate caps READ the trail, so a restart re-fires nothing and a
   cap holds across deploys.

   THE CAPS (a duty can never become a horn):
   - one reminder per event, ever (trail-checked);
   - one herald per contest decision / per season settling, ever
     (trail-checked, on top of those paths' own once-only records);
   - palace-wide, duty announcements stand at least
     DUTY_ANNOUNCE_MIN_INTERVAL_MS apart (reminders + contest
     heralds share the palace's ear; the court herald's cap is its
     once-ever settlement — it cannot repeat, so it is not queued
     behind the shared interval);
   - one trouble flag per member per TROUBLE_FLAG_WINDOW_MS, on top
     of the queue's own one-open-report-per-(reporter, target) index.

   RESILIENCE, in the house's own shape: the trail reads that feed
   dedupe/caps fail LOUD (logger) and fall back to "no prior firing"
   rather than taking a scheduler down — the same discipline Lane A's
   audit write keeps ("must never take the chat down with it"). With
   the real database the trail is always there; the fallback exists
   so a broken read degrades a cap, never the palace. Audit WRITES
   are attempted for every firing and logged loudly when they fail.

   NOT BUILT, on purpose:
   - The standing credit drop (design §3.3) — it exists only under a
     rule the owner sets (amount, claims, hour). No rule is on file,
     so there is no drop duty here, not even a switched-off one.
   - A message-burst spam watch — world "say" frames are ephemeral
     socket traffic with no durable record and no existing detector
     in the tree, so there is no honest signal to read. The flag duty
     reads the durable signal that DOES exist: members reporting a
     member (the content_reports queue itself). */

import { and, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  contentReportsTable,
  creatorProfilesTable,
  operatorActionsTable,
  CONTENT_REPORT_OPEN_STATUSES,
  type ContentReport,
  type ContentReportReason,
  type InsertContentReport,
  type InsertOperatorAction,
  type OperatorAction,
  type WorldEvent,
} from "@workspace/db";
import { logger } from "./logger";
import { THY_CHEAT_CODE_USER_ID } from "./kings-welcome";
import { dbWorldEventStore } from "./world-events";
import { announceContestWinners } from "./world-contests";
import type { PalaceAnnouncement } from "./world-room";
import type { WorldContestWinnerDto } from "./world-contests";

/* ── Constants (build-time, stated here on purpose) ─────────────────── */

/** The duties' watch interval — the king-moment scheduler's shape. */
export const OPERATOR_DUTIES_TICK_MS = 30_000;

/** A reminder sounds when a booked event starts within this lead. */
export const HOST_REMINDER_LEAD_MS = 15 * 60_000;

/** Duty announcements (reminders + contest heralds) stand at least
    this far apart palace-wide — the announce channel stays a herald,
    not a horn. */
export const DUTY_ANNOUNCE_MIN_INTERVAL_MS = 60_000;

/** The trouble-flag window: reports inside it pile up into a signal,
    and one flag per member per window is the cap. */
export const TROUBLE_FLAG_WINDOW_MS = 24 * 3600_000;

/** Distinct members who must report the same member inside the
    window before the operator files its one flag. Conservative on
    purpose: one unhappy member is a dispute, three is a pattern a
    human should see. */
export const TROUBLE_FLAG_MIN_REPORTERS = 3;

/** Tool ids on the audit trail. Deliberately NOT in the operator
    tool catalog: duties are not chat-callable tools, the executor
    never runs them, and the 'duty.' namespace keeps the admin
    readback honest about what fired on its own watch. */
export const DUTY_TOOL_IDS = {
  hostReminder: "duty.host_reminder",
  winnerHerald: "duty.winner_herald",
  troubleFlag: "duty.trouble_flag",
} as const;

const ANNOUNCE_TOOL_IDS: readonly string[] = [
  DUTY_TOOL_IDS.hostReminder,
  DUTY_TOOL_IDS.winnerHerald,
];

/** Event kinds with a real "starts at the hour" moment to remind
    about. Contests are excluded on purpose: a contest's starts_at
    is its creation (entries open at once), so there is no upcoming
    start to herald — its moment is the decision, which the winner
    herald covers. */
const REMINDABLE_EVENT_KINDS: readonly string[] = [
  "stage_show",
  "listening_party",
  "drop",
  "office_hours",
];

/* ── Switches ───────────────────────────────────────────────────────── */

function envEnabled(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/** The master switch for every duty (OPERATOR_DUTIES_ENABLED). */
export function operatorDutiesEnabled(): boolean {
  return envEnabled("OPERATOR_DUTIES_ENABLED");
}

const DUTY_ENV = {
  host_reminders: "OPERATOR_DUTY_HOST_REMINDERS_ENABLED",
  winner_heralds: "OPERATOR_DUTY_WINNER_HERALDS_ENABLED",
  trouble_flagging: "OPERATOR_DUTY_TROUBLE_FLAGGING_ENABLED",
} as const;

export type OperatorDutyName = keyof typeof DUTY_ENV;

/** One duty's switch, under the master: off at either level stills
    the duty. */
export function operatorDutyEnabled(duty: OperatorDutyName): boolean {
  return operatorDutiesEnabled() && envEnabled(DUTY_ENV[duty]);
}

/* ── The store (the house scheduler shape: injectable, db default) ──── */

export interface OperatorDutiesStore {
  /** Every event the calendar still cares about (scheduled / live /
   *  cancelled) — the world-events store's own read. */
  listOpenEvents(): Promise<WorldEvent[]>;
  hostProfile(
    userId: string,
  ): Promise<{ displayName: string; slug: string | null } | null>;
  /** Duty-trail rows at or after `since` (any duty tool, any
   *  result) — the announce cap reads this. */
  actionsSince(since: Date): Promise<OperatorAction[]>;
  /** Every trail row for one (tool, target) — dedupe reads this. */
  actionsFor(toolId: string, target: string): Promise<OperatorAction[]>;
  insertAction(row: InsertOperatorAction): Promise<void>;
  /** Content reports filed at or after `since` — the pile-up read. */
  reportsSince(since: Date): Promise<ContentReport[]>;
  /** A member's creator profile, when they have one. */
  memberProfile(
    userId: string,
  ): Promise<{ id: string; displayName: string } | null>;
  /** The reporter's one OPEN report on a target, when it stands. */
  findOpenReport(
    reporterUserId: string,
    targetType: string,
    targetId: string,
  ): Promise<ContentReport | null>;
  /** File a report; null when the one-open-report index refused a
   *  duplicate (a race the pre-check didn't see). */
  insertReport(values: InsertContentReport): Promise<ContentReport | null>;
}

export const dbOperatorDutiesStore: OperatorDutiesStore = {
  listOpenEvents: () => dbWorldEventStore.listOpenEvents(),
  hostProfile: (userId) => dbWorldEventStore.hostProfile(userId),

  async actionsSince(since) {
    return db
      .select()
      .from(operatorActionsTable)
      .where(gte(operatorActionsTable.createdAt, since));
  },

  async actionsFor(toolId, target) {
    return db
      .select()
      .from(operatorActionsTable)
      .where(
        and(
          eq(operatorActionsTable.toolId, toolId),
          eq(operatorActionsTable.target, target),
        ),
      );
  },

  async insertAction(row) {
    await db.insert(operatorActionsTable).values(row);
  },

  async reportsSince(since) {
    return db
      .select()
      .from(contentReportsTable)
      .where(gte(contentReportsTable.createdAt, since));
  },

  async memberProfile(userId) {
    const [profile] = await db
      .select({
        id: creatorProfilesTable.id,
        displayName: creatorProfilesTable.displayName,
      })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    return profile ?? null;
  },

  async findOpenReport(reporterUserId, targetType, targetId) {
    const [open] = await db
      .select()
      .from(contentReportsTable)
      .where(
        and(
          eq(contentReportsTable.reporterUserId, reporterUserId),
          eq(contentReportsTable.targetType, targetType),
          eq(contentReportsTable.targetId, targetId),
          inArray(contentReportsTable.status, [...CONTENT_REPORT_OPEN_STATUSES]),
        ),
      );
    return open ?? null;
  },

  async insertReport(values) {
    const [report] = await db
      .insert(contentReportsTable)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return report ?? null;
  },
};

/* ── The trail ──────────────────────────────────────────────────────── */

/** Write one duty row. Like Lane A's audit write: a failed write is
    logged loudly for reconciliation, never thrown into a scheduler. */
async function writeDutyAudit(
  store: OperatorDutiesStore,
  row: {
    userId: string;
    toolId: string;
    summary: string;
    target: string;
    result?: "done" | "failed";
    resultReason?: string | null;
  },
): Promise<void> {
  try {
    await store.insertAction({
      userId: row.userId,
      adminEmail: null,
      tier: 0,
      toolId: row.toolId,
      summary: row.summary,
      target: row.target,
      channel: "automatic",
      priceQuoted: null,
      priceCharged: null,
      idempotencyKey: null,
      result: row.result ?? "done",
      resultReason: row.resultReason ?? null,
    });
  } catch (err) {
    logger.error(
      { err, toolId: row.toolId, target: row.target },
      "[operator-duties] AUDIT WRITE FAILED — duty trail has a gap",
    );
  }
}

/** Read the trail for a gate, loudly, with a fallback. A broken read
    degrades that gate to "no prior firing" instead of stilling the
    palace (see the header's resilience note). */
async function trailRead<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    logger.error({ err, label }, "[operator-duties] trail read failed — gate degraded");
    return fallback;
  }
}

/** Has this (tool, target) already fired, ever? The dedupe gate. */
async function alreadyFired(
  store: OperatorDutiesStore,
  toolId: string,
  target: string,
): Promise<boolean> {
  const rows = await trailRead(
    "dedupe",
    () => store.actionsFor(toolId, target),
    [] as OperatorAction[],
  );
  return rows.some((r) => r.result === "done");
}

/** The shared palace-ear gate: true when no duty announcement has
    landed inside DUTY_ANNOUNCE_MIN_INTERVAL_MS. */
async function announceSlotOpen(
  store: OperatorDutiesStore,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - DUTY_ANNOUNCE_MIN_INTERVAL_MS);
  const rows = await trailRead(
    "announce-cap",
    () => store.actionsSince(since),
    [] as OperatorAction[],
  );
  return !rows.some(
    (r) => r.result === "done" && ANNOUNCE_TOOL_IDS.includes(r.toolId),
  );
}

/* ── Small words ────────────────────────────────────────────────────── */

/** Shrink a quoted piece to fit the palace's 140-character ear (the
    world-contests helper's shape). */
function quoted(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function roomPhrase(roomId: string): string | null {
  switch (roomId) {
    case "world:kings-hall":
      return "the King's Hall";
    case "world:music-hall":
      return "the Music Hall";
    case "world:royal-court":
      return "the Royal Court Chamber";
    default:
      return roomId.startsWith("creator:") ? "their Creator Room" : null;
  }
}

/* ── Duty 1+3: the tick (host reminders + trouble flagging) ──────────── */

export interface OperatorDutiesDeps {
  palace: { announce: (announcement: PalaceAnnouncement) => void };
  store?: OperatorDutiesStore;
}

/**
 * The peace-keeping watch. routes/world's schedulers are classes
 * for the same reason this is one: tests drive the class directly,
 * no interval ever runs under vitest. Heralds are NOT here — they
 * hang off the settlement moments themselves (below), because a
 * herald's trigger is an event, not a clock.
 */
export class OperatorDuties {
  private store: OperatorDutiesStore;
  private ticking = false;

  constructor(private deps: OperatorDutiesDeps) {
    this.store = deps.store ?? dbOperatorDutiesStore;
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date(nowMs);
      try {
        await this.runHostReminders(now);
      } catch (err) {
        logger.warn({ err }, "[operator-duties] host reminders failed");
      }
      try {
        await this.runTroubleFlagScan(now);
      } catch (err) {
        logger.warn({ err }, "[operator-duties] trouble flag scan failed");
      }
    } finally {
      this.ticking = false;
    }
  }

  /* ── Host reminders ─────────────────────────────────────────────
     A booked event inside the lead window gets ONE palace-wide
     reminder through the announce rail. Announce only: the duty
     drives no room state (the events scheduler owns the hour
     itself) and nudges nobody privately — the palace hears it,
     the host included. */
  async runHostReminders(now: Date): Promise<number> {
    if (!operatorDutyEnabled("host_reminders")) return 0;
    const events = await this.store.listOpenEvents();
    const leadEnd = now.getTime() + HOST_REMINDER_LEAD_MS;
    const candidates = events
      .filter(
        (e) =>
          e.status === "scheduled" &&
          REMINDABLE_EVENT_KINDS.includes(e.kind) &&
          new Date(e.startsAt).getTime() > now.getTime() &&
          new Date(e.startsAt).getTime() <= leadEnd,
      )
      .sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );

    let fired = 0;
    for (const event of candidates) {
      const target = `event:${event.id}`;
      if (await alreadyFired(this.store, DUTY_TOOL_IDS.hostReminder, target)) {
        continue;
      }
      /* One announcement per palace-ear interval: a second event
         in the same window waits for a later tick (the lead window
         is wide; it will still be reminded in time). */
      if (fired > 0) break;
      if (!(await announceSlotOpen(this.store, now))) break;

      const host = await this.store.hostProfile(event.hostUserId);
      const hostName = host?.displayName ?? "the host";
      const room = roomPhrase(event.roomId);
      const text = (
        room
          ? `Coming up: “${quoted(event.title, 36)}” with ${quoted(hostName, 24)} starts in ${room} in about 15 minutes.`
          : `Coming up: “${quoted(event.title, 44)}” with ${quoted(hostName, 24)} starts in about 15 minutes.`
      ).slice(0, 140);
      try {
        this.deps.palace.announce({
          kind: "show",
          text,
          roomId: event.roomId,
          ...(room ? { roomName: room } : {}),
          name: hostName,
        });
      } catch (err) {
        await writeDutyAudit(this.store, {
          userId: event.hostUserId,
          toolId: DUTY_TOOL_IDS.hostReminder,
          summary: `Reminder for “${quoted(event.title, 60)}” failed to sound`,
          target,
          result: "failed",
          resultReason: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        });
        continue;
      }
      await writeDutyAudit(this.store, {
        userId: event.hostUserId,
        toolId: DUTY_TOOL_IDS.hostReminder,
        summary: `Reminded the palace: “${quoted(event.title, 60)}” starts in about 15 minutes`,
        target,
      });
      fired += 1;
    }
    return fired;
  }

  /* ── Trouble flagging ───────────────────────────────────────────
     The durable peace signal: members reporting a member. When at
     least TROUBLE_FLAG_MIN_REPORTERS distinct members report the
     same member inside the window, the operator files ONE report
     of its own — profile target, the house as reporter, the pile's
     plurality reason — into the same queue humans work, and stops
     there. The flag touches NOTHING about the member: no mute, no
     removal, no note on their account; the queue row and the audit
     row are the whole act. */
  async runTroubleFlagScan(now: Date): Promise<number> {
    if (!operatorDutyEnabled("trouble_flagging")) return 0;
    const since = new Date(now.getTime() - TROUBLE_FLAG_WINDOW_MS);
    const reports = await this.store.reportsSince(since);

    interface Pile {
      reporters: Set<string>;
      reasons: Map<string, number>;
      counted: number;
    }
    const piles = new Map<string, Pile>();
    for (const report of reports) {
      const member = report.targetOwnerUserId;
      if (!member) continue;
      /* The operator's own flags never feed the signal, and a
         member's reports on themselves (impossible via the route)
         would not count either. */
      if (report.reporterUserId === THY_CHEAT_CODE_USER_ID) continue;
      if (report.reporterUserId === member) continue;
      let pile = piles.get(member);
      if (!pile) {
        pile = { reporters: new Set(), reasons: new Map(), counted: 0 };
        piles.set(member, pile);
      }
      pile.reporters.add(report.reporterUserId);
      pile.counted += 1;
      pile.reasons.set(
        report.reason,
        (pile.reasons.get(report.reason) ?? 0) + 1,
      );
    }

    const qualifying = [...piles.entries()]
      .filter(([, pile]) => pile.reporters.size >= TROUBLE_FLAG_MIN_REPORTERS)
      .sort((a, b) => b[1].reporters.size - a[1].reporters.size);

    let filed = 0;
    for (const [member, pile] of qualifying) {
      const target = `member:${member}`;
      /* One flag per member per window — even if a moderator works
         (and closes) the first flag fast, the duty does not pile a
         second one onto the same window's signal. */
      const prior = await trailRead(
        "flag-window",
        () => this.store.actionsFor(DUTY_TOOL_IDS.troubleFlag, target),
        [] as OperatorAction[],
      );
      if (
        prior.some(
          (r) =>
            r.result === "done" &&
            new Date(r.createdAt).getTime() >= since.getTime(),
        )
      ) {
        continue;
      }

      const profile = await this.store.memberProfile(member);
      if (!profile) continue; // no profile to point the queue at

      const open = await this.store.findOpenReport(
        THY_CHEAT_CODE_USER_ID,
        "profile",
        profile.id,
      );
      if (open) continue; // the operator's flag already stands open

      const reason = [...pile.reasons.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]![0] as ContentReportReason;
      const inserted = await this.store.insertReport({
        reporterUserId: THY_CHEAT_CODE_USER_ID,
        targetType: "profile",
        targetId: profile.id,
        targetOwnerUserId: member,
        targetSummary: profile.displayName,
        reason,
        note:
          `Operator flag: ${pile.reporters.size} members reported this member ` +
          `in the last 24 hours. Filed for a human moderator — no automatic action was taken.`,
      });
      if (!inserted) continue; // the one-open index held; a flag stands

      await writeDutyAudit(this.store, {
        userId: THY_CHEAT_CODE_USER_ID,
        toolId: DUTY_TOOL_IDS.troubleFlag,
        summary:
          `Flagged a member for the moderators: ${pile.reporters.size} members reported them in 24 hours`,
        target,
      });
      filed += 1;
    }
    return filed;
  }
}

/* ── Duty 2a: the contest winner herald ───────────────────────────────
   Hooked at the ONE place winners land (the contests route, after
   the decision rows are written): the settlement already decided —
   the host named them; this duty only sounds the announcement the
   route has always made, now under the duty's switch, its dedupe,
   the shared palace-ear cap, and the audit trail. The Winners'
   Circle rows remain the durable record; an unspoken herald (switch
   off, cap, palace unwired) loses nothing but the moment.

   Returns true when the line was spoken. */
export async function heraldContestWinners(input: {
  contest: Pick<WorldEvent, "id" | "hostUserId" | "title">;
  winners: readonly WorldContestWinnerDto[];
  announcement: PalaceAnnouncement;
  store?: OperatorDutiesStore;
}): Promise<boolean> {
  if (!operatorDutyEnabled("winner_heralds")) return false;
  const store = input.store ?? dbOperatorDutiesStore;
  const first = [...input.winners].sort((a, b) => a.place - b.place)[0];
  if (!first) return false;
  const target = `contest:${input.contest.id}`;
  if (await alreadyFired(store, DUTY_TOOL_IDS.winnerHerald, target)) {
    return false;
  }
  if (!(await announceSlotOpen(store, new Date()))) return false;

  const spoken = announceContestWinners(input.announcement);
  if (!spoken) return false; // palace unwired — the Circle is the record

  await writeDutyAudit(store, {
    userId: input.contest.hostUserId,
    toolId: DUTY_TOOL_IDS.winnerHerald,
    summary:
      `Heralded the winners of “${quoted(input.contest.title, 60)}” — ` +
      `${first.winnerName} takes first`,
    target,
  });
  return true;
}

/* ── Duty 2b: the Court Season herald gate ────────────────────────────
   Hooked into CourtSeasonScheduler through its heraldGate dep (the
   scheduler still settles exactly as before — this gate is asked
   only about the SOUND). The settlement row is the once-only record;
   the gate adds the duty switch, a trail dedupe behind it, and the
   audit row. Its cap is the once-ever settlement itself, so the
   shared announce interval does not apply (see the header).

   Returns true when the herald may sound. */
export async function gateCourtSeasonHerald(input: {
  season: { seasonKey: string; name: string };
  outcome: { standings: readonly { displayName: string }[] };
  store?: OperatorDutiesStore;
}): Promise<boolean> {
  if (!operatorDutyEnabled("winner_heralds")) return false;
  const store = input.store ?? dbOperatorDutiesStore;
  const target = `season:${input.season.seasonKey}`;
  if (await alreadyFired(store, DUTY_TOOL_IDS.winnerHerald, target)) {
    return false;
  }
  const champion = input.outcome.standings[0];
  await writeDutyAudit(store, {
    userId: THY_CHEAT_CODE_USER_ID,
    toolId: DUTY_TOOL_IDS.winnerHerald,
    summary: champion
      ? `Heralded the Court: ${input.season.name} settled — ${champion.displayName} leads the court`
      : `Heralded the Court: ${input.season.name} settled`,
    target,
  });
  return true;
}

/* ── The starter (index.ts, beside the other scheduler starts) ──────── */

/**
 * Start the duties' watch: one interval, first tick immediate (the
 * house scheduler shape — a restart mid-window repairs from the
 * trail instead of double-firing). Tests drive OperatorDuties
 * directly, so no interval ever runs under vitest.
 */
export function startOperatorDuties(palace: {
  announce: (announcement: PalaceAnnouncement) => void;
}): { stop: () => void } {
  const duties = new OperatorDuties({ palace });
  const run = () => {
    void duties.tick().catch((err) => {
      logger.warn({ err }, "[operator-duties] tick failed");
    });
  };
  run();
  const timer = setInterval(run, OPERATOR_DUTIES_TICK_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
