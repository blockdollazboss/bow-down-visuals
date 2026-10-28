/**
 * Tests for the World fixture failure beacon
 * (POST /api/world/fixture-failure).
 *
 * The route's whole job: take one small client report that a World
 * fixture body (the King / a guard) failed to load, and land it in
 * the structured server log as a warn — no table, no side effects.
 * Auth is the real requireAuth in production; here it is mocked to
 * a fixed user (the house pattern), and the logger is mocked so the
 * test can prove the warn actually fired with the report intact.
 */
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  authedUserId: "user-beacon-1",
  warn: vi.fn(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = state.authedUserId;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    warn: state.warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import router from "../world-fixture-failure";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.warn.mockClear();
});

function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validReport = {
  postId: "hall-king",
  body: "king",
  attempts: 4,
  errorName: "Error",
  errorMessage: "textures did not land for https://cdn.example/world/king-gen.glb",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130",
};

describe("POST /world/fixture-failure — the beacon lands in the log", () => {
  it("accepts a valid report with 202 and logs it as a structured warn", async () => {
    const res = await postJson("/world/fixture-failure", validReport);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.warn).toHaveBeenCalledTimes(1);
    const [fields, message] = state.warn.mock.calls[0]!;
    expect(fields).toEqual({ fixtureFailure: validReport, userId: "user-beacon-1" });
    expect(String(message)).toContain("fixture");
  });

  it("rejects an unknown body and logs nothing", async () => {
    const res = await postJson("/world/fixture-failure", { ...validReport, body: "dragon" });
    expect(res.status).toBe(400);
    expect(state.warn).not.toHaveBeenCalled();
  });

  it("rejects attempts outside the sane band and logs nothing", async () => {
    for (const attempts of [0, -1, 2.5, 101]) {
      const res = await postJson("/world/fixture-failure", { ...validReport, attempts });
      expect(res.status).toBe(400);
    }
    expect(state.warn).not.toHaveBeenCalled();
  });

  it("rejects missing or oversized fields and logs nothing", async () => {
    const { errorMessage: _dropped, ...missing } = validReport;
    expect((await postJson("/world/fixture-failure", missing)).status).toBe(400);
    expect(
      (await postJson("/world/fixture-failure", { ...validReport, errorMessage: "x".repeat(501) }))
        .status,
    ).toBe(400);
    expect(
      (await postJson("/world/fixture-failure", { ...validReport, postId: "p".repeat(65) })).status,
    ).toBe(400);
    expect(state.warn).not.toHaveBeenCalled();
  });
});
