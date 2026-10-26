/**
 * Route tests for Stack-200 profile templates (routes/profile-website.ts
 * #3b + lib/profile-website.ts):
 *   GET    /creator-profiles/me/template
 *   PUT    /creator-profiles/me/template/draft
 *   PUT    /creator-profiles/me/template/draft/layout
 *   POST   /creator-profiles/me/template/ai-design
 *   POST   /creator-profiles/me/template/approve
 *   DELETE /creator-profiles/me/template/draft
 *
 * Contract pinned here (owner-approved spec, Oct 25):
 * - The shelf holds exactly the six approved templates; every template
 *   layout is built from registry block types only, with a registry
 *   colorway and registry fonts — a template can never invent page
 *   structure (no freeform code, ever).
 * - Picking a template or running the designer writes a DRAFT only:
 *   the live layout/theme/template id do not move.
 * - The designer applies ONLY bounded ops (rearrange / add / subtract
 *   categories), driven by the profile's own signals, and records each
 *   op in plain words.
 * - Approve is the only door to live: it writes the draft layout, the
 *   resolved colorway + fonts, and the live template id, and consumes
 *   the draft. Discard leaves the live page untouched.
 *
 * Fake db in the profile-website.test.ts style.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  PROFILE_TEMPLATES,
  PROFILE_BLOCK_TYPE_SET,
  PROFILE_FONT_IDS,
  colorwayById,
  templateById,
} from "../../lib/profile-website";

const OWNER_USER = "00000000-0000-4000-8000-0000000000aa";
const GAMER_USER = "00000000-0000-4000-8000-0000000000dd";
const NO_PROFILE_USER = "00000000-0000-4000-8000-0000000000cc";
const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const GAMER_PROFILE = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  state: { profilesById: new Map<string, Record<string, unknown>>() },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table !== creatorProfilesTable) return [];
    const { sql, params } = render(cond);
    const all = [...state.profilesById.values()];
    if (sql.includes('"user_id"')) {
      const row = all.find((p) => String(p["userId"]) === String(params[0]));
      return row ? [row] : [];
    }
    if (sql.includes('"slug"')) {
      const row = all.find((p) => String(p["slug"]) === String(params[0]));
      return row ? [row] : [];
    }
    if (sql.includes('"id"')) {
      const row = state.profilesById.get(String(params[0]));
      return row ? [row] : [];
    }
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      offset: (_n: number) => self,
      orderBy: (..._args: unknown[]) => self,
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }
  function thenable(extra: Record<string, unknown> = {}): any {
    return { ...extra, then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({ where: (cond: unknown) => chain(table, cond) }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (table === creatorProfilesTable) {
            const id = String(render(cond).params[0] ?? "");
            const row = state.profilesById.get(id);
            if (row) Object.assign(row, patch);
          }
          return thenable({ returning: async () => [] });
        },
      }),
    }),
    insert: () => ({ values: () => thenable({ returning: async () => [] }) }),
    delete: () => ({ where: () => thenable() }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../profile-website";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
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

function profileRow(id: string, userId: string, slug: string, extra: Record<string, unknown> = {}) {
  return {
    id, userId, slug,
    displayName: slug,
    bio: "",
    avatarUrl: null,
    bannerUrl: null,
    themeId: "gold-lux",
    vertical: "music",
    streamSchedule: [],
    mediaKit: null,
    themeConfig: {},
    sections: [],
    layoutBlocks: [],
    pinnedKind: null,
    pinnedItemId: null,
    collectionVisibility: "public",
    featuredMedia: null,
    merchItems: [],
    profileEvents: [],
    series: [],
    socialPosts: [],
    socialLinks: {},
    topCreators: [],
    tipJarEnabled: true,
    aiDesign: null,
    isPublic: true,
    isVerified: false,
    isOfficial: false,
    followerCount: 0,
    totalPlays: 0,
    stripeConnectAccountId: null,
    stripeConnectOnboarded: false,
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

beforeEach(() => {
  h.state.profilesById = new Map();
  h.state.profilesById.set(OWNER_PROFILE, profileRow(OWNER_PROFILE, OWNER_USER, "owner-creator", {
    sections: [
      { id: "hero-0", type: "hero", title: "Featured Track", visible: true },
      { id: "tracks-1", type: "tracks", title: "My Music", visible: true },
    ],
  }));
  h.state.profilesById.set(GAMER_PROFILE, profileRow(GAMER_PROFILE, GAMER_USER, "gamer-creator", {
    vertical: "gaming",
    streamSchedule: [{ day: "Fri", time: "8pm", title: "Ranked night" }],
    pinnedKind: "video",
    pinnedItemId: "55555555-5555-4555-8555-555555555555",
  }));
});

async function call(method: string, path: string, user?: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const row = (id: string) => h.state.profilesById.get(id) as Record<string, any>;

describe("the shelf — registry integrity", () => {
  it("holds exactly the six approved templates, all registry-bound", () => {
    expect(PROFILE_TEMPLATES.map((t) => t.id)).toEqual([
      "stage", "booth", "gallery", "broadcast", "press-kit", "after-dark",
    ]);
    for (const t of PROFILE_TEMPLATES) {
      expect(colorwayById(t.colorway), t.id).not.toBeNull();
      expect(PROFILE_FONT_IDS).toContain(t.headingFont);
      expect(PROFILE_FONT_IDS).toContain(t.bodyFont);
      const seen = new Set<string>();
      for (const [type] of t.layout) {
        expect(PROFILE_BLOCK_TYPE_SET.has(type), `${t.id}:${type}`).toBe(true);
        expect(seen.has(type), `${t.id}:${type} duplicated`).toBe(false);
        seen.add(type);
      }
    }
  });

  it("Stage is the Grand Stage: picked block order, Royal Gold, Variant-B composition", () => {
    const stage = templateById("stage")!;
    expect(stage.layout.map(([type]) => type)).toEqual([
      "hero", "spotlight", "court", "tracks", "videos", "store", "memberships", "achievements", "links",
    ]);
    expect(stage.layout.slice(1, 7).map(([, title]) => title)).toEqual([
      "The Stage", "The Front Row", "Music", "Videos", "Store", "Memberships",
    ]);
    expect(stage.colorway).toBe("royal-gold");
  });
});

describe("GET /creator-profiles/me/template", () => {
  it("401s anonymous and 404s a user with no profile", async () => {
    expect((await call("GET", "/creator-profiles/me/template")).status).toBe(401);
    expect((await call("GET", "/creator-profiles/me/template", NO_PROFILE_USER)).status).toBe(404);
  });

  it("returns the shelf, the smart recommendation, and no draft/live template yet", async () => {
    const { status, body } = await call("GET", "/creator-profiles/me/template", OWNER_USER);
    expect(status).toBe(200);
    expect(body.templates.map((t: any) => t.id)).toEqual([
      "stage", "booth", "gallery", "broadcast", "press-kit", "after-dark",
    ]);
    /* music lane → Booth is the first non-flagship fit */
    expect(body.recommendedTemplateId).toBe("booth");
    expect(body.liveTemplateId).toBeNull();
    expect(body.draft).toBeNull();
    /* The creator's own section titles carry into a template instance. */
    const stage = body.templates.find((t: any) => t.id === "stage");
    expect(stage.layout.find((b: any) => b.type === "tracks").title).toBe("My Music");
    expect(stage.layout.find((b: any) => b.type === "hero").title).toBe("Featured Track");
  });
});

describe("draft — pick, edit, discard (never live)", () => {
  it("rejects a template that isn't on the shelf", async () => {
    const { status, body } = await call("PUT", "/creator-profiles/me/template/draft", OWNER_USER, { templateId: "myspace-freeform" });
    expect(status).toBe(400);
    expect(body.error).toBe("UNKNOWN_TEMPLATE");
    expect(row(OWNER_PROFILE)["themeConfig"]).toEqual({});
  });

  it("picking Booth writes a draft only — live layout, theme and template id do not move", async () => {
    const before = await call("GET", "/creator-profiles/owner-creator/layout");
    const { status, body } = await call("PUT", "/creator-profiles/me/template/draft", OWNER_USER, { templateId: "booth" });
    expect(status).toBe(200);
    expect(body.draft.templateId).toBe("booth");
    expect(body.draft.source).toBe("template");
    expect(body.draft.colorway).toBe("stage-lights");
    expect(body.liveTemplateId).toBeNull();
    expect(row(OWNER_PROFILE)["layoutBlocks"]).toEqual([]);
    expect(row(OWNER_PROFILE)["themeId"]).toBe("gold-lux");
    const after = await call("GET", "/creator-profiles/owner-creator/layout");
    expect(after.body.layout).toEqual(before.body.layout);
    expect(after.body.templateId).toBeNull();
  });

  it("draft layout edits validate strictly and restyle keys are registry-checked", async () => {
    /* no draft yet → NO_DRAFT */
    const noDraft = await call("PUT", "/creator-profiles/me/template/draft/layout", OWNER_USER, { layout: [] });
    expect(noDraft.status).toBe(400);
    expect(noDraft.body.error).toBe("NO_DRAFT");

    await call("PUT", "/creator-profiles/me/template/draft", OWNER_USER, { templateId: "gallery" });
    const badBlock = await call("PUT", "/creator-profiles/me/template/draft/layout", OWNER_USER, {
      layout: [{ type: "freeform-html", title: "x", visible: true, config: {} }],
    });
    expect(badBlock.status).toBe(400);
    expect(badBlock.body.error).toBe("UNKNOWN_BLOCK_TYPE");

    const badFont = await call("PUT", "/creator-profiles/me/template/draft/layout", OWNER_USER, {
      layout: [{ type: "hero", title: "Featured", visible: true, config: {} }],
      headingFont: "Comic Sans MS",
    });
    expect(badFont.status).toBe(400);
    expect(badFont.body.error).toBe("UNKNOWN_FONT");

    const ok = await call("PUT", "/creator-profiles/me/template/draft/layout", OWNER_USER, {
      layout: [
        { type: "hero", title: "Featured", visible: true, config: {} },
        { type: "videos", title: "Films", visible: true, config: {} },
      ],
      colorway: "velvet-lounge",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.draft.source).toBe("manual");
    expect(ok.body.draft.colorway).toBe("velvet-lounge");
    expect(ok.body.draft.layout.map((b: any) => b.type)).toEqual(["hero", "videos"]);
    /* still not live */
    expect(row(OWNER_PROFILE)["layoutBlocks"]).toEqual([]);
  });

  it("discard drops the draft and leaves everything live untouched", async () => {
    await call("PUT", "/creator-profiles/me/template/draft", OWNER_USER, { templateId: "after-dark" });
    const { status, body } = await call("DELETE", "/creator-profiles/me/template/draft", OWNER_USER);
    expect(status).toBe(200);
    expect(body.draft).toBeNull();
    expect(body.liveTemplateId).toBeNull();
    expect(row(OWNER_PROFILE)["layoutBlocks"]).toEqual([]);
  });
});

describe("the bounded AI designer", () => {
  it("designs from the creator's own signals, records its ops, and stays a draft", async () => {
    const { status, body } = await call("POST", "/creator-profiles/me/template/ai-design", GAMER_USER);
    expect(status).toBe(200);
    const draft = body.draft;
    expect(draft.source).toBe("ai");
    expect(draft.templateId).toBe("stage");
    const types = draft.layout.map((b: any) => b.type);
    /* Grand Stage core guaranteed present */
    for (const core of ["spotlight", "court", "store", "memberships", "links"]) {
      expect(types).toContain(core);
    }
    /* gaming + a real schedule: schedule sits directly under The Stage */
    expect(types.indexOf("schedule")).toBe(types.indexOf("spotlight") + 1);
    /* gaming: clips above music */
    expect(types.indexOf("videos")).toBeLessThan(types.indexOf("tracks"));
    /* every op is a bounded category op, in plain words */
    expect(draft.ops.length).toBeGreaterThan(0);
    for (const op of draft.ops as string[]) {
      expect(op).toMatch(/^(Added|Moved|Removed) /);
    }
    /* nothing went live */
    expect(row(GAMER_PROFILE)["layoutBlocks"]).toEqual([]);
    expect(body.liveTemplateId).toBeNull();
  });

  it("subtracts only provably-empty, never-placed section blocks", async () => {
    /* The gamer has a schedule but no media kit, merch, events, series,
       posts or top creators — and never placed those sections. */
    const { body } = await call("POST", "/creator-profiles/me/template/ai-design", GAMER_USER);
    const types = body.draft.layout.map((b: any) => b.type);
    expect(types).not.toContain("mediakit");
    expect(types).toContain("schedule");
  });

  it("never subtracts a section the creator placed themselves", async () => {
    /* Owner placed hero+tracks sections; give them an events section
       with zero events — the designer must keep it (their choice). */
    const p = row(OWNER_PROFILE);
    p["sections"] = [
      { id: "hero-0", type: "hero", title: "Featured Track", visible: true },
      { id: "events-1", type: "events", title: "My Shows", visible: true },
    ];
    await call("PUT", "/creator-profiles/me/template/draft", OWNER_USER, { templateId: "after-dark" });
    const { body } = await call("POST", "/creator-profiles/me/template/ai-design", OWNER_USER);
    const types = body.draft.layout.map((b: any) => b.type);
    expect(types).toContain("events");
  });
});

describe("approve — the only door to live", () => {
  it("400s with no draft waiting", async () => {
    const { status, body } = await call("POST", "/creator-profiles/me/template/approve", OWNER_USER);
    expect(status).toBe(400);
    expect(body.error).toBe("NO_DRAFT");
  });

  it("publishes the draft: layout, resolved colorway + fonts, live template id; draft consumed", async () => {
    await call("PUT", "/creator-profiles/me/template/draft", OWNER_USER, { templateId: "press-kit" });
    const { status, body } = await call("POST", "/creator-profiles/me/template/approve", OWNER_USER);
    expect(status).toBe(200);
    expect(body.draft).toBeNull();
    expect(body.liveTemplateId).toBe("press-kit");

    const p = row(OWNER_PROFILE);
    expect((p["layoutBlocks"] as any[]).map((b) => b.type)).toEqual(
      templateById("press-kit")!.layout.map(([type]) => type),
    );
    expect(p["themeId"]).toBe("midnight-gold");
    const cfg = p["themeConfig"] as Record<string, any>;
    expect(cfg["profileTemplateId"]).toBe("press-kit");
    expect(cfg["themeId"]).toBe("midnight-gold");
    expect(cfg["colors"]).toEqual(colorwayById("midnight-gold")!.colors);
    expect(cfg["fonts"]).toEqual({ heading: "DM Serif Display", body: "Inter" });
    expect(cfg["profileTemplateDraft"]).toBeUndefined();

    /* The public layout now reports the template and renders its order. */
    const pub = await call("GET", "/creator-profiles/owner-creator/layout");
    expect(pub.body.templateId).toBe("press-kit");
    expect(pub.body.isDefault).toBe(false);
    expect(pub.body.layout.map((b: any) => b.type)).toEqual(
      templateById("press-kit")!.layout.map(([type]) => type),
    );
  });

  it("a designer draft approves the same way — AI work never skips the gate", async () => {
    await call("POST", "/creator-profiles/me/template/ai-design", GAMER_USER);
    const mid = await call("GET", "/creator-profiles/gamer-creator/layout");
    expect(mid.body.templateId).toBeNull();
    const { status, body } = await call("POST", "/creator-profiles/me/template/approve", GAMER_USER);
    expect(status).toBe(200);
    expect(body.liveTemplateId).toBe("stage");
    const pub = await call("GET", "/creator-profiles/gamer-creator/layout");
    expect(pub.body.templateId).toBe("stage");
    expect(pub.body.layout.map((b: any) => b.type)).toContain("schedule");
  });
});
