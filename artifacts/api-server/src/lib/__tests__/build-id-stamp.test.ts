/**
 * Build-id stamp pin (stack800 lane 9).
 *
 * The RouteErrorBoundary self-report has carried a `build` field
 * since stack600, read from import.meta.env.VITE_BUILD_ID — but no
 * build ever set it, so every production crash report arrived with
 * build: null and named nothing. The production image is built by
 * the repo-root Dockerfile, so the stamp is pinned HERE, at its
 * source: the Dockerfile must declare the build arg, thread it into
 * the build environment, and stamp a non-empty fallback (UTC build
 * timestamp) when no explicit id is provided — a production bundle
 * must never carry a null build id again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..", "..");
const dockerfile = readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
const boundaryReport = readFileSync(
  path.join(
    REPO_ROOT,
    "artifacts",
    "bow-down-visuals",
    "src",
    "lib",
    "boundary-report.ts",
  ),
  "utf8",
);

describe("VITE_BUILD_ID stamp (Dockerfile)", () => {
  it("declares the build arg alongside the other VITE_ args", () => {
    expect(dockerfile).toMatch(/^ARG VITE_BUILD_ID=/m);
  });

  it("threads the arg into the build environment", () => {
    expect(dockerfile).toContain("VITE_BUILD_ID=$VITE_BUILD_ID");
  });

  it("stamps a non-empty UTC-timestamp fallback when the arg is empty", () => {
    const buildLine = dockerfile
      .split("\n")
      .find((line) => line.includes("pnpm run build"));
    expect(buildLine, "Dockerfile build line not found").toBeTruthy();
    expect(buildLine).toContain('VITE_BUILD_ID="${VITE_BUILD_ID:-docker-$(date -u +');
  });

  it("the boundary report no longer claims the build id is unset", () => {
    expect(boundaryReport).not.toContain("currently unset in the build");
    expect(boundaryReport).toContain("VITE_BUILD_ID");
  });
});
