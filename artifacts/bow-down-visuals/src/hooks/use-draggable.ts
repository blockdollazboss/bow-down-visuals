import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useDraggable — drag any floating widget and snap it to a grid position.
 *
 * The screen is divided into a COLS × ROWS grid (default 8×5 = 40 snap
 * positions). On drop, the widget snaps to the nearest grid cell center.
 * Position persists in localStorage per widget id.
 *
 * Usage:
 *   const { position, dragHandlers, isDragging } = useDraggable("dpad-button");
 *   <button
 *     style={{ left: position.x, top: position.y }}
 *     onPointerDown={dragHandlers.onPointerDown}
 *     ...
 */

export interface SnapPosition {
  x: number; // px from viewport left
  y: number; // px from viewport top
}

const COLS = 8;
const ROWS = 5;
const STORAGE_PREFIX = "draggable-pos:";

function getSnapPoints(): SnapPosition[] {
  if (typeof window === "undefined") return [];
  const points: SnapPosition[] = [];
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      points.push({
        x: Math.round(((c + 0.5) / COLS) * w),
        y: Math.round(((r + 0.5) / ROWS) * h),
      });
    }
  }
  return points;
}

function nearestSnap(x: number, y: number): SnapPosition {
  const points = getSnapPoints();
  let best = points[0] ?? { x, y };
  let bestDist = Infinity;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function loadPosition(id: string): SnapPosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const p = JSON.parse(raw) as SnapPosition;
    if (typeof p.x === "number" && typeof p.y === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

function savePosition(id: string, pos: SnapPosition) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

export function useDraggable(id: string, defaultPos?: SnapPosition) {
  const [position, setPosition] = useState<SnapPosition>(() => ({
    x: 0,
    y: 0,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const justDragged = useRef(false);
  const draggingRef = useRef(false);
  const downPos = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLElement | null>(null);

  /* Initialize position: saved → default (snapped to grid) → (0,0). */
  useEffect(() => {
    const saved = loadPosition(id);
    if (saved) {
      setPosition(saved);
    } else if (defaultPos) {
      setPosition(nearestSnap(defaultPos.x, defaultPos.y));
    }
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* Re-snap on viewport resize so widgets don't end up off-screen. */
  useEffect(() => {
    if (!initialized) return;
    const onResize = () => {
      setPosition((p) => nearestSnap(p.x, p.y));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [initialized]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = elRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      moved.current = false;
      justDragged.current = false;
      draggingRef.current = true;
      downPos.current = { x: e.clientX, y: e.clientY };
      setIsDragging(true);
      /* Capture on the wrapper (currentTarget), not the inner target,
         so pointerup/move reliably fire on the wrapper. */
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    []
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const el = elRef.current;
    if (!el) return;
    /* Only count as a drag if moved more than 6px from press point —
       filters out the tiny jitter of a normal click. */
    const dist = Math.hypot(
      e.clientX - downPos.current.x,
      e.clientY - downPos.current.y
    );
    if (dist < 6 && !moved.current) return;
    moved.current = true;
    const half_w = el.offsetWidth / 2;
    const half_h = el.offsetHeight / 2;
    /* Track center of widget under cursor for natural feel. */
    const x = Math.max(
      half_w,
      Math.min(
        window.innerWidth - half_w,
        e.clientX - dragOffset.current.x + half_w
      )
    );
    const y = Math.max(
      half_h,
      Math.min(
        window.innerHeight - half_h,
        e.clientY - dragOffset.current.y + half_h
      )
    );
    setPosition({ x, y });
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      /* Release pointer capture BEFORE the tap's click event is dispatched.
         setPointerCapture retargets every later pointer event for that touch
         to the wrapper — including the click — so inner onClick handlers
         (star-level toggle, chat button, wheel, d-pad, admin shield) never
         fired. Releasing here restores normal hit-testing for the click;
         the drag itself is already over by this point. */
      try {
        const el = e.currentTarget as HTMLElement;
        if (el.hasPointerCapture?.(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      if (moved.current) {
        setPosition((p) => {
          const snapped = nearestSnap(p.x, p.y);
          savePosition(id, snapped);
          return snapped;
        });
        /* Flag for click suppression — cleared on next pointerdown or
           after the click event has had a chance to fire. */
        justDragged.current = true;
        window.setTimeout(() => {
          justDragged.current = false;
        }, 50);
      }
      moved.current = false;
    },
    [id]
  );

  /**
   * Call this from onClick handlers to suppress the click when the
   * user was actually dragging (prevents accidental activation).
   */
  const wasDragged = useCallback(() => {
    return justDragged.current;
  }, []);

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  return {
    position,
    isDragging,
    initialized,
    elRef,
    dragHandlers,
    wasDragged,
  };
}

/** Number of snap positions (8 cols × 5 rows). */
export const SNAP_POSITION_COUNT = COLS * ROWS;
