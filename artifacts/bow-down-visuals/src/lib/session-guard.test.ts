/**
 * session-guard.test.ts — the guard must heal dead Supabase sessions
 * and must NEVER mistake the password gate's lock for one
 * (stack800 lane 4; Gate #4, Oct 28–29).
 *
 * The gate answers 401 { error: "staging_locked" } when its cookie is
 * absent. That is a different lock with a different remedy. These
 * pins prove the guard leaves gate answers untouched — by body code,
 * not by copy — including a gate drop that lands between the first
 * answer and the guard's own retry, while the genuine session-death
 * path keeps working exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGIN = "https://example.test";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Harness {
  fetchMock: ReturnType<typeof vi.fn>;
  refreshSession: ReturnType<typeof vi.fn>;
  onSessionDead: ReturnType<typeof vi.fn>;
  call: (path: string) => Promise<Response>;
}

async function install(opts: {
  responses: Response[] | ((n: number) => Response);
  refresh: "fail" | "succeed";
  signedIn?: boolean;
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

  const win: Record<string, unknown> = {
    fetch: fetchMock,
    location: { origin: ORIGIN },
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
    fetchMock,
    refreshSession,
    onSessionDead,
    call: (path: string) =>
      (win.fetch as (u: string) => Promise<Response>)(`${ORIGIN}${path}`),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("password-gate answers are not session failures", () => {
  it("gate 401 passes through untouched: no refresh, no death", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "staging_locked", message: "This staging build is password protected." })],
      refresh: "fail",
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(401);
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });

  it("the exemption keys on the gate's code, not its copy — session-y wording still passes through", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "staging_locked", message: "session token expired" })],
      refresh: "fail",
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(401);
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });

  it("a gate drop that lands on the guard's own retry is not session death either", async () => {
    const h = await install({
      responses: [
        jsonRes(401, { error: "invalid jwt" }),
        jsonRes(401, { error: "staging_locked", message: "This staging build is password protected." }),
      ],
      refresh: "succeed",
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(401);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });
});

describe("genuine session failures still heal or die exactly as before", () => {
  it("dead session: one refresh attempt, then session death fires once", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "invalid jwt" })],
      refresh: "fail",
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(401);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(h.onSessionDead).toHaveBeenCalledTimes(1);
  });

  it("refresh revives: the retry's 200 is what the caller sees, no death", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "jwt expired" }), jsonRes(200, { billing: {} })],
      refresh: "succeed",
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(200);
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });

  it("fresh token still rejected by the API (not the gate): session death", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "invalid jwt" }), jsonRes(401, { error: "invalid jwt" })],
      refresh: "succeed",
    });
    await h.call("/api/creator-tiers/billing");
    expect(h.onSessionDead).toHaveBeenCalledTimes(1);
  });

  it("anonymous visitors are never intervened on", async () => {
    const h = await install({
      responses: [jsonRes(401, { error: "invalid jwt" })],
      refresh: "fail",
      signedIn: false,
    });
    const res = await h.call("/api/creator-tiers/billing");
    expect(res.status).toBe(401);
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.onSessionDead).not.toHaveBeenCalled();
  });
});
