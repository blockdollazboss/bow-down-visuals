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
import {
  statementLineRows,
  statementLineText,
  statementMoney,
  statementStringsFrom,
  statementTotalLabel,
  type EarningsStatement,
} from "./earnings-statement";

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
    /* Stack-300 A6: the fee percent interpolates from the brief rail
       (DTO feeBps / rail default) — no typed "5%" copy remains. */
    expect(src).toContain('t("worldLivePromo.ugcBriefPriceHelp", { feePct: ugcFeePct(null) })');
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

/* ── Items 48+49 — Earnings page cards + the year statement ─────── */

const EARNINGS_KEYS = Object.keys(EN).filter((k) => k.startsWith("earnings."));

describe("D6 · earnings keying (items 48–49)", () => {
  it("the earnings namespace exists in all 10 catalogs, English-verbatim (money labels)", () => {
    expect(EARNINGS_KEYS.length).toBe(39);
    for (const k of EARNINGS_KEYS) expectVerbatimEverywhere(k);
  });

  it("Stack 300 remainders (items 111–112): the bookings card + four older SourceCards carry the exact English source", () => {
    expect(EN["earnings.bookingsTitle"]).toBe("Performance bookings (escrow released)");
    /* Figures by interpolation only — the fee wording is the English source, never re-drafted. */
    expect(EN["earnings.bookingsDetail"]).toBe("gross {{gross}} · platform fee {{fee}} (15%)");
    expect(EN["earnings.storeSalesTitle"]).toBe("Store sales");
    expect(EN["earnings.beatsTitle"]).toBe("Beats (licenses sold)");
    expect(EN["earnings.membershipsTitle"]).toBe("Memberships");
    expect(EN["earnings.brandDealsTitle"]).toBe("Brand deals (escrow released)");
    const page = read("../pages/earnings.tsx");
    expect(page).toContain('t("earnings.bookingsTitle")');
    expect(page).toContain('t("earnings.bookingsDetail"');
    expect(page).toContain('t("earnings.storeSalesTitle")');
    expect(page).toContain('t("earnings.beatsTitle")');
    expect(page).toContain('t("earnings.membershipsTitle")');
    expect(page).toContain('t("earnings.brandDealsTitle")');
    /* The hard-coded literals the census flagged are gone. */
    expect(page).not.toContain('title="Performance bookings (escrow released)"');
    expect(page).not.toContain('title="Store sales"');
    expect(page).not.toContain('title="Beats (licenses sold)"');
    expect(page).not.toContain('title="Memberships"');
    expect(page).not.toContain('title="Brand deals (escrow released)"');
  });

  it("the statement seam: no bundle is byte-identical to the PDF's English", () => {
    const stmt: EarningsStatement = {
      sources: {
        shoutouts: { status: "ok", totalCents: 950, count: 2 },
        tipJar: { status: "ok", totalCents: 500, count: 1 },
        ugcBriefs: { status: "error", totalCents: null, count: 0 },
      },
      totalCents: 1450,
      partial: true,
    };
    const rows = statementLineRows(stmt);
    expect(rows.map((r) => r.label)).toEqual(["Shoutouts", "Tip jar tips", "UGC briefs"]);
    expect(statementLineText(rows[0])).toBe("$9.50 · 2 records");
    expect(statementLineText(rows[2])).toBe("couldn't load");
    expect(statementTotalLabel(true)).toBe("Total of the sources that loaded");
    expect(statementTotalLabel(false)).toBe("Total");
    expect(statementMoney(null)).toBe("couldn't load");
    expect(statementMoney(1450)).toBe("$14.50");
  });

  it("the statement seam: a catalog bundle threads labels, line text and totals", () => {
    const strings = statementStringsFrom((k) => EN[k] as string);
    const stmt: EarningsStatement = {
      sources: { shoutouts: { status: "ok", totalCents: 950, count: 2 } },
      totalCents: 950,
      partial: false,
    };
    const rows = statementLineRows(stmt, strings);
    expect(rows[0].label).toBe("Shoutouts");
    expect(statementLineText(rows[0], strings)).toBe("$9.50 · 2 records");
    expect(statementTotalLabel(false, strings)).toBe("Total");
    /* A bundle really is a bundle: custom words win. */
    const custom = { labels: { shoutouts: "SH-X" }, couldntLoad: "CL-X", lineTemplate: "{{money}}!", total: "T-X", totalPartial: "TP-X" };
    expect(statementLineRows(stmt, custom)[0].label).toBe("SH-X");
    expect(statementLineText(rows[0], custom)).toBe("$9.50!");
    expect(statementTotalLabel(true, custom)).toBe("TP-X");
    expect(statementMoney(null, "CL-X")).toBe("CL-X");
  });

  it("the Earnings page + both statement viewers resolve through the keys", () => {
    const page = read("../pages/earnings.tsx");
    expect(page).toContain('t("earnings.title")');
    expect(page).toContain('t("earnings.shoutoutsTitle")');
    expect(page).toContain('t("earnings.shoutoutsDetail"');
    expect(page).toContain('t("earnings.tipJarTitle")');
    expect(page).toContain('t("earnings.tipJarDetail")');
    expect(page).toContain("earnings.ledgerShoutout");
    expect(page).toContain("earnings.ledgerTipJarTip");
    expect(read("../components/trust/TrustPanels.tsx")).toContain("statementStringsFrom");
    expect(read("../components/world/native/boards/EarningsBoard.tsx")).toContain("statementStringsFrom(t)");
  });

  /* Stack-400 A-04/A-05/A-06 (lane s400-earnings-labels): one label
     per source across cards + statement, the two tip sources named
     apart, and both headline figures keyed with coverage words. */
  it("A-05: statement labels are single-sourced from the card titles", () => {
    expect(EN["earnings.stmtBeats"]).toBe(EN["earnings.beatsTitle"]);
    expect(EN["earnings.stmtBrandDeals"]).toBe(EN["earnings.brandDealsTitle"]);
    expect(EN["earnings.stmtBookings"]).toBe(EN["earnings.bookingsTitle"]);
    expect(EN["earnings.stmtTipJar"]).toBe(EN["earnings.tipJarTitle"]);
    expect(EN["earnings.stmtStoreSales"]).toBe(EN["earnings.storeSalesTitle"]);
    expect(EN["earnings.stmtMemberships"]).toBe(EN["earnings.membershipsTitle"]);
    expect(EN["earnings.stmtShoutouts"]).toBe(EN["earnings.shoutoutsTitle"]);
  });

  it("A-04 + A-06: the VB tips card and both headlines are keyed, coverage in plain words", () => {
    expect(EN["earnings.tipsBucsTitle"]).toBe("Stream & stage tips (Visual Bucs)");
    expect(EN["earnings.totalEarnedTitle"]).toBe("Total earned (USD) — the sources below");
    expect(EN["earnings.pendingPayoutTitle"]).toBe("Pending payout — your payable balance");
    const page = read("../pages/earnings.tsx");
    expect(page).toContain('t("earnings.tipsBucsTitle")');
    expect(page).toContain('t("earnings.totalEarnedTitle")');
    expect(page).toContain('t("earnings.totalEarnedNote")');
    expect(page).toContain('t("earnings.pendingPayoutTitle")');
    expect(page).toContain('t("earnings.pendingPayoutNote")');
    /* The hard-coded literals the census flagged are gone. */
    expect(page).not.toContain(">Tips</div>");
    expect(page).not.toContain("Total earned (USD)</div>");
    expect(page).not.toContain(">Pending payout</div>");
    /* A-04: the USD tip-jar pending line no longer duplicates inside the VB card. */
    expect(page).not.toContain("tipJarPendingCents");
  });
});

/* ── Items 46+47+52 — the C-21 keys + sponsor handoff sentences ─── */

describe("D6 · C-21 keying (items 46–47, 52)", () => {
  it("the three defaultValue-only C-21 keys now exist in all 10 catalogs", () => {
    expectKeyEverywhere("brandDeals.related.brandCalculator");
    expect(EN["brandDeals.related.brandCalculator"]).toBe("Brand calculator");
    /* Money-adjacent (escrow funding) — verbatim everywhere. */
    expectVerbatimEverywhere("sponsors.managerHandoffNote");
    expect(EN["sponsors.managerHandoffNote"]).toBe(
      "Deals open on their own page — apply, fund escrow, and deliver there. This tab is for browsing and matching.",
    );
    expectKeyEverywhere("sponsors.openInManager");
    expect(EN["sponsors.openInManager"]).toBe("Open deal");
  });

  it("the Coach door labels exist in all 10 catalogs", () => {
    expectKeyEverywhere("coach.tabManageDeals");
    expect(EN["coach.tabManageDeals"]).toBe("Manage Deals");
    expectKeyEverywhere("coach.tabActionTracker");
    expect(EN["coach.tabActionTracker"]).toBe("Action Tracker");
    expectKeyEverywhere("coach.tabContracts");
    expect(EN["coach.tabContracts"]).toBe("Contracts");
  });

  it("the sponsor handoff sentences are keyed (money sentence verbatim everywhere)", () => {
    for (const k of [
      "sponsors.handoffSelfPrefix",
      "sponsors.handoffSelfLink",
      "sponsors.handoffFunded",
      "sponsors.handoffOrOnThe",
      "sponsors.handoffDealPage",
    ]) {
      expectVerbatimEverywhere(k);
    }
    const src = read("../components/artist/SponsorCreatorSection.tsx");
    expect(src).toContain("useTranslation");
    expect(src).toContain('t("sponsors.handoffSelfPrefix")');
    expect(src).toContain('t("sponsors.handoffFunded"');
    expect(src).not.toContain("This is your page — sponsorships of you land in your");
    expect(src).not.toContain("when you release payment after they deliver");
  });
});

/* ── Items 50+51+53 — sound picker, sound names rule, beats modal ── */

const SOUND_PICKER_KEYS = [
  "beatMaker.soundPickerAria",
  "beatMaker.soundSaved",
  "beatMaker.soundNotLoadedShort",
  "beatMaker.soundGroupBuiltIn",
  "beatMaker.soundGroupBank",
  "beatMaker.soundBankComing",
  "beatMaker.soundGroupYours",
  "beatMaker.soundSessionOnlyShort",
  "beatMaker.soundNoneLoaded",
  "beatMaker.soundLoadOwn",
];
const BEATS_MODAL_KEYS = [
  "beats.soldExclusively",
  "beats.sellPrefilledNote",
  "beats.noStemsOnFile",
  "beats.signInToLicense",
  "beats.signInToLicenseButton",
  "beats.agreeAndPayButton",
];

describe("D6 · beat studio + beats modal keying (items 50–51, 53)", () => {
  it("the sound-picker family exists in all 10 catalogs, English-verbatim", () => {
    for (const k of SOUND_PICKER_KEYS) expectVerbatimEverywhere(k);
    expect(EN["beatMaker.soundGroupBank"]).toBe("Sound Bank");
    /* The picker resolves through t() — the keys were defaultValue-only before. */
    const src = read("../components/audio-studio/AiAudio.tsx");
    for (const k of SOUND_PICKER_KEYS) expect(src).toContain(`t("${k}"`);
  });

  it("item 51 ruled: sound names are product names, documented at the registry", () => {
    expect(read("./beat-sounds.ts")).toContain("sound DISPLAY\n * NAMES are product names");
    expect(read("./beat-sounds.ts")).toContain("NOT\n * catalog keys");
  });

  it("the beats modal's six defaultValue-only strings are real keys in all 10 catalogs", () => {
    for (const k of BEATS_MODAL_KEYS) expectVerbatimEverywhere(k);
    expect(EN["beats.agreeAndPayButton"]).toBe("Agree & pay — {{price}}");
    const src = read("../pages/beats.tsx");
    for (const k of BEATS_MODAL_KEYS) expect(src).toContain(`t("${k}"`);
  });

  it("item 53 exemption: the plain-terms legal copy is formally exempt, documented at the constant", () => {
    const src = read("./beat-license-terms.ts");
    expect(src).toContain("LOCALE EXEMPTION (Stack-200 D6, hardening §D item 53)");
    expect(src).toContain("DELIBERATELY English-only");
  });
});
