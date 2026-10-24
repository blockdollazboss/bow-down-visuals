import type { ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { resolveGateVerdict } from "@/lib/guest-gate-verdict";
import WittyLoader from "@/components/delight/witty-loader";

/**
 * GuestGate — the access law's single choke point (access lockdown
 * Lane 2; audit §4.1). Mounted in AppShell around the whole routed
 * tree (both Switches), so it judges every navigation at the shell
 * level instead of relying on per-route guards — the per-page patching
 * is how unguarded routes kept slipping through. Default-deny: a path
 * is guest-reachable only when lib/public-routes.ts says so.
 *
 * The DECISION lives in lib/guest-gate-verdict.ts (resolveGateVerdict)
 * as a pure function; this component is the thin shell that renders
 * it. Behavior, in order:
 *  - Auth still resolving → the house loader (the same WittyLoader
 *    ProtectedRoute shows while auth resolves). Page content and the
 *    login form both stay hidden until the verdict is in — no flash
 *    of either.
 *  - Redirect aliases resolve FIRST for EVERY session, signed in or
 *    out (driven by ROUTE_MATRIX): the visitor is handed to the alias
 *    target and the gate re-judges there, so the verdict — render or
 *    bounce — is always the target's, never the alias's (fix
 *    2026-10-18: this gate wraps both Switches, so judging the alias
 *    path itself bounced guests to /login?next=<alias> before the
 *    router's redirect could run). The signed-in half is the
 *    2026-10-24 fix: post-push live verification found
 *    /sponsor-dashboard, /tip-page, /challenge and /albums rendering
 *    the SPA 404 on direct load for a signed-in session — the matrix
 *    promised the redirects and App.tsx carries alias routes for
 *    them, but on the signed-in path nothing performed the redirect
 *    (the gate returned children untouched and the router fell
 *    through to the catch-all). The alias step therefore lives in
 *    the verdict, above the auth branch, where it cannot be skipped.
 *  - Signed in (non-alias) → children untouched.
 *  - Signed out on a public path → children.
 *  - Signed out anywhere else → /login?next=<path + query>, built by
 *    the shared loginPathWithNext so the visitor lands back where
 *    they were headed after sign-in (audit §4.2).
 *
 * The gate re-judges on every wouter location change (it reads the
 * live location via hooks, so it re-renders per navigation), which is
 * what makes the alias step work: the hand-off changes the location,
 * and the same check runs again at the target. No alias path is
 * hardcoded here — the matrix is the single source — and neither are
 * "/" or "/world" (they are public through the allowlist, not
 * through this component).
 *
 * SiteMode (creator custom domains) is structurally exempt: SiteModeGate
 * renders INSTEAD of AppShell on those hosts, and this gate lives only
 * inside AppShell — no gate logic belongs in SiteMode.
 */
export function GuestGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  const search = useSearch();

  const verdict = resolveGateVerdict(location, search, { user, loading });

  if (verdict.kind === "loading") {
    return <WittyLoader />;
  }

  if (verdict.kind === "redirect") {
    return <Redirect to={verdict.to} />;
  }

  return <>{children}</>;
}
