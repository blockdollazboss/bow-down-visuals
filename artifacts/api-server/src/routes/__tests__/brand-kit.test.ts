/**
 * Tests for the brand kit as ONE source of truth (linkage fix, audit DE-5).
 *
 * Driven the way real callers drive it: HTTP against the real Express
 * router on an ephemeral server, with auth, credits, the model client and
 * the DB mocked. The kit persists onto the creator's profile record
 * (theme_config.brandKit); reads and manual saves never charge; only an
 * actual generation charges the standing 200 VB.
 */
import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const KIT_JSON = {
  colors: [
    { hex: "#C9A84C", name: "Royal Gold", role: "primary" },
    { hex: "#1A1408", name: "Throne Black", role: "secondary" },
    { hex: "#F5D67B", name: "Crown Light", role: "accent" },
    { hex: "#8A7B5C", name: "Old Bronze", role: "neutral" },
    { hex: "#0D0A04", name: "Palace Night", role: "background" },
  ],
  fonts: [
    { heading: "Cinzel", body: "Inter", usage: "Headlines and body" },
    { heading: "Playfair Display", body: "Inter", usage: "Editorial" },
    { heading: "Bebas Neue", body: "Space Grotesk", usage: "Posters" },
  ],
  logoPrompt: "A gold shark crest on black",
  taglines: ["Bow Down.", "The Cheat Code.", "Royalty streams here.", "Built different.", "Your stage awaits."],
};

/* A creator's hand-tuned palette + pairings (Ring 4 edit) — deliberately
   NOT the generated kit's values, so a read-back proves the edit landed. */
const EDITED_COLORS = [
  { hex: "#FF0055", name: "Neon Rose", role: "primary" },
  { hex: "#00E5FF", name: "Laser Cyan", role: "accent" },
  { hex: "#101018", name: "Stage Black", role: "background" },
];
const EDITED_FONTS = [{ heading: "Bebas Neue", body: "Space Grotesk", usage: "Street drops" }];

const state = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  userCredits: 1000,
  profile: null as { themeConfig: Record<string, unknown> } | null,
  charges: [] as number[],
  refunds: [] as number[],
  uploads: [] as { bucket: string; path: string; contentType: string }[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!state.authedUserId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = state.authedUserId;
    req.userCredits = state.userCredits;
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_userId: string, amount: number) => {
    state.charges.push(amount);
    return state.userCredits - amount;
  }),
  refundCredits: vi.fn(async (_userId: string, amount: number) => {
    state.refunds.push(amount);
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify(KIT_JSON) } }] }),
      },
    },
  }),
  getTextModel: () => "test-model",
}));

/* Storage: mirrors the real normalizeToStorageRef contract — a URL on
   our own storage comes back as a DIFFERENT (ref) string, anything else
   comes back unchanged; uploads land at a permanent public URL. */
vi.mock("../../lib/objectStorage", () => ({
  normalizeToStorageRef: (v: string | null | undefined) => {
    if (v == null) return null;
    if (v.includes("storage.example/")) return `supabase://stored/${v.split("storage.example/")[1]}`;
    return v;
  },
  uploadPublicMediaToR2: vi.fn(async (bucket: string, path: string, _buf: Buffer, contentType: string) => {
    state.uploads.push({ bucket, path, contentType });
    return `https://storage.example/${bucket}/${path}`;
  }),
}));

vi.mock("@workspace/db", () => {
  const table = { __table: "creator_profiles", id: "id", userId: "userId", themeConfig: "themeConfig" };
  const selectChain: any = {};
  selectChain.from = () => selectChain;
  selectChain.where = () => selectChain;
  selectChain.limit = async () =>
    state.profile ? [{ id: "profile-1", themeConfig: state.profile.themeConfig }] : [];
  const updateChain: any = {};
  updateChain.set = (values: any) => {
    updateChain.__values = values;
    return updateChain;
  };
  updateChain.where = async () => {
    if (state.profile && updateChain.__values?.themeConfig) {
      state.profile.themeConfig = updateChain.__values.themeConfig;
    }
  };
  return {
    db: { select: () => selectChain, update: () => updateChain },
    creatorProfilesTable: table,
  };
});

import brandKitRouter from "../generate/brand-kit";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  /* A stand-in "external" logo source the re-host path can really
     download over loopback HTTP during the mirror test. */
  app.get("/external-logo.png", (_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.send(Buffer.from("89504e470d0a1a0a", "hex"));
  });
  app.use("/api", brandKitRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.authedUserId = "user-1";
  state.userCredits = 1000;
  state.profile = { themeConfig: { themeId: "midnight-gold", banner: { layout: "full-bleed" } } };
  state.charges = [];
  state.refunds = [];
  state.uploads = [];
});

async function generateKit() {
  const res = await fetch(`${base}/api/brand-kit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "Bow Down Visuals", vibe: "royal gold luxury", industry: "music" }),
  });
  return { res, data: await res.json() };
}

describe("brand kit linkage (DE-5)", () => {
  it("generation persists the kit onto the creator's brand record and charges 200 once", async () => {
    const { res, data } = await generateKit();
    expect(res.status).toBe(200);
    expect(data.saved).toBe(true);
    expect(data.creditsRemaining).toBe(800);
    expect(state.charges).toEqual([200]);
    expect(data.brandKit.brandName).toBe("Bow Down Visuals");
    expect(data.brandKit.colors).toHaveLength(5);
    expect(data.brandKit.taglines).toEqual(KIT_JSON.taglines);
    // It landed on the profile record, alongside the untouched theme keys.
    const stored = (state.profile!.themeConfig as any).brandKit;
    expect(stored.colors[0].hex).toBe("#C9A84C");
    expect(state.profile!.themeConfig["themeId"]).toBe("midnight-gold");
    expect((state.profile!.themeConfig as any).banner.layout).toBe("full-bleed");
  });

  it("GET reads the saved kit back without charging", async () => {
    await generateKit();
    state.charges = [];
    const res = await fetch(`${base}/api/brand-kit`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.brandKit.brandName).toBe("Bow Down Visuals");
    expect(data.brandKit.colors).toHaveLength(5);
    expect(state.charges).toEqual([]);
  });

  it("GET returns null (not an error) before any kit exists", async () => {
    const res = await fetch(`${base}/api/brand-kit`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brandKit: null });
  });

  it("PUT saves manual fields — logo, tagline pick, bio lines, press facts — free", async () => {
    await generateKit();
    state.charges = [];
    const res = await fetch(`${base}/api/brand-kit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logoUrl: "https://cdn.example/my-logo.png",
        selectedTagline: "Bow Down.",
        bioLines: ["Gold-standard creator studio.", "Home of the King Shark."],
        pressFacts: ["Featured on the Grand Stage", "100k streams in year one"],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.brandKit.logoUrl).toBe("https://cdn.example/my-logo.png");
    expect(data.brandKit.selectedTagline).toBe("Bow Down.");
    expect(data.brandKit.bioLines).toHaveLength(2);
    expect(data.brandKit.pressFacts).toHaveLength(2);
    expect(state.charges).toEqual([]);
    const get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.logoUrl).toBe("https://cdn.example/my-logo.png");
  });

  it("PUT with no profile is an honest 404 NO_PROFILE", async () => {
    state.profile = null;
    const res = await fetch(`${base}/api/brand-kit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl: "https://cdn.example/logo.png" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("NO_PROFILE");
  });

  it("generation without a profile still returns the kit, flagged unsaved", async () => {
    state.profile = null;
    const { res, data } = await generateKit();
    expect(res.status).toBe(200);
    expect(data.kit.taglines).toEqual(KIT_JSON.taglines);
    expect(data.saved).toBe(false);
    expect(data.brandKit).toBeNull();
    expect(state.charges).toEqual([200]);
  });

  it("re-generation preserves the creator's manual fields", async () => {
    await generateKit();
    await fetch(`${base}/api/brand-kit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logoUrl: "https://cdn.example/keep-me.png",
        selectedTagline: "Bow Down.",
        bioLines: ["My bio line."],
      }),
    });
    const { data } = await generateKit();
    expect(data.brandKit.logoUrl).toBe("https://cdn.example/keep-me.png");
    expect(data.brandKit.selectedTagline).toBe("Bow Down.");
    expect(data.brandKit.bioLines).toEqual(["My bio line."]);
  });

  it("apply writes kit colors + fonts into the live profile theme, free", async () => {
    await generateKit();
    state.charges = [];
    const res = await fetch(`${base}/api/brand-kit/apply`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).applied).toBe(true);
    const colors = (state.profile!.themeConfig as any).colors;
    expect(colors.primary).toBe("#C9A84C");
    expect(colors.accent).toBe("#F5D67B");
    expect(colors.background).toBe("#0D0A04");
    const fonts = (state.profile!.themeConfig as any).fonts;
    expect(fonts).toEqual({ heading: "Cinzel", body: "Inter" });
    // The kit itself and unrelated theme keys survive the apply.
    expect((state.profile!.themeConfig as any).brandKit).toBeTruthy();
    expect((state.profile!.themeConfig as any).banner.layout).toBe("full-bleed");
    expect(state.charges).toEqual([]);
  });

  it("apply before generating is an honest 409 NO_KIT", async () => {
    const res = await fetch(`${base}/api/brand-kit/apply`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("NO_KIT");
  });

  it("out of credits: 402, no charge attempted, nothing persisted", async () => {
    state.userCredits = 100;
    const { res } = await generateKit();
    expect(res.status).toBe(402);
    expect(state.charges).toEqual([]);
    expect((state.profile!.themeConfig as any).brandKit).toBeUndefined();
  });

  it("requires auth on every verb", async () => {
    state.authedUserId = null;
    expect((await fetch(`${base}/api/brand-kit`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/brand-kit`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ colors: EDITED_COLORS }),
        })
      ).status,
    ).toBe(401);
    expect((await fetch(`${base}/api/brand-kit/apply`, { method: "POST" })).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/brand-kit/logo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logoUrl: "https://storage.example/generated-clips/logos/user-1/a.png" }),
        })
      ).status,
    ).toBe(401);
  });
});

describe("POST /api/brand-kit/logo — a generated logo lands in the kit", () => {
  async function saveLogo(logoUrl: string) {
    const res = await fetch(`${base}/api/brand-kit/logo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl }),
    });
    return { res, data: await res.json() };
  }

  it("stores a logo already on our storage as-is — permanent, free, no re-host", async () => {
    const url = "https://storage.example/generated-clips/logos/user-1/abc.png";
    const { res, data } = await saveLogo(url);
    expect(res.status).toBe(200);
    expect(data.logoUrl).toBe(url);
    expect(data.mirrored).toBe(false);
    expect(data.replaced).toBe(false);
    expect(data.brandKit.logoUrl).toBe(url);
    expect(state.uploads).toEqual([]);
    expect(state.charges).toEqual([]);
    // It reads back from the kit like every other brand field.
    const get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.logoUrl).toBe(url);
  });

  it("re-hosts an external (provider temp) URL into permanent storage and stores THAT", async () => {
    const { res, data } = await saveLogo(`${base}/external-logo.png`);
    expect(res.status).toBe(200);
    expect(data.mirrored).toBe(true);
    expect(data.logoUrl).toMatch(/^https:\/\/storage\.example\/generated-clips\/logos\/user-1\/.+\.png$/);
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]!.bucket).toBe("generated-clips");
    expect(state.uploads[0]!.path).toMatch(/^logos\/user-1\//);
    expect(state.charges).toEqual([]);
    const stored = (state.profile!.themeConfig as any).brandKit;
    expect(stored.logoUrl).toBe(data.logoUrl);
  });

  it("a second save replaces the kit's one logo — never a duplicate", async () => {
    const first = "https://storage.example/generated-clips/logos/user-1/first.png";
    const second = "https://storage.example/generated-clips/logos/user-1/second.png";
    await saveLogo(first);
    const { res, data } = await saveLogo(second);
    expect(res.status).toBe(200);
    expect(data.replaced).toBe(true);
    expect(data.brandKit.logoUrl).toBe(second);
    const get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.logoUrl).toBe(second);
    // Saving the same logo again is a no-op replace, not a duplicate.
    const again = await saveLogo(second);
    expect(again.data.replaced).toBe(false);
    expect(again.data.brandKit.logoUrl).toBe(second);
  });

  it("keeps the rest of the kit when the logo lands", async () => {
    await generateKit();
    const { data } = await saveLogo("https://storage.example/generated-clips/logos/user-1/abc.png");
    expect(data.brandKit.colors).toHaveLength(5);
    expect(data.brandKit.taglines).toEqual(KIT_JSON.taglines);
    expect(data.brandKit.logoUrl).toContain("abc.png");
  });

  it("rejects a non-URL logo with a 400 and stores nothing", async () => {
    const { res } = await saveLogo("not-a-url");
    expect(res.status).toBe(400);
    const get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit).toBeNull();
  });

  it("no profile is an honest 404 NO_PROFILE", async () => {
    state.profile = null;
    const { res, data } = await saveLogo("https://storage.example/generated-clips/logos/user-1/abc.png");
    expect(res.status).toBe(404);
    expect(data.error).toBe("NO_PROFILE");
  });
});

describe("PUT /api/brand-kit — hand-edited palette + fonts (Ring 4)", () => {
  async function put(body: unknown) {
    const res = await fetch(`${base}/api/brand-kit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json() };
  }

  it("a hand-edited palette + fonts persist and read back — free, no regeneration", async () => {
    await generateKit();
    state.charges = [];
    const { res, data } = await put({ colors: EDITED_COLORS, fonts: EDITED_FONTS });
    expect(res.status).toBe(200);
    expect(data.brandKit.colors).toEqual(EDITED_COLORS);
    expect(data.brandKit.fonts).toEqual(EDITED_FONTS);
    expect(state.charges).toEqual([]);
    const get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.colors).toEqual(EDITED_COLORS);
    expect(get.brandKit.fonts).toEqual(EDITED_FONTS);
    // The edit is a palette swap, not a kit wipe: the generated core stays.
    expect(get.brandKit.taglines).toEqual(KIT_JSON.taglines);
    expect(get.brandKit.logoPrompt).toBe(KIT_JSON.logoPrompt);
  });

  it("a palette patch REPLACES wholesale — it never appends to the generated five", async () => {
    await generateKit();
    await put({ colors: EDITED_COLORS });
    const get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.colors).toHaveLength(3);
    expect(get.brandKit.colors.map((c: any) => c.hex)).not.toContain("#C9A84C");
  });

  it("a manual-only record can hold a hand-built palette (no generation needed)", async () => {
    const { res, data } = await put({ colors: EDITED_COLORS, fonts: EDITED_FONTS });
    expect(res.status).toBe(200);
    expect(data.brandKit.colors).toEqual(EDITED_COLORS);
    expect(state.charges).toEqual([]);
  });

  it("consumers read the EDITED values: apply writes the edited hexes + lead fonts to the theme", async () => {
    await generateKit();
    await put({ colors: EDITED_COLORS, fonts: EDITED_FONTS });
    const res = await fetch(`${base}/api/brand-kit/apply`, { method: "POST" });
    expect(res.status).toBe(200);
    const colors = (state.profile!.themeConfig as any).colors;
    expect(colors.primary).toBe("#FF0055");
    expect(colors.accent).toBe("#00E5FF");
    expect(colors.background).toBe("#101018");
    const fonts = (state.profile!.themeConfig as any).fonts;
    expect(fonts).toEqual({ heading: "Bebas Neue", body: "Space Grotesk" });
  });

  it("rejects malformed palettes with 400 and stores nothing", async () => {
    await generateKit();
    const bad: unknown[] = [
      { colors: [{ hex: "FF0055", name: "No hash", role: "primary" }] },
      { colors: [{ hex: "#FF005", name: "Short hex", role: "primary" }] },
      { colors: [{ hex: "#FF0055", name: "Bad role", role: "hero" }] },
      { colors: [] },
      {
        colors: [
          { hex: "#111111", name: "One", role: "primary" },
          { hex: "#222222", name: "Two", role: "primary" },
        ],
      },
      {
        colors: Array.from({ length: 7 }, (_, i) => ({
          hex: "#111111",
          name: `C${i}`,
          role: ["primary", "secondary", "accent", "neutral", "background", "primary", "accent"][i],
        })),
      },
      { fonts: [] },
      { fonts: [{ heading: "", body: "Inter", usage: "" }] },
      { fonts: [{ heading: "Cinzel", body: "", usage: "" }] },
      { fonts: Array.from({ length: 4 }, () => ({ heading: "A", body: "B", usage: "" })) },
    ];
    for (const body of bad) {
      const { res } = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.colors).toEqual(KIT_JSON.colors);
    expect(get.brandKit.fonts).toEqual(KIT_JSON.fonts);
    expect(state.charges).toEqual([200]); // only the generation charged
  });

  it("a colors-only patch leaves fonts (and vice versa) untouched", async () => {
    await generateKit();
    await put({ colors: EDITED_COLORS });
    let get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.fonts).toEqual(KIT_JSON.fonts);
    await put({ fonts: EDITED_FONTS });
    get = await (await fetch(`${base}/api/brand-kit`)).json();
    expect(get.brandKit.colors).toEqual(EDITED_COLORS);
    expect(get.brandKit.fonts).toEqual(EDITED_FONTS);
  });
});
