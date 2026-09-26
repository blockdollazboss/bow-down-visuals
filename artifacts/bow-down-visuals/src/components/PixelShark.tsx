/* ─── PixelShark — 8-bit King Shark, Thy Cheat Code's true form ────────────────
   Replaces the 🦈 emoji everywhere. Always 8-bit, always gold. */

const SHARK_PIXELS = [
  "................",
  "......XX........",
  ".....XXXX.......",
  "....XXXXXX......",
  "...XXXXXXXX.....",
  "..XXXXXXXXXX....",
  ".XXXXXXXXXXXX.X.",
  "XXXXXXXXXXXXXXX.",
  ".XXXXXXXXXXXXXX.",
  "..XXXXXXXXXXXX..",
  "...XXXX.XXXX....",
  "....XX...XX.....",
];

/* Gold palette: dark outline → gold → light highlight */
const PIXEL_COLORS: Record<string, string> = {
  X: "#C9A84C",
  ".": "transparent",
};

export function PixelShark({ size = 16, className = "" }: { size?: number; className?: string }) {
  const rows = SHARK_PIXELS.length;
  const cols = SHARK_PIXELS[0].length;
  const px = size / cols;

  return (
    <span
      className={`inline-block align-middle ${className}`}
      style={{ width: size, height: (size * rows) / cols, imageRendering: "pixelated" }}
      role="img"
      aria-label="Thy Cheat Code shark"
    >
      <svg
        width={size}
        height={(size * rows) / cols}
        viewBox={`0 0 ${cols} ${rows}`}
        style={{ display: "block", imageRendering: "pixelated" }}
      >
        {SHARK_PIXELS.flatMap((row, y) =>
          row.split("").map((ch, x) =>
            ch === "." ? null : (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={PIXEL_COLORS[ch]}
              />
            )
          )
        )}
      </svg>
    </span>
  );
}

/* Render text with 🦈 replaced by the 8-bit PixelShark.
   Use wherever chat/message strings contain the shark emoji. */
export function renderWithShark(text: string, sharkSize = 16): React.ReactNode[] {
  return text.split("🦈").flatMap((part, i, arr) => {
    const nodes: React.ReactNode[] = [part];
    if (i < arr.length - 1) {
      nodes.push(<PixelShark key={`shark-${i}`} size={sharkSize} />);
    }
    return nodes;
  });
}
