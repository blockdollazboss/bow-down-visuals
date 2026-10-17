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
