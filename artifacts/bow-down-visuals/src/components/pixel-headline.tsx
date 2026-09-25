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

/* ─── The headline itself ─── */

type PixelHeadlineSize = "hero" | "page" | "section";

const SIZE_CLASSES: Record<PixelHeadlineSize, string> = {
  // Homepage hero — biggest moment on the site
  hero: "text-xl sm:text-2xl lg:text-[1.9rem] leading-[1.75]",
  // Major page heroes (pricing, choose-artist, hooks, coach)
  page: "text-base sm:text-lg lg:text-xl leading-[1.8]",
  // Tool page headers (make-song, make-video, promo-clip)
  section: "text-sm sm:text-base lg:text-lg leading-[1.8]",
};

export function PixelHeadline({
  as: Tag = "h1",
  size = "page",
  align = "left",
  cursor = false,
  className,
  style,
  children,
}: {
  as?: "h1" | "h2";
  size?: PixelHeadlineSize;
  align?: "left" | "center" | "right";
  cursor?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "pixel-display pixel-gold-text",
        SIZE_CLASSES[size],
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
      style={style}
    >
      {children}
      {cursor && (
        <span aria-hidden="true" className="pixel-blink">
          {"\u25ae"}
        </span>
      )}
    </Tag>
  );
}

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
      className={cn("pixel-display whitespace-nowrap text-[#E8C96A]", className)}
      style={{
        fontSize: "0.72em",
        letterSpacing: "0.03em",
        lineHeight: 1.7,
        textShadow: "2px 2px 0 rgba(0,0,0,0.85)",
      }}
    >
      Thy&nbsp;Cheat&nbsp;Code{possessive ? "’s" : ""}
    </span>
  );
}

/* ─── Pixel kicker — tiny arcade label for eyebrows/badges ─── */

export function PixelKicker({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "pixel-display text-[9px] sm:text-[10px] tracking-[0.25em] uppercase text-[#C9A84C]",
        className,
      )}
      style={{ textShadow: "2px 2px 0 rgba(0,0,0,0.9)" }}
    >
      {children}
    </span>
  );
}
