/**
 * billing-settings-wiring.test.ts — Settings → Billing wiring pins
 * (payfix lane: billing-cancel).
 *
 * The Oct 26 gap: Settings had NO billing section and the site had NO
 * cancel control, while the FAQ promised "keep your tier until period
 * end." These pins keep the shipped wiring from silently unwiring:
 * the card is on the Settings page, reads the banked billing API,
 * cancels/resumes through the in-site endpoints (never a portal-only
 * cancel), and every locale carries the billing strings.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const card = readFileSync(join(__dirname, "BillingSettings.tsx"), "utf8");
const loader = readFileSync(join(__dirname, "..", "lib", "billing-load.ts"), "utf8");
const settings = readFileSync(join(__dirname, "..", "pages", "settings.tsx"), "utf8");
const pricing = readFileSync(join(__dirname, "..", "pages", "creator-pricing.tsx"), "utf8");

describe("Settings page carries the Billing section", () => {
  it("imports and renders BillingSettings", () => {
    expect(settings).toContain('from "@/components/BillingSettings"');
    expect(settings).toContain("<BillingSettings />");
  });
});

describe("Billing card talks to the banked billing API", () => {
  it("loads state from GET /api/creator-tiers/billing", () => {
    /* stack800 lane 4: the fetch moved into lib/billing-load (bounded,
     * classified); the endpoint literal lives there now and the card
     * loads through the loader. */
    expect(card).toContain("loadBilling(");
    expect(card).toContain('from "@/lib/billing-load"');
    expect(loader).toContain('"/api/creator-tiers/billing"');
  });
  it("a failed load renders classified copy per failure kind, never the one old sentence for every cause", () => {
    expect(card).toContain("LOAD_ERROR_KEYS[loadFailure]");
    for (const key of ["loadErrorSession", "loadErrorGated", "loadErrorServer", "loadErrorUnreachable"]) {
      expect(card).toContain(`settings.billing.${key}`);
    }
  });
  it("cancel posts to the in-site cancel endpoint (period-end semantics)", () => {
    expect(card).toContain('post("/api/creator-tiers/cancel")');
  });
  it("resume posts to the in-site resume endpoint", () => {
    expect(card).toContain('post("/api/creator-tiers/resume")');
  });
  it("renders through the shared display derivation, not ad-hoc state", () => {
    expect(card).toContain("describeBilling(billing)");
    expect(card).toContain('data-testid="billing-status"');
    expect(card).toContain('data-testid="billing-date"');
  });
  it("cancel asks first — an inline confirm that names the period-end promise", () => {
    expect(card).toContain("settings.billing.cancelConfirmTitle");
    expect(card).toContain("settings.billing.cancelConfirmBody");
    expect(card).toContain("settings.billing.cancelConfirmButton");
  });
  it("the portal is only the payment-method door, never the cancel path", () => {
    expect(card).toContain('fetch("/api/creator-tiers/portal"');
    expect(card).toContain("settings.billing.managePayment");
    // Cancel must not route through the portal: the cancel handler
    // calls post("/api/creator-tiers/cancel") and nothing else.
    const cancelFn = card.slice(card.indexOf("async function cancel()"), card.indexOf("async function resume()"));
    expect(cancelFn).not.toContain("portal");
  });
});

describe("change-plan wiring (stack600 plan-tier-change)", () => {
  it("the card prices the change through the preview endpoint before charging anything", () => {
    expect(card).toContain('fetch("/api/creator-tiers/change/preview"');
  });
  it("the confirmed change posts to the in-place change endpoint", () => {
    expect(card).toContain('fetch("/api/creator-tiers/change"');
  });
  it("the change control, its confirm panel and its confirm button are rendered", () => {
    expect(card).toContain('data-testid="billing-change-plan"');
    expect(card).toContain('data-testid="billing-change-confirm"');
    expect(card).toContain('data-testid="billing-change-confirm-button"');
  });
  it("the confirm copy is localized and names the money honestly", () => {
    expect(card).toContain("settings.billing.changeConfirmTitle");
    expect(card).toContain("settings.billing.changeChargeToday");
    expect(card).toContain("settings.billing.changeCredit");
    expect(card).toContain("settings.billing.changeClearsCancel");
  });
  it("the pricing page routes a subscriber's pick into the same change confirm, never a second checkout", () => {
    expect(pricing).toContain('data.mode === "change" && data.changePreview');
    expect(pricing).toContain('fetch("/api/creator-tiers/change"');
    expect(pricing).toContain('data-testid="pricing-change-confirm"');
    expect(pricing).toContain('data-testid="pricing-change-confirm-button"');
  });
});

describe("FAQ wording matches the implemented behavior exactly", () => {
  it("the cancel FAQ points at Settings → Billing, not the portal", () => {
    expect(pricing).toContain("manage it yourself right here in Settings → Billing");
    expect(pricing).not.toContain("manage it yourself from the billing portal");
  });
  it("the FAQ still promises the period-end hold the API implements", () => {
    expect(pricing).toContain("You keep your tier until the end of the billing period, then glide back to Free.");
  });
});

describe("billing strings exist in every locale", () => {
  it("settings.billing is complete in all 10 locales", () => {
    const dir = join(__dirname, "..", "locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(10);
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const b = locale.settings?.billing;
      expect(b, file).toBeTruthy();
      for (const key of ["title", "subtitle", "loading", "loadError", "loadErrorSession", "loadErrorGated", "loadErrorServer", "loadErrorUnreachable", "retry", "freeBody", "seePlans", "renewsOn", "endsOn", "endedOn", "pastDueBody", "incompleteBody", "cancelButton", "cancelConfirmTitle", "cancelConfirmBody", "cancelConfirmButton", "keepPlan", "cancelDoneTitle", "cancelDoneBody", "cancelFailed", "resumeButton", "resumeDoneTitle", "resumeDoneBody", "resumeFailed", "managePayment", "manageFailed", "changeButton", "changeConfirmTitle", "changeChargeToday", "changeCredit", "changeNoCharge", "changeImmediate", "changeImmediateNoDate", "changeClearsCancel", "changeConfirmButton", "changeBack", "changeDoneTitle", "changeDoneBody", "changeFailed", "changePreviewFailed"]) {
        expect(typeof b[key], `${file}:${key}`).toBe("string");
        expect(b[key].length, `${file}:${key}`).toBeGreaterThan(0);
      }
      for (const s of ["free", "active", "trialing", "canceling", "past_due", "canceled", "incomplete"]) {
        expect(typeof b.status?.[s], `${file}:status.${s}`).toBe("string");
      }
    }
  });
});
