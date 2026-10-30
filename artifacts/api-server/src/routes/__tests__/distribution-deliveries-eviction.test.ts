/**
 * Lane F1 (QC-200 G2) — growth proof for the distribution delivery
 * poller's in-memory map (`activeDeliveries`).
 *
 * Before this lane the map deleted ONLY when every platform reached
 * a terminal status: a delivery whose fetches kept throwing, kept
 * returning empty (adapter lost the job), or never settled was
 * polled every 15s for the life of the process. These tests drive
 * the real register/tick and prove the three bounds (age ceiling,
 * empty-streak, count cap) plus the in-flight guarantees: a live
 * delivery keeps polling, its row keeps receiving statuses, an
 * empty fetch never erases the row's last known statuses, and a
 * completed delivery still leaves the map.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "crypto";

const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = randomUUID();
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 100),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-6-sol",
  getOpenAI: () => ({
    chat: { completions: { create: async () => { throw new Error("unused"); } } },
  }),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v),
  mirrorProjectScenes: vi.fn(async (v: unknown) => v),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

import { __activeDeliveriesForTest } from "../generate/distribution";
import { getAggregator, type AggregatorReleasePayload } from "../../lib/distribution-aggregator";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const { map, register, tick, clear } = __activeDeliveriesForTest;
const MAX_ACTIVE = 5000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function payload(clientReleaseId: string): AggregatorReleasePayload {
  return {
    clientReleaseId,
    title: "Eviction Test Release",
    artistName: "Thy Cheat Code",
    releaseType: "single",
    releaseDate: "2026-10-30",
    explicit: false,
    tracks: [{ title: "Track", audioUrl: "https://example.com/a.mp3", explicit: false }],
    artworkUrl: "https://example.com/art.png",
    platforms: ["spotify"],
  };
}

async function seedRow(id: string, statuses: unknown): Promise<void> {
  await testState.db.execute(sql`
    INSERT INTO distribution_releases (id, platform_statuses)
    VALUES (${id}, ${JSON.stringify(statuses)}::jsonb)
  `);
}

async function readStatuses(id: string): Promise<Array<{ status: string }>> {
  const res = await testState.db.execute(sql`
    SELECT platform_statuses FROM distribution_releases WHERE id = ${id}
  `);
  return (res.rows[0] as any).platform_statuses;
}

describe("activeDeliveries poller map (G2)", () => {
  beforeAll(async () => {
    testState.db = createTestDb().db;
    await testState.db.execute(sql`
      CREATE TABLE distribution_releases (
        id uuid PRIMARY KEY,
        platform_statuses jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  beforeEach(() => {
    clear();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("count cap: a registration flood holds at the cap, oldest evicted first", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_ACTIVE + 100; i++) {
      register(`rel-${i}`, `mock_rel-${i}`, now);
    }
    expect(map.size).toBe(MAX_ACTIVE);
    expect(map.has("rel-0")).toBe(false);
    expect(map.has(`rel-${MAX_ACTIVE + 99}`)).toBe(true);
  });

  it("age ceiling: a delivery registered over 7 days ago leaves on the next tick, no fetch needed", async () => {
    register("rel-ancient", "mock_rel-ancient", Date.now() - SEVEN_DAYS_MS - 1);
    register("rel-fresh", "mock_rel-fresh", Date.now());
    await tick();
    expect(map.has("rel-ancient")).toBe(false);
    // The fresh one was polled (mock has no such job → empty streak 1) and stays.
    expect(map.has("rel-fresh")).toBe(true);
  });

  it("empty streak: 8 consecutive empty fetches evict — and never erase the row's last known statuses", async () => {
    const rowId = randomUUID();
    const sentinel = [{ platform: "spotify", status: "delivered", updatedAt: "2026-10-30T00:00:00.000Z" }];
    await seedRow(rowId, sentinel);
    register(rowId, "mock_no-such-job");
    for (let i = 0; i < 7; i++) await tick();
    expect(map.has(rowId)).toBe(true);
    await tick();
    expect(map.has(rowId)).toBe(false);
    // The old tick wrote [] over the row on every empty fetch; the
    // row must still carry its last real statuses.
    expect(await readStatuses(rowId)).toEqual(sentinel);
  });

  it("in-flight delivery survives ticks, receives statuses, and leaves when terminal", async () => {
    const rowId = randomUUID();
    await seedRow(rowId, []);
    const sub = await getAggregator().submitRelease(payload(`rel-live-${rowId}`));
    register(rowId, sub.aggregatorReleaseId);

    await tick();
    expect(map.has(rowId)).toBe(true);
    const mid = await readStatuses(rowId);
    expect(mid).toHaveLength(1);
    expect(mid[0]?.status).toBe("queued");

    // The mock timeline goes live at +240s; jump the clock past it.
    // Only Date is faked — the DB adapter's async plumbing keeps
    // real timers, so the tick can still complete.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 300_000);
    await tick();
    expect(map.has(rowId)).toBe(false);
    const done = await readStatuses(rowId);
    expect(done[0]?.status).toBe("live");
    vi.useRealTimers();
  });
});
