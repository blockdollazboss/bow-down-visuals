/**
 * live-desk wave II — stack-100 #88–#91 seam + sources.
 *
 * Pins:
 * - #88 stream scheduling rides GoLiveMain's doors verbatim
 *   (GET/POST/DELETE /api/discord/streams, scheduleSchema's gates,
 *   the upcoming/recent split) — and NO edit rail is invented: the
 *   API has no PATCH for these rows, so the desk's edit is prefill +
 *   POST-the-replacement-first + DELETE-the-old-row;
 * - #89 the controller desk is the phone remote's exact surface:
 *   StreamDeck + ControllerRemoteClient over
 *   /api/live/controller/ws?role=remote, with stream-controller.tsx's
 *   status line and unavailable note verbatim, confirmed state only;
 * - #90 the watch desk mirrors live-watch.tsx for the stream ON the
 *   hall screen: the public stream DTO, the 15s presence heartbeat,
 *   LiveChatPanel as the dedicated stream chat (backstage chat is a
 *   different room), FollowButton + PushAlertsToggle as the follow
 *   rail, publicOnStageGuests for the on-stage chips;
 * - #91 premiere scheduling rides SchedulePremiereForm's rails via
 *   reachApi (create/upcoming/cancel) with premiereCreateSchema's
 *   gates and the completed-clips picker; cancel shows only on the
 *   member's own rows (the server enforces ownership regardless);
 * - law: all four desks dock in the same members-only Screen panel;
 *   nothing charges and no flow completes by linking out.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCHEDULED_STREAMS_PATH, SCHEDULED_STREAM_PATH,
  normalizeScheduledStreams, scheduleDraftReady, scheduleWhenIso, toLocalInputValue,
  CONTROLLER_WS_PATH, controllerStatusLine, controllerUnavailableNote,
  WATCH_HEARTBEAT_PATH, normalizeWatchStream, watchHeartbeatBody, watchStreamIdFromScreen,
  GENERATED_CLIPS_PATH, PREMIERES_UPCOMING_PATH, PREMIERE_CREATE_PATH, PREMIERE_CANCEL_PATH,
  normalizeFinishedClips, premiereDraftReady, isOwnPremiere,
  LIVE_WAVE2_PROMOTIONS, LIVE_NATIVE_FOLLOW_ONS,
} from "./live-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveDesk.tsx");
const worldSrc = read("../../pages/world.tsx");
const reachApiSrc = read("../reach-api.ts");
const controllerSrc = read("../stream-controller.ts");
const controllerPageSrc = read("../../pages/stream-controller.tsx");
const goLiveSrc = read("../../pages/go-live.tsx");
const watchSrc = read("../../pages/live-watch.tsx");

describe("#88 stream scheduling — GoLiveMain's doors verbatim", () => {
  it("pins the schedule paths and GoLiveMain's own use of them", () => {
    expect(SCHEDULED_STREAMS_PATH).toBe("/api/discord/streams");
    expect(SCHEDULED_STREAM_PATH("s 1")).toBe("/api/discord/streams/s%201");
    expect(goLiveSrc).toContain('fetch("/api/discord/streams"');
    expect(goLiveSrc).toContain("fetch(`/api/discord/streams/${id}`, { method: \"DELETE\"");
  });

  it("splits upcoming/recent the 2D way: scheduled up top, first 5 ended below", () => {
    const ended = Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, title: `Old ${i}`, status: "ended", ended_at: "2026-10-01T00:00:00Z" }));
    const view = normalizeScheduledStreams({
      streams: [
        { id: "u1", title: "Next", game: "Chess", status: "scheduled", scheduled_for: "2026-11-01T20:00:00Z" },
        { id: "l1", title: "Now", status: "live" },
        ...ended,
        { noId: true },
        "junk",
      ],
    });
    expect(view.upcoming.map((s) => s.id)).toEqual(["u1"]);
    expect(view.upcoming[0]).toMatchObject({ game: "Chess", scheduledFor: "2026-11-01T20:00:00Z" });
    expect(view.recent).toHaveLength(5);
    expect(normalizeScheduledStreams(null)).toEqual({ upcoming: [], recent: [] });
  });

  it("the draft gate is scheduleSchema's: title 1–200 trimmed, game ≤100", () => {
    expect(scheduleDraftReady(" Show ", "")).toBe(true);
    expect(scheduleDraftReady("   ", "")).toBe(false);
    expect(scheduleDraftReady("x".repeat(201), "")).toBe(false);
    expect(scheduleDraftReady("Show", "g".repeat(101))).toBe(false);
  });

  it("the when conversion matches GoLiveMain's toISOString, empty = no date", () => {
    expect(scheduleWhenIso("")).toBeUndefined();
    expect(scheduleWhenIso("not-a-date")).toBeUndefined();
    expect(scheduleWhenIso("2026-11-01T20:30")).toBe(new Date("2026-11-01T20:30").toISOString());
    const back = toLocalInputValue(scheduleWhenIso("2026-11-01T20:30")!);
    expect(back).toBe("2026-11-01T20:30");
    expect(toLocalInputValue(null)).toBe("");
    expect(toLocalInputValue("junk")).toBe("");
  });

  it("edit is honest: no PATCH is called — replacement POSTs before the old row DELETEs", () => {
    const saveStart = deskSrc.indexOf("async function handleSave()");
    const saveEnd = deskSrc.indexOf("async function handleCancel(", saveStart);
    const saveBody = deskSrc.slice(saveStart, saveEnd);
    expect(saveBody).toContain('method: "POST"');
    expect(saveBody).not.toContain("PATCH");
    expect(saveBody.indexOf('method: "POST"')).toBeLessThan(saveBody.indexOf('method: "DELETE"'));
    expect(saveBody).toContain("if (editingId)");
  });
});

describe("#89 Stream Controller deck — the phone remote's surface, in-world", () => {
  it("the relay path and role match the server + phone page", () => {
    expect(CONTROLLER_WS_PATH).toBe("/api/live/controller/ws");
    expect(controllerSrc).toContain("/api/live/controller/ws?role=${role}&token=");
    expect(deskSrc).toContain('controllerSocketUrl(window.location, "remote")');
    expect(deskSrc).toContain("new ControllerRemoteClient(");
    expect(deskSrc).toContain("<StreamDeck");
    expect(controllerPageSrc).toContain("<StreamDeck");
  });

  it("status line + unavailable note are stream-controller.tsx's, verbatim", () => {
    expect(controllerStatusLine({ started: false, socketUp: false, stageConnected: false, live: false, label: null })).toBe("Connecting…");
    expect(controllerStatusLine({ started: true, socketUp: false, stageConnected: true, live: false, label: "Show" })).toBe("Reconnecting…");
    expect(controllerStatusLine({ started: true, socketUp: true, stageConnected: false, live: false, label: null })).toBe("Studio not open");
    expect(controllerStatusLine({ started: true, socketUp: true, stageConnected: true, live: true, label: "Show" })).toBe("Live — controlling Show");
    expect(controllerStatusLine({ started: true, socketUp: true, stageConnected: true, live: false, label: null })).toBe("Connected — controlling your studio");
    expect(controllerUnavailableNote({ socketUp: true, stageConnected: false })).toBe("Open the studio — this remote connects to it automatically.");
    expect(controllerUnavailableNote({ socketUp: false, stageConnected: true })).toBe("Connection dropped — reconnecting. Controls pause until it's back.");
    expect(controllerUnavailableNote({ socketUp: true, stageConnected: true })).toBeNull();
    /* The page's own words, so the two surfaces can never drift apart silently. */
    expect(controllerPageSrc).toContain("Open the studio — this remote connects to it automatically.");
    expect(controllerPageSrc).toContain("Connection dropped — reconnecting. Controls pause until it's back.");
  });

  it("the deck sweeps pending acks on the phone remote's 1s rhythm and sends through the client", () => {
    expect(deskSrc).toContain("client.sweepPending(), 1000");
    expect(deskSrc).toContain("client?.send(cmd, args)");
    expect(deskSrc).toContain("client?.isPending(cmd, sceneId)");
  });
});

describe("#90 live-watch parity — live-watch.tsx's doors for the hall screen's stream", () => {
  it("only a live-mode screen with a streamId has a watch desk", () => {
    expect(watchStreamIdFromScreen({ mode: "live", streamId: "s1" })).toBe("s1");
    expect(watchStreamIdFromScreen({ mode: "video", streamId: "s1" })).toBeNull();
    expect(watchStreamIdFromScreen({ mode: "live", streamId: null })).toBeNull();
    expect(watchStreamIdFromScreen(null)).toBeNull();
  });

  it("normalizes the public stream DTO the watch page reads", () => {
    expect(normalizeWatchStream({
      stream: {
        id: "s1", title: "Show", status: "live", viewer_count: 9, peak_viewers: 12,
        creator: { id: "p1", slug: "ana", display_name: "Ana", avatar_url: null },
      },
    })).toEqual({
      id: "s1", title: "Show", status: "live", viewerCount: 9, peakViewers: 12,
      creator: { id: "p1", slug: "ana", displayName: "Ana", avatarUrl: null },
    });
    expect(normalizeWatchStream({ stream: null })).toBeNull();
    expect(normalizeWatchStream(null)).toBeNull();
  });

  it("the heartbeat is the watch page's: POST session_id every 15s", () => {
    expect(WATCH_HEARTBEAT_PATH("s 1")).toBe("/api/live-streams/s%201/heartbeat");
    expect(watchHeartbeatBody("sess")).toEqual({ session_id: "sess" });
    expect(watchSrc).toContain("/heartbeat`");
    expect(watchSrc).toContain("session_id: sessionRef.current");
    expect(deskSrc).toContain("WATCH_HEARTBEAT_PATH(streamId)");
    expect(deskSrc).toContain("15_000");
  });

  it("the dedicated stream chat is the watch page's panel; the follow rail is its buttons", () => {
    expect(deskSrc).toContain("<LiveChatPanel streamId={streamId}");
    expect(watchSrc).toContain("<LiveChatPanel streamId={stream.id}");
    expect(deskSrc).toContain("<FollowButton profileId={creator.id}");
    expect(deskSrc).toContain("useFollowStates(stream?.creator");
    expect(deskSrc).toContain("<PushAlertsToggle />");
    expect(watchSrc).toContain("<PushAlertsToggle />");
    expect(deskSrc).toContain("publicOnStageGuests(streamId)");
    expect(watchSrc).toContain("publicOnStageGuests(streamId)");
  });
});

describe("#91 premiere scheduling — SchedulePremiereForm's rails via reachApi", () => {
  it("pins the premiere doors reachApi carries", () => {
    expect(PREMIERES_UPCOMING_PATH).toBe("/api/reach/premieres/upcoming");
    expect(PREMIERE_CREATE_PATH).toBe("/api/reach/premieres");
    expect(PREMIERE_CANCEL_PATH("p 1")).toBe("/api/reach/premieres/p%201/cancel");
    expect(GENERATED_CLIPS_PATH).toBe("/api/generated-clips");
    expect(reachApiSrc).toContain('"/api/reach/premieres"');
    expect(reachApiSrc).toContain("/api/reach/premieres/upcoming");
    expect(reachApiSrc).toContain("/cancel`");
    expect(deskSrc).toContain("reachApi.createPremiere");
    expect(deskSrc).toContain("reachApi.upcomingPremieres");
    expect(deskSrc).toContain("reachApi.cancelPremiere");
  });

  it("the clip picker keeps only finished videos, like the form", () => {
    expect(normalizeFinishedClips({
      clips: [
        { id: "c1", title: "Done", status: "completed" },
        { id: "c2", title: "Cooking", status: "processing" },
        { id: "c3", title: null, status: "completed" },
      ],
    })).toEqual([
      { id: "c1", title: "Done" },
      { id: "c3", title: "Untitled video" },
    ]);
    expect(normalizeFinishedClips(null)).toEqual([]);
  });

  it("the draft gate is premiereCreateSchema + the future-start rule", () => {
    const now = new Date("2026-10-23T12:00:00").getTime();
    const base = { clipId: "c1", title: "First showing", durationSeconds: 180, whenLocal: "2026-10-24T20:00" };
    expect(premiereDraftReady(base, now)).toBe(true);
    expect(premiereDraftReady({ ...base, clipId: "" }, now)).toBe(false);
    expect(premiereDraftReady({ ...base, title: " " }, now)).toBe(false);
    expect(premiereDraftReady({ ...base, durationSeconds: 9 }, now)).toBe(false);
    expect(premiereDraftReady({ ...base, durationSeconds: 14401 }, now)).toBe(false);
    expect(premiereDraftReady({ ...base, durationSeconds: 90.5 }, now)).toBe(false);
    expect(premiereDraftReady({ ...base, whenLocal: "2026-10-22T20:00" }, now)).toBe(false);
    expect(premiereDraftReady({ ...base, whenLocal: "" }, now)).toBe(false);
  });

  it("only the member's own upcoming rows offer cancel", () => {
    expect(isOwnPremiere({ creator: { id: "p1" } }, "p1")).toBe(true);
    expect(isOwnPremiere({ creator: { id: "p2" } }, "p1")).toBe(false);
    expect(isOwnPremiere({ creator: null }, "p1")).toBe(false);
    expect(isOwnPremiere({ creator: { id: "p1" } }, null)).toBe(false);
    expect(deskSrc).toContain("isOwnPremiere(p, myProfileId) && p.phase === \"scheduled\"");
  });
});

describe("law — wave II docks in the same members-only panel, free rails only", () => {
  it("all four desks mount inside world-live-desks (the !isGuest Screen panel)", () => {
    expect(worldSrc).toContain("<LiveScheduleDesk");
    expect(worldSrc).toContain("<LiveControllerDesk");
    expect(worldSrc).toContain("<LiveWatchDesk");
    expect(worldSrc).toContain("<LivePremiereDesk");
    expect(worldSrc).toContain("screenPanelOpen && inHall && !isGuest");
    expect(worldSrc).toContain("streamId: stageScreen.streamId");
  });

  it("the board records wave II and the remaining honest follow-ons", () => {
    expect(LIVE_WAVE2_PROMOTIONS).toHaveLength(4);
    expect(LIVE_WAVE2_PROMOTIONS[0]).toContain("#88");
    expect(LIVE_WAVE2_PROMOTIONS[1]).toContain("#89");
    expect(LIVE_WAVE2_PROMOTIONS[2]).toContain("#90");
    expect(LIVE_WAVE2_PROMOTIONS[3]).toContain("#91");
    expect(LIVE_NATIVE_FOLLOW_ONS.join(" ")).not.toContain("stays with stack-100 #88");
    expect(LIVE_NATIVE_FOLLOW_ONS.join(" ")).not.toContain("stays with #90");
  });
});

/* ── Item 98 (Stack-100 #2) — controller deck executor truth ─────────
   The Go Live studio's live state is published on the real rails and
   the in-world deck drives the real studio off that state:
   - server-side, every broadcast start path writes started_at
     (pinned over HTTP in the api-server live-streams-own suite);
   - BroadcastStudio publishes THAT start (its liveSince state,
     corrected by the live poll to the server's started_at) as the
     controller state's liveSince — never a Date.now()-elapsed
     reconstruction;
   - the deck itself is socket-driven (D-89c's "2s polling" claim
     verified stale): its only interval is the local 1s ack sweeper. */
describe("item 98 — the deck drives the real studio off rail-published state", () => {
  const studioSrc = read("../../components/go-live/BroadcastStudio.tsx");

  it("BroadcastStudio's controller state publishes the real liveSince, not a reconstruction", () => {
    expect(studioSrc).toContain("liveSince: isLivePhase ? liveSince : null");
    expect(studioSrc).not.toContain("Date.now() - elapsed * 1000");
    /* …and the live poll adopts the server-written started_at. */
    expect(studioSrc).toContain("started_at");
    expect(studioSrc).toContain("setLiveSince");
  });

  it("the in-world controller desk polls NOTHING: state arrives over the socket; the 1s sweeper is local ack expiry only", () => {
    const deskStart = deskSrc.indexOf("export function LiveControllerDesk");
    const deskEnd = deskSrc.indexOf("export function LiveWatchDesk");
    const block = deskSrc.slice(deskStart, deskEnd);
    expect(block).toContain("new ControllerRemoteClient(");
    expect(block).toContain("sweepPending");
    expect(block).not.toContain("fetch(");
    /* The phone remote (same client) is likewise socket-only. */
    expect(controllerPageSrc).toContain("new ControllerRemoteClient(");
    expect(controllerPageSrc).not.toContain("fetch(");
  });

  it('"Studio not open" is spoken only off the socket presence truth (stageConnected), never a timer or a guess', () => {
    expect(controllerStatusLine({ started: true, socketUp: true, stageConnected: false, live: false, label: null })).toBe("Studio not open");
    expect(controllerStatusLine({ started: true, socketUp: true, stageConnected: true, live: false, label: null })).not.toBe("Studio not open");
  });
});
