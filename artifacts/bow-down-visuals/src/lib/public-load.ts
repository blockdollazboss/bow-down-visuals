/* ─── Public slug-page load discipline (Stack-28 #29 / A3-F7) ───────
   The pattern pages/artist-public.tsx and pages/showcase/item.tsx
   already follow, named once for the whole public family:

   - "not found" is reserved for a genuine HTTP 404 ONLY — the server
     404s solely for a missing/unpublished resource.
   - Every other failure (500, a non-OK payload, a dropped connection)
     is a LOAD ERROR: a distinct error state with Retry. Telling a fan
     a creator's page "doesn't exist" because the server hiccupped is
     the false-not-found bug this module exists to prevent.
   - A 200 whose payload is missing its expected resource is a
     malformed answer, i.e. also a load error — never not-found. */

export type PublicLoadOutcome = "ok" | "not-found" | "error";

/** Classify a settled public-page fetch.
 *  `status` is the HTTP status (null when the fetch itself rejected —
 *  a network failure); `hasPayload` says whether the expected resource
 *  was present in a parsed body. */
export function publicLoadOutcome(
  status: number | null | undefined,
  hasPayload: boolean,
): PublicLoadOutcome {
  if (status === 404) return "not-found";
  if (status == null || status < 200 || status >= 300) return "error";
  return hasPayload ? "ok" : "error";
}

/** True only for the one status allowed to render a not-found state. */
export function isNotFoundStatus(status: number | null | undefined): boolean {
  return status === 404;
}
