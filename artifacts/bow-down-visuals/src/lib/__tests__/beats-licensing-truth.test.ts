/**
 * Beats licensing truth — FE pins (stack1100 Lane X4).
 *
 * The server half lives in the API suite of the same name; these pins
 * hold the page/desk half of the same convictions:
 *  C1 — the license modal closes the WHOLE shelf on an
 *       exclusive-sold beat (every tier + template disabled, pay
 *       button disabled), matching the server's 409.
 *  C3 — 'refunded' is named "Refunded" on the 2D chips and in the
 *       World desk's status helper — never "status unavailable".
 *  C4/C6 — the sell form actually sends the preview + stems slots
 *       the API accepts (it never did: previews fell back to the
 *       full master and stems could never be put on file).
 *  C5 — the dashboard tab carries the buyer's library: it fetches
 *       GET /api/beats/licenses/mine, renders its own failure card
 *       BEFORE its empty state, and the checkout-return banner keeps
 *       the verify response's delivery links (setVerifyDelivery).
 *  Locales — every catalog carries the lane's ten new beats keys
 *       (saleStatusRefunded + the nine form/library strings).
 *       Non-English values are agent-drafted, UNREVIEWED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beatSaleStatusLabel } from "../world/money-desks-2";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const page = read("../../pages/beats.tsx");
const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];

describe("C1 — the modal closes the whole shelf on a sold beat", () => {
  it("both the tier rows and the template rows key sold-out off exclusive_sold (widened by ruling #2's stems block)", () => {
    /* Stack1400 ruling #2: soldOut is now exclusive_sold OR
       stemsBlocked — on a sold beat both rows still always disable
       (the first disjunct), and a stems offer on a no-stems beat
       disables too. The old "exclusive_sold alone" pin is replaced,
       not relaxed: the exclusive-sale closure is unchanged. */
    const occurrences = page.split("const soldOut = licenseBeat.exclusive_sold || stemsBlocked;").length - 1;
    expect(occurrences).toBe(2);
    expect(page).not.toContain("tier.key === \"exclusive\" && licenseBeat.exclusive_sold");
    expect(page).not.toContain("tpl.isExclusive && licenseBeat.exclusive_sold");
  });

  it("the pay button itself is disabled on a sold beat", () => {
    expect(page).toContain("disabled={licensing || licenseBeat.exclusive_sold || selectedStemsBlocked}");
  });
});

describe("stack1400 rulings #2 + #3-residual — stems guard and the sold card", () => {
  it("the modal's stems block keys off the server's has_stems boolean and the offer's format", () => {
    expect(page).toContain("has_stems?: boolean;");
    expect(page).toContain("function stemsOfferBlocked(beat: Beat, format: string): boolean");
    expect(page).toContain('format === "wav_mp3_stems" || format === "ownership_stems"');
    expect(page).toContain("const selectedStemsBlocked = licenseBeat");
  });

  it("the browse card replaces the License button with a non-button 'Sold exclusively' label on a sold beat", () => {
    expect(page).toContain('{t("beats.soldExclusively", { defaultValue: "Sold exclusively" })}');
    /* The label branch is a span, gated on exclusive_sold; the buy
       button survives only in the else branch. */
    const labelAt = page.indexOf('t("beats.soldExclusively"');
    const buttonAt = page.indexOf('t("beats.licenseButton")', labelAt);
    expect(labelAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(labelAt);
    expect(page).toContain("beat.exclusive_sold ? (");
  });
});

describe("C3 — refunded is a named state, not an unknown one", () => {
  it("the World desk's status helper names it", () => {
    expect(beatSaleStatusLabel("refunded")).toBe("Refunded");
    expect(beatSaleStatusLabel("completed")).toBe("Paid");
    expect(beatSaleStatusLabel("pending_payment")).toBe("Pending payment");
    expect(beatSaleStatusLabel("some_internal_token")).toBe("Status unavailable");
  });

  it("both 2D chips (sales rows + library rows) map refunded through its own key", () => {
    const occurrences = page.split('t("beats.saleStatusRefunded")').length - 1;
    expect(occurrences).toBe(2);
  });
});

describe("C4/C6 — the sell form sends the slots the API accepts", () => {
  it("preview and stems ride the listing body, blank as undefined", () => {
    expect(page).toContain("previewUrl: previewUrl.trim() || undefined");
    expect(page).toContain("stemsUrl: stemsUrl.trim() || undefined");
  });

  it("both fields render with their labels and hints", () => {
    expect(page).toContain('t("beats.previewUrlLabel")');
    expect(page).toContain('t("beats.previewUrlHint")');
    expect(page).toContain('t("beats.stemsUrlLabel")');
    expect(page).toContain('t("beats.stemsUrlHint")');
  });
});

describe("C5 — the buyer's library lives on the dashboard tab", () => {
  it("the page fetches the buyer's licenses from the real rail", () => {
    expect(page).toContain('fetch("/api/beats/licenses/mine")');
    expect(page).toContain('t("beats.yourLicensesTitle")');
  });

  it("the licenses failure card is gated BEFORE the empty state", () => {
    const failedAt = page.indexOf('data-testid="beats-licenses-failure"');
    const emptyAt = page.indexOf('t("beats.noLicensesYet")');
    expect(failedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failedAt);
  });

  it("a failed first load can never read as 'no licenses yet' — the failure flag only sets pre-load", () => {
    expect(page).toContain("if (!buyerLicensesLoadedRef.current) setBuyerLicensesFailed(true);");
  });

  it("completed rows render the master + stems downloads from the DTO", () => {
    expect(page).toContain("l.downloadUrl");
    expect(page).toContain("l.stemsUrl");
    expect(page).toContain('t("beats.downloadButton")');
    expect(page).toContain('t("beats.downloadStemsButton")');
  });

  it("the checkout-return banner keeps the verify response's delivery", () => {
    expect(page).toContain("setVerifyDelivery");
    expect(page).toContain("verifyDelivery.stemsUrl");
  });
});

describe("locales — the lane's ten beats keys exist in every catalog", () => {
  const KEYS = [
    "saleStatusRefunded",
    "previewUrlLabel",
    "previewUrlHint",
    "stemsUrlLabel",
    "stemsUrlHint",
    "yourLicensesTitle",
    "noLicensesYet",
    "downloadButton",
    "downloadStemsButton",
    "licensesLoadFailed",
  ];

  it.each(LOCALES)("%s carries all ten, non-empty", (loc) => {
    const cat = readJson(`../../locales/${loc}.json`);
    for (const k of KEYS) {
      expect(typeof cat.beats[k], `${loc}: beats.${k}`).toBe("string");
      expect((cat.beats[k] as string).trim().length, `${loc}: beats.${k}`).toBeGreaterThan(0);
    }
  });

  it("English says what the machinery does", () => {
    const en = readJson("../../locales/en.json");
    expect(en.beats.saleStatusRefunded).toBe("Refunded");
    expect(en.beats.downloadButton).toBe("Download");
    expect(en.beats.downloadStemsButton).toBe("Download stems");
  });
});
