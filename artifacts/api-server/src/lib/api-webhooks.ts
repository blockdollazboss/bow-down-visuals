import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { db, apiWebhooksTable, apiWebhookDeliveriesTable, type ApiWebhook } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

/* ─── Public Creator API webhooks (Stack-100 #3, wave 3, lane 20) ────────
   Webhooks on top of the Public Creator API (stack29/public-api): a creator
   registers an https endpoint for the event types they care about and we
   POST HMAC-signed JSON when those events happen to THEM.

   Event sources — each verified against a real write in the codebase
   (see the lane REPORT.md for file/line evidence):
   - "new-sale":     a store_orders row lands with status "completed"
                     (storefront checkout verify + $0 claim).
   - "new-follower": a NEW row in follows (creator-platform follow route,
                     only when the follow did not already exist).
   - "new-member":   a NEW fan_members row is created active/trialing
                     (memberships join / verify / free-join paths).

   Hard rules (mirroring lib/api-keys.ts):
   - The signing secret is returned ONCE from createWebhookEndpoint() and
     never stored in plaintext, never logged, never readable again. Only
     its SHA-256 hash persists. Because delivery must SIGN (not verify),
     the HMAC key is that stored hash — receivers derive the same key by
     hashing the secret they were shown (verify recipe in the Developer
     door docs + verifyWebhookSignature below). Hash-at-rest is kept.
   - An endpoint authenticates deliveries to its owner ONLY: event lookup
     is scoped by the event's creator userId, so creator A can never
     receive creator B's events.
   - FAIL-CLOSED: status other than "active" (paused / disabled /
     unregistered) receives nothing; if the webhook tables are missing
     (migration held — see .lane/MIGRATION-NEEDED.md) emission swallows
     the failure and delivers nothing. Nothing pretends to fire.
   - A webhook failure must NEVER fail or roll back the underlying sale /
     follow / membership: emission is fire-and-forget off the request
     path, every function in the emit path catches its own errors, and
     that invariant is pinned by a test. */

/* ─── Event types ─────────────────────────────────────────────────────── */

export const WEBHOOK_EVENT_TYPES = ["new-sale", "new-follower", "new-member"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** Validate a creator-picked event list: non-empty, all known, deduped. */
export function normalizeEventTypes(input: unknown): WebhookEventType[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: WebhookEventType[] = [];
  for (const s of input) {
    if (typeof s !== "string" || !isWebhookEventType(s)) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out.length > 0 ? out : null;
}

export function parseEventTypes(stored: string): WebhookEventType[] {
  return stored
    .split(",")
    .map((s) => s.trim())
    .filter(isWebhookEventType);
}

/* ─── Signing secret (API-key handling pattern) ───────────────────────── */

export const WEBHOOK_SECRET_PREFIX = "whsec_";
const SECRET_DISPLAY_PREFIX_LEN = WEBHOOK_SECRET_PREFIX.length + 4;

export function hashWebhookSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export interface GeneratedWebhookSecret {
  /** Shown to the creator exactly once. Never persisted anywhere. */
  plaintext: string;
  secretPrefix: string;
  secretHash: string;
}

export function generateWebhookSecret(): GeneratedWebhookSecret {
  const plaintext = WEBHOOK_SECRET_PREFIX + randomBytes(32).toString("base64url");
  return {
    plaintext,
    secretPrefix: plaintext.slice(0, SECRET_DISPLAY_PREFIX_LEN),
    secretHash: hashWebhookSecret(plaintext),
  };
}

/* ─── Signature ─────────────────────────────────────────────────────────
   Header: X-BDV-Signature: t=<unixSeconds>,v1=<hex>
   Signed content: "<unixSeconds>.<rawJsonBody>"
   HMAC key: the SHA-256 hex of the endpoint's secret (= secret_hash at
   rest; receivers compute it from the secret they were shown once). */

export function deriveSigningKey(secretPlaintext: string): string {
  return hashWebhookSecret(secretPlaintext);
}

export function signPayload(signingKey: string, timestampSeconds: number, rawBody: string): string {
  return createHmac("sha256", signingKey)
    .update(`${timestampSeconds}.${rawBody}`, "utf8")
    .digest("hex");
}

export function signatureHeader(signingKey: string, timestampSeconds: number, rawBody: string): string {
  return `t=${timestampSeconds},v1=${signPayload(signingKey, timestampSeconds, rawBody)}`;
}

/** Receiver-side verification recipe (documented in the Developer door). */
export function verifyWebhookSignature(args: {
  secretPlaintext: string;
  header: string;
  rawBody: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = args.toleranceSeconds ?? 300;
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of args.header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") t = Number(v);
    if (k?.trim() === "v1") v1 = v?.trim() ?? null;
  }
  if (t === null || !Number.isFinite(t) || !v1) return false;
  if (Math.abs(now - t) > tolerance) return false; // replay window
  const expected = signPayload(deriveSigningKey(args.secretPlaintext), t, args.rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ─── SSRF guard ────────────────────────────────────────────────────────
   No outbound-URL guard existed in the codebase (checked lib/: fetches go
   to fixed provider hosts or operator-configured URLs). This is the
   minimum sane guard for a creator-supplied delivery target:
   - https only, no credentials in the URL, no localhost / *.local names;
   - the hostname must resolve ONLY to public addresses — any private,
     loopback, link-local, CGNAT, multicast, or reserved answer (v4 or
     v6, incl. v4-mapped v6) rejects the URL;
   - checked at registration AND again at delivery time (rebinding).
   Residual: fetch re-resolves after the check (classic TOCTOU); noted in
   the lane report — the check still kills the realistic SSRF surface. */

export type DnsResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: DnsResolver = async (hostname) => {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => r.address);
};

export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ip.split(".").map(Number);
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // link-local
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 192 && b === 0) return false; // IETF special + documentation TEST-NET-1 (192.0.2.x handled by b===0 partially; explicit below)
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51) return false; // TEST-NET-2
    if (a === 203 && b === 0) return false; // TEST-NET-3
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return false;
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice("::ffff:".length);
      return isIP(mapped) === 4 ? isPublicIp(mapped) : false;
    }
    if (/^f[cd]/.test(lower)) return false; // unique-local fc00::/7
    if (/^fe[89ab]/.test(lower)) return false; // link-local fe80::/10
    if (lower.startsWith("ff")) return false; // multicast
    if (lower.startsWith("2001:db8")) return false; // documentation
    return true;
  }
  return false;
}

export async function validateWebhookUrl(
  raw: string,
  resolver: DnsResolver = defaultResolver,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "https_required" };
  if (u.username || u.password) return { ok: false, reason: "url credentials are not allowed" };
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "host_not_allowed" };
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      return { ok: false, reason: "host does not resolve" };
    }
  }
  if (addresses.length === 0) return { ok: false, reason: "host does not resolve" };
  if (!addresses.every(isPublicIp)) return { ok: false, reason: "host resolves to a non-public address" };
  return { ok: true, url: u.toString() };
}

/* ─── Retry discipline ──────────────────────────────────────────────────
   MAX_ATTEMPTS = 5 total attempts per event per endpoint.
   Backoff before attempts 2..5: 30s, 5m, 30m, 2h (RETRY_DELAYS_MS).
   Per-attempt timeout: 10s. Success = any 2xx.
   Auto-disable: WEBHOOK_DISABLE_AFTER_CONSECUTIVE_FAILURES (5)
   consecutive EXHAUSTED deliveries (all attempts spent) flips the
   endpoint to "disabled"; any successful delivery resets the counter. */

export const MAX_ATTEMPTS = 5;
export const RETRY_DELAYS_MS = [30_000, 300_000, 1_800_000, 7_200_000] as const;
export const ATTEMPT_TIMEOUT_MS = 10_000;
export const WEBHOOK_DISABLE_AFTER_CONSECUTIVE_FAILURES = 5;

/* ─── Store (injectable for tests; drizzle implementation below) ─────── */

export interface WebhookEndpointRow {
  id: string;
  userId: string;
  url: string;
  events: string; // comma-joined WebhookEventType list
  secretPrefix: string;
  secretHash: string;
  status: string; // "active" | "paused" | "disabled"
  consecutiveFailures: number;
  createdAt: Date;
  disabledAt: Date | null;
}

export interface WebhookDeliveryRow {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  attempt: number;
  status: string; // "delivered" | "failed"
  responseStatus: number | null;
  error: string | null;
  payload: string;
  createdAt: Date;
}

export interface WebhookStore {
  insertEndpoint(v: {
    userId: string;
    url: string;
    events: string;
    secretPrefix: string;
    secretHash: string;
  }): Promise<WebhookEndpointRow>;
  listEndpoints(userId: string): Promise<WebhookEndpointRow[]>;
  getEndpoint(userId: string, id: string): Promise<WebhookEndpointRow | null>;
  updateEndpoint(
    userId: string,
    id: string,
    patch: Partial<Pick<WebhookEndpointRow, "status" | "consecutiveFailures" | "disabledAt">>,
  ): Promise<boolean>;
  deleteEndpoint(userId: string, id: string): Promise<boolean>;
  /** Active endpoints owned by `userId` subscribed to `eventType`. Owner-scoped by construction. */
  listActiveForEvent(userId: string, eventType: WebhookEventType): Promise<WebhookEndpointRow[]>;
  recordAttempt(v: {
    webhookId: string;
    eventId: string;
    eventType: string;
    attempt: number;
    status: string;
    responseStatus: number | null;
    error: string | null;
    payload: string;
  }): Promise<void>;
  listDeliveries(userId: string, webhookId: string, limit: number): Promise<WebhookDeliveryRow[]>;
}

function rowToEndpoint(row: ApiWebhook): WebhookEndpointRow {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    events: row.events,
    secretPrefix: row.secretPrefix,
    secretHash: row.secretHash,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
  };
}

export const drizzleWebhookStore: WebhookStore = {
  async insertEndpoint(v) {
    const [row] = await db.insert(apiWebhooksTable).values(v).returning();
    if (!row) throw new Error("webhook insert returned no row");
    return rowToEndpoint(row);
  },
  async listEndpoints(userId) {
    const rows = await db
      .select()
      .from(apiWebhooksTable)
      .where(eq(apiWebhooksTable.userId, userId))
      .orderBy(desc(apiWebhooksTable.createdAt));
    return rows.map(rowToEndpoint);
  },
  async getEndpoint(userId, id) {
    const [row] = await db
      .select()
      .from(apiWebhooksTable)
      .where(and(eq(apiWebhooksTable.id, id), eq(apiWebhooksTable.userId, userId)))
      .limit(1);
    return row ? rowToEndpoint(row) : null;
  },
  async updateEndpoint(userId, id, patch) {
    const updated = await db
      .update(apiWebhooksTable)
      .set(patch)
      .where(and(eq(apiWebhooksTable.id, id), eq(apiWebhooksTable.userId, userId)))
      .returning({ id: apiWebhooksTable.id });
    return updated.length > 0;
  },
  async deleteEndpoint(userId, id) {
    const deleted = await db
      .delete(apiWebhooksTable)
      .where(and(eq(apiWebhooksTable.id, id), eq(apiWebhooksTable.userId, userId)))
      .returning({ id: apiWebhooksTable.id });
    return deleted.length > 0;
  },
  async listActiveForEvent(userId, eventType) {
    const rows = await db
      .select()
      .from(apiWebhooksTable)
      .where(and(eq(apiWebhooksTable.userId, userId), eq(apiWebhooksTable.status, "active")));
    // Subscription matching in code (events is a comma-joined closed set).
    return rows.map(rowToEndpoint).filter((r) => parseEventTypes(r.events).includes(eventType));
  },
  async recordAttempt(v) {
    await db.insert(apiWebhookDeliveriesTable).values(v);
  },
  async listDeliveries(userId, webhookId, limit) {
    const [owned] = await db
      .select({ id: apiWebhooksTable.id })
      .from(apiWebhooksTable)
      .where(and(eq(apiWebhooksTable.id, webhookId), eq(apiWebhooksTable.userId, userId)))
      .limit(1);
    if (!owned) return [];
    const rows = await db
      .select()
      .from(apiWebhookDeliveriesTable)
      .where(eq(apiWebhookDeliveriesTable.webhookId, webhookId))
      .orderBy(desc(apiWebhookDeliveriesTable.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      webhookId: r.webhookId,
      eventId: r.eventId,
      eventType: r.eventType,
      attempt: r.attempt,
      status: r.status,
      responseStatus: r.responseStatus,
      error: r.error,
      payload: r.payload,
      createdAt: r.createdAt,
    }));
  },
};

/* ─── Delivery engine (fetch / sleep / clock injectable for tests) ────── */

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number }>;

const defaultFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status };
};

export interface DeliveryDeps {
  store: WebhookStore;
  fetchFn: FetchFn;
  sleep: (ms: number) => Promise<void>;
  nowSeconds: () => number;
  resolver: DnsResolver;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

export function defaultDeliveryDeps(): DeliveryDeps {
  return {
    store: drizzleWebhookStore,
    fetchFn: defaultFetch,
    sleep: defaultSleep,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    resolver: defaultResolver,
  };
}

export interface WebhookEventEnvelope {
  id: string; // stable event id — receivers dedupe on it
  type: WebhookEventType;
  createdAt: string; // ISO
  data: Record<string, unknown>;
}

export function buildEnvelope(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  eventId: string = randomUUID(),
  nowMs: number = Date.now(),
): WebhookEventEnvelope {
  return { id: eventId, type: eventType, createdAt: new Date(nowMs).toISOString(), data };
}

/**
 * Deliver one event to one endpoint with the full retry discipline.
 * Returns the outcome; NEVER throws (every failure is recorded instead).
 */
export async function deliverWithRetries(
  endpoint: WebhookEndpointRow,
  envelope: WebhookEventEnvelope,
  deps: DeliveryDeps,
): Promise<"delivered" | "exhausted" | "rejected_url"> {
  // Re-validate the target at delivery time (registration-time checks go
  // stale; DNS can be rebound). A URL that no longer passes gets ONE log
  // row and no traffic — fail-closed.
  const check = await validateWebhookUrl(endpoint.url, deps.resolver);
  const rawBody = JSON.stringify(envelope);
  if (!check.ok) {
    await deps.store
      .recordAttempt({
        webhookId: endpoint.id,
        eventId: envelope.id,
        eventType: envelope.type,
        attempt: 0,
        status: "failed",
        responseStatus: null,
        error: `url_rejected:${check.reason}`,
        payload: rawBody,
      })
      .catch(() => undefined);
    return "rejected_url";
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await deps.sleep(RETRY_DELAYS_MS[attempt - 2]!);
    const ts = deps.nowSeconds();
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await deps.fetchFn(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BDV-Event-Id": envelope.id,
          "X-BDV-Event-Type": envelope.type,
          "X-BDV-Timestamp": String(ts),
          "X-BDV-Signature": signatureHeader(endpoint.secretHash, ts, rawBody),
        },
        body: rawBody,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `http_${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : "network_error";
    }
    const delivered = error === null;
    await deps.store
      .recordAttempt({
        webhookId: endpoint.id,
        eventId: envelope.id,
        eventType: envelope.type,
        attempt,
        status: delivered ? "delivered" : "failed",
        responseStatus: status,
        error,
        payload: rawBody,
      })
      .catch((e: unknown) => logger.warn({ err: e }, "[api-webhooks] attempt log failed"));
    if (delivered) {
      if (endpoint.consecutiveFailures !== 0) {
        await deps.store
          .updateEndpoint(endpoint.userId, endpoint.id, { consecutiveFailures: 0 })
          .catch(() => undefined);
      }
      return "delivered";
    }
  }

  // Exhausted: bump the consecutive-failure counter and auto-disable at
  // the threshold so a dead endpoint stops consuming attempts forever.
  const failures = endpoint.consecutiveFailures + 1;
  const patch: Partial<Pick<WebhookEndpointRow, "status" | "consecutiveFailures" | "disabledAt">> = {
    consecutiveFailures: failures,
  };
  if (failures >= WEBHOOK_DISABLE_AFTER_CONSECUTIVE_FAILURES) {
    patch.status = "disabled";
    patch.disabledAt = new Date();
  }
  await deps.store.updateEndpoint(endpoint.userId, endpoint.id, patch).catch(() => undefined);
  return "exhausted";
}

/* ─── Emission — fire-and-forget, NEVER throws ──────────────────────────
   Callers in the sale / follow / membership paths invoke these AFTER the
   underlying write has committed and WITHOUT awaiting delivery. Every
   failure mode (tables missing pre-migration, store error, dead
   endpoint) is swallowed here by design. */

export async function emitWebhookEvent(
  creatorUserId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  deps: DeliveryDeps = defaultDeliveryDeps(),
): Promise<number> {
  let endpoints: WebhookEndpointRow[];
  try {
    endpoints = await deps.store.listActiveForEvent(creatorUserId, eventType);
  } catch (err) {
    // Pre-migration (tables missing) or DB down: fail closed, fire nothing.
    logger.warn({ err }, "[api-webhooks] endpoint lookup failed; event not delivered (fail-closed)");
    return 0;
  }
  const matched = endpoints.filter(
    (e) => e.userId === creatorUserId && e.status === "active" && parseEventTypes(e.events).includes(eventType),
  );
  if (matched.length === 0) return 0;
  const envelope = buildEnvelope(eventType, data);
  for (const endpoint of matched) {
    // Detached per endpoint: one dead endpoint never delays another, and
    // nothing here is on the request path of the underlying event.
    void deliverWithRetries(endpoint, envelope, deps).catch((err: unknown) =>
      logger.warn({ err }, "[api-webhooks] delivery crashed (swallowed)"),
    );
  }
  return matched.length;
}

/** new-sale: store_orders completed. Amounts are the rails' own integer cents — never converted. */
export function emitNewSaleWebhook(
  creatorUserId: string,
  data: {
    orderId: string;
    profileId: string;
    productId: string | null;
    productTitle: string;
    amountCents: number;
    creatorAmountCents: number;
    platformFeeCents: number;
  },
): void {
  void emitWebhookEvent(creatorUserId, "new-sale", { ...data }).catch(() => undefined);
}

/** new-follower: a brand-new follows row for the creator's profile. */
export function emitNewFollowerWebhook(
  creatorUserId: string,
  data: { profileId: string; followerUserId: string },
): void {
  void emitWebhookEvent(creatorUserId, "new-follower", { ...data }).catch(() => undefined);
}

/** new-member: a brand-new fan_members row. priceCents is the join-time locked integer cents. */
export function emitNewMemberWebhook(
  creatorUserId: string,
  data: {
    memberId: string;
    tierId: string;
    fanUserId: string | null;
    status: string;
    priceCents: number;
    billingPeriod: string;
  },
): void {
  void emitWebhookEvent(creatorUserId, "new-member", { ...data }).catch(() => undefined);
}

/* ─── Management (owner-scoped; secrets never leave create) ───────────── */

export interface WebhookEndpointPublic {
  id: string;
  url: string;
  events: WebhookEventType[];
  secretPrefix: string;
  status: string;
  consecutiveFailures: number;
  createdAt: Date;
  disabledAt: Date | null;
}

export function toPublicEndpoint(row: WebhookEndpointRow): WebhookEndpointPublic {
  // Deliberately NO secretHash here — the list/management surface can
  // never leak signing material.
  return {
    id: row.id,
    url: row.url,
    events: parseEventTypes(row.events),
    secretPrefix: row.secretPrefix,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
  };
}

export async function createWebhookEndpoint(
  userId: string,
  url: string,
  events: WebhookEventType[],
  store: WebhookStore = drizzleWebhookStore,
  resolver: DnsResolver = defaultResolver,
): Promise<
  | { ok: true; endpoint: WebhookEndpointPublic; secret: string }
  | { ok: false; reason: string }
> {
  const check = await validateWebhookUrl(url, resolver);
  if (!check.ok) return { ok: false, reason: check.reason };
  const gen = generateWebhookSecret();
  const row = await store.insertEndpoint({
    userId,
    url: check.url,
    events: events.join(","),
    secretPrefix: gen.secretPrefix,
    secretHash: gen.secretHash,
  });
  // NOTE: gen.plaintext is deliberately never logged here or anywhere.
  return { ok: true, endpoint: toPublicEndpoint(row), secret: gen.plaintext };
}
