/**
 * stage-booking.test.ts — the Throne Hall stage-show booking seam
 * (UPGRADE-PROGRAM 3.1, stack1300).
 *
 * Pins: the screen-catalog fold (only playable catalog ids are
 * offered), the request builder's mirror of the server's rules
 * (window, duration, content ref), the "mine" normalizer, and —
 * the booking-rule gate — the refusal map: a booking answer of
 * FRONT_ROW_REQUIRED resolves to the catalog's refusal words, so a
 * member who holds no Front Row seat is told the rule by the form
 * itself. (The server's own refusal is proven on the rail by
 * routes/__tests__/world-events.test.ts; this seam is what carries
 * that refusal to the member's eyes.)
 */
import { describe, expect, it } from "vitest";
import {
  buildStageShowBody,
  normalizeMyShows,
  parseScreenCatalog,
  stageBookingError,
  stageContentRef,
  STAGE_ROOM_ID,
  type StageContentItem,
} from "./stage-booking";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const HOUR = 3600_000;
const VIDEO_ID = "video:123e4567-e89b-12d3-a456-426614174000";
const REPLAY_ID = "replay:123e4567-e89b-12d3-a456-426614174001";

const item = (over: Partial<StageContentItem> = {}): StageContentItem => ({
  id: VIDEO_ID,
  title: "Finale Night",
  creatorName: "Ana",
  durationSec: 240,
  ...over,
});

describe("stage-booking — the screen catalog fold", () => {
  it("folds mine + public shelves in the catalog's own shape", () => {
    const folded = parseScreenCatalog({
      catalog: {
        mine: [{ id: VIDEO_ID, title: "Mine", creatorName: "Me", mediaKind: "file", durationSec: 90 }],
        public: [{ id: REPLAY_ID, title: "Pub", creatorName: null, mediaKind: "hls", durationSec: 0 }],
      },
    });
    expect(folded.mine).toEqual([{ id: VIDEO_ID, title: "Mine", creatorName: "Me", durationSec: 90 }]);
    expect(folded.pub).toEqual([{ id: REPLAY_ID, title: "Pub", creatorName: null, durationSec: 0 }]);
  });

  it("drops rows the room couldn't play — bad ids, no title, track ids", () => {
    const folded = parseScreenCatalog({
      catalog: {
        mine: [
          { id: "track:123e4567-e89b-12d3-a456-426614174000", title: "A song" },
          { id: "video:not-a-uuid", title: "Broken" },
          { id: VIDEO_ID, title: "  " },
          { id: VIDEO_ID, title: "Kept" },
          "garbage",
          null,
        ],
        public: "nope",
      },
    });
    expect(folded.mine.map((i) => i.title)).toEqual(["Kept"]);
    expect(folded.pub).toEqual([]);
  });

  it("a wholly malformed answer folds to empty shelves, never a throw", () => {
    expect(parseScreenCatalog(null)).toEqual({ mine: [], pub: [] });
    expect(parseScreenCatalog({})).toEqual({ mine: [], pub: [] });
    expect(parseScreenCatalog({ catalog: 42 })).toEqual({ mine: [], pub: [] });
  });
});

describe("stage-booking — the request builder mirrors the server's rules", () => {
  const draft = (over: Partial<Parameters<typeof buildStageShowBody>[0]> = {}) => ({
    title: "Open Stage Night",
    startsAtMs: NOW + 2 * HOUR,
    durationMin: 60,
    content: { type: "live" } as const,
    ...over,
  });

  it("books a live show into the Throne Hall — the rule's one room", () => {
    const built = buildStageShowBody(draft(), NOW);
    expect(built).toEqual({
      ok: true,
      body: {
        kind: "stage_show",
        roomId: "world:kings-hall",
        title: "Open Stage Night",
        startsAt: new Date(NOW + 2 * HOUR).toISOString(),
        endsAt: new Date(NOW + 3 * HOUR).toISOString(),
        payload: { contentRef: "live" },
      },
    });
    expect(STAGE_ROOM_ID).toBe("world:kings-hall");
  });

  it("books a catalog video and a replay by their ids", () => {
    const v = buildStageShowBody(draft({ content: { type: "catalog", item: item() } }), NOW);
    expect(v.ok && v.body.payload.contentRef).toBe(VIDEO_ID);
    const r = buildStageShowBody(draft({ content: { type: "catalog", item: item({ id: REPLAY_ID }) } }), NOW);
    expect(r.ok && r.body.payload.contentRef).toBe(REPLAY_ID);
    expect(stageContentRef({ type: "live" })).toBe("live");
    expect(stageContentRef({ type: "catalog", item: item() })).toBe(VIDEO_ID);
  });

  it("refuses the drafts the server would refuse, each by its code", () => {
    expect(buildStageShowBody(draft({ title: "  " }), NOW)).toEqual({ ok: false, error: "titleRequired" });
    expect(buildStageShowBody(draft({ title: "x".repeat(121) }), NOW)).toEqual({ ok: false, error: "titleTooLong" });
    expect(buildStageShowBody(draft({ content: { type: "catalog", item: item({ id: "track:abc" }) } }), NOW)).toEqual({
      ok: false,
      error: "contentInvalid",
    });
    expect(buildStageShowBody(draft({ durationMin: 4 }), NOW)).toEqual({ ok: false, error: "durationTooShort" });
    expect(buildStageShowBody(draft({ durationMin: 241 }), NOW)).toEqual({ ok: false, error: "durationTooLong" });
    expect(buildStageShowBody(draft({ startsAtMs: Number.NaN }), NOW)).toEqual({ ok: false, error: "startRequired" });
    expect(buildStageShowBody(draft({ startsAtMs: NOW - 6 * 60_000 }), NOW)).toEqual({ ok: false, error: "startPast" });
    expect(buildStageShowBody(draft({ startsAtMs: NOW + 31 * 24 * HOUR }), NOW)).toEqual({ ok: false, error: "startTooFar" });
  });

  it("keeps the server's grace: a start 4 minutes past still books; 30 days out still books", () => {
    expect(buildStageShowBody(draft({ startsAtMs: NOW - 4 * 60_000 }), NOW).ok).toBe(true);
    expect(buildStageShowBody(draft({ startsAtMs: NOW + 30 * 24 * HOUR - 60_000 }), NOW).ok).toBe(true);
    expect(buildStageShowBody(draft({ durationMin: 5 }), NOW).ok).toBe(true);
    expect(buildStageShowBody(draft({ durationMin: 240 }), NOW).ok).toBe(true);
  });
});

describe("stage-booking — the booking-rule gate: the Front Row refusal", () => {
  it("FRONT_ROW_REQUIRED resolves to the refusal words, never the raw code", () => {
    const r = stageBookingError(403, {
      error: "FRONT_ROW_REQUIRED",
      message: "Throne Hall stage slots are booked by Front Row members and the house.",
    });
    expect(r).toEqual({ kind: "key", key: "refusedFrontRow" });
  });

  it("a taken slot resolves to the slot-taken words", () => {
    expect(stageBookingError(409, { error: "SLOT_TAKEN", message: "…" })).toEqual({ kind: "key", key: "slotTaken" });
  });

  it("window/payload refusals keep the server's own sentence", () => {
    expect(
      stageBookingError(400, { error: "INVALID_WINDOW", message: "An event slot is at most 4 hours." }),
    ).toEqual({ kind: "message", message: "An event slot is at most 4 hours." });
    expect(
      stageBookingError(400, { error: "INVALID_PAYLOAD", message: "A stage show needs a screen content ref." }),
    ).toEqual({ kind: "message", message: "A stage show needs a screen content ref." });
  });

  it("room mismatches and bare answers fall back honestly", () => {
    expect(stageBookingError(400, { error: "ROOM_MISMATCH" })).toEqual({ kind: "key", key: "notBookable" });
    expect(stageBookingError(401, null)).toEqual({ kind: "key", key: "signIn" });
    expect(stageBookingError(403, null)).toEqual({ kind: "key", key: "notBookable" });
    expect(stageBookingError(500, null)).toEqual({ kind: "key", key: "failed" });
  });
});

describe("stage-booking — mine", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "e1",
    kind: "stage_show",
    roomId: "world:kings-hall",
    title: "My Show",
    startsAt: new Date(NOW + HOUR).toISOString(),
    endsAt: new Date(NOW + 2 * HOUR).toISOString(),
    status: "scheduled",
    payload: { contentRef: "live" },
    ...over,
  });

  it("keeps only my upcoming Throne Hall stage shows, soonest first, with their content", () => {
    const mine = normalizeMyShows(
      {
        events: [
          row({ id: "later", startsAt: new Date(NOW + 5 * HOUR).toISOString(), endsAt: new Date(NOW + 6 * HOUR).toISOString() }),
          row({ id: "party", kind: "listening_party", roomId: "world:music-hall" }),
          row({ id: "done", status: "done" }),
          row({ id: "ended", startsAt: new Date(NOW - 2 * HOUR).toISOString(), endsAt: new Date(NOW - HOUR).toISOString() }),
          row({ id: "soon", payload: { contentRef: VIDEO_ID } }),
          row({ id: "other-room", roomId: "world:music-hall" }),
        ],
      },
      NOW,
    );
    expect(mine.map((s) => s.id)).toEqual(["soon", "later"]);
    expect(mine[0]?.contentRef).toBe(VIDEO_ID);
    expect(mine[1]?.contentRef).toBe("live");
  });

  it("a live show reads live; a malformed answer reads empty", () => {
    const mine = normalizeMyShows({ events: [row({ status: "live" })] }, NOW);
    expect(mine[0]?.status).toBe("live");
    expect(normalizeMyShows(null, NOW)).toEqual([]);
    expect(normalizeMyShows({ events: "nope" }, NOW)).toEqual([]);
  });
});
