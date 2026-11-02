import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EVENTS_PATH,
  buildEventCreateBody,
  eventCreateReady,
  eventKindLabel,
  eventRsvpPath,
  eventUnrsvpPath,
  eventWhenLabel,
  normalizeWorldEvents,
  rsvpLanded,
  type EventCreateForm,
} from "./events-desk";

/* ─── Events desk (stack1100 world parity) ─────────────────────────
   The Community Hall's events section rides the community router's
   own /api/events rails — the same endpoints pages/events.tsx
   calls. These tests pin the seam: the snake_case DTO normalized
   once, the create body built field-for-field like the page's, and
   the RSVP outcome read from the rail's own status (201 new /
   409 already-on-the-list both mean the server holds the RSVP). */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const DTO = {
  id: "ev-1",
  profile_id: "prof-1",
  title: "Midnight Drop Party",
  description: "New single, live first listen.",
  starts_at: "2026-11-06T19:00:00.000Z",
  kind: "drop",
  cover_url: "https://cdn.example/cover.png",
  destination_url: "https://bowdownvisuals.com/go-live",
  ticket_url: null,
  rsvp_count: 42,
  created_at: "2026-10-30T00:00:00.000Z",
  host: { slug: "trgdy", display_name: "TRGDY TRBLZ", avatar_url: null },
};

describe("events rails", () => {
  it("the paths are the events page's own endpoints", () => {
    expect(EVENTS_PATH).toBe("/api/events");
    expect(eventRsvpPath("ev-1")).toBe("/api/events/ev-1/rsvp");
    expect(eventUnrsvpPath("ev-1")).toBe("/api/events/ev-1/unrsvp");
    expect(eventRsvpPath("a b/c")).toBe("/api/events/a%20b%2Fc/rsvp");
  });
});

describe("normalizeWorldEvents", () => {
  it("maps the snake_case DTO field-for-field, host card joined", () => {
    expect(normalizeWorldEvents({ events: [DTO] })).toEqual([
      {
        id: "ev-1",
        title: "Midnight Drop Party",
        description: "New single, live first listen.",
        kind: "drop",
        startsAt: "2026-11-06T19:00:00.000Z",
        coverUrl: "https://cdn.example/cover.png",
        destinationUrl: "https://bowdownvisuals.com/go-live",
        ticketUrl: null,
        rsvpCount: 42,
        hostName: "TRGDY TRBLZ",
        hostSlug: "trgdy",
      },
    ]);
  });

  it("a genuinely empty board is an empty list, not a failure", () => {
    expect(normalizeWorldEvents({ events: [] })).toEqual([]);
  });

  it("a payload that isn't the rail's shape is a failed attempt (null), never an empty board", () => {
    expect(normalizeWorldEvents(null)).toBeNull();
    expect(normalizeWorldEvents({})).toBeNull();
    expect(normalizeWorldEvents({ events: "nope" })).toBeNull();
    expect(normalizeWorldEvents({ events: [{ id: "x" }] })).toBeNull();
    expect(normalizeWorldEvents({ events: [DTO, { ...DTO, title: 7 }] })).toBeNull();
  });

  it("a row without a host card still reads, with null host fields", () => {
    const { host: _host, ...noHost } = DTO;
    const [ev] = normalizeWorldEvents({ events: [noHost] })!;
    expect(ev!.hostName).toBeNull();
    expect(ev!.hostSlug).toBeNull();
  });
});

describe("kind + when labels", () => {
  it("kinds carry the page's labels; an unknown kind reads plainly", () => {
    expect(eventKindLabel("stream")).toBe("Stream");
    expect(eventKindLabel("premiere")).toBe("Premiere");
    expect(eventKindLabel("mystery")).toBe("Event");
  });

  it("the when-line is a real day + time, and an unparseable stamp passes through untouched", () => {
    const label = eventWhenLabel("2026-11-06T19:00:00.000Z");
    expect(label).toContain("·");
    expect(label).not.toContain("Invalid Date");
    expect(eventWhenLabel("not-a-date")).toBe("not-a-date");
  });
});

describe("create form", () => {
  const ready: EventCreateForm = {
    title: "Listening Party",
    description: "",
    startsAtLocal: "2026-11-06T19:00",
    kind: "stream",
    destinationUrl: "",
    ticketUrl: "",
  };

  it("readiness mirrors the rail's rules (title 1–120, real date, enum kind)", () => {
    expect(eventCreateReady(ready)).toBe(true);
    expect(eventCreateReady({ ...ready, title: "  " })).toBe(false);
    expect(eventCreateReady({ ...ready, title: "x".repeat(121) })).toBe(false);
    expect(eventCreateReady({ ...ready, startsAtLocal: "" })).toBe(false);
    expect(eventCreateReady({ ...ready, kind: "rave" })).toBe(false);
  });

  it("the body is the page's own shape — trimmed, ISO instant, null-or-link URLs", () => {
    expect(
      buildEventCreateBody({
        ...ready,
        title: "  Listening Party  ",
        description: "  bring ears  ",
        destinationUrl: "  https://example.com/live ",
        ticketUrl: " ",
      }),
    ).toEqual({
      title: "Listening Party",
      description: "bring ears",
      starts_at: new Date("2026-11-06T19:00").toISOString(),
      kind: "stream",
      destination_url: "https://example.com/live",
      ticket_url: null,
    });
  });
});

describe("rsvp outcome", () => {
  it("201 (new) and 409 (already on it) both mean the server holds the RSVP", () => {
    expect(rsvpLanded(201)).toBe(true);
    expect(rsvpLanded(409)).toBe(true);
    expect(rsvpLanded(200)).toBe(false);
    expect(rsvpLanded(403)).toBe(false);
    expect(rsvpLanded(500)).toBe(false);
  });
});

describe("the desk is mounted in the Hall and rides the seam", () => {
  const deskSrc = read("../../components/world/native/EventsDesk.tsx");
  const panelSrc = read("../../components/world/StationPanel.tsx");

  it("the panel opens the desk from the community-hall branch (the controller path)", () => {
    const hallAt = panelSrc.indexOf('station.id === "community-hall"');
    const deskAt = panelSrc.indexOf("<EventsDesk");
    const gamesAt = panelSrc.indexOf('resolution.pattern === "games"');
    expect(hallAt).toBeGreaterThan(-1);
    expect(deskAt).toBeGreaterThan(hallAt);
    expect(deskAt).toBeLessThan(gamesAt);
    /* world-perf round 2: the desk rides its own chunk behind the
       panel's lazy door — the door is the wiring now. */
    expect(panelSrc).toContain('lazy(() => import("@/components/world/native/EventsDesk")');
  });

  it("the desk renders honest states and lands its verbs on the seam's rails", () => {
    expect(deskSrc).toContain('data-testid="world-events-desk"');
    expect(deskSrc).toContain("NativeErrorState");
    expect(deskSrc).toContain("NativeEmptyState");
    expect(deskSrc).toContain("eventRsvpPath(ev.id)");
    expect(deskSrc).toContain("eventUnrsvpPath(ev.id)");
    expect(deskSrc).toContain("buildEventCreateBody(form)");
    /* Guests get the pitch, never the member verbs. */
    expect(deskSrc).toContain("GUEST_SIGN_IN_HREF");
  });
});
