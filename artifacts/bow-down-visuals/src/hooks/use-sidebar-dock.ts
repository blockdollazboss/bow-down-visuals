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

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      d.moved = true;
      setIsDragging(true);
      setDragPos({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved && dragPos) {
      const edge = getNearestEdge(e.clientX, e.clientY);
      setDocked(edge);
      justDockedRef.current = true;
      setTimeout(() => { justDockedRef.current = false; }, 100);
    }
    setIsDragging(false);
    setDragPos(null);
  }, [dragPos, getNearestEdge]);

  const wasDragged = useCallback(() => justDockedRef.current, []);

  return { docked, setDocked, isDragging, dragPos, onPointerDown, onPointerMove, onPointerUp, wasDragged };
}
