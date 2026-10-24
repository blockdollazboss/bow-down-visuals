/**
 * guest-gate-verdict.ts — GuestGate's decision, as a pure function.
 *
 * Extracted from GuestGate.tsx (Oct 24 2026) so the BEHAVIOR is
 * testable in this repo's node-env suite (which cannot transform
 * .tsx): GuestGate is now a thin shell that renders exactly what
 * this function decides, and guest-gate-alias-behavior.test.ts
 * drives every matrix alias through it in both auth states.
 *
 * Order is the whole point:
 *  1. loading — never judge a session that is still resolving.
 *  2. ALIAS — a ROUTE_MATRIX "redirect" disposition resolves for
 *     EVERY session, signed in or out. (Live-verified gap Oct 24:
 *     /sponsor-dashboard, /tip-page, /challenge, /albums rendered the
 *     SPA 404 on direct load signed-in, because the gate used to
 *     return children untouched for signed-in users and nothing else
 *     performed the redirect on that path.)
 *  3. signed-in → the app.
 *  4. signed-out on a public/apex path → the app (marketing surface).
 *  5. signed-out anywhere else → /login?next=<here>.
 */
import { isPublicPath, resolveRouteRedirect } from "./public-routes";
import { loginPathWithNext } from "./auth-next";

export type GateVerdict =
  | { kind: "loading" }
  | { kind: "redirect"; to: string }
  | { kind: "children" };

export interface GateSession {
  user: unknown;
  loading: boolean;
}

export function resolveGateVerdict(
  location: string,
  search: string,
  session: GateSession,
): GateVerdict {
  if (session.loading) {
    return { kind: "loading" };
  }

  const aliasTarget = resolveRouteRedirect(location);
  if (aliasTarget) {
    return { kind: "redirect", to: aliasTarget };
  }

  if (session.user) {
    return { kind: "children" };
  }

  if (isPublicPath(location)) {
    return { kind: "children" };
  }

  return { kind: "redirect", to: loginPathWithNext(location, search) };
}
