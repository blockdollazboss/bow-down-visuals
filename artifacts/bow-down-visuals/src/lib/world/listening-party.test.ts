/**
 * listening-party — the Music Hall booking seam (World Events 3.2).
 *
 * The server half of listening parties (booking rules, the
 * scheduler's jukebox hand-off, slot-end release) is pinned in the
 * api-server suites; these tests pin the client half: the queue
 * fold, the request builder mirroring the server's rules with the
 * same words, the error copy, the "mine" normalizer, the playlist
 * fold onto the site's rails, and the wiring pins proving the
 * Music Hall panel actually renders the party banner and posts
 * the booking (the loop a member can walk, not just an endpoint).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildListeningPartyBody,
  listeningPartyErrorCopy,
  movePartyQueueItem,
  normalizeMyParties,
  parsePartyStartInput,
  partyStartInputValue,
  playlistQueueFold,
  toLocalInputValue,
  togglePartyQueueItem,
  LISTENING_PARTY_ROOM_ID,
  PARTY_QUEUE_MAX,
  type PartyQueueItem,
} from "./listening-party";
import type { StreamPlaylist, StreamTrack, StreamVideo } from "@/lib/streaming";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const HOUR = 3600_000;

const song = (n: number): PartyQueueItem => ({
  id: `track:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Song ${n}`,
  creatorName: "Host",
  durationSec: 180,
});

describe("the queue fold", () => {
  it("appends in tap order and removes on a second tap", () => {
    let r = togglePartyQueueItem([], song(1));
    expect(r.outcome).toBe("added");
    r = togglePartyQueueItem(r.queue, song(2));
    expect(r.queue.map((q) => q.title)).toEqual(["Song 1", "Song 2"]);
    r = togglePartyQueueItem(r.queue, song(1));
    expect(r.outcome).toBe("removed");
    expect(r.queue.map((q) => q.title)).toEqual(["Song 2"]);
  });

  it("refuses a 21st song as full, leaving the queue untouched", () => {
    const full = Array.from({ length: PARTY_QUEUE_MAX }, (_, i) => song(i + 1));
    const r = togglePartyQueueItem(full, song(99));
    expect(r.outcome).toBe("full");
    expect(r.queue).toBe(full);
  });

  it("moves a song a step at a time; the ends are honest no-ops", () => {
    const q = [song(1), song(2), song(3)];
    expect(movePartyQueueItem(q, 0, 1).map((s) => s.title)).toEqual(["Song 2", "Song 1", "Song 3"]);
    expect(movePartyQueueItem(q, 2, -1).map((s) => s.title)).toEqual(["Song 1", "Song 3", "Song 2"]);
    expect(movePartyQueueItem(q, 0, -1)).toBe(q);
    expect(movePartyQueueItem(q, 2, 1)).toBe(q);
  });
});

describe("the request builder (mirrors the server's booking rules)", () => {
  const draft = (over: Partial<Parameters<typeof buildListeningPartyBody>[0]> = {}) => ({
    title: "  Album Night  ",
    startsAtMs: NOW + 2 * HOUR,
    durationMin: 60,
    queue: [song(1), song(2)],
    playlistId: null,
    ...over,
  });

  it("shapes the body the route books: kind, the Music Hall, the queue in order", () => {
    const r = buildListeningPartyBody(draft(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.kind).toBe("listening_party");
    expect(r.body.roomId).toBe("world:music-hall");
    expect(r.body.roomId).toBe(LISTENING_PARTY_ROOM_ID);
    expect(r.body.title).toBe("Album Night");
    expect(r.body.startsAt).toBe(new Date(NOW + 2 * HOUR).toISOString());
    expect(r.body.endsAt).toBe(new Date(NOW + 3 * HOUR).toISOString());
    expect(r.body.payload.trackIds).toEqual([song(1).id, song(2).id]);
    expect(r.body.payload.playlistId).toBeNull();
  });

  it("carries the playlist id when the queue came from one", () => {
    const r = buildListeningPartyBody(draft({ playlistId: " pl-1 " }), NOW);
    expect(r.ok && r.body.payload.playlistId).toBe("pl-1");
  });

  it("refuses an empty name, an empty queue, and a non-catalog pick", () => {
    expect(buildListeningPartyBody(draft({ title: "   " }), NOW)).toEqual({
      ok: false,
      error: expect.stringContaining("name"),
    });
    expect(buildListeningPartyBody(draft({ queue: [] }), NOW).ok).toBe(false);
    const bad = { ...song(1), id: "video:nope" };
    expect(buildListeningPartyBody(draft({ queue: [bad] }), NOW).ok).toBe(false);
  });

  it("refuses a queue past the server's cap and slots outside the window rules", () => {
    const big = Array.from({ length: PARTY_QUEUE_MAX + 1 }, (_, i) => song(i + 1));
    expect(buildListeningPartyBody(draft({ queue: big }), NOW).ok).toBe(false);
    expect(buildListeningPartyBody(draft({ durationMin: 4 }), NOW).ok).toBe(false);
    expect(buildListeningPartyBody(draft({ durationMin: 241 }), NOW).ok).toBe(false);
    expect(buildListeningPartyBody(draft({ startsAtMs: NOW - 6 * 60_000 }), NOW).ok).toBe(false);
    expect(buildListeningPartyBody(draft({ startsAtMs: NOW + 31 * 24 * HOUR }), NOW).ok).toBe(false);
  });

  it("accepts the window edges the server accepts (grace past, 30 days, 5 min, 4 hr)", () => {
    expect(buildListeningPartyBody(draft({ startsAtMs: NOW - 4 * 60_000 }), NOW).ok).toBe(true);
    expect(buildListeningPartyBody(draft({ startsAtMs: NOW + 30 * 24 * HOUR - 60_000 }), NOW).ok).toBe(true);
    expect(buildListeningPartyBody(draft({ durationMin: 5 }), NOW).ok).toBe(true);
    expect(buildListeningPartyBody(draft({ durationMin: 240 }), NOW).ok).toBe(true);
  });
});

describe("the error copy", () => {
  it("names a taken slot plainly, whatever the server's phrasing", () => {
    expect(listeningPartyErrorCopy(409, { error: "SLOT_TAKEN", message: "That room already has an event in that window." })).toContain("already booked");
  });
  it("passes the server's rule message through for window and payload refusals", () => {
    expect(listeningPartyErrorCopy(400, { error: "INVALID_WINDOW", message: "An event slot is at most 4 hours." })).toBe("An event slot is at most 4 hours.");
    expect(listeningPartyErrorCopy(400, { error: "INVALID_PAYLOAD", message: "A listening party needs a queue." })).toBe("A listening party needs a queue.");
  });
  it("falls back honestly when the server sent nothing usable", () => {
    expect(listeningPartyErrorCopy(500, null)).toContain("didn't land");
    expect(listeningPartyErrorCopy(401, {})).toContain("Sign in");
  });
});

describe("the mine normalizer", () => {
  const dto = (over: Record<string, unknown> = {}) => ({
    id: "evt-1",
    kind: "listening_party",
    roomId: "world:music-hall",
    title: "Album Night",
    startsAt: new Date(NOW + HOUR).toISOString(),
    endsAt: new Date(NOW + 2 * HOUR).toISOString(),
    status: "scheduled",
    payload: { trackIds: ["track:a", "track:b"], playlistId: null },
    ...over,
  });

  it("keeps only my upcoming Music Hall parties, soonest first, with the queue size", () => {
    const out = normalizeMyParties(
      {
        events: [
          dto({ id: "later", startsAt: new Date(NOW + 5 * HOUR).toISOString(), endsAt: new Date(NOW + 6 * HOUR).toISOString() }),
          dto(),
          dto({ id: "show", kind: "stage_show", roomId: "world:throne-hall" }),
          dto({ id: "over", endsAt: new Date(NOW - HOUR).toISOString() }),
          dto({ id: "done", status: "done" }),
          dto({ id: "cancelled", status: "cancelled" }),
        ],
      },
      NOW,
    );
    expect(out.map((p) => p.id)).toEqual(["evt-1", "later"]);
    expect(out[0]).toMatchObject({ title: "Album Night", status: "scheduled", trackCount: 2 });
  });

  it("keeps a live party whose end is still ahead; garbage reads empty", () => {
    expect(normalizeMyParties({ events: [dto({ status: "live" })] }, NOW)).toHaveLength(1);
    expect(normalizeMyParties(null, NOW)).toEqual([]);
    expect(normalizeMyParties({ events: [null, 42, {}] }, NOW)).toEqual([]);
  });
});

describe("the playlist fold", () => {
  const track = (id: string, over: Partial<StreamTrack> = {}): StreamTrack => ({
    id,
    profile_id: "p1",
    title: `Track ${id.slice(0, 4)}`,
    audio_url: "https://example.invalid/a.mp3",
    artwork_url: null,
    genre: null,
    tags: null,
    duration_sec: 200,
    download_price_cents: null,
    play_count: 0,
    like_count: 0,
    repost_count: 0,
    comment_count: 0,
    is_published: true,
    ...over,
  });
  const video = (id: string): StreamVideo => ({
    id,
    profile_id: "p1",
    title: "A video",
    video_url: "https://example.invalid/v.mp4",
    thumbnail_url: null,
    duration_sec: 60,
    description: null,
    view_count: 0,
    like_count: 0,
    comment_count: 0,
    is_published: true,
  });
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const playlist = (resolved_items: StreamPlaylist["resolved_items"]): StreamPlaylist => ({
    id: "pl-1",
    owner_profile_id: "p1",
    title: "Mix",
    description: null,
    cover_url: null,
    is_public: false,
    items: [],
    follower_count: 0,
    resolved_items,
  });

  it("folds tracks in order to catalog ids; videos and unpublished stay behind, counted", () => {
    const fold = playlistQueueFold(
      playlist([
        { kind: "track", item: track(uuid(1)) },
        { kind: "video", item: video(uuid(2)) },
        { kind: "track", item: track(uuid(3), { is_published: false }) },
        { kind: "track", item: track(uuid(4)) },
        { kind: "track", item: track(uuid(1)) },
      ]),
    );
    expect(fold.items.map((i) => i.id)).toEqual([`track:${uuid(1)}`, `track:${uuid(4)}`]);
    expect(fold.items[0]).toMatchObject({ durationSec: 200 });
    expect(fold.skipped).toBe(3);
  });

  it("caps the fold at the party queue max", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      kind: "track" as const,
      item: track(uuid(i + 1)),
    }));
    const fold = playlistQueueFold(playlist(many));
    expect(fold.items).toHaveLength(PARTY_QUEUE_MAX);
    expect(fold.skipped).toBe(5);
  });
});

describe("the start-time input", () => {
  it("defaults to the next full hour and round-trips through the input value", () => {
    const v = partyStartInputValue(new Date("2026-10-18T12:34:56").getTime());
    expect(v).toBe("2026-10-18T13:00");
    expect(parsePartyStartInput(v)).toBe(new Date("2026-10-18T13:00").getTime());
    expect(toLocalInputValue(new Date("2026-01-05T09:05").getTime())).toBe("2026-01-05T09:05");
  });
  it("reads an empty or malformed value as null, never NaN", () => {
    expect(parsePartyStartInput("")).toBeNull();
    expect(parsePartyStartInput("not-a-date")).toBeNull();
  });
});

describe("wiring pins — the Music Hall panel walks the whole loop", () => {
  const panel = readFileSync(
    resolve(__dirname, "../../components/world/StationPanel.tsx"),
    "utf8",
  );

  it("renders the running party's banner from the jukebox state", () => {
    expect(panel).toContain("world-jukebox-party");
    expect(panel).toContain("jukebox.party.title");
    expect(panel).toContain("jukebox.party.hostName");
  });

  it("books through the events route with the builder's body, and lists + cancels mine", () => {
    expect(panel).toContain('fetch("/api/world/events"');
    expect(panel).toContain('method: "POST"');
    expect(panel).toContain("buildListeningPartyBody");
    expect(panel).toContain('fetch("/api/world/events/mine"');
    expect(panel).toContain('method: "DELETE"');
    expect(panel).toContain("world-party-submit");
    expect(panel).toContain("world-party-cancel");
  });

  it("builds the queue from the room's own catalog and the site's playlist rails", () => {
    expect(panel).toContain('fetch("/api/playlists/mine"');
    expect(panel).toContain("fetchPlaylist");
    expect(panel).toContain("playlistQueueFold");
    expect(panel).toContain("togglePartyQueueItem");
  });

  it("guests get the pitch, never the form (the section returns before any booking UI)", () => {
    const guestReturn = panel.indexOf("Members book this hall for an hour");
    const form = panel.indexOf("world-party-submit");
    expect(guestReturn).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(guestReturn);
    expect(panel).toContain("if (isGuest)");
  });
});
