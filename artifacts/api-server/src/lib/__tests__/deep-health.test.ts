/**
 * Deep-health probe tests (stack800 lane 9 — QC G1).
 *
 * The runner is probe-injected, so every case here is deterministic:
 * no live DB, no live R2. Pins: all-ok folds to 200-shaped "ok"; any
 * failure (throw, timeout, or a probe reporting ok:false) degrades
 * the report and names the failing check; a hung probe degrades
 * instead of hanging. The authorization matrix pins the door: gate
 * on = the gate already authenticated; gate off = the dedicated
 * token or nothing; neither configured = nobody.
 */
import { describe, it, expect } from "vitest";
import {
  runDeepHealth,
  isDeepHealthAuthorized,
  PROBE_TIMEOUT_MS,
  type DeepHealthProbes,
} from "../deep-health";

const okProbes: DeepHealthProbes = {
  db: async () => ({}),
  storage: async () => ({ backend: "r2", probeKeys: 0 }),
  queue: async () => ({ waiting: 0, active: 1, stuck: 0, ok: true }),
};

describe("runDeepHealth", () => {
  it("all checks ok → status ok, facts carried, latencies recorded", async () => {
    const report = await runDeepHealth(okProbes);
    expect(report.status).toBe("ok");
    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.storage.ok).toBe(true);
    expect(report.checks.storage.backend).toBe("r2");
    expect(report.checks.queue.ok).toBe(true);
    expect(report.checks.queue.active).toBe(1);
    for (const check of Object.values(report.checks)) {
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(() => new Date(report.ts).toISOString()).not.toThrow();
  });

  it("a throwing probe degrades the report and names the failure; the others still report", async () => {
    const report = await runDeepHealth({
      ...okProbes,
      db: async () => {
        throw new Error("connection refused");
      },
    });
    expect(report.status).toBe("degraded");
    expect(report.checks.db.ok).toBe(false);
    expect(report.checks.db.detail).toBe("connection refused");
    expect(report.checks.storage.ok).toBe(true);
    expect(report.checks.queue.ok).toBe(true);
  });

  it("a probe reporting ok:false without throwing (stuck queue) degrades", async () => {
    const report = await runDeepHealth({
      ...okProbes,
      queue: async () => ({ waiting: 2, active: 1, stuck: 1, ok: false }),
    });
    expect(report.status).toBe("degraded");
    expect(report.checks.queue.ok).toBe(false);
    expect(report.checks.queue.stuck).toBe(1);
    expect(report.checks.queue.waiting).toBe(2);
  });

  it("a hung probe times out and degrades instead of hanging the endpoint", async () => {
    const started = Date.now();
    const report = await runDeepHealth({
      ...okProbes,
      storage: () => new Promise<Record<string, unknown>>(() => {}),
    });
    expect(report.status).toBe("degraded");
    expect(report.checks.storage.ok).toBe(false);
    expect(report.checks.storage.detail).toBe("probe-timeout");
    expect(Date.now() - started).toBeLessThan(PROBE_TIMEOUT_MS + 2_000);
    expect(report.checks.db.ok).toBe(true);
  });
});

describe("isDeepHealthAuthorized", () => {
  const TOKEN = "monitor-token-123";

  it("gate enabled → authorized (the gate middleware already authenticated the request)", () => {
    expect(isDeepHealthAuthorized({}, { STAGING_PASSWORD: "pw" })).toBe(true);
    // The gate wins even when a token is also configured.
    expect(
      isDeepHealthAuthorized({}, { STAGING_PASSWORD: "pw", DEEP_HEALTH_TOKEN: TOKEN }),
    ).toBe(true);
  });

  it("gate off + no token configured → nobody is authorized", () => {
    expect(isDeepHealthAuthorized({}, {})).toBe(false);
    expect(
      isDeepHealthAuthorized({ authorization: `Bearer ${TOKEN}` }, {}),
    ).toBe(false);
  });

  it("gate off + token configured → the bearer or x-health-token must match exactly", () => {
    const env = { DEEP_HEALTH_TOKEN: TOKEN };
    expect(isDeepHealthAuthorized({ authorization: `Bearer ${TOKEN}` }, env)).toBe(true);
    expect(isDeepHealthAuthorized({ "x-health-token": TOKEN }, env)).toBe(true);
    expect(isDeepHealthAuthorized({ authorization: "Bearer wrong" }, env)).toBe(false);
    expect(isDeepHealthAuthorized({ "x-health-token": "wrong" }, env)).toBe(false);
    expect(isDeepHealthAuthorized({}, env)).toBe(false);
    // A near-miss differing only in length must not slip through.
    expect(isDeepHealthAuthorized({ authorization: `Bearer ${TOKEN}x` }, env)).toBe(false);
  });
});
