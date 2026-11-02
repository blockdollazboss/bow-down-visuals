/**
 * court-gathering — the pure seam pins for the Royal Court
 * gathering door (UPGRADE-PROGRAM 3.6, stack1300).
 *
 * The builder mirrors the server's booking rules exactly (title
 * ≤ 120; a slot is 5 minutes – 4 hours, at most ~5 minutes in the
 * past, at most 30 days ahead) and shapes the payload the way the
 * server sanitizes it (the occasion line trimmed, capped to 140,
 * omitted when empty — and nothing else: who is honored is never
 * payload). The refusal map keeps the booking-rule refusals in the
 * catalog's canonical words and every other server answer in the
 * server's own words. The slate fold is strict — a malformed
 * answer is a FAILED read (null), never a painted-empty list.
 */
import { describe, expect, it } from "vitest";
import {
  buildCourtGatheringBody,
  courtGatheringError,
  normalizeMyGatherings,
  parseChamberGatherings,
  COURT_ROOM_ID,
} from "./court-gathering";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const HOUR = 3600_000;

const draft = (over: Partial<Parameters<typeof buildCourtGatheringBody>[0]> = {}) => ({
  title: "The Week's Honors",
  note: "",
  startsAtMs: NOW + 2 * HOUR,
  durationMin: 60,
  ...over,
});

describe("court-gathering — the request builder mirrors the rail", () => {
  it("books a royal_court gathering into the Chamber, and only there", () => {
    const built = buildCourtGatheringBody(draft(), NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body.kind).toBe("royal_court");
    expect(built.body.roomId).toBe("world:royal-court");
    expect(built.body.roomId).toBe(COURT_ROOM_ID);
    expect(built.body.startsAt).toBe(new Date(NOW + 2 * HOUR).toISOString());
    expect(built.body.endsAt).toBe(new Date(NOW + 3 * HOUR).toISOString());
    expect(built.body.payload).toEqual({});
  });

  it("the occasion line rides trimmed and capped, exactly as the server sanitizes it", () => {
    const withNote = buildCourtGatheringBody(draft({ note: "  Honors night.  " }), NOW);
    expect(withNote.ok && withNote.body.payload).toEqual({ note: "Honors night." });
    const long = buildCourtGatheringBody(draft({ note: "x".repeat(300) }), NOW);
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.body.payload.note).toHaveLength(140);
    const blank = buildCourtGatheringBody(draft({ note: "   " }), NOW);
    expect(blank.ok && blank.body.payload).toEqual({});
  });

  it("title rules: required, and 120 at most", () => {
    expect(buildCourtGatheringBody(draft({ title: "  " }), NOW)).toEqual({ ok: false, error: "titleRequired" });
    expect(buildCourtGatheringBody(draft({ title: "x".repeat(121) }), NOW)).toEqual({ ok: false, error: "titleTooLong" });
    expect(buildCourtGatheringBody(draft({ title: "x".repeat(120) }), NOW).ok).toBe(true);
  });

  it("window rules: 5 minutes – 4 hours, ~5 minutes of past grace, 30 days ahead", () => {
    expect(buildCourtGatheringBody(draft({ durationMin: 4 }), NOW)).toEqual({ ok: false, error: "durationTooShort" });
    expect(buildCourtGatheringBody(draft({ durationMin: 241 }), NOW)).toEqual({ ok: false, error: "durationTooLong" });
    expect(buildCourtGatheringBody(draft({ startsAtMs: Number.NaN }), NOW)).toEqual({ ok: false, error: "startRequired" });
    expect(buildCourtGatheringBody(draft({ startsAtMs: NOW - 6 * 60_000 }), NOW)).toEqual({ ok: false, error: "startPast" });
    expect(buildCourtGatheringBody(draft({ startsAtMs: NOW - 4 * 60_000 }), NOW).ok).toBe(true);
    expect(buildCourtGatheringBody(draft({ startsAtMs: NOW + 31 * 24 * HOUR }), NOW)).toEqual({ ok: false, error: "startTooFar" });
  });
});

describe("court-gathering — server answers in the panel's words", () => {
  it("the house refusal and the taken slot resolve to the catalog's canonical keys", () => {
    expect(courtGatheringError(403, { error: "ADMIN_REQUIRED", message: "Court gatherings are called by the house." })).toEqual({
      kind: "key",
      key: "refusedHouse",
    });
    expect(courtGatheringError(409, { error: "SLOT_TAKEN", message: "…" })).toEqual({ kind: "key", key: "slotTaken" });
    expect(courtGatheringError(400, { error: "ROOM_MISMATCH", message: "…" })).toEqual({ kind: "key", key: "notBookable" });
  });

  it("any other server answer keeps the server's own words verbatim", () => {
    expect(courtGatheringError(400, { error: "INVALID_WINDOW", message: "An event slot is at most 4 hours." })).toEqual({
      kind: "message",
      message: "An event slot is at most 4 hours.",
    });
  });

  it("bare statuses fall back honestly", () => {
    expect(courtGatheringError(401, null)).toEqual({ kind: "key", key: "signIn" });
    expect(courtGatheringError(403, null)).toEqual({ kind: "key", key: "notBookable" });
    expect(courtGatheringError(500, null)).toEqual({ kind: "key", key: "failed" });
  });
});

const slateRow = (over: Record<string, unknown> = {}) => ({
  id: "evt-1",
  kind: "royal_court",
  roomId: "world:royal-court",
  hostUserId: "user-host",
  hostName: "The House",
  title: "The Week's Honors",
  startsAt: new Date(NOW + HOUR).toISOString(),
  endsAt: new Date(NOW + 2 * HOUR).toISOString(),
  payload: { note: "Honors night." },
  status: "scheduled",
  createdAt: new Date(NOW).toISOString(),
  ...over,
});

describe("court-gathering — the Chamber slate fold", () => {
  it("keeps this room + this kind, still on the calendar, soonest first", () => {
    const later = slateRow({ id: "evt-2", startsAt: new Date(NOW + 3 * HOUR).toISOString(), endsAt: new Date(NOW + 4 * HOUR).toISOString() });
    const out = parseChamberGatherings(
      {
        events: [
          later,
          slateRow(),
          slateRow({ id: "evt-3", kind: "stage_show" }),
          slateRow({ id: "evt-4", roomId: "world:kings-hall" }),
          slateRow({ id: "evt-5", status: "done" }),
          slateRow({ id: "evt-6", endsAt: new Date(NOW - HOUR).toISOString() }),
        ],
      },
      NOW,
    );
    expect(out?.map((g) => g.id)).toEqual(["evt-1", "evt-2"]);
    expect(out?.[0]).toMatchObject({ hostName: "The House", note: "Honors night.", status: "scheduled" });
  });

  it("a live gathering reads live; a note-less one carries null, not a made-up line", () => {
    const out = parseChamberGatherings({ events: [slateRow({ status: "live", payload: {} })] }, NOW);
    expect(out?.[0]?.status).toBe("live");
    expect(out?.[0]?.note).toBeNull();
  });

  it("STRICT: a malformed answer is a failed read (null), never a painted-empty list", () => {
    expect(parseChamberGatherings(null, NOW)).toBeNull();
    expect(parseChamberGatherings("nope", NOW)).toBeNull();
    expect(parseChamberGatherings({}, NOW)).toBeNull();
    expect(parseChamberGatherings({ events: "nope" }, NOW)).toBeNull();
    expect(parseChamberGatherings({ events: [] }, NOW)).toEqual([]);
  });
});

describe("court-gathering — mine", () => {
  it("normalizes only the caller's upcoming court gatherings", () => {
    const out = normalizeMyGatherings(
      {
        events: [
          slateRow(),
          slateRow({ id: "evt-9", kind: "drop", roomId: "world:courtyard" }),
          slateRow({ id: "evt-8", status: "cancelled" }),
          slateRow({ id: "evt-7", endsAt: new Date(NOW - HOUR).toISOString() }),
        ],
      },
      NOW,
    );
    expect(out.map((g) => g.id)).toEqual(["evt-1"]);
    expect(normalizeMyGatherings(null, NOW)).toEqual([]);
    expect(normalizeMyGatherings({ events: "nope" }, NOW)).toEqual([]);
  });
});
