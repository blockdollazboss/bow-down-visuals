import type { CSSProperties, ReactNode } from "react";
import { useDraggable } from "@/hooks/use-draggable";
import { cn } from "@/lib/utils";

/**
 * DraggableWidget — wraps a floating button/widget to make it draggable
 * with snap-to-grid positioning (40 positions).
 *
 * - Drag with pointer; on release it snaps to the nearest grid cell.
 * - Position persists in localStorage under `draggable-pos:<id>`.
 * - Clicks still work: a drag suppresses the click so you don't
 *   accidentally trigger the button when repositioning it.
 * - `defaultAnchor` sets the initial spot before the user ever drags.
 */

interface DraggableWidgetProps {
  id: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Initial position as fractions of viewport (0–1). */
  defaultAnchor?: { x: number; y: number };
  zIndex?: number;
}

export function DraggableWidget({
  id,
  children,
  className,
  style,
  defaultAnchor = { x: 0.94, y: 0.06 },
  zIndex = 9990,
}: DraggableWidgetProps) {
  /* The anchor is the widget's home until the user drags it — it must be
     passed to the hook as the default position. Without this, widgets with
     no saved position initialized at (0,0) and piled up in the top-left
     corner instead of their designed spot. */
  const anchorPos =
    typeof window !== "undefined"
      ? {
          x: Math.round(defaultAnchor.x * window.innerWidth),
          y: Math.round(defaultAnchor.y * window.innerHeight),
        }
      : { x: 0, y: 0 };

  const { position, isDragging, initialized, elRef, dragHandlers, wasDragged } =
    useDraggable(id, anchorPos);

  const pos = initialized ? position : anchorPos;

  return (
    <div
      ref={elRef as React.RefObject<HTMLDivElement>}
      className={cn("fixed select-none", className)}
      style={{
        left: pos.x,
        top: pos.y,
        transform: "translate(-50%, -50%)",
        zIndex,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        ...style,
      }}
      {...dragHandlers}
      onClickCapture={(e) => {
        /* Swallow the click if this was a drag, not a tap. */
        if (wasDragged()) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
}
