/**
 * Brand-kit persistence (0142, DE-5). POST /api/brand-kit used to
 * return the generated kit and forget it — nothing durable for the
 * apply/import surfaces to read. Now the kit upserts into brand_kits
 * (one per creator) and GET /api/brand-kit/mine reads it back.
 *
 * pg-mem + the house db-getter swap; the text model and credits are
 * mocked (no provider calls, no balance movement in tests).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    req.userCredits = 10_000;
    next();
  },
}));

const KIT = {
  colors: [
    { hex: "#C9A84C", name: "Royal Gold", role: "primary" },
    { hex: "#0B0B0F", name: "Midnight", role: "background" },
    { hex: "#F5EFE0", name: "Ivory", role: "neutral" },
    { hex: "#8A6D2F", name: "Bronze", role: "secondary" },
    { hex: "#E5484D", name: "Signal", role: "accent" },
  ],
  fonts: [{ heading: "Playfair Display", body: "Inter", usage: "everywhere" },
          { heading: "Cinzel", body: "Inter", usage: "posters" },
          { heading: "Marcellus", body: "Inter", usage: "video" }],
  logoPrompt: "a gold shark crown emblem on black",
  taglines: ["Bow Down.", "The Cheat Code.", "Royalty, rendered.", "Gold standard.", "Crown up."],
};

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(KIT) } }],
        }),
      },
    },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: async () => 9_800,
  refundCredits: async () => undefined,
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

import router from "../brand-kit";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const DDL = `
  CREATE TABLE brand_kits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE,
    kit jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;

beforeAll(async () => {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => "22222222-2222-4222-8222-222222222222",
    impure: true,
  });
  const rawPool = mem.adapters.createPg();
  const pool: any = new rawPool.Pool();
  const rawQuery = pool.query.bind(pool);
  pool.query = (config: any, values?: unknown) => {
    if (config && typeof config === "object" && "types" in config) {
      const { types: _t, ...rest } = config;
      return rawQuery(rest, values);
    }
    return rawQuery(config, values);
  };
  h.db = drizzle(pool);
  await h.db.execute(DDL);

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

beforeEach(async () => {
  await h.db.execute(`DELETE FROM brand_kits`);
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("brand-kit persistence (0142, DE-5)", () => {
  it("GET /brand-kit/mine is null before any generation", async () => {
    const { status, json } = await call("GET", "/brand-kit/mine");
    expect(status).toBe(200);
    expect(json.kit).toBeNull();
  });

  it("generation persists the kit; /mine reads it back", async () => {
    const post = await call("POST", "/brand-kit", { brandName: "Bow Down", vibe: "royal gold luxury" });
    expect(post.status).toBe(200);
    expect(post.json.kit.logoPrompt).toContain("shark");

    const mine = await call("GET", "/brand-kit/mine");
    expect(mine.json.kit.brandName).toBe("Bow Down");
    expect(mine.json.kit.colors).toHaveLength(5);
    expect(mine.json.kit.taglines).toHaveLength(5);
  });

  it("regenerating replaces the stored kit (one row per creator)", async () => {
    await call("POST", "/brand-kit", { brandName: "First", vibe: "royal gold luxury" });
    await call("POST", "/brand-kit", { brandName: "Second", vibe: "royal gold luxury" });
    const mine = await call("GET", "/brand-kit/mine");
    expect(mine.json.kit.brandName).toBe("Second");
    const count = await h.db.execute(`SELECT COUNT(*)::int AS n FROM brand_kits`);
    expect(count.rows[0].n).toBe(1);
  });
});
