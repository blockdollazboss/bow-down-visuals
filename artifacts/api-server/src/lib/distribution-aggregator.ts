/**
 * distribution-aggregator.ts — pluggable distribution aggregator layer.
 *
 * AGGREGATOR CHOICE: Too Lost (https://toolost.com)
 * ────────────────────────────────────────────────
 * Why not DistroKid / TuneCore / CD Baby / Amuse / RouteNote? None of them
 * expose a public developer API for third-party apps to submit releases
 * programmatically — they are all dashboard-only products. Too Lost is the
 * notable exception: they publish a Developer API ("Build applications using
 * Too Lost's backend", toolost.com/developers) and acquired GYRO.Group's
 * DistroDirect white-label distribution infrastructure in 2026, explicitly
 * positioning for businesses that distribute on behalf of artists. They
 * deliver to 450–480+ stores/services (Spotify, Apple Music, YouTube Music,
 * TikTok, Instagram, Amazon, Deezer, TIDAL, …) — the same footprint a
 * DistroKid-style product needs.
 *
 * WHAT IS NEEDED TO GO LIVE (real deliveries):
 *   1. A Too Lost account with Developer/API access enabled (contact their
 *      partnerships/developer team — API access is provisioned per account).
 *   2. Env vars on the server (Render → Environment):
 *        DISTRIBUTION_AGGREGATOR=toolost
 *        TOOLOST_API_KEY=<secret API key>
 *        TOOLOST_API_BASE=https://api.toolost.com/v1   (confirm exact base URL
 *            in the developer docs — marked TO-CONFIRM below)
 *        TOOLOST_WEBHOOK_SECRET=<secret>                (for delivery-status webhooks)
 *   3. Confirm the exact REST paths + payload shapes in the Too Lost
 *      developer docs (toolost.com/developers) and fill in the TO-CONFIRM
 *      markers in TooLostAdapter below. The interface below is stable —
 *      only the HTTP mapping needs the docs.
 *   4. Point Too Lost's delivery-status webhook at
 *      POST /api/distribution/webhooks/toolost so per-platform statuses
 *      update in real time (signature verified with TOOLOST_WEBHOOK_SECRET).
 *
 * Until then the MockAggregator runs: releases flow end-to-end through the
 * full lifecycle (queued → pending → delivered → live) on an accelerated
 * timeline so the product, UI polling, and bookkeeping are all exercised.
 * Mock mode is ALWAYS labeled as a sandbox simulation in UI + API notices —
 * it never pretends a real platform accepted anything.
 */

export type PlatformDeliveryStatus =
  | "queued"
  | "pending"
  | "delivered"
  | "live"
  | "failed";

export interface PlatformStatusEntry {
  platform: string;
  status: PlatformDeliveryStatus;
  /** Human detail, e.g. aggregator's native status or an error message. */
  detail?: string;
  updatedAt: string;
}

export interface AggregatorTrack {
  title: string;
  isrc?: string;
  audioUrl: string;
  explicit: boolean;
}

export interface AggregatorReleasePayload {
  /** Our internal release id (idempotency key on retries). */
  clientReleaseId: string;
  title: string;
  artistName: string;
  releaseType: "single" | "ep" | "album";
  releaseDate: string; // YYYY-MM-DD
  genre?: string;
  explicit: boolean;
  label?: string;
  copyrightLine?: string;
  upc?: string;
  isrc?: string;
  tracks: AggregatorTrack[];
  artworkUrl: string;
  platforms: string[];
}

export interface AggregatorSubmission {
  /** Aggregator's native release id for status polling. */
  aggregatorReleaseId: string;
  raw?: unknown;
}

export interface AggregatorAdapter {
  readonly name: string;
  /** True when this adapter talks to a real aggregator (not a simulation). */
  readonly live: boolean;
  submitRelease(payload: AggregatorReleasePayload): Promise<AggregatorSubmission>;
  /** Current per-platform statuses for a submitted release. */
  fetchPlatformStatuses(aggregatorReleaseId: string): Promise<PlatformStatusEntry[]>;
}

/* ─── Mock aggregator (sandbox) ────────────────────────────────────────────
   Simulates a real delivery lifecycle on an accelerated clock:
     submit → all platforms "queued"
     +20s   → "pending"   (aggregator accepted the package)
     +90s   → "delivered" (package handed to the platform)
     +240s  → "live"      (platform reports the release as live)
   State lives in memory (same tradeoff as the mix-master/audio-cleanup job
   stores): a server restart resets in-flight simulations back to "queued",
   and the poller re-advances them. */

const MOCK_ADVANCE_MS: Array<{ status: PlatformDeliveryStatus; afterMs: number }> = [
  { status: "pending", afterMs: 20_000 },
  { status: "delivered", afterMs: 90_000 },
  { status: "live", afterMs: 240_000 },
];

interface MockJob {
  payload: AggregatorReleasePayload;
  submittedAt: number;
}

export class MockAggregatorAdapter implements AggregatorAdapter {
  readonly name = "mock";
  readonly live = false;
  private jobs = new Map<string, MockJob>();

  async submitRelease(payload: AggregatorReleasePayload): Promise<AggregatorSubmission> {
    const aggregatorReleaseId = `mock_${payload.clientReleaseId}`;
    this.jobs.set(aggregatorReleaseId, { payload, submittedAt: Date.now() });
    return { aggregatorReleaseId, raw: { sandbox: true } };
  }

  async fetchPlatformStatuses(aggregatorReleaseId: string): Promise<PlatformStatusEntry[]> {
    const job = this.jobs.get(aggregatorReleaseId);
    if (!job) {
      return [];
    }
    const elapsed = Date.now() - job.submittedAt;
    let status: PlatformDeliveryStatus = "queued";
    let detail = "Package queued at the aggregator (sandbox simulation).";
    for (const step of MOCK_ADVANCE_MS) {
      if (elapsed >= step.afterMs) {
        status = step.status;
      }
    }
    if (status === "pending") detail = "Aggregator accepted the package (sandbox simulation).";
    if (status === "delivered") detail = "Package delivered to the platform (sandbox simulation).";
    if (status === "live") detail = "Platform reports the release as live (sandbox simulation).";
    const now = new Date().toISOString();
    return job.payload.platforms.map((platform) => ({ platform, status, detail, updatedAt: now }));
  }
}

/* ─── Too Lost adapter (real deliveries) ────────────────────────────────────
   HTTP mapping to the Too Lost Developer API. Endpoint paths and payload
   field names are marked TO-CONFIRM — verify against toolost.com/developers
   before enabling (DISTRIBUTION_AGGREGATOR=toolost). The adapter interface
   above is what the rest of the app depends on, so confirming the docs is a
   contained change inside this class. */

const TOOLOST_BASE = (process.env["TOOLOST_API_BASE"] ?? "https://api.toolost.com/v1").replace(/\/$/, "");

function toolostHeaders(): Record<string, string> {
  const key = process.env["TOOLOST_API_KEY"];
  if (!key) throw new Error("TOOLOST_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function toolostFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${TOOLOST_BASE}${path}`, {
    ...init,
    headers: { ...toolostHeaders(), ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body["message"] === "string" ? body["message"] : `Too Lost API error ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export class TooLostAdapter implements AggregatorAdapter {
  readonly name = "toolost";
  readonly live = true;

  async submitRelease(payload: AggregatorReleasePayload): Promise<AggregatorSubmission> {
    /* TO-CONFIRM: exact endpoint + field names in the Too Lost developer docs. */
    const body = (await toolostFetch("/releases", {
      method: "POST",
      body: JSON.stringify({
        external_id: payload.clientReleaseId,
        title: payload.title,
        artist_name: payload.artistName,
        release_type: payload.releaseType,
        release_date: payload.releaseDate,
        genre: payload.genre,
        explicit: payload.explicit,
        label: payload.label,
        copyright: payload.copyrightLine,
        upc: payload.upc,
        artwork_url: payload.artworkUrl,
        stores: payload.platforms,
        tracks: payload.tracks.map((t) => ({
          title: t.title,
          isrc: t.isrc,
          audio_url: t.audioUrl,
          explicit: t.explicit,
        })),
      }),
    })) as Record<string, unknown>;
    const id = body["id"] ?? body["release_id"] ?? body["releaseId"];
    if (typeof id !== "string" || !id) {
      throw new Error("Too Lost did not return a release id");
    }
    return { aggregatorReleaseId: id, raw: body };
  }

  async fetchPlatformStatuses(aggregatorReleaseId: string): Promise<PlatformStatusEntry[]> {
    /* TO-CONFIRM: exact endpoint + status vocabulary in the Too Lost developer docs. */
    const body = (await toolostFetch(
      `/releases/${encodeURIComponent(aggregatorReleaseId)}/deliveries`,
      { method: "GET" },
    )) as Record<string, unknown>;
    const rows = Array.isArray(body["deliveries"]) ? body["deliveries"] : [];
    const now = new Date().toISOString();
    return (rows as Array<Record<string, unknown>>).map((r) => {
      const native = String(r["status"] ?? "").toLowerCase();
      let status: PlatformDeliveryStatus = "pending";
      if (/live|published|available/.test(native)) status = "live";
      else if (/deliver/.test(native)) status = "delivered";
      else if (/fail|reject|error/.test(native)) status = "failed";
      else if (/queue/.test(native)) status = "queued";
      return {
        platform: String(r["store"] ?? r["platform"] ?? "unknown"),
        status,
        detail: typeof r["detail"] === "string" ? r["detail"] : undefined,
        updatedAt: typeof r["updated_at"] === "string" ? r["updated_at"] : now,
      };
    });
  }
}

/* ─── Factory ─────────────────────────────────────────────────────────────── */

let cached: AggregatorAdapter | null = null;

/** Returns the configured aggregator: Too Lost when a key is set and
 *  DISTRIBUTION_AGGREGATOR=toolost, otherwise the mock sandbox. */
export function getAggregator(): AggregatorAdapter {
  if (cached) return cached;
  const which = (process.env["DISTRIBUTION_AGGREGATOR"] ?? "").toLowerCase();
  const hasKey = Boolean(process.env["TOOLOST_API_KEY"]);
  cached = which === "toolost" && hasKey ? new TooLostAdapter() : new MockAggregatorAdapter();
  return cached;
}

/** Test-only: reset the cached adapter. */
export function resetAggregatorForTests(): void {
  cached = null;
}
