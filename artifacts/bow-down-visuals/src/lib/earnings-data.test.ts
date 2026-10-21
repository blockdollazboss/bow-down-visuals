import { describe, it, expect, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  normalizeEarningsResponse,
  loadEarnings,
  EarningsLoadCancelled,
  type EarningsLoadDeps,
} from "./earnings-data";

/* DTO guard batch #2 — a partial earnings payload must never render
   $NaN totals: no real total → whole-page failure state; a broken
   source → that source's own error card + the partial flag. */

const good = {
  currency: "USD",
  totalCents: 4200,
  totalTipsVb: 300,
  partial: false,
  sources: {
    storeSales: { status: "ok", totalCents: 2000, count: 4, breakdown: { profileStoreCents: 1500, shopSalesCents: 500 } },
    memberships: { status: "ok", totalCents: 1200, count: 2 },
    brandDeals: { status: "ok", totalCents: 1000, count: 1 },
    tips: { status: "ok", streamTipsVb: 300, streamTipCount: 3, tipJarPendingCents: 0, tipJarPendingCount: 0, tipJarStatus: "open" },
  },
};

describe("normalizeEarningsResponse", () => {
  it("passes a complete payload through untouched", () => {
    const d = normalizeEarningsResponse(good);
    expect(d?.totalCents).toBe(4200);
    expect(d?.partial).toBe(false);
    expect(d?.sources.storeSales.status).toBe("ok");
    if (d?.sources.storeSales.status === "ok") {
      expect(d.sources.storeSales.breakdown?.profileStoreCents).toBe(1500);
    }
  });
  it("returns null when the headline total is not a real number", () => {
    expect(normalizeEarningsResponse({ ...good, totalCents: "lots" })).toBeNull();
    expect(normalizeEarningsResponse({})).toBeNull();
    expect(normalizeEarningsResponse(null)).toBeNull();
  });
  it("a missing/broken source becomes its error card and flags partial — totals stay real", () => {
    const d = normalizeEarningsResponse({ ...good, sources: { ...good.sources, memberships: undefined, brandDeals: { status: "ok", totalCents: "x", count: 1 } } });
    expect(d?.sources.memberships.status).toBe("error");
    expect(d?.sources.brandDeals.status).toBe("error");
    expect(d?.sources.storeSales.status).toBe("ok");
    expect(d?.partial).toBe(true);
    expect(d?.totalCents).toBe(4200);
  });
  it("missing sources entirely → every card errors, total still honored, partial flagged", () => {
    const d = normalizeEarningsResponse({ totalCents: 0, totalTipsVb: null });
    expect(d?.sources.tips.status).toBe("error");
    expect(d?.partial).toBe(true);
  });
});

/* ─── loadEarnings: the patient load ──────────────────────────────────
 * The page's old load was one fetch: a single 502 from the edge while
 * the free-tier box woke painted "Couldn't load your earnings" for
 * good (owner screenshot, Oct 17 18:16 EDT) even though the API would
 * have answered seconds later. These pin the recovery contract. */

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function deps(overrides: Partial<EarningsLoadDeps>): EarningsLoadDeps {
  return {
    getToken: async () => "tok",
    sleep: async () => {},
    ...overrides,
  };
}

describe("loadEarnings", () => {
  it("succeeds on the first attempt and sends the bearer token", async () => {
    const fetchFn = vi.fn(async (_input: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return jsonRes(good);
    });
    const d = await loadEarnings(deps({ fetchFn }));
    expect(d.totalCents).toBe(4200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rides out a waking box: 502, dropped request, then the real answer", async () => {
    const script: Array<() => Promise<Response>> = [
      async () => new Response("<html>Bad Gateway</html>", { status: 502 }),
      async () => { throw new TypeError("fetch failed"); },
      async () => jsonRes(good),
    ];
    let call = 0;
    const fetchFn = vi.fn((_input: string, _init: RequestInit) => script[call++]());
    const delays: number[] = [];
    const retries: number[] = [];
    let tokenCalls = 0;
    const d = await loadEarnings(
      deps({
        fetchFn,
        getToken: async () => { tokenCalls++; return "tok"; },
        sleep: async (ms) => { delays.push(ms); },
        onRetry: (n) => { retries.push(n); },
      }),
      { backoffMs: [10, 20, 30] },
    );
    expect(d.totalCents).toBe(4200);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(tokenCalls).toBe(3); // the token is re-asked every attempt
    expect(delays).toEqual([10, 20]);
    expect(retries).toEqual([2, 3]);
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
      return Promise.resolve(jsonRes(good));
    });
    const d = await loadEarnings(deps({ fetchFn }), { attemptTimeoutMs: 25, backoffMs: [1] });
    expect(d.totalCents).toBe(4200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a 200 whose body cannot normalize is retried, never rendered", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => (++call === 1 ? jsonRes({ nope: true }) : jsonRes(good)));
    const d = await loadEarnings(deps({ fetchFn }), { backoffMs: [1, 1] });
    expect(d.totalCents).toBe(4200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a null-token attempt 401s; the retry asks for the token again and lands", async () => {
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (_input: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth ? jsonRes(good) : jsonRes({ error: "Unauthorized" }, 401);
    });
    const d = await loadEarnings(
      deps({
        fetchFn,
        getToken: async () => (++tokenCalls === 1 ? null : "tok"),
      }),
      { backoffMs: [1] },
    );
    expect(d.totalCents).toBe(4200);
    expect(tokenCalls).toBe(2);
  });

  it("persistent failure exhausts the attempts and throws the last error", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ error: "booting" }, 503));
    const delays: number[] = [];
    await expect(
      loadEarnings(deps({ fetchFn, sleep: async (ms) => { delays.push(ms); } }), { attempts: 3, backoffMs: [10, 20, 30] }),
    ).rejects.toThrow(/503/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([10, 20]);
  });

  it("cancellation during backoff stops the loop — no further fetches", async () => {
    let cancelled = false;
    const fetchFn = vi.fn(async () => jsonRes({ error: "booting" }, 503));
    await expect(
      loadEarnings(
        deps({
          fetchFn,
          isCancelled: () => cancelled,
          sleep: async () => { cancelled = true; },
        }),
        { backoffMs: [1] },
      ),
    ).rejects.toBeInstanceOf(EarningsLoadCancelled);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("recovers over real HTTP from a server that 502s twice before answering (the waking box, end to end)", async () => {
    /* The payload is GET /api/earnings' real shape (pinned against the
       handler in artifacts/api-server's earnings tests). */
    const apiPayload = {
      currency: "USD",
      totalCents: 0,
      totalTipsVb: 0,
      partial: false,
      sources: {
        storeSales: { status: "ok", totalCents: 0, count: 0, breakdown: { profileStoreCents: 0, profileStoreOrders: 0, shopSalesCents: 0, shopSales: 0 } },
        memberships: { status: "ok", totalCents: 0, count: 0 },
        brandDeals: { status: "ok", totalCents: 0, count: 0 },
        tips: { status: "ok", streamTipsVb: 0, streamTipCount: 0, tipJarPendingCents: 0, tipJarPendingCount: 0, tipJarStatus: "pending_payment" },
      },
    };
    let hits = 0;
    const server: Server = createServer((_req, res) => {
      hits++;
      if (hits <= 2) {
        res.writeHead(502, { "content-type": "text/html" });
        res.end("<html>Bad Gateway</html>");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(apiPayload));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as { port: number };
      const d = await loadEarnings(
        deps({ fetchFn: (input, init) => fetch(`http://127.0.0.1:${port}${input}`, init) }),
        { backoffMs: [1, 1, 1] },
      );
      expect(d.totalCents).toBe(0);
      expect(d.partial).toBe(false);
      expect(hits).toBe(3);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
