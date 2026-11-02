/**
 * nfc-cards-tap.test.ts — tap_count atomicity (stack1200 C8 leftover).
 *
 * The defect: GET /api/nfc-cards/profile/:slug counted a tap
 * read-then-write — it wrote back (the tap_count its own SELECT had
 * returned) + 1. Two concurrent taps read the same value and both
 * wrote value + 1, so one tap was silently lost.
 *
 * The fix: the route fire-and-forgets incrementNfcTapCount()
 * (lib/nfc-tap), which calls the increment_nfc_tap RPC
 * (supabase/migrations/0064) — a single
 * UPDATE ... SET tap_count = tap_count + 1 inside Postgres.
 *
 * WHAT THE HARNESS PROVES, HONESTLY: the fake Supabase client below
 * models PostgREST semantics the way bonus-claims.test.ts does — an
 * .rpc() increment is applied as ONE synchronous step (the atomicity
 * a single Postgres UPDATE statement has), while a SELECT captures
 * the row at call time and an .update() applies the caller's absolute
 * value when the builder is awaited/.then()ed. The CONTROL test
 * reproduces the pre-fix read-then-write shape against this fake and
 * loses 24 of 25 increments, which is what makes the green tests on
 * the fixed path meaningful. (Route-level parallel fetches may
 * serialize inside one test process, so the deterministic race
 * proofs are the CONTROL and the helper-level Promise.all; the route
 * tests pin the wiring, the response semantics, and that the door
 * goes through the RPC at all — against the pre-fix route they fail
 * on rpcCalls === 0.) What it cannot model: real Postgres row
 * locking, PostgREST network interleaving, or the deployed state of
 * the live Supabase project (0064 must still be run once in the SQL
 * Editor; until then the helper's legacy fallback is what runs —
 * pinned by the fallback test below, which is the old racy shape and
 * is only correct here because a single tap has nothing to race).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  state: {
    profiles: new Map<string, Row>(),
    /** increment_nfc_tap behavior: "ok" | "missing" (PGRST202) | "error". */
    rpcMode: "ok" as string,
    rpcCalls: [] as Array<{ fn: string; args: Row }>,
    /** nfc_profiles .update() invocations — the read-then-write tell. */
    updateCalls: 0,
  },
}));

function project(row: Row, cols: string): Row {
  if (cols.trim() === "*") return { ...row };
  const out: Row = {};
  for (const c of cols.split(",").map((s) => s.trim())) out[c] = row[c] ?? null;
  return out;
}

/** Fake PostgREST client over an in-memory nfc_profiles store. */
function makeFakeSupabase() {
  const store = h.state.profiles;
  return {
    rpc: (fn: string, args: Row) => {
      h.state.rpcCalls.push({ fn, args });
      if (h.state.rpcMode === "missing") {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST202",
            message:
              "Could not find the function public.increment_nfc_tap(p_slug) in the schema cache",
          },
        });
      }
      if (h.state.rpcMode === "error") {
        return Promise.resolve({
          data: null,
          error: { code: "XX000", message: "internal error" },
        });
      }
      // Atomic: the whole increment is one synchronous step, exactly
      // like a single UPDATE ... SET tap_count = tap_count + 1.
      const row = store.get(args["p_slug"] as string);
      if (!row) return Promise.resolve({ data: null, error: null });
      row["tap_count"] = ((row["tap_count"] as number) ?? 0) + 1;
      row["updated_at"] = new Date().toISOString();
      return Promise.resolve({ data: row["tap_count"], error: null });
    },
    from: (_table: string) => ({
      select: (cols: string) => {
        const filters: Array<[string, unknown]> = [];
        const chain: Row = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          maybeSingle: () => {
            // Capture the row NOW (call time), like a real query
            // executing when issued — this is what makes the old
            // read-then-write shape lose races in the control test.
            const slug = filters.find(([c]) => c === "slug")?.[1] as string;
            const row = store.get(slug);
            const ok =
              row && filters.every(([c, v]) => row[c] === v);
            return Promise.resolve({
              data: ok ? project(row, cols) : null,
              error: null,
            });
          },
        };
        return chain;
      },
      update: (patch: Row) => {
        h.state.updateCalls++;
        const filters: Array<[string, unknown]> = [];
        const apply = () => {
          for (const row of store.values()) {
            if (filters.every(([c, v]) => row[c] === v)) Object.assign(row, patch);
          }
          return { data: null, error: null };
        };
        const chain: Row = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          // PostgREST builders execute when awaited/.then()ed.
          then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
            Promise.resolve().then(() => apply()).then(onF, onR),
        };
        return chain;
      },
    }),
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "test-user";
    next();
  },
}));

vi.mock("../admin", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async () => null,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (u: string) => u,
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makeFakeSupabase(),
}));

import nfcCardsRouter from "../nfc-cards";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { incrementNfcTapCount } from "../../lib/nfc-tap";

const SLUG = "king-card-abc123";

function seedProfile(tapCount: number, over: Row = {}) {
  h.state.profiles.set(SLUG, {
    id: "00000000-0000-4000-8000-000000000001",
    slug: SLUG,
    user_id: "test-user",
    display_name: "King",
    title: null,
    bio: null,
    avatar_url: null,
    links: [],
    theme: "gold-black",
    tap_count: tapCount,
    is_active: true,
    ...over,
  });
}

function storedCount(): number {
  return h.state.profiles.get(SLUG)?.["tap_count"] as number;
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(nfcCardsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.state.profiles.clear();
  h.state.rpcCalls = [];
  h.state.updateCalls = 0;
  h.state.rpcMode = "ok";
});

describe("incrementNfcTapCount — the fixed path", () => {
  it("N parallel increments all land (final = initial + N), pure RPC, zero read-then-write", async () => {
    seedProfile(7);
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, () => incrementNfcTapCount(SLUG, 7)),
    );
    expect(storedCount()).toBe(7 + N);
    // Every caller got a distinct, monotonically covering new count.
    expect(new Set(results).size).toBe(N);
    expect(Math.max(...(results as number[]))).toBe(7 + N);
    expect(h.state.rpcCalls).toHaveLength(N);
    expect(
      h.state.rpcCalls.every(
        (c) => c.fn === "increment_nfc_tap" && c.args["p_slug"] === SLUG,
      ),
    ).toBe(true);
    expect(h.state.updateCalls).toBe(0);
  });

  it("unknown slug returns null and creates no row", async () => {
    const out = await incrementNfcTapCount("no-such-card", 0);
    expect(out).toBeNull();
    expect(h.state.profiles.has("no-such-card")).toBe(false);
  });

  it("non-missing RPC errors propagate (never masked by the fallback)", async () => {
    seedProfile(5);
    h.state.rpcMode = "error";
    await expect(incrementNfcTapCount(SLUG, 5)).rejects.toThrow();
    expect(storedCount()).toBe(5);
    expect(h.state.updateCalls).toBe(0);
  });
});

describe("CONTROL — the harness can lose increments (pre-fix shape)", () => {
  it("read-then-write with all reads first lands only one of 25 increments", async () => {
    seedProfile(7);
    const client: any = getSupabaseAdmin();
    const N = 25;
    // The pre-fix shape, verbatim: read tap_count, write read + 1.
    const reads: number[] = [];
    for (let i = 0; i < N; i++) {
      const { data } = await client
        .from("nfc_profiles")
        .select("tap_count")
        .eq("slug", SLUG)
        .maybeSingle();
      reads.push(data.tap_count);
    }
    await Promise.all(
      reads.map((v) =>
        client
          .from("nfc_profiles")
          .update({ tap_count: v + 1, updated_at: new Date().toISOString() })
          .eq("slug", SLUG),
      ),
    );
    expect(reads.every((v) => v === 7)).toBe(true);
    expect(storedCount()).toBe(8); // 24 of 25 taps lost — the C8 race.
  });
});

describe("GET /nfc-cards/profile/:slug — tap door", () => {
  it("one tap: 200, response carries the profile AS READ (pre-increment count), store moves +1 via RPC", async () => {
    seedProfile(41);
    const res = await fetch(`${base}/nfc-cards/profile/${SLUG}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.profile.tap_count).toBe(41);
    await flush();
    expect(storedCount()).toBe(42);
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.state.updateCalls).toBe(0);
  });

  it("10 parallel taps all land", async () => {
    seedProfile(0);
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => fetch(`${base}/nfc-cards/profile/${SLUG}`)),
    );
    for (const r of rs) expect(r.status).toBe(200);
    await flush();
    expect(storedCount()).toBe(10);
    expect(h.state.rpcCalls).toHaveLength(10);
  });

  it("missing profile: 404 and no tap is counted", async () => {
    const res = await fetch(`${base}/nfc-cards/profile/does-not-exist`);
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body).toEqual({ ok: false, error: "Card not found" });
    await flush();
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("inactive profile: 404 and no tap is counted", async () => {
    seedProfile(3, { is_active: false });
    const res = await fetch(`${base}/nfc-cards/profile/${SLUG}`);
    expect(res.status).toBe(404);
    await flush();
    expect(storedCount()).toBe(3);
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("RPC not yet installed (0064 not run): legacy fallback still counts the tap, loudly the only pre-deploy path", async () => {
    seedProfile(5);
    h.state.rpcMode = "missing";
    const res = await fetch(`${base}/nfc-cards/profile/${SLUG}`);
    expect(res.status).toBe(200);
    await flush();
    expect(storedCount()).toBe(6);
    expect(h.state.updateCalls).toBe(1);
  });

  it("RPC failure (unrelated): tap still serves 200, count untouched, fallback does NOT mask the error", async () => {
    seedProfile(5);
    h.state.rpcMode = "error";
    const res = await fetch(`${base}/nfc-cards/profile/${SLUG}`);
    expect(res.status).toBe(200);
    await flush();
    expect(storedCount()).toBe(5);
    expect(h.state.updateCalls).toBe(0);
  });
});
