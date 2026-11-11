/**
 * JewelryOrdersAdmin (the admin jewelry reservations list) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE ORDERS LOAD is a four-state chain: spinner, then the
 *   error line (with BOTH a Retry button and the header
 *   Refresh wired to the real loader), then the genuine
 *   "No jewelry reservations yet.", then the table. The
 *   loader gates on the payload's own ok flag — an error
 *   body throws its message instead of becoming an empty
 *   list — and the header count reads the proven total,
 *   never a fabricated one.
 * - FIX (this tranche): THE CSV DOWNLOAD never checked its
 *   response — a 401/500 error body was saved to disk as
 *   "jewelry-orders.csv", a false artifact delivered as the
 *   supplier file. The download now checks res.ok and lands
 *   on the panel's error line instead of saving anything.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./JewelryOrdersAdmin.tsx");

describe("the orders load: loading, error, empty, rows — in that order", () => {
  it("the loader gates on the payload's ok flag before recording orders", () => {
    expect(src).toContain('if (!json.ok) throw new Error(apiErrorMessage(json, "Load failed"));');
    expect(src).toContain("setOrders(json.orders);");
    expect(src).toContain('setError(plainErrorText(e, "Load failed"));');
  });

  it("the render chain is loading → error (with retry) → genuine empty → table", () => {
    const loadingIdx = src.indexOf("{loading ? (");
    const errorIdx = src.indexOf(") : error ? (");
    const emptyIdx = src.indexOf(") : orders.length === 0 ? (");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    expect(emptyIdx).toBeGreaterThan(errorIdx);
    expect(src).toContain("No jewelry reservations yet.");
  });
});

describe("FIX: the CSV download proves its response before saving a file", () => {
  it("a non-ok response lands on the error line and saves nothing", () => {
    expect(src).toContain('setError("Couldn\'t download the CSV — try again.");');
    const gateIdx = src.indexOf('if (!res.ok) {\n      /* An unchecked error body used to be saved as the CSV itself. */');
    const blobIdx = src.indexOf("const blob = await res.blob();");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(blobIdx).toBeGreaterThan(gateIdx);
  });
});
