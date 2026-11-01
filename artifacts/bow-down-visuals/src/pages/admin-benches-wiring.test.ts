/**
 * admin-benches-wiring.test.ts — stack1100 Lane X1 source contracts.
 *
 * W6's finding F1: three admin rails had NO frontend consumer —
 * GET /api/admin/payment-reversals (the manual money-review queue),
 * GET /api/admin/operator-actions (the operator's action trail), and
 * the studio-gear relay queue. These pins hold the benches that close
 * F1 to the rails' real shapes:
 *  - all three dock into /admin beside the existing benches;
 *  - the operator bench is READ-ONLY; the reversals bench carries
 *    exactly one write — the reversal rail's own resolve verb
 *    (stack1100 Y2), behind a confirm that names the row's amounts;
 *  - the gear bench relays in the rail's own shapes (proof/send with
 *    { proofUrl, proofNote }, status with { status }) against the
 *    ADMIN endpoints only, and keeps the rail's ship gate;
 *  - every bench parses through the strict lib parsers (a malformed
 *    answer is an error state, never a painted-empty queue).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const admin = read("pages/admin.tsx");
const reversals = read("components/PaymentReversalsAdmin.tsx");
const operator = read("components/OperatorActionsAdmin.tsx");
const gear = read("components/StudioGearQueueAdmin.tsx");

describe("admin benches — docked into /admin", () => {
  it("admin.tsx imports and mounts all three benches with the page's authHeaders", () => {
    for (const name of ["PaymentReversalsAdmin", "OperatorActionsAdmin", "StudioGearQueueAdmin"]) {
      expect(admin).toContain(`import { ${name} } from "@/components/${name}"`);
      expect(admin).toContain(`<${name} authHeaders={authHeaders} />`);
    }
  });

  it("the existing benches are untouched by the docking", () => {
    for (const mount of [
      "<SpotlightInbox authHeaders={authHeaders} />",
      "<PitchFixInbox authHeaders={authHeaders} />",
      "<ContentReportsInbox authHeaders={authHeaders} />",
      "<NfcOrdersAdmin authHeaders={authHeaders} />",
      "<JewelryOrdersAdmin authHeaders={authHeaders} />",
    ]) {
      expect(admin).toContain(mount);
    }
  });
});

describe("admin benches — payment reversals bench is the rail's shape + its resolve verb", () => {
  it("reads GET /api/admin/payment-reversals through the strict parser", () => {
    expect(reversals).toContain('fetch("/api/admin/payment-reversals"');
    expect(reversals).toContain("parsePaymentReversals");
  });

  it("carries exactly one write — the rail's own resolve verb, behind its confirm", () => {
    expect(reversals).toContain("fetch(`/api/admin/payment-reversals/${row.id}/resolve`");
    expect(reversals.match(/method:\s*"(POST|PATCH|PUT|DELETE)"/g)).toHaveLength(1);
    expect(reversals).toContain('method: "POST"');
    /* the confirm names the row's real amounts, and the recorded
       decision renders back on the row */
    expect(reversals).toContain('data-testid="reversal-resolve-confirm"');
    expect(reversals).toContain('t("admin.reversals.confirmComplete"');
    expect(reversals).toContain('t("admin.reversals.confirmDismiss"');
    expect(reversals).toContain("r.resolution");
  });

  it("separates the load error from the empty queue, and surfaces the parked rows", () => {
    expect(reversals).toContain('data-testid="payment-reversals-bench"');
    expect(reversals).toContain("loadError");
    expect(reversals).toContain('t("admin.reversals.empty")');
    expect(reversals).toContain("countNeedsManualReview");
    expect(reversals).toContain("manualReason");
    /* the figures a reviewer decides from render from rail data */
    for (const field of ["chargeAmountCents", "refundedCentsSeen", "grantedCredits", "creditsClawed", "shortfallCredits"]) {
      expect(reversals).toContain(field);
    }
  });
});

describe("admin benches — operator actions bench is an audit read, no controls", () => {
  it("reads GET /api/admin/operator-actions through the strict parser", () => {
    expect(operator).toContain('fetch("/api/admin/operator-actions"');
    expect(operator).toContain("parseOperatorActions");
  });

  it("shows the rail's own cap and kill-switch state", () => {
    expect(operator).toContain("dailyChargedCap");
    expect(operator).toContain("handsEnabled");
  });

  it("contains no write verb at all", () => {
    expect(operator).not.toContain("method:");
    expect(operator).not.toMatch(/method:\s*"(POST|PATCH|PUT|DELETE)"/);
  });

  it("separates the load error from the empty trail", () => {
    expect(operator).toContain('data-testid="operator-actions-bench"');
    expect(operator).toContain("loadError");
    expect(operator).toContain('t("admin.operatorActions.empty")');
  });
});

describe("admin benches — studio gear queue relays in the rail's own shapes", () => {
  it("reads the admin queue through the strict parser", () => {
    expect(gear).toContain('fetch("/api/admin/studio-gear/orders"');
    expect(gear).toContain("parseGearAdminOrders");
  });

  it("relays the proof with { proofUrl, proofNote } to the rail's proof/send", () => {
    expect(gear).toContain("/api/admin/studio-gear/orders/${order.id}/proof/send");
    expect(gear).toContain("proofUrl");
    expect(gear).toContain("proofNote");
  });

  it("relays fulfillment with { status } to the rail's status endpoint", () => {
    expect(gear).toContain("/api/admin/studio-gear/orders/${order.id}/status");
    expect(gear).toContain("JSON.stringify({ status })");
  });

  it("never calls the member gear endpoints", () => {
    expect(gear).not.toContain('fetch("/api/studio-gear');
    expect(gear).not.toContain("`/api/studio-gear");
  });

  it("keeps the rail's gates: proof availability and the ship block come from the lib mirrors", () => {
    expect(gear).toContain("gearProofSendAvailable");
    expect(gear).toContain("gearFulfillmentActions");
    expect(gear).toContain("gearShipBlock");
  });

  it("separates the load error from the empty queue", () => {
    expect(gear).toContain('data-testid="studio-gear-queue"');
    expect(gear).toContain("loadError");
    expect(gear).toContain('t("admin.gearQueue.empty")');
  });
});
