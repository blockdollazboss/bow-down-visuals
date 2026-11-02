/**
 * session-guard-gate-remedy.test.ts — when the staging password gate's
 * pass falls out mid-session, the guard must apply the remedy its own
 * classification always named: send the browser back to the password
 * form (stack1300 staging-gate-api lane).
 *
 * The trap this closes (proven live on staging, stack1200 build):
 * a DELIBERATE app sign-out fetches /__staging_logout, which clears
 * the gate cookie (AuthContext signOut — by design, stack800). The
 * tester signs straight back in as a second account inside the SPA —
 * no hard navigation ever re-presents the gate form — so the app
 * renders a fully signed-in UI while EVERY /api call answers
 * 401 { error: "staging_locked" }: Buy buttons surface the gate's
 * raw message as a checkout error, and /creator-pricing's plans load
 * silently falls back to "price coming soon".
 *
 * The guard already DETECTED this answer and passed it through
 * untouched (no refresh, no session death — those pins live in
 * session-guard.test.ts and must keep passing). What was missing is
 * the remedy itself. These pins prove:
 *   - a gate-locked API answer navigates the browser to the gate
 *     login path (a hard navigation: the server-rendered form is the
 *     only place the pass is established);
 *   - the response still reaches the caller untouched, and neither
 *     the refresh nor the death path fires;
 *   - the navigation is BOUNDED — once per page lifetime, and not
 *     again within the latch interval across page loads — so a pass
 *     that cannot stick can never become a redirect loop;
 *   - genuine session failures and healthy traffic never navigate.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGIN = "https://example.test";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const GATE_401 = () =>
  jsonRes(401, { error: "staging_locked", message: "This staging build is password protected." });

interface Harness {
  refreshSession: ReturnType<typeof vi.fn>;
  onSessionDead: ReturnType<typeof vi.fn>;
  call: (path: string) => Promise<Response>;
  location: { origin: string; href: string };
}

async function install(opts: {
  responses: Response[] | ((n: number) => Response);
  refresh: "fail" | "succeed";
  signedIn?: boolean;
  storageSeed?: Record<string, string>;
}): Promise<Harness> {
  vi.resetModules();
  const queue = Array.isArray(opts.responses) ? [...opts.responses] : null;
  let n = 0;
  const fetchMock = vi.fn(async () => {
    n++;
    if (queue) return queue.shift() ?? jsonRes(200, {});
    return (opts.responses as (n: number) => Response)(n);
  });
  const refreshSession = vi.fn(async () =>
    opts.refresh === "succeed"
      ? { data: { session: { access_token: "fresh-token" } }, error: null }
      : { data: { session: null }, error: new Error("refresh failed") },
  );
  const onSessionDead = vi.fn();

  const store = new Map<string, string>(Object.entries(opts.storageSeed ?? {}));
  const location = { origin: ORIGIN, href: `${ORIGIN}/pricing` };
  const win: Record<string, unknown> = {
    fetch: fetchMock,
    location,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  vi.stubGlobal("window", win);

  const guard = await import("./session-guard");
  guard.installSessionGuard();
  guard.registerSessionHooks({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getClient: () => ({ auth: { refreshSession } }) as any,
    onSessionDead,
    isSignedIn: () => opts.signedIn ?? true,
  });

  return {
    refreshSession,
    onSessionDead,
    location,
    call: (path: string) =>
      (win.fetch as (u: string) => Promise<Response>)(`${ORIGIN}${path}`),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the gate remedy — a fallen-out pass sends the browser back to the form", () => {
  it("gate 401: navigates to the gate login, response untouched, no refresh, no death", async () => {
    const h = await install({ responses: [GATE_401()], refresh: "fail" });
    const res = await h.call("/api/embedded-checkout/credit-pack/intent");
    expect(res.status).toBe(401);
    expect(h.location.href).toBe("/__staging_login");
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });

  it("the remedy also fires for an anonymous session — a live SPA on staging passed the gate at load", async () => {
    const h = await install({ responses: [GATE_401()], refresh: "fail", signedIn: false });
    const res = await h.call("/api/creator-tiers/plans");
    expect(res.status).toBe(401);
    expect(h.location.href).toBe("/__staging_login");
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });

  it("bounded: a second gate answer in the same page lifetime does not navigate again", async () => {
    const h = await install({ responses: [GATE_401(), GATE_401()], refresh: "fail" });
    await h.call("/api/creator-tiers/plans");
    expect(h.location.href).toBe("/__staging_login");
    h.location.href = `${ORIGIN}/creator-pricing`; // pretend the navigation was intercepted
    await h.call("/api/creator-tiers/plans");
    expect(h.location.href).toBe(`${ORIGIN}/creator-pricing`);
  });

  it("bounded across page loads: a redirect inside the latch interval is not repeated", async () => {
    const h = await install({
      responses: [GATE_401()],
      refresh: "fail",
      storageSeed: { bdv_gate_redirect_at: String(Date.now()) },
    });
    const res = await h.call("/api/creator-tiers/plans");
    expect(res.status).toBe(401);
    expect(h.location.href).toBe(`${ORIGIN}/pricing`);
  });

  it("the latch expires: a redirect older than the interval lets the remedy fire again", async () => {
    const h = await install({
      responses: [GATE_401()],
      refresh: "fail",
      storageSeed: { bdv_gate_redirect_at: String(Date.now() - 120_000) },
    });
    await h.call("/api/creator-tiers/plans");
    expect(h.location.href).toBe("/__staging_login");
  });

  it("a gate drop that lands on the guard's own retry navigates too", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "invalid jwt" }), GATE_401()],
      refresh: "succeed",
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(401);
    expect(h.location.href).toBe("/__staging_login");
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });
});

describe("the remedy never fires for anything but the gate", () => {
  it("a genuine dead session still dies — and does NOT navigate to the gate", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "invalid jwt" })],
      refresh: "fail",
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(401);
    expect(h.onSessionDead).toHaveBeenCalledTimes(1);
    expect(h.location.href).toBe(`${ORIGIN}/pricing`);
  });

  it("healthy traffic is untouched", async () => {
    const h = await install({ responses: [jsonRes(200, { plans: [] })], refresh: "fail" });
    const res = await h.call("/api/creator-tiers/plans");
    expect(res.status).toBe(200);
    expect(h.location.href).toBe(`${ORIGIN}/pricing`);
  });
});
