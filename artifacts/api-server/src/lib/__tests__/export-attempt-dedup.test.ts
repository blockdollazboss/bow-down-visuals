/**
 * Stack300 item 64 — the video-export rail's duplicate-submit guard.
 *
 * Before the fix, POST /export-final-video and /export-quality called
 * createExportJob unconditionally: a network retry, double-tab, or
 * re-tap after a lost 202 created a second job and a second A-07
 * reservation for the same render. The route now derives an attempt
 * key from (user + project + params hash), stores it inside the
 * persisted params, and startExportJob returns the in-flight job for
 * a duplicate instead.
 *
 * Part 1 drives findActiveExportJobByAttemptKey against a fake pool
 * (the export-jobs-refund.test.ts precedent — the store speaks raw
 * SQL through its own pool). Part 2 pins the startExportJob wiring by
 * source (the worker module pulls the whole ffmpeg pipeline, so it
 * is not imported here — same precedent).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  lastQuery: "",
}));

function sqlText(q: any): string {
  const parts: string[] = [];
  const walk = (node: any): void => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.value === "string") parts.push(node.value);
    if (Array.isArray(node.value)) node.value.forEach(walk);
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(q);
  return parts.join(" ");
}

vi.mock("pg", () => ({ Pool: class Pool {} }));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => ({
    execute: async (q: any) => {
      h.lastQuery = sqlText(q);
      return { rows: h.rows };
    },
  }),
}));

vi.mock("@workspace/db", () => ({ pgSslConfig: () => undefined }));

vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("../credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    canUseCredits: async () => true,
    OutOfCreditsError,
    CreditsDisabledError: class CreditsDisabledError extends Error {},
    deductCreditsDetailed: async () => ({
      balance: 0,
      split: { fromBonus: 0, fromRegular: 0, bonusExpiresAt: null },
    }),
    refundCredits: async () => 0,
  };
});

import { findActiveExportJobByAttemptKey } from "../export-jobs";

beforeAll(() => {
  process.env["DATABASE_URL"] = "postgres://fake";
});

beforeEach(() => {
  h.rows = [];
  h.lastQuery = "";
});

const ROW = {
  id: "job-9",
  user_id: "user-1",
  project_id: "proj-1",
  state: "active",
  stage: "combining",
  progress: 62,
  params: { attemptKey: "video_export:user-1:abc", clipUrls: [] },
  result: null,
  error: null,
  credits_charged: true,
  credits_from_bonus: null,
  credits_bonus_expires_at: null,
  attempts: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("findActiveExportJobByAttemptKey", () => {
  it("returns the in-flight job for a matching attempt key", async () => {
    h.rows = [ROW];
    const job = await findActiveExportJobByAttemptKey("user-1", "video_export:user-1:abc");
    expect(job?.id).toBe("job-9");
    expect(job?.state).toBe("active");
    // The lookup is owner-scoped, in-flight only, and keyed on the
    // attempt key inside the persisted params.
    expect(h.lastQuery).toContain("params->>'attemptKey'");
    expect(h.lastQuery).toContain("state IN ('queued', 'active')");
    expect(h.lastQuery).toContain("user_id =");
  });

  it("returns undefined when no in-flight job matches", async () => {
    h.rows = [];
    expect(await findActiveExportJobByAttemptKey("user-1", "video_export:user-1:zzz")).toBeUndefined();
  });

  it("never queries without a key", async () => {
    expect(await findActiveExportJobByAttemptKey("user-1", "")).toBeUndefined();
    expect(h.lastQuery).toBe("");
  });
});

describe("startExportJob wiring (source pins)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../routes/generate/export-video.ts", import.meta.url)),
    "utf8",
  );
  const start = src.slice(src.indexOf("async function startExportJob"));
  const body = start.slice(0, start.indexOf("router.post("));

  it("derives the attempt key from user + project + final params", () => {
    expect(body).toContain('buildChargeIdempotencyKey(');
    expect(body).toContain('"video_export"');
    expect(body).toContain("projectId: body.projectId.trim()");
  });

  it("consults the finder BEFORE creating a job, and a duplicate returns early", () => {
    const finderAt = body.indexOf("findActiveExportJobByAttemptKey(req.userId!, attemptKey)");
    const createAt = body.indexOf("createExportJob(");
    expect(finderAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(finderAt);
    expect(body).toContain("duplicate: true");
    // The early return sits between the lookup and the create.
    const dupReturnAt = body.indexOf("if (existing) {");
    expect(dupReturnAt).toBeGreaterThan(finderAt);
    expect(dupReturnAt).toBeLessThan(createAt);
  });

  it("persists the attempt key with the job params", () => {
    expect(body).toContain("createExportJob(req.userId!, body.projectId.trim(), { ...body, attemptKey })");
  });

  it("the duplicate answer carries the same charge info a fresh start would", () => {
    expect(body).toContain("charge: buildExportChargeInfo(existing, req.userPlan)");
  });
});
