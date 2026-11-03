/* ─── Books desk seam (stack1400 world parity wave 2) ──────────────
   Thy Books — write / design / publish — native at My Studio, on
   the books router's own rails, the same endpoints pages/books.tsx
   calls:

     GET    /api/books                          → { books } (caller's,
                                                  camelCase DTO)
     POST   /api/books                          → create (FREE)
     GET    /api/books/:id                      → { book, chapters }
     PUT    /api/books/:id                      → update fields (FREE)
     DELETE /api/books/:id                      → delete (chapters
                                                  cascade; FREE)
     POST   /api/books/:id/chapters             → add chapter (FREE;
                                                  returns the RAW DB
                                                  row, snake_case)
     PUT    /api/books/:id/chapters/:chapterId  → title / content /
                                                  position / ai_notes
                                                  (FREE; word_count is
                                                  recomputed server-side)
     DELETE /api/books/:id/chapters/:chapterId  → delete chapter (FREE)
     POST   /api/books/ai/assist                → AI ghostwriter:
                                                  100 Visual Bucs per
                                                  assist (registry-pinned
                                                  in lib/credit-costs.ts;
                                                  the rail refunds a
                                                  failed generation)
     POST   /api/books/:id/cover/generate       → AI cover: 200 Visual
                                                  Bucs (registry-pinned;
                                                  the rail refunds any
                                                  post-charge failure)
     GET    /api/books/:id/export/epub          → EPUB download (FREE;
                                                  needs ≥1 chapter)
     GET    /api/books/:id/export/pdf           → print-ready PDF (FREE;
                                                  needs ≥1 chapter)
     POST   /api/books/:id/print/quote          → Lulu quote: the
                                                  SERVER returns priceVb
                                                  (print cost × markup) —
                                                  the desk never invents
                                                  a print price
     POST   /api/books/:id/print/order          → charge VB at the
                                                  server's quote maths +
                                                  submit to Lulu
     GET    /api/books/print/orders             → the caller's orders
     GET    /api/books/print/orders/:id/status  → refresh from Lulu
     POST   /api/books/print/orders/:id/cancel  → cancel before
                                                  production

   Every books rail is requireAuth — members only, exactly the 2D
   page's boundary (the page itself sits behind the site's sign-in
   gate). There is NO books publish/status rail: a book has no
   status field, and the 2D page's "Publish & Sell" is a link out
   to /storefronts, not a books endpoint — see the desk header for
   the verbatim gap. The desk's publish outputs are the ones the
   rails actually support: EPUB / PDF export and print-on-demand. */

export const BOOKS_PATH = "/api/books";
export const BOOK_AI_ASSIST_PATH = "/api/books/ai/assist";
export const BOOK_PRINT_ORDERS_PATH = "/api/books/print/orders";

export function bookPath(id: string): string {
  return `/api/books/${encodeURIComponent(id)}`;
}

export function bookChaptersPath(id: string): string {
  return `${bookPath(id)}/chapters`;
}

export function bookChapterPath(bookId: string, chapterId: string): string {
  return `${bookChaptersPath(bookId)}/${encodeURIComponent(chapterId)}`;
}

export function bookCoverPath(id: string): string {
  return `${bookPath(id)}/cover/generate`;
}

export function bookExportPath(id: string, format: "epub" | "pdf"): string {
  return `${bookPath(id)}/export/${format}`;
}

export function bookPrintQuotePath(id: string): string {
  return `${bookPath(id)}/print/quote`;
}

export function bookPrintOrderPath(id: string): string {
  return `${bookPath(id)}/print/order`;
}

export function bookPrintOrderStatusPath(orderId: string): string {
  return `${BOOK_PRINT_ORDERS_PATH}/${encodeURIComponent(orderId)}/status`;
}

export function bookPrintOrderCancelPath(orderId: string): string {
  return `${BOOK_PRINT_ORDERS_PATH}/${encodeURIComponent(orderId)}/cancel`;
}

/** Registry-pinned prices (lib/credit-costs.ts:
 *  "/api/books/ai/assist": { cost: 100, feature: "Thy Books AI Writing Assist" }
 *  "/api/books/:id/cover/generate": { cost: 200, feature: "Thy Books AI Cover Generation" }).
 *  Print carries NO pinned price — the server quote rules it. */
export const BOOK_AI_ASSIST_COST_VB = 100;
export const BOOK_AI_ASSIST_FEATURE = "Thy Books AI Writing Assist";
export const BOOK_COVER_COST_VB = 200;
export const BOOK_COVER_FEATURE = "Thy Books AI Cover Generation";

/* ─── Shapes ─────────────────────────────────────────────────────── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export interface BookSummary {
  id: string;
  title: string;
  subtitle: string | null;
  authorName: string | null;
  genre: string | null;
  description: string | null;
  coverUrl: string | null;
  updatedAt: string;
}

/** The list + detail book DTO is camelCase (the router maps it). */
function normalizeBookRow(r: Record<string, unknown>): BookSummary | null {
  const id = str(r["id"]);
  const title = str(r["title"]);
  if (!id || !title) return null;
  return {
    id,
    title,
    subtitle: strOrNull(r["subtitle"]),
    authorName: strOrNull(r["authorName"]),
    genre: strOrNull(r["genre"]),
    description: strOrNull(r["description"]),
    coverUrl: strOrNull(r["coverUrl"]),
    updatedAt: str(r["updatedAt"]),
  };
}

export function normalizeBooks(payload: unknown): BookSummary[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["books"])) return null;
  const out: BookSummary[] = [];
  for (const raw of root["books"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const row = normalizeBookRow(r);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

export interface BookChapter {
  id: string;
  title: string;
  content: string;
  position: number;
  aiNotes: string | null;
  wordCount: number;
  updatedAt: string;
}

/** Detail chapters arrive camelCase from GET /api/books/:id … */
function normalizeChapterRow(r: Record<string, unknown>): BookChapter | null {
  const id = str(r["id"]);
  const title = str(r["title"]);
  if (!id || !title) return null;
  return {
    id,
    title,
    content: str(r["content"]),
    position: num(r["position"]),
    aiNotes: strOrNull(r["aiNotes"]),
    wordCount: num(r["wordCount"]),
    updatedAt: str(r["updatedAt"]),
  };
}

export interface BookDetail {
  book: BookSummary;
  chapters: BookChapter[];
}

export function normalizeBookDetail(payload: unknown): BookDetail | null {
  const root = asRecord(payload);
  const bookRaw = root ? asRecord(root["book"]) : null;
  if (!bookRaw) return null;
  const book = normalizeBookRow(bookRaw);
  if (!book) return null;
  const chapters: BookChapter[] = [];
  if (Array.isArray(root["chapters"])) {
    for (const raw of root["chapters"]) {
      const r = asRecord(raw);
      if (!r) return null;
      const ch = normalizeChapterRow(r);
      if (!ch) return null;
      chapters.push(ch);
    }
  }
  return { book, chapters };
}

/** … but POST /chapters returns the raw DB row (snake_case:
 *  word_count / ai_notes / updated_at). One normalizer for both. */
export function normalizeCreatedChapter(payload: unknown): BookChapter | null {
  const root = asRecord(payload);
  const r = root ? asRecord(root["chapter"]) : null;
  if (!r) return null;
  const id = str(r["id"]);
  const title = str(r["title"]);
  if (!id || !title) return null;
  return {
    id,
    title,
    content: str(r["content"]),
    position: num(r["position"]),
    aiNotes: strOrNull(r["ai_notes"]) ?? strOrNull(r["aiNotes"]),
    wordCount: num(r["word_count"] ?? r["wordCount"]),
    updatedAt: str(r["updated_at"] ?? r["updatedAt"]),
  };
}

/* ─── Book form — the rail's zod rules ─────────────────────────────
   CreateBookSchema: title 1–200, subtitle ≤200, author_name ≤200,
   genre ≤100, description ≤2000. Update is the same, partial. */

export interface BookForm {
  title: string;
  subtitle: string;
  authorName: string;
  genre: string;
  description: string;
}

export const EMPTY_BOOK_FORM: BookForm = {
  title: "",
  subtitle: "",
  authorName: "",
  genre: "",
  description: "",
};

export function bookFormFromSummary(b: BookSummary): BookForm {
  return {
    title: b.title,
    subtitle: b.subtitle ?? "",
    authorName: b.authorName ?? "",
    genre: b.genre ?? "",
    description: b.description ?? "",
  };
}

export function bookFormReady(form: BookForm): boolean {
  const title = form.title.trim();
  return (
    title.length >= 1 &&
    title.length <= 200 &&
    form.subtitle.length <= 200 &&
    form.authorName.length <= 200 &&
    form.genre.length <= 100 &&
    form.description.length <= 2000
  );
}

/** The rail's body shape: author rides as author_name. */
export function buildBookBody(form: BookForm): Record<string, unknown> {
  return {
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    author_name: form.authorName.trim(),
    genre: form.genre.trim(),
    description: form.description.trim(),
  };
}

/* ─── Chapters ───────────────────────────────────────────────────── */

export function chapterTitleReady(title: string): boolean {
  const t = title.trim();
  return t.length >= 1 && t.length <= 200;
}

export function buildChapterCreateBody(title: string): Record<string, unknown> {
  return { title: title.trim() };
}

export function buildChapterContentBody(content: string): Record<string, unknown> {
  return { content };
}

export function buildChapterTitleBody(title: string): Record<string, unknown> {
  return { title: title.trim() };
}

/** The page's own word counter (the server recomputes on save; this
 *  is the desk's live read-out). */
export function countBookWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function totalBookWords(chapters: BookChapter[], activeId: string | null, activeContent: string): number {
  return chapters.reduce(
    (sum, c) => sum + (c.id === activeId ? countBookWords(activeContent) : c.wordCount),
    0,
  );
}

/** Exports refuse on the rail with no chapters — the desk arms its
 *  buttons on the same rule instead of letting the tap fail. */
export function bookExportReady(chapterCount: number): boolean {
  return chapterCount >= 1;
}

/* ─── AI ghostwriter ───────────────────────────────────────────────
   AiAssistSchema actions; continue/rewrite/expand work on chapter
   text, outline/title-ideas/blurb work from the book description —
   the page's own split (chapterOnly). */

export type BookAssistAction = "continue" | "rewrite" | "expand" | "outline" | "title-ideas" | "blurb";

export const BOOK_ASSIST_ACTIONS: ReadonlyArray<{
  id: BookAssistAction;
  label: string;
  chapterOnly: boolean;
}> = [
  { id: "continue", label: "Continue writing", chapterOnly: true },
  { id: "rewrite", label: "Rewrite passage", chapterOnly: true },
  { id: "expand", label: "Expand scene", chapterOnly: true },
  { id: "outline", label: "Chapter outline", chapterOnly: false },
  { id: "title-ideas", label: "Title ideas", chapterOnly: false },
  { id: "blurb", label: "Back-cover blurb", chapterOnly: false },
];

export function assistActionChapterOnly(action: BookAssistAction): boolean {
  return BOOK_ASSIST_ACTIONS.find((a) => a.id === action)?.chapterOnly ?? false;
}

/** Outline/title/blurb results are book-level words — the page
 *  never inserts them into a chapter, and neither does the desk. */
export function assistResultInsertable(action: BookAssistAction): boolean {
  return assistActionChapterOnly(action);
}

export function buildAssistBody(args: {
  bookId: string;
  chapterId?: string | null;
  action: BookAssistAction;
  text: string;
  instruction: string;
}): Record<string, unknown> {
  return {
    bookId: args.bookId,
    ...(args.chapterId ? { chapterId: args.chapterId } : {}),
    action: args.action,
    text: args.text,
    instruction: args.instruction,
  };
}

export function normalizeAssistResult(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const result = str(root["result"]);
  return result.length > 0 ? result : null;
}

/* ─── Cover ──────────────────────────────────────────────────────── */

export function buildCoverBody(style: string): Record<string, unknown> {
  return { style: style.trim() };
}

export function normalizeCoverResult(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  return strOrNull(root["cover_url"]);
}

/* ─── Print on demand (Lulu, via the books rails) ──────────────────
   QuoteSchema: countryCode 2 letters, quantity 1–100, color bw|color.
   OrderSchema: a full shipping address, a shipping level from the
   quote's options, contactEmail. The PRICE is the server's: the
   quote returns priceVb for the print cost and markup; the total
   (print + chosen shipping) follows the 2D page's exact formula —
   ceil(totalUsd × 100 × 2 × markup), 2 = the rail's
   USD_CENTS_TO_VB — which is the same maths the order rail charges. */

export const BOOK_PRINT_COLORS = [
  { key: "bw", label: "Black & white" },
  { key: "color", label: "Color" },
] as const;

export const BOOK_PRINT_SHIPPING_LEVELS = ["MAIL", "PRIORITY_MAIL", "GROUND", "EXPEDITED", "EXPRESS"] as const;

export interface BookPrintAddressForm {
  name: string;
  street1: string;
  street2: string;
  city: string;
  stateCode: string;
  countryCode: string;
  postcode: string;
  phoneNumber: string;
  contactEmail: string;
}

export const EMPTY_PRINT_ADDRESS: BookPrintAddressForm = {
  name: "",
  street1: "",
  street2: "",
  city: "",
  stateCode: "",
  countryCode: "US",
  postcode: "",
  phoneNumber: "",
  contactEmail: "",
};

/** The page's own gate before it asks for a quote: the shipping
 *  details that the order schema will demand anyway. */
export function printAddressReady(form: BookPrintAddressForm): boolean {
  return (
    form.name.trim().length >= 1 &&
    form.street1.trim().length >= 1 &&
    form.city.trim().length >= 1 &&
    form.postcode.trim().length >= 1 &&
    form.phoneNumber.trim().length >= 1 &&
    /.+@.+\..+/.test(form.contactEmail.trim()) &&
    form.countryCode.trim().length === 2
  );
}

export function printQuantityReady(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 100;
}

export function buildPrintQuoteBody(args: {
  form: BookPrintAddressForm;
  quantity: number;
  color: string;
}): Record<string, unknown> {
  return {
    countryCode: args.form.countryCode.trim() || "US",
    ...(args.form.stateCode.trim() ? { stateCode: args.form.stateCode.trim() } : {}),
    postcode: args.form.postcode.trim(),
    quantity: args.quantity,
    color: args.color,
  };
}

export function buildPrintOrderBody(args: {
  form: BookPrintAddressForm;
  shippingLevel: string;
  quantity: number;
  color: string;
}): Record<string, unknown> {
  const f = args.form;
  return {
    shippingAddress: {
      name: f.name.trim(),
      street1: f.street1.trim(),
      ...(f.street2.trim() ? { street2: f.street2.trim() } : {}),
      city: f.city.trim(),
      ...(f.stateCode.trim() ? { state_code: f.stateCode.trim() } : {}),
      country_code: f.countryCode.trim() || "US",
      postcode: f.postcode.trim(),
      phone_number: f.phoneNumber.trim(),
    },
    shippingLevel: args.shippingLevel,
    quantity: args.quantity,
    color: args.color,
    contactEmail: f.contactEmail.trim(),
  };
}

export interface BookPrintShippingOption {
  id: string;
  label: string;
  costUsd: number;
}

export interface BookPrintQuote {
  pageCount: number;
  quantity: number;
  printCostUsd: number;
  priceVb: number;
  markup: number;
  shippingOptions: BookPrintShippingOption[];
}

export function normalizePrintQuote(payload: unknown): BookPrintQuote | null {
  const root = asRecord(payload);
  if (!root) return null;
  /* A quote without the server's own numbers is not a quote — the
     desk never fills a price in from defaults. */
  if (
    typeof root["pageCount"] !== "number" ||
    typeof root["printCostUsd"] !== "number" ||
    typeof root["priceVb"] !== "number"
  ) {
    return null;
  }
  const options: BookPrintShippingOption[] = [];
  if (Array.isArray(root["shippingOptions"])) {
    for (const raw of root["shippingOptions"]) {
      const s = asRecord(raw);
      if (!s) return null;
      const id = str(s["id"]);
      if (!id) return null;
      options.push({ id, label: str(s["label"]) || id, costUsd: num(s["costUsd"]) });
    }
  }
  return {
    pageCount: num(root["pageCount"]),
    quantity: num(root["quantity"]) || 1,
    printCostUsd: num(root["printCostUsd"]),
    priceVb: num(root["priceVb"]),
    markup: num(root["markup"]) || 1.5,
    shippingOptions: options,
  };
}

/** Total VB for print + shipping — the 2D page's formula, which is
 *  the order rail's own charge maths (USD_CENTS_TO_VB = 2). Used
 *  ONLY to name the charge in the confirmation; the rail recomputes
 *  and charges its own number. */
export function printTotalVb(quote: BookPrintQuote, shippingCostUsd: number): number {
  return Math.ceil((quote.printCostUsd + shippingCostUsd) * 100 * 2 * quote.markup);
}

export interface BookPrintOrder {
  id: string;
  bookId: string;
  status: string;
  quantity: number;
  pageCount: number;
  amountCents: number;
  createdAt: string;
}

export function normalizePrintOrders(payload: unknown): BookPrintOrder[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["orders"])) return null;
  const out: BookPrintOrder[] = [];
  for (const raw of root["orders"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    if (!id) return null;
    out.push({
      id,
      bookId: str(r["bookId"]),
      status: str(r["status"]) || "submitted",
      quantity: num(r["quantity"]),
      pageCount: num(r["pageCount"]),
      amountCents: num(r["amountCents"]),
      createdAt: str(r["createdAt"]),
    });
  }
  return out;
}

export function normalizePrintOrderPlaced(payload: unknown): { orderId: string; priceVb: number } | null {
  const root = asRecord(payload);
  if (!root) return null;
  const orderId = str(root["orderId"]);
  if (!orderId) return null;
  return { orderId, priceVb: num(root["priceVb"]) };
}
