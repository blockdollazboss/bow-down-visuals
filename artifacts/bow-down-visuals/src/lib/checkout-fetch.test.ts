import { describe, expect, it, vi } from "vitest";
import { CheckoutTransportError, checkoutFailureCopy, postJsonWithTransportRetry } from "./checkout-fetch";

/* Stack400 lane 1 — the retry helper behind the plan checkout.
 * The intent POST is idempotency-keyed server-side, so transport
 * retries are safe; a server JSON answer is a decision and is never
 * retried. These tests pin exactly that split.
 * Stack500 lane S — the server's message must actually REACH the
 * buyer: the intent route's own 502 JSON (its real words) is
 * returned untouched, and when responses were received but never
 * arrived readable, the failure copy names the server's error
 * status instead of claiming the server couldn't be reached (the
 * Oct 28 live failure: 502 answered six times server-side, buyer
 * told "couldn't reach the checkout server"). */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(status: number): Response {
  return new Response("<html><body>502 Bad Gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

const noSleep = async () => undefined;

describe("postJsonWithTransportRetry", () => {
  it("returns the server JSON answer on the first try", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { clientSecret: "pi_x_secret", subscriptionId: "sub_x" }));
    const out = await postJsonWithTransportRetry("/api/embedded-checkout/subscription/intent", { token: "tok", body: { tier: "pro" } }, { fetchImpl, sleepImpl: noSleep });
    expect(out.ok).toBe(true);
    expect(out.data.clientSecret).toBe("pi_x_secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    expect(init.body).toBe(JSON.stringify({ tier: "pro" }));
  });

  it("retries a fetch rejection and succeeds on the next attempt", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return jsonResponse(200, { clientSecret: "pi_x_secret", subscriptionId: "sub_x" });
    });
    const out = await postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep });
    expect(out.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a non-JSON proxy error page (the Cloudflare 502 shape) instead of dying on it", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls <= 2) return htmlResponse(502);
      return jsonResponse(200, { clientSecret: "s", subscriptionId: "sub" });
    });
    const out = await postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep });
    expect(out.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("NEVER retries a server JSON error — the server decided, its message stands", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(502, { error: "Stripe couldn't start checkout: boom" }));
    const out = await postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(502);
    expect(out.data.error).toContain("Stripe couldn't start checkout");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws CheckoutTransportError after every attempt fails at transport level", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep }),
    ).rejects.toBeInstanceOf(CheckoutTransportError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws CheckoutTransportError when every attempt returns a non-JSON page, keeping the last status", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse(502));
    const err = await postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckoutTransportError);
    expect((err as CheckoutTransportError).status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("surfaces the intent route's OWN 502 message verbatim — one call, no retry, no generic copy", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(502, { error: "Stripe couldn't start checkout. Nothing was charged — try again." }),
    );
    const out = await postJsonWithTransportRetry(
      "/api/embedded-checkout/subscription/intent",
      { token: "tok", body: { tier: "pro" } },
      { fetchImpl, sleepImpl: noSleep },
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(502);
    expect(out.data.error).toBe("Stripe couldn't start checkout. Nothing was charged — try again.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps a received response's status even when a later attempt rejects outright", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return htmlResponse(502);
      throw new TypeError("Failed to fetch");
    });
    const err = await postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckoutTransportError);
    /* The server DID answer (502) before the connection died — the
       error must not be downgraded to "never reached". */
    expect((err as CheckoutTransportError).status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("checkoutFailureCopy", () => {
  it("reserves 'couldn't reach' for the case where no response ever arrived", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep }).catch((e) => e);
    expect((err as CheckoutTransportError).status).toBeNull();
    expect(checkoutFailureCopy(err)).toBe(
      "Couldn't reach the checkout server — nothing was charged. Give it a moment and try again.",
    );
  });

  it("names the server's error status when the server answered but its body never arrived readable", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse(502));
    const err = await postJsonWithTransportRetry("/x", { body: {} }, { fetchImpl, sleepImpl: noSleep }).catch((e) => e);
    expect(checkoutFailureCopy(err)).toBe(
      "The checkout server answered with an error (HTTP 502) — nothing was charged. Give it a moment and try again.",
    );
  });

  it("falls back to 'couldn't reach' for non-transport errors", () => {
    expect(checkoutFailureCopy(new Error("boom"))).toContain("Couldn't reach the checkout server");
    expect(checkoutFailureCopy(undefined)).toContain("Couldn't reach the checkout server");
  });
});
