/* Provenance doors (Stack-100 #3 lane F7) — HTTP pins over a REAL drizzle
 * connection to pg-mem, so ownership scoping is proven by the database,
 * not by a stub: another creator's asset is a 404, a licence write lands
 * in the asset's own JSONB and reads back, and the certificate endpoint
 * returns a real PDF naming the work, the creator and the licence. */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(u);
    next();
  },
}));

import router from "../provenance";
import { sql } from "drizzle-orm";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/* Local pg-mem drizzle instance. The shared createTestDb shim targets
   raw-SQL stores; route code uses the query BUILDER, whose node-postgres
   driver sends rowMode:"array" — pg-mem rejects it. This shim strips the
   `types` config (same as the shared one) and translates array rows back
   from pg-mem's object rows using the result field order, so the builder
   gets exactly the shape it asked for. */
function parseSelectColumns(text: string): string[] | null {
  const m = /^select\s+(.+?)\s+from\s+/is.exec(text.trim());
  if (!m) return null;
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of m[1]!) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  const names: string[] = [];
  for (const p of parts) {
    const q = /"([^"]+)"/.exec(p.trim());
    if (!q) return null;
    names.push(q[1]!);
  }
  return names;
}

function createRouteTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const clientShim = {
    query: async (config: unknown, values?: unknown[]) => {
      let cfg: any = config;
      let wantArray = false;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        const { types: _t, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const res: any = await (pool as any).query(cfg, values);
      /* pg-mem returns rows as objects and an EMPTY fields list, so the
         positional order drizzle asked for is recovered from the select
         list in the query text itself. */
      if (wantArray && Array.isArray(res?.rows) && typeof cfg?.text === "string") {
        const cols = parseSelectColumns(cfg.text);
        if (cols) {
          res.rows = res.rows.map((r: Record<string, unknown>) => cols.map((c) => r[c]));
        }
      }
      return res;
    },
  };
  return { mem, db: drizzle(clientShim as never) };
}

const DDL = `
CREATE TABLE generation_history (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid,
  generation_type text,
  prompt text,
  result jsonb,
  credits_used integer,
  save_status text NOT NULL DEFAULT 'pending',
  refunded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hub_projects (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  client_ref text,
  name text NOT NULL DEFAULT 'Untitled Project',
  type text NOT NULL DEFAULT 'song',
  assets jsonb NOT NULL DEFAULT '[]',
  concept text NOT NULL DEFAULT '',
  template_key text,
  attribution boolean NOT NULL DEFAULT true,
  artist_vault_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  display_name text NOT NULL
);
`;

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GEN_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

let server: any;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: (obj: any, msg?: string) => console.error("[route-error]", msg, obj?.err?.cause?.message ?? obj?.err?.message ?? obj), info: () => {}, warn: () => {} };
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

beforeEach(async () => {
  const { db, mem } = createRouteTestDb();
  mem.public.none(DDL);
  testState.db = db;
  await db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, display_name)
    VALUES (${randomUUID()}, ${USER}, ${"TRGDY TRBLZ"})
  `);
  await db.execute(sql`
    INSERT INTO generation_history (id, user_id, generation_type, prompt, result, credits_used, save_status, created_at)
    VALUES (${GEN_ID}, ${USER}, ${"Make a Song"}, ${"a royal trap anthem"},
      ${JSON.stringify({ songTitle: "Midnight Crown", videoUrl: "https://cdn.example/song.mp4" })}::jsonb,
      ${400}, ${"saved"}, ${"2026-10-23T12:00:00Z"})
  `);
  await db.execute(sql`
    INSERT INTO hub_projects (id, user_id, name, assets, updated_at)
    VALUES (${PROJECT_ID}, ${USER}, ${"Current"},
      ${JSON.stringify([
        { id: "cover-1", kind: "thumbnail", url: "https://cdn.example/cover.png", label: "Crown Cover", createdAt: 1761177600000 },
      ])}::jsonb,
      ${"2026-10-23T12:00:00Z"})
  `);
});

async function call(path: string, user: string | null, init?: RequestInit) {
  const res = await realFetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

describe("GET /api/provenance/:kind/:id", () => {
  it("returns the derived record for a generated song", async () => {
    const res = await call(`/provenance/gen/${GEN_ID}`, USER);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.record.title).toBe("Midnight Crown");
    expect(json.record.creator.name).toBe("TRGDY TRBLZ");
    expect(json.record.createdWith.tool).toBe("Make a Song");
    expect(json.record.createdWith.model).toContain("ElevenLabs Music");
    expect(json.record.aiGenerated).toBe(true);
    expect(json.record.licence).toBe("all-rights-reserved");
    expect(json.record.editHistory.some((l: string) => l.includes("400 Visual Bucs"))).toBe(true);
    expect(json.licenceOptions.map((l: any) => l.id)).toContain("cc-by-4.0");
  });

  it("returns the record for a hub asset", async () => {
    const res = await call(`/provenance/hub/cover-1`, USER);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.record.title).toBe("Crown Cover");
    expect(json.record.aiGenerated).toBe(false);
    expect(json.record.createdWith.tool).toBe("Thumbnail Studio");
    /* More-provenance: no generation row stores this hub entry's URL, so
       its AI state is honestly UNKNOWN — never "no AI". */
    expect(json.record.aiInvolvement).toBe("unknown");
  });

  it("a hub asset linked by URL to a generation row states its AI facts", async () => {
    /* Thumbnail generations store result.thumbnailUrl = the hub entry's
       URL (lib/payment-record recordThumbnailHistory) — that stored link
       is the evidence. */
    const { db } = { db: testState.db };
    await db.execute(sql`
      INSERT INTO generation_history (id, user_id, generation_type, prompt, result, credits_used, save_status, created_at)
      VALUES (${randomUUID()}, ${USER}, ${"thumbnail"}, ${"a crown over a city"},
        ${JSON.stringify({ thumbnailUrl: "https://cdn.example/cover.png", actionLabel: "Thumbnail Maker" })}::jsonb,
        ${100}, ${"saved"}, ${"2026-10-23T11:00:00Z"})
    `);
    const res = await call(`/provenance/hub/cover-1`, USER);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.record.aiInvolvement).toBe("ai");
    expect(json.record.aiGenerated).toBe(true);
    expect(json.record.createdWith.tool).toBe("Thumbnail Studio");
    expect(json.record.createdWith.model).toBeNull();
    expect(json.record.editHistory.some((l: string) => l.includes("a crown over a city"))).toBe(true);
  });

  it("404s for another creator's asset — ownership is real", async () => {
    const res = await call(`/provenance/gen/${GEN_ID}`, OTHER);
    expect(res.status).toBe(404);
    const res2 = await call(`/provenance/hub/cover-1`, OTHER);
    expect(res2.status).toBe(404);
  });

  it("404s for unknown kinds and missing assets, 401s unauthenticated", async () => {
    expect((await call(`/provenance/bogus/${GEN_ID}`, USER)).status).toBe(404);
    expect((await call(`/provenance/gen/${randomUUID()}`, USER)).status).toBe(404);
    expect((await call(`/provenance/gen/${GEN_ID}`, null)).status).toBe(401);
  });
});

describe("POST /api/provenance/:kind/:id/licence", () => {
  it("saves the licence into the generation row and reads it back", async () => {
    const res = await call(`/provenance/gen/${GEN_ID}/licence`, USER, {
      method: "POST",
      body: JSON.stringify({ licence: "cc-by-4.0" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).record.licence).toBe("cc-by-4.0");

    const rows = await testState.db.execute(
      sql`SELECT result FROM generation_history WHERE id = ${GEN_ID}`,
    );
    expect((rows.rows[0] as any).result.provenance.licence).toBe("cc-by-4.0");
    /* the original result fields survive the merge */
    expect((rows.rows[0] as any).result.songTitle).toBe("Midnight Crown");

    const reread = await call(`/provenance/gen/${GEN_ID}`, USER);
    expect(((await reread.json()) as any).record.licence).toBe("cc-by-4.0");
  });

  it("saves the licence into the hub asset entry", async () => {
    const res = await call(`/provenance/hub/cover-1/licence`, USER, {
      method: "POST",
      body: JSON.stringify({ licence: "cc0-1.0" }),
    });
    expect(res.status).toBe(200);
    const rows = await testState.db.execute(
      sql`SELECT assets FROM hub_projects WHERE id = ${PROJECT_ID}`,
    );
    expect((rows.rows[0] as any).assets[0].provenance.licence).toBe("cc0-1.0");
    expect((rows.rows[0] as any).assets[0].label).toBe("Crown Cover");
  });

  it("rejects an unknown licence with 400 and writes nothing", async () => {
    const res = await call(`/provenance/gen/${GEN_ID}/licence`, USER, {
      method: "POST",
      body: JSON.stringify({ licence: "mit" }),
    });
    expect(res.status).toBe(400);
    const rows = await testState.db.execute(
      sql`SELECT result FROM generation_history WHERE id = ${GEN_ID}`,
    );
    expect((rows.rows[0] as any).result.provenance).toBeUndefined();
  });

  it("404s when saving a licence on someone else's asset", async () => {
    const res = await call(`/provenance/gen/${GEN_ID}/licence`, OTHER, {
      method: "POST",
      body: JSON.stringify({ licence: "cc-by-4.0" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/provenance/:kind/:id/certificate", () => {
  it("returns a real PDF naming the work, creator and chosen licence", async () => {
    await call(`/provenance/gen/${GEN_ID}/licence`, USER, {
      method: "POST",
      body: JSON.stringify({ licence: "cc-by-nc-4.0" }),
    });
    const res = await call(`/provenance/gen/${GEN_ID}/certificate`, USER);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("midnight-crown-licence-certificate.pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    /* Byte probe, honestly decoded: PDFKit draws page text as hex TJ
       fragments and writes info strings as literals or UTF-16BE hex.
       Decode all three forms and read the union. */
    const raw = bytes.toString("latin1");
    const decoded: string[] = [raw];
    const hexFragments: string[] = [];
    for (const m of raw.matchAll(/<([0-9a-fA-F]+)>/g)) {
      hexFragments.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    }
    /* UTF-16BE strings (info Title/Subject) decode by swapping byte pairs. */
    const beDecoded: string[] = [];
    for (const m of raw.matchAll(/<([0-9a-fA-F]+)>/g)) {
      const buf = Buffer.from(m[1]!, "hex");
      if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        const swapped = Buffer.alloc(buf.length - 2);
        for (let i = 2; i + 1 < buf.length; i += 2) {
          swapped[i - 2] = buf[i + 1]!;
          swapped[i - 1] = buf[i]!;
        }
        beDecoded.push(swapped.toString("utf16le"));
      }
    }
    const allText = [...decoded, hexFragments.join(""), ...beDecoded].join("\n");
    expect(allText).toContain("Midnight Crown");
    expect(allText).toContain("TRGDY TRBLZ");
    expect(allText).toContain("CC BY-NC 4.0");
  });

  it("404s for another creator", async () => {
    const res = await call(`/provenance/gen/${GEN_ID}/certificate`, OTHER);
    expect(res.status).toBe(404);
  });

  it("an unlinked hub asset's certificate states UNKNOWN, never 'no AI'", async () => {
    const res = await call(`/provenance/hub/cover-1/certificate`, USER);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    const raw = bytes.toString("latin1");
    const hexFragments: string[] = [];
    for (const m of raw.matchAll(/<([0-9a-fA-F]+)>/g)) {
      hexFragments.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    }
    const pageText = hexFragments.join("");
    expect(pageText).toContain("AI involvement is not recorded for this work.");
    expect(pageText).not.toContain("No AI generation is recorded");
  });
});
