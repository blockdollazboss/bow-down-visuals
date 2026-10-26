/**
 * floating-safe-zone — keeps the floating action cluster (the Mystery
 * Crate cube + its OPEN badge) off form cards.
 *
 * The Report-a-fix card's submit row was getting covered by the cube:
 * the crate snaps to a viewport grid, and the bottom-right snap point
 * lands exactly on the bottom-right corner of the page's form cards,
 * where the submit buttons live. A snap point is only acceptable when
 * the widget parked there does not overlap any form card's bounding
 * box (inflated by a small margin so the badge that overhangs the
 * button stays clear too). Pure geometry — no DOM access — so it can
 * be unit-tested without a browser.
 */

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Pixels of breathing room kept between the widget and any form card. */
export const FORM_CARD_CLEARANCE_PX = 12;

/** True when rect `a` and rect `b` overlap (touching edges don't count). */
export function rectsIntersect(a: RectLike, b: RectLike): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Grow a rect by `px` on every side. */
export function inflateRect(r: RectLike, px: number): RectLike {
  return { left: r.left - px, top: r.top - px, right: r.right + px, bottom: r.bottom + px };
}

/** The rect a square-ish widget of the given size occupies when centered at a point. */
export function rectAroundCenter(
  center: { x: number; y: number },
  width: number,
  height: number,
): RectLike {
  return {
    left: center.x - width / 2,
    top: center.y - height / 2,
    right: center.x + width / 2,
    bottom: center.y + height / 2,
  };
}

/**
 * True when a widget of `size` centered at `center` would sit clear of
 * every protected rect (form cards, inflated by the clearance margin).
 */
export function isClearOfProtectedRects(
  center: { x: number; y: number },
  size: { width: number; height: number },
  protectedRects: RectLike[],
  clearancePx: number = FORM_CARD_CLEARANCE_PX,
): boolean {
  const mine = rectAroundCenter(center, size.width, size.height);
  return protectedRects.every((r) => !rectsIntersect(mine, inflateRect(r, clearancePx)));
}

/**
 * Pick the snap point: the nearest candidate that keeps the widget
 * clear of the protected rects. If every candidate intrudes (a wall of
 * cards), the nearest one is returned — the safe zone is a preference,
 * never a trap that throws the widget off-screen.
 */
export function pickSafeSnapPoint(
  candidates: { x: number; y: number }[],
  from: { x: number; y: number },
  size: { width: number; height: number },
  protectedRects: RectLike[],
): { x: number; y: number } {
  let nearest: { x: number; y: number } | null = null;
  let nearestDist = Infinity;
  let nearestClear: { x: number; y: number } | null = null;
  let nearestClearDist = Infinity;
  for (const p of candidates) {
    const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = p;
    }
    if (d < nearestClearDist && isClearOfProtectedRects(p, size, protectedRects)) {
      nearestClearDist = d;
      nearestClear = p;
    }
  }
  return nearestClear ?? nearest ?? from;
}

/**
 * Read the current form-card rects from the live document. Pages mark
 * their form cards with the `form-card` class; the page content panel
 * and the Pitch & Fix forms all carry it. SSR / no-DOM → no rects.
 */
export function collectFormCardRects(doc: Document | undefined = typeof document !== "undefined" ? document : undefined): RectLike[] {
  if (!doc) return [];
  const rects: RectLike[] = [];
  doc.querySelectorAll(".form-card").forEach((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  });
  return rects;
}
