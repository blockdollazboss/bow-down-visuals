/**
 * paid-series-drops.ts — the pure logic behind the Marketplace
 * stand's Paid Series + Product Drops desk (World parity wave 1,
 * census items `paid-series` + `product-drops`, both ABSENT
 * in-World before this desk).
 *
 * The two features ride their EXISTING rails — no parallel API,
 * no invented price anywhere:
 *
 * PAID SERIES — a kind='series' playlist (migration 0192) whose
 * creator-set price_cents sells as a one-time unlock on the
 * digital store rail:
 *   - create:  POST  /api/playlists { title, description,
 *              kind: "series", is_public, price_cents } — the
 *              price is the CREATOR's own (server normalizeSeriesPrice:
 *              null/0 = free, $0.50 card floor, $100,000.00 ceiling);
 *   - manage:  GET   /api/playlists/mine (the owner's shelf),
 *              PATCH /api/playlists/:id { price_cents } and
 *              { preview_item } (the ONE free-preview episode —
 *              the server refuses a preview that isn't an episode),
 *              GET   /api/playlists/:id/buyers (owner only — the
 *              buyer list stays the creator's);
 *   - unlock:  GET   /api/store/item/series/:id (the rail's own
 *              price + 5% fee split), then POST /api/store/checkout
 *              { kind: "series", id, uiMode } — embedded first at
 *              the stand, the §3.9 hosted tab only as fallback —
 *              settled by POST /api/store/verify { sessionId }.
 *              A completed sale row IS the entitlement; a second
 *              checkout is refused by the rail itself (409
 *              ALREADY_OWNED), never re-charged here.
 *
 * PRODUCT DROPS — a timed release on a storefront product
 * (migration 0210, routes/storefront.ts #25):
 *   - the owner's products: GET /api/creator-profiles/me proves
 *     the profile, GET /api/storefront/products?profileId=<id>
 *     lists them, each carrying its server-computed `drop`;
 *   - schedule / move: PUT    /api/storefront/products/:id/drop
 *     { dropAt } — an ISO UTC instant; the client renders it back
 *     in local time (lib/product-drop.ts);
 *   - cancel:  DELETE /api/storefront/products/:id/drop;
 *   - owner read: GET /api/storefront/products/:id/drop — the
 *     drop + its capture list;
 *   - fan side: POST /api/storefront/products/:id/drop/capture
 *     { email, name } (public) — one email at the drop moment,
 *     and the capture also joins the creator's own email list
 *     server-side. Nothing here creates a parallel list.
 *
 * Everything in this module is pure (no fetch, no React) so the
 * payload shapes, price gates and parsers are unit-tested; the
 * component (components/world/native/PaidSeriesDropsDesk.tsx)
 * stays a thin shell that fetches and renders.
 */
import { dollarsToCents } from "@/lib/shops";

/* ─── Paid Series — price discipline (the server's own) ──────────
   Mirrors normalizeSeriesPrice in routes/creator-platform.ts:
   SERIES_PRICE_MIN_CENTS = 50 (the card networks' floor),
   SERIES_PRICE_MAX_CENTS = 100_000_00. The typed price is the
   creator's; 0 / empty clears it and the series is free. */
export const SERIES_PRICE_MIN_CENTS = 50;
export const SERIES_PRICE_MAX_CENTS = 100_000_00;

/** The price gate for the stand's price field, in plain words.
 *  Null = the typed price may ride (including empty/zero = free). */
export function seriesPriceProblem(dollars: string): string | null {
  const trimmed = dollars.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(numeric) && numeric * 100 > SERIES_PRICE_MAX_CENTS) {
    return "That price is over the store's ceiling — bring it under $100,000.";
  }
  const cents = dollarsToCents(trimmed);
  if (cents === null) return "Enter a valid price — dollars and cents, like 19.99.";
  if (cents === 0) return null;
  if (cents < SERIES_PRICE_MIN_CENTS) return "The minimum series price is $0.50 — that's the card floor, not ours.";
  return null;
}

/** The typed dollars → the rail's price_cents (null = free). */
export function seriesPriceCents(dollars: string): number | null {
  const cents = dollarsToCents(dollars.trim());
  return cents === null || cents === 0 ? null : cents;
}

/* ─── Paid Series — DTOs + parsers ─────────────────────────────── */

export interface SeriesEpisodeRef {
  kind: "track" | "video";
  id: string;
}

export interface PaidSeriesDto {
  id: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  /** The creator's own unlock price; null = free series. */
  priceCents: number | null;
  previewItem: SeriesEpisodeRef | null;
  items: SeriesEpisodeRef[];
  /** This viewer's access, as the rail computed it. */
  access: "free" | "owner" | "purchased" | "locked";
  isPaidSeries: boolean;
  isOwner: boolean;
}

function parseEpisodeRef(v: unknown): SeriesEpisodeRef | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if ((r["kind"] === "track" || r["kind"] === "video") && typeof r["id"] === "string" && r["id"]) {
    return { kind: r["kind"], id: r["id"] };
  }
  return null;
}

function parseSeriesRow(r: unknown): PaidSeriesDto | null {
  if (!r || typeof r !== "object") return null;
  const row = r as Record<string, unknown>;
  if (typeof row["id"] !== "string" || typeof row["title"] !== "string") return null;
  if (row["kind"] !== "series") return null;
  const accessRaw = row["series_access"];
  return {
    id: row["id"],
    title: row["title"],
    description: typeof row["description"] === "string" ? row["description"] : null,
    isPublic: row["is_public"] !== false,
    priceCents:
      typeof row["price_cents"] === "number" && Number.isFinite(row["price_cents"]) ? row["price_cents"] : null,
    previewItem: parseEpisodeRef(row["preview_item"]),
    items: Array.isArray(row["items"]) ? row["items"].map(parseEpisodeRef).filter((x): x is SeriesEpisodeRef => x !== null) : [],
    access:
      accessRaw === "owner" || accessRaw === "purchased" || accessRaw === "locked" ? accessRaw : "free",
    isPaidSeries: row["is_paid_series"] === true || (typeof row["price_cents"] === "number" && row["price_cents"] > 0),
    isOwner: row["is_owner"] === true,
  };
}

/** GET /api/playlists/mine → ONLY the caller's series (plain
 *  playlists stay on their own surfaces). A payload without a
 *  playlists array is no shelf at all (null — the desk reports
 *  the load failed instead of rendering an invented empty one). */
export function parseMySeries(payload: unknown): PaidSeriesDto[] | null {
  if (!payload || typeof payload !== "object") return null;
  const rows = (payload as { playlists?: unknown }).playlists;
  if (!Array.isArray(rows)) return null;
  return rows.map(parseSeriesRow).filter((x): x is PaidSeriesDto => x !== null);
}

/** The playlist a create/PATCH answers with ({ playlist }). */
export function parseSavedSeries(payload: unknown): PaidSeriesDto | null {
  if (!payload || typeof payload !== "object") return null;
  return parseSeriesRow((payload as { playlist?: unknown }).playlist);
}

/* ─── Paid Series — payload builders (the rails' exact bodies) ── */

export interface SeriesCreateFormState {
  title: string;
  description: string;
  price: string;
}

export function emptySeriesCreateForm(): SeriesCreateFormState {
  return { title: "", description: "", price: "" };
}

export function seriesCreateProblem(form: SeriesCreateFormState): string | null {
  if (!form.title.trim()) return "Give the series a title first.";
  return seriesPriceProblem(form.price);
}

/** POST /api/playlists — the playlist page's create body for a
 *  series: kind rides "series", price_cents is the creator's own
 *  typed price (null = free). Null when a gate fails. */
export function buildSeriesCreatePayload(
  form: SeriesCreateFormState,
): { title: string; description: string; kind: "series"; is_public: boolean; price_cents: number | null } | null {
  if (seriesCreateProblem(form)) return null;
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    kind: "series",
    is_public: true,
    price_cents: seriesPriceCents(form.price),
  };
}

/** PATCH /api/playlists/:id — the price half of series settings.
 *  Null when the typed price fails the rail's own gate. */
export function buildSeriesPricePatch(dollars: string): { price_cents: number | null } | null {
  if (seriesPriceProblem(dollars)) return null;
  return { price_cents: seriesPriceCents(dollars) };
}

/** PATCH /api/playlists/:id — the free-preview half: the marked
 *  episode, or null to clear it. The server still verifies the
 *  episode belongs to the series. */
export function buildSeriesPreviewPatch(item: SeriesEpisodeRef | null): { preview_item: SeriesEpisodeRef | null } {
  return { preview_item: item };
}

/* ─── Paid Series — the fan unlock ─────────────────────────────── */

export interface SeriesStoreItem {
  id: string;
  title: string;
  artistName: string | null;
  priceCents: number;
  platformFeeCents: number;
  platformFeePct: number;
  creatorCents: number;
}

/** GET /api/store/item/series/:id → the rail's own item + fee
 *  split. Null when the payload doesn't honestly carry a priced
 *  series item (the desk reports the lookup failed — a price is
 *  never guessed). */
export function parseSeriesStoreItem(payload: unknown): SeriesStoreItem | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const item = p["item"];
  if (!item || typeof item !== "object") return null;
  const it = item as Record<string, unknown>;
  if (it["kind"] !== "series" || typeof it["id"] !== "string" || typeof it["title"] !== "string") return null;
  if (typeof it["priceCents"] !== "number" || !Number.isFinite(it["priceCents"])) return null;
  const fee = (p["feeSplit"] ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    id: it["id"],
    title: it["title"],
    artistName: typeof it["artistName"] === "string" ? it["artistName"] : null,
    priceCents: it["priceCents"],
    platformFeeCents: num(fee["platformFeeCents"]),
    platformFeePct: num(fee["platformFeePct"]) || 5,
    creatorCents: num(fee["creatorCents"]),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The series id a fan unlocks, from whatever they paste: a bare
 *  playlist id, the buy link (/store/buy/series/<id> — the link
 *  creators share), or the series page (/playlist/<id>). Anything
 *  else is null — the desk asks again instead of guessing. */
export function parseSeriesIdInput(input: string): string | null {
  const raw = input.trim();
  if (UUID_RE.test(raw)) return raw;
  const m = raw.match(/\/(?:store\/buy\/series|playlist)\/([0-9a-f-]{36})/i);
  if (m && UUID_RE.test(m[1]!)) return m[1]!;
  return null;
}

/** POST /api/store/checkout — the store-buy page's exact body for
 *  a series, plus the embedded ask when this device can mount it
 *  (the Marketplace stand's own discipline). */
export function seriesCheckoutPayload(
  seriesId: string,
  embedded: boolean,
): { kind: "series"; id: string; uiMode?: "embedded" } {
  return { kind: "series", id: seriesId, ...(embedded ? { uiMode: "embedded" as const } : {}) };
}

/** A series checkout the stand opened and hasn't confirmed yet —
 *  stashed so the return (focus, reopen, the check button)
 *  verifies THIS session instead of forgetting the unlock left. */
export interface SeriesPendingCheckout {
  sessionId: string;
  seriesId: string;
  title: string;
}

export function seriesPendingKey(seriesId: string): string {
  return `bdv-series-pending-${seriesId}`;
}

export function parseSeriesPending(raw: string | null): SeriesPendingCheckout | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p["sessionId"] !== "string" || !p["sessionId"]) return null;
    if (typeof p["seriesId"] !== "string" || !p["seriesId"]) return null;
    return {
      sessionId: p["sessionId"],
      seriesId: p["seriesId"],
      title: typeof p["title"] === "string" && p["title"] ? p["title"] : "Series",
    };
  } catch {
    return null;
  }
}

/** What POST /api/store/verify answered, in three honest states
 *  (the Crowns stand's verify discipline, same rail wording):
 *  - "confirmed": 200 with success — the sale row landed and the
 *    series is unlocked (a duplicate answer counts: the unlock
 *    landed earlier and this verify is the desk catching up);
 *  - "pending": the rail's own not-paid-yet refusal;
 *  - "dead": anything else — the marker drops, no unlock claimed. */
export type SeriesVerifyState = "confirmed" | "pending" | "dead";
export function seriesVerifyState(status: number, payload: unknown): SeriesVerifyState {
  if (status === 200 && payload && typeof payload === "object" && (payload as { success?: unknown }).success === true) {
    return "confirmed";
  }
  if (
    status === 400 &&
    payload &&
    typeof payload === "object" &&
    (payload as { error?: unknown }).error === "Payment has not been completed."
  ) {
    return "pending";
  }
  return "dead";
}

/** The unlock's access half of a confirmed verify ({ access:
 *  { unlocked, watchUrl } } for a series sale). */
export function seriesUnlockedFromVerify(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const access = (payload as { access?: unknown }).access;
  return !!access && typeof access === "object" && (access as { unlocked?: unknown }).unlocked === true;
}

/* ─── Paid Series — the owner's buyer list ─────────────────────── */

export interface SeriesBuyers {
  buyers: Array<{ displayName: string; amountCents: number; status: string }>;
  buyerCount: number;
  grossCents: number;
}

/** GET /api/playlists/:id/buyers, parsed tolerantly. Null when
 *  the payload doesn't honestly carry the list + totals. */
export function parseSeriesBuyers(payload: unknown): SeriesBuyers | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p["buyers"])) return null;
  const totals = (p["totals"] ?? {}) as Record<string, unknown>;
  if (typeof totals["buyers"] !== "number" || typeof totals["gross_cents"] !== "number") return null;
  return {
    buyers: (p["buyers"] as Array<Record<string, unknown>>)
      .filter((b) => b && typeof b === "object")
      .map((b) => ({
        displayName: typeof b["display_name"] === "string" && b["display_name"] ? b["display_name"] : "Fan",
        amountCents: typeof b["amount_cents"] === "number" && Number.isFinite(b["amount_cents"]) ? b["amount_cents"] : 0,
        status: typeof b["status"] === "string" ? b["status"] : "",
      })),
    buyerCount: totals["buyers"],
    grossCents: totals["gross_cents"],
  };
}

/* ─── Product Drops — DTOs + parsers ───────────────────────────── */

export interface DropDto {
  id: string;
  state: "upcoming" | "live";
  isUpcoming: boolean;
  dropAt: string | null;
  captureCount?: number;
}

function parseDrop(v: unknown): DropDto | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r["id"] !== "string") return null;
  if (r["state"] !== "upcoming" && r["state"] !== "live") return null;
  return {
    id: r["id"],
    state: r["state"],
    isUpcoming: r["isUpcoming"] === true,
    dropAt: typeof r["dropAt"] === "string" ? r["dropAt"] : null,
    captureCount:
      typeof r["captureCount"] === "number" && Number.isFinite(r["captureCount"]) ? r["captureCount"] : undefined,
  };
}

export interface DroppableProductDto {
  id: string;
  title: string;
  priceCents: number;
  isActive: boolean;
  drop: DropDto | null;
}

/** GET /api/storefront/products?profileId=<mine> → the owner's
 *  storefront products, each with its server-computed drop.
 *  Null when the payload carries no products array at all. */
export function parseDroppableProducts(payload: unknown): DroppableProductDto[] | null {
  if (!payload || typeof payload !== "object") return null;
  const rows = (payload as { products?: unknown }).products;
  if (!Array.isArray(rows)) return null;
  const out: DroppableProductDto[] = [];
  for (const raw of rows as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw["id"] !== "string" || typeof raw["title"] !== "string") continue;
    out.push({
      id: raw["id"],
      title: raw["title"],
      priceCents: typeof raw["priceCents"] === "number" && Number.isFinite(raw["priceCents"]) ? raw["priceCents"] : 0,
      isActive: raw["isActive"] !== false,
      drop: parseDrop(raw["drop"]),
    });
  }
  return out;
}

/** GET /api/creator-profiles/me → the caller's own profile ref
 *  (the drop desk's ownership anchor). Null when the payload
 *  doesn't honestly carry one. */
export function parseMyProfileRef(payload: unknown): { id: string; slug: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p["id"] !== "string" || typeof p["slug"] !== "string") return null;
  return { id: p["id"], slug: p["slug"] };
}

export interface DropDetail {
  drop: (DropDto & { captureCount: number }) | null;
  captures: Array<{ email: string; name: string | null; capturedAt: string }>;
  captureCount: number;
}

/** GET /api/storefront/products/:id/drop (owner) — the drop plus
 *  its capture list. Null when the shape isn't the rail's. */
export function parseDropDetail(payload: unknown): DropDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p["captures"])) return null;
  const dropRaw = parseDrop(p["drop"]);
  return {
    drop: dropRaw ? { ...dropRaw, captureCount: dropRaw.captureCount ?? 0 } : null,
    captures: (p["captures"] as Array<Record<string, unknown>>)
      .filter((c) => c && typeof c === "object" && typeof c["email"] === "string")
      .map((c) => ({
        email: c["email"] as string,
        name: typeof c["name"] === "string" ? c["name"] : null,
        capturedAt: typeof c["capturedAt"] === "string" ? c["capturedAt"] : "",
      })),
    captureCount: typeof p["captureCount"] === "number" && Number.isFinite(p["captureCount"]) ? p["captureCount"] : 0,
  };
}

/* ─── Product Drops — payload builders + gates ─────────────────── */

/** A datetime-local value → the rail's ONE UTC instant, as an
 *  ISO string. Null for empty/unparseable input. The value is
 *  read in the CREATOR's local time (the input's own semantics)
 *  and shipped as UTC — the store-dashboard page's conversion. */
export function dropAtIsoFromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The schedule gate, mirroring the rail's own refusals
 *  (DROP_DATE_INVALID / DROP_DATE_PAST) so a doomed schedule is
 *  refused in the form first. Null = the moment may ride. */
export function dropScheduleProblem(value: string, nowMs: number): string | null {
  const iso = dropAtIsoFromLocalInput(value);
  if (!iso) return "Pick the drop date and time.";
  if (new Date(iso).getTime() <= nowMs) return "A drop has to be in the future — pick a later moment.";
  return null;
}

/** PUT /api/storefront/products/:id/drop — the dashboard's exact
 *  body. Null when the schedule gate fails. */
export function buildDropSchedulePayload(value: string, nowMs: number): { dropAt: string } | null {
  if (dropScheduleProblem(value, nowMs)) return null;
  const iso = dropAtIsoFromLocalInput(value);
  return iso ? { dropAt: iso } : null;
}

/** The drop a schedule/cancel answers with ({ drop }) — null
 *  drop is the cancel answer and a legitimate state, so the
 *  parser distinguishes "answered" from "unparseable" via the
 *  wrapper: undefined = the answer didn't carry the drop field. */
export function parseDropAnswer(payload: unknown): DropDto | null | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (!("drop" in payload)) return undefined;
  return parseDrop((payload as { drop?: unknown }).drop);
}

/** POST …/drop/capture — the fan's join body (the drop page's
 *  exact shape). Null when the email can't ride. */
export function buildDropCapturePayload(
  email: string,
  name: string,
): { email: string; name: string } | null {
  const e = email.trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return { email: e, name: name.trim() };
}

/** An ISO instant → the datetime-local input value that shows
 *  the same moment in the viewer's local time (for reschedule
 *  prefill). Null for missing/junk input. */
export function dropLocalInputValue(dropAt: string | null | undefined): string | null {
  if (!dropAt) return null;
  const d = new Date(dropAt);
  if (!Number.isFinite(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
