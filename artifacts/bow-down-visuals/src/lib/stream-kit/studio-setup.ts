/**
 * studio-setup.ts — the Go Live studio's memory of your last show
 * (EVERYTHING-SMART audit, stack900 K1).
 *
 * The Broadcast Studio used to start every session blank: empty
 * title, ticket door off, class flag off — even though
 * GET /api/live-streams/mine already holds the creator's last 20
 * streams, each with its title, ticket price, and class flag. This
 * module is the pick the studio opens with: the setup of the most
 * recent FINISHED show. Rows arrive newest-first (the endpoint
 * orders by created_at desc); a row still marked live is the
 * leftover-stream flow's business, not a prefill source, and a
 * row with no title has nothing to teach.
 */

export interface MineStreamRow {
  title?: string | null;
  status?: string | null;
  is_class?: boolean | null;
  ticket_price_vb?: number | null;
}

export interface LastStreamSetup {
  title: string;
  /** The last show's ticket price in Visual Bucs, or null when the
   *  last show was free (ticket door stays off). */
  ticketPriceVb: number | null;
  isClass: boolean;
}

export function lastStreamSetup(
  streams: MineStreamRow[] | undefined | null,
): LastStreamSetup | null {
  if (!Array.isArray(streams)) return null;
  for (const s of streams) {
    if (!s || s.status === "live") continue;
    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (!title) continue;
    return {
      title,
      ticketPriceVb:
        typeof s.ticket_price_vb === "number" && s.ticket_price_vb > 0
          ? s.ticket_price_vb
          : null,
      isClass: s.is_class === true,
    };
  }
  return null;
}
