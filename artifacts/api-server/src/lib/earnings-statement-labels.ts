/* ── Earnings-statement line labels — the server's mirror ────────────
 * The ONE canonical list lives with the in-page statement rendering:
 * STATEMENT_SOURCE_LINES in the web app's lib/earnings-statement.ts,
 * whose strings are the earnings.stmt* catalog values (statement
 * labels are single-sourced from the Earnings cards' titles — the
 * Stack-400 A-04/05/06 lane). The statement PDF route lives HERE, in
 * the API server — a separate package that cannot import the web
 * app's module — so the strings are mirrored in this file and PINNED
 * to both canonical sources by earnings-statement-labels.test.ts,
 * which reads the web app's module and its en catalog and fails if
 * any label here drifts a single character from them.
 *
 * History: the PDF route kept its own shorter hand-list ("Beat
 * licenses", "Brand deals", "Performance bookings", "Shop sales")
 * after the statement labels were single-sourced from the cards, so
 * the same money carried two names depending on whether a creator
 * read it on the page or in the PDF they downloaded. */

export type EarningsStatementSourceKey =
  | "storeSales"
  | "digitalSales"
  | "shopSales"
  | "beats"
  | "memberships"
  | "shoutouts"
  | "tipJar"
  | "brandDeals"
  | "ugcBriefs"
  | "bookings"
  | "royalties";

/** The statement's lines in the statement's order, with the
 *  statement's labels — the PDF route renders exactly this list. */
export const EARNINGS_STATEMENT_LINES: ReadonlyArray<{
  key: EarningsStatementSourceKey;
  label: string;
}> = [
  { key: "storeSales", label: "Store sales" },
  { key: "digitalSales", label: "Digital sales" },
  { key: "shopSales", label: "Shop sales (profile store, shops, digital)" },
  { key: "beats", label: "Beats (licenses sold)" },
  { key: "memberships", label: "Memberships" },
  { key: "shoutouts", label: "Shoutouts" },
  { key: "tipJar", label: "Tip jar tips" },
  { key: "brandDeals", label: "Brand deals (escrow released)" },
  { key: "ugcBriefs", label: "UGC briefs" },
  { key: "bookings", label: "Performance bookings (escrow released)" },
  { key: "royalties", label: "Royalties (recorded)" },
];
