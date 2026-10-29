/**
 * Honesty & labels pins (stack800 lane 3, items 2–4).
 *
 * Item 2 (QC Q7): the analytics-hub platform cards carried a DISABLED
 * button labelled "Connect · Coming soon" — a dead-looking control in
 * the card header. OAuth connect isn't built; the honest shape is a
 * status chip (a span, no button semantics), and the card's real
 * action stays the manual "Update numbers" entry.
 *
 * Item 3 (QC Q57): the /extension page's flagged actions audited —
 * the download anchor must point at a zip that actually ships in
 * public/, its version label must match the shipped build, and the
 * notify form must post to the real /api/waitlist route. Also the
 * tab cards no longer stamp every tab with the chat emoji.
 *
 * Item 4 (QC Q15): the /beats sale-status label must say what the
 * rail does. The rail takes a real (test-mode) checkout and activates
 * the license on verify — so "pending_payment" is "Awaiting payment"
 * (the French catalog falsely said payment is "coming soon"), a
 * completed sale is "Paid", and no raw status token renders. The
 * World-side helpers (money-desks-2) carried the same raw
 * passthrough and are pinned here too.
 *
 * NOTE on translations: the new beats saleStatus* values in the nine
 * non-English catalogs and the corrected French pending label are
 * AGENT-DRAFTED and UNREVIEWED (standing stack600 practice — English
 * is final; a human review pass owns the rest).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beatSaleStatusLabel, tipFeedStatusLabel } from "../world/money-desks-2";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];

describe("item 2 — analytics-hub connect element is a label, not a dead control", () => {
  const page = read("../../pages/analytics-hub.tsx");

  it("the coming-soon element is a span, not a button", () => {
    const idx = page.indexOf('t("analyticsHub.connectComingSoon")');
    expect(idx).toBeGreaterThan(-1);
    const before = page.slice(Math.max(0, idx - 800), idx);
    expect(before.lastIndexOf("<span")).toBeGreaterThan(before.lastIndexOf("<button"));
  });

  it("no disabled button remains on the platform cards' connect slot", () => {
    expect(page).not.toMatch(/<button[^>]*disabled[^>]*>[\s\S]{0,300}connectComingSoon/);
  });

  it("the card's real action (manual number entry) is still wired", () => {
    expect(page).toContain('t("analyticsHub.updateNumbers")');
    expect(page).toContain("startEditing(key)");
  });
});

describe("item 3 — /extension actions are real", () => {
  const page = read("../../pages/extension.tsx");

  it("the download anchor points at the shipped zip in public/", () => {
    expect(page).toContain('href="/bow-down-visuals-extension-v2.zip"');
    const zipUrl = new URL("../../../public/bow-down-visuals-extension-v2.zip", import.meta.url);
    expect(existsSync(zipUrl)).toBe(true);
    expect(statSync(zipUrl).size).toBeGreaterThan(10_000);
  });

  it("the version in the download label matches the shipped build (v2.0.2)", () => {
    const en = readJson("../../locales/en.json");
    expect(en.extension.download_for_chrome_v2_0_1).toContain("2.0.2");
  });

  it("the notify form posts to the real waitlist route", () => {
    expect(page).toContain('fetch("/api/waitlist"');
  });

  it("tab cards no longer stamp every tab with the chat emoji", () => {
    expect(page).not.toContain("💬 {t.name}");
  });
});

describe("item 4 — beats sale-status labels tell the rail's truth", () => {
  const page = read("../../pages/beats.tsx");

  it("the sales chip maps every status through the locale labels, never raw", () => {
    expect(page).toContain('t("beats.saleStatusPaid")');
    expect(page).toContain('t("beats.saleStatusPending")');
    expect(page).toContain('t("beats.saleStatusUnknown")');
    expect(page).not.toContain('t("beats.paymentComingSoon")');
    expect(page).not.toMatch(/: s\.status\}/);
  });

  it("every catalog carries the three sale-status keys and none keeps the dead key", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.beats.saleStatusPending, loc).toBeTruthy();
      expect(cat.beats.saleStatusPaid, loc).toBeTruthy();
      expect(cat.beats.saleStatusUnknown, loc).toBeTruthy();
      expect(cat.beats.paymentComingSoon, loc).toBeUndefined();
    }
  });

  it("French no longer claims payment is 'coming soon' — the rail takes payment now", () => {
    const fr = readJson("../../locales/fr.json");
    expect(fr.beats.saleStatusPending).toBe("Paiement en attente");
    const en = readJson("../../locales/en.json");
    expect(en.beats.saleStatusPending).toBe("Awaiting payment");
    expect(en.beats.saleStatusPaid).toBe("Paid");
  });

  it("the World-side status helpers never pass a raw token through", () => {
    expect(beatSaleStatusLabel("pending_payment")).toBe("Pending payment");
    expect(beatSaleStatusLabel("completed")).toBe("Paid");
    expect(beatSaleStatusLabel("some_internal_token")).toBe("Status unavailable");
    expect(tipFeedStatusLabel("pending_payment")).toBe("Intent recorded");
    expect(tipFeedStatusLabel("paid")).toBe("Received");
    expect(tipFeedStatusLabel("completed")).toBe("Received");
    expect(tipFeedStatusLabel("some_internal_token")).toBe("Status unavailable");
  });
});
