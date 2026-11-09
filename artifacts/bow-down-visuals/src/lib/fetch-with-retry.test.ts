import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch-with-retry";

/**
 * fetch-with-retry — Stack 400, census C-16.
 *
 * The dashboard panels (CommandCenter) and the FomoFeed first load
 * fired single-shot fetches with no timeout and no retry, so one
 * slow cold-load request (the 45–90 s staging wake; the same shape
 * as a launch traffic spike) parked a panel on its failure state
 * until a human tapped Retry. These pins hold the shared helper to
 * the census contract: 20 s per-attempt timeout, 2 backoff retries
 * on network/5xx only, 4xx never retried, and after exhaustion the
 * caller's honest failure state is what surfaces (last 5xx returned,
 * last network error thrown).
 */

const res = (status: number) => ({ status }) as Response;
const noSleep = async () => {};

describe("fetchWithRetry (C-16)", () => {
  it("returns a first-attempt success without retrying", async () => {
    const fetchImpl = vi.fn(async () => res(200));
    const out = await fetchWithRetry("/x", {}, { fetchImpl, sleepImpl: noSleep });
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries a 4xx — the server answered, a refusal is a decision", async () => {
    const fetchImpl = vi.fn(async () => res(403));
    const out = await fetchWithRetry("/x", {}, { fetchImpl, sleepImpl: noSleep });
    expect(out.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx with backoff and returns the eventual success", async () => {
    const sleepImpl = vi.fn(noSleep);
    let n = 0;
    const fetchImpl = vi.fn(async () => res(++n < 3 ? 502 : 200));
    const out = await fetchWithRetry("/x", {}, { fetchImpl, sleepImpl });
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl.mock.calls.map((c) => c[0])).toEqual([1_000, 3_000]);
  });

  it("returns the LAST 5xx after retries run out — the caller still sees the real status", async () => {
    const fetchImpl = vi.fn(async () => res(503));
    const out = await fetchWithRetry("/x", {}, { fetchImpl, sleepImpl: noSleep });
    expect(out.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries network errors and throws the LAST one after exhaustion", async () => {
    const boom = new Error("socket hang up");
    const fetchImpl = vi.fn(async () => {
      throw boom;
    });
    await expect(fetchWithRetry("/x", {}, { fetchImpl, sleepImpl: noSleep })).rejects.toBe(boom);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("a network error followed by a success resolves with the success", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (++n === 1) throw new Error("ECONNRESET");
      return res(200);
    });
    const out = await fetchWithRetry("/x", {}, { fetchImpl, sleepImpl: noSleep });
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a per-attempt timeout aborts and is retried like a network failure", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signals.push(signal);
          signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    await expect(
      fetchWithRetry("/x", {}, { fetchImpl, sleepImpl: noSleep, timeoutMs: 5, retries: 1 }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("forwards the caller's init (headers) and attaches an AbortSignal", async () => {
    const fetchImpl = vi.fn(async () => res(200));
    await fetchWithRetry(
      "/x",
      { headers: { Authorization: "Bearer token" } },
      { fetchImpl, sleepImpl: noSleep },
    );
    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
