/* ── Earnings-statement payload guard (DTO guard batch #2) ───────────
 * Same pattern as lib/destination-keys.ts / lib/explore-data.ts.
 * TrustPanels' EarningsDocuments stored the raw statement cast and read
 * Object.entries(stmt.sources) at render — a statement payload missing
 * `sources` threw and took the section down AFTER a "successful" load.
 * This normalizer runs at the fetch boundary: a payload without a real
 * sources map is malformed → null → the panel's honest load error.
 * A source whose total isn't a real number degrades to the panel's own
 * "couldn't load" rendering (totalCents: null), never a $NaN. */

interface EarningsStatementSource {
  status: string;
  totalCents: number | null;
  count: number;
}

export interface EarningsStatement {
  sources: Record<string, EarningsStatementSource>;
  totalCents: number | null;
  partial: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function statementFromPayload(payload: unknown): EarningsStatement | null {
  if (!isObj(payload)) return null;
  const stmt = isObj(payload.statement) ? payload.statement : payload;
  if (!isObj(stmt.sources)) return null;
  const sources: Record<string, EarningsStatementSource> = {};
  for (const [k, v] of Object.entries(stmt.sources)) {
    if (!isObj(v)) continue;
    sources[k] = {
      status: typeof v.status === "string" ? v.status : "error",
      totalCents: finite(v.totalCents),
      count: finite(v.count) ?? 0,
    };
  }
  return {
    sources,
    totalCents: finite(stmt.totalCents),
    partial: stmt.partial === true,
  };
}

/* ── The statement's lines — ONE list for every rendering ────────────
 * The server builds each year's statement once (buildYearStatement
 * in api-server routes/trust.ts); the PDF route and the JSON route
 * both render THAT object. The labels + order below are the PDF
 * route's own line list, verbatim — the two in-page viewers (the
 * Earnings page's documents panel and the World Earnings Board)
 * render these rows, so an in-page statement can never drift from
 * the PDF it sits beside: same lines, same totals, same words. */

const STATEMENT_SOURCE_LINES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "storeSales", label: "Store sales" },
  { key: "digitalSales", label: "Digital sales" },
  { key: "shopSales", label: "Shop sales" },
  { key: "beats", label: "Beat licenses" },
  { key: "memberships", label: "Memberships" },
  { key: "shoutouts", label: "Shoutouts" },
  { key: "tipJar", label: "Tip jar tips" },
  { key: "brandDeals", label: "Brand deals" },
  { key: "ugcBriefs", label: "UGC briefs" },
  { key: "royalties", label: "Royalties (recorded)" },
];

/* The locale seam (Stack-200 D6): the in-page viewers pass the
   catalog-resolved strings (earnings.stmt* — the English source
   verbatim in every catalog; money labels are never agent-
   translated); no bundle → the PDF's own English labels, byte-
   identical. The PDF route never passes a bundle. */
export interface StatementStrings {
  labels?: Partial<Record<string, string>>;
  couldntLoad?: string;
  lineTemplate?: string;
  total?: string;
  totalPartial?: string;
}

/** Build the bundle from a translate function — the one place the
 *  earnings.stmt* keys are named, so the two in-page viewers can
 *  never thread different labels. */
export function statementStringsFrom(tr: (key: string) => string): StatementStrings {
  return {
    labels: {
      storeSales: tr("earnings.stmtStoreSales"),
      digitalSales: tr("earnings.stmtDigitalSales"),
      shopSales: tr("earnings.stmtShopSales"),
      beats: tr("earnings.stmtBeats"),
      memberships: tr("earnings.stmtMemberships"),
      shoutouts: tr("earnings.stmtShoutouts"),
      tipJar: tr("earnings.stmtTipJar"),
      brandDeals: tr("earnings.stmtBrandDeals"),
      ugcBriefs: tr("earnings.stmtUgcBriefs"),
      royalties: tr("earnings.stmtRoyalties"),
    },
    couldntLoad: tr("earnings.stmtCouldntLoad"),
    lineTemplate: tr("earnings.stmtLine"),
    total: tr("earnings.stmtTotal"),
    totalPartial: tr("earnings.stmtTotalPartial"),
  };
}

interface StatementLineRow {
  key: string;
  label: string;
  status: string;
  totalCents: number | null;
  count: number;
}

/** The statement's lines in the PDF's order, with the PDF's labels.
 *  A canonical source the payload doesn't carry is skipped (the
 *  builder always sends all ten; a short payload degrades to the
 *  lines it has, never to invented rows). */
export function statementLineRows(stmt: EarningsStatement, strings?: StatementStrings): StatementLineRow[] {
  const rows: StatementLineRow[] = [];
  for (const { key, label } of STATEMENT_SOURCE_LINES) {
    const s = stmt.sources[key];
    if (!s) continue;
    rows.push({ key, label: strings?.labels?.[key] ?? label, status: s.status, totalCents: s.totalCents, count: s.count });
  }
  return rows;
}

/** Statement money, the PDF's own format: two decimals, no grouping
 *  ($1234.56, not $1,234.56) — and a missing total reads as the
 *  honest "couldn't load", never a $0.00. */
export function statementMoney(cents: number | null, couldntLoad = "couldn't load"): string {
  return cents === null ? couldntLoad : `$${(cents / 100).toFixed(2)}`;
}

/** One line's right-hand text, exactly as the in-page viewers print
 *  it (and the PDF, modulo its parentheses): an errored source says
 *  "couldn't load"; a loaded one shows its recorded total + count. */
export function statementLineText(row: StatementLineRow, strings?: StatementStrings): string {
  const couldntLoad = strings?.couldntLoad ?? "couldn't load";
  if (row.status === "error") return couldntLoad;
  const money = statementMoney(row.totalCents, couldntLoad);
  if (strings?.lineTemplate) {
    return strings.lineTemplate.replace("{{money}}", money).replace("{{count}}", String(row.count));
  }
  return `${money} · ${row.count} records`;
}

/** The total row's label — partial statements (a source failed)
 *  never present their sum as the whole story. Both the PDF route
 *  and the in-page viewers use this exact wording. */
export function statementTotalLabel(partial: boolean, strings?: StatementStrings): string {
  if (partial) return strings?.totalPartial ?? "Total of the sources that loaded";
  return strings?.total ?? "Total";
}

/** An honestly empty statement: every line loaded and every line
 *  recorded zero activity. A failed source makes the statement
 *  partial, not empty — "nothing recorded" is only claimed when
 *  the records actually answered. The numbers are the builder's
 *  recorded sums (a year with no activity sums to real zeros,
 *  exactly as the PDF prints them), never invented filler. */
export function statementIsEmpty(stmt: EarningsStatement): boolean {
  const rows = statementLineRows(stmt);
  return rows.length > 0 && rows.every((r) => r.status !== "error" && r.totalCents !== null && r.count === 0) && stmt.totalCents === 0;
}
