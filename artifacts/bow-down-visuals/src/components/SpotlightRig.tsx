import { useEffect, useRef } from "react";
import { getThemeBeat } from "@/lib/theme-analyser";

/* ─────────────────── Homepage hero spotlight rig ─────────────────── */
/* Six gold beams washing down over the hero, landing near the Shark
   King's feet. Anchored to the hero (absolute) so the lights live at the
   top of the page and scroll away naturally — they never follow the
   visitor down the page.

   Layering: the beams sit low in the hero stack — the studio set,
   the Shark King, and the hero copy all sit ABOVE them (text stays on
   top, beams wash over the backdrop only).

   Each beam: lamp glow → smooth cone → light pool where it lands.

   Motion, three layers that stack:
   1. CSS staggered shimmer (idle) — a gentle glow while no music plays.
   2. Mouse glide (rAF) — the whole row eases toward the cursor
      horizontally. Still works while the beat drives the swell.
   3. BEAT SYNC (rAF) — when the theme song is playing, every detected
      kick drum hit swells all six beams together, then they ease back.
      Subtle and calm: peaks are capped low (opacity 0.56, brightness
      1.08×) so kicks read as a soft light dance, never a strobe. The
      idle shimmer is switched off while the beat drives (CSS animations
      would otherwise override it), and returns when the song stops.
      Real light-rig feel, locked to the tempo.

   Pure decoration: pointer-events-none, translucent, reduced-motion safe
   (beat flash is disabled when the user prefers reduced motion). */

const BEAM_DELAYS = [0, 0.45, 0.9, 1.35, 1.8, 2.25];

export function SpotlightRig({ className = "" }: { className?: string }) {
  const rigRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const beamsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const rig = rigRef.current;
    const stage = stageRef.current;
    if (!rig || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Fit the 1440px stage to narrow viewports (width only — beams stay
    // full height). Without this, each 460px beam is wider than a phone
    // screen and they read as giant blobs instead of light shafts.
    // On phones the scaled cones also pack too tight: six 360px cones at
    // 240px spacing overlap into near-continuous gold with darker seams —
    // bold vertical stripes instead of light shafts. Below 640px the rig
    // runs three beams (every other one hidden): the spacing doubles and
    // the shafts read as spotlights again.
    const fit = () => {
      if (!stage) return;
      const s = Math.min(1, window.innerWidth / 1440);
      stage.style.transform = `scaleX(${s.toFixed(3)})`;
      const narrow = window.innerWidth < 640;
      beamsRef.current.forEach((beam, i) => {
        const wrap = beam?.parentElement;
        if (wrap) wrap.style.display = narrow && i % 2 === 1 ? "none" : "";
      });
    };
    fit();
    window.addEventListener("resize", fit);

    let targetX = 0; // -1 … 1 across the viewport
    let cx = 0;
    let raf = 0;
    let cancelled = false;
    let lastPulseAt = 0; // last rAF tick where the kick pulse was hot

    const onMove = (e: PointerEvent) => {
      targetX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      if (cancelled) return;
      // — Mouse glide (keeps working whether or not music plays) —
      cx += (targetX - cx) * (reduce ? 1 : 0.08);
      if (Math.abs(targetX - cx) < 0.001) cx = targetX;
      // The rig is 1440px wide — clamp travel so the beams stay on screen.
      // Generous range so the beams have room to glide with the cursor.
      const section = rig.closest("section");
      const half = (section?.clientWidth || window.innerWidth) / 2;
      const range = Math.max(0, half - 480);
      rig.style.transform = `translate3d(${(cx * range).toFixed(1)}px, 0, 0)`;

      // — Beat sync: slam beams to full brightness on every kick —
      // The idle CSS shimmer animates opacity, and CSS animations override
      // inline styles — so while the theme is driving we switch the shimmer
      // off and drive opacity/brightness directly from the kick pulse. A
      // short hold keeps the handoff from flickering between kicks; when the
      // song stops the shimmer comes back on its own.
      const beat = reduce ? null : getThemeBeat();
      const beams = beamsRef.current;
      const nowMs = performance.now();
      if (beat && beat.pulse > 0.02) lastPulseAt = nowMs;
      const driving = !!beat && nowMs - lastPulseAt < 1500;
      if (driving && beat) {
        // pulse 1 → gentle swell, decaying back toward the idle level.
        // Subtle and calm: peaks are capped low (opacity 0.56, brightness
        // 1.08×) so kick hits read as a soft light dance, never a strobe.
        // Slight per-beam stagger (12ms apart) reads as a wave rolling
        // across the rig while still landing on the beat.
        for (let i = 0; i < beams.length; i++) {
          const el = beams[i];
          if (!el) continue;
          if (el.style.animation !== "none") el.style.animation = "none";
          const stagger = Math.max(0, beat.pulse - i * 0.06);
          const boost = Math.min(1, stagger * 1.15);
          el.style.opacity = (0.4 + boost * 0.16).toFixed(3);
          el.style.filter = boost > 0.03 ? `brightness(${(1 + boost * 0.08).toFixed(3)})` : "";
        }
      } else if (beams.length) {
        // No beat (song paused/stopped) — hand brightness back to CSS.
        for (const el of beams) {
          if (!el) continue;
          if (el.style.animation) el.style.animation = "";
          if (el.style.opacity) el.style.opacity = "";
          if (el.style.filter) el.style.filter = "";
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden ${className}`}>
      <div
        ref={stageRef}
        className="absolute left-1/2 top-0 h-full w-[1440px]"
        style={{ marginLeft: -720, transformOrigin: "center top" }}
      >
        <div ref={rigRef} className="absolute inset-0 will-change-transform">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-[360px]"
              /* Six beams, 240px apart, centered on the 1440px stage:
                 beam centers at 120 / 360 / 600 / 840 / 1080 / 1320. */
              style={{ left: i * 240 - 60 }}
            >
              <div
                ref={(el) => { beamsRef.current[i] = el; }}
                className="spotlight-beam absolute inset-0"
                style={{
                  animationDelay: `${BEAM_DELAYS[i]}s`,
                  /* Edge fade: the cone's clip-path sides are HARD edges, and
                     on narrow viewports the 1440px stage scales down until
                     the six 360px cones overlap — the stacked hard edges
                     read as bold vertical stripes across the phone hero.
                     Fading each beam out at its left/right edges lets
                     overlaps cross-blend like real light at every width. */
                  maskImage:
                    "linear-gradient(to right, transparent 0%, black 34%, black 66%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to right, transparent 0%, black 34%, black 66%, transparent 100%)",
                }}
              >
                {/* Lamp source glow */}
                <div
                  className="absolute left-1/2 top-0 h-[7%] w-44 -translate-x-1/2 rounded-[50%] blur-[6px]"
                  style={{
                    background:
                      "radial-gradient(ellipse at center, rgba(255,252,230,0.92) 0%, rgba(255,228,140,0.78) 52%, transparent 72%)",
                  }}
                />
                {/* The lamp itself — a real spotlight fixture: hanging rod,
                    yoke, tapered metal can, gold mouth rim, lit lens. The
                    beam emanates from the lens (owner, Oct 13: "add actual
                    spotlight lamps"). */}
                <div className="absolute left-1/2 top-0 w-16 -translate-x-1/2">
                  <svg viewBox="0 0 64 52" className="w-full" aria-hidden>
                    <rect x="30.5" y="0" width="3" height="7" fill="#1c1508" />
                    <path d="M15 24 L15 13 Q15 6 22 6 L42 6 Q49 6 49 13 L49 24" fill="none" stroke="#8A6B1F" strokeWidth="3" />
                    <path d="M20 10 L44 10 L49 40 L15 40 Z" fill="#241a0c" stroke="#C9A84C" strokeOpacity="0.55" strokeWidth="1" />
                    <path d="M23 12 L32 12 L32 38 L19 38 Z" fill="#ffffff" opacity="0.06" />
                    <circle cx="13" cy="24" r="3" fill="#8A6B1F" />
                    <circle cx="51" cy="24" r="3" fill="#8A6B1F" />
                    <rect x="13.5" y="38" width="37" height="4" rx="2" fill="#C9A84C" />
                    <ellipse cx="32" cy="45" rx="15" ry="4" fill="#FFE9A8" />
                    <ellipse cx="32" cy="45" rx="9" ry="2.4" fill="#FFF9E0" />
                  </svg>
                </div>
                {/* Beam cone — shorter, landing near the King's feet.
                    Feathering: the blur lives on this WRAPPER, not on
                    the cone itself. CSS applies an element's own filter
                    BEFORE its clip-path, so a blur on the clipped cone
                    never softened the polygon's diagonal sides — they
                    painted as hard lines. Blurring the parent feathers
                    the already-clipped cone, edges included. */}
                <div className="absolute inset-0 blur-[7px]">
                  <div
                    className="absolute left-1/2 top-[5%] h-[76%] w-[360px] -translate-x-1/2"
                    style={{
                      clipPath: "polygon(44% 0, 56% 0, 100% 100%, 0 100%)",
                      background:
                        "linear-gradient(to bottom, rgba(255,226,130,0.58) 0%, rgba(255,210,100,0.27) 55%, transparent 94%)",
                    }}
                  />
                </div>
                {/* Light pool where the beam lands — at the King's feet */}
                <div
                  className="absolute left-1/2 top-[75%] h-[10%] w-[420px] -translate-x-1/2 rounded-[50%] blur-[9px]"
                  style={{
                    background:
                      "radial-gradient(ellipse at center, rgba(255,224,128,0.48) 0%, rgba(255,206,98,0.2) 55%, transparent 72%)",
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
