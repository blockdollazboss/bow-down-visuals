/**
 * live-desk-song-requests — stack100 wave 3, item 17 (B11) seam +
 * sources.
 *
 * Pins:
 * - every rail is the 2D Song Requests surfaces' verbatim door:
 *   GET/POST /api/live/:id/song-requests (the fan face rides the
 *   live-watch page's SongRequestPanel), POST …/play-next,
 *   POST …/:requestId/skip, POST …/close, and GET/PUT
 *   /api/song-request-rules (the creator face rides go-live's
 *   SongRequestDesk) — no endpoint is invented for the World, and
 *   the 2D components ride the same paths;
 * - the normalizers carry the rail's state exactly: queue rows keep
 *   id / order / status / position / amount / refund flag, rules
 *   keep the server's four fields, and a malformed row is dropped
 *   rather than dressed up — the in-world queue IS the 2D queue;
 * - the request shapes are the routes' schemas verbatim: the fan
 *   submit is { songId, amountVb, idempotencyKey } (submitSchema),
 *   the rules save is the four rule fields (rulesSchema), and the
 *   queue doors POST an empty body like the 2D desk;
 * - the tip gate mirrors the server's rule (whole amount inside
 *   the payload's own bounds, at/above the creator's minimum when
 *   set) — amounts come FROM the payload, never from this seam;
 * - law: both faces dock inside the members-only Screen panel (the
 *   creator desk via LiveDesksPanel, the fan panel inside the
 *   watch desk) — palace guests gain no voice; nothing links out
 *   to /go-live or the watch page to complete its flow.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SONG_REQUESTS_PATH, SONG_REQUEST_PLAY_NEXT_PATH, SONG_REQUEST_CLOSE_PATH,
  SONG_REQUEST_SKIP_PATH, SONG_REQUEST_RULES_PATH,
  normalizeSongRequestQueuePayload, normalizeSongRequestRulesPayload,
  songRequestSubmitBody, songRequestRulesBody,
  songRequestTipReady, songRequestMinTipReady, songRequestMinTipValue,
  songRequestRequestableSongs,
  LIVE_SONG_REQUESTS_PROMOTION,
} from "./live-desk";
import type { RequestRulesDto } from "../song-requests";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveDesk.tsx");
const livePanelSrc = read("../../components/world/native/LiveDesksPanel.tsx");
const seamSrc = read("./live-desk.ts");
const twoDSrc = read("../../components/live/SongRequests.tsx");

const bounds = { minVb: 100, maxVb: 1_000_000 };
const rules: RequestRulesDto = { requestsOpen: true, catalogOnly: true, excludedSongIds: [], minTipVb: null };

const queueRow = (patch: Record<string, unknown> = {}) => ({
  id: "r1",
  streamId: "s1",
  songId: "song1",
  songTitle: "Golden Hour",
  amountVb: 500,
  status: "queued",
  position: 2,
  fanUserId: "fan1",
  fan: { displayName: "Front Row Fan", avatarUrl: null, slug: "frontrow" },
  refunded: false,
  createdAt: "2026-11-04T10:00:00.000Z",
  playedAt: null,
  ...patch,
});

describe("rails — the 2D Song Requests surfaces' verbatim doors", () => {
  it("pins every song-request path verbatim", () => {
    expect(SONG_REQUESTS_PATH("s 1")).toBe("/api/live/s%201/song-requests");
    expect(SONG_REQUEST_PLAY_NEXT_PATH("s1")).toBe("/api/live/s1/song-requests/play-next");
    expect(SONG_REQUEST_CLOSE_PATH("s1")).toBe("/api/live/s1/song-requests/close");
    expect(SONG_REQUEST_SKIP_PATH("s1", "r 1")).toBe("/api/live/s1/song-requests/r%201/skip");
    expect(SONG_REQUEST_RULES_PATH).toBe("/api/song-request-rules");
  });

  it("the 2D surfaces ride the same doors (no World-only endpoint was invented)", () => {
    expect(twoDSrc).toContain("/api/live/${streamId}/song-requests");
    expect(twoDSrc).toContain("/api/song-request-rules");
    expect(twoDSrc).toContain("song-requests/${path}");
    expect(twoDSrc).toContain("song-requests/${r.id}/skip");
  });
});

describe("normalizers — the in-world state equals the rail's state", () => {
  it("the queue payload carries rules, bounds, catalog and queue verbatim", () => {
    const view = normalizeSongRequestQueuePayload({
      streamId: "s1",
      available: true,
      rules: { requestsOpen: false, catalogOnly: false, excludedSongIds: ["x1"], minTipVb: 250 },
      refundCopy: "Skipped or unplayed requests are refunded.",
      tipBounds: bounds,
      catalog: [
        { id: "song1", title: "Golden Hour", durationSec: "3:12", excluded: false },
        { id: "song2", title: "Night Drive", durationSec: null, excluded: true },
      ],
      queue: [queueRow(), queueRow({ id: "r2", status: "playing", position: null })],
    });
    expect(view.streamId).toBe("s1");
    expect(view.available).toBe(true);
    expect(view.rules).toEqual({ requestsOpen: false, catalogOnly: false, excludedSongIds: ["x1"], minTipVb: 250 });
    expect(view.refundCopy).toContain("refunded");
    expect(view.tipBounds).toEqual(bounds);
    expect(view.catalog).toHaveLength(2);
    expect(view.catalog[1]).toEqual({ id: "song2", title: "Night Drive", durationSec: null, excluded: true });
    /* Same rows, same order, same fields the 2D QueueList renders. */
    expect(view.queue.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(view.queue[0]).toEqual({
      id: "r1", streamId: "s1", songId: "song1", songTitle: "Golden Hour", amountVb: 500,
      status: "queued", position: 2, fanUserId: "fan1",
      fan: { displayName: "Front Row Fan", avatarUrl: null, slug: "frontrow" },
      refunded: false, createdAt: "2026-11-04T10:00:00.000Z", playedAt: null,
    });
    expect(view.queue[1]!.status).toBe("playing");
  });

  it("malformed queue rows are dropped, never dressed up", () => {
    const view = normalizeSongRequestQueuePayload({
      streamId: "s1",
      available: true,
      rules,
      tipBounds: bounds,
      queue: [
        queueRow(),
        queueRow({ id: 42 }),
        queueRow({ id: "bad-amount", amountVb: "500" }),
        queueRow({ id: "bad-status", status: "pending" }),
        null,
        "junk",
      ],
    });
    expect(view.queue.map((r) => r.id)).toEqual(["r1"]);
  });

  it("a payload without bounds leaves tipBounds null — the tip gate then submits nothing", () => {
    const view = normalizeSongRequestQueuePayload({ streamId: "s1", available: true, rules, queue: [] });
    expect(view.tipBounds).toBeNull();
    expect(songRequestTipReady("500", rules, view.tipBounds)).toBe(false);
  });

  it("absent rule fields fall back to the server's own defaults", () => {
    const view = normalizeSongRequestQueuePayload({ streamId: "s1", available: true, queue: [] });
    expect(view.rules).toEqual({ requestsOpen: true, catalogOnly: true, excludedSongIds: [], minTipVb: null });
    expect(view.available).toBe(true);
    expect(normalizeSongRequestQueuePayload(null).available).toBe(false);
    expect(normalizeSongRequestQueuePayload(null).queue).toEqual([]);
  });

  it("the rules payload carries the creator's live stream id for the queue doors", () => {
    const view = normalizeSongRequestRulesPayload({
      available: true,
      rules,
      refundCopy: "copy",
      tipBounds: bounds,
      catalog: [{ id: "song1", title: "Golden Hour", durationSec: null, excluded: false }],
      liveStreamId: "s9",
    });
    expect(view.liveStreamId).toBe("s9");
    expect(view.catalog).toHaveLength(1);
    expect(normalizeSongRequestRulesPayload({ available: false }).liveStreamId).toBeNull();
  });

  it("requestable songs are the catalog minus the creator's exclusions", () => {
    const view = normalizeSongRequestQueuePayload({
      streamId: "s1", available: true, rules, tipBounds: bounds,
      catalog: [
        { id: "song1", title: "A", durationSec: null, excluded: false },
        { id: "song2", title: "B", durationSec: null, excluded: true },
      ],
      queue: [],
    });
    expect(songRequestRequestableSongs(view).map((s) => s.id)).toEqual(["song1"]);
  });
});

describe("request shapes — the routes' schemas verbatim", () => {
  it("the fan submit body is exactly submitSchema's three fields", () => {
    expect(songRequestSubmitBody("song1", 500, "intent-key-1")).toEqual({
      songId: "song1",
      amountVb: 500,
      idempotencyKey: "intent-key-1",
    });
    expect(Object.keys(songRequestSubmitBody("song1", 500, "k"))).toEqual(["songId", "amountVb", "idempotencyKey"]);
  });

  it("the rules save body is exactly rulesSchema's four fields", () => {
    const body = songRequestRulesBody({ requestsOpen: false, catalogOnly: false, excludedSongIds: ["x1"], minTipVb: 250 });
    expect(body).toEqual({ requestsOpen: false, catalogOnly: false, excludedSongIds: ["x1"], minTipVb: 250 });
    expect(Object.keys(body)).toEqual(["requestsOpen", "catalogOnly", "excludedSongIds", "minTipVb"]);
  });

  it("the desk posts the queue doors with the 2D desk's empty body", () => {
    const desk = deskSrc.slice(deskSrc.indexOf("export function LiveSongRequestsDesk"));
    expect(desk).toContain("SONG_REQUEST_PLAY_NEXT_PATH(liveStreamId)");
    expect(desk).toContain("SONG_REQUEST_CLOSE_PATH(liveStreamId)");
    expect(desk).toContain("SONG_REQUEST_SKIP_PATH(liveStreamId, r.id)");
    expect(desk).toContain('body: JSON.stringify({})');
  });
});

describe("gates — the server's tip and rules rules, mirrored", () => {
  it("a tip must be whole, inside the payload's bounds, and at/above the creator's minimum", () => {
    expect(songRequestTipReady("500", rules, bounds)).toBe(true);
    expect(songRequestTipReady("99", rules, bounds)).toBe(false);
    expect(songRequestTipReady("1000001", rules, bounds)).toBe(false);
    expect(songRequestTipReady("50.5", rules, bounds)).toBe(false);
    expect(songRequestTipReady("", rules, bounds)).toBe(false);
    expect(songRequestTipReady("249", { ...rules, minTipVb: 250 }, bounds)).toBe(false);
    expect(songRequestTipReady("250", { ...rules, minTipVb: 250 }, bounds)).toBe(true);
    expect(songRequestTipReady("500", rules, null)).toBe(false);
  });

  it("the minimum-tip box: blank is no minimum; a typed one must sit inside the bounds", () => {
    expect(songRequestMinTipReady("", bounds)).toBe(true);
    expect(songRequestMinTipValue("")).toBeNull();
    expect(songRequestMinTipReady("250", bounds)).toBe(true);
    expect(songRequestMinTipValue("250")).toBe(250);
    expect(songRequestMinTipReady("99", bounds)).toBe(false);
    expect(songRequestMinTipReady("1000001", bounds)).toBe(false);
    expect(songRequestMinTipReady("12.5", bounds)).toBe(false);
  });
});

describe("sources — both faces dock in-world on the shared seam", () => {
  it("the creator desk docks in the members-only panel after the premiere desk", () => {
    expect(livePanelSrc).toContain("<LiveSongRequestsDesk");
    expect(livePanelSrc.indexOf("<LiveSongRequestsDesk")).toBeGreaterThan(livePanelSrc.indexOf("<LivePremiereDesk"));
    expect(deskSrc).toContain("export function LiveSongRequestsDesk");
  });

  it("the fan panel docks inside the watch desk, before the stream chat", () => {
    const watch = deskSrc.slice(deskSrc.indexOf("export function LiveWatchDesk"), deskSrc.indexOf("export function LivePremiereDesk"));
    expect(watch).toContain("<LiveSongRequestPanel");
    expect(watch.indexOf("<LiveSongRequestPanel")).toBeLessThan(watch.indexOf("<LiveChatPanel"));
    expect(deskSrc).toContain("export function LiveSongRequestPanel");
  });

  const songSection = () =>
    deskSrc.slice(
      deskSrc.indexOf("/* ── Song Requests (stack100 wave 3, item 17)"),
      deskSrc.indexOf("/* ═══ #91 Premiere"),
    );

  it("both faces ride the seam — no hard-coded song-request URL in the component", () => {
    const songSections = songSection();
    expect(songSections).toContain("SONG_REQUESTS_PATH(");
    expect(songSections).toContain("SONG_REQUEST_RULES_PATH");
    expect(songSections).toContain("songRequestSubmitBody(");
    expect(songSections).toContain("songRequestRulesBody(");
    expect(songSections).not.toContain("/api/live/");
    expect(songSections).not.toContain("/api/song-request-rules");
  });

  it("the words come from the shared lib — up-front rules and status labels", () => {
    const songSections = songSection();
    expect(songSections).toContain("upfrontRuleLines(");
    expect(songSections).toContain("requestStatusLabel(");
    expect(seamSrc).toContain("LIVE_SONG_REQUESTS_PROMOTION");
    expect(LIVE_SONG_REQUESTS_PROMOTION).toContain("/api/live/:id/song-requests");
  });

  it("no face links out of the World to complete its flow", () => {
    const songSections = songSection();
    expect(songSections).not.toContain("/go-live");
    expect(songSections).not.toContain("/live-watch");
    expect(songSections).not.toContain("/login");
  });
});
