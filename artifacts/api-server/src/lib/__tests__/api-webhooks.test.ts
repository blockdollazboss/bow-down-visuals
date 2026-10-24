/**
 * Public Creator API webhooks — signature, secrecy, ownership, matching,
 * retry/disable discipline, SSRF guard, and the fail-closed invariants.
 *
 * The delivery engine runs against an in-memory store + scripted fetch +
 * instant sleep, so the retry schedule is asserted exactly (delays and
 * attempt counts), never timed against a wall clock.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  WEBHOOK_DISABLE_AFTER_CONSECUTIVE_FAILURES,
  buildEnvelope,
  createWebhookEndpoint,
  deliverWithRetries,
  deriveSigningKey,
  emitWebhookEvent,
  generateWebhookSecret,
  hashWebhookSecret,
  isPublicIp,
  normalizeEventTypes,
  parseEventTypes,
  signPayload,
  signatureHeader,
  toPublicEndpoint,
  validateWebhookUrl,
  verifyWebhookSignature,
  type DeliveryDeps,
  type WebhookEndpointRow,
  type WebhookStore,
} from "../api-webhooks";

/* ─── Fakes ───────────────────────────────────────────────────────────── */

const PUBLIC_RESOLVER = async () => ["93.184.216.34"];

function makeStore(): WebhookStore & {
  endpoints: WebhookEndpointRow[];
  attempts: Array<Record<string, unknown>>;
} {
  const endpoints: WebhookEndpointRow[] = [];
  const attempts: Array<Record<string, unknown>> = [];
  let seq = 0;
  return {
    endpoints,
    attempts,
    async insertEndpoint(v) {
      const row: WebhookEndpointRow = {
        id: `wh_${++seq}`,
        status: "active",
        consecutiveFailures: 0,
        createdAt: new Date(),
        disabledAt: null,
        ...v,
      };
      endpoints.push(row);
      return row;
    },
    async listEndpoints(userId) {
      return endpoints.filter((e) => e.userId === userId);
    },
    async getEndpoint(userId, id) {
      return endpoints.find((e) => e.userId === userId && e.id === id) ?? null;
    },
    async updateEndpoint(userId, id, patch) {
      const row = endpoints.find((e) => e.userId === userId && e.id === id);
      if (!row) return false;
      Object.assign(row, patch);
      return true;
    },
    async deleteEndpoint(userId, id) {
      const i = endpoints.findIndex((e) => e.userId === userId && e.id === id);
      if (i < 0) return false;
      endpoints.splice(i, 1);
      return true;
    },
    async listActiveForEvent(userId, eventType) {
      return endpoints.filter(
        (e) =>
          e.userId === userId &&
          e.status === "active" &&
          parseEventTypes(e.events).includes(eventType),
      );
    },
    async recordAttempt(v) {
      attempts.push({ ...v });
    },
    async listDeliveries(userId, webhookId) {
      if (!endpoints.some((e) => e.userId === userId && e.id === webhookId)) return [];
      return attempts
        .filter((a) => a.webhookId === webhookId)
        .map((a, i) => ({
          id: `d_${i}`,
          webhookId,
          eventId: String(a.eventId),
          eventType: String(a.eventType),
          attempt: Number(a.attempt),
          status: String(a.status),
          responseStatus: (a.responseStatus as number | null) ?? null,
          error: (a.error as string | null) ?? null,
          payload: String(a.payload),
          createdAt: new Date(),
        }));
    },
  };
}

function makeDeps(
  store: WebhookStore,
  fetchImpl: (url: string) => Promise<{ status: number }>,
): DeliveryDeps & { sleeps: number[]; calls: Array<{ url: string; headers: Record<string, string>; body: string }> } {
  const sleeps: number[] = [];
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  return {
    store,
    sleeps,
    calls,
    fetchFn: async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return fetchImpl(url);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    nowSeconds: () => 1700000000,
    resolver: PUBLIC_RESOLVER,
  };
}

async function seedEndpoint(
  store: ReturnType<typeof makeStore>,
  over: Partial<WebhookEndpointRow> = {},
): Promise<WebhookEndpointRow> {
  const row = await store.insertEndpoint({
    userId: "creator_a",
    url: "https://hooks.example.com/bdv",
    events: "new-sale",
    secretPrefix: "whsec_ab12",
    secretHash: hashWebhookSecret("whsec_test_secret"),
  });
  Object.assign(row, over);
  return row;
}

/* ─── Secret handling: shown once, hashed at rest ─────────────────────── */

describe("signing secret", () => {
  it("mints a whsec_ secret whose hash is not the plaintext", () => {
    const g = generateWebhookSecret();
    expect(g.plaintext.startsWith("whsec_")).toBe(true);
    expect(g.secretHash).toBe(hashWebhookSecret(g.plaintext));
    expect(g.secretHash).not.toContain(g.plaintext);
    expect(g.secretPrefix.length).toBeLessThan(g.plaintext.length);
  });

  it("create returns the plaintext once; the stored row and public view never carry it", async () => {
    const store = makeStore();
    const res = await createWebhookEndpoint("creator_a", "https://hooks.example.com/x", ["new-sale"], store, PUBLIC_RESOLVER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.secret.startsWith("whsec_")).toBe(true);
    const stored = store.endpoints[0]!;
    expect(stored.secretHash).toBe(hashWebhookSecret(res.secret));
    expect(JSON.stringify(stored)).not.toContain(res.secret);
    const pub = toPublicEndpoint(stored);
    expect(JSON.stringify(pub)).not.toContain(res.secret);
    expect(JSON.stringify(pub)).not.toContain(stored.secretHash);
    expect(pub.secretPrefix).toBe(stored.secretPrefix);
  });

  it("create rejects non-https and private targets before storing anything", async () => {
    const store = makeStore();
    const http = await createWebhookEndpoint("creator_a", "http://hooks.example.com/x", ["new-sale"], store, PUBLIC_RESOLVER);
    expect(http.ok).toBe(false);
    const priv = await createWebhookEndpoint("creator_a", "https://hooks.example.com/x", ["new-sale"], store, async () => ["10.0.0.5"]);
    expect(priv.ok).toBe(false);
    expect(store.endpoints).toHaveLength(0);
  });
});

/* ─── Signature correctness (known vectors) ───────────────────────────── */

describe("HMAC signature", () => {
  // Vector computed independently (Python hmac/hashlib):
  // key "whsec-test-signing-key-0123456789", msg "1700000000.<body>".
  const BODY = '{"id":"evt_test_1","type":"new-sale","data":{"amountCents":2500}}';
  it("matches the known vector", () => {
    expect(signPayload("whsec-test-signing-key-0123456789", 1700000000, BODY)).toBe(
      "a2b7dc9234542e934a682c028727d1a8a119adca763f03f033da823b678bc890",
    );
    expect(signatureHeader("whsec-test-signing-key-0123456789", 1700000000, BODY)).toBe(
      "t=1700000000,v1=a2b7dc9234542e934a682c028727d1a8a119adca763f03f033da823b678bc890",
    );
  });

  it("deriveSigningKey is the SHA-256 hex of the shown secret (the documented receiver recipe)", () => {
    expect(deriveSigningKey("whsec_example_secret")).toBe(
      "029725e94e48e993fb099126cb89f460946eaa43564f4e0ee97d0ac63591a127",
    );
  });

  it("verifyWebhookSignature accepts a fresh valid signature and rejects tamper + replay", () => {
    const secret = "whsec_receiver_secret";
    const header = signatureHeader(deriveSigningKey(secret), 1700000000, BODY);
    expect(verifyWebhookSignature({ secretPlaintext: secret, header, rawBody: BODY, nowSeconds: 1700000100 })).toBe(true);
    expect(verifyWebhookSignature({ secretPlaintext: secret, header, rawBody: BODY + " ", nowSeconds: 1700000100 })).toBe(false);
    expect(verifyWebhookSignature({ secretPlaintext: "whsec_wrong", header, rawBody: BODY, nowSeconds: 1700000100 })).toBe(false);
    // 10 minutes old with a 5-minute tolerance = replay window exceeded.
    expect(verifyWebhookSignature({ secretPlaintext: secret, header, rawBody: BODY, nowSeconds: 1700000600 })).toBe(false);
    expect(verifyWebhookSignature({ secretPlaintext: secret, header: "garbage", rawBody: BODY, nowSeconds: 1700000100 })).toBe(false);
  });
});

/* ─── Event types ─────────────────────────────────────────────────────── */

describe("event types", () => {
  it("normalizes only the closed v1 set", () => {
    expect(normalizeEventTypes(["new-sale", "new-sale", "new-member"])).toEqual(["new-sale", "new-member"]);
    expect(normalizeEventTypes(["new-sale", "admin:all"])).toBeNull();
    expect(normalizeEventTypes([])).toBeNull();
    expect(normalizeEventTypes("new-sale")).toBeNull();
  });
  it("parseEventTypes drops stored junk", () => {
    expect(parseEventTypes("new-follower,bogus,new-sale")).toEqual(["new-follower", "new-sale"]);
  });
});

/* ─── SSRF guard ──────────────────────────────────────────────────────── */

describe("validateWebhookUrl / isPublicIp", () => {
  it("rejects non-public IPs across families", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.15.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it("rejects http, credentials, localhost, and private-resolving hosts", async () => {
    expect((await validateWebhookUrl("http://hooks.example.com/", PUBLIC_RESOLVER)).ok).toBe(false);
    expect((await validateWebhookUrl("https://user:pass@hooks.example.com/", PUBLIC_RESOLVER)).ok).toBe(false);
    expect((await validateWebhookUrl("https://localhost/hook", PUBLIC_RESOLVER)).ok).toBe(false);
    expect((await validateWebhookUrl("https://hooks.example.com/", async () => ["192.168.0.9"])).ok).toBe(false);
    expect((await validateWebhookUrl("https://169.254.169.254/latest", PUBLIC_RESOLVER)).ok).toBe(false);
    expect((await validateWebhookUrl("https://hooks.example.com/ok", PUBLIC_RESOLVER)).ok).toBe(true);
  });
});

/* ─── Delivery + retry discipline ─────────────────────────────────────── */

describe("deliverWithRetries", () => {
  it("delivers on 2xx with signed headers and a stable event id, logging one attempt", async () => {
    const store = makeStore();
    const ep = await seedEndpoint(store);
    const deps = makeDeps(store, async () => ({ status: 200 }));
    const env = buildEnvelope("new-sale", { orderId: "o1", amountCents: 2500 }, "evt_fixed_1", 1700000000000);
    await expect(deliverWithRetries(ep, env, deps)).resolves.toBe("delivered");
    expect(deps.calls).toHaveLength(1);
    const call = deps.calls[0]!;
    expect(call.headers["X-BDV-Event-Id"]).toBe("evt_fixed_1");
    expect(call.headers["X-BDV-Signature"]).toBe(
      signatureHeader(ep.secretHash, 1700000000, call.body),
    );
    const sent = JSON.parse(call.body) as { id: string; type: string; data: { amountCents: number } };
    expect(sent.id).toBe("evt_fixed_1");
    expect(sent.data.amountCents).toBe(2500);
    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0]).toMatchObject({ attempt: 1, status: "delivered", responseStatus: 200 });
    expect(deps.sleeps).toEqual([]);
  });

  it("retries on non-2xx with the exact backoff schedule, then succeeds", async () => {
    const store = makeStore();
    const ep = await seedEndpoint(store);
    let n = 0;
    const deps = makeDeps(store, async () => ({ status: ++n < 3 ? 500 : 204 }));
    const env = buildEnvelope("new-sale", { orderId: "o2" }, "evt_retry", 1700000000000);
    await expect(deliverWithRetries(ep, env, deps)).resolves.toBe("delivered");
    expect(deps.calls).toHaveLength(3);
    expect(deps.sleeps).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
    expect(store.attempts.map((a) => a.status)).toEqual(["failed", "failed", "delivered"]);
    // Same event id on every attempt — receiver-side dedupe holds.
    expect(new Set(deps.calls.map((c) => c.headers["X-BDV-Event-Id"])).size).toBe(1);
  });

  it("exhausts after MAX_ATTEMPTS with the full schedule and bumps the failure counter", async () => {
    const store = makeStore();
    const ep = await seedEndpoint(store);
    const deps = makeDeps(store, async () => ({ status: 503 }));
    const env = buildEnvelope("new-sale", { orderId: "o3" }, "evt_dead", 1700000000000);
    await expect(deliverWithRetries(ep, env, deps)).resolves.toBe("exhausted");
    expect(deps.calls).toHaveLength(MAX_ATTEMPTS);
    expect(deps.sleeps).toEqual([...RETRY_DELAYS_MS]);
    expect(store.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(ep.consecutiveFailures).toBe(1);
    expect(ep.status).toBe("active"); // one exhausted delivery is not yet disable
  });

  it("network throws are retried and logged, never thrown to the caller", async () => {
    const store = makeStore();
    const ep = await seedEndpoint(store);
    const deps = makeDeps(store, async () => {
      throw new Error("ECONNREFUSED");
    });
    const env = buildEnvelope("new-sale", { orderId: "o4" }, "evt_net", 1700000000000);
    await expect(deliverWithRetries(ep, env, deps)).resolves.toBe("exhausted");
    expect(store.attempts[0]).toMatchObject({ status: "failed", responseStatus: null, error: "ECONNREFUSED" });
  });

  it("auto-disables after the consecutive-failure threshold, and a success resets the counter", async () => {
    const store = makeStore();
    const ep = await seedEndpoint(store, {
      consecutiveFailures: WEBHOOK_DISABLE_AFTER_CONSECUTIVE_FAILURES - 1,
    });
    const failDeps = makeDeps(store, async () => ({ status: 500 }));
    const env = buildEnvelope("new-sale", { orderId: "o5" }, "evt_disable", 1700000000000);
    await deliverWithRetries(ep, env, failDeps);
    expect(ep.consecutiveFailures).toBe(WEBHOOK_DISABLE_AFTER_CONSECUTIVE_FAILURES);
    expect(ep.status).toBe("disabled");
    expect(ep.disabledAt).toBeInstanceOf(Date);

    const ep2 = await seedEndpoint(store, { consecutiveFailures: 3 });
    const okDeps = makeDeps(store, async () => ({ status: 200 }));
    await deliverWithRetries(ep2, env, okDeps);
    expect(ep2.consecutiveFailures).toBe(0);
  });

  it("re-validates the URL at delivery time: a rebound private target gets no traffic", async () => {
    const store = makeStore();
    const ep = await seedEndpoint(store);
    const deps = makeDeps(store, async () => ({ status: 200 }));
    deps.resolver = async () => ["169.254.169.254"];
    const env = buildEnvelope("new-sale", { orderId: "o6" }, "evt_ssrf", 1700000000000);
    await expect(deliverWithRetries(ep, env, deps)).resolves.toBe("rejected_url");
    expect(deps.calls).toHaveLength(0);
    expect(store.attempts).toHaveLength(1);
    expect(String(store.attempts[0]!["error"])).toContain("url_rejected");
  });
});

/* ─── Emission: matching, ownership, fail-closed ──────────────────────── */

describe("emitWebhookEvent", () => {
  it("matches only the owner's active endpoints subscribed to the event type", async () => {
    const store = makeStore();
    await seedEndpoint(store); // creator_a, new-sale, active
    await seedEndpoint(store, { events: "new-follower" }); // wrong type
    await seedEndpoint(store, { status: "paused" }); // paused gets nothing
    await seedEndpoint(store, { status: "disabled" }); // disabled gets nothing
    await seedEndpoint(store, { userId: "creator_b" }); // someone else's endpoint
    const deps = makeDeps(store, async () => ({ status: 200 }));
    const matched = await emitWebhookEvent("creator_a", "new-sale", { orderId: "o7" }, deps);
    expect(matched).toBe(1);
    // Delivery is detached; let the microtask queue flush.
    await vi.waitFor(() => expect(deps.calls).toHaveLength(1));
    expect(deps.calls[0]!.url).toBe("https://hooks.example.com/bdv");
  });

  it("ownership scoping: creator B's event never reaches creator A's endpoint", async () => {
    const store = makeStore();
    await seedEndpoint(store); // creator_a subscribed to new-sale
    const deps = makeDeps(store, async () => ({ status: 200 }));
    const matched = await emitWebhookEvent("creator_b", "new-sale", { orderId: "o8" }, deps);
    expect(matched).toBe(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.calls).toHaveLength(0);
  });

  it("pre-migration fail-closed: a store that throws (tables missing) delivers nothing and resolves 0", async () => {
    const store = makeStore();
    store.listActiveForEvent = async () => {
      throw new Error('relation "api_webhooks" does not exist');
    };
    const deps = makeDeps(store, async () => ({ status: 200 }));
    await expect(emitWebhookEvent("creator_a", "new-sale", { orderId: "o9" }, deps)).resolves.toBe(0);
    expect(deps.calls).toHaveLength(0);
  });

  it("delivery failure never breaks the event: emit resolves even when every endpoint is dead", async () => {
    const store = makeStore();
    await seedEndpoint(store);
    const deps = makeDeps(store, async () => {
      throw new Error("endpoint exploded");
    });
    // Instant sleep in deps keeps the 5-attempt exhaustion fast.
    await expect(emitWebhookEvent("creator_a", "new-sale", { orderId: "o10" }, deps)).resolves.toBe(1);
    await vi.waitFor(() => expect(store.attempts.length).toBe(MAX_ATTEMPTS));
    // The "event source" (this call) completed normally throughout.
  });

  it("unregistered creator: no endpoints, no deliveries, no error", async () => {
    const store = makeStore();
    const deps = makeDeps(store, async () => ({ status: 200 }));
    await expect(emitWebhookEvent("nobody", "new-member", { memberId: "m1" }, deps)).resolves.toBe(0);
    expect(deps.calls).toHaveLength(0);
  });
});
