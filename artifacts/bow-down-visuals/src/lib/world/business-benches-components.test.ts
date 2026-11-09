/**
 * business-benches-components — Stack 400 world parity
 * (Lane B items 10, 13, 14, 22) source-contract pins. The six
 * business benches must stack at their boards in StationPanel
 * as ({ isLight }) benches, run their charges through the
 * confirmed spend seam at the registry prices, wire the
 * NativeStates trio, and keep the stock search free — with
 * light/dark parity via their isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const benches = read("../../components/world/native/BusinessBenches.tsx");
const panel = read("../../components/world/StationPanel.tsx");

const BENCHES = [
  { name: "DealMatchBench", testid: "world-deal-match-bench", run: "world-deal-match-run" },
  { name: "SponsorReadBench", testid: "world-sponsor-read-bench", run: "world-sponsor-read-run" },
  { name: "InvoiceBench", testid: "world-invoice-bench", run: "world-invoice-run" },
  { name: "OneSheetBench", testid: "world-one-sheet-bench", run: "world-one-sheet-run" },
  { name: "ContentCalendarBench", testid: "world-content-calendar-bench", run: "world-content-calendar-run" },
  { name: "StockBench", testid: "world-stock-bench", run: "world-stock-search-run" },
] as const;

describe("the bench shapes", () => {
  it("every bench is a named ({ isLight }) export rooted at its testid on a NativeCard", () => {
    for (const b of BENCHES) {
      expect(benches).toContain(`export function ${b.name}({ isLight }: { isLight: boolean })`);
      expect(benches).toContain(`data-testid="${b.testid}"`);
      expect(benches).toContain(`data-testid="${b.run}"`);
    }
    expect(benches).toContain("<NativeCard isLight={isLight}>");
  });

  it("every bench wires the NativeStates trio", () => {
    expect(benches).toContain("<NativeLoadingState isLight={isLight}");
    expect(benches).toContain("<NativeEmptyState isLight={isLight}");
    expect(benches).toContain("<NativeErrorState");
    expect(benches).toContain('t("worldBizBenches400.dealMatchStateLoading")');
    expect(benches).toContain('t("worldBizBenches400.sponsorReadStateEmpty")');
    expect(benches).toContain('t("worldBizBenches400.invoiceStateError")');
    expect(benches).toContain('t("worldBizBenches400.oneSheetStateEmpty")');
    expect(benches).toContain('t("worldBizBenches400.calendarStateError")');
    expect(benches).toContain('t("worldBizBenches400.stockStateLoading")');
  });
});

describe("the StationPanel mounts", () => {
  it("lazy-imports all six benches", () => {
    for (const b of BENCHES) {
      expect(panel).toContain(`const ${b.name} = lazy(() => import("@/components/world/native/BusinessBenches")`);
    }
  });

  it("stacks Deal Matcher, Sponsor Read, Invoice + One-Sheet at the Get Paid board", () => {
    expect(panel).toContain('station.id === "get-paid-room"');
    expect(panel).toContain("<DealMatchBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:deal-match`}');
    expect(panel).toContain("<SponsorReadBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:sponsor-read`}');
    expect(panel).toContain("<InvoiceBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:invoice`}');
    expect(panel).toContain("<OneSheetBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:one-sheet`}');
  });

  it("stacks Content Calendar + Stock at the My Studio board beside Publish", () => {
    expect(panel).toContain('station.id === "my-studio"');
    expect(panel).toContain("<ContentCalendarBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:content-calendar`}');
    expect(panel).toContain("<StockBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:stock`}');
  });
});

describe("the charges ride the confirmed-spend seam", () => {
  it("each paid bench posts through confirmedFetch with its registry cost + feature name", () => {
    expect(benches).toContain("confirmedFetch(DEAL_MATCH_PATH, {");
    expect(benches).toContain('overrideFeature: "Sponsor Match"');
    expect(benches).toContain("dealMatchCost()");
    expect(benches).toContain("confirmedFetch(SPONSOR_READ_PATH, {");
    expect(benches).toContain('overrideFeature: "Sponsor Read"');
    expect(benches).toContain("sponsorReadCost()");
    expect(benches).toContain("confirmedFetch(INVOICE_GENERATE_PATH, {");
    expect(benches).toContain('overrideFeature: "Generate Invoice"');
    expect(benches).toContain("invoiceCost()");
    expect(benches).toContain("confirmedFetch(ONE_SHEET_PATH, {");
    expect(benches).toContain('overrideFeature: "Sync One-Sheet"');
    expect(benches).toContain("oneSheetCost()");
    expect(benches).toContain("confirmedFetch(CONTENT_CALENDAR_PATH, {");
    expect(benches).toContain('overrideFeature: "Content Calendar"');
    expect(benches).toContain("contentCalendarCost()");
    expect(benches).toContain("confirmedFetch(STOCK_IMPORT_PATH, {");
    expect(benches).toContain('overrideFeature: "Stock Import"');
    expect(benches).toContain("stockImportCost()");
    expect(benches).toContain("overrideCost: cost");
    expect(benches).toContain("overrideCost: importCost");
    expect(benches).toContain("res.status === 402");
  });

  it("the stock search stays a plain free GET — no confirmation on a free rail", () => {
    expect(benches).toContain("fetch(stockSearchUrl(q, type, nextPage)");
    expect(benches).not.toContain("confirmedFetch(STOCK_SEARCH_PATH");
    expect(benches).toContain('data-testid="world-stock-result"');
    expect(benches).toContain("stockNotConfigured(res.status, data)");
  });

  it("the invoice list + status flip ride the free rails, and imports land in the hub project", () => {
    expect(benches).toContain("fetch(INVOICES_PATH, { headers: await authHeaders() })");
    expect(benches).toContain("invoiceStatusPath(inv.id)");
    expect(benches).toContain("method: \"PATCH\"");
    expect(benches).toContain("downloadBase64Pdf(generated.pdfBase64, generated.pdfFilename)");
    expect(benches).toContain('data-testid="world-invoice-list"');
    expect(benches).toContain("addAsset({");
    expect(benches).toContain('kind: imported.type === "video" ? "clip" : "image"');
  });

  it("out-of-Bucs lines ride the shared worldBenches300 copy per feature", () => {
    expect(benches).toContain('feature="Sponsor Match"');
    expect(benches).toContain('feature="Sponsor Read"');
    expect(benches).toContain('feature="Generate Invoice"');
    expect(benches).toContain('feature="Sync One-Sheet"');
    expect(benches).toContain('feature="Content Calendar"');
    expect(benches).toContain('feature="Stock Import"');
    expect(benches).toContain('t("worldBenches300.outOfBucs", { feature })');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the benches branch their surfaces on isLight", () => {
    expect(benches).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(benches).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
