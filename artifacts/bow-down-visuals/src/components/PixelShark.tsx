/* ─── PixelShark — 8-bit Thy Cheat Code, the King Shark's true form ──────────
   AI-generated 8-bit sprite. Replaces the 🦈 emoji everywhere. */

export function PixelShark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/thy-cheat-code-8bit.webp"
      alt="Thy Cheat Code"
      width={size}
      height={size}
      draggable={false}
      className={`inline-block align-middle ${className}`}
      style={{ imageRendering: "pixelated", width: size, height: size, objectFit: "cover" }}
    />
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
