/**
 * ugc-station — Stack-100 #56.
 * The in-world UGC Product Ads station rides the website panel's
 * own seam (lib/ugc-ads) and rails. These tests pin the maker's
 * gates in the panel's own order, the create payload's exact shape,
 * the brief form's rules (incl. the end-of-day deadline), and —
 * via source pins — that the station's charged calls ride the
 * credit confirmation and the briefs board carries the no-money
 * honesty note verbatim.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UGC_PAYMENT_NOTE, UGC_PERSONA_CREDIT_COST, UGC_VIDEO_CREDIT_COST } from "@/lib/ugc-ads";
import {
  briefDeadlineIso,
  buildBriefInput,
  buildUgcCreateInput,
  makePersonaKey,
  makerProductName,
  personaDescriptionReady,
  scriptFromMaker,
  validateBriefForm,
  validateUgcMaker,
  type UgcMakerState,
} from "./ugc-station";

const MAKER: UgcMakerState = {
  productSource: "shop",
  shopProductId: "prod-1",
  productName: "",
  productBlurb: "Smells like money",
  productPrice: "",
  productImageUrl: "",
  style: "honest-review",
  faceMode: "none",
  personaUrl: "",
  facePhotoUrl: "",
  hook: "Stop scrolling",
  scriptLines: "This balm changed my mornings.\nOne jar lasts a month.",
  cta: "Link's in my shop",
  briefId: null,
};

describe("ugc maker — script + gates in the panel's order", () => {
  it("script needs hook, a spoken line and a call to action", () => {
    expect(scriptFromMaker(MAKER)).toEqual({
      hook: "Stop scrolling",
      lines: ["This balm changed my mornings.", "One jar lasts a month."],
      cta: "Link's in my shop",
    });
    expect(scriptFromMaker({ ...MAKER, hook: " " })).toBeNull();
    expect(scriptFromMaker({ ...MAKER, scriptLines: "\n\n" })).toBeNull();
    expect(scriptFromMaker({ ...MAKER, cta: "" })).toBeNull();
  });

  it("validation speaks the panel's refusals, in order", () => {
    expect(validateUgcMaker(MAKER)).toBeNull();
    expect(validateUgcMaker({ ...MAKER, hook: "" })).toContain("needs a script");
    expect(validateUgcMaker({ ...MAKER, shopProductId: "" })).toContain("Pick one of your shop products");
    expect(validateUgcMaker({ ...MAKER, productSource: "upload", productName: " " })).toContain("Name the product");
    expect(validateUgcMaker({ ...MAKER, faceMode: "persona" })).toContain("Generate the persona first");
    expect(validateUgcMaker({ ...MAKER, faceMode: "persona", personaUrl: "https://cdn.example/p.png" })).toBeNull();
  });

  it("product name resolves from the shop pick or the typed name", () => {
    const products = [{ id: "prod-1", name: "Boss Balm" }];
    expect(makerProductName(MAKER, products)).toBe("Boss Balm");
    expect(makerProductName({ ...MAKER, productSource: "upload", productName: "  Typed  " }, products)).toBe("Typed");
    expect(makerProductName({ ...MAKER, shopProductId: "gone" }, products)).toBe("");
  });

  it("persona gate: a sentence or two, and a fresh key per intent", () => {
    expect(personaDescriptionReady("too short")).toBe(false);
    expect(personaDescriptionReady("a barber in Chicago with locs")).toBe(true);
    expect(makePersonaKey(123, "abc")).toBe("persona-123-abc");
  });
});

describe("ugc maker — the create payload is the panel's own shape", () => {
  it("shop source carries the product id and the persona face", () => {
    const input = buildUgcCreateInput({
      ...MAKER,
      faceMode: "persona",
      personaUrl: "https://cdn.example/p.png",
      briefId: "brief-9",
    })!;
    expect(input.productSource).toBe("shop");
    expect(input.shopProductId).toBe("prod-1");
    expect(input.productName).toBeUndefined();
    expect(input.faceImageUrl).toBe("https://cdn.example/p.png");
    expect(input.faceKind).toBe("persona");
    expect(input.briefId).toBe("brief-9");
    expect(input.script?.hook).toBe("Stop scrolling");
  });

  it("upload source converts dollars to cents and trims blanks away", () => {
    const input = buildUgcCreateInput({
      ...MAKER,
      productSource: "upload",
      productName: "  Boss Balm ",
      productPrice: "19.99",
      productImageUrl: " https://cdn.example/balm.png ",
      faceMode: "photo",
      facePhotoUrl: " https://cdn.example/me.png ",
    })!;
    expect(input.productName).toBe("Boss Balm");
    expect(input.productPriceCents).toBe(1999);
    expect(input.productImageUrl).toBe("https://cdn.example/balm.png");
    expect(input.faceImageUrl).toBe("https://cdn.example/me.png");
    expect(input.faceKind).toBe("photo");
    const badPrice = buildUgcCreateInput({ ...MAKER, productSource: "upload", productName: "X", productPrice: "abc" })!;
    expect(badPrice.productPriceCents).toBeUndefined();
    expect(buildUgcCreateInput({ ...MAKER, hook: "" })).toBeNull();
  });
});

describe("ugc briefs — form rules + the end-of-day deadline", () => {
  const FORM = {
    productName: "Boss Balm",
    details: "Show the morning routine and the shine at the end.",
    style: "problem-fix" as const,
    deadline: "2026-11-01",
    productUrl: "",
    productImageUrl: "",
  };

  it("a brief needs a product and a real description", () => {
    expect(validateBriefForm(FORM)).toBeNull();
    expect(validateBriefForm({ ...FORM, productName: " " })).toContain("product's name");
    expect(validateBriefForm({ ...FORM, details: "short" })).toContain("10+ characters");
  });

  it("deadline lands at end of the picked day; the input shape is the panel's", () => {
    const iso = briefDeadlineIso("2026-11-01")!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 1, 23, 59]);
    expect(briefDeadlineIso("")).toBeUndefined();
    expect(buildBriefInput(FORM)).toEqual({
      productName: "Boss Balm",
      details: "Show the morning routine and the shine at the end.",
      style: "problem-fix",
      deadline: iso,
      productUrl: undefined,
      productImageUrl: undefined,
    });
  });
});

describe("ugc station — prices, confirmation law, board honesty (source pins)", () => {
  const station = readFileSync(new URL("../../components/world/native/UgcAdsStation.tsx", import.meta.url), "utf8");
  const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");

  it("prices are the seam's own constants (persona 100 / video 400)", () => {
    expect(UGC_PERSONA_CREDIT_COST).toBe(100);
    expect(UGC_VIDEO_CREDIT_COST).toBe(400);
    expect(station).toContain("UGC_PERSONA_CREDIT_COST");
    expect(station).toContain("UGC_VIDEO_CREDIT_COST");
  });

  it("both charged calls ride confirmedFetch with the seam's prices as overrides", () => {
    expect(station).toContain('confirmedFetch("/api/ugc-ads/persona"');
    expect(station).toContain("overrideCost: UGC_PERSONA_CREDIT_COST");
    expect(station).toContain("overrideCost: UGC_VIDEO_CREDIT_COST");
    expect(station).toContain("`/api/ugc-ads/${adId}/generate`");
  });

  it("the board states the no-money note verbatim and offers the full lifecycle", () => {
    expect(UGC_PAYMENT_NOTE).toContain("doesn't hold or move money for briefs");
    expect(station).toContain("UGC_PAYMENT_NOTE");
    expect(station).toContain('data-testid="world-ugc-payment-note"');
    for (const id of ["claim", "deliver", "approve", "release", "close"]) {
      expect(station).toContain(`data-testid="world-ugc-brief-${id}"`);
    }
    expect(station).toContain('data-testid="world-ugc-ad-pin"');
    expect(station).toContain("pinActionFor(ad)");
    expect(station).toContain("briefActionsFor(brief, user?.id ?? null)");
  });

  it("the station is docked in the Promote Room", () => {
    expect(desk).toContain("<UgcAdsStation isLight={isLight} />");
    expect(station).toContain('data-testid="world-ugc-station"');
    expect(station).toContain('data-testid="world-ugc-generate"');
    expect(station).toContain('data-testid="world-ugc-persona-make"');
    expect(station).toContain('data-testid="world-ugc-script-turbo"');
  });
});
