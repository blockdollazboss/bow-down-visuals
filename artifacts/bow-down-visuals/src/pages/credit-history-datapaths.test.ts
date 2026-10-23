/**
 * credit-history-datapaths.test.ts — S27-28: the payments ledger and
 * the usage ledger settle independently (dashboard per-section
 * pattern).
 *
 * The defect: both ledgers were fetched in one Promise.all and either
 * non-OK threw before either was applied — one failing ledger hid the
 * other behind a single page error. The contract pinned here:
 *  (a) each ledger has its own loader, its own state and its own
 *      error flag;
 *  (b) the full-page error fires only when BOTH ledgers fail;
 *  (c) each section renders when its own ledger loaded, and shows its
 *      own section error (with its own retry) when it did not.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./credit-history.tsx", import.meta.url), "utf8");

describe("credit history — ledgers settle independently", () => {
  it("each ledger has its own loader and error state", () => {
    expect(page).toContain("async function loadPayments(): Promise<boolean>");
    expect(page).toContain("async function loadUsage(): Promise<boolean>");
    expect(page).toContain("const [paymentsError, setPaymentsError] = useState(false)");
    expect(page).toContain("const [usageError, setUsageError] = useState(false)");
    expect(page).toContain('fetch("/api/payments/history"');
    expect(page).toContain('fetch("/api/credits/history"');
  });

  it("the full-page error fires only when both ledgers fail", () => {
    expect(page).toContain('if (!payOk && !histOk) setError(t("credit-history.could_not_load_visual_buc_histor"));');
  });

  it("sections gate on their own ledger, not on both", () => {
    expect(page).not.toContain("payments && usage");
    expect(page).toContain("sectionError(() => { setError(null); void loadPayments(); })");
    expect(page).toContain("sectionError(() => { setError(null); void loadUsage(); })");
  });
});
