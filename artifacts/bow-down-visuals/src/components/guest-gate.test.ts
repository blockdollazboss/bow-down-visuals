/**
 * guest-gate.test.ts — Lane 2 of the access lockdown (audit §4.1–§4.3).
 *
 * Pins three things:
 *  1. THE BUILDER. `loginPathWithNext` (lib/auth-next.ts) is the one
 *     shared helper the GuestGate and ProtectedRoute both build their
 *     sign-in bounces from: path + query preserved and encoded, and it
 *     only ever emits a same-origin relative target — the receiving
 *     end (postLoginPath / safeNextPath, pinned by handoff-sweep)
 *     round-trips it verbatim.
 *  2. THE GATE WIRING (source pins, the house pattern — vitest here is
 *     node-env with no DOM harness). AppShell mounts GuestGate around
 *     the whole routed tree (both Switches); the gate judges auth
 *     loading BEFORE the allowlist (house loader, never a flash of
 *     page content or login form), consults isPublicPath, and bounces
 *     through the shared builder. No bare "/login" redirect remains in
 *     the gate or in ProtectedRoute.
 *  3. SIGNUP PARITY. A guest bounced from a locked page who creates an
 *     account lands where they were headed: signup honors ?next= via
 *     postLoginPath, and both auth pages carry ?next= across the
 *     sign-in ⇄ sign-up link hop instead of dropping it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loginPathWithNext, postLoginPath, safeNextPath } from "../lib/auth-next";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const gateSource = read("./GuestGate.tsx");
const protectedRouteSource = read("./ProtectedRoute.tsx");
const appSource = read("../App.tsx");
const siteModeSource = read("./site-mode/SiteMode.tsx");
const signupSource = read("../pages/signup.tsx");
const loginSource = read("../pages/login.tsx");

describe("loginPathWithNext — the shared bounce builder", () => {
  it("preserves path + query, encoded as one ?next= value", () => {
    expect(loginPathWithNext("/dashboard")).toBe("/login?next=%2Fdashboard");
    expect(loginPathWithNext("/earnings", "range=30d&tab=payouts")).toBe(
      "/login?next=%2Fearnings%3Frange%3D30d%26tab%3Dpayouts",
    );
    // wouter's useSearch returns the query bare; a leading "?" is accepted too.
    expect(loginPathWithNext("/earnings", "?range=30d")).toBe(
      "/login?next=%2Fearnings%3Frange%3D30d",
    );
  });

  it("handles the root path", () => {
    expect(loginPathWithNext("/")).toBe("/login?next=%2F");
  });

  it("carries an already-public destination verbatim (documented design)", () => {
    // The builder is allowlist-agnostic by design: callers decide
    // whether a bounce is needed, and carrying a public destination is
    // the existing /presave + /unlock precedent. Only /login collapses.
    expect(loginPathWithNext("/presave/my-song")).toBe("/login?next=%2Fpresave%2Fmy-song");
    expect(loginPathWithNext("/world")).toBe("/login?next=%2Fworld");
  });

  it("collapses the login screen itself — a bounce never nests ?next=/login", () => {
    expect(loginPathWithNext("/login")).toBe("/login");
    expect(loginPathWithNext("/login", "next=%2Fdashboard")).toBe("/login");
  });

  it("collapses hostile destinations to bare /login — no absolute URL can ride ?next=", () => {
    expect(loginPathWithNext("https://evil.example/phish")).toBe("/login");
    expect(loginPathWithNext("//evil.example/phish")).toBe("/login");
    expect(loginPathWithNext("/\\evil.example")).toBe("/login");
    expect(loginPathWithNext("javascript:alert(1)")).toBe("/login");
    expect(loginPathWithNext("")).toBe("/login");
  });

  it("only ever emits a same-origin relative target", () => {
    const built = loginPathWithNext("/store/buy/track/42", "qty=1");
    expect(built.startsWith("/login?next=")).toBe(true);
    expect(built).not.toContain("://");
    const next = new URLSearchParams(built.slice(built.indexOf("?"))).get("next");
    expect(next).toBe("/store/buy/track/42?qty=1");
  });

  it("round-trips through the shipped receiver (postLoginPath / safeNextPath)", () => {
    const cases: Array<[string, string | undefined, string]> = [
      ["/dashboard", undefined, "/dashboard"],
      ["/earnings", "range=30d", "/earnings?range=30d"],
      ["/presave/x", "ref=ABC", "/presave/x?ref=ABC"],
      ["/", undefined, "/"],
    ];
    for (const [pathname, search, destination] of cases) {
      const built = loginPathWithNext(pathname, search);
      const builtSearch = built.slice(built.indexOf("?"));
      expect(safeNextPath(builtSearch)).toBe(destination);
      expect(postLoginPath(builtSearch)).toBe(destination);
    }
  });
});

describe("GuestGate — the AppShell choke point (audit §4.1)", () => {
  it("reads auth from useAuth and the live location from wouter", () => {
    expect(gateSource).toContain('import { useAuth } from "@/contexts/AuthContext"');
    expect(gateSource).toContain("const { user, loading } = useAuth();");
    expect(gateSource).toContain('import { Redirect, useLocation, useSearch } from "wouter";');
    expect(gateSource).toContain("const [location] = useLocation();");
    expect(gateSource).toContain("const search = useSearch();");
  });

  it("renders the house loader while auth is loading — judged BEFORE the allowlist", () => {
    expect(gateSource).toContain('import WittyLoader from "@/components/delight/witty-loader";');
    expect(gateSource).toMatch(/if \(loading\) \{\s*return <WittyLoader \/>;\s*\}/);
    const loaderAt = gateSource.indexOf("if (loading)");
    const allowlistAt = gateSource.indexOf("isPublicPath(location)");
    expect(loaderAt).toBeGreaterThan(-1);
    expect(allowlistAt).toBeGreaterThan(loaderAt);
  });

  it("consults the Lane 1 allowlist and bounces signed-out guests via the shared builder", () => {
    expect(gateSource).toContain('import { isPublicPath } from "@/lib/public-routes";');
    expect(gateSource).toContain("if (isPublicPath(location))");
    expect(gateSource).toContain('import { loginPathWithNext } from "@/lib/auth-next";');
    expect(gateSource).toContain("<Redirect to={loginPathWithNext(location, search)} />");
  });

  it("has no bare /login redirect and no path special cases (the allowlist decides)", () => {
    expect(gateSource).not.toContain('to="/login"');
    expect(gateSource).not.toContain('location === "/"');
    expect(gateSource).not.toContain('location === "/world"');
  });

  it("is mounted in AppShell around the whole routed tree — both Switches", () => {
    expect(appSource).toContain('import { GuestGate } from "@/components/GuestGate";');
    const gateOpen = appSource.indexOf("<GuestGate>");
    const gateClose = appSource.indexOf("</GuestGate>");
    expect(gateOpen).toBeGreaterThan(-1);
    expect(appSource.indexOf("<Switch>")).toBeGreaterThan(gateOpen);
    expect(gateClose).toBeGreaterThan(appSource.lastIndexOf("</Switch>"));
  });

  it("adds no routes of its own (the census in public-routes.test.ts still owns the table)", () => {
    expect(gateSource).not.toContain("<Route");
    expect(appSource.match(/<GuestGate>/g)).toHaveLength(1);
  });

  it("leaves SiteMode structurally exempt — the gate lives inside AppShell only", () => {
    // SiteModeGate renders INSTEAD of AppShell on creator custom domains.
    expect(appSource).toMatch(/<SiteModeGate>\s*<AppShell \/>\s*<\/SiteModeGate>/);
    expect(siteModeSource).not.toContain("GuestGate");
  });
});

describe("ProtectedRoute — same builder, no destination dropped (audit §4.2)", () => {
  it("builds its signed-out redirect via the shared helper from the live location", () => {
    expect(protectedRouteSource).toContain('import { loginPathWithNext } from "@/lib/auth-next";');
    expect(protectedRouteSource).toContain("const [location] = useLocation();");
    expect(protectedRouteSource).toContain("const search = useSearch();");
    expect(protectedRouteSource).toContain("<Redirect to={loginPathWithNext(location, search)} />");
  });

  it("no bare /login redirect remains", () => {
    expect(protectedRouteSource).not.toContain('to="/login"');
  });

  it("keeps its existing loader behavior while auth resolves", () => {
    expect(protectedRouteSource).toContain("if (loading || !barcodeDone)");
    expect(protectedRouteSource).toContain("<WittyLoader onComplete={() => setBarcodeDone(true)} />");
  });
});

describe("signup parity — a bounced guest who creates an account lands where they were headed", () => {
  it("signup's signed-in path routes through postLoginPath, like login", () => {
    expect(signupSource).toContain('from "@/lib/auth-next"');
    expect(signupSource).toContain("setLocation(postLoginPath(window.location.search))");
    expect(signupSource).not.toContain('setLocation("/choose-artist")');
  });

  it("signup's success handoff to sign-in carries ?next= via the shared builder", () => {
    expect(signupSource).toContain("loginPathWithNext(next)");
    expect(signupSource).toContain("onClick={goToSignIn}");
    expect(signupSource).not.toContain('setLocation("/login")');
    expect(signupSource).toContain("<Link href={signInHref}");
  });

  it("login's sign-up link carries ?next= across the hop (and postLoginPath's pinned import is untouched)", () => {
    expect(loginSource).toContain('import { postLoginPath } from "@/lib/auth-next";');
    expect(loginSource).toContain("`/signup?next=${encodeURIComponent(next)}`");
    expect(loginSource).toContain("<Link href={signupHref}");
  });
});
