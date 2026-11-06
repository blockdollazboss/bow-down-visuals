/**
 * locale-newest-keying.test.ts — Stack-200 Lane D6 (hardening §D):
 * the newest surfaces' locale keying, pinned per surface.
 *
 * House rules this file enforces:
 * - every key this lane added exists, non-empty, in all 10 catalogs;
 * - money-adjacent copy (briefs escrow strings, the money notes,
 *   Earnings/statement labels) is the English source VERBATIM in
 *   every catalog — money copy is never agent-translated;
 * - every other string this lane added is likewise English-verbatim
 *   in the non-en catalogs for now (UNREVIEWED house pattern — the
 *   waves allowlists carry them until real translations land);
 * - the lib seams (ugc-ads label/note helpers, earnings-statement)
 *   stay byte-identical when called with no strings bundle, so the
 *   PDF route and any unkeyed consumer never drift.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  UGC_BRIEFS_MONEY_NOTE,
  UGC_ESCROW_NOTE,
  UGC_PAYMENT_NOTE,
  briefStatusLabel,
  escrowStatusLabel,
  ugcAdStatusLabel,
  ugcBriefMoneyNote,
} from "./ugc-ads";

type Catalog = Record<string, unknown>;
const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
function load(locale: string): Catalog {
  return JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8")) as Catalog;
}
function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flat(v, p ? `${p}.${k}` : k, out);
  } else out[p] = o;
  return out;
}
const CATS = Object.fromEntries(LOCALES.map((l) => [l, flat(load(l))])) as Record<string, Record<string, unknown>>;
const EN = CATS.en;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function expectKeyEverywhere(key: string) {
  for (const loc of LOCALES) {
    const v = CATS[loc][key];
    expect(typeof v, `${key} missing in ${loc}`).toBe("string");
    expect((v as string).length, `${key} empty in ${loc}`).toBeGreaterThan(0);
  }
}
function expectVerbatimEverywhere(key: string) {
  expectKeyEverywhere(key);
  for (const loc of LOCALES) {
    expect(CATS[loc][key], `${key} must stay English-verbatim in ${loc} (UNREVIEWED)`).toBe(EN[key]);
  }
}

/* ── Items 44+45 — the UGC briefs board (2D panel) + money notes ── */

const UGC_ADS_KEYS = Object.keys(EN).filter((k) => k.startsWith("ugcAds."));
const WORLD_UGC_NEW_KEYS = [
  "worldLivePromo.ugcBriefsMoneyNote",
  "worldLivePromo.ugcEscrowNote",
  "worldLivePromo.ugcPaymentNote",
  "worldLivePromo.ugcBriefStatusOpen",
  "worldLivePromo.ugcBriefStatusClaimed",
  "worldLivePromo.ugcBriefStatusDelivered",
  "worldLivePromo.ugcBriefStatusApproved",
  "worldLivePromo.ugcBriefStatusClosed",
  "worldLivePromo.ugcAdStatusDraft",
  "worldLivePromo.ugcAdStatusGenerating",
  "worldLivePromo.ugcAdStatusReady",
  "worldLivePromo.ugcAdStatusFailedRefunded",
];

describe("D6 · briefs board keying (items 44–45)", () => {
  it("the panel-only ugcAds namespace exists in all 10 catalogs, English-verbatim", () => {
    expect(UGC_ADS_KEYS.length).toBeGreaterThanOrEqual(50);
    for (const k of UGC_ADS_KEYS) expectVerbatimEverywhere(k);
  });

  it("the new worldLivePromo.ugc* keys exist in all 10 catalogs", () => {
    for (const k of WORLD_UGC_NEW_KEYS) expectKeyEverywhere(k);
  });

  it("the catalog money notes ARE the lib seam's notes, verbatim in every locale", () => {
    expect(EN["worldLivePromo.ugcBriefsMoneyNote"]).toBe(UGC_BRIEFS_MONEY_NOTE);
    expect(EN["worldLivePromo.ugcEscrowNote"]).toBe(UGC_ESCROW_NOTE);
    expect(EN["worldLivePromo.ugcPaymentNote"]).toBe(UGC_PAYMENT_NOTE);
    for (const k of [
      "worldLivePromo.ugcBriefsMoneyNote",
      "worldLivePromo.ugcEscrowNote",
      "worldLivePromo.ugcPaymentNote",
    ]) {
      expectVerbatimEverywhere(k);
    }
  });

  it("the money-note seam: bundle wins, no bundle is byte-identical to the constants", () => {
    const bundle = { escrowNote: "ESCROW-X", paymentNote: "PAYMENT-X" };
    expect(ugcBriefMoneyNote({ priceCents: 15000 }, bundle)).toBe("ESCROW-X");
    expect(ugcBriefMoneyNote({ priceCents: null }, bundle)).toBe("PAYMENT-X");
    expect(ugcBriefMoneyNote({ priceCents: 15000 })).toBe(UGC_ESCROW_NOTE);
    expect(ugcBriefMoneyNote({ priceCents: null })).toBe(UGC_PAYMENT_NOTE);
    expect(ugcBriefMoneyNote({})).toBe(UGC_PAYMENT_NOTE);
  });

  it("the label seams: bundle wins, defaults stay the English literals", () => {
    expect(escrowStatusLabel("funded", { funded: "F-X" })).toBe("F-X");
    expect(escrowStatusLabel("funded")).toBe("Funded — held safely");
    expect(escrowStatusLabel("unfunded")).toBe("Not funded");
    expect(escrowStatusLabel(null)).toBe("");
    expect(briefStatusLabel("open", { open: "O-X" })).toBe("O-X");
    expect(briefStatusLabel("delivered")).toBe("Delivered");
    expect(briefStatusLabel("mystery")).toBe("mystery");
    expect(ugcAdStatusLabel("failed", { failed: "F-X" })).toBe("F-X");
    expect(ugcAdStatusLabel("failed")).toBe("Failed — refunded");
    expect(ugcAdStatusLabel("generating")).toBe("Generating…");
  });

  it("the hub panel resolves through t() — board, escrow UI, toasts", () => {
    const src = read("../components/hub/UgcAdsPanel.tsx");
    expect(src).toContain("useTranslation");
    expect(src).toContain('t("worldLivePromo.ugcBriefsMoneyNote")');
    expect(src).toContain('t("worldLivePromo.ugcApproveRelease"');
    expect(src).toContain('t("worldLivePromo.ugcCreatorReceives"');
    expect(src).toContain('t("worldLivePromo.ugcBriefPriceHelp")');
    expect(src).toContain('t("ugcAds.fundingPanelNote")');
    expect(src).toContain('t("ugcAds.checkFundingStatus")');
    expect(src).toContain("escrowStatusLabel(brief.escrowStatus, escrowLabels)");
    expect(src).toContain("briefStatusLabel(brief.status, briefStatusLabels)");
    expect(src).toContain("ugcAdStatusLabel(ad.status, adStatusLabels)");
    /* The hard-coded escrow strings the census flagged are gone. */
    expect(src).not.toContain("Finish funding right here");
    expect(src).not.toContain("Approve & release ${");
    expect(src).not.toContain("was released to the creator. This brief is complete.");
    expect(src).not.toContain("{UGC_BRIEFS_MONEY_NOTE}");
  });

  it("the money note's other two surfaces resolve through the same key", () => {
    expect(read("../pages/discovery/charts.tsx")).toContain('t("worldLivePromo.ugcBriefsMoneyNote")');
    expect(read("../components/world/native/boards/BrandOutreachPanel.tsx")).toContain(
      't("worldLivePromo.ugcBriefsMoneyNote")',
    );
  });

  it("the World station passes catalog labels into the same seams", () => {
    const src = read("../components/world/native/UgcAdsStation.tsx");
    expect(src).toContain("ugcAdStatusLabel(ad.status, adStatusLabels)");
    expect(src).toContain("briefStatusLabel(brief.status, briefStatusLabels)");
  });
});
