/**
 * boundary-report.ts — self-reporting + one-shot recovery for the
 * RouteErrorBoundary ("The vault guards tripped.").
 *
 * Why this exists (vault-guards diagnosis, Oct 28 2026): the boundary
 * tripped on the owner twice in one day (stack400 ~08:11, stack500
 * 16:17 — hours after that deploy settled, so deploy skew alone does
 * not explain it) and the ONLY record was a console.error in the
 * owner's own browser. No route, no error, no server trace: the trip
 * was undiagnosable by construction. This module is the fix for the
 * blindness, split out of App.tsx (same pattern as
 * settings-card-boundary.ts / theme-probe.ts) so the node test harness
 * can drive it with injected transports and storage:
 *
 *   1. buildBoundaryReport — a small, PII-free trip report: route
 *      PATH only (no query string, no hash — those can carry tokens),
 *      error name + truncated message, whether the error looks like a
 *      chunk-load failure, the build identifier when the bundle
 *      carries one (VITE_BUILD_ID — currently unset in the build, so
 *      null; the field exists so the day the build stamps it, trips
 *      start naming their build with no client change), timestamp.
 *   2. reportBoundaryTrip — fire-and-forget delivery to
 *      POST /api/client-errors (sendBeacon first, fetch keepalive as
 *      fallback). It NEVER throws: telemetry must not be able to break
 *      the boundary that reports through it.
 *   3. tryChunkAutoReload — ONE automatic reload for chunk-shaped
 *      errors, guarded by a sessionStorage flag. Chunk failures are a
 *      proven vector here: every route chunk is served by the same
 *      single server process that provably restarts under export load
 *      (four boots in four minutes during Gate #3), a restart window
 *      fails in-flight chunk fetches on a fully settled build, and a
 *      rejected React.lazy import stays rejected for the session —
 *      so a transient chunk failure otherwise sits on the boundary
 *      screen until a human taps "Try again". The reload is the tap,
 *      automated — once. The flag is cleared by the boundary when it
 *      mounts with no error (a healthy render happened), so a later,
 *      separate trip can recover again, while a chunk that is STILL
 *      failing after the reload mounts the boundary already tripped
 *      (flag never cleared) and can never loop.
 */

export const BOUNDARY_REPORT_PATH = "/api/client-errors";

/** sessionStorage key for the one-shot chunk auto-reload guard. */
export const CHUNK_RELOAD_FLAG = "bdv.route-boundary.chunk-reload";

export interface BoundaryTripReport {
  /** Route path only — never the query string or hash. */
  route: string;
  errorName: string;
  /** Truncated to 500 chars — enough to name the failure, never a dump. */
  errorMessage: string;
  /** The error matches a known chunk-load failure shape. */
  chunkLike: boolean;
  /** Build identifier when the bundle carries one, else null. */
  build: string | null;
  /** ISO timestamp of the trip. */
  ts: string;
}

const ROUTE_MAX = 200;
const NAME_MAX = 100;
const MESSAGE_MAX = 500;
const BUILD_MAX = 100;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Chunk-load failure shapes across browsers (and the webpack-style
 * name older bundles used). A dynamic import that fails because the
 * chunk file 404'd, was served the SPA fallback's HTML, or died with
 * the server mid-restart surfaces as one of these — distinct from an
 * ordinary render throw, and the only class the auto-reload can heal.
 */
const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  /chunkloaderror/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /failed to load module script/i,
  /loading chunk \S+ failed/i,
  /unable to preload css/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (typeof name === "string" && /chunkloaderror/i.test(name)) return true;
  const message = (error as { message?: unknown }).message;
  const text = typeof message === "string" ? message : "";
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildBoundaryReport(
  error: unknown,
  opts: {
    /** Full location (href/pathname) — only the path survives. */
    route: string;
    build?: string | null;
    now?: Date;
  },
): BoundaryTripReport {
  const err = error as { name?: unknown; message?: unknown } | null;
  const rawName = typeof err?.name === "string" && err.name ? err.name : "Error";
  const rawMessage =
    typeof err?.message === "string" ? err.message : String(error ?? "");
  let route = typeof opts.route === "string" ? opts.route : "";
  /* Strip any query/hash even if a full href was passed — the report
     carries the path and nothing that could ride in a URL. */
  if (route.includes("://")) {
    try {
      route = new URL(route).pathname;
    } catch {
      route = "/";
    }
  }
  route = route.split(/[?#]/, 1)[0] ?? "";
  if (!route.startsWith("/")) route = `/${route}`;
  return {
    route: truncate(route, ROUTE_MAX),
    errorName: truncate(rawName, NAME_MAX),
    errorMessage: truncate(rawMessage, MESSAGE_MAX),
    chunkLike: isChunkLoadError(error),
    build:
      typeof opts.build === "string" && opts.build
        ? truncate(opts.build, BUILD_MAX)
        : null,
    ts: (opts.now ?? new Date()).toISOString(),
  };
}

export interface BoundaryReportTransport {
  /** navigator.sendBeacon — returns false when the browser refuses. */
  sendBeacon?: (url: string, body: Blob) => boolean;
  /** fetch fallback (keepalive so the report survives an unload). */
  fetchFn?: (
    url: string,
    init: Record<string, unknown>,
  ) => Promise<unknown>;
  endpoint?: string;
}

/**
 * Fire-and-forget delivery. Returns true when a transport accepted the
 * report. NEVER throws and never returns a promise — the boundary
 * calls this from componentDidCatch, where a throw would take down
 * the fallback screen itself.
 */
export function reportBoundaryTrip(
  report: BoundaryTripReport,
  transport: BoundaryReportTransport = {},
): boolean {
  try {
    const endpoint = transport.endpoint ?? BOUNDARY_REPORT_PATH;
    const body = JSON.stringify(report);
    const sendBeacon =
      transport.sendBeacon ??
      (typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
        ? (url: string, blob: Blob) => navigator.sendBeacon(url, blob)
        : undefined);
    if (sendBeacon) {
      try {
        const blob = new Blob([body], { type: "application/json" });
        if (sendBeacon(endpoint, blob)) return true;
      } catch {
        /* fall through to fetch */
      }
    }
    const fetchFn =
      transport.fetchFn ??
      (typeof fetch === "function"
        ? (url: string, init: Record<string, unknown>) =>
            fetch(url, init as RequestInit)
        : undefined);
    if (fetchFn) {
      void Promise.resolve(
        fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }),
      ).catch(() => {
        /* fire-and-forget: a lost report changes nothing on screen */
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** The slice of sessionStorage the guard needs (injectable for tests). */
export interface BoundaryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function storageGet(
  storage: BoundaryStorage | null | undefined,
  key: string,
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(
  storage: BoundaryStorage | null | undefined,
  key: string,
  value: string,
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    /* private-mode storage refusal: the guard simply stays unset */
  }
}

/**
 * Clear the one-shot guard. The boundary calls this when it mounts
 * with NO error — a healthy render just happened, so a future chunk
 * trip is a new incident and may auto-reload once again. A boundary
 * that mounts already tripped (the chunk is still failing after the
 * reload) never clears it: that is what makes looping impossible.
 */
export function clearChunkReloadGuard(
  storage: BoundaryStorage | null | undefined,
): void {
  try {
    storage?.removeItem(CHUNK_RELOAD_FLAG);
  } catch {
    /* never throws */
  }
}

/**
 * The one automatic recovery: for a chunk-shaped error, reload the
 * page exactly once per unhealed incident. Returns true when a reload
 * was triggered. Never throws, whatever storage does.
 */
export function tryChunkAutoReload(
  error: unknown,
  deps: {
    storage: BoundaryStorage | null | undefined;
    reload: () => void;
  },
): boolean {
  try {
    if (!isChunkLoadError(error)) return false;
    if (storageGet(deps.storage, CHUNK_RELOAD_FLAG)) return false;
    storageSet(deps.storage, CHUNK_RELOAD_FLAG, "1");
    deps.reload();
    return true;
  } catch {
    return false;
  }
}
