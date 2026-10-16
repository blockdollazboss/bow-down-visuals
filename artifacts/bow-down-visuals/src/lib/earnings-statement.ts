/* ── Earnings-statement payload guard (DTO guard batch #2) ───────────
 * Same pattern as lib/destination-keys.ts / lib/explore-data.ts.
 * TrustPanels' EarningsDocuments stored the raw statement cast and read
 * Object.entries(stmt.sources) at render — a statement payload missing
 * `sources` threw and took the section down AFTER a "successful" load.
 * This normalizer runs at the fetch boundary: a payload without a real
 * sources map is malformed → null → the panel's honest load error.
 * A source whose total isn't a real number degrades to the panel's own
 * "couldn't load" rendering (totalCents: null), never a $NaN. */

export interface EarningsStatementSource {
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
