/* ─── Business benches in-world (Stack 400 world parity,
   census Lane B items 10, 13, 14, 22 / manifest items B-10,
   B-13, B-14, B-22) ─────────────────────────────────────────
   Six 2D rails that had no in-World form, each on its own
   rail at the credit registry's price — the benches read the
   registry, so a shown price can never drift from the
   confirmation's price:

     POST /api/sponsors/match        100  Deal Matcher (B-10)
     POST /api/sponsor-read          100  Sponsor Read (B-22)
     POST /api/generate-invoice       50  Invoice Generator (B-13)
     POST /api/sync-pitch/one-sheet  150  Sync One-Sheet (B-14)
     POST /api/content-calendar      150  Content Calendar (B-22)
     GET  /api/stock/search            0  Stock search (B-22)
     POST /api/stock/import           50  Stock import (B-22)

   Every charge rides useConfirmedApi's confirmedFetch — the
   registry-priced spend confirmation shows BEFORE anything
   runs, a declined confirmation runs nothing, and the 402
   answer is the shared out-of-Bucs line. The stock SEARCH is
   free and rides a plain authed GET, exactly as the 2D
   editor panel runs it — no confirmation on a free rail.

   Copy rides each 2D twin's own catalog namespace
   (sponsors.*, outreach.*, syncPitch.*,
   contentIntelligence.*, videoEditor.stockLibrary) so the
   benches' labels can never drift from the pages'. */
import { getCreditCost } from "../credit-costs";

function registryCost(path: string): number {
  const entry = getCreditCost(path);
  if (!entry) throw new Error(`No registered credit cost for ${path}`);
  return entry.cost;
}

/* ─── B-10 · Deal Matcher — /api/sponsors/match (100) ─────────
   The Brand Deals page's matcher (brand-deals.tsx runMatcher):
   { niche, followers (digits only), platforms (≤ 5) } →
   { matches?: [{ dealId, brandName, score, why }], note?,
   creditsRemaining? }. 402 → out-of-Bucs. */

export const DEAL_MATCH_PATH = "/api/sponsors/match";

/** POST /api/sponsors/match — registry 100, the owner-ruled
 *  Oct 29 price (matches the sibling AI actions). */
export function dealMatchCost(): number {
  return registryCost(DEAL_MATCH_PATH);
}

/** The page's platform ceiling: at most five platforms ride. */
export const DEAL_MATCH_MAX_PLATFORMS = 5;

export interface DealMatchInput {
  niche: string;
  followers: string;
  platforms: string;
}

/** The page posts followers as the digits of the typed value
 *  (Number(matchFollowers.replace(/[^0-9]/g, "")) || 0) and
 *  platforms as the comma list, trimmed, blanks dropped,
 *  capped at five. */
export function dealMatchPayload(input: DealMatchInput): {
  niche: string;
  followers: number;
  platforms: string[];
} {
  return {
    niche: input.niche.trim(),
    followers: Number(input.followers.replace(/[^0-9]/g, "")) || 0,
    platforms: input.platforms
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, DEAL_MATCH_MAX_PLATFORMS),
  };
}

/** The page refuses to run without a niche (errorNicheFirst). */
export function dealMatchCanRun(input: DealMatchInput): boolean {
  return input.niche.trim().length > 0;
}

export interface DealMatch {
  dealId: string;
  brandName: string;
  score: number;
  why: string;
}

export interface DealMatchResult {
  matches: DealMatch[];
  note: string;
  creditsRemaining: number | null;
}

/** The POST answer: a match list (possibly empty — an honest
 *  empty, the page's emptyNoMatch state) or null on drift.
 *  Rows missing their id/brand are not matches at all. */
export function dealMatchesOf(data: unknown): DealMatchResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.matches)) return null;
  const matches: DealMatch[] = [];
  for (const m of d.matches) {
    if (!m || typeof m !== "object") return null;
    const row = m as Record<string, unknown>;
    if (typeof row.dealId !== "string" || typeof row.brandName !== "string") return null;
    matches.push({
      dealId: row.dealId,
      brandName: row.brandName,
      score: typeof row.score === "number" ? row.score : 0,
      why: typeof row.why === "string" ? row.why : "",
    });
  }
  return {
    matches,
    note: typeof d.note === "string" ? d.note : "",
    creditsRemaining: typeof d.creditsRemaining === "number" ? d.creditsRemaining : null,
  };
}

/* ─── B-22 · Sponsor Read — /api/sponsor-read (100) ───────────
   The Sponsorship Outreach panel's read writer
   (SponsorReadPanel): { brandName, productDescription,
   readLength ("30"|"60"|"90"), tone, keyPoints (≤ 10) } →
   { read?: { script, hookLine, ctaLine, estimatedSeconds },
   creditsUsed?, creditsRemaining? }. A brand and at least
   one key point are required (sponsorReadFillRequired). */

export const SPONSOR_READ_PATH = "/api/sponsor-read";

/** POST /api/sponsor-read — registry 100, the panel's
 *  READ_COST and the registry agree. */
export function sponsorReadCost(): number {
  return registryCost(SPONSOR_READ_PATH);
}

/* The panel's own enums (verbatim from SponsorReadPanel). */
export const SPONSOR_READ_LENGTHS = ["30", "60", "90"] as const;
export type SponsorReadLength = (typeof SPONSOR_READ_LENGTHS)[number];

export const SPONSOR_READ_TONES = ["energetic", "casual", "luxury", "humorous"] as const;
export type SponsorReadTone = (typeof SPONSOR_READ_TONES)[number];

/** The catalog label key per tone (the panel's TONE_KEYS). */
export const SPONSOR_READ_TONE_LABEL_KEYS: Record<SponsorReadTone, string> = {
  energetic: "outreach.sponsorReadToneEnergetic",
  casual: "outreach.sponsorReadToneCasual",
  luxury: "outreach.sponsorReadToneLuxury",
  humorous: "outreach.sponsorReadToneHumorous",
};

/** The panel's talking-point ceiling: ten points. */
export const SPONSOR_READ_MAX_POINTS = 10;

export interface SponsorReadInput {
  brandName: string;
  productDescription: string;
  readLength: SponsorReadLength;
  tone: SponsorReadTone;
  keyPoints: string[];
}

/** The panel posts trimmed brand/description and the point
 *  list as-is. */
export function sponsorReadPayload(input: SponsorReadInput): {
  brandName: string;
  productDescription: string;
  readLength: SponsorReadLength;
  tone: SponsorReadTone;
  keyPoints: string[];
} {
  return {
    brandName: input.brandName.trim(),
    productDescription: input.productDescription.trim(),
    readLength: input.readLength,
    tone: input.tone,
    keyPoints: input.keyPoints,
  };
}

/** The panel requires a brand and at least one talking point. */
export function sponsorReadCanRun(input: SponsorReadInput): boolean {
  return input.brandName.trim().length > 0 && input.keyPoints.length > 0;
}

/** The panel's add-point rule: trimmed, non-empty, not a dupe,
 *  under the ceiling. Pure, so the bench and the pin agree. */
export function sponsorReadAddPoint(points: string[], draft: string): string[] {
  const v = draft.trim();
  if (!v || points.length >= SPONSOR_READ_MAX_POINTS || points.includes(v)) return points;
  return [...points, v];
}

export interface SponsorRead {
  script: string;
  hookLine: string;
  ctaLine: string;
  estimatedSeconds: number;
}

/** The POST answer: the read, or null on drift — a read
 *  without its script is not a read. */
export function sponsorReadOf(data: unknown): SponsorRead | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.read || typeof d.read !== "object") return null;
  const r = d.read as Record<string, unknown>;
  if (typeof r.script !== "string" || r.script.length === 0) return null;
  return {
    script: r.script,
    hookLine: typeof r.hookLine === "string" ? r.hookLine : "",
    ctaLine: typeof r.ctaLine === "string" ? r.ctaLine : "",
    estimatedSeconds: typeof r.estimatedSeconds === "number" ? r.estimatedSeconds : 0,
  };
}

/* ─── B-13 · Invoice Generator — /api/generate-invoice (50) ───
   The Sponsorship Outreach invoice panel
   (InvoiceGeneratorPanel): { brandName, brandEmail,
   creatorName, creatorEmail, paymentDetails, lineItems:
   [{ description, quantity, rateCents }], currency, dueDate,
   notes } → { invoice?, pdfBase64?, pdfFilename?,
   creditsUsed?, creditsRemaining? }. Generation downloads the
   PDF; the saved invoice lists on the free GET /api/invoices
   rail and flips paid/unpaid on the free PATCH rail — the
   bench carries the same three rails at the same prices. */

export const INVOICE_GENERATE_PATH = "/api/generate-invoice";
export const INVOICES_PATH = "/api/invoices";

/** POST /api/generate-invoice — registry 50, the panel's
 *  INVOICE_COST and the registry agree. */
export function invoiceCost(): number {
  return registryCost(INVOICE_GENERATE_PATH);
}

/** The status-flip path for a saved invoice (free PATCH). */
export function invoiceStatusPath(id: string): string {
  return `${INVOICES_PATH}/${encodeURIComponent(id)}`;
}

/* The panel's own enums + helpers (verbatim). */
export const INVOICE_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number];

export interface InvoiceLineDraft {
  description: string;
  quantity: string;
  rate: string; // dollars, human-entered; converted to cents on submit
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  rateCents: number;
}

/** The panel's line shaping: dollars → rateCents, blank or
 *  invalid rows dropped. */
export function invoiceLineItemsOf(drafts: InvoiceLineDraft[]): InvoiceLineItem[] {
  return drafts
    .map((it) => ({
      description: it.description.trim(),
      quantity: Number(it.quantity),
      rateCents: Math.round(Number(it.rate) * 100),
    }))
    .filter((it) => it.description && it.quantity > 0 && Number.isFinite(it.rateCents) && it.rateCents >= 0);
}

/** The panel's running total over the same shaping rules. */
export function invoiceTotalCentsOf(drafts: InvoiceLineDraft[]): number {
  return drafts.reduce((sum, it) => {
    const qty = Number(it.quantity);
    const rate = Number(it.rate);
    if (!Number.isFinite(qty) || !Number.isFinite(rate) || qty <= 0 || rate < 0) return sum;
    return sum + Math.round(qty * rate * 100);
  }, 0);
}

export interface InvoiceInput {
  brandName: string;
  brandEmail: string;
  creatorName: string;
  creatorEmail: string;
  paymentDetails: string;
  items: InvoiceLineDraft[];
  currency: InvoiceCurrency;
  dueDate: string;
  notes: string;
}

/** The panel posts every field trimmed, line items shaped. */
export function invoicePayload(input: InvoiceInput): {
  brandName: string;
  brandEmail: string;
  creatorName: string;
  creatorEmail: string;
  paymentDetails: string;
  lineItems: InvoiceLineItem[];
  currency: InvoiceCurrency;
  dueDate: string;
  notes: string;
} {
  return {
    brandName: input.brandName.trim(),
    brandEmail: input.brandEmail.trim(),
    creatorName: input.creatorName.trim(),
    creatorEmail: input.creatorEmail.trim(),
    paymentDetails: input.paymentDetails.trim(),
    lineItems: invoiceLineItemsOf(input.items),
    currency: input.currency,
    dueDate: input.dueDate,
    notes: input.notes.trim(),
  };
}

/** The panel requires a brand, a creator name, and at least
 *  one real line item (outreach.invoice.fillRequired). */
export function invoiceCanRun(input: InvoiceInput): boolean {
  return (
    input.brandName.trim().length > 0 &&
    input.creatorName.trim().length > 0 &&
    invoiceLineItemsOf(input.items).length > 0
  );
}

/** The panel's default due date: today + 30 days, ISO date. */
export function invoiceDefaultDueDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  brandName: string;
  brandEmail: string | null;
  creatorName: string;
  creatorEmail: string | null;
  paymentDetails: string | null;
  lineItems: InvoiceLineItem[];
  totalCents: number;
  currency: string;
  dueDate: string;
  notes: string | null;
  status: "unpaid" | "paid";
  paidAt: string | null;
  createdAt: string;
}

function invoiceRecordOf(v: unknown): InvoiceRecord | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.invoiceNumber !== "string") return null;
  if (typeof r.brandName !== "string" || typeof r.creatorName !== "string") return null;
  const items: InvoiceLineItem[] = [];
  if (Array.isArray(r.lineItems)) {
    for (const li of r.lineItems) {
      if (!li || typeof li !== "object") continue;
      const row = li as Record<string, unknown>;
      items.push({
        description: typeof row.description === "string" ? row.description : "",
        quantity: typeof row.quantity === "number" ? row.quantity : 0,
        rateCents: typeof row.rateCents === "number" ? row.rateCents : 0,
      });
    }
  }
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    brandName: r.brandName,
    brandEmail: typeof r.brandEmail === "string" ? r.brandEmail : null,
    creatorName: r.creatorName,
    creatorEmail: typeof r.creatorEmail === "string" ? r.creatorEmail : null,
    paymentDetails: typeof r.paymentDetails === "string" ? r.paymentDetails : null,
    lineItems: items,
    totalCents: typeof r.totalCents === "number" ? r.totalCents : 0,
    currency: typeof r.currency === "string" ? r.currency : "USD",
    dueDate: typeof r.dueDate === "string" ? r.dueDate : "",
    notes: typeof r.notes === "string" ? r.notes : null,
    status: r.status === "paid" ? "paid" : "unpaid",
    paidAt: typeof r.paidAt === "string" ? r.paidAt : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

export interface InvoiceGenerated {
  invoice: InvoiceRecord;
  pdfBase64: string;
  pdfFilename: string;
  creditsRemaining: number | null;
}

/** The generate answer: the invoice AND its PDF or it didn't
 *  happen (the panel throws without either). */
export function invoiceGeneratedOf(data: unknown): InvoiceGenerated | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const invoice = invoiceRecordOf(d.invoice);
  if (!invoice) return null;
  if (typeof d.pdfBase64 !== "string" || d.pdfBase64.length === 0) return null;
  return {
    invoice,
    pdfBase64: d.pdfBase64,
    pdfFilename: typeof d.pdfFilename === "string" ? d.pdfFilename : `${invoice.invoiceNumber}.pdf`,
    creditsRemaining: typeof d.creditsRemaining === "number" ? d.creditsRemaining : null,
  };
}

/** The list answer (GET /api/invoices): rows that parse, or
 *  null when the payload itself drifted. */
export function invoiceListOf(data: unknown): InvoiceRecord[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.invoices)) return null;
  const out: InvoiceRecord[] = [];
  for (const v of d.invoices) {
    const rec = invoiceRecordOf(v);
    if (rec) out.push(rec);
  }
  return out;
}

/** The PATCH answer: the updated invoice, or null. */
export function invoiceUpdatedOf(data: unknown): InvoiceRecord | null {
  if (!data || typeof data !== "object") return null;
  return invoiceRecordOf((data as Record<string, unknown>).invoice);
}

/** The panel's money/date rendering, shared verbatim. */
export function formatInvoiceMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function formatInvoiceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The panel's PDF delivery: a base64 data-URL download. */
export function downloadBase64Pdf(base64: string, filename: string): void {
  const link = document.createElement("a");
  link.href = `data:application/pdf;base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* ─── B-14 · Sync One-Sheet — /api/sync-pitch/one-sheet (150) ─
   The Sync Pitch tab's generator (SyncTab generateSheet):
   { songTitle, artistName, songLibraryId?, genre, mood, bpm,
   musicalKey, energy (0–100 number), description,
   instrumentalAvailable, stemsAvailable, contactName,
   contactEmail } → { oneSheet }. In-World the song is typed
   (the census's typed-title form), so songLibraryId never
   rides; the 2D tab's library pick stays a 2D surface. */

export const ONE_SHEET_PATH = "/api/sync-pitch/one-sheet";

/** POST /api/sync-pitch/one-sheet — registry 150, the tab's
 *  generateSheet label ("Generate Sync One-Sheet · {{cost}}
 *  VB") reads the same price. */
export function oneSheetCost(): number {
  return registryCost(ONE_SHEET_PATH);
}

/** The tab's energy default (useState(60)). */
export const ONE_SHEET_DEFAULT_ENERGY = 60;

export interface OneSheetInput {
  songTitle: string;
  artistName: string;
  genre: string;
  mood: string;
  bpm: string;
  musicalKey: string;
  energy: number;
  description: string;
  instrumentalAvailable: boolean;
  stemsAvailable: boolean;
  contactName: string;
  contactEmail: string;
}

/** The tab posts every text field trimmed and energy as the
 *  number it holds; the library id is omitted in-World. */
export function oneSheetPayload(input: OneSheetInput): {
  songTitle: string;
  artistName: string;
  genre: string;
  mood: string;
  bpm: string;
  musicalKey: string;
  energy: number;
  description: string;
  instrumentalAvailable: boolean;
  stemsAvailable: boolean;
  contactName: string;
  contactEmail: string;
} {
  return {
    songTitle: input.songTitle.trim(),
    artistName: input.artistName.trim(),
    genre: input.genre.trim(),
    mood: input.mood.trim(),
    bpm: input.bpm.trim(),
    musicalKey: input.musicalKey.trim(),
    energy: input.energy,
    description: input.description.trim(),
    instrumentalAvailable: input.instrumentalAvailable,
    stemsAvailable: input.stemsAvailable,
    contactName: input.contactName.trim(),
    contactEmail: input.contactEmail.trim(),
  };
}

/** The tab refuses to run without a song title
 *  (syncPitch.titleRequired). */
export function oneSheetCanRun(input: OneSheetInput): boolean {
  return input.songTitle.trim().length > 0;
}

export interface OneSheetContent {
  logline: string;
  moodTags: string[];
  soundsLike: string;
  comparableArtists: string[];
  syncUses: string[];
  pitchEmail: { subject: string; body: string };
  licensingNotes: string;
  disclaimer: string;
}

export interface OneSheet {
  id: string;
  songTitle: string;
  artistName: string | null;
  songLibraryId: string | null;
  content: OneSheetContent;
  moodTags: string[];
  bpm: string | null;
  musicalKey: string | null;
  comparableArtists: string[];
  soundsLike: string | null;
  instrumentalAvailable: boolean;
  stemsAvailable: boolean;
  contactName: string | null;
  contactEmail: string | null;
  shareToken: string;
  createdAt: string | null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** The POST answer: the sheet with its content, or null on
 *  drift — a sheet without its logline/pitch email is not a
 *  one-sheet. */
export function oneSheetOf(data: unknown): OneSheet | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.oneSheet || typeof d.oneSheet !== "object") return null;
  const s = d.oneSheet as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.songTitle !== "string") return null;
  if (!s.content || typeof s.content !== "object") return null;
  const c = s.content as Record<string, unknown>;
  if (typeof c.logline !== "string" || !c.pitchEmail || typeof c.pitchEmail !== "object") return null;
  const email = c.pitchEmail as Record<string, unknown>;
  return {
    id: s.id,
    songTitle: s.songTitle,
    artistName: typeof s.artistName === "string" ? s.artistName : null,
    songLibraryId: typeof s.songLibraryId === "string" ? s.songLibraryId : null,
    content: {
      logline: c.logline,
      moodTags: stringList(c.moodTags),
      soundsLike: typeof c.soundsLike === "string" ? c.soundsLike : "",
      comparableArtists: stringList(c.comparableArtists),
      syncUses: stringList(c.syncUses),
      pitchEmail: {
        subject: typeof email.subject === "string" ? email.subject : "",
        body: typeof email.body === "string" ? email.body : "",
      },
      licensingNotes: typeof c.licensingNotes === "string" ? c.licensingNotes : "",
      disclaimer: typeof c.disclaimer === "string" ? c.disclaimer : "",
    },
    moodTags: stringList(s.moodTags),
    bpm: typeof s.bpm === "string" ? s.bpm : null,
    musicalKey: typeof s.musicalKey === "string" ? s.musicalKey : null,
    comparableArtists: stringList(s.comparableArtists),
    soundsLike: typeof s.soundsLike === "string" ? s.soundsLike : null,
    instrumentalAvailable: s.instrumentalAvailable === true,
    stemsAvailable: s.stemsAvailable === true,
    contactName: typeof s.contactName === "string" ? s.contactName : null,
    contactEmail: typeof s.contactEmail === "string" ? s.contactEmail : null,
    shareToken: typeof s.shareToken === "string" ? s.shareToken : "",
    createdAt: typeof s.createdAt === "string" ? s.createdAt : null,
  };
}

/** The tab's share URL for a sheet: <origin>/sync-one-sheet/
 *  <shareToken>. */
export function oneSheetShareUrl(origin: string, sheet: OneSheet): string {
  return `${origin}/sync-one-sheet/${sheet.shareToken}`;
}

/* ─── B-22 · Content Calendar — /api/content-calendar (150) ───
   Content Intelligence Step 5 (StepCalendar): { niche
   (≤ 120), platforms (subset of tiktok|youtube|instagram),
   postsPerWeek (clamped 1–14), startDate (ISO yyyy-mm-dd) }
   → { days?: CalendarDay[] }. A calendar only counts when
   at least one day carries a post (the step's own rule). */

export const CONTENT_CALENDAR_PATH = "/api/content-calendar";

/** POST /api/content-calendar — registry 150, the step's own
 *  COST constant and the registry agree. */
export function contentCalendarCost(): number {
  return registryCost(CONTENT_CALENDAR_PATH);
}

export const CALENDAR_PLATFORMS = ["tiktok", "youtube", "instagram"] as const;
export type CalendarPlatform = (typeof CALENDAR_PLATFORMS)[number];

/** The step's niche ceiling: 120 characters. */
export const CALENDAR_NICHE_MAX = 120;
/** The step's cadence clamp: 1–14 posts per week. */
export const CALENDAR_POSTS_MIN = 1;
export const CALENDAR_POSTS_MAX = 14;

export interface CalendarInput {
  niche: string;
  platforms: CalendarPlatform[];
  postsPerWeek: string;
  startDate: string;
}

/** The step posts the niche sliced to 120 and the cadence
 *  clamped into 1–14 (an unparseable cadence falls to 3). */
export function contentCalendarPayload(input: CalendarInput): {
  niche: string;
  platforms: CalendarPlatform[];
  postsPerWeek: number;
  startDate: string;
} {
  return {
    niche: input.niche.trim().slice(0, CALENDAR_NICHE_MAX),
    platforms: input.platforms,
    postsPerWeek: Math.max(
      CALENDAR_POSTS_MIN,
      Math.min(CALENDAR_POSTS_MAX, parseInt(input.postsPerWeek, 10) || 3),
    ),
    startDate: input.startDate,
  };
}

/** Today as an ISO date (yyyy-mm-dd) — the step's default
 *  start date. */
export function calendarTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface CalendarDay {
  date: string;
  dayLabel: string;
  post: boolean;
  title: string;
  format: string;
  platform: string;
  hook: string;
  bestTime: string;
}

/** The POST answer: the day list, kept only when at least one
 *  day carries a post (the step discards an all-rest calendar
 *  the same way). Null on drift. */
export function calendarDaysOf(data: unknown): CalendarDay[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.days)) return null;
  const days: CalendarDay[] = [];
  for (const v of d.days) {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    days.push({
      date: typeof r.date === "string" ? r.date : "",
      dayLabel: typeof r.dayLabel === "string" ? r.dayLabel : "",
      post: r.post === true,
      title: typeof r.title === "string" ? r.title : "",
      format: typeof r.format === "string" ? r.format : "",
      platform: typeof r.platform === "string" ? r.platform : "",
      hook: typeof r.hook === "string" ? r.hook : "",
      bestTime: typeof r.bestTime === "string" ? r.bestTime : "",
    });
  }
  return days.some((d2) => d2.post) ? days : null;
}

/* ─── B-22 · Stock — /api/stock/search (0) + /api/stock/import (50)
   The editor's Stock Library panel (StockLibraryPanel):
   search is a plain authed GET (free — no confirmation),
   import rides confirmedFetch at 50 and the imported file
   flows into the hub project exactly as the panel's does
   (addAsset — clip for video, image for photo). A 503 or the
   stock_not_configured error is the honest not-connected
   state, never a dressed-up failure. */

export const STOCK_SEARCH_PATH = "/api/stock/search";
export const STOCK_IMPORT_PATH = "/api/stock/import";

/** POST /api/stock/import — registry 50, the panel's price
 *  badge ("50 VB / import") and the registry agree. */
export function stockImportCost(): number {
  return registryCost(STOCK_IMPORT_PATH);
}

/** GET /api/stock/search — registry 0: browsing is free. */
export function stockSearchCost(): number {
  return registryCost(STOCK_SEARCH_PATH);
}

export const STOCK_TYPES = ["video", "photo"] as const;
export type StockType = (typeof STOCK_TYPES)[number];

/** The panel's page size. */
export const STOCK_PER_PAGE = 12;

export interface StockItem {
  id: string;
  type: StockType;
  title: string;
  previewUrl: string;
  fileUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationSec: number | null;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
}

/** The panel's search URL: q, type, page, per_page. */
export function stockSearchUrl(query: string, type: StockType, page: number): string {
  return `${STOCK_SEARCH_PATH}?q=${encodeURIComponent(query.trim())}&type=${type}&page=${page}&per_page=${STOCK_PER_PAGE}`;
}

/** The panel's import body — in-World there is no editor
 *  project id, so projectId is omitted (the panel sends it
 *  only when it has one). */
export function stockImportPayload(item: StockItem): {
  itemId: string;
  type: StockType;
  title: string;
  previewUrl: string;
  fileUrl: string;
  photographer: string;
  photographerUrl: string;
  width: number;
  height: number;
  durationSec?: number;
} {
  return {
    itemId: item.id,
    type: item.type,
    title: item.title,
    previewUrl: item.previewUrl,
    fileUrl: item.fileUrl,
    photographer: item.photographer,
    photographerUrl: item.photographerUrl,
    width: item.width,
    height: item.height,
    durationSec: item.durationSec ?? undefined,
  };
}

function stockItemOf(v: unknown): StockItem | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || (r.type !== "video" && r.type !== "photo")) return null;
  if (typeof r.fileUrl !== "string" || typeof r.previewUrl !== "string") return null;
  return {
    id: r.id,
    type: r.type,
    title: typeof r.title === "string" ? r.title : "",
    previewUrl: r.previewUrl,
    fileUrl: r.fileUrl,
    downloadUrl: typeof r.downloadUrl === "string" ? r.downloadUrl : "",
    width: typeof r.width === "number" ? r.width : 0,
    height: typeof r.height === "number" ? r.height : 0,
    durationSec: typeof r.durationSec === "number" ? r.durationSec : null,
    photographer: typeof r.photographer === "string" ? r.photographer : "",
    photographerUrl: typeof r.photographerUrl === "string" ? r.photographerUrl : "",
    sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : "",
  };
}

export interface StockSearchResult {
  items: StockItem[];
  totalResults: number;
}

/** The search answer: parseable items + the total, or null on
 *  drift. */
export function stockSearchOf(data: unknown): StockSearchResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items)) return null;
  const items: StockItem[] = [];
  for (const v of d.items) {
    const item = stockItemOf(v);
    if (item) items.push(item);
  }
  return { items, totalResults: typeof d.totalResults === "number" ? d.totalResults : items.length };
}

/** The import answer: success + the imported item, or null
 *  (the panel throws on anything less). */
export function stockImportedOf(data: unknown): StockItem | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.success !== true) return null;
  return stockItemOf(d.item);
}

/** The panel's not-configured verdict: a 503 or the
 *  stock_not_configured error code. */
export function stockNotConfigured(status: number, data: unknown): boolean {
  if (status === 503) return true;
  if (!data || typeof data !== "object") return false;
  return (data as Record<string, unknown>).error === "stock_not_configured";
}
