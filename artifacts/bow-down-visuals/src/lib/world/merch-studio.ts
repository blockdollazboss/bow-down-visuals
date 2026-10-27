/**
 * merch-studio.ts — the Merch Bench's pure logic (World parity P3-C).
 *
 * The Branding Atelier's missing workbench. On the website the merch
 * line lives inside the Branding Shop's Merch tab (pages/
 * branding-shop.tsx) plus the Wave 8 drop planner (components/wave8/
 * MerchDropPlanner.tsx); in the palace the bench carries all three
 * benches on the same rails — no parallel store, no second ledger:
 *
 *   Product Photo Studio   POST /api/merch/design          300 VB
 *                          a batch of two product mockups; a
 *                          failed batch is auto-refunded by the
 *                          rail (routes/generate/merch.ts).
 *   Merch Drop Planner     POST /api/wave8/merch-drop/plan 100 VB
 *                          3 concepts + a 5-post launch week;
 *                          POST …/save (free) files the plan and
 *                          queues the posts in the content
 *                          calendar; GET …/plans reads them back.
 *   The Merch store        GET  /api/merch/designs (the saved
 *                          designs with the rail's own margin math)
 *                          POST /api/merch/designs (free — save a
 *                          mockup as a priced draft)
 *                          PATCH/DELETE /api/merch/designs/:id
 *                          POST /api/merch/designs/:id/order —
 *                          an order INTENT: while payments are not
 *                          live it records interest and NEVER
 *                          charges (the rail answers coming_soon).
 *
 * Prices come from the rails and the credit registry — the two Buc
 * figures below are the registry's own ("/api/merch/design" 300,
 * "/api/wave8/merch-drop/plan" 100) and the catalog mirrors the
 * rail's pricing module (routes/generate/merch-pricing.ts: the
 * same products, styles and base costs the website renders). The
 * 15% house commission is the rail's recorded intent for when
 * merch checkout opens — the bench shows margins with it, exactly
 * like the website, and never presents a sale as possible today.
 */

/* ─── Catalog mirrors (the rail's pricing module, word for word) ── */

export interface MerchProduct {
  key: string;
  label: string;
  blurb: string;
  baseCostCents: number;
}

export const MERCH_PRODUCTS: MerchProduct[] = [
  { key: "t-shirt", label: "T-Shirt", blurb: "Classic crew tee.", baseCostCents: 1200 },
  { key: "hoodie", label: "Hoodie", blurb: "Heavyweight pullover.", baseCostCents: 2800 },
  { key: "cap", label: "Cap", blurb: "Snapback / dad hat.", baseCostCents: 1500 },
  { key: "poster", label: "Poster", blurb: "18″×24″ matte print.", baseCostCents: 800 },
];

export interface MerchStyle {
  key: string;
  label: string;
  blurb: string;
}

export const MERCH_STYLES: MerchStyle[] = [
  { key: "streetwear", label: "Streetwear", blurb: "Bold graphics, urban energy." },
  { key: "minimal", label: "Minimal", blurb: "Clean, subtle, timeless." },
  { key: "vintage", label: "Vintage", blurb: "Retro, worn-in, classic." },
  { key: "luxury-gold", label: "Luxury Gold", blurb: "Black & gold, premium finish." },
];

export function merchProductLabel(key: string): string {
  return MERCH_PRODUCTS.find((p) => p.key === key)?.label ?? key;
}
export function merchStyleLabel(key: string): string {
  return MERCH_STYLES.find((s) => s.key === key)?.label ?? key;
}

/** The registry's own prices — display fallbacks; the confirmation
 *  dialog reads the registry itself. */
export const MERCH_DESIGN_COST_VISUAL_BUCS = 300;
export const MERCH_DROP_PLAN_COST_VISUAL_BUCS = 100;

/* ─── Photo Studio: the design batch ─────────────────────────────── */

export interface MerchMockup {
  url: string;
  path: string;
}

export interface MerchDesignBatch {
  mockups: MerchMockup[];
  product: string;
  style: string;
  title: string;
  baseCostCents: number | null;
  suggestedPriceCents: number | null;
  commissionPct: number | null;
  creditsRemaining: number | null;
}

export function buildMerchDesignPayload(input: {
  product: string;
  style: string;
  description: string;
  title: string;
}): Record<string, unknown> {
  return {
    product: input.product,
    style: input.style,
    description: input.description,
    title: input.title,
  };
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

/** POST /api/merch/design — a batch only counts when the rail says
 *  it succeeded AND product photos actually came back. */
export function parseMerchDesignBatch(data: unknown): MerchDesignBatch | null {
  const d = asRecord(data);
  if (d["status"] !== "succeeded" || !Array.isArray(d["mockups"])) return null;
  const mockups: MerchMockup[] = [];
  for (const raw of d["mockups"] as unknown[]) {
    const m = asRecord(raw);
    const url = str(m["url"]);
    if (url) mockups.push({ url, path: typeof m["path"] === "string" ? m["path"] : "" });
  }
  if (mockups.length === 0) return null;
  return {
    mockups,
    product: str(d["product"]) ?? "",
    style: str(d["style"]) ?? "",
    title: str(d["title"]) ?? "",
    baseCostCents: num(d["baseCostCents"]),
    suggestedPriceCents: num(d["suggestedPriceCents"]),
    commissionPct: num(d["commissionPct"]),
    creditsRemaining: num(d["creditsRemaining"]),
  };
}

/** POST /api/merch/designs — a mockup becomes a priced draft in the
 *  store (the website's save body, field for field). */
export function buildMerchSavePayload(input: {
  title: string;
  product: string;
  style: string;
  prompt: string;
  mockup: MerchMockup;
  priceCents: number;
}): Record<string, unknown> {
  return {
    title: input.title,
    product: input.product,
    style: input.style,
    prompt: input.prompt,
    imageUrl: input.mockup.url,
    imagePath: input.mockup.path,
    priceCents: input.priceCents,
    status: "draft",
  };
}

/* ─── The Merch store ────────────────────────────────────────────── */

export interface MerchMargin {
  profitCents: number;
  marginPct: number;
  commissionCents: number;
}

export interface MerchStoreDesign {
  id: string;
  title: string;
  product: string;
  style: string;
  prompt: string;
  imageUrl: string;
  priceCents: number;
  baseCostCents: number;
  status: string;
  margin: MerchMargin | null;
  createdAt: string;
}

export interface MerchStore {
  designs: MerchStoreDesign[];
  commissionPct: number | null;
  paymentsLive: boolean;
}

function parseMargin(v: unknown): MerchMargin | null {
  const m = asRecord(v);
  const profitCents = num(m["profitCents"]);
  const marginPct = num(m["marginPct"]);
  const commissionCents = num(m["commissionCents"]);
  if (profitCents === null || marginPct === null || commissionCents === null) return null;
  return { profitCents, marginPct, commissionCents };
}

function parseDesignRow(v: unknown): MerchStoreDesign | null {
  const r = asRecord(v);
  const id = str(r["id"]);
  if (!id) return null;
  return {
    id,
    title: str(r["title"]) ?? "",
    product: str(r["product"]) ?? "",
    style: str(r["style"]) ?? "",
    prompt: str(r["prompt"]) ?? "",
    imageUrl: str(r["image_url"]) ?? "",
    priceCents: num(r["price_cents"]) ?? 0,
    baseCostCents: num(r["base_cost_cents"]) ?? 0,
    status: str(r["status"]) ?? "draft",
    margin: parseMargin(r["margin"]),
    createdAt: str(r["created_at"]) ?? "",
  };
}

/** GET /api/merch/designs — null on a foreign answer; margins ride
 *  the rail's own math, never recomputed at the bench. */
export function parseMerchStore(data: unknown): MerchStore | null {
  const d = asRecord(data);
  if (!Array.isArray(d["designs"])) return null;
  return {
    designs: (d["designs"] as unknown[]).map(parseDesignRow).filter((r): r is MerchStoreDesign => r !== null),
    commissionPct: num(d["commissionPct"]),
    paymentsLive: d["paymentsLive"] === true,
  };
}

/** PATCH /api/merch/designs/:id — only the fields being changed. */
export function buildMerchPatchPayload(patch: {
  title?: string;
  priceCents?: number;
  status?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.title !== undefined) out["title"] = patch.title;
  if (patch.priceCents !== undefined) out["priceCents"] = patch.priceCents;
  if (patch.status !== undefined) out["status"] = patch.status;
  return out;
}

export interface MerchOrderIntent {
  status: string;
  message: string;
  paymentsLive: boolean;
}

/** POST /api/merch/designs/:id/order — the intent's own words ride
 *  back; until payments open the rail answers coming_soon and no
 *  charge exists anywhere in the flow. */
export function parseMerchOrderIntent(data: unknown): MerchOrderIntent | null {
  const d = asRecord(data);
  const status = str(d["status"]);
  const message = str(d["message"]);
  if (!status || !message) return null;
  return { status, message, paymentsLive: d["paymentsLive"] === true };
}

/* ─── Drop Planner ───────────────────────────────────────────────── */

export const MERCH_DROP_PRICE_BANDS = [
  { key: "budget", label: "Budget" },
  { key: "mid", label: "Mid-range" },
  { key: "premium", label: "Premium" },
] as const;

export interface MerchConcept {
  name: string;
  product: string;
  description: string;
  pricePoint: string;
  why: string;
}

export interface MerchLaunchPost {
  dayOffset: number;
  title: string;
  caption: string;
  cta: string;
}

export interface MerchDropPlan {
  concepts: MerchConcept[];
  launchPosts: MerchLaunchPost[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

export interface MerchSavedPlan {
  id: string;
  planName: string;
  concepts: MerchConcept[];
  launchPosts: MerchLaunchPost[];
  status: string;
  createdAt: string;
}

export function buildMerchDropPlanPayload(input: {
  niche: string;
  audience: string;
  priceBand: string;
}): Record<string, unknown> {
  return { niche: input.niche, audience: input.audience, priceBand: input.priceBand };
}

function parseConcept(v: unknown): MerchConcept {
  const c = asRecord(v);
  return {
    name: str(c["name"]) ?? "",
    product: str(c["product"]) ?? "",
    description: str(c["description"]) ?? "",
    pricePoint: str(c["pricePoint"]) ?? "",
    why: str(c["why"]) ?? "",
  };
}

function parseLaunchPost(v: unknown): MerchLaunchPost {
  const p = asRecord(v);
  return {
    dayOffset: num(p["dayOffset"]) ?? 0,
    title: str(p["title"]) ?? "",
    caption: str(p["caption"]) ?? "",
    cta: str(p["cta"]) ?? "",
  };
}

/** POST /api/wave8/merch-drop/plan — the contract is exactly 3
 *  concepts and 5 launch posts; a plan with no named concept is
 *  not a plan. */
export function parseMerchDropPlan(data: unknown): MerchDropPlan | null {
  const d = asRecord(data);
  const plan = asRecord(d["plan"]);
  if (!Array.isArray(plan["concepts"]) || !Array.isArray(plan["launchPosts"])) return null;
  const concepts = (plan["concepts"] as unknown[]).slice(0, 3).map(parseConcept);
  if (concepts.length === 0 || concepts.every((c) => c.name === "")) return null;
  return {
    concepts,
    launchPosts: (plan["launchPosts"] as unknown[]).slice(0, 5).map(parseLaunchPost),
    creditsUsed: num(d["creditsUsed"]),
    creditsRemaining: num(d["creditsRemaining"]),
  };
}

/** POST /api/wave8/merch-drop/save — the plan plus its launch week;
 *  saving also queues every post in the content calendar. */
export function buildMerchDropSavePayload(input: {
  planName: string;
  plan: MerchDropPlan;
  weekStart: string;
}): Record<string, unknown> {
  return {
    planName: input.planName,
    concepts: input.plan.concepts,
    launchPosts: input.plan.launchPosts,
    weekStart: input.weekStart,
  };
}

/** The planner's launch-week anchor — next Monday (the website's
 *  own formula). */
export function nextMerchDropMondayISO(from: Date = new Date()): string {
  const d = new Date(from);
  const delta = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** GET /api/wave8/merch-drop/plans — the filed plans, newest first
 *  (the rail's order; the bench never re-sorts). */
export function parseMerchDropPlans(data: unknown): MerchSavedPlan[] | null {
  const d = asRecord(data);
  if (!Array.isArray(d["plans"])) return null;
  const out: MerchSavedPlan[] = [];
  for (const raw of d["plans"] as unknown[]) {
    const r = asRecord(raw);
    const id = str(r["id"]);
    if (!id) continue;
    out.push({
      id,
      planName: str(r["plan_name"]) ?? "",
      concepts: Array.isArray(r["concepts"]) ? (r["concepts"] as unknown[]).map(parseConcept) : [],
      launchPosts: Array.isArray(r["launch_posts"]) ? (r["launch_posts"] as unknown[]).map(parseLaunchPost) : [],
      status: str(r["status"]) ?? "",
      createdAt: str(r["created_at"]) ?? "",
    });
  }
  return out;
}

/** The bench's transfer target — the website's Merch tab. */
export const MERCH_BENCH_PATH = "/branding-kit?tab=shop&subtab=merch";
