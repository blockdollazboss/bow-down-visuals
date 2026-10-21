/* Post-login return path — the /login?next= handoff.
 *
 * Surfaces that bounce a signed-out visitor to login carry where they
 * were headed: the pre-save page and the unlock page send
 * /login?next=/presave/<slug> and /login?next=/unlock/<slug> so the
 * visitor lands back on the thing they came for. The login page
 * historically never read the param — every one of those visitors
 * landed on the default destination instead.
 *
 * The value is honored ONLY as a same-origin relative path: anything
 * absolute, protocol-relative, or backslash-smuggled is rejected, so
 * the param can never become an open redirect. */

export const DEFAULT_POST_LOGIN_PATH = "/choose-artist";

/** The validated ?next= target from a query string, or null. */
export function safeNextPath(search: string): string | null {
  try {
    const next = new URLSearchParams(search).get("next");
    if (!next) return null;
    if (!next.startsWith("/") || next.startsWith("//")) return null;
    if (next.includes("\\")) return null;
    return next.slice(0, 500);
  } catch {
    return null;
  }
}

/** Where to send a freshly signed-in user: their ?next= when valid,
 *  the default post-login destination otherwise. */
export function postLoginPath(search: string): string {
  return safeNextPath(search) ?? DEFAULT_POST_LOGIN_PATH;
}

/** Build the /login URL that bounces a signed-out visitor to sign-in
 *  carrying where they were headed — the sending half of the contract
 *  above (the GuestGate and ProtectedRoute both build their redirects
 *  here, so the two can never drift). `search` is the destination's
 *  query string, with or without its leading "?" (wouter's useSearch
 *  returns it bare).
 *
 *  The builder only ever emits a same-origin relative target: the
 *  destination is validated with the same rules safeNextPath applies
 *  on the receiving end, and anything hostile (absolute, protocol-
 *  relative, backslash-smuggled, or not a path at all) collapses to
 *  bare "/login" instead of riding into ?next=. It deliberately does
 *  NOT consult the public-route allowlist — carrying a public
 *  destination is harmless and is exactly what /presave and /unlock
 *  already do by hand. The one destination that collapses is /login
 *  itself: a bounce from the sign-in screen must never nest
 *  ?next=/login inside itself. */
export function loginPathWithNext(pathname: string, search?: string): string {
  const query = search ? (search.startsWith("?") ? search.slice(1) : search) : "";
  const destination = query ? `${pathname}?${query}` : pathname;
  if (
    !destination.startsWith("/") ||
    destination.startsWith("//") ||
    destination.includes("\\")
  ) {
    return "/login";
  }
  if (destination.split(/[?#]/)[0] === "/login") return "/login";
  return `/login?next=${encodeURIComponent(destination)}`;
}
