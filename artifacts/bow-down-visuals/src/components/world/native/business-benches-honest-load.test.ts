/**
 * BusinessBenches (the World business benches — the invoice
 * bench is the collection surface) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 2).
 *
 * - THE INVOICE LIST rides an explicit loading/ready/failed
 *   machine: a non-ok response OR an unparseable payload lands
 *   on failed — the list records only from a proven payload,
 *   and a malformed answer is never an empty invoice book.
 * - THE STATUS FLIP applies server truth only: the row is
 *   replaced by the SERVER's returned record, and only when
 *   the PATCH is ok AND the payload parses; the "paid" notice
 *   rides that same proven update. Any failure leaves the row
 *   untouched and lands on the error line.
 * - The remaining benches are priced generation actions
 *   (confirmedFetch: deal match, sponsor read, one-sheet,
 *   content calendar, stock import) whose results land in
 *   their own busy/error states — no collections, nothing to
 *   dress up.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const benches = read("./BusinessBenches.tsx");

describe("the invoice list: non-ok and unparseable are both failed, never empty", () => {
  it("the loader lands failed unless the response is ok AND parses", () => {
    expect(benches).toContain('setListState("loading");');
    expect(benches).toContain("const list = invoiceListOf(data);");
    expect(benches).toContain("if (!res.ok || !list) {");
    expect(benches).toContain('setListState("failed");');
    expect(benches).toContain("setInvoices(list);");
    expect(benches).toContain('setListState("ready");');
    expect(benches.indexOf("if (!res.ok || !list) {")).toBeLessThan(benches.indexOf("setInvoices(list);"));
  });
});

describe("the status flip applies the server's record or nothing", () => {
  it("the row updates only from an ok, parseable response; the paid notice rides it", () => {
    const flip = benches.slice(benches.indexOf("async function flipStatus(inv: InvoiceRecord)"), benches.indexOf("const fieldCls ="));
    expect(flip).toContain("const updated = invoiceUpdatedOf(data);");
    expect(flip).toContain("if (!res.ok || !updated) throw new Error(\"status update failed\");");
    expect(flip).toContain("setInvoices((prev) => prev.map((x) => (x.id === inv.id ? updated : x)));");
    expect(flip).toContain('if (next === "paid") setNotice(t("outreach.invoice.paidNotice"));');
    expect(flip.indexOf("if (!res.ok || !updated) throw")).toBeLessThan(flip.indexOf("setInvoices((prev)"));
    expect(flip).toContain('setError(t("outreach.invoice.statusFailed"));');
  });
});
