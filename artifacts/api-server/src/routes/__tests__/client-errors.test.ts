/**
 * Route tests for POST /api/client-errors — the RouteErrorBoundary's
 * self-report endpoint (stack600 boundary telemetry).
 *
 * Pins: a well-formed report is accepted with 204 and logged with
 * exactly the parsed fields (never the raw body); over-long or
 * malformed reports are 400; the endpoint needs no auth (the
 * boundary wraps guest routes too).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const logState = vi.hoisted(() => ({
  warnCalls: [] as Array<{ fields: unknown; msg: unknown }>,
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    warn: (fields: unknown, msg: unknown) => {
      logState.warnCalls.push({ fields, msg });
    },
    info: () => {},
    error: () => {},
  },
}));

import clientErrorsRouter from "../client-errors";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", clientErrorsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const GOOD = {
  route: "/creator-pricing",
  errorName: "TypeError",
  errorMessage: "Failed to fetch dynamically imported module: x.js",
  chunkLike: true,
  build: null,
  ts: "2026-10-28T20:17:00.000Z",
};

describe("POST /api/client-errors", () => {
  it("accepts a well-formed report with 204 and logs the parsed fields", async () => {
    logState.warnCalls.length = 0;
    const res = await fetch(`${base}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...GOOD, smuggled: "do-not-log" }),
    });
    expect(res.status).toBe(204);
    expect(logState.warnCalls).toHaveLength(1);
    const { fields, msg } = logState.warnCalls[0]!;
    expect(msg).toBe("[client-error] route boundary trip");
    expect(fields).toEqual({
      route: "/creator-pricing",
      errorName: "TypeError",
      errorMessage: GOOD.errorMessage,
      chunkLike: true,
      build: null,
      clientTs: GOOD.ts,
    });
    expect(JSON.stringify(fields)).not.toContain("do-not-log");
  });

  it("rejects a malformed report with 400 and logs nothing", async () => {
    logState.warnCalls.length = 0;
    const res = await fetch(`${base}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route: "/x" }),
    });
    expect(res.status).toBe(400);
    expect(logState.warnCalls).toHaveLength(0);
  });

  it("rejects an over-long message (>500) with 400", async () => {
    const res = await fetch(`${base}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...GOOD, errorMessage: "y".repeat(501) }),
    });
    expect(res.status).toBe(400);
  });
});
