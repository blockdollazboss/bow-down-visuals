import { useState, useEffect, useRef, useCallback } from "react";

export type DockPosition = "left" | "right" | "top" | "bottom";

const STORAGE_KEY = "sidebar-dock-position";
const DRAG_THRESHOLD = 6;

export function useSidebarDock() {
  const [docked, setDocked] = useState<DockPosition>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "left" || saved === "right" || saved === "top" || saved === "bottom") {
        return saved;
      }
    } catch { }
    return "left";
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const justDockedRef = useRef(false);
  /* Cleanup for the window-level drag listeners (see onPointerDown). */
  const dragCleanupRef = useRef<(() => void) | null>(null);
  /* Latest pointer position during a drag (mirrors dragPos state). */
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, docked); } catch { }
  }, [docked]);

  const getNearestEdge = useCallback((x: number, y: number): DockPosition => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const distLeft = x;
    const distRight = w - x;
    const distTop = y;
    const distBottom = h - y;
    const min = Math.min(distLeft, distRight, distTop, distBottom);
    if (min === distLeft) return "left";
    if (min === distRight) return "right";
    if (min === distTop) return "top";
    return "bottom";
  }, []);

  /* Drop any in-flight drag listeners on unmount (or a stale drag). */
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
    /* NOTE: deliberately NO setPointerCapture here.
       Pointer capture retargets the pointerup — and, for mouse input, the
       subsequent click — to the capture element, so taps on header controls
       (mode toggle, collapse) were swallowed. Releasing capture inside
       pointerup is NOT enough: the mouse click's target is already fixed to
       the capture element by then. Window-level listeners leave hit-testing
       untouched so taps keep their natural click target. */
    const pointerId = e.pointerId;
    dragCleanupRef.current?.();

    const handleMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        d.moved = true;
        setIsDragging(true);
        const pos = { x: ev.clientX, y: ev.clientY };
        dragPosRef.current = pos;
        setDragPos(pos);
      }
    };

    const removeListeners = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      if (dragCleanupRef.current === removeListeners) {
        dragCleanupRef.current = null;
      }
    };

    const handleUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      removeListeners();
      const d = dragRef.current;
      dragRef.current = null;
      const endPos = dragPosRef.current;
      dragPosRef.current = null;
      if (d?.moved && endPos) {
        const edge = getNearestEdge(endPos.x, endPos.y);
        setDocked(edge);
        justDockedRef.current = true;
        setTimeout(() => { justDockedRef.current = false; }, 100);
      }
      setIsDragging(false);
      setDragPos(null);
    };

    dragCleanupRef.current = removeListeners;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }, [getNearestEdge]);

  const wasDragged = useCallback(() => justDockedRef.current, []);

  /* Only pointerdown is attached to the element — move/up are tracked on
     window so taps keep their natural click target. */
  return { docked, setDocked, isDragging, dragPos, onPointerDown, wasDragged };
}
