import { Redirect } from "wouter";

/* Query-preserving redirect for the unified /create page (and any other
 * tabbed-page consolidation). wouter's <Redirect> takes a static string, so a
 * plain <Redirect to="/create?panel=song"> would silently drop the incoming
 * deep-link params (/make-song?mode=inspo, /make-video?sound=…, …) and the
 * ?moved_from= wayfinding param — this merges the incoming search string onto
 * the target before redirecting.
 *
 * Kept in its own tiny module (no page imports) so App.tsx can import it
 * directly without eagerly pulling the Create page bundle. */
export function CreateRedirect({ to }: { to: string }) {
  let dest = to;
  try {
    const search = window.location.search;
    if (search.length > 1) {
      dest = to.includes("?") ? `${to}&${search.slice(1)}` : `${to}${search}`;
    }
  } catch {
    /* non-browser — fall back to the bare target */
  }
  return <Redirect to={dest} />;
}
