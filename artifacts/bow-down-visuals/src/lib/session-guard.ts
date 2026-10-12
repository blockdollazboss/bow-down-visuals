import type { SupabaseClient } from "@supabase/supabase-js";

/* ─── Global session-death guard ────────────────────────────────────────────
   Installs once (from AuthProvider). Wraps window.fetch for same-origin
   /api/* requests:

   1. A 401 — or a 403 whose body smells like a session problem
      ("session", "unauthorized", "token", "expired", …) — triggers ONE
      Supabase token refresh + a single retry of the original request.
   2. If the refresh fails or the retry is still 401/403, the session is
      truly dead: onSessionDead() clears local auth state and bounces the
      user to /login with a "session expired" notice. No more zombie
      signed-in-looking UI with every API call failing.

   Legitimate non-auth 403s (tier gates, permission errors like
   "Only the crew leads…") pass through untouched. Normal 2xx/4xx/5xx
   responses are never modified. Only intervenes on auth failures. */

interface SessionHooks {
  getClient: () => SupabaseClient | null;
  onSessionDead: () => void;
}

let hooks: SessionHooks | null = null;
let installed = false;
let deathNotified = false;

/** Called by AuthProvider on mount (and cleared on unmount). */
export function registerSessionHooks(h: SessionHooks | null) {
  hooks = h;
  if (h) deathNotified = false;
}

const SESSION_ERROR_RE = /session|unauthori|not authenticated|invalid jwt|jwt expired|token|expired/i;

/** True when a 401/403 response body indicates a dead/invalid session. */
async function isSessionError(res: Response): Promise<boolean> {
  try {
    const clone = res.clone();
    const body = await clone.json();
    const msg = String(body?.error ?? body?.message ?? "");
    return msg.length > 0 && SESSION_ERROR_RE.test(msg);
  } catch {
    /* Non-JSON or empty body. A bare 401 from our API is still near-certain
       to be auth; a bare 403 is not (could be anything) — stay conservative. */
    return res.status === 401;
  }
}

function isOurApi(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** Requests already retried once — never intercept again (no retry loops). */
const retried = new WeakSet<Request>();

function notifySessionDead() {
  if (deathNotified) return;
  deathNotified = true;
  try {
    hooks?.onSessionDead();
  } catch {
    /* onSessionDead navigates away; never let it break the caller */
  }
}

/** Patches window.fetch. Safe to call once; subsequent calls are no-ops. */
export function installSessionGuard() {
  if (installed || typeof window === "undefined" || !window.fetch) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Normalize to a Request for inspection; bail out untouched on failure.
    let req: Request | null = null;
    if (isOurApi(input)) {
      try {
        req = input instanceof Request ? input : new Request(input, init);
      } catch {
        req = null;
      }
    }
    if (!req || retried.has(req)) {
      return originalFetch(input, init);
    }

    const res = await originalFetch(input, init);
    if (res.status !== 401 && res.status !== 403) return res;
    if (!(await isSessionError(res))) return res;

    /* Auth failure on our API — attempt one refresh, then retry once. */
    const client = hooks?.getClient?.() ?? null;
    if (!client) return res;

    try {
      const { data, error } = await client.auth.refreshSession();
      const freshToken = !error ? data.session?.access_token : null;
      if (freshToken) {
        const retryHeaders = new Headers(req.headers);
        retryHeaders.set("Authorization", `Bearer ${freshToken}`);
        const retryReq = new Request(req, { headers: retryHeaders });
        retried.add(retryReq);
        const retryRes = await originalFetch(retryReq);
        if (retryRes.status === 401 || retryRes.status === 403) {
          /* Fresh token still rejected — session is truly dead. */
          notifySessionDead();
        }
        return retryRes;
      }
    } catch {
      /* refresh threw — treat as dead below */
    }

    notifySessionDead();
    return res;
  }) as typeof window.fetch;
}
