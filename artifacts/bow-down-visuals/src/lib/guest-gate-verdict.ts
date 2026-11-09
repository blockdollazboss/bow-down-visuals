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
import { CATCH_ALL_PATH, ROUTE_MATRIX } from "./public-routes";
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

/* ------------------------------------------------------------------ */
/* C-14 (Stack 400) — the held verdict + the registered-route check.   */
/*                                                                     */
/* The staging-wake failure this closes: while a session is still     */
/* resolving, the verdict above answers "loading" on EVERY auth-state */
/* flip, so the routed tree the gate finally released was assembled   */
/* across flips — and a render pass evaluated against a mid-flip      */
/* location could fall through to the router's catch-all 404 for a    */
/* page that exists (the transient /tools/* 404s of Nov 8). Two       */
/* halves, one in the gate and one in the catch-all:                  */
/*                                                                     */
/*  (a) holdGateVerdict — once a location has a SETTLED verdict, a    */
/*      later re-resolution holds that verdict instead of dropping    */
/*      back to the loader and re-judging from scratch, so the tree   */
/*      stays mounted on the page it already judged. A verdict is     */
/*      held only for the exact location it was reached at: a         */
/*      navigation re-judges fresh, and the very first load (nothing  */
/*      settled yet) still shows the loader.                          */
/*                                                                     */
/*  (b) isRegisteredRoutePath — the catch-all's re-check in App.tsx:  */
/*      a path the route matrix registers IS a real page, so the      */
/*      catch-all must not paint the 404 for it. The census in        */
/*      public-routes.test.ts pins the matrix to App.tsx's declared   */
/*      routes in both directions, so "registered" here means "a      */
/*      route the router matches once it evaluates the settled        */
/*      location" — the fallback it shows instead is transient by     */
/*      construction. A genuinely unknown path is not registered      */
/*      and keeps the honest 404.                                     */
/* ------------------------------------------------------------------ */

/** The gate's memory: the last settled verdict, and where it was reached. */
export interface HeldGateState {
  /** The location the held verdict was reached at ("" before any). */
  location: string;
  /** The last settled (non-loading) verdict for that location. */
  verdict: GateVerdict | null;
}

export const INITIAL_HELD_GATE_STATE: HeldGateState = { location: "", verdict: null };

function gateVerdictsEqual(a: GateVerdict | null, b: GateVerdict): boolean {
  if (a === null || a.kind !== b.kind) return false;
  if (a.kind === "redirect" || b.kind === "redirect") {
    return a.kind === "redirect" && b.kind === "redirect" && a.to === b.to;
  }
  return true;
}

/**
 * Fold a fresh verdict into the gate's memory and decide what renders.
 *
 * - A settled (non-loading) fresh verdict replaces the memory for its
 *   location and renders as-is. When it equals what is already held,
 *   the SAME state object comes back, so a caller storing it in React
 *   state can tell nothing changed.
 * - A loading fresh verdict renders the HELD verdict when one exists
 *   for this exact location — the re-resolution changes nothing the
 *   visitor sees — and renders the loader only when nothing has
 *   settled here yet.
 */
export function holdGateVerdict(
  state: HeldGateState,
  location: string,
  fresh: GateVerdict,
): { state: HeldGateState; verdict: GateVerdict } {
  if (fresh.kind !== "loading") {
    if (state.location === location && gateVerdictsEqual(state.verdict, fresh)) {
      return { state, verdict: fresh };
    }
    return { state: { location, verdict: fresh }, verdict: fresh };
  }
  if (state.verdict !== null && state.location === location) {
    return { state, verdict: state.verdict };
  }
  return { state, verdict: fresh };
}

/** Segment match against one matrix pattern (`:param` = one non-empty segment). */
function matrixPatternMatches(pattern: string, pathSegments: string[]): boolean {
  const patternSegments = pattern === "/" ? [] : pattern.slice(1).split("/");
  if (patternSegments.length !== pathSegments.length) return false;
  for (let i = 0; i < patternSegments.length; i += 1) {
    const want = patternSegments[i]!;
    const got = pathSegments[i]!;
    if (want.startsWith(":")) {
      if (got.length === 0) return false;
    } else if (want !== got) {
      return false;
    }
  }
  return true;
}

/**
 * Is `pathname` a route the app actually declares? Judged against
 * ROUTE_MATRIX (the census-pinned mirror of App.tsx's route table),
 * with the same tolerances as the matchers above: query/hash ignored,
 * one trailing slash tolerated, segment-exact with `:param` support,
 * and anything malformed (no leading slash, empty segments,
 * protocol-relative "//…") is not a route — default-deny, so the
 * catch-all keeps the honest 404 for it. The catch-all's own matrix
 * entry is excluded: "*" names the 404 itself, not a page.
 */
export function isRegisteredRoutePath(pathname: string): boolean {
  if (typeof pathname !== "string" || pathname.length === 0) return false;
  let path = pathname;
  const queryAt = path.search(/[?#]/);
  if (queryAt !== -1) path = path.slice(0, queryAt);
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const segments = path === "/" ? [] : path.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) return false;
  return ROUTE_MATRIX.some(
    (entry) => entry.path !== CATCH_ALL_PATH && matrixPatternMatches(entry.path, segments),
  );
}
