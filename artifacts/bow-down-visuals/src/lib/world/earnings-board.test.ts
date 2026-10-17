/**
 * earnings-board — the Earnings Board's pure shaping (NATIVE-PLAN §3.1).
 *
 * Pins:
 * - the earnings headline reuses the house guard (lib/earnings-data)
 *   and an errored source renders "Couldn't load", never a fake $0;
 * - the Ledger merge (the old /credit-history folded in): usage
 *   rows keep the page's signed rule — NEGATIVE creditsUsed is
 *   value coming BACK (grant/refund), positive is a charge — and
 *   purchases land as money rows, newest first across both rails;
 * - statement years + the PDF path (a file download, not a page);
 * - permanence + claims normalize to READ-ONLY status: the board
 *   component's source contains no write to either rail (no PATCH
 *   claims, no PUT permanence) — management stays the transfer's job.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  describeLedgerUsage,
  earningsSourceRows,
  normalizeClaims,
  normalizeEarningsResponse,
  normalizeLedger,
  normalizePermanence,
  statementPdfPath,
  statementYears,
  usd,
} from "./earnings-board";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const boardSrc = read("../../components/world/native/boards/EarningsBoard.tsx");
const stationPanelSrc = read("../../components/world/StationPanel.tsx");

const EARNINGS_PAYLOAD = {
  currency: "USD",
  totalCents: 12345,
  totalTipsVb: 700,
  partial: false,
  sources: {
    storeSales: { status: "ok", totalCents: 10000, count: 3, breakdown: { profileStoreCents: 6000, shopSalesCents: 4000 } },
    memberships: { status: "ok", totalCents: 2345, count: 2 },
    brandDeals: { status: "error", totalCents: null, count: null },
    tips: { status: "ok", streamTipsVb: 700, streamTipCount: 5, tipJarPendingCents: 250, tipJarPendingCount: 1, tipJarStatus: "pending" },
  },
};

describe("the earnings headline + source rows", () => {
  it("formats cents as USD, always two decimals", () => {
    expect(usd(12345)).toBe("$123.45");
    expect(usd(10000)).toBe("$100.00");
    expect(usd(0)).toBe("$0.00");
  });

  it("the guard normalizes the payload the board renders", () => {
    const e = normalizeEarningsResponse(EARNINGS_PAYLOAD);
    expect(e).not.toBeNull();
    expect(e!.totalCents).toBe(12345);
    expect(e!.partial).toBe(true); // brandDeals errored → partial
  });

  it("an unusable payload normalizes to null — the board's error state, never $NaN", () => {
    expect(normalizeEarningsResponse(null)).toBeNull();
    expect(normalizeEarningsResponse({ totalCents: "lots" })).toBeNull();
  });

  it("source rows carry totals; an errored source says so instead of showing $0.00", () => {
    const rows = earningsSourceRows(normalizeEarningsResponse(EARNINGS_PAYLOAD)!);
    expect(rows.map((r) => r.title)).toEqual(["Store sales", "Memberships", "Brand deals (escrow released)", "Tips"]);
    expect(rows[0]!.meta).toBe("$100.00");
    expect(rows[0]!.detail).toContain("profile store $60.00");
    expect(rows[2]!.meta).toBe("Couldn't load");
    expect(rows[2]!.meta).not.toBe("$0.00");
    expect(rows[3]!.meta).toBe("700 VB");
  });
});

describe("the Ledger merge", () => {
  it("the signed rule: negative usage is value back, positive is a charge", () => {
    expect(describeLedgerUsage("Admin grant", -1000)).toEqual({ type: "Grant", amount: "+1,000" });
    expect(describeLedgerUsage("Refund — song", -200)).toEqual({ type: "Refund", amount: "+200" });
    expect(describeLedgerUsage("Bonus", -50)).toEqual({ type: "Visual Buc back", amount: "+50" });
    expect(describeLedgerUsage("Song generation", 400)).toEqual({ type: "Charge", amount: "−400" });
    expect(describeLedgerUsage("Free spin", 0)).toEqual({ type: "Free", amount: "0" });
  });

  const credits = {
    usage: [
      { id: "u1", createdAt: "2026-10-10T10:00:00Z", action: "Song generation", creditsUsed: 400 },
      { id: "u2", createdAt: "2026-10-15T10:00:00Z", action: "Admin grant", creditsUsed: -1000 },
      { id: "u3", createdAt: "2026-10-12T10:00:00Z", action: "Broken row", creditsUsed: "lots" },
    ],
  };
  const payments = {
    payments: [
      { id: "p1", createdAt: "2026-10-14T10:00:00Z", creditPack: "Royal", creditsAmount: 5000, amountTotal: 2499, currency: "USD", status: "paid" },
    ],
  };

  it("merges both rails newest-first, skipping unusable rows", () => {
    const entries = normalizeLedger(credits, payments);
    expect(entries.map((e) => e.id)).toEqual(["usage:u2", "payment:p1", "usage:u1"]);
    expect(entries[0]).toMatchObject({ kind: "usage", title: "Admin grant", detail: "Grant", amount: "+1,000", unit: "VB" });
    expect(entries[1]).toMatchObject({ kind: "payment", amount: "$24.99", unit: "money" });
    expect(entries[1]!.detail).toContain("+5,000 VB");
    expect(entries[2]).toMatchObject({ amount: "−400", unit: "VB" });
  });

  it("a missing rail contributes nothing — and never throws", () => {
    expect(normalizeLedger(null, null)).toEqual([]);
    expect(normalizeLedger(credits, null).map((e) => e.id)).toEqual(["usage:u2", "usage:u1"]);
    expect(normalizeLedger(null, payments)).toHaveLength(1);
  });
});

describe("statements", () => {
  it("offers this year and the two before it", () => {
    expect(statementYears(new Date("2026-10-17T12:00:00Z"))).toEqual([2026, 2025, 2024]);
  });
  it("the PDF path is the documents panel's own endpoint", () => {
    expect(statementPdfPath(2026)).toBe("/api/earnings/statements/2026/pdf");
  });
});

describe("read-only status rows", () => {
  it("permanence: the catalog election + per-release elections", () => {
    const status = normalizePermanence({
      catalog: { election: "permanent" },
      releases: [{ id: "e1", releaseTitle: "First Drop", election: "standard" }],
      covers: [],
      excludes: [],
    });
    expect(status).toEqual({
      catalogElection: "permanent",
      releases: [{ title: "First Drop", election: "standard" }],
    });
  });

  it("permanence: nothing recorded is null (the board words it), never invented rows", () => {
    expect(normalizePermanence({ catalog: null, releases: [] })).toBeNull();
    expect(normalizePermanence(null)).toBeNull();
  });

  it("claims: status rows with the evidence summary, management fields ignored", () => {
    const rows = normalizeClaims({
      claims: [
        { id: "m1", sourceLabel: "My Song.mp3", youAre: "owner", status: "pending", confidence: 0.9, matchedLandmarks: 40, totalLandmarks: 50 },
        { id: "m2", source_label: "Other.wav", status: "resolved" },
        { sourceLabel: "No id — skipped", status: "pending" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "m1", label: "My Song.mp3", status: "pending" });
    expect(rows[0]!.detail).toContain("you are the owner");
    expect(rows[0]!.detail).toContain("40 of 50 landmarks matched");
  });
});

describe("the EarningsBoard surface (source pins)", () => {
  it("rides the plan's endpoints", () => {
    expect(boardSrc).toContain('fetch("/api/earnings"');
    expect(boardSrc).toContain('fetch("/api/credits/history"');
    expect(boardSrc).toContain('fetch("/api/payments/history"');
    expect(boardSrc).toContain('fetch("/api/distribution/permanence"');
    expect(boardSrc).toContain('fetch("/api/content-id/claims"');
    expect(boardSrc).toContain("statementPdfPath(year)");
  });

  it("is READ-ONLY on the management rails — no claim or permanence writes anywhere", () => {
    expect(boardSrc).not.toContain("/api/content-id/claims/${");
    expect(boardSrc).not.toContain("permanence/catalog");
    expect(boardSrc).not.toContain('method: "PATCH"');
    expect(boardSrc).not.toContain('method: "PUT"');
  });

  it("the PDF is a blob download, not a navigation", () => {
    expect(boardSrc).toContain("URL.createObjectURL(blob)");
    expect(boardSrc).toContain("earnings-statement-");
    expect(boardSrc).toContain("Download statement (PDF)");
  });

  it("the host dispatches the board pattern's get-paid station to it", () => {
    expect(stationPanelSrc).toContain('resolution.pattern === "board" && station.id === "get-paid-room"');
    expect(stationPanelSrc).toContain("<EarningsBoard isLight={isLight} />");
  });
});
