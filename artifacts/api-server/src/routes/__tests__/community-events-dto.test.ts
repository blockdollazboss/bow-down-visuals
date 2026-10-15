/**
 * Route tests for the event DTO contract (routes/community).
 *
 * THE REGRESSION: GET /events spread the raw Drizzle event row and
 * GET /events/:id sent it raw — camelCase table keys (startsAt,
 * coverUrl, rsvpCount, destinationUrl, ticketUrl) — while the frontend
 * contract (pages/events.tsx, pages/event-detail.tsx) is snake_case
 * end to end. rsvp_count was undefined, so rsvp_count.toLocaleString()
 * crashed both pages whenever an upcoming event existed;
 * new Date(e.starts_at) parsed as "Invalid Date"; covers were dead and
 * the ticket + destination links (the page's money path) never
 * rendered. toEventDto now builds the payload field-by-field; these
 * tests pin the snake_case keys AND the absence of the camelCase leaks.
 * The nested host card is hand-built snake_case and rides unchanged.
 *
 * Fake-db style mirrors routes/__tests__/social-feed-dto.test.ts:
 * real table objects via importOriginal, a chainable select whose rows
 * dispatch on table identity. The events queries join profiles, so the
 * fake events rows are the joined shape drizzle returns.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const EVENT_ID = "66666666-6666-4666-8666-666666666666";
const HOST_PROFILE_ID = "77777777-7777-4777-8777-777777777777";
const HOST_USER_ID = "88888888-8888-4888-8888-888888888888";
const STARTS = new Date("2027-01-01T20:00:00.000Z");
const CREATED = new Date("2026-10-01T09:30:00.000Z");

const h = vi.hoisted(() => ({
  state: {
    joined: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = HOST_USER_ID;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { eventsTable } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === eventsTable) return state.joined;
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      innerJoin: (_table: unknown, _cond: unknown) => c,
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../community";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function eventRow(): Record<string, unknown> {
  return {
    id: EVENT_ID,
    profileId: HOST_PROFILE_ID,
    title: "New Year Drop Party",
    description: "Ring it in loud.",
    startsAt: STARTS,
    kind: "drop",
    coverUrl: "https://cdn.example.com/event.jpg",
    destinationUrl: "https://example.com/drop",
    ticketUrl: "https://example.com/tickets",
    rsvpCount: 4321,
    createdAt: CREATED,
  };
}

function joinedRow(): Record<string, unknown> {
  return {
    event: eventRow(),
    hostSlug: "host-creator",
    hostName: "Host Creator",
    hostAvatar: "https://cdn.example.com/host.png",
    hostUserId: HOST_USER_ID,
  };
}

beforeEach(() => {
  h.state.joined = [joinedRow()];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function expectEventDto(event: any) {
  expect(event.id).toBe(EVENT_ID);
  expect(event.profile_id).toBe(HOST_PROFILE_ID);
  expect(event.title).toBe("New Year Drop Party");
  expect(event.description).toBe("Ring it in loud.");
  expect(event.kind).toBe("drop");
  // The regression pins: a parseable start time, the RSVP count, and the
  // ticket / destination money links, all under snake_case.
  expect(event.starts_at).toBe("2027-01-01T20:00:00.000Z");
  expect(Number.isNaN(Date.parse(event.starts_at))).toBe(false);
  expect(event.rsvp_count).toBe(4321);
  expect(typeof event.rsvp_count).toBe("number");
  expect(event.cover_url).toBe("https://cdn.example.com/event.jpg");
  expect(event.destination_url).toBe("https://example.com/drop");
  expect(event.ticket_url).toBe("https://example.com/tickets");
  expect(event.created_at).toBe("2026-10-01T09:30:00.000Z");
  // The camelCase table keys must NOT leak through the DTO.
  expect(event).not.toHaveProperty("profileId");
  expect(event).not.toHaveProperty("startsAt");
  expect(event).not.toHaveProperty("coverUrl");
  expect(event).not.toHaveProperty("destinationUrl");
  expect(event).not.toHaveProperty("ticketUrl");
  expect(event).not.toHaveProperty("rsvpCount");
  expect(event).not.toHaveProperty("createdAt");
}

function expectHost(host: any) {
  // Hand-built snake_case host card — unchanged by the DTO.
  expect(host).toEqual({
    slug: "host-creator",
    display_name: "Host Creator",
    avatar_url: "https://cdn.example.com/host.png",
  });
}

describe("GET /api/events — event DTO contract", () => {
  it("ships snake_case event fields (starts_at, rsvp_count, ticket_url)", async () => {
    const { status, json } = await get("/events");

    expect(status).toBe(200);
    expect(json.events).toHaveLength(1);
    expectEventDto(json.events[0]);
    expectHost(json.events[0].host);
  });
});

describe("GET /api/events/:id — event detail DTO contract", () => {
  it("ships the same snake_case event DTO with viewer state intact", async () => {
    const { status, json } = await get(`/events/${EVENT_ID}`);

    expect(status).toBe(200);
    expectEventDto(json.event);
    expectHost(json.host);
    expect(json.rsvped).toBe(false);
    expect(json.host_is_viewer).toBe(false);
  });
});
