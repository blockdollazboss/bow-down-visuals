import type { ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { isPublicPath } from "@/lib/public-routes";
import { loginPathWithNext } from "@/lib/auth-next";
import WittyLoader from "@/components/delight/witty-loader";

/**
 * GuestGate — the access law's single choke point (access lockdown
 * Lane 2; audit §4.1). Mounted in AppShell around the whole routed
 * tree (both Switches), so it judges every navigation at the shell
 * level instead of relying on per-route guards — the per-page patching
 * is how unguarded routes kept slipping through. Default-deny: a path
 * is guest-reachable only when lib/public-routes.ts says so.
 *
 * Behavior:
 *  - Auth still resolving → the house loader (the same WittyLoader
 *    ProtectedRoute shows while auth resolves). Page content and the
 *    login form both stay hidden until the verdict is in — no flash
 *    of either.
 *  - Signed in → children untouched.
 *  - Signed out on a public path → children.
 *  - Signed out anywhere else → /login?next=<path + query>, built by
 *    the shared loginPathWithNext so the visitor lands back where
 *    they were headed after sign-in (audit §4.2).
 *
 * The gate re-judges on every wouter location change (it reads the
 * live location via hooks, so it re-renders per navigation); redirect
 * aliases re-enter the same check at their target naturally — no
 * alias is special-cased here, and neither are "/" or "/world" (they
 * are public through the allowlist, not through this component).
 *
 * SiteMode (creator custom domains) is structurally exempt: SiteModeGate
 * renders INSTEAD of AppShell on those hosts, and this gate lives only
 * inside AppShell — no gate logic belongs in SiteMode.
 */
export function GuestGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  const search = useSearch();

  if (loading) {
    return <WittyLoader />;
  }

  if (user) {
    return <>{children}</>;
  }

  if (isPublicPath(location)) {
    return <>{children}</>;
  }

  return <Redirect to={loginPathWithNext(location, search)} />;
}
