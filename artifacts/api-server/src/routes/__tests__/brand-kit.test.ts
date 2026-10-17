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

const state = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  userCredits: 1000,
  profile: null as { themeConfig: Record<string, unknown> } | null,
  charges: [] as number[],
  refunds: [] as number[],
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
    expect((await fetch(`${base}/api/brand-kit/apply`, { method: "POST" })).status).toBe(401);
  });
});
