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
   responses are never modified. Only intervenes on auth failures.

   ANONYMOUS VISITORS ARE NEVER INTERVENED ON: session death requires a
   session. When nobody is signed in (hooks.isSignedIn() === false), a
   401/403 is returned untouched — public pages call auth-gated endpoints
   all the time, and bouncing signed-out visitors to /login for them
   walls off the entire public site. */

interface SessionHooks {
  getClient: () => SupabaseClient | null;
  onSessionDead: () => void;
  /** True while the app believes a user is signed in. Session death can
   *  only happen to someone who HAS a session — an anonymous visitor's
   *  401 from an auth-gated endpoint is not a dead session. */
  isSignedIn?: () => boolean;
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

/** True when the response is the password GATE's lock answer, not an
 *  auth answer at all. The gate (api-server lib/staging-gate) replies
 *  401 { error: "staging_locked" } to every API request when its
 *  cookie is absent — a different lock than the Supabase session,
 *  with a different remedy (re-enter the password, not re-sign-in).
 *  This check runs BEFORE all session classification, by body code
 *  rather than by message text, so the exemption can never be lost
 *  to a copy edit: a gate 401 must never trigger a token refresh
 *  (which cannot mint a gate cookie) and must never be read as
 *  session death — Gate #4 watched exactly that compound present as
 *  "the gate dropped my signed-in session". */
async function isGateLockedResponse(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { error?: unknown } | null;
    return body?.error === "staging_locked";
  } catch {
    return false;
  }
}

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

/* ─── The gate remedy (stack1300 staging-gate-api) ─────────────────────
   isGateLockedResponse has always named the remedy — "re-enter the
   password, not re-sign-in" — but the guard stopped at detection and
   handed the locked answer back to surfaces that improvised badly:
   Buy buttons printed the gate's raw message as a checkout error,
   and /creator-pricing read the failed plans load as "price coming
   soon". The pass falls out in a perfectly ordinary way: a DELIBERATE
   app sign-out drops it (AuthContext signOut → /__staging_logout,
   by design since stack800), and the SPA sign-in that follows never
   re-presents the gate form, so the app sits signed-in while every
   API call is locked.

   The remedy is a HARD navigation to the gate's login path: the
   server-rendered form is the only place the pass is established,
   and after it the browser returns to / with the cookie set and the
   Supabase session (localStorage) untouched — the same session's
   own API calls then carry the pass and succeed. The gate itself is
   not weakened by one inch: strangers still get this same 401, and
   only presenting the real password at the form mints the cookie.

   Bounded, so a pass that cannot stick can never become a loop:
   once per page lifetime, and not again within the latch interval
   across page loads (sessionStorage timestamp). Production never
   emits staging_locked (no STAGING_PASSWORD → the gate is a no-op),
   so this code can never fire there. */
const GATE_LOGIN_PATH = "/__staging_login";
const GATE_REDIRECT_LATCH_KEY = "bdv_gate_redirect_at";
const GATE_REDIRECT_MIN_INTERVAL_MS = 30_000;
let gateRedirectFired = false;

function redirectToGateLogin(): void {
  if (gateRedirectFired) return;
  try {
    const last = Number(window.sessionStorage?.getItem(GATE_REDIRECT_LATCH_KEY) ?? 0);
    if (Number.isFinite(last) && last > 0 && Date.now() - last < GATE_REDIRECT_MIN_INTERVAL_MS) return;
  } catch {
    /* Storage unreadable — the per-page-lifetime latch still bounds us. */
  }
  gateRedirectFired = true;
  try {
    window.sessionStorage?.setItem(GATE_REDIRECT_LATCH_KEY, String(Date.now()));
  } catch {
    /* Best effort — the latch above already fired for this page. */
  }
  try {
    window.location.href = GATE_LOGIN_PATH;
  } catch {
    /* A navigation failure must never break the caller's response. */
  }
}

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
    /* The password gate's lock is not a session failure — no refresh,
       no death, whatever the body copy says (see isGateLockedResponse).
       But detection alone left every surface improvising; apply the
       remedy the classification always named and send the browser
       back to the password form (see redirectToGateLogin). */
    if (await isGateLockedResponse(res)) {
      redirectToGateLogin();
      return res;
    }
    if (!(await isSessionError(res))) return res;

    /* Anonymous pass-through: session death requires a session. Public
     * pages fire /api calls that legitimately answer 401 for signed-out
     * visitors (auth-gated data on the homepage, explore, winners,
     * artist profiles…). Treating those as a dead session bounced every
     * logged-out visitor to /login and walled off the public site.
     * Only run the refresh/death path when the app believes someone is
     * signed in; everyone else just receives the response as-is. */
    if (hooks?.isSignedIn && !hooks.isSignedIn()) return res;

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
          /* A gate lock answering the retry is still not session
           * death — the gate dropped between the first answer and
           * the retry, and no token can fix that. Same remedy as the
           * first-answer lock: back to the password form. */
          if (await isGateLockedResponse(retryRes)) {
            redirectToGateLogin();
            return retryRes;
          }
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
