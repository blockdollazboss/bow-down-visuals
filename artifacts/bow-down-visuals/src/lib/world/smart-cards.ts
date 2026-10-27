/**
 * smart-cards.ts — the Smart Cards stand's pure logic (World parity P3-C).
 *
 * The Branding Atelier's missing department. The 2D surface is a real
 * product — the NFC Smart Business Cards line (pages/nfc-cards.tsx):
 * pick a card style → say what a tap shows (name, title, bio, links)
 * → say where the physical cards ship → the order is captured. The
 * buyer's cards then live on the same rails: their digital profiles
 * (edit what a tap shows) and their orders. Every step rides the
 * line's own rails (api-server routes/nfc-cards.ts):
 *
 *   POST /api/nfc-cards/order            the reservation (idempotent)
 *   GET  /api/nfc-cards/my-profiles      the buyer's digital cards
 *   GET  /api/nfc-cards/orders           the buyer's orders
 *   PUT  /api/nfc-cards/profile/:slug    edit what a tap shows
 *   GET  /api/nfc-cards/qr/:slug.svg     the print-ready tap QR
 *
 * Money honesty (the page's own v1 contract, carried verbatim):
 * orders are captured as RESERVATIONS with status "received" —
 * payment is collected when production is confirmed with the chosen
 * supplier. There is no charge at the stand, so nothing here goes
 * through the credit-confirmation law; prices are the line's own
 * catalog figures (lib/nfc-cards NFC_CARD_STYLES, the same constants
 * the page and the rail price from), never invented at the stand.
 * One idempotency key per order attempt — a retried submit returns
 * the original order instead of double-booking (the page's law).
 */

/* ─── The order form ─────────────────────────────────────────────── */

export interface SmartCardLink {
  label: string;
  url: string;
}

export interface SmartCardOrderForm {
  cardStyle: string;
  quantity: number;
  displayName: string;
  title: string;
  bio: string;
  links: SmartCardLink[];
  fullName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** The rail's own bounds (routes/nfc-cards.ts order schema). */
export const SMART_CARD_MAX_LINKS = 12;
export const SMART_CARD_MAX_QUANTITY = 100;

/** One idempotency key per order attempt (the page's generator):
 *  a failed-then-retried submit reuses the key so the rail dedupes;
 *  a successful order mints a fresh key for the next one. */
export function newSmartCardOrderKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The links that actually ride the order — half-filled rows stay
 *  behind (the page's filter). */
export function smartCardValidLinks(links: SmartCardLink[]): SmartCardLink[] {
  return links.filter((l) => l.label.trim() && l.url.trim());
}

/** POST /api/nfc-cards/order — the page's body, field for field:
 *  the card copy is trimmed, the shipping block rides as typed. */
export function buildSmartCardOrderPayload(
  form: SmartCardOrderForm,
  idempotencyKey: string,
): Record<string, unknown> {
  return {
    cardStyle: form.cardStyle,
    quantity: form.quantity,
    displayName: form.displayName.trim(),
    title: form.title.trim(),
    bio: form.bio.trim(),
    links: smartCardValidLinks(form.links),
    fullName: form.fullName.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    shippingAddress: {
      street: form.street,
      city: form.city,
      state: form.state,
      zip: form.zip,
      country: "USA",
    },
    idempotencyKey,
  };
}

/** The gate the page walks (details step + shipping step): a name
 *  for the card, and a complete, emailable shipping contact. */
export function smartCardOrderComplete(form: SmartCardOrderForm): boolean {
  return (
    form.displayName.trim().length > 0 &&
    form.fullName.trim().length > 0 &&
    /.+@.+\..+/.test(form.email.trim()) &&
    form.street.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.state.trim().length > 0 &&
    form.zip.trim().length > 0
  );
}

/** The reservation total — the catalog's unit price × quantity,
 *  the same multiplication the rail records. */
export function smartCardOrderTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

/** The print-ready QR the rail serves for a card's tap URL. */
export function smartCardQrPath(slug: string): string {
  return `/api/nfc-cards/qr/${slug}.svg`;
}

/** Order statuses in plain words (the page renders the rail's word
 *  with its underscores spaced — "pending fulfillment"). */
export function smartCardOrderStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

/* ─── Wire shapes ────────────────────────────────────────────────── */

export interface SmartCardProfile {
  slug: string;
  displayName: string;
  title: string;
  bio: string;
  links: SmartCardLink[];
  tapCount: number;
  isActive: boolean;
  url: string;
  createdAt: string;
}

export interface SmartCardOrder {
  id: string;
  cardStyle: string;
  quantity: number;
  status: string;
  totalCents: number;
  createdAt: string;
  slug: string;
}

export interface SmartCardOrderResult {
  /** The first card's tap slug ("" when the rail deduped a retry). */
  slug: string;
  url: string;
  /** Every card the order minted — one tap link per physical card. */
  slugs: string[];
  deduped: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseLinks(v: unknown): SmartCardLink[] {
  if (!Array.isArray(v)) return [];
  const out: SmartCardLink[] = [];
  for (const raw of v) {
    const r = asRecord(raw);
    if (typeof r["label"] === "string" && typeof r["url"] === "string") {
      out.push({ label: r["label"], url: r["url"] });
    }
  }
  return out;
}

function parseProfileRow(v: unknown): SmartCardProfile | null {
  const r = asRecord(v);
  const slug = str(r["slug"]);
  if (!slug) return null;
  return {
    slug,
    displayName: str(r["display_name"]) ?? "",
    title: str(r["title"]) ?? "",
    bio: str(r["bio"]) ?? "",
    links: parseLinks(r["links"]),
    tapCount: num(r["tap_count"]) ?? 0,
    isActive: r["is_active"] === true,
    url: str(r["url"]) ?? "",
    createdAt: str(r["created_at"]) ?? "",
  };
}

function parseOrderRow(v: unknown): SmartCardOrder | null {
  const r = asRecord(v);
  const id = str(r["id"]);
  if (!id) return null;
  /* The orders read embeds the first card's profile — Supabase hands
     it back as an object (or a one-row array on some shapes). */
  const embedded = r["nfc_profiles"];
  const slug =
    str(asRecord(embedded)["slug"]) ??
    (Array.isArray(embedded) ? str(asRecord(embedded[0])["slug"]) : null) ??
    "";
  return {
    id,
    cardStyle: str(r["card_style"]) ?? "",
    quantity: num(r["quantity"]) ?? 0,
    status: str(r["status"]) ?? "",
    totalCents: num(r["total_cents"]) ?? 0,
    createdAt: str(r["created_at"]) ?? "",
    slug,
  };
}

/** GET /api/nfc-cards/my-profiles — null when the answer is not the
 *  rail's { ok, profiles } (a failed load is never an empty shelf). */
export function parseSmartCardProfiles(data: unknown): SmartCardProfile[] | null {
  const d = asRecord(data);
  if (d["ok"] !== true || !Array.isArray(d["profiles"])) return null;
  return d["profiles"].map(parseProfileRow).filter((p): p is SmartCardProfile => p !== null);
}

/** GET /api/nfc-cards/orders — same honesty as the profiles read. */
export function parseSmartCardOrders(data: unknown): SmartCardOrder[] | null {
  const d = asRecord(data);
  if (d["ok"] !== true || !Array.isArray(d["orders"])) return null;
  return d["orders"].map(parseOrderRow).filter((o): o is SmartCardOrder => o !== null);
}

/** PUT /api/nfc-cards/profile/:slug — the updated digital card. */
export function parseSmartCardProfile(data: unknown): SmartCardProfile | null {
  const d = asRecord(data);
  if (d["ok"] !== true) return null;
  return parseProfileRow(d["profile"]);
}

/** POST /api/nfc-cards/order — a fresh order carries its first card's
 *  { slug, url }; a deduped retry carries the standing order and no
 *  profile. Anything else is not a success. */
export function parseSmartCardOrderResult(data: unknown): SmartCardOrderResult | null {
  const d = asRecord(data);
  if (d["ok"] !== true) return null;
  const slugs = Array.isArray(d["profiles"])
    ? (d["profiles"] as unknown[])
        .map((p) => str(asRecord(p)["slug"]))
        .filter((s): s is string => s !== null)
    : [];
  const profile = asRecord(d["profile"]);
  const slug = str(profile["slug"]);
  if (slug) {
    return { slug, url: str(profile["url"]) ?? "", slugs, deduped: false };
  }
  if (asRecord(d["order"])["id"]) {
    return { slug: "", url: "", slugs: [], deduped: true };
  }
  return null;
}

/** PUT /api/nfc-cards/profile/:slug — the page's edit body: what a
 *  tap shows, nothing else rides. */
export function buildSmartCardProfilePayload(input: {
  displayName: string;
  title: string;
  bio: string;
  links: SmartCardLink[];
}): Record<string, unknown> {
  return {
    displayName: input.displayName,
    title: input.title,
    bio: input.bio,
    links: smartCardValidLinks(input.links),
  };
}

/** The stand's transfer target — the line's own page. */
export const SMART_CARDS_PATH = "/nfc-cards";
