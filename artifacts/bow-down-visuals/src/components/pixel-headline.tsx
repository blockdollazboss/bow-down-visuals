import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 8-bit pixel-art headline system — retro arcade typography in the
 * gold/black luxury theme. Big display fonts rendered as chunky pixel
 * graphics (Press Start 2P) with hard stepped shadows, no blur.
 */

/* ─── Pixel sprites — tiny brand icons drawn as pixel grids ─── */

const PALETTE: Record<string, string> = {
  G: "#C9A84C", // gold
  L: "#F5DE8E", // light gold highlight
  D: "#8A6B1F", // dark gold shade
  W: "#FFFFFF", // white
  B: "#0A0A0A", // near-black
};

const SPRITES: Record<string, string[]> = {
  crown: [
    "G...GG...G",
    "GG..GG..GG",
    "GGGGGGGGGG",
    "GLLGGLLGGL",
    "GGGGGGGGGG",
    ".DDDDDDDD.",
  ],
  coin: [
    "..GGGG..",
    ".GLLGGD.",
    "GLLGGGDD",
    "GLLGGDDD",
    "GLGGDDDD",
    "GGGGDDD.",
    ".GGDDD..",
    "..GGG...",
  ],
  note: [
    "....GG..",
    "....GDD.",
    "....GDD.",
    "....GDD.",
    ".GGGGD..",
    "GLLGGD..",
    "GLLGD...",
    ".GGG....",
  ],
  play: [
    "GG......",
    "GGGG....",
    "GGLGGG..",
    "GGLLGGGG",
    "GGLLGGGG",
    "GGLGGG..",
    "GGGG....",
    "GG......",
  ],
  bolt: [
    "...LL...",
    "...LL...",
    "..LLL...",
    "..LLL...",
    ".LLLLL..",
    "...LL...",
    "...LL...",
    "...LL...",
  ],
  star: [
    "...GG...",
    "...GG...",
    ".GGGGGG.",
    "GGLLLLGG",
    ".GLLLLG.",
    "..GLLG..",
    "..GGGG..",
    ".GG..GG.",
  ],
  /* Thy Cheat Code — the King Shark, facing left, gold on black */
  shark: [
    "................",
    "......DD........",
    "......DDD.......",
    ".....DDDDD......",
    "...GGDDDD.......",
    "..GGLLDDDDD.....",
    ".GGWWGGGGDDD....",
    ".GGGGGGGGGDDD...",
    "GGGGGGGGGGGD.D.",
    "GGWWWWWWGGGDDD.",
    ".GGGGGGGGGGD.D.",
    "..GGGGGGGGG....",
  ],
};

export type SpriteName = keyof typeof SPRITES;

export function PixelSprite({
  name,
  pixel = 5,
  className,
}: {
  name: SpriteName;
  pixel?: number;
  className?: string;
}) {
  const rows = SPRITES[name];
  const cols = Math.max(...rows.map((r) => r.length));
  return (
    <div
      aria-hidden="true"
      className={cn("inline-grid shrink-0", className)}
      style={{
        gridTemplateColumns: `repeat(${cols}, ${pixel}px)`,
        gridAutoRows: `${pixel}px`,
        imageRendering: "pixelated",
      }}
    >
      {rows.flatMap((row, y) =>
        row
          .padEnd(cols, ".")
          .split("")
          .map((ch, x) => (
            <span
              key={`${y}-${x}`}
              style={{
                width: pixel,
                height: pixel,
                background: ch === "." ? "transparent" : PALETTE[ch] ?? "transparent",
              }}
            />
          )),
      )}
    </div>
  );
}

/* ─── Pixel divider — a row of gold blocks ─── */

export function PixelDivider({
  count = 12,
  className,
  style,
  align = "center",
}: {
  count?: number;
  className?: string;
  style?: CSSProperties;
  align?: "left" | "center" | "right";
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pixel-divider",
        align === "center" && "justify-center",
        align === "right" && "justify-end",
        align === "left" && "justify-start",
        className,
      )}
      style={style}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

/* ─── The headline itself ───
   Removed 2026-10-10: PixelHeadline was dead (zero imports). The size
   scale is documented here for reference if a pixel headline returns. */

/* ─── Thy Cheat Code — the name, always in 8-bit pixel style ───
 * Em-scaled so it sits naturally inside any surrounding text size.
 * Use <CheatCodeName possessive /> for "Thy Cheat Code's".
 */
export function CheatCodeName({
  possessive = false,
  className,
}: {
  possessive?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("tcc-display whitespace-nowrap text-[#E8C96A]", className)}
      style={{
        fontSize: "0.85em",
        letterSpacing: "0.04em",
        lineHeight: 1.7,
        textShadow: "2px 2px 0 rgba(0,0,0,0.85)",
      }}
    >
      Thy&nbsp;Cheat&nbsp;Code{possessive ? "’s" : ""}
    </span>
  );
}

/* ─── Pixel kicker — tiny arcade label for eyebrows/badges ───
   Removed 2026-10-10: PixelKicker was dead (zero imports). */
