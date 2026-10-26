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
    expect(card).toContain('fetch("/api/creator-tiers/billing"');
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
      for (const key of ["title", "subtitle", "loading", "loadError", "retry", "freeBody", "seePlans", "renewsOn", "endsOn", "endedOn", "pastDueBody", "incompleteBody", "cancelButton", "cancelConfirmTitle", "cancelConfirmBody", "cancelConfirmButton", "keepPlan", "cancelDoneTitle", "cancelDoneBody", "cancelFailed", "resumeButton", "resumeDoneTitle", "resumeDoneBody", "resumeFailed", "managePayment", "manageFailed"]) {
        expect(typeof b[key], `${file}:${key}`).toBe("string");
        expect(b[key].length, `${file}:${key}`).toBeGreaterThan(0);
      }
      for (const s of ["free", "active", "trialing", "canceling", "past_due", "canceled", "incomplete"]) {
        expect(typeof b.status?.[s], `${file}:status.${s}`).toBe("string");
      }
    }
  });
});
