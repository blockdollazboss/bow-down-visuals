/**
 * billing-load.test.ts — Settings → Billing load pins (stack800 lane 4).
 *
 * Gate #4's final session: "Couldn't load your billing" persisted
 * after Retry — one unbounded fetch behind an unbounded token call,
 * every cause collapsed into one boolean. These pins hold the fix:
 * the whole attempt (token included) is time-bounded, healable
 * failures spend a bounded retry budget, and terminal failures are
 * classified — session, gate, server, unreachable — so the card can
 * say which world failed instead of looping the same sentence.
 */
import { describe, it, expect, vi } from "vitest";
import {
  loadBilling,
  BillingLoadError,
  BillingLoadCancelled,
  type BillingLoadDeps,
} from "./billing-load";
import type { BillingStateView } from "./billing-display";

const VIEW = { planName: "Pro" } as unknown as BillingStateView;
const noSleep = async () => undefined;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deps(over: Partial<BillingLoadDeps>): BillingLoadDeps {
  return { getToken: async () => "tok", sleep: noSleep, ...over };
}

async function failureOf(p: Promise<unknown>): Promise<BillingLoadError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof BillingLoadError) return err;
    throw err;
  }
  throw new Error("expected the load to fail");
}

describe("loadBilling", () => {
  it("returns the billing view on a clean answer, token attached", async () => {
    const fetchFn = vi.fn(async (_input: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return jsonRes(200, { billing: VIEW });
    });
    const out = await loadBilling(deps({ fetchFn }));
    expect(out).toEqual(VIEW);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a stalled fetch is bounded per attempt and ends unreachable — never an endless spin", async () => {
    const fetchFn = vi.fn((_input: string, init: RequestInit) =>
      /* Honours the abort signal the loader passes, like a real
       * stalled connection being cut by the attempt timeout. */
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    const err = await failureOf(loadBilling(deps({ fetchFn }), { attemptTimeoutMs: 25 }));
    expect(err.failure).toBe("unreachable");
    expect(fetchFn).toHaveBeenCalledTimes(3); // bounded budget, then a terminal state
  });

  it("a stalled TOKEN call is bounded too — the whole attempt is the bound", async () => {
    const getToken = vi.fn(() => new Promise<string | null>(() => undefined)); // never settles
    const fetchFn = vi.fn(async () => jsonRes(200, { billing: VIEW }));
    const err = await failureOf(
      loadBilling(deps({ getToken, fetchFn }), { attemptTimeoutMs: 25, attempts: 2 }),
    );
    expect(err.failure).toBe("unreachable");
    expect(getToken).toHaveBeenCalledTimes(2); // one bounded try per attempt
    expect(fetchFn).not.toHaveBeenCalled(); // never sent out unauthenticated
  });

  it("5xx answers retry inside the budget and a later success wins", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n++;
      return n < 3 ? jsonRes(502, { error: "bad gateway" }) : jsonRes(200, { billing: VIEW });
    });
    const out = await loadBilling(deps({ fetchFn }));
    expect(out).toEqual(VIEW);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("persistent 5xx ends as a server failure that names the status", async () => {
    const fetchFn = vi.fn(async () => jsonRes(503, { error: "unavailable" }));
    const err = await failureOf(loadBilling(deps({ fetchFn })));
    expect(err.failure).toBe("server");
    expect(err.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("a non-JSON answer (proxy error page) is server-class, not a parse explosion", async () => {
    const fetchFn = vi.fn(
      async () => new Response("<html>Bad Gateway</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    const err = await failureOf(loadBilling(deps({ fetchFn })));
    expect(err.failure).toBe("server");
  });

  it("an API 401 is a session failure and is NEVER retried", async () => {
    const fetchFn = vi.fn(async () => jsonRes(401, { error: "unauthorized" }));
    const err = await failureOf(loadBilling(deps({ fetchFn })));
    expect(err.failure).toBe("unauthorized");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a gate 401 is classified as gated — a different lock, a different remedy", async () => {
    const fetchFn = vi.fn(async () =>
      jsonRes(401, { error: "staging_locked", message: "This staging build is password protected." }),
    );
    const err = await failureOf(loadBilling(deps({ fetchFn })));
    expect(err.failure).toBe("gated");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("cancellation stops the load instead of writing into an unmounted card", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      return jsonRes(502, {});
    });
    await expect(
      loadBilling(deps({ fetchFn, isCancelled: () => calls > 0 })),
    ).rejects.toBeInstanceOf(BillingLoadCancelled);
  });
});
