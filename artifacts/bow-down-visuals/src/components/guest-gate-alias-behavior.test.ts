/**
 * guest-gate-alias-behavior.test.ts — BEHAVIOR pin for the matrix's
 * redirect dispositions (live-verified gap, Oct 24 2026).
 *
 * The bug: /sponsor-dashboard, /tip-page, /challenge and /albums
 * rendered the SPA 404 on direct load for a SIGNED-IN session, even
 * though ROUTE_MATRIX declares their redirects and route-integrity
 * pins the config. Config was never behavior: the signed-in path
 * performed no redirect — GuestGate returned children untouched and
 * the router fell through to its catch-all. The fix moved alias
 * resolution into the gate's verdict (lib/guest-gate-verdict.ts),
 * above the auth branch, in the one choke point every navigation
 * passes; GuestGate renders exactly what the verdict decides.
 *
 * This test drives that real shipped decision function across EVERY
 * redirect disposition in the matrix, in both auth states, and
 * asserts the navigation lands on the target. A config-only
 * assertion would not have caught the bug; this does — restore the
 * old order (signed-in passthrough before alias) and every
 * signed-in case here fails. Target-liveness is asserted too: every
 * target must be a route App.tsx actually declares.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ROUTE_MATRIX } from "@/lib/public-routes";
import { resolveGateVerdict } from "@/lib/guest-gate-verdict";

const REDIRECTS = ROUTE_MATRIX.filter((e) => e.disposition === "redirect" && e.redirectTo);

const LANE_A_SEVEN: Record<string, string> = {
  "/sponsor-dashboard": "/sponsors/dashboard",
  "/tip-page": "/tips",
  "/nfc-card-profile": "/nfc-cards",
  "/group-detail": "/groups",
  "/challenge": "/contests",
  "/albums": "/my-projects?tab=songs",
  "/hashtag": "/trending",
};

const SIGNED_IN = { user: { id: "owner-1" }, loading: false };
const SIGNED_OUT = { user: null, loading: false };

describe("alias redirects actually resolve — signed IN (the live-verified gap)", () => {
  it("the seven lane-A aliases land on their targets", () => {
    for (const [alias, target] of Object.entries(LANE_A_SEVEN)) {
      expect(resolveGateVerdict(alias, "", SIGNED_IN), alias).toEqual({
        kind: "redirect",
        to: target,
      });
    }
  });

  it("EVERY redirect disposition in the matrix resolves", () => {
    expect(REDIRECTS.length).toBeGreaterThanOrEqual(70);
    for (const entry of REDIRECTS) {
      expect(resolveGateVerdict(entry.path, "", SIGNED_IN), entry.path).toEqual({
        kind: "redirect",
        to: entry.redirectTo,
      });
    }
  });

  it("a non-alias app path renders the app untouched", () => {
    expect(resolveGateVerdict("/dashboard", "", SIGNED_IN)).toEqual({ kind: "children" });
  });

  it("a still-resolving session renders the loader, alias or not", () => {
    expect(resolveGateVerdict("/sponsor-dashboard", "", { user: null, loading: true })).toEqual({
      kind: "loading",
    });
  });
});

describe("alias redirects still resolve — signed OUT (the original gate behavior)", () => {
  it("the seven lane-A aliases land on their targets, not on /login", () => {
    for (const [alias, target] of Object.entries(LANE_A_SEVEN)) {
      expect(resolveGateVerdict(alias, "", SIGNED_OUT), alias).toEqual({
        kind: "redirect",
        to: target,
      });
    }
  });

  it("a locked non-alias path still bounces to /login with ?next=", () => {
    expect(resolveGateVerdict("/dashboard", "", SIGNED_OUT)).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fdashboard",
    });
  });
});

describe("GuestGate renders the verdict (the wiring is pinned, not assumed)", () => {
  const gateSource = readFileSync(new URL("./GuestGate.tsx", import.meta.url), "utf8");

  it("GuestGate decides through resolveGateVerdict and redirects on its word", () => {
    expect(gateSource).toContain("resolveGateVerdict(location, search, { user, loading })");
    expect(gateSource).toContain('verdict.kind === "redirect"');
    expect(gateSource).toContain("<Redirect to={verdict.to} />");
  });
});

describe("every alias target is itself a live route in App.tsx", () => {
  const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const routePatterns = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]!);

  function routeExists(target: string): boolean {
    const targetSegs = target.split("?")[0]!.split("/").filter(Boolean);
    return routePatterns.some((pattern) => {
      const segs = pattern.split("/").filter(Boolean);
      if (segs.length !== targetSegs.length) return false;
      return segs.every((s, i) => s.startsWith(":") || s === targetSegs[i]);
    });
  }

  it("all matrix redirect targets resolve to a declared route", () => {
    for (const entry of REDIRECTS) {
      expect(routeExists(entry.redirectTo!), `${entry.path} -> ${entry.redirectTo}`).toBe(true);
    }
  });
});
