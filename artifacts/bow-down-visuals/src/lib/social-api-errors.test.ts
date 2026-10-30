/**
 * apiJson error truth (stack900 form-truth): a failed request must
 * surface the server's reason. apiJson used to read only `message`,
 * so every rail answering { error } or { details } — bookings among
 * them — collapsed to a bare "Request failed (400)" and the person
 * never learned which field to fix.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiJson } from "./social-api";

const token = async () => "tok";

function stubFailure(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status,
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiJson error surfacing", () => {
  it("prefers the rail's message when one is sent", async () => {
    stubFailure(400, { error: "OWN_PROFILE", message: "You can't book yourself." });
    await expect(apiJson(token, "/api/performance-bookings", { method: "POST" })).rejects.toThrow(
      "You can't book yourself.",
    );
  });

  it("surfaces the first validation detail over the generic headline", async () => {
    stubFailure(400, {
      error: "That booking is missing something.",
      details: ["Name the show.", "The fee must be at least $1."],
    });
    await expect(apiJson(token, "/api/performance-bookings", { method: "POST" })).rejects.toThrow(
      "Name the show.",
    );
  });

  it("surfaces details given as issue objects", async () => {
    stubFailure(400, { error: "Invalid tier.", details: [{ field: "name", message: "Tier name is required." }] });
    await expect(apiJson(token, "/api/memberships/tiers", { method: "POST" })).rejects.toThrow(
      "Tier name is required.",
    );
  });

  it("falls back to the error text, then to the status", async () => {
    stubFailure(404, { error: "That artist profile could not be found." });
    await expect(apiJson(token, "/api/performance-bookings", { method: "POST" })).rejects.toThrow(
      "That artist profile could not be found.",
    );
    stubFailure(500, {});
    await expect(apiJson(token, "/api/performance-bookings", { method: "POST" })).rejects.toThrow(
      "Request failed (500)",
    );
  });
});
