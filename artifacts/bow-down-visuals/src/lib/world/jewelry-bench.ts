/**
 * jewelry-bench.ts — the Jewelry Bench's pure logic (Stack-100 #74).
 *
 * The Branding Atelier's missing desk. The 2D surface is a real tool —
 * the Logo-to-Luxury Studio (pages/jewelry.tsx, a tab of the branding
 * kit hub): upload a logo → pick piece/metal/stone/style (or garment)
 * → AI design preview → manufacturing STL → free cost estimate →
 * get-it-made guide → NFC setup, with a paid-per-message consultant.
 * Every step rides the studio's own rails (routes/generate/jewelry.ts):
 *
 *   GET  /api/jewelry/status   the catalog + the rail's own prices
 *   GET  /api/jewelry/guide    the get-it-made guide sections
 *   POST /api/jewelry/design   FormData preview — 200 VB (registry)
 *   POST /api/jewelry/export-stl  FormData STL — 400 VB (registry)
 *   POST /api/jewelry/estimate JSON estimate — FREE (pure calculator)
 *   POST /api/jewelry/consult  JSON chat — 100 VB per message (registry)
 *
 * Prices are NEVER invented here: the bench reads them from the
 * status catalog the rail itself serves, falling back to the credit
 * registry's figures (lib/credit-costs) only while the catalog loads.
 * Paid calls go through confirmedFetch — the same confirmation law as
 * the website (the 2D page confirms design + STL the same way; its
 * consult sends unconfirmed, and the bench deliberately holds the
 * house line instead: every charge is confirmed first).
 *
 * The "get it made" step on the website links to the jewelry shop
 * (/jewelry-shop, a storefront with its own order rail) carrying the
 * design in localStorage — the bench keeps that honest handoff as its
 * transfer footer and completes everything the bench itself owns.
 */

/* ─── Costs (Visual Bucs, x100 — the credit registry's own entries;
   the live figures come from GET /api/jewelry/status) ─────────────── */
export const JEWELRY_DESIGN_COST_VISUAL_BUCS = 200;
export const JEWELRY_STL_COST_VISUAL_BUCS = 400;
export const JEWELRY_CONSULT_COST_VISUAL_BUCS = 100;

export type JewelryCategory = "jewelry" | "apparel";

export interface JewelryOpts {
  piece: string;
  metal: string;
  stone: string;
  style: string;
  nfc: boolean;
  nfcUrl: string;
  notes: string;
}

export interface ApparelOpts {
  product: string;
  deco: string;
  color: string;
  notes: string;
}

export interface JewelryCatalog {
  previewCreditCost: number;
  stlCreditCost: number;
  consultCreditCost: number;
  pieces: Array<{ key: string; label: string }>;
  metals: Array<{ key: string; label: string }>;
  stones: Array<{ key: string; label: string }>;
  styles: Array<{ key: string; label: string }>;
  apparel: Array<{ key: string; label: string }>;
  decoMethods: Array<{ key: string; label: string }>;
  defaults: { jewelry: JewelryOpts; apparel: ApparelOpts } | null;
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

function labelRows(v: unknown): Array<{ key: string; label: string }> {
  const r = asRecord(v);
  const out: Array<{ key: string; label: string }> = [];
  for (const [key, raw] of Object.entries(r)) {
    const label = str(asRecord(raw)["label"]);
    if (label) out.push({ key, label });
  }
  return out;
}

function parseJewelryOpts(v: unknown): JewelryOpts {
  const o = asRecord(v);
  return {
    piece: str(o["piece"]) ?? "diamond-pendant",
    metal: str(o["metal"]) ?? "yellow-14k",
    stone: str(o["stone"]) ?? "diamond",
    style: str(o["style"]) ?? "iced-out",
    nfc: o["nfc"] !== false,
    nfcUrl: str(o["nfcUrl"]) ?? "",
    notes: str(o["notes"]) ?? "",
  };
}

function parseApparelOpts(v: unknown): ApparelOpts {
  const o = asRecord(v);
  return {
    product: str(o["product"]) ?? "t-shirt",
    deco: str(o["deco"]) ?? "print",
    color: str(o["color"]) ?? "Black",
    notes: str(o["notes"]) ?? "",
  };
}

/** GET /api/jewelry/status — the rail's catalog. Null when the answer
 *  carries no usable option lists (the bench shows an honest failure
 *  with a retry, never an invented catalog). Costs fall back to the
 *  registry figures when the catalog omits them. */
export function parseJewelryCatalog(data: unknown): JewelryCatalog | null {
  const d = asRecord(data);
  const pieces = labelRows(d["pieces"]);
  const metals = labelRows(d["metals"]);
  if (pieces.length === 0 || metals.length === 0) return null;
  const defaults = asRecord(d["defaults"]);
  return {
    previewCreditCost: num(d["previewCreditCost"]) ?? JEWELRY_DESIGN_COST_VISUAL_BUCS,
    stlCreditCost: num(d["stlCreditCost"]) ?? JEWELRY_STL_COST_VISUAL_BUCS,
    consultCreditCost: num(d["consultCreditCost"]) ?? JEWELRY_CONSULT_COST_VISUAL_BUCS,
    pieces,
    metals,
    stones: labelRows(d["stones"]),
    styles: labelRows(d["styles"]),
    apparel: labelRows(d["apparel"]),
    decoMethods: labelRows(d["decoMethods"]),
    defaults:
      Object.keys(defaults).length > 0
        ? { jewelry: parseJewelryOpts(defaults["jewelry"]), apparel: parseApparelOpts(defaults["apparel"]) }
        : null,
  };
}

export interface JewelryGuideSection {
  title: string;
  body: string;
}

/** GET /api/jewelry/guide — the get-it-made sections. */
export function parseJewelryGuide(data: unknown): JewelryGuideSection[] {
  const rows = asRecord(data)["sections"];
  if (!Array.isArray(rows)) return [];
  const out: JewelryGuideSection[] = [];
  for (const raw of rows) {
    const s = asRecord(raw);
    const title = str(s["title"]);
    if (!title) continue;
    out.push({ title, body: str(s["body"]) ?? "" });
  }
  return out;
}

/** The guide sections the page shows for a category: the apparel
 *  bench reads the Apparel-titled sections, the jewelry bench the
 *  rest (the page's own filter). */
export function guideSectionsFor(sections: JewelryGuideSection[], category: JewelryCategory): JewelryGuideSection[] {
  return sections.filter((s) => (category === "jewelry" ? !s.title.includes("Apparel") : s.title.includes("Apparel")));
}

/** The FormData fields for design / STL: the page appends the logo
 *  file, the category, then every option as a string — this is the
 *  field list in the page's own order (the file itself is attached by
 *  the caller, since FormData is a browser object). */
export function jewelryFormFields(
  category: JewelryCategory,
  opts: JewelryOpts | ApparelOpts,
): Array<[string, string]> {
  const fields: Array<[string, string]> = [["category", category]];
  for (const [k, v] of Object.entries(opts)) fields.push([k, String(v)]);
  return fields;
}

/** POST /api/jewelry/estimate — the page's body (free). The STL
 *  weight rides along when a file was already built. */
export function buildJewelryEstimatePayload(input: {
  category: JewelryCategory;
  opts: JewelryOpts | ApparelOpts;
  weightG?: number;
  qty: number;
}): Record<string, unknown> {
  return {
    category: input.category,
    options: input.opts,
    weightG: input.weightG,
    qty: input.qty,
  };
}

export interface JewelryEstimateLine {
  label: string;
  lowUSD: number;
  highUSD: number;
  note: string;
}

export interface JewelryEstimate {
  lines: JewelryEstimateLine[];
  totalLowUSD: number;
  totalHighUSD: number;
  weightG: number;
  stoneCount: number;
  turnaroundWeeks: [number, number];
  disclaimer: string;
}

/** The estimate out of POST /api/jewelry/estimate ({ estimate }). */
export function parseJewelryEstimate(data: unknown): JewelryEstimate | null {
  const e = asRecord(asRecord(data)["estimate"]);
  if (num(e["totalLowUSD"]) === null || num(e["totalHighUSD"]) === null) return null;
  const lines: JewelryEstimateLine[] = Array.isArray(e["lines"])
    ? (e["lines"] as unknown[]).map(asRecord).filter((l) => str(l["label"])).map((l) => ({
        label: str(l["label"])!,
        lowUSD: num(l["lowUSD"]) ?? 0,
        highUSD: num(l["highUSD"]) ?? 0,
        note: str(l["note"]) ?? "",
      }))
    : [];
  const weeks = e["turnaroundWeeks"];
  return {
    lines,
    totalLowUSD: num(e["totalLowUSD"])!,
    totalHighUSD: num(e["totalHighUSD"])!,
    weightG: num(e["weightG"]) ?? 0,
    stoneCount: num(e["stoneCount"]) ?? 0,
    turnaroundWeeks:
      Array.isArray(weeks) && typeof weeks[0] === "number" && typeof weeks[1] === "number"
        ? [weeks[0], weeks[1]]
        : [0, 0],
    disclaimer: str(e["disclaimer"]) ?? "",
  };
}

export interface JewelryStlInfo {
  url: string;
  facetCount: number;
  volumeMm3: number;
  weightG: number;
  metal: string;
  widthMm: number;
  heightMm: number;
  nfcPocket: boolean;
  pieceNote: string;
}

/** The answer of POST /api/jewelry/export-stl. */
export function parseJewelryStl(data: unknown): JewelryStlInfo | null {
  const d = asRecord(data);
  const url = str(d["url"]);
  if (!url) return null;
  return {
    url,
    facetCount: num(d["facetCount"]) ?? 0,
    volumeMm3: num(d["volumeMm3"]) ?? 0,
    weightG: num(d["weightG"]) ?? 0,
    metal: str(d["metal"]) ?? "",
    widthMm: num(d["widthMm"]) ?? 0,
    heightMm: num(d["heightMm"]) ?? 0,
    nfcPocket: d["nfcPocket"] === true,
    pieceNote: str(d["pieceNote"]) ?? "",
  };
}

/** The design preview's URL out of POST /api/jewelry/design. */
export function parseJewelryDesignUrl(data: unknown): string | null {
  return str(asRecord(data)["url"]);
}

/** POST /api/jewelry/consult — the page's body: the message, the last
 *  10 turns, and the bench's current picks as context. */
export function buildJewelryConsultPayload(input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  category: JewelryCategory;
  jewelry: JewelryOpts;
  apparel: ApparelOpts;
}): Record<string, unknown> {
  return {
    message: input.message,
    history: input.history.slice(-10),
    context: { category: input.category, jewelry: input.jewelry, apparel: input.apparel },
  };
}

/** The consultant's reply out of POST /api/jewelry/consult. */
export function parseJewelryConsultReply(data: unknown): string | null {
  return str(asRecord(data)["reply"]);
}

/** The localStorage handoff the website's Get-it-made step writes
 *  before linking to the jewelry shop — the bench writes the same
 *  record so the design is never lost in transit. */
export function buildJewelryShopHandoff(input: {
  category: JewelryCategory;
  jewelry: JewelryOpts;
  apparel: ApparelOpts;
  estimate: JewelryEstimate | null;
  at: number;
}): Record<string, unknown> {
  return {
    category: input.category,
    jOpts: input.jewelry,
    aOpts: input.apparel,
    estimate: input.estimate
      ? {
          total: `$${input.estimate.totalLowUSD.toLocaleString()}–$${input.estimate.totalHighUSD.toLocaleString()}`,
          currency: "USD",
        }
      : null,
    at: input.at,
  };
}

export const JEWELRY_HANDOFF_KEY = "bdv_jewelry_handoff";
export const JEWELRY_SHOP_PATH = "/jewelry-shop";
