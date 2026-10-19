/* ─── Promo-card history seam (STACK-20 R2 #17) ──────────────────────────
   Pure shaping for the history half of GET /api/promo-cards, kept out
   of the panel so the honesty rules are unit-testable:
   - A history row exists only if the server recorded the card
     (migration 0161) — the normalizer drops anything that isn't a
     complete recorded card (id + playable URL + the release it was
     made for), so a malformed payload can never dress a phantom or
     half-known card up as history.
   - A card leaves the list only through removePromoCard, which the
     panel calls AFTER the server confirms the delete — a failed
     delete keeps the card on screen.
   - Dates render from the row's own createdAt (the server's stamp),
     never from client time. */

export interface PromoCardHistoryItem {
  id: string;
  style: string;
  size: string;
  url: string;
  releaseTitle: string;
  artistName: string;
  caption: string | null;
  width: number;
  height: number;
  platforms: string[];
  createdAt: string;
}

export interface PromoCardHistoryPage {
  cards: PromoCardHistoryItem[];
  /** The page bound the server applied (null when it didn't say). */
  limit: number | null;
  /** True when more of the caller's cards sit beyond this page. */
  hasMore: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function normalizeCard(raw: unknown): PromoCardHistoryItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const url = str(raw.url);
  const releaseTitle = str(raw.releaseTitle);
  if (!id || !url || !releaseTitle) return null;
  return {
    id,
    style: str(raw.style),
    size: str(raw.size),
    url,
    releaseTitle,
    artistName: str(raw.artistName),
    caption: typeof raw.caption === "string" ? raw.caption : null,
    width: num(raw.width),
    height: num(raw.height),
    platforms: Array.isArray(raw.platforms)
      ? raw.platforms.filter((p): p is string => typeof p === "string")
      : [],
    createdAt: str(raw.createdAt),
  };
}

export function normalizePromoCardHistory(data: unknown): PromoCardHistoryPage {
  if (!isRecord(data) || !Array.isArray(data.cards)) {
    return { cards: [], limit: null, hasMore: false };
  }
  const cards = data.cards
    .map(normalizeCard)
    .filter((c): c is PromoCardHistoryItem => c !== null);
  return {
    cards,
    limit: typeof data.limit === "number" && Number.isFinite(data.limit) ? data.limit : null,
    hasMore: data.hasMore === true,
  };
}

/** Remove a card from the list — called only on a server-confirmed delete. */
export function removePromoCard(
  cards: PromoCardHistoryItem[],
  id: string,
): PromoCardHistoryItem[] {
  return cards.filter((c) => c.id !== id);
}

/** Download filename for a history card, matching the results grid's habit. */
export function promoCardFileName(card: Pick<PromoCardHistoryItem, "style" | "size">): string {
  return `promo-card-${card.style}-${card.size.replace(":", "x")}.png`;
}

/** The words that travel with a share: the pack's own caption when the
 *  card carries one, else the release it was made for. */
export function promoCardShareText(card: Pick<PromoCardHistoryItem, "caption" | "releaseTitle" | "artistName">): string {
  if (card.caption && card.caption.trim()) return card.caption;
  return card.artistName ? `${card.releaseTitle} — ${card.artistName}` : card.releaseTitle;
}

/** "Jan 3, 2026" from the row's server stamp; "" when the stamp is unusable. */
export function promoCardDateLabel(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
