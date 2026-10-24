/**
 * Fan segments — route contract (fan-graph phase 2).
 *
 * The REAL router runs over HTTP with the graph loader, the saved
 * store, and the desk-send orchestration mocked at the module edge.
 * Pins:
 *   - presets come back with LIVE counts + previews computed from
 *     the caller's graph (the loader is called with the caller id);
 *   - saved CRUD is owner-scoped (another creator's segment id is a
 *     404, never a leak) and fails HONESTLY pre-migration: the store
 *     unavailable error maps to 503 fan_segments_not_ready while
 *     presets/preview/send keep working;
 *   - preview resolves preset / saved / ad-hoc refs and refuses bad
 *     rules + unknown presets;
 *   - send resolves the ref, then hands {creator, list, rules,
 *     subject, body} to lib/fan-segment-send — the desk handoff —
 *     and surfaces its matched/mailable/not-mailable accounting;
 *   - signed-out callers get 401 before anything runs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const auth = vi.hoisted(() => ({ userId: "" as string }));
const graphState = vi.hoisted(() => ({ fans: [] as any[] }));
const storeState = vi.hoisted(() => ({
  available: true,
  rows: new Map<string, any>(),
}));
const sendState = vi.hoisted(() => ({
  calls: [] as any[],
  result: null as any,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    req.userId = auth.userId;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/fan-graph", () => ({
  loadFanGraph: async (creatorUserId: string) => {
    if (creatorUserId !== auth.userId) throw new Error("graph loaded for a non-caller");
    return { fans: graphState.fans, summary: {} };
  },
}));

vi.mock("../../../lib/fan-segment-store", () => {
  class FanSegmentsUnavailableError extends Error {
    code = "fan_segments_unavailable" as const;
    constructor() {
      super("unavailable");
      this.name = "FanSegmentsUnavailableError";
    }
  }
  const guard = () => {
    if (!storeState.available) throw new FanSegmentsUnavailableError();
  };
  return {
    FanSegmentsUnavailableError,
    listFanSegments: async (userId: string) => {
      guard();
      return [...storeState.rows.values()].filter((r) => r.userId === userId).map(({ userId: _u, ...rest }) => rest);
    },
    getFanSegment: async (userId: string, id: string) => {
      guard();
      const row = storeState.rows.get(id);
      return row && row.userId === userId ? { id: row.id, name: row.name, rules: row.rules, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
    },
    createFanSegment: async (userId: string, name: string, rules: any) => {
      guard();
      const row = { id: `seg-${storeState.rows.size + 1}`, userId, name, rules, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" };
      storeState.rows.set(row.id, row);
      return { id: row.id, name, rules, createdAt: row.createdAt, updatedAt: row.updatedAt };
    },
    updateFanSegment: async (userId: string, id: string, patch: any) => {
      guard();
      const row = storeState.rows.get(id);
      if (!row || row.userId !== userId) return null;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.rules !== undefined) row.rules = patch.rules;
      return { id: row.id, name: row.name, rules: row.rules, createdAt: row.createdAt, updatedAt: row.updatedAt };
    },
    deleteFanSegment: async (userId: string, id: string) => {
      guard();
      const row = storeState.rows.get(id);
      if (!row || row.userId !== userId) return false;
      storeState.rows.delete(id);
      return true;
    },
  };
});

vi.mock("../../../lib/fan-segment-send", () => ({
  sendFanSegmentEmail: async (args: any) => {
    sendState.calls.push(args);
    return sendState.result;
  },
}));

import fanSegmentsRouter from "../fan-segments";

const A = "creator-a";
const B = "creator-b";
const LIST_ID = "123e4567-e89b-12d3-a456-426614174000";

function fan(partial: Record<string, any>) {
  return {
    id: "u:x", userId: "x", emails: [], email: null, displayName: null, profileSlug: null,
    avatarUrl: null, follows: false, followingSince: null, subscribed: false, unsubscribed: false,
    member: null, spentUsdCents: 0, spentVb: 0, purchaseCount: 0, lastActivityAt: null, sources: [],
    ...partial,
  };
}

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", fanSegmentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  auth.userId = A;
  storeState.available = true;
  storeState.rows.clear();
  sendState.calls = [];
  sendState.result = null;
  graphState.fans = [
    fan({ id: "e:bea@x.io", emails: ["bea@x.io"], email: "bea@x.io", purchaseCount: 1, spentUsdCents: 4000, subscribed: true }),
    fan({ id: "u:ada", userId: "ada", follows: true, purchaseCount: 1, spentUsdCents: 2500 }),
    fan({ id: "e:fay@x.io", emails: ["fay@x.io"], email: "fay@x.io", subscribed: true }),
  ];
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

describe("GET /email-list/fan-segments", () => {
  it("returns presets with live counts + previews from the caller's graph", async () => {
    const { status, body } = await call("GET", "/email-list/fan-segments");
    expect(status).toBe(200);
    const buyers = body.presets.find((p: any) => p.id === "buyers-not-followers");
    expect(buyers.count).toBe(1); // Bea — Ada follows, Fay never bought
    expect(buyers.preview[0].id).toBe("e:bea@x.io");
    const top = body.presets.find((p: any) => p.id === "top-spenders");
    expect(top.count).toBe(2);
    expect(body.savedAvailable).toBe(true);
    expect(body.saved).toEqual([]);
  });

  it("pre-migration (store unavailable): presets still serve, saved reports unavailable honestly", async () => {
    storeState.available = false;
    const { status, body } = await call("GET", "/email-list/fan-segments");
    expect(status).toBe(200);
    expect(body.savedAvailable).toBe(false);
    expect(body.saved).toEqual([]);
    expect(body.presets.length).toBeGreaterThan(0);
  });
});

describe("saved CRUD", () => {
  const rules = { buyer: "yes", follows: "no" };

  it("creates, lists with live count, patches, and deletes — owner-scoped", async () => {
    const created = await call("POST", "/email-list/fan-segments", { name: "Warm buyers", rules });
    expect(created.status).toBe(201);
    expect(created.body.segment.count).toBe(1);
    const id = created.body.segment.id;

    const list = await call("GET", "/email-list/fan-segments");
    expect(list.body.saved.map((s: any) => s.id)).toEqual([id]);

    // Another creator cannot see it, patch it, or delete it.
    auth.userId = B;
    const otherList = await call("GET", "/email-list/fan-segments");
    expect(otherList.body.saved).toEqual([]);
    expect((await call("PATCH", `/email-list/fan-segments/${id}`, { name: "Hijack" })).status).toBe(404);
    expect((await call("DELETE", `/email-list/fan-segments/${id}`)).status).toBe(404);

    auth.userId = A;
    const patched = await call("PATCH", `/email-list/fan-segments/${id}`, { name: "Warmer buyers" });
    expect(patched.status).toBe(200);
    expect(patched.body.segment.name).toBe("Warmer buyers");
    expect((await call("DELETE", `/email-list/fan-segments/${id}`)).status).toBe(200);
    expect((await call("DELETE", `/email-list/fan-segments/${id}`)).status).toBe(404);
  });

  it("refuses invalid rules (400) and answers 503 pre-migration", async () => {
    expect((await call("POST", "/email-list/fan-segments", { name: "Bad", rules: { follows: "sometimes" } })).status).toBe(400);
    storeState.available = false;
    const res = await call("POST", "/email-list/fan-segments", { name: "Later", rules });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("fan_segments_not_ready");
  });
});

describe("preview", () => {
  it("resolves a preset, an ad-hoc rule set, and refuses an unknown preset", async () => {
    const preset = await call("POST", "/email-list/fan-segments/preview", { presetId: "top-spenders" });
    expect(preset.status).toBe(200);
    expect(preset.body.count).toBe(2);
    const adhoc = await call("POST", "/email-list/fan-segments/preview", { rules: { subscribed: "yes", buyer: "no" } });
    expect(adhoc.body.count).toBe(1);
    expect(adhoc.body.preview[0].id).toBe("e:fay@x.io");
    expect((await call("POST", "/email-list/fan-segments/preview", { presetId: "nope" })).status).toBe(400);
    expect((await call("POST", "/email-list/fan-segments/preview", { rules: { member: "vip" } })).status).toBe(400);
  });
});

describe("send — the desk handoff", () => {
  it("hands the resolved rules + caller + list to lib/fan-segment-send and surfaces its accounting", async () => {
    sendState.result = {
      ok: true,
      campaign: { id: "camp-1", status: "sent", kind: "fan_segment" },
      dispatch: { ok: true, audience: 1, sent: 1, failed: 0 },
      segment: { audience: [{ id: "s-bea", email: "bea@x.io" }], matchedFans: 1, notMailable: { noEmail: 0, notSubscribed: 0, unsubscribed: 0 } },
    };
    const res = await call("POST", "/email-list/fan-segments/send", {
      presetId: "buyers-not-followers",
      listId: LIST_ID,
      subject: "Miss you",
      body: "Come back",
    });
    expect(res.status).toBe(201);
    expect(sendState.calls).toHaveLength(1);
    expect(sendState.calls[0].creatorUserId).toBe(A);
    expect(sendState.calls[0].listId).toBe(LIST_ID);
    expect(sendState.calls[0].rules.buyer).toBe("yes");
    expect(sendState.calls[0].rules.follows).toBe("no");
    expect(res.body.segment.matchedFans).toBe(1);
    expect(res.body.segment.mailable).toBe(1);
    expect(res.body.campaign.kind).toBe("fan_segment");
  });

  it("maps a foreign list to 404 and validates the payload", async () => {
    sendState.result = { ok: false, code: "list_not_found", error: "List not found." };
    const res = await call("POST", "/email-list/fan-segments/send", {
      presetId: "top-spenders", listId: LIST_ID, subject: "Hi", body: "B",
    });
    expect(res.status).toBe(404);
    const bad = await call("POST", "/email-list/fan-segments/send", { presetId: "top-spenders", listId: "not-a-uuid", subject: "Hi", body: "B" });
    expect(bad.status).toBe(400);
  });
});

describe("auth", () => {
  it("rejects a signed-out caller on every door", async () => {
    auth.userId = "";
    expect((await call("GET", "/email-list/fan-segments")).status).toBe(401);
    expect((await call("POST", "/email-list/fan-segments/preview", { presetId: "top-spenders" })).status).toBe(401);
    expect((await call("POST", "/email-list/fan-segments/send", { presetId: "top-spenders", listId: LIST_ID, subject: "Hi", body: "B" })).status).toBe(401);
  });
});
