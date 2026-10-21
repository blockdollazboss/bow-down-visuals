/**
 * Regression guard for the shorts-feed SQL cast defect (Oct 15, 2026).
 *
 * THE DEFECT: the feed query (and three sibling sites) built their array
 * membership test as
 *
 *     cp.slug = ANY(${OFFICIAL_SLUGS}::text[])
 *
 * Drizzle expands a JS array interpolated into sql`` as a TUPLE —
 * ANY(($1, $2, $3)::text[]) — and Postgres rejects the tuple-to-array
 * cast with 42846 "cannot cast type record to text[]". The feed handler
 * caught it and 500'd on EVERY request, signed in or out: /shorts was
 * down in production while the whole fake-db suite stayed green,
 * because the suite never executes the SQL. (Reproduced verbatim in
 * real Postgres/PGlite during the investigation; the ARRAY[...] form
 * executes cleanly against the same hostile rows.)
 *
 * THE FIX: build the array explicitly, the house form (publish.ts):
 *
 *     ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`})
 *
 * which renders ANY(ARRAY[$1, $2, $3]::text[]) — a real array literal.
 *
 * THE GUARD LEVEL, honestly: this repo has no real-execution SQL test
 * harness (no PGlite/testcontainers in the tree) — its established
 * guard for this class is the PgDialect render assertion (precedent:
 * lib/__tests__/retention-claims.test.ts, routes/__tests__/
 * shark-drop-claim.test.ts). These tests therefore drive the REAL
 * handlers over HTTP with a capturing fake db, render the exact SQL
 * objects the handlers hand to db.execute / .where() with PgDialect,
 * and assert the rendered text is the ARRAY form and can never be the
 * tuple-cast form. A repo-wide source-shape assertion covers the one
 * site whose handler is impractical to drive here
 * (challenge-engine's judging transaction) and any future copy of the
 * pattern. Execution proof lives in the investigation reproduction,
 * re-run against the fixed queries before this was committed.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dialect = new PgDialect();
function render(q: unknown): { sql: string; params: unknown[] } {
  const r = dialect.sqlToQuery(q as never);
  return { sql: r.sql, params: r.params as unknown[] };
}

const SHORT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEFAULT_SLUGS = ["bow-down-visuals", "thy-cheat-code", "bowdownvisuals"];

const h = vi.hoisted(() => ({
  VIDEO_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  CREATOR_ID: "11111111-1111-1111-1111-111111111111",
  state: {
    executed: [] as Array<{ sql: string; params: unknown[] }>,
    whereConds: [] as unknown[],
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
}));

/* shorts.ts pulls effectiveStatus from challenge-engine; the status
   helper is not what this file guards — stub it to keep the module
   tree (and its own db chains) out of these tests. */
vi.mock("../challenge-engine", async () => {
  // Stack 8 #4 moved the /challenges/* routes into the engine; shorts.ts
  // imports the shared helpers from it — the stub must carry those names
  // or the module tree fails to link. (Wave 3 #12: shorts no longer
  // mounts the engine's default router; the stub's default export is
  // retained only so the mock mirrors the real module's shape.)
  // Behavior under test here is unchanged.
  const { Router } = await import("express");
  return {
    effectiveStatus: (c: any) => c?.status ?? "live",
    optionalViewerId: async () => null,
    slugify: (s: string, max = 48) =>
      s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, max) || "untitled",
    requireOwnProfile: async () => null,
    toChallengeDto: (r: any) => r,
    default: Router(),
  };
});

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (u: unknown) => u,
}));

/* Simulated refresh with the real helper's contract (storage refs
   become signed https URLs; everything else passes through) — never
   an identity mock. */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}
async function deepRefresh(v: unknown): Promise<unknown> {
  if (typeof v === "string") {
    return v.startsWith("r2://") || v.startsWith("supabase://") ? signedFor(v) : v;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => deepRefresh(x)));
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const entries = await Promise.all(
        Object.entries(v as Record<string, unknown>).map(
          async ([k, val]) => [k, await deepRefresh(val)] as const,
        ),
      );
      return Object.fromEntries(entries);
    }
  }
  return v;
}
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? signedFor(v)
      : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { profileVideosTable, creatorProfilesTable } = actual;

  const videoRow = {
    id: h.VIDEO_ID,
    title: "A duet child",
    videoUrl: "https://storage.example.com/clips/duet.mp4",
    thumbnailUrl: null,
    viewCount: 10,
    likeCount: 2,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    profileId: h.CREATOR_ID,
  };
  const creatorRow = {
    id: h.CREATOR_ID,
    slug: "thy-cheat-code",
    displayName: "Thy Cheat Code",
    avatarUrl: null,
  };

  function rowsFor(table: unknown): Array<Record<string, unknown>> {
    if (table === profileVideosTable) return [videoRow];
    if (table === creatorProfilesTable) return [creatorRow];
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (cond: unknown) => {
        state.whereConds.push(cond);
        return c;
      },
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
    execute: async (q: unknown) => {
      state.executed.push(render(q));
      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../shorts";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.executed.length = 0;
  h.state.whereConds.length = 0;
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* assertions on status will surface it */
  }
  return { status: r.status, text, json };
}

/** The two faces of the defect class, asserted on rendered SQL. */
function expectArrayForm(sqlText: string, cast: "text[]" | "uuid[]") {
  expect(sqlText).toContain(`ANY(ARRAY[`);
  expect(sqlText).toContain(`]::${cast})`);
  // The tuple expansion ANY(($1, $2, ...)::type[]) is what Postgres
  // rejects with 42846 — it must be structurally impossible here.
  expect(sqlText).not.toMatch(/ANY\(\(\$/);
  expect(sqlText).not.toMatch(/\)::(text|uuid)\[\]\)/);
}

describe("shorts feed SQL — array membership must render as ARRAY[...], never a tuple cast", () => {
  it("GET /shorts/feed emits ANY(ARRAY[$1..$3]::text[]) with binding order preserved", async () => {
    const res = await get("/shorts/feed");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ items: [], next_cursor: null });

    expect(h.state.executed).toHaveLength(1);
    const q = h.state.executed[0]!;
    expectArrayForm(q.sql, "text[]");
    // Binding order, exactly as the pre-fix query bound: the three
    // official slugs first (in order), viewerId twice (follow + like
    // joins — null for this signed-out request), LIMIT last.
    expect(q.params.slice(0, 3)).toEqual(DEFAULT_SLUGS);
    expect(q.params[3]).toBeNull();
    expect(q.params[4]).toBeNull();
    expect(q.params[q.params.length - 1]).toBe(11);
  });

  it("GET /shorts/:id emits the same ARRAY form (this site failed silently client-side)", async () => {
    const res = await get(`/shorts/${SHORT_ID}`);
    // Empty rows -> the handler's own 404. A 500 here would mean the
    // query blew up before shaping — the silent failure mode.
    expect(res.status).toBe(404);

    expect(h.state.executed).toHaveLength(1);
    const q = h.state.executed[0]!;
    expectArrayForm(q.sql, "text[]");
    expect(q.params.slice(0, 3)).toEqual(DEFAULT_SLUGS);
    expect(q.params[3]).toBeNull();
    expect(q.params[4]).toBeNull();
    expect(q.params[q.params.length - 1]).toBe(SHORT_ID);
  });

  it("GET /videos/:id/duets creator lookup emits ANY(ARRAY[$1]::uuid[])", async () => {
    const res = await get(`/videos/${SHORT_ID}/duets`);
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(1);
    expect(res.json.items[0].creator?.id).toBe(h.CREATOR_ID);

    const rendered = h.state.whereConds.map((c) => render(c));
    const arrayConds = rendered.filter((r) => r.sql.includes("ANY("));
    expect(arrayConds).toHaveLength(1);
    expectArrayForm(arrayConds[0]!.sql, "uuid[]");
    expect(arrayConds[0]!.sql).toContain('"creator_profiles"."id"');
    expect(arrayConds[0]!.params).toEqual([h.CREATOR_ID]);
  });
});

describe("source-shape guard — the tuple-cast array pattern exists nowhere in the API source", () => {
  it("no ANY(${param}::type[]) or ${param}::type[] array interpolation remains", () => {
    const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
    const offenders: string[] = [];
    const tupleCast = /ANY\(\$\{[^}]*\}::/;
    const arrayParamCast = /\$\{[A-Za-z_$][\w$.]*\}::(text|uuid|int|bigint|varchar)\[\]/;

    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__") walk(p);
        } else if (name.endsWith(".ts")) {
          const text = readFileSync(p, "utf8");
          if (tupleCast.test(text) || arrayParamCast.test(text)) offenders.push(p);
        }
      }
    }
    walk(join(srcRoot, "routes"));
    walk(join(srcRoot, "lib"));

    expect(offenders).toEqual([]);
  });
});
