import { useMemo, type CSSProperties } from "react";

/* ─── ConfettiBurst — celebration moment for the lightning onboarding ──────
   CSS-only gold/black confetti. No deps, no canvas, pointer-events none so
   it never blocks taps. Render once when the celebration mounts. */

const COLORS = ["#e8c86a", "#c9a84c", "#ffffff", "#8a6d2f", "#f5e3a8", "#1a1a1a"];

interface Piece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
  round: boolean;
  drift: number;
}

export default function ConfettiBurst({ count = 90 }: { count?: number }) {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: (i * 97.3 + 13) % 100,
        delay: ((i * 37) % 900) / 1000,
        duration: 2.4 + ((i * 53) % 1600) / 1000,
        color: COLORS[i % COLORS.length]!,
        size: 6 + ((i * 29) % 8),
        round: i % 3 === 0,
        drift: ((i * 71) % 120) - 60,
      })),
    [count]
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-[110] overflow-hidden" aria-hidden>
      <style>{`
        @keyframes bdv-confetti-fall {
          0% { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate3d(var(--drift), 108vh, 0) rotate(720deg); opacity: 0.6; }
        }
      `}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              position: "absolute",
              top: 0,
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.5,
              borderRadius: p.round ? "50%" : "2px",
              backgroundColor: p.color,
              animation: `bdv-confetti-fall ${p.duration}s cubic-bezier(.2,.6,.6,1) ${p.delay}s both`,
              "--drift": `${p.drift}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
