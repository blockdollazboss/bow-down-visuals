/**
 * world-events.ts — The palace calendar: World Events (Ring 2 items
 * 3.1 / 3.2 / 3.4, migration 0145, table world_events).
 *
 * Three booked things HAPPEN in the palace on a schedule:
 *  - stage_show (3.1): a Throne Hall slot. At the hour the hall's
 *    screen takes the booked content — a catalog video plays as a
 *    synced watch party through the existing screen machinery, or
 *    "live": the stage opens for the host, whose own stage.live claim
 *    puts their stream on the screen. Slot end releases the stage
 *    and returns the screen to the King's Reel, overrun included.
 *  - listening_party (3.2): a Music Hall slot. The jukebox takes the
 *    party's queue (track ids, in order) under the host's name; the
 *    room hears it in sync off the existing anchor. Party end
 *    returns the jukebox to open queueing.
 *  - drop (3.4): a drop spectacle. At the hour a claimable drop lands
 *    IN its room: a room-scoped herald frame (see the note in
 *    world-room.ts — deliberately shaped for the Ring 3 palace-wide
 *    announce channel to adopt), a chest in the room, and first-come
 *    claims by the members standing there, paid through the existing
 *    drop rails under the combined ≤1,000 VB/week drop budget
 *    (lib/stream-drops) — no new issuance, no new budget.
 *  - office_hours (3.7, migration 0159): a creator holds court in
 *    their OWN creator room. Nothing takes the room over at the
 *    hour — there is no screen to seize and no queue to own; the
 *    session is the room standing open under its host's name. The
 *    tick's whole job is the honest status flip (scheduled → live
 *    → done); the calendar and the room's own marker read the row.
 *
 * BOOKING RULES (owner-approved defaults, enforced server-side at
 * POST /api/world/events — the route calls the helpers here):
 *  - stage_show: Throne Hall only; bookable ONLY by Front Row members
 *    + admin. "Front Row" standing is server truth, never a claim:
 *    the member's creator profile holds a seat in the KING'S royal
 *    court (royal_court rows owned by the official profile,
 *    is_official / slug "thy-cheat-code") — the same court the hall's
 *    stage honors read. Admin is the house ADMIN_EMAILS test.
 *  - listening_party: Music Hall only; any signed-in member.
 *  - drop: any palace room; admin only (a spectacle is a house
 *    moment, and its VB comes out of the shared weekly drop budget).
 *  - office_hours: the host's OWN creator room only — room_id must
 *    be "creator:<the caller's own slug>", read off their creator
 *    profile server-side (never a claim), and the profile must be
 *    public: a private profile's room isn't open, so it can't hold
 *    hours either. Any signed-in member with an open room.
 * Guests never book: booking is an authed REST route, full stop.
 *
 * THE TICK: a single cheap interval (startWorldEventScheduler in
 * routes/world.ts) polls the open events (one indexed select), starts
 * what's due, ends what's over, repairs room state a restart or an
 * emptied room lost, and keeps the palace directory's per-room slate
 * ("tonight at the palace") fresh. All room state changes ride the
 * rooms' own broadcasts, so late joiners land on the live truth via
 * the welcome's screen/jukebox/drop snapshots.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  worldEventsTable,
  creatorProfilesTable,
  royalCourtTable,
  sharkDropsTable,
  type WorldEvent as WorldEventRow,
  type WorldEventKind,
  type WorldEventStatus,
} from "@workspace/db";
import { WORLD_ROOM_ID, type WorldJukeboxTrackRef, type WorldScreenVideoRef } from "./world-room";
import type { WorldPalace, PalaceDirectoryEvent } from "./world-palace";
import { combinedDropWeekSpendVb, STREAM_DROP_WEEKLY_CAP_VB } from "./stream-drops";
import { currentWeekStart } from "./retention";
import { addCreditsAtomic } from "./supabase-admin";
import { logger } from "./logger";

export const MUSIC_HALL_ROOM_ID = "world:music-hall";

/** A contest's theme is a headline, not a speech — the same cap
 *  the palace herald carries (lib/world-palace HERALD_MAX_CHARS). */
export const CONTEST_THEME_MAX_CHARS = 140;

/** How often the scheduler looks at the calendar. One indexed select
 *  per tick against a small, ephemeral table — deliberately cheap. */
export const WORLD_EVENT_TICK_MS = 10_000;

/* ── Booking rules ────────────────────────────────────────────────── */

export type BookingPrivilege = "member" | "front-row-or-admin" | "admin";

export interface BookingRule {
  /** The one room this kind may be booked into (null = any palace room). */
  requiredRoomId: string | null;
  privilege: BookingPrivilege;
  /** Which rooms the kind may anchor to: the fixed palace rooms, or
   *  the host's own creator room ("creator:<their slug>"). */
  roomKind: "palace" | "own-creator-room";
}

export function bookingRuleFor(kind: WorldEventKind): BookingRule {
  switch (kind) {
    case "stage_show":
      return { requiredRoomId: WORLD_ROOM_ID, privilege: "front-row-or-admin", roomKind: "palace" };
    case "listening_party":
      return { requiredRoomId: MUSIC_HALL_ROOM_ID, privilege: "member", roomKind: "palace" };
    case "drop":
      return { requiredRoomId: null, privilege: "admin", roomKind: "palace" };
    case "contest":
      /* Contests are booked through the contests route (routes/
       * world-contests), which applies the per-stage rule (Throne
       * Hall: Front Row + house; Music Hall: any member). The
       * generic events route never accepts this kind (its zod enum
       * is closed); this row exists so the switch stays exhaustive,
       * pinned admin-only as a belt-and-braces default. */
      return { requiredRoomId: null, privilege: "admin", roomKind: "palace" };
    case "office_hours":
      return { requiredRoomId: null, privilege: "member", roomKind: "own-creator-room" };
  }
}

/* ── Payload validation (the route's shapes, shared with tests) ───── */

const CATALOG_VIDEO_ID = /^(video|replay):[0-9a-f-]{36}$/i;
const CATALOG_TRACK_ID = /^track:[0-9a-f-]{36}$/i;

export type PayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/** Validate + sanitize a booking payload for its kind. Unknown keys
 *  are dropped — the payload that reaches the row is exactly the
 *  shape the scheduler knows how to run. */
export function sanitizeEventPayload(kind: WorldEventKind, raw: unknown): PayloadResult {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (kind === "stage_show") {
    const ref = typeof p["contentRef"] === "string" ? p["contentRef"].trim() : "";
    if (ref !== "live" && !CATALOG_VIDEO_ID.test(ref)) {
      return {
        ok: false,
        error: "A stage show needs a screen content ref: a catalog video id or 'live'.",
      };
    }
    return { ok: true, payload: { contentRef: ref } };
  }
  if (kind === "listening_party") {
    const ids = Array.isArray(p["trackIds"]) ? p["trackIds"] : [];
    const trackIds = ids.filter(
      (t): t is string => typeof t === "string" && CATALOG_TRACK_ID.test(t),
    );
    if (trackIds.length === 0 || trackIds.length !== ids.length) {
      return {
        ok: false,
        error: "A listening party needs a queue of catalog track ids (track:<id>), in order.",
      };
    }
    if (trackIds.length > 20) {
      return { ok: false, error: "A listening party queue holds at most 20 tracks." };
    }
    const playlistId =
      typeof p["playlistId"] === "string" && p["playlistId"].trim()
        ? p["playlistId"].trim().slice(0, 96)
        : null;
    return { ok: true, payload: { trackIds, playlistId } };
  }
  if (kind === "contest") {
    const theme = typeof p["theme"] === "string" ? p["theme"].trim() : "";
    if (!theme) {
      return { ok: false, error: "A contest needs a theme — the one line entrants create under." };
    }
    if (theme.length > CONTEST_THEME_MAX_CHARS) {
      return {
        ok: false,
        error: `A contest theme is at most ${CONTEST_THEME_MAX_CHARS} characters.`,
      };
    }
    return { ok: true, payload: { theme } };
  }
  if (kind === "office_hours") {
    /* The agenda line is the whole payload: optional, trimmed, and
     * capped to a line — anything else sent along is dropped. */
    const note = typeof p["note"] === "string" ? p["note"].trim().slice(0, 140) : "";
    return { ok: true, payload: note ? { note } : {} };
  }
  // drop
  const amountVb = p["amountVb"];
  const claimCap = p["claimCap"];
  if (
    typeof amountVb !== "number" ||
    !Number.isInteger(amountVb) ||
    amountVb < 100 ||
    amountVb > STREAM_DROP_WEEKLY_CAP_VB
  ) {
    return {
      ok: false,
      error: `A drop pays between 100 and ${STREAM_DROP_WEEKLY_CAP_VB} Visual Bucs per claim.`,
    };
  }
  if (typeof claimCap !== "number" || !Number.isInteger(claimCap) || claimCap < 1 || claimCap > 30) {
    return { ok: false, error: "A drop's claim cap is between 1 and 30 claims." };
  }
  return { ok: true, payload: { amountVb, claimCap } };
}

/** Booking window rules: a real slot, not a monument or a blink. */
export const EVENT_MIN_DURATION_MS = 5 * 60_000;
export const EVENT_MAX_DURATION_MS = 4 * 3600_000;
export const EVENT_MAX_AHEAD_MS = 30 * 24 * 3600_000;

export function windowError(startsAt: Date, endsAt: Date, now: Date): string | null {
  if (!(endsAt.getTime() > startsAt.getTime())) return "The event must end after it starts.";
  const dur = endsAt.getTime() - startsAt.getTime();
  if (dur < EVENT_MIN_DURATION_MS) return "An event slot is at least 5 minutes.";
  if (dur > EVENT_MAX_DURATION_MS) return "An event slot is at most 4 hours.";
  if (startsAt.getTime() < now.getTime() - EVENT_MIN_DURATION_MS) {
    return "That start time is already past.";
  }
  if (startsAt.getTime() > now.getTime() + EVENT_MAX_AHEAD_MS) {
    return "Events can be booked at most 30 days ahead.";
  }
  return null;
}

/** Half-open overlap: [aStart, aEnd) meets [bStart, bEnd). Back-to-back
 *  slots (one ends exactly when the next begins) do NOT conflict. */
export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/* ── Front Row standing (server truth) ────────────────────────────── */

type SelectReader = Pick<typeof db, "select">;

/**
 * Is this user in the Front Row? The palace's Front Row is the KING'S
 * court: the official house profile (is_official, slug
 * "thy-cheat-code") crowns up to 8 creators into royal_court, and
 * those seats are the standing the Throne Hall stage honors read.
 * A user holds Front Row standing when THEIR creator profile holds
 * one of those seats. No profile, no official profile, or no seat —
 * no standing. (Their OWN court is their profile's business; it
 * confers nothing here.)
 */
export async function isKingFrontRowMember(
  userId: string,
  reader: SelectReader = db,
): Promise<boolean> {
  const [profile] = await reader
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  if (!profile) return false;
  const [king] = await reader
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.isOfficial, true))
    .limit(1);
  if (!king) return false;
  const [seat] = await reader
    .select({ id: royalCourtTable.id })
    .from(royalCourtTable)
    .where(
      and(
        eq(royalCourtTable.ownerProfileId, king.id),
        eq(royalCourtTable.memberProfileId, profile.id),
      ),
    )
    .limit(1);
  return !!seat;
}

/* ── DTO ──────────────────────────────────────────────────────────── */

export interface WorldEventDto {
  id: string;
  kind: WorldEventKind;
  roomId: string;
  hostUserId: string;
  hostName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  payload: Record<string, unknown>;
  status: WorldEventStatus;
  createdAt: string;
}

export function toWorldEventDto(row: WorldEventRow, hostName: string): WorldEventDto {
  return {
    id: row.id,
    kind: row.kind as WorldEventKind,
    roomId: row.roomId,
    hostUserId: row.hostUserId,
    hostName,
    title: row.title,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as WorldEventStatus,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/* ── Drop spectacle claims — the existing drop rails ──────────────── */

/**
 * Pay one spectacle claim through the EXISTING drop rails: the amount
 * counts against the combined weekly drop spend (stream awards +
 * regular shark-drop claims, lib/stream-drops) under the same
 * ≤1,000 VB/week envelope, the grant rides addCreditsAtomic, and the
 * claim lands in shark_drops as an already-claimed ledger row — the
 * exact pattern stream drops use, so the drop system's own accounting
 * sees every spectacle VB. No new issuance, no parallel budget. The
 * cap is advisory at this seam (checked, then granted — the room
 * serializes claims per spectacle, and the envelope is re-read on
 * every claim).
 */
export async function claimSpectacleDrop(
  userId: string,
  amountVb: number,
  _eventId: string,
): Promise<{ ok: true } | { ok: false; reason: "budget" | "error" }> {
  try {
    const spent = await combinedDropWeekSpendVb(currentWeekStart());
    if (spent + amountVb > STREAM_DROP_WEEKLY_CAP_VB) {
      return { ok: false, reason: "budget" };
    }
    await addCreditsAtomic(userId, amountVb);
    await db
      .insert(sharkDropsTable)
      .values({
        userId,
        amount: amountVb,
        droppedAt: new Date(),
        claimedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 3600_000),
      })
      .catch((err) =>
        logger.warn({ err, userId }, "[world-events] drop ledger row failed (claim already paid)"),
      );
    return { ok: true };
  } catch (err) {
    logger.error({ err, userId }, "[world-events] spectacle drop claim failed");
    return { ok: false, reason: "error" };
  }
}

/* ── The scheduler ────────────────────────────────────────────────── */

export interface WorldEventStore {
  /** Every event the tick still cares about: scheduled, live, and
   *  cancelled (a cancelled LIVE event still needs its room state
   *  released; the tick's room-end calls are idempotent). */
  listOpenEvents(): Promise<WorldEventRow[]>;
  setStatus(id: string, status: WorldEventStatus): Promise<void>;
  hostProfile(
    userId: string,
  ): Promise<{ displayName: string; slug: string | null } | null>;
}

export const dbWorldEventStore: WorldEventStore = {
  async listOpenEvents() {
    return db
      .select()
      .from(worldEventsTable)
      .where(inArray(worldEventsTable.status, ["scheduled", "live", "cancelled"]));
  },
  async setStatus(id, status) {
    await db.update(worldEventsTable).set({ status }).where(eq(worldEventsTable.id, id));
  },
  async hostProfile(userId) {
    const [profile] = await db
      .select({
        displayName: creatorProfilesTable.displayName,
        slug: creatorProfilesTable.slug,
      })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    return profile ?? null;
  },
};

export interface WorldEventSchedulerDeps {
  palace: WorldPalace;
  store?: WorldEventStore;
  /** The route layer's verified resolvers (id-only, exactly as the
   *  stage/jukebox claims use): a booked ref becomes playable state
   *  only when it still verifies for the host at showtime. */
  resolveScreenVideo: (
    userId: string,
    videoId: string,
  ) => Promise<WorldScreenVideoRef | null>;
  resolveJukeboxTrack: (
    userId: string,
    trackId: string,
  ) => Promise<WorldJukeboxTrackRef | null>;
}

/** The directory slate never carries more than this per room. */
export const SLATE_PER_ROOM = 3;

export class WorldEventScheduler {
  private store: WorldEventStore;
  private ticking = false;
  private lastSlateJson = "";

  constructor(private deps: WorldEventSchedulerDeps) {
    this.store = deps.store ?? dbWorldEventStore;
    /* A host ending their own show early (the existing stage.end)
     * ends the EVENT too — the room reports it, the row follows. */
    const hall = this.deps.palace.room(WORLD_ROOM_ID);
    if (hall) {
      hall.onScheduledShowEnded = (eventId) => {
        void this.store
          .setStatus(eventId, "done")
          .catch((err) => logger.warn({ err, eventId }, "[world-events] early-end write failed"));
      };
    }
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const rows = await this.store.listOpenEvents();
      const now = new Date(nowMs);
      await this.refreshSlate(rows, now);
      for (const row of rows) {
        try {
          await this.tickEvent(row, now, nowMs);
        } catch (err) {
          logger.warn({ err, eventId: row.id }, "[world-events] tick failed for one event");
        }
      }
      /* Refresh again with the tick's transitions applied to the
       * working copies (tickEvent keeps row.status in step with the
       * store), so a show that just went live reads LIVE on the
       * slate in the same tick it started. */
      await this.refreshSlate(rows, now);
    } finally {
      this.ticking = false;
    }
  }

  /** Tonight's slate for the palace directory: per room, the live
   *  event first, then what's next — data only; Lane K's board block
   *  renders it. Replaces the palace's copy only when it changed. */
  private async refreshSlate(rows: WorldEventRow[], now: Date): Promise<void> {
    const byRoom = new Map<string, PalaceDirectoryEvent[]>();
    const upcoming = rows
      .filter(
        (r) =>
          (r.status === "scheduled" || r.status === "live") &&
          new Date(r.endsAt).getTime() > now.getTime(),
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const hostNames = new Map<string, string>();
    for (const row of upcoming) {
      const list = byRoom.get(row.roomId) ?? [];
      if (list.length >= SLATE_PER_ROOM) continue;
      if (!hostNames.has(row.hostUserId)) {
        const profile = await this.store.hostProfile(row.hostUserId).catch(() => null);
        hostNames.set(row.hostUserId, profile?.displayName ?? "Creator");
      }
      list.push({
        id: row.id,
        kind: row.kind as WorldEventKind,
        title: row.title,
        hostName: hostNames.get(row.hostUserId)!,
        startsAt: new Date(row.startsAt).toISOString(),
        endsAt: new Date(row.endsAt).toISOString(),
        status: row.status as "scheduled" | "live",
      });
      byRoom.set(row.roomId, list);
    }
    const json = JSON.stringify([...byRoom.entries()]);
    if (json !== this.lastSlateJson) {
      this.lastSlateJson = json;
      this.deps.palace.setDirectoryEvents(byRoom);
    }
  }

  private async tickEvent(row: WorldEventRow, now: Date, nowMs: number): Promise<void> {
    const startsAt = new Date(row.startsAt);
    const endsAt = new Date(row.endsAt);
    const palace = this.deps.palace;

    if (row.status === "cancelled") {
      /* A cancelled live event releases its room state; these calls
       * are no-ops when the room never took (or already released) it. */
      this.endInRoom(row);
      return;
    }

    if (row.status === "scheduled") {
      if (endsAt.getTime() <= now.getTime()) {
        /* The slot came and went with nobody able to start it (a
         * restart ate it, the content stopped verifying). Honest
         * end: done, never shown as live. */
        await this.store.setStatus(row.id, "done");
        row.status = "done";
        return;
      }
      if (startsAt.getTime() > now.getTime()) return; // not yet
      const started = await this.startInRoom(row, nowMs);
      if (started) {
        await this.store.setStatus(row.id, "live");
        row.status = "live";
      }
      return;
    }

    // live
    if (endsAt.getTime() <= now.getTime()) {
      this.endInRoom(row);
      await this.store.setStatus(row.id, "done");
      row.status = "done";
      return;
    }
    /* Still live: make sure the room still carries it. A restart, an
     * emptied Music Hall (its jukebox resets), or a dropped stage
     * can lose room state while the row stays live — re-drive the
     * start; the room calls refuse when the state is already theirs
     * or genuinely blocked (a walk-in show on the stage), in which
     * case the next tick tries again. */
    if (!this.roomCarries(row)) {
      await this.startInRoom(row, nowMs);
    }
  }

  private roomCarries(row: WorldEventRow): boolean {
    const palace = this.deps.palace;
    if (row.kind === "stage_show") {
      return palace.room(WORLD_ROOM_ID)?.scheduledShowEventId() === row.id;
    }
    if (row.kind === "listening_party") {
      return palace.room(MUSIC_HALL_ROOM_ID)?.listeningPartyEventId() === row.id;
    }
    if (row.kind === "contest" || row.kind === "office_hours") {
      /* Neither carries room state: a contest lives on the room's
       * board (nothing in the room plays it), and an office-hours
       * row IS the session. Always "carried", so a live row of
       * either kind is never re-driven. */
      return true;
    }
    return palace.room(row.roomId)?.activeDropEventId() === row.id;
  }

  private endInRoom(row: WorldEventRow): void {
    const palace = this.deps.palace;
    if (row.kind === "stage_show") {
      palace.room(WORLD_ROOM_ID)?.endScheduledShow(row.id, "The show has ended.");
    } else if (row.kind === "listening_party") {
      palace.room(MUSIC_HALL_ROOM_ID)?.endListeningParty(row.id);
    } else if (row.kind === "contest" || row.kind === "office_hours") {
      /* Nothing to release: neither kind ever took room state. */
      return;
    } else {
      palace.room(row.roomId)?.endDrop(row.id);
    }
  }

  private async startInRoom(row: WorldEventRow, nowMs: number): Promise<boolean> {
    const palace = this.deps.palace;
    if (row.kind === "contest") {
      /* The entry window opening IS the start — no screen, no
       * jukebox, no drop to drive. The status flip this returns
       * true for is the whole ceremony; judging belongs to the
       * host through the contests route, after the deadline. */
      return true;
    }
    const profile = await this.store.hostProfile(row.hostUserId).catch(() => null);
    const hostName = profile?.displayName ?? "Creator";
    const hostSlug = profile?.slug ?? null;
    const payload = (row.payload ?? {}) as Record<string, unknown>;

    if (row.kind === "stage_show") {
      const hall = palace.room(WORLD_ROOM_ID);
      if (!hall) return false;
      const ref = typeof payload["contentRef"] === "string" ? payload["contentRef"] : "";
      if (ref === "live") {
        /* The stage opens for the host; the screen stays on the Reel
         * until the host's own stage.live claim lands their stream
         * (the room recognizes the scheduled host as the holder). */
        return hall.beginScheduledShow({
          eventId: row.id,
          hostUserId: row.hostUserId,
          hostName,
          hostSlug,
          title: row.title,
          content: { kind: "reel" },
        });
      }
      if (!ref) return false;
      const video = await this.deps.resolveScreenVideo(row.hostUserId, ref).catch(() => null);
      if (!video) return false; // stopped verifying — retry until the slot ends
      return hall.beginScheduledShow({
        eventId: row.id,
        hostUserId: row.hostUserId,
        hostName,
        hostSlug,
        title: row.title,
        content: {
          kind: "video",
          video,
          playback: { playing: true, anchorPosSec: 0, anchorAtMs: nowMs },
        },
      });
    }

    if (row.kind === "listening_party") {
      const music = palace.room(MUSIC_HALL_ROOM_ID);
      if (!music) return false;
      const ids = Array.isArray(payload["trackIds"])
        ? (payload["trackIds"] as unknown[]).filter(
            (t): t is string => typeof t === "string",
          )
        : [];
      const tracks: WorldJukeboxTrackRef[] = [];
      for (const id of ids) {
        const track = await this.deps.resolveJukeboxTrack(row.hostUserId, id).catch(() => null);
        if (track) tracks.push(track);
      }
      if (tracks.length === 0) return false; // nothing playable — retry until the slot ends
      return music.beginListeningParty({
        eventId: row.id,
        hostUserId: row.hostUserId,
        hostName,
        title: row.title,
        tracks,
        now: nowMs,
      });
    }

    if (row.kind === "office_hours") {
      /* The session opens by existing: the status flip the caller
       * applies on `true` is the whole effect. No screen is seized,
       * no queue is owned, nobody's room state is touched — the
       * host's room simply stands open for its hours, and the
       * calendar + the room's marker read the live row. */
      return true;
    }

    // drop
    const room = palace.room(row.roomId);
    if (!room) return false;
    const amountVb = typeof payload["amountVb"] === "number" ? payload["amountVb"] : 0;
    const claimCap = typeof payload["claimCap"] === "number" ? payload["claimCap"] : 0;
    if (!(amountVb > 0) || !(claimCap > 0)) return false;
    return room.landDrop({ eventId: row.id, title: row.title, amountVb, claimCap });
  }
}
