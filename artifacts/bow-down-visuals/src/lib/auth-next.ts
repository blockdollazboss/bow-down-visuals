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

/* The auth screens themselves are never a return destination. A
 * freshly signed-in user handed back to a sign-in screen is at best a
 * loop — and /sign-in is not even a route (it renders the catch-all
 * 404 inside the sidebar layout). That exact handoff shipped a live
 * 404: a guest who typed /sign-in was bounced to
 * /login?next=%2Fsign-in by the gate, signed in, and landed on the
 * 404 (payments gate re-run #2, Oct 28). Both halves of the handoff
 * reject these paths: the builder never emits them, the receiver
 * never honors them. */
const AUTH_SCREEN_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/signup",
  "/sign-in",
  "/qr-login",
  "/reset-password",
]);

/** True when a destination (path, optionally with query/hash) is one
 *  of the auth screens — compared on the bare path, trailing slash
 *  tolerated, the same normalization the builder already applies. */
export function isAuthScreenPath(destination: string): boolean {
  let path = destination.split(/[?#]/)[0] ?? "";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return AUTH_SCREEN_PATHS.has(path);
}

/** The validated ?next= target from a query string, or null. */
export function safeNextPath(search: string): string | null {
  try {
    const next = new URLSearchParams(search).get("next");
    if (!next) return null;
    if (!next.startsWith("/") || next.startsWith("//")) return null;
    if (next.includes("\\")) return null;
    if (isAuthScreenPath(next)) return null;
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
 *  already do by hand. The destinations that collapse are the auth
 *  screens themselves (/login, /signup, /sign-in, /qr-login,
 *  /reset-password): a bounce from a sign-in screen must never nest
 *  ?next=/login inside itself, and /sign-in — the natural URL a
 *  visitor types for the sign-in screen — is not a route at all, so
 *  carrying it would hand the freshly signed-in user a 404. */
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
  if (isAuthScreenPath(destination)) return "/login";
  return `/login?next=${encodeURIComponent(destination)}`;
}
