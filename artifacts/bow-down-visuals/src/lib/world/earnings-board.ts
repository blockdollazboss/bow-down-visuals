/**
 * earnings-board.ts — the data shaping behind the Earnings Board
 * (NATIVE-PLAN §3.1: the Get Paid Room's board, with the old
 * /credit-history folded in as its Ledger tab).
 *
 * Everything here is pure shaping — the board component owns the
 * fetches and the renders. The endpoints are the website's own:
 *   GET /api/earnings                          (headline + sources)
 *   GET /api/credits/history                   (ledger: VB usage)
 *   GET /api/payments/history                  (ledger: purchases)
 *   GET /api/earnings/statements/:year/pdf     (the PDF download)
 *   GET /api/distribution/permanence           (status rows, read-only)
 *   GET /api/content-id/claims                 (status rows, read-only)
 * The earnings payload itself is normalized by the house guard
 * (lib/earnings-data) — this module reuses it, never re-derives it.
 * Permanence elections and claim management stay on the website
 * (plan §3.1: read-only in-world; managing them is the transfer's
 * job) — nothing in this module or its board writes to either rail.
 *
 * The LOADS below carry the earnings page's patience discipline
 * (lib/earnings-data's loadEarnings — the page was fixed Oct 17
 * after its one-shot fetch painted a dead board on a waking box):
 * several attempts, growing backoff, a per-attempt timeout, and a
 * FRESH token per attempt, with the numbers imported from that one
 * module so the page and this board can never drift apart. The
 * board's rails are plain REST GETs (the room socket carries
 * presence, not money data), so the discipline transfers as-is:
 * the headline rides loadEarnings itself, and the board's other
 * rails ride the same loop via fetchBoardJson / loadBoardLedger.
 * Only genuine exhaustion surfaces the board's honest error states.
 */
import {
  normalizeEarningsResponse,
  EarningsLoadCancelled,
  EARNINGS_LOAD_ATTEMPTS,
  EARNINGS_LOAD_BACKOFF_MS,
  EARNINGS_ATTEMPT_TIMEOUT_MS,
  type EarningsResponse,
} from "../earnings-data";

export { normalizeEarningsResponse, EarningsLoadCancelled };
export type { EarningsResponse };

/* ─── Money formatting ────────────────────────────────────────────── */

export function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ─── The board's source rows ─────────────────────────────────────────
   One row per earnings source. A source the payload marked errored
   renders its own honest "couldn't load" line — never a fake zero
   (the earnings page's rule, carried in-world). */

export interface EarningsSourceRow {
  title: string;
  /** The row's right-aligned fact: a total, or the error marker. */
  meta: string;
  detail?: string;
}

export function earningsSourceRows(e: EarningsResponse): EarningsSourceRow[] {
  const rows: EarningsSourceRow[] = [];
  const money = (title: string, s: EarningsResponse["sources"]["memberships"], detail?: string) => {
    if (s.status === "error") {
      rows.push({ title, meta: "Couldn't load", detail: "This source didn't answer — the total covers the ones that did." });
    } else {
      rows.push({
        title,
        meta: usd(s.totalCents),
        detail: detail ?? `${s.count} ${s.count === 1 ? "payment" : "payments"}`,
      });
    }
  };
  const store = e.sources.storeSales;
  money(
    "Store sales",
    store,
    store.status === "ok" && store.breakdown
      ? `profile store ${usd(store.breakdown.profileStoreCents)} · shop ${usd(store.breakdown.shopSalesCents)}`
      : undefined,
  );
  money("Memberships", e.sources.memberships);
  money("Brand deals (escrow released)", e.sources.brandDeals);
  const tips = e.sources.tips;
  if (tips.status === "error") {
    rows.push({ title: "Tips", meta: "Couldn't load", detail: "This source didn't answer — the total covers the ones that did." });
  } else {
    rows.push({
      title: "Tips",
      meta: `${(tips.streamTipsVb ?? 0).toLocaleString("en-US")} VB`,
      detail:
        `${tips.streamTipCount ?? 0} stream tips credited · tip jar ${usd(tips.tipJarPendingCents ?? 0)} ` +
        `pending payment (${tips.tipJarPendingCount ?? 0} fans) — not yet earnings`,
    });
  }
  return rows;
}

/* ─── The Ledger (the old /credit-history, folded in) ────────────────
   Two rails merge into one newest-first list: Visual Buc usage
   (charges, grants, refunds) and pack purchases (real money in).
   The signed-amount rule is the credit-history page's own: usage
   rows store NEGATIVE creditsUsed for value coming BACK to the
   member (grants/refunds), positive for charges — read it wrong
   and a grant renders as a double-negative charge. */

export interface LedgerEntry {
  id: string;
  kind: "usage" | "payment";
  title: string;
  detail: string;
  /** Signed, display-ready amount ("−200", "+1,000", "$49.00"). */
  amount: string;
  /** The amount's unit: Visual Bucs move as VB; a purchase's money
   *  column is real currency, kept in its own label. */
  unit: "VB" | "money";
  dateIso: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function describeLedgerUsage(action: string, creditsUsed: number): { type: string; amount: string } {
  if (creditsUsed < 0) {
    const type = /grant/i.test(action) ? "Grant" : /refund/i.test(action) ? "Refund" : "Visual Buc back";
    return { type, amount: `+${Math.abs(creditsUsed).toLocaleString("en-US")}` };
  }
  if (creditsUsed === 0) return { type: "Free", amount: "0" };
  return { type: "Charge", amount: `−${creditsUsed.toLocaleString("en-US")}` };
}

function paymentMoney(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  const sym = !currency || currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase();
  return `${sym}${(cents / 100).toFixed(2)}`;
}

/** Merge the two ledger payloads into one newest-first entry list.
 *  Either payload may be missing/malformed — its rail simply
 *  contributes nothing (the component decides whether a missing
 *  rail is an error state; the merge never invents rows). */
export function normalizeLedger(creditsPayload: unknown, paymentsPayload: unknown): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  if (isObj(creditsPayload) && Array.isArray(creditsPayload["usage"])) {
    for (const row of creditsPayload["usage"]) {
      if (!isObj(row)) continue;
      const id = str(row["id"]);
      const used = num(row["creditsUsed"]);
      if (!id || used === null) continue;
      const action = str(row["action"]) ?? "Visual Buc activity";
      const d = describeLedgerUsage(action, used);
      out.push({
        id: `usage:${id}`,
        kind: "usage",
        title: action,
        detail: d.type,
        amount: d.amount,
        unit: "VB",
        dateIso: str(row["createdAt"] ?? row["created_at"]),
      });
    }
  }
  if (isObj(paymentsPayload) && Array.isArray(paymentsPayload["payments"])) {
    for (const row of paymentsPayload["payments"]) {
      if (!isObj(row)) continue;
      const id = str(row["id"]);
      if (!id) continue;
      const credits = num(row["creditsAmount"]) ?? 0;
      const pack = str(row["creditPack"]);
      const status = str(row["status"]) ?? "";
      out.push({
        id: `payment:${id}`,
        kind: "payment",
        title: pack ? `Visual Buc pack — ${pack}` : "Visual Buc purchase",
        detail: `+${credits.toLocaleString("en-US")} VB${status ? ` · ${status}` : ""}`,
        amount: paymentMoney(num(row["amountTotal"]), str(row["currency"])),
        unit: "money",
        dateIso: str(row["createdAt"] ?? row["created_at"]),
      });
    }
  }
  /* Newest first; undated rows keep their rail order at the end. */
  return out.sort((a, b) => {
    const ta = a.dateIso ? Date.parse(a.dateIso) : NaN;
    const tb = b.dateIso ? Date.parse(b.dateIso) : NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    if (Number.isFinite(tb)) return 1;
    if (Number.isFinite(ta)) return -1;
    return 0;
  });
}

/* ─── Statements ──────────────────────────────────────────────────── */

/** The statement years the board offers — this year and the two
 *  before it, the earnings page documents panel's own set. */
export function statementYears(now: Date = new Date()): number[] {
  const y = now.getFullYear();
  return [y, y - 1, y - 2];
}

/** The PDF download path. A file download is NOT a page pull-up
 *  (plan §3.9) — the button that uses this path saves a file and
 *  the walker never leaves the room. */
export function statementPdfPath(year: number): string {
  return `/api/earnings/statements/${year}/pdf`;
}

/* ─── Read-only status rows: permanence + content-ID claims ────────── */

export interface PermanenceStatus {
  catalogElection: string | null;
  releases: Array<{ title: string; election: string }>;
}

/** Shape GET /api/distribution/permanence into status lines. Null
 *  when the payload carries neither a catalog election nor any
 *  release elections — nothing recorded reads as "no election",
 *  rendered by the component, not invented here. */
export function normalizePermanence(payload: unknown): PermanenceStatus | null {
  if (!isObj(payload)) return null;
  const catalog = isObj(payload["catalog"]) ? str(payload["catalog"]["election"]) : null;
  const releases: PermanenceStatus["releases"] = [];
  if (Array.isArray(payload["releases"])) {
    for (const row of payload["releases"]) {
      if (!isObj(row)) continue;
      const election = str(row["election"]);
      if (!election) continue;
      releases.push({ title: str(row["releaseTitle"] ?? row["release_title"]) ?? "Release", election });
    }
  }
  if (catalog === null && releases.length === 0) return null;
  return { catalogElection: catalog, releases };
}

/* ─── The board's patient loads ─────────────────────────────────────
   The loop below is loadEarnings' shape (lib/earnings-data) with the
   attempt body swapped: one fresh token per attempt (the token leg
   is part of the failure surface — a null token 401s and the retry
   asks again), one AbortController timeout per attempt (a hung
   request retries instead of stranding the board on its loading
   line forever), growing backoff between attempts, and
   EarningsLoadCancelled the moment the walker leaves — cancellation
   is silence, never an error state. */

export interface BoardLoadDeps {
  /** Fresh token per attempt; a null (or a throw) is just a failed
   *  attempt — the next try asks again. */
  getToken: () => Promise<string | null>;
  /** Defaults to the ambient fetch. Injected in tests. */
  fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
  /** Injected in tests so backoff never slows the suite. */
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  /** Fires when another attempt is about to start (attempt ≥ 2). */
  onRetry?: (nextAttempt: number) => void;
}

export interface BoardLoadOptions {
  attempts?: number;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
}

interface BoardAttemptCtx {
  token: string | null;
  signal: AbortSignal;
  fetchFn: (input: string, init: RequestInit) => Promise<Response>;
}

async function withBoardRetries<T>(
  deps: BoardLoadDeps,
  options: BoardLoadOptions,
  attempt: (ctx: BoardAttemptCtx) => Promise<T>,
): Promise<T> {
  const fetchFn = deps.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = options.attempts ?? EARNINGS_LOAD_ATTEMPTS;
  const backoffMs = options.backoffMs ?? EARNINGS_LOAD_BACKOFF_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? EARNINGS_ATTEMPT_TIMEOUT_MS;

  let lastError: unknown = null;
  for (let n = 1; n <= attempts; n++) {
    if (deps.isCancelled?.()) throw new EarningsLoadCancelled();
    try {
      const token = await deps.getToken().catch(() => null);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        return await attempt({ token, signal: controller.signal, fetchFn });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err;
      if (n >= attempts) break;
      if (deps.isCancelled?.()) throw new EarningsLoadCancelled();
      deps.onRetry?.(n + 1);
      await sleep(backoffMs[n - 1] ?? backoffMs[backoffMs.length - 1] ?? 0);
    }
  }
  throw lastError ?? new Error("board load failed");
}

const bearer = (token: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

/** One board rail's JSON, ridden out patiently. Throws the last
 *  error on exhaustion; the caller decides whether that is an error
 *  state (the ledger) or a quiet note (the status rails). */
export async function fetchBoardJson(
  deps: BoardLoadDeps,
  path: string,
  options: BoardLoadOptions = {},
): Promise<unknown> {
  return withBoardRetries(deps, options, async ({ token, signal, fetchFn }) => {
    const res = await fetchFn(path, { headers: bearer(token), signal });
    if (!res.ok) throw new Error(`board fetch failed (${res.status})`);
    return res.json();
  });
}

/** The Ledger as ONE retryable unit — both rails per attempt on the
 *  attempt's fresh token: both are required (a half-ledger would
 *  misread as the whole story), so a failure on either rail retries
 *  the pair, exactly like loadEarnings treats its whole load. */
export async function loadBoardLedger(
  deps: BoardLoadDeps,
  options: BoardLoadOptions = {},
): Promise<LedgerEntry[]> {
  return withBoardRetries(deps, options, async ({ token, signal, fetchFn }) => {
    const headers = bearer(token);
    const [creditsRes, paymentsRes] = await Promise.all([
      fetchFn("/api/credits/history", { headers, signal }),
      fetchFn("/api/payments/history", { headers, signal }),
    ]);
    if (!creditsRes.ok || !paymentsRes.ok) throw new Error("ledger failed");
    return normalizeLedger(await creditsRes.json(), await paymentsRes.json());
  });
}

export interface ClaimStatus {
  id: string;
  label: string;
  status: string;
  detail: string;
}

/** Shape GET /api/content-id/claims into read-only status rows.
 *  The claim ACTIONS (accept / dispute / resolve) are management —
 *  they stay on the website; the board only reports where each
 *  claim stands. */
export function normalizeClaims(payload: unknown): ClaimStatus[] {
  if (!isObj(payload) || !Array.isArray(payload["claims"])) return [];
  const out: ClaimStatus[] = [];
  for (const row of payload["claims"]) {
    if (!isObj(row)) continue;
    const id = str(row["id"]);
    if (!id) continue;
    const youAre = str(row["youAre"] ?? row["you_are"]);
    const status = str(row["status"]) ?? "unknown";
    const conf = num(row["confidence"]);
    const matched = num(row["matchedLandmarks"]);
    const total = num(row["totalLandmarks"]);
    const parts: string[] = [];
    if (youAre) parts.push(`you are the ${youAre}`);
    if (conf !== null) parts.push(`confidence ${conf}`);
    if (matched !== null && total !== null) parts.push(`${matched} of ${total} landmarks matched`);
    out.push({
      id,
      label: str(row["sourceLabel"] ?? row["source_label"]) ?? "Upload",
      status,
      detail: parts.join(" · "),
    });
  }
  return out;
}
