import { useEffect, useState, useRef } from "react";
import { Sun, Moon } from "lucide-react";
import { applyThemeMode, bootThemePack } from "@/lib/theme-packs";
import { ThemePackQuickPicker } from "@/components/theme-packs/ThemePackQuickPicker";

/* Floating theme toggle — always visible on every page, draggable.
   User directive 2026-10-10: theme switch must never be hidden.
   User directive 2026-10-10: make floating elements draggable to avoid overlaps.
   User directive 2026-10-10: toggle must appear on EVERY single page, no exceptions. */
export function FloatingThemeToggle() {
  const [isLight, setIsLight] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  useEffect(() => {
    // Restores mode + any saved theme pack (lib/theme-packs.ts).
    bootThemePack();
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  // Listen for theme changes from other toggles (sidebar, homepage)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    const next = !isLight;
    setIsLight(next);
    // Flipping the mode leaves a pack that doesn't live in the new
    // mode for that mode's house theme (lib/theme-packs.ts).
    applyThemeMode(next ? "light" : "dark");
  };

  // Load saved position
  useEffect(() => {
    const saved = localStorage.getItem("bdv-toggle-pos");
    if (saved) {
      try { setPos(JSON.parse(saved)); } catch {}
    }
  }, []);

  // User directive 2026-10-10: toggle appears on EVERY page, no exceptions.
  // Auth pages and homepage have their own toggles too — the floating one is always available as well.
  // (Removed the location-based hiding.)

  const onPointerDown = (e: React.PointerEvent) => {
    // Stack-28 #58 corner budget: the toggle's default slot is the second
    // top-left slot (x=72) — the first slot (x=16) belongs to the floating
    // language switcher on the pages that mount it. Saved drag positions
    // are unaffected.
    const x = pos?.x ?? 72;
    const y = pos?.y ?? 16;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: x, origY: y, moved: false };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
    const newX = Math.max(8, Math.min(window.innerWidth - 52, dragRef.current.origX + dx));
    const newY = Math.max(8, Math.min(window.innerHeight - 52, dragRef.current.origY + dy));
    setPos({ x: newX, y: newY });
  };

  const onPointerUp = () => {
    if (dragRef.current?.moved && pos) {
      localStorage.setItem("bdv-toggle-pos", JSON.stringify(pos));
    } else if (dragRef.current && !dragRef.current.moved) {
      toggle();
    }
    dragRef.current = null;
    setDragging(false);
  };

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: "auto" }
    : { top: 16, left: 72 };

  return (
    <>
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme (drag to move)" : "Switch to light theme (drag to move)"}
      style={style}
      className={`fixed z-[9999] flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-black/60 text-primary shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-black/80 light:bg-white/80 light:text-[#7A5A12] light:hover:bg-white ${dragging ? "cursor-grabbing scale-110" : "cursor-grab"}`}
    >
      {isLight ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </button>
    {/* FIX 14: theme packs surface at the toggle itself, not only in
        the Settings desk. The picker is a sibling fixed element. */}
    <ThemePackQuickPicker />
    </>
  );
}
