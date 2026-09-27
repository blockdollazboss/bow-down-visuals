import { useEffect, useRef } from "react";

/* ─────────────────── Homepage hero spotlight rig ─────────────────── */
/* Four gold beams washing down over the hero, landing near the Shark
   King's feet. Pinned to the viewport (fixed) so the lights never move
   when the page scrolls — they stay put while content slides beneath.

   Layering: hero copy sits ABOVE the beams (text stays on top), the
   curtain overlay sits above the beams too (beams read as shining from
   behind the drapes).

   Each beam: lamp glow → smooth cone → light pool where it lands. Beams
   flash on staggered phases (CSS), the whole row eases toward the cursor
   horizontally (rAF). Pure decoration: pointer-events-none, translucent,
   reduced-motion safe. */

const BEAM_DELAYS = [0, 0.45, 0.9, 1.35];

export function SpotlightRig({ className = "" }: { className?: string }) {
  const rigRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let targetX = 0; // -1 … 1 across the viewport
    let cx = 0;
    let raf = 0;
    let cancelled = false;

    const onMove = (e: PointerEvent) => {
      targetX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      if (cancelled) return;
      cx += (targetX - cx) * (reduce ? 1 : 0.08);
      if (Math.abs(targetX - cx) < 0.001) cx = targetX;
      // The rig is 1200px wide — clamp travel so the beams stay on screen.
      const section = rig.closest("section");
      const half = (section?.clientWidth || window.innerWidth) / 2;
      const range = Math.max(0, half - 620);
      rig.style.transform = `translate3d(${(cx * range).toFixed(1)}px, 0, 0)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden ${className}`}>
      <div
        className="absolute left-1/2 top-0 h-full w-[1200px]"
        style={{ marginLeft: -600 }}
      >
        <div ref={rigRef} className="absolute inset-0 will-change-transform">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-[460px]"
              style={{ left: 150 + i * 300 - 230 }}
            >
              <div
                className="spotlight-beam absolute inset-0"
                style={{ animationDelay: `${BEAM_DELAYS[i]}s` }}
              >
                {/* Lamp source glow */}
                <div
                  className="absolute left-1/2 top-0 h-[7%] w-44 -translate-x-1/2 rounded-[50%]"
                  style={{
                    background:
                      "radial-gradient(ellipse at center, rgba(255,252,230,1) 0%, rgba(255,228,140,0.95) 45%, transparent 70%)",
                  }}
                />
                {/* Beam cone */}
                <div
                  className="absolute left-1/2 top-[1%] h-[80%] w-[460px] -translate-x-1/2"
                  style={{
                    clipPath: "polygon(37% 0, 63% 0, 100% 100%, 0 100%)",
                    background:
                      "linear-gradient(to bottom, rgba(255,226,130,0.78) 0%, rgba(255,210,100,0.38) 55%, transparent 94%)",
                  }}
                />
                {/* Light pool where the beam lands — at the King's feet */}
                <div
                  className="absolute left-1/2 bottom-[1%] h-[11%] w-[540px] -translate-x-1/2 rounded-[50%]"
                  style={{
                    background:
                      "radial-gradient(ellipse at center, rgba(255,224,128,0.7) 0%, rgba(255,206,98,0.3) 55%, transparent 72%)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
