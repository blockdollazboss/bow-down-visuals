/**
 * ugc-ads-error-keys.test.ts — Stack-300 item 113: the UGC ads /
 * briefs rail's failure words are catalog keys, not hard-coded
 * English literals in the client.
 *
 * - every client function in lib/ugc-ads throws its failure with the
 *   catalog key as the error message (the server's own plain message
 *   still wins through apiErrorMessage when one came back);
 * - `ugcErrorText` is the ONLY render seam: a key resolves through
 *   the surface's catalog, a plain server message passes through,
 *   and a raw server code never surfaces (it speaks through
 *   api-error's word map, or collapses to the fallback) — the key
 *   itself never reaches a reader raw;
 * - the English source of every key lives in the catalogs (the
 *   locale-newest-keying suite pins the whole ugcAds namespace in
 *   every locale; here we pin the en values to the words the client
 *   used to hard-code, so the keying changed no reader-facing copy);
 * - the Promote page wraps its nine hub panels in SectionBoundary
 *   isolation (item 110 — a crash in one panel reads as that panel's
 *   failure, never the whole page), and both UGC surfaces render
 *   lib errors through the seam and money through centsToDisplay
 *   (item 113b — no hand-rolled $x.xx literals left on the seam).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  briefAction,
  confirmUgcBriefFunding,
  createUgcAd,
  deleteUgcAd,
  fetchMyShopProducts,
  fetchMyUgcAds,
  fetchUgcAd,
  fetchUgcBriefs,
  fundUgcBrief,
  generateUgcAdVideo,
  generateUgcPersona,
  generateUgcScript,
  pinUgcAd,
  postUgcBrief,
  ugcErrorText,
  unpinUgcAd,
  verifyUgcBriefFunding,
  type UgcErrorKey,
} from "./ugc-ads";
import en from "../locales/en.json";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* The words the client threw as hard-coded English before item 113 —
   now the en catalog source for the keys. */
const EXPECTED_EN: Record<UgcErrorKey, string> = {
  "ugcAds.loadProductsFailed": "Could not load your shop products.",
  "ugcAds.loadAdsFailed": "Could not load your UGC ads.",
  "ugcAds.loadBriefsFailed": "Could not load the briefs board.",
  "ugcAds.loadAdFailed": "Could not load that ad.",
  "ugcAds.scriptGenFailed": "The script didn't come through — try again.",
  "ugcAds.personaGenFailed": "The persona didn't come through — try again.",
  "ugcAds.createAdFailed": "Could not start that ad — try again.",
  "ugcAds.videoGenFailed": "Generation failed — any charge was refunded.",
  "ugcAds.deleteAdFailed": "Could not delete that ad.",
  "ugcAds.pinAdFailed": "Could not pin that ad — try again.",
  "ugcAds.unpinAdFailed": "Could not unpin that ad — try again.",
  "ugcAds.postBriefGenFailed": "Could not post that brief — try again.",
  "ugcAds.briefActionGenFailed": "That didn't land — refresh the board and try again.",
  "ugcAds.fundGenFailed": "Could not start the funding payment — try again.",
  "ugcAds.fundConfirmGenFailed": "Could not confirm that funding — try again.",
  "ugcAds.fundVerifyGenFailed": "Could not verify that funding — try again.",
};

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("item 113 — the client throws catalog keys, never English literals", () => {
  it("every key's en catalog value is the word the client used to hard-code", () => {
    const catalog = (en as { ugcAds: Record<string, string> }).ugcAds;
    for (const [key, words] of Object.entries(EXPECTED_EN)) {
      expect(catalog[key.slice("ugcAds.".length)], key).toBe(words);
    }
  });

  it("a failed load/action rejects with its key when the server sent no plain message", async () => {
    stubFetch(500, {});
    await expect(fetchMyShopProducts("tok")).rejects.toThrow("ugcAds.loadProductsFailed");
    await expect(fetchMyUgcAds("tok")).rejects.toThrow("ugcAds.loadAdsFailed");
    await expect(fetchUgcBriefs("tok")).rejects.toThrow("ugcAds.loadBriefsFailed");
    await expect(fetchUgcAd("tok", "ad-1")).rejects.toThrow("ugcAds.loadAdFailed");
    await expect(
      generateUgcScript("tok", { productName: "Tee", productBlurb: "", style: "honest-review" }),
    ).rejects.toThrow("ugcAds.scriptGenFailed");
    await expect(generateUgcPersona("tok", "a creator", "key-1")).rejects.toThrow(
      "ugcAds.personaGenFailed",
    );
    await expect(
      createUgcAd("tok", { productName: "Tee", style: "honest-review" }),
    ).rejects.toThrow("ugcAds.createAdFailed");
    await expect(generateUgcAdVideo("tok", "ad-1")).rejects.toThrow("ugcAds.videoGenFailed");
    await expect(deleteUgcAd("tok", "ad-1")).rejects.toThrow("ugcAds.deleteAdFailed");
    await expect(pinUgcAd("tok", "ad-1")).rejects.toThrow("ugcAds.pinAdFailed");
    await expect(unpinUgcAd("tok", "ad-1")).rejects.toThrow("ugcAds.unpinAdFailed");
    await expect(
      postUgcBrief("tok", { productName: "Boots", details: "Show them.", style: "problem-fix" }),
    ).rejects.toThrow("ugcAds.postBriefGenFailed");
    await expect(briefAction("tok", "brief-1", "claim")).rejects.toThrow(
      "ugcAds.briefActionGenFailed",
    );
    await expect(fundUgcBrief("tok", "brief-1")).rejects.toThrow("ugcAds.fundGenFailed");
    await expect(confirmUgcBriefFunding("tok", "brief-1", "sess-1")).rejects.toThrow(
      "ugcAds.fundConfirmGenFailed",
    );
    await expect(verifyUgcBriefFunding("tok", "brief-1")).rejects.toThrow(
      "ugcAds.fundVerifyGenFailed",
    );
  });

  it("the server's own plain message still wins over the key", async () => {
    stubFetch(400, { message: "That product is not in your shop." });
    await expect(
      generateUgcScript("tok", { productName: "Tee", productBlurb: "", style: "honest-review" }),
    ).rejects.toThrow("That product is not in your shop.");
  });
});

describe("ugcErrorText — the render seam", () => {
  const resolve = (key: UgcErrorKey): string => EXPECTED_EN[key];

  it("resolves a lib key through the caller's catalog", () => {
    expect(ugcErrorText(new Error("ugcAds.pinAdFailed"), resolve, "fallback")).toBe(
      "Could not pin that ad — try again.",
    );
  });

  it("passes a plain server message through untouched", () => {
    expect(
      ugcErrorText(new Error("That product is not in your shop."), resolve, "fallback"),
    ).toBe("That product is not in your shop.");
  });

  it("collapses a raw server code to its mapped words or the fallback — never renders it raw", () => {
    /* Known codes speak through api-error's word map (plainErrorText);
       the raw code itself never surfaces. */
    expect(ugcErrorText(new Error("out_of_credits"), resolve, "fallback words")).toBe(
      "Not enough Visual Bucs — top up and try again. You weren't charged.",
    );
    expect(ugcErrorText(new Error("some_unmapped_code"), resolve, "fallback words")).toBe(
      "fallback words",
    );
    /* A non-Error value speaks plainErrorText's rule: a plain string
       IS its own words; anything else collapses to the fallback. */
    expect(ugcErrorText("nope", resolve, "fallback words")).toBe("nope");
    expect(ugcErrorText(null, resolve, "fallback words")).toBe("fallback words");
  });
});

describe("item 110 + 113b — surface wiring pins", () => {
  it("promote.tsx wraps exactly the nine hub panels in SectionBoundary isolation", () => {
    const src = read("../pages/promote.tsx");
    for (const name of [
      "promote-results-wall",
      "promote-viral-spike",
      "promote-drop-day",
      "promote-widgets-desk",
      "promote-social-kit",
      "promote-promo-cards",
      "promote-ugc-ads",
      "promote-unlock-gates",
      "promote-stream-overlays",
    ]) {
      expect(src).toContain(`<SectionBoundary name="${name}">`);
    }
    expect(src.match(/<SectionBoundary /g)).toHaveLength(9);
  });

  it("both UGC surfaces render lib errors through ugcErrorText and money through the locale formatter", () => {
    const panel = read("../components/hub/UgcAdsPanel.tsx");
    expect(panel).toContain("ugcErrorText(err, (key) => t(key)");
    expect(panel).toContain('from "@/lib/shops"');
    expect(panel).toContain("centsToDisplay(cents, locale)");
    expect(panel).not.toContain(".toFixed(2)");
    const station = read("../components/world/native/UgcAdsStation.tsx");
    expect(station).toContain("ugcErrorText(err, (key) => t(key)");
  });
});
