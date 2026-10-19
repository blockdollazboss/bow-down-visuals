import { describe, expect, it, vi, afterEach } from "vitest";
import {
  applyBrandKit,
  bioPageFieldsFromBrandKit,
  brandKitColor,
  BrandKitRequestError,
  fetchBrandKit,
  generateBrandKit,
  pressKitFieldsFromBrandKit,
  saveBrandKit,
  saveLogoToBrandKit,
  type BrandKit,
} from "./brand-kit";

const sample: BrandKit = {
  brandName: "Bow Down Visuals",
  vibe: "royal gold luxury",
  industry: "music",
  colors: [
    { hex: "#C9A84C", name: "Royal Gold", role: "primary" },
    { hex: "#F5D67B", name: "Crown Light", role: "accent" },
    { hex: "#0D0A04", name: "Palace Night", role: "background" },
  ],
  fonts: [{ heading: "Cinzel", body: "Inter", usage: "Headlines and body" }],
  logoPrompt: "A gold shark crest",
  taglines: ["Bow Down.", "The Cheat Code."],
  selectedTagline: "Bow Down.",
  logoUrl: "https://cdn.example/logo.png",
  bioLines: ["Gold-standard creator studio.", "Home of the King Shark."],
  pressFacts: ["Featured on the Grand Stage"],
  generatedAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("brand kit client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetchBrandKit reads the saved kit with the caller's token", async () => {
    const fetchMock = stubFetch(() => okJson({ brandKit: sample }));
    const kit = await fetchBrandKit(async () => "tok-1");
    expect(kit).toEqual(sample);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/brand-kit");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("fetchBrandKit returns null when no kit is saved (not an error)", async () => {
    stubFetch(() => okJson({ brandKit: null }));
    await expect(fetchBrandKit(async () => null)).resolves.toBeNull();
  });

  it("reads throw on failure so consumers show an honest error", async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    await expect(fetchBrandKit(async () => null)).rejects.toMatchObject({ status: 500 });
  });

  it("generateBrandKit posts the brief and reports saved + balance", async () => {
    const fetchMock = stubFetch(() =>
      okJson({ kit: { colors: sample.colors, fonts: sample.fonts, logoPrompt: sample.logoPrompt, taglines: sample.taglines }, brandKit: sample, saved: true, creditsRemaining: 800 }),
    );
    const result = await generateBrandKit(async () => "tok", { brandName: "Bow Down Visuals", vibe: "royal gold luxury" });
    expect(result.saved).toBe(true);
    expect(result.creditsRemaining).toBe(800);
    expect(result.brandKit?.logoUrl).toBe("https://cdn.example/logo.png");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("a 402 surfaces as an out-of-credits error", async () => {
    stubFetch(() => ({ ok: false, status: 402, json: async () => ({ error: "out_of_credits", message: "Not enough Visual Bucs." }) }));
    const err = await generateBrandKit(async () => "tok", { brandName: "X", vibe: "yyy" }).catch((e) => e);
    expect(err).toBeInstanceOf(BrandKitRequestError);
    expect((err as BrandKitRequestError).outOfCredits).toBe(true);
  });

  it("saveBrandKit PUTs the patch and returns the stored record", async () => {
    const fetchMock = stubFetch(() => okJson({ brandKit: sample }));
    const kit = await saveBrandKit(async () => "tok", { logoUrl: "https://cdn.example/logo.png" });
    expect(kit.logoUrl).toBe("https://cdn.example/logo.png");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ logoUrl: "https://cdn.example/logo.png" });
  });

  it("saveLogoToBrandKit posts the logo to the kit's logo endpoint and returns the stored URL + flags", async () => {
    const fetchMock = stubFetch(() =>
      okJson({ brandKit: sample, logoUrl: "https://storage.example/generated-clips/logos/user-1/x.png", mirrored: true, replaced: false }),
    );
    const result = await saveLogoToBrandKit(async () => "tok", "https://provider.example/temp/logo.png");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/brand-kit/logo");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ logoUrl: "https://provider.example/temp/logo.png" });
    expect(result.logoUrl).toBe("https://storage.example/generated-clips/logos/user-1/x.png");
    expect(result.mirrored).toBe(true);
    expect(result.replaced).toBe(false);
    expect(result.brandKit).toEqual(sample);
  });

  it("saveLogoToBrandKit throws on failure (no profile) so the UI can show a failed state", async () => {
    stubFetch(() => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "NO_PROFILE", message: "Create your creator profile first — your brand kit saves onto it." }),
    }));
    const err = await saveLogoToBrandKit(async () => "tok", "https://cdn.example/logo.png").catch((e) => e);
    expect(err).toBeInstanceOf(BrandKitRequestError);
    expect((err as BrandKitRequestError).status).toBe(404);
    expect((err as BrandKitRequestError).code).toBe("NO_PROFILE");
  });

  it("applyBrandKit posts to the apply endpoint", async () => {
    const fetchMock = stubFetch(() => okJson({ applied: true, brandKit: sample }));
    await applyBrandKit(async () => "tok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/brand-kit/apply");
    expect(init.method).toBe("POST");
  });
});

describe("brand kit consumer projections", () => {
  it("brandKitColor resolves a color by role", () => {
    expect(brandKitColor(sample, "primary")).toBe("#C9A84C");
    expect(brandKitColor(sample, "background")).toBe("#0D0A04");
    expect(brandKitColor(sample, "neutral")).toBeNull();
    expect(brandKitColor(null, "primary")).toBeNull();
  });

  it("press kit projection: name, chosen tagline, bio lines, press facts — and NO logo as photo", () => {
    const fields = pressKitFieldsFromBrandKit(sample);
    expect(fields).toEqual({
      artistName: "Bow Down Visuals",
      tagline: "Bow Down.",
      bio: "Gold-standard creator studio.\n\nHome of the King Shark.",
      achievements: ["Featured on the Grand Stage"],
    });
    expect(fields).not.toHaveProperty("photoUrls");
  });

  it("bio page projection: the logo IS the bio avatar there", () => {
    expect(bioPageFieldsFromBrandKit(sample)).toEqual({
      displayName: "Bow Down Visuals",
      headline: "Bow Down.",
      bio: "Gold-standard creator studio. Home of the King Shark.",
      avatarUrl: "https://cdn.example/logo.png",
    });
  });

  it("projections are empty for a kit-less creator", () => {
    expect(pressKitFieldsFromBrandKit(null)).toEqual({});
    expect(bioPageFieldsFromBrandKit(null)).toEqual({});
  });
});
