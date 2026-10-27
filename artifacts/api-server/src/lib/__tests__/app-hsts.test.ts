/**
 * HSTS pin — Strict-Transport-Security on settled app responses.
 *
 * The Oct 26 daily security check found HSTS missing from app
 * responses while every other security header passed. The fix adds
 * the header to the security-headers middleware
 * (lib/security-headers.ts — the manual header builder; there is no
 * helmet dependency), which app.ts mounts FIRST, before the rate
 * limiter, the staging gate, the API router, static serving, the
 * SPA fallback, and the 404/error handlers.
 *
 * Two layers of pin:
 * 1. Live HTTP checks against the real `securityHeaders` middleware
 *    (and the real `stagingGate`) mounted in app.ts's order on a
 *    representative app: an API route, the app/static entry, a
 *    static asset, the SPA fallback, a JSON 404, and a gate
 *    rejection all carry the header with its exact value.
 *    (Importing the whole of app.ts in a unit test pulls the entire
 *    route graph and never settles; the suite's established pattern
 *    for app-level wiring is the source contract in layer 2, cf.
 *    app-csp.test.ts.)
 * 2. A source contract on app.ts: `securityHeaders` is imported
 *    from lib/security-headers and mounted before the global rate
 *    limiter, the staging gate, the /api router, and static
 *    serving — so the live checks above describe production.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { securityHeaders, STRICT_TRANSPORT_SECURITY } from "../security-headers";
import { stagingGate } from "../staging-gate";

const EXPECTED_HSTS = "max-age=31536000; includeSubDomains";

let base = "";
let server: Server;
let fixtureDir: string;
let savedStagingPassword: string | undefined;

beforeAll(async () => {
  savedStagingPassword = process.env["STAGING_PASSWORD"];
  delete process.env["STAGING_PASSWORD"];

  fixtureDir = mkdtempSync(join(tmpdir(), "bdv-hsts-frontend-"));
  writeFileSync(
    join(fixtureDir, "index.html"),
    "<!doctype html><html><head><title>HSTS fixture</title></head><body>hsts-spa-entry</body></html>",
  );
  mkdirSync(join(fixtureDir, "assets"), { recursive: true });
  writeFileSync(join(fixtureDir, "assets", "fixture.txt"), "hsts-static-asset");

  /* Mount order mirrors app.ts for the layers under test:
     security headers → staging gate → /api router → static →
     SPA fallback → JSON 404. (Production additionally mounts the
     rate limiter, logging, CORS, and webhooks between the header
     middleware and the gate — none of them strip response headers,
     and the source contract below pins the header middleware
     ahead of all of them.) */
  const app = express();
  app.use(securityHeaders);
  app.use(express.json());
  app.use(stagingGate);
  const api = express.Router();
  api.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api", api);
  app.use(express.static(fixtureDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.status(200).sendFile(join(fixtureDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  if (savedStagingPassword === undefined) delete process.env["STAGING_PASSWORD"];
  else process.env["STAGING_PASSWORD"] = savedStagingPassword;
});

async function get(path: string) {
  const r = await fetch(`${base}${path}`);
  return {
    status: r.status,
    hsts: r.headers.get("strict-transport-security"),
    body: await r.text(),
  };
}

describe("Strict-Transport-Security — settled responses", () => {
  it("the exported value is the exact production value", () => {
    expect(STRICT_TRANSPORT_SECURITY).toBe(EXPECTED_HSTS);
  });

  it("is present with the expected value on an API route (GET /api/healthz)", async () => {
    const res = await get("/api/healthz");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
    expect(res.hsts).toBe(EXPECTED_HSTS);
  });

  it("is present with the expected value on the app/static entry (GET /)", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("hsts-spa-entry");
    expect(res.hsts).toBe(EXPECTED_HSTS);
  });

  it("is present on a static asset", async () => {
    const res = await get("/assets/fixture.txt");
    expect(res.status).toBe(200);
    expect(res.body).toContain("hsts-static-asset");
    expect(res.hsts).toBe(EXPECTED_HSTS);
  });

  it("is present on the SPA fallback for a client-side route", async () => {
    const res = await get("/some/client-side/route");
    expect(res.status).toBe(200);
    expect(res.body).toContain("hsts-spa-entry");
    expect(res.hsts).toBe(EXPECTED_HSTS);
  });

  it("is present on an error response (API 404 stays JSON)", async () => {
    const res = await get("/api/no-such-route-hsts-check");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "Not found" });
    expect(res.hsts).toBe(EXPECTED_HSTS);
  });

  it("is present on a staging-gate rejection, and the gate still gates", async () => {
    process.env["STAGING_PASSWORD"] = "hsts-test-gate-password";
    try {
      const res = await get("/api/healthz");
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).error).toBe("staging_locked");
      expect(res.hsts).toBe(EXPECTED_HSTS);
    } finally {
      delete process.env["STAGING_PASSWORD"];
    }
  });
});

describe("Strict-Transport-Security — app.ts wiring (source contract)", () => {
  const appSrc = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");

  it("app.ts imports securityHeaders from lib/security-headers", () => {
    expect(appSrc).toContain('import { securityHeaders } from "./lib/security-headers";');
  });

  it("app.ts sets the header via the middleware — the lib is the one place it is built", () => {
    const libSrc = readFileSync(new URL("../security-headers.ts", import.meta.url), "utf8");
    expect(libSrc).toContain('res.setHeader("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY)');
    expect(libSrc).toContain(`export const STRICT_TRANSPORT_SECURITY = "${EXPECTED_HSTS}"`);
    expect(appSrc).not.toContain('setHeader("Strict-Transport-Security"');
  });

  it("the header middleware mounts before the rate limiter, staging gate, API router, and static serving", () => {
    const mount = appSrc.indexOf("app.use(securityHeaders);");
    expect(mount).toBeGreaterThan(-1);
    for (const later of [
      "app.use(globalLimiter);",
      "app.use(stagingGate);",
      'app.use("/api", router);',
      "express.static(frontendDist",
    ]) {
      const idx = appSrc.indexOf(later);
      expect(idx, `${later} present in app.ts`).toBeGreaterThan(-1);
      expect(mount, `securityHeaders mounts before ${later}`).toBeLessThan(idx);
    }
  });
});
