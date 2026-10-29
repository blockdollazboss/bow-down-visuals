/**
 * Route tests for GET /api/healthz/deep (stack800 lane 9 — QC G1).
 *
 * The probe runner is mocked (its own tests pin the probe logic);
 * these pin the DOOR and the status mapping: shut (404, existence
 * unconfirmed) without the gate or the token; 200 on an ok report;
 * 503 on a degraded one. The shallow /api/healthz stays public and
 * dependency-free, exactly as before.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../lib/deep-health", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("../../lib/deep-health");
  return { ...orig, runDeepHealth: vi.fn() };
});

import healthRouter from "../health";
import { runDeepHealth } from "../../lib/deep-health";

const mockedRun = vi.mocked(runDeepHealth);

const OK_REPORT = {
  status: "ok" as const,
  ts: "2026-10-29T14:00:00.000Z",
  checks: {
    db: { ok: true, latencyMs: 3 },
    storage: { ok: true, latencyMs: 9, backend: "r2", probeKeys: 0 },
    queue: { ok: true, latencyMs: 4, waiting: 0, active: 0, stuck: 0 },
  },
};
const DEGRADED_REPORT = {
  ...OK_REPORT,
  status: "degraded" as const,
  checks: {
    ...OK_REPORT.checks,
    db: { ok: false, latencyMs: 3000, detail: "probe-timeout" },
  },
};

let server: Server;
let base = "";
const ENV_KEYS = ["STAGING_PASSWORD", "DEEP_HEALTH_TOKEN"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", healthRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  delete process.env["STAGING_PASSWORD"];
  delete process.env["DEEP_HEALTH_TOKEN"];
  mockedRun.mockReset();
  mockedRun.mockResolvedValue(OK_REPORT);
});

describe("GET /api/healthz/deep — the door", () => {
  it("404 with neither gate nor token configured — existence unconfirmed, probes never run", async () => {
    const res = await fetch(`${base}/api/healthz/deep`);
    expect(res.status).toBe(404);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("404 when a token is configured but not presented, or presented wrong", async () => {
    process.env["DEEP_HEALTH_TOKEN"] = "monitor-token-123";
    expect((await fetch(`${base}/api/healthz/deep`)).status).toBe(404);
    const wrong = await fetch(`${base}/api/healthz/deep`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(404);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("200 for the correct bearer token when the gate is off", async () => {
    process.env["DEEP_HEALTH_TOKEN"] = "monitor-token-123";
    const res = await fetch(`${base}/api/healthz/deep`, {
      headers: { authorization: "Bearer monitor-token-123" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof OK_REPORT;
    expect(body.status).toBe("ok");
    expect(body.checks.storage.backend).toBe("r2");
  });

  it("200 behind the staging gate with no token at all (the gate already authenticated)", async () => {
    process.env["STAGING_PASSWORD"] = "gate-pw";
    const res = await fetch(`${base}/api/healthz/deep`);
    expect(res.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/healthz/deep — the mapping", () => {
  it("503 when the report is degraded, with the failing check named in the body", async () => {
    process.env["STAGING_PASSWORD"] = "gate-pw";
    mockedRun.mockResolvedValue(DEGRADED_REPORT);
    const res = await fetch(`${base}/api/healthz/deep`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as typeof DEGRADED_REPORT;
    expect(body.status).toBe("degraded");
    expect(body.checks.db.ok).toBe(false);
    expect(body.checks.db.detail).toBe("probe-timeout");
  });
});

describe("GET /api/healthz — the shallow probe is unchanged", () => {
  it("200 {status: ok} with no gate, no token, no dependencies", async () => {
    const res = await fetch(`${base}/api/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("export queue depth accessor (the queue probe's in-memory half)", () => {
  it("reports sane numbers without touching the pump", async () => {
    const { getExportQueueDepth } = await import("../../lib/export-jobs");
    const depth = getExportQueueDepth();
    expect(depth.waiting).toBeGreaterThanOrEqual(0);
    expect(depth.active).toBeGreaterThanOrEqual(0);
    expect(depth.active).toBeLessThanOrEqual(1); // MAX_CONCURRENT_EXPORTS = 1
  });
});
