/**
 * deep-health.ts — dependency truth for the uptime monitor.
 * (2026-10-29, stack800 lane 9 — QC G1, the uptime blind spot.)
 *
 * The shallow probe (GET /api/healthz) answers "is the process
 * alive?" and nothing more: it stayed green through dependency
 * failures the site could not survive (a dead database reads exactly
 * like a healthy one from outside — and behind the password gate the
 * monitor could not even see signed-in crashes, only the gate's 401).
 * This module runs the deep check the monitor actually alerts on:
 *
 *   db ....... SELECT 1 against the site's Postgres pool.
 *   storage .. a list call against the R2 media bucket (the storage
 *              the site is configured to use; unconfigured reads as
 *              DOWN, because on this site no storage backend means
 *              uploads/exports are broken, not optional).
 *   queue .... the export render queue: the in-memory pump's depth
 *              plus the durable half of the same question — any job
 *              row stuck ACTIVE with no stage progress for an hour
 *              (a hung render is the failure this queue has actually
 *              shipped; see the export-jobs header).
 *
 * Every probe is individually timed out (PROBE_TIMEOUT_MS) and the
 * three run in parallel, so a hung dependency degrades the report
 * instead of hanging the endpoint. A probe that throws or times out
 * is DOWN with the reason named; the endpoint answers 200 only when
 * every check is ok, 503 otherwise (see routes/health.ts).
 *
 * Access (enforced in routes/health.ts via isDeepHealthAuthorized):
 * the report names which dependency is down, so it is never public.
 * When the staging gate is on, the gate middleware has already
 * authenticated the request before it reaches the route. When the
 * gate is off, a dedicated DEEP_HEALTH_TOKEN bearer is required;
 * with neither configured the door does not exist (404).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { isR2Configured, r2List } from "./r2-client";
import { getExportQueueDepth } from "./export-jobs";

export const PROBE_TIMEOUT_MS = 3_000;
/** An export job ACTIVE with no stage progress for this long is a
 * hung render, not a slow one: stage writes land at every stage
 * transition and renders are bounded by the 10-minute song tier. */
export const QUEUE_STUCK_MS = 60 * 60 * 1_000;

export interface DeepHealthCheck {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  [fact: string]: unknown;
}

export interface DeepHealthReport {
  status: "ok" | "degraded";
  ts: string;
  checks: {
    db: DeepHealthCheck;
    storage: DeepHealthCheck;
    queue: DeepHealthCheck;
  };
}

/** A probe returns its facts on success and throws on failure; the
 * runner owns timing, timeout, and error naming. */
export interface DeepHealthProbes {
  db: () => Promise<Record<string, unknown>>;
  storage: () => Promise<Record<string, unknown>>;
  queue: () => Promise<Record<string, unknown> & { ok?: boolean }>;
}

async function probeDb(): Promise<Record<string, unknown>> {
  await db.execute(sql`select 1 as one`);
  return {};
}

async function probeStorage(): Promise<Record<string, unknown>> {
  if (!isR2Configured()) {
    throw new Error("r2-not-configured");
  }
  /* List under a prefix nothing writes to: the call proves the
   * bucket answered (an empty page), and r2List throws on any
   * transport/credential failure — unlike r2KeyExists it does not
   * swallow errors, so a dead backend cannot masquerade as a
   * missing key. */
  const keys = await r2List("diagnostics/.deep-health-probe/");
  return { backend: "r2", probeKeys: keys.length };
}

async function probeQueue(): Promise<Record<string, unknown> & { ok?: boolean }> {
  const depth = getExportQueueDepth();
  const cutoff = new Date(Date.now() - QUEUE_STUCK_MS);
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS stuck
    FROM export_jobs
    WHERE state = 'active'
      AND updated_at < ${cutoff}
  `)) as unknown as Array<{ stuck: number }>;
  const stuck = Number(rows[0]?.stuck ?? 0);
  return {
    waiting: depth.waiting,
    active: depth.active,
    stuck,
    ok: stuck === 0,
  };
}

export const defaultDeepHealthProbes: DeepHealthProbes = {
  db: probeDb,
  storage: probeStorage,
  queue: probeQueue,
};

function withTimeout<T>(run: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe-timeout")), ms);
    timer.unref?.();
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function runProbe(
  probe: DeepHealthProbes[keyof DeepHealthProbes],
  now: () => number,
): Promise<DeepHealthCheck> {
  const started = now();
  try {
    const facts = await withTimeout(probe, PROBE_TIMEOUT_MS);
    const { ok: factOk, ...rest } = facts as { ok?: boolean };
    return {
      ok: factOk ?? true,
      latencyMs: Math.max(0, Math.round(now() - started)),
      ...rest,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.max(0, Math.round(now() - started)),
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run all three probes in parallel and fold them into the report.
 * Never throws: a health endpoint that can throw is a blind spot
 * with extra steps. */
export async function runDeepHealth(
  probes: DeepHealthProbes = defaultDeepHealthProbes,
  now: () => number = Date.now,
): Promise<DeepHealthReport> {
  const [dbCheck, storageCheck, queueCheck] = await Promise.all([
    runProbe(probes.db, now),
    runProbe(probes.storage, now),
    runProbe(probes.queue, now),
  ]);
  const checks = { db: dbCheck, storage: storageCheck, queue: queueCheck };
  return {
    status:
      checks.db.ok && checks.storage.ok && checks.queue.ok
        ? "ok"
        : "degraded",
    ts: new Date(now()).toISOString(),
    checks,
  };
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * The deep-health door (see the header): authorized when the staging
 * gate is enabled (its middleware already authenticated the request
 * before routing — a request that reaches the handler presented the
 * gate cookie), or when DEEP_HEALTH_TOKEN is configured and the
 * request presents it (Authorization: Bearer … or x-health-token).
 * With neither configured, nobody is authorized.
 *
 * The token comparison runs through an HMAC digest so the presented
 * and configured values compare at equal length (timingSafeEqual
 * refuses unequal lengths, which would otherwise leak length).
 */
export function isDeepHealthAuthorized(
  headers: Record<string, string | string[] | undefined>,
  env: Record<string, string | undefined>,
): boolean {
  if (env["STAGING_PASSWORD"]) return true;
  const configured = env["DEEP_HEALTH_TOKEN"];
  if (!configured) return false;
  const auth = headers["authorization"];
  const bearer =
    typeof auth === "string" && auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : null;
  const headerToken = headers["x-health-token"];
  const presented =
    bearer ?? (typeof headerToken === "string" ? headerToken : null);
  if (!presented) return false;
  const digest = (value: string) =>
    createHmac("sha256", "bow-down-visuals-deep-health").update(value).digest("hex");
  return tokensEqual(digest(presented), digest(configured));
}
