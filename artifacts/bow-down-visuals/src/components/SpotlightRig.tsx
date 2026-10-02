import { useEffect, useRef } from "react";
import { getThemeBeat } from "@/lib/theme-analyser";

/* ─────────────────── Homepage hero spotlight rig ─────────────────── */
/* Six gold beams washing down over the hero, landing near the Shark
   King's feet. Anchored to the hero (absolute) so the lights live at the
   top of the page and scroll away naturally — they never follow the
   visitor down the page.

   Layering: hero copy sits ABOVE the beams (text stays on top), the
   curtain overlay sits above the beams too (beams read as shining from
   behind the drapes). The Shark King sits just below the curtain
   overlay — he scrolls behind the drapes, not over them.

   Each beam: lamp glow → smooth cone → light pool where it lands.

   Motion, three layers that stack:
   1. CSS staggered shimmer (idle) — a gentle glow while no music plays.
   2. Mouse glide (rAF) — the whole row eases toward the cursor
      horizontally. Still works while the beat drives the swell.
   3. BEAT SYNC (rAF) — when the theme song is playing, every detected
      kick drum hit swells all six beams together, then they ease back.
      Subtle and calm: peaks are capped low (opacity 0.66, brightness
      1.15×) so kicks read as a soft light dance, never a strobe. The
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
    const fit = () => {
      if (!stage) return;
      const s = Math.min(1, window.innerWidth / 1440);
      stage.style.transform = `scaleX(${s.toFixed(3)})`;
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
        // Subtle and calm: peaks are capped low (opacity 0.66, brightness
        // 1.15×) so kick hits read as a soft light dance, never a strobe.
        // Slight per-beam stagger (12ms apart) reads as a wave rolling
        // across the rig while still landing on the beat.
        for (let i = 0; i < beams.length; i++) {
          const el = beams[i];
          if (!el) continue;
          if (el.style.animation !== "none") el.style.animation = "none";
          const stagger = Math.max(0, beat.pulse - i * 0.06);
          const boost = Math.min(1, stagger * 1.15);
          el.style.opacity = (0.42 + boost * 0.24).toFixed(3);
          el.style.filter = boost > 0.03 ? `brightness(${(1 + boost * 0.15).toFixed(3)})` : "";
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
                {/* Beam cone — shorter, landing near the King's feet */}
                <div
                  className="absolute left-1/2 top-[1%] h-[80%] w-[360px] -translate-x-1/2"
                  style={{
                    clipPath: "polygon(37% 0, 63% 0, 100% 100%, 0 100%)",
                    background:
                      "linear-gradient(to bottom, rgba(255,226,130,0.78) 0%, rgba(255,210,100,0.38) 55%, transparent 94%)",
                  }}
                />
                {/* Light pool where the beam lands — at the King's feet */}
                <div
                  className="absolute left-1/2 top-[75%] h-[10%] w-[420px] -translate-x-1/2 rounded-[50%]"
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
