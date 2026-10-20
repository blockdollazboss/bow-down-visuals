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
 *   claims, no PUT permanence) — management stays the transfer's job;
 * - the board's loads carry the earnings page's patience discipline
 *   (the page's Oct 17 fix): the headline rides loadEarnings itself
 *   and the other rails ride the same loop here — 4 attempts, the
 *   page's own backoff numbers (imported, never re-typed), a 45s
 *   per-attempt timeout, a fresh token per attempt — and a guest
 *   gets the sign-in pitch with no fetch fired at all.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  describeLedgerUsage,
  earningsSourceRows,
  EarningsLoadCancelled,
  fetchBoardJson,
  loadBoardLedger,
  loadBoardStatement,
  normalizeClaims,
  normalizeEarningsResponse,
  normalizeLedger,
  normalizePermanence,
  statementLineRows,
  statementPdfPath,
  statementPath,
  statementYears,
  usd,
  type BoardLoadDeps,
} from "./earnings-board";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const boardSrc = read("../../components/world/native/boards/EarningsBoard.tsx");
const stationPanelSrc = read("../../components/world/StationPanel.tsx");
const boardLibSrc = read("./earnings-board.ts");

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
  it("the view path is the PDF route's JSON sibling — one builder behind both", () => {
    expect(statementPath(2026)).toBe("/api/earnings/statements/2026");
  });
});

/* Statement VIEWING beyond PDF: the board reads the JSON route —
   the very object the PDF route renders (one server builder) —
   through the house guard, on the board's patient loop. */
describe("loadBoardStatement — the statement view, ridden patiently", () => {
  const STMT_PAYLOAD = {
    statement: {
      year: 2026,
      totalCents: 7734,
      partial: false,
      sources: {
        storeSales: { status: "ok", totalCents: 5000, count: 2 },
        shopSales: { status: "ok", totalCents: 0, count: 0 },
        memberships: { status: "ok", totalCents: 1500, count: 1 },
        brandDeals: { status: "ok", totalCents: 0, count: 0 },
        royalties: { status: "ok", totalCents: 1234, count: 1 },
      },
    },
  };

  it("fetches the year's JSON with the bearer token and returns the guarded statement", async () => {
    const fetchFn = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("/api/earnings/statements/2026");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return jsonRes(STMT_PAYLOAD);
    });
    const stmt = await loadBoardStatement(boardDeps({ fetchFn }), 2026);
    expect(stmt.totalCents).toBe(7734);
    /* The rows the board renders are the shared PDF lines. */
    expect(statementLineRows(stmt).map((r) => r.label)).toEqual([
      "Store sales",
      "Shop sales",
      "Memberships",
      "Brand deals",
      "Royalties (recorded)",
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a malformed payload is a failed attempt — it retries, then throws on exhaustion", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ nope: true }));
    await expect(
      loadBoardStatement(boardDeps({ fetchFn }), 2026, { attempts: 2, backoffMs: [1] }),
    ).rejects.toThrow(/malformed/);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a waking box's 502 rides out and the next attempt's statement lands", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => (++call === 1 ? jsonRes({ error: "booting" }, 502) : jsonRes(STMT_PAYLOAD)));
    const stmt = await loadBoardStatement(boardDeps({ fetchFn }), 2026, { backoffMs: [1] });
    expect(stmt.totalCents).toBe(7734);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("persistent failure exhausts and throws — the board's honest couldn't-load line, never a fake statement", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ error: "down" }, 500));
    await expect(
      loadBoardStatement(boardDeps({ fetchFn }), 2026, { attempts: 3, backoffMs: [1, 1] }),
    ).rejects.toThrow(/500/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
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

/* ─── The patient loads ─────────────────────────────────────────────
 * The board used to fire ONE fetch per rail (the page's pre-fix
 * shape): a waking box's 502 or a null-token 401 painted the error
 * card for good. These pin the recovery contract it now shares
 * with the page — same loop, same numbers. */

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function boardDeps(overrides: Partial<BoardLoadDeps>): BoardLoadDeps {
  return {
    getToken: async () => "tok",
    sleep: async () => {},
    ...overrides,
  };
}

describe("fetchBoardJson — one rail, ridden patiently", () => {
  it("succeeds on the first attempt and sends the bearer token", async () => {
    const fetchFn = vi.fn(async (_input: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return jsonRes({ catalog: { election: "permanent" }, releases: [] });
    });
    const payload = await fetchBoardJson(boardDeps({ fetchFn }), "/api/distribution/permanence");
    expect(normalizePermanence(payload)).toEqual({ catalogElection: "permanent", releases: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rides out a waking box and re-asks the token every attempt", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => (++call === 1 ? jsonRes({ error: "booting" }, 502) : jsonRes({ claims: [] })));
    const delays: number[] = [];
    const retries: number[] = [];
    let tokenCalls = 0;
    const payload = await fetchBoardJson(
      boardDeps({
        fetchFn,
        getToken: async () => {
          tokenCalls++;
          return "tok";
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
        onRetry: (n) => {
          retries.push(n);
        },
      }),
      "/api/content-id/claims",
      { backoffMs: [10, 20, 30] },
    );
    expect(normalizeClaims(payload)).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(tokenCalls).toBe(2); // the token is re-asked every attempt
    expect(delays).toEqual([10]);
    expect(retries).toEqual([2]);
  });

  it("default discipline IS the page's: 4 attempts, 2s/5s/12s backoff", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ error: "booting" }, 503));
    const delays: number[] = [];
    await expect(
      fetchBoardJson(boardDeps({ fetchFn, sleep: async (ms) => { delays.push(ms); } }), "/api/content-id/claims"),
    ).rejects.toThrow(/503/);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([2_000, 5_000, 12_000]);
  });

  it("a hung attempt is cut by the per-attempt timeout and retried", async () => {
    let call = 0;
    const fetchFn = vi.fn((_input: string, init: RequestInit) => {
      call++;
      if (call === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const e = new Error("The operation was aborted");
            e.name = "AbortError";
            reject(e);
          });
        });
      }
      return Promise.resolve(jsonRes({ claims: [] }));
    });
    const payload = await fetchBoardJson(boardDeps({ fetchFn }), "/api/content-id/claims", {
      attemptTimeoutMs: 25,
      backoffMs: [1],
    });
    expect(normalizeClaims(payload)).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("cancellation during backoff stops the loop — no further fetches", async () => {
    let cancelled = false;
    const fetchFn = vi.fn(async () => jsonRes({ error: "booting" }, 503));
    await expect(
      fetchBoardJson(
        boardDeps({
          fetchFn,
          isCancelled: () => cancelled,
          sleep: async () => {
            cancelled = true;
          },
        }),
        "/api/content-id/claims",
        { backoffMs: [1] },
      ),
    ).rejects.toBeInstanceOf(EarningsLoadCancelled);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("loadBoardLedger — the pair as one retryable unit", () => {
  const credits = { usage: [{ id: "u1", createdAt: "2026-10-15T10:00:00Z", action: "Admin grant", creditsUsed: -1000 }] };
  const payments = {
    payments: [
      { id: "p1", createdAt: "2026-10-14T10:00:00Z", creditPack: "Royal", creditsAmount: 5000, amountTotal: 2499, currency: "USD", status: "paid" },
    ],
  };

  it("both rails ride one attempt on that attempt's single fresh token", async () => {
    const seen: Array<{ path: string; auth?: string }> = [];
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (input: string, init: RequestInit) => {
      seen.push({ path: input, auth: (init.headers as Record<string, string>).Authorization });
      return input.includes("credits") ? jsonRes(credits) : jsonRes(payments);
    });
    const entries = await loadBoardLedger(
      boardDeps({
        fetchFn,
        getToken: async () => `tok-${++tokenCalls}`,
      }),
    );
    expect(entries.map((e) => e.id)).toEqual(["usage:u1", "payment:p1"]);
    expect(tokenCalls).toBe(1); // one token per attempt — shared by both rails
    expect(seen).toEqual([
      { path: "/api/credits/history", auth: "Bearer tok-1" },
      { path: "/api/payments/history", auth: "Bearer tok-1" },
    ]);
  });

  it("a failure on EITHER rail retries the pair — a half-ledger never renders", async () => {
    let paymentsCalls = 0;
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (input: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (input.includes("payments")) {
        paymentsCalls++;
        if (paymentsCalls === 1) return jsonRes({ error: "booting" }, 500);
        expect(auth).toBe("Bearer tok-2"); // the retry carries the NEXT fresh token
        return jsonRes(payments);
      }
      return jsonRes(credits);
    });
    const entries = await loadBoardLedger(
      boardDeps({
        fetchFn,
        getToken: async () => `tok-${++tokenCalls}`,
      }),
      { backoffMs: [1] },
    );
    expect(entries).toHaveLength(2);
    expect(tokenCalls).toBe(2);
    expect(paymentsCalls).toBe(2);
  });

  it("persistent failure on one rail exhausts the attempts and throws", async () => {
    const fetchFn = vi.fn(async (input: string) =>
      input.includes("payments") ? jsonRes({ error: "down" }, 500) : jsonRes(credits),
    );
    await expect(loadBoardLedger(boardDeps({ fetchFn }), { attempts: 3, backoffMs: [1, 1] })).rejects.toThrow(/ledger/);
    expect(fetchFn).toHaveBeenCalledTimes(6); // 3 attempts × both rails
  });
});

describe("the EarningsBoard surface (source pins)", () => {
  it("rides the plan's endpoints", () => {
    expect(boardSrc).toContain("statementPdfPath(year)");
    expect(boardSrc).toContain('fetchBoardJson(deps, "/api/distribution/permanence")');
    expect(boardSrc).toContain('fetchBoardJson(deps, "/api/content-id/claims")');
    expect(boardLibSrc).toContain('fetchFn("/api/credits/history"');
    expect(boardLibSrc).toContain('fetchFn("/api/payments/history"');
  });

  it("the headline rides the page's own loader — no one-shot fetch remains", () => {
    expect(boardSrc).toContain("loadEarnings(");
    expect(boardSrc).not.toContain('fetch("/api/earnings"');
    expect(boardSrc).toContain("loadBoardLedger(");
    expect(boardSrc).not.toContain('fetch("/api/credits/history"');
    expect(boardSrc).not.toContain('fetch("/api/payments/history"');
  });

  it("the retry numbers come from the page's module — one source, never re-typed", () => {
    expect(boardLibSrc).toContain("EARNINGS_LOAD_ATTEMPTS");
    expect(boardLibSrc).toContain("EARNINGS_LOAD_BACKOFF_MS");
    expect(boardLibSrc).toContain("EARNINGS_ATTEMPT_TIMEOUT_MS");
    expect(boardLibSrc).toContain('from "../earnings-data"');
  });

  it("guests get the pitch and no fetch fires for them", () => {
    expect(boardSrc).toContain("isGuest");
    expect(boardSrc).toContain("GUEST_SIGN_IN_HREF");
    expect(boardSrc).toContain("Sign in to see them");
    expect(boardSrc).toContain("if (isGuest) return;");
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

  it("the statement is also VIEWABLE on the board — the shared lines, beside the PDF button", () => {
    expect(boardSrc).toContain('data-testid="world-earnings-statement-view"');
    expect(boardSrc).toContain("View statement");
    expect(boardSrc).toContain("loadBoardStatement(");
    expect(boardSrc).toContain('data-testid="world-earnings-statement-lines"');
    expect(boardSrc).toContain("statementLineRows(stmt)");
    expect(boardSrc).toContain("statementLineText(row)");
    expect(boardSrc).toContain("statementTotalLabel(stmt.partial)");
  });

  it("picking another year retires the old year's statement — the view always matches the picker", () => {
    expect(boardSrc).toContain("pickYear(Number(e.target.value))");
    expect(boardSrc).toContain("setStmt(null)");
  });

  it("an empty year reads as an empty statement on the board, not an error and not a fake total", () => {
    expect(boardSrc).toContain("statementIsEmpty(stmt)");
    expect(boardSrc).toContain("this statement is empty");
  });

  it("a failed view says so on the card — the statement rail's own honest line", () => {
    expect(boardSrc).toContain("stmtFailed");
    expect(boardSrc).toContain("That statement couldn");
  });

  it("the host dispatches the board pattern's get-paid station to it", () => {
    expect(stationPanelSrc).toContain('resolution.pattern === "board" && station.id === "get-paid-room"');
    expect(stationPanelSrc).toContain("<EarningsBoard isLight={isLight} isGuest={isGuest} />");
  });
});
