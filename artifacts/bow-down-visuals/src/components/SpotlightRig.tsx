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
        className="absolute left-1/2 w-[1440px]"
        /* Banner tuck (owner, 2026-10-14 — the spotlights "should've
           been connected to the banner... a smidgen tucked under the
           back of the banner"). This supersedes the same day's frame
           fix, which had dropped the stage 148px so the fixtures
           floated in open air below the banner; the owner wants them
           mounted TO it. The stage now starts 74px down: the banner
           measures page y0–88 (desktop/laptop) and y0–72 (mobile,
           where the rig itself starts at page −16), so each
           fixture's top 14px — the truss's top chord and bracing —
           slides behind the banner's bottom edge (the banner is
           sticky z-40 and paints over the rig), the bottom chord
           emerges flush at the banner's edge, and the mount, yoke,
           can, barn doors and lens hang fully visible below it.
           The beams' internal layout rides with the stage: cone
           apexes re-anchor to the raised lenses, and the pools are
           %-compensated (see the pool note) so they keep their
           previous landing spots. The glide is horizontal-only and
           the shimmer animates opacity only, so the tuck is constant
           across the whole motion range. fit() only rewrites the
           stage's transform (scaleX), so the offset survives resizes.
           Measured interaction (2026-10-14): the coach chip (z-30,
           354px wide; page y96–140 desktop/laptop, y80–124 mobile)
           lives in the layer above the rig, in the band the raised
           lamps now cross. On desktop every can parks clear of it at
           rest (beam 0 nudged +10px — see its note); on laptop the
           leftmost can, and on phones all three cans, park behind
           the chip pill at rest with their lenses emerging 8px
           below its bottom edge — at those widths the pill spans
           the fixtures' columns, so no horizontal nudge can park
           them clear, and the chip paints over the rig by design. */
        style={{ marginLeft: -720, transformOrigin: "center top", top: 74, height: "calc(100% - 74px)" }}
      >
        <div ref={rigRef} className="absolute inset-0 will-change-transform">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-[360px]"
              /* Six beams, 240px apart, centered on the 1440px stage:
                 beam centers at 120 / 360 / 600 / 840 / 1080 / 1320.
                 Beam 0 rides +10px right: with the banner tuck raised
                 into the coach chip's band, its can cleared the chip
                 by only 6px and its left barn-door tip overlapped the
                 chip's box at rest on desktop (rig-measured); +10
                 parks the whole fixture clear. Its cone and pool
                 shift with it — a 420px blurred pool does not notice
                 10px. */
              style={{ left: i * 240 - 60 + (i === 0 ? 10 : 0) }}
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
                  className="absolute left-1/2 top-0 h-[7%] w-56 -translate-x-1/2 rounded-[50%] blur-[6px]"
                  style={{
                    background:
                      "radial-gradient(ellipse at center, rgba(255,252,230,0.92) 0%, rgba(255,228,140,0.78) 52%, transparent 72%)",
                  }}
                />
                {/* The lamp itself — the owner-approved theatrical
                    spotlight (2026-10-14): a truss bar segment overhead,
                    hanging mount, yoke, tapered bronze can with cooling
                    fins and gold trim, barn doors, and a glowing lens
                    the beam pours out of. Sized ~2.5× the old 64px lamp
                    (176px on the 1440px stage ≈ 48px on a phone — the
                    old one shrank to a 17px speck the owner couldn't
                    see). It lives inside the beam wrapper, so it glides
                    and beat-swells with its beam. */}
                <div className="absolute left-1/2 top-0 w-44 -translate-x-1/2">
                  <svg viewBox="0 0 176 88" className="w-full" aria-hidden>
                    <defs>
                      <linearGradient id="rig-can" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4A3410" />
                        <stop offset="55%" stopColor="#241708" />
                        <stop offset="100%" stopColor="#120A02" />
                      </linearGradient>
                      <radialGradient id="rig-lens">
                        <stop offset="0%" stopColor="#FFF9E0" />
                        <stop offset="55%" stopColor="#FFE9A8" />
                        <stop offset="100%" stopColor="#E8B33C" />
                      </radialGradient>
                    </defs>
                    {/* truss bar segment — twin chords + zigzag bracing */}
                    <rect x="2" y="2" width="172" height="5" rx="2.5" fill="#1C1307" stroke="#C9A84C" strokeOpacity="0.45" strokeWidth="0.75" />
                    <rect x="2" y="14" width="172" height="5" rx="2.5" fill="#1C1307" stroke="#C9A84C" strokeOpacity="0.45" strokeWidth="0.75" />
                    <path d="M6,7 L21,14 L36,7 L51,14 L66,7 L81,14 L96,7 L111,14 L126,7 L141,14 L156,7 L169,14" fill="none" stroke="#8A6B1F" strokeWidth="2" opacity="0.8" />
                    {/* hanging mount: rod + clamp block */}
                    <rect x="85.5" y="19" width="5" height="9" fill="#150E05" />
                    <rect x="77" y="26" width="22" height="8" rx="2" fill="#241A0C" stroke="#C9A84C" strokeOpacity="0.5" strokeWidth="0.75" />
                    {/* yoke arms + pivot bolts */}
                    <path d="M54,58 L54,42 Q54,32 64,32 L112,32 Q122,32 122,42 L122,58" fill="none" stroke="#8A6B1F" strokeWidth="5" strokeLinecap="round" />
                    <circle cx="54" cy="46" r="4.5" fill="#8A6B1F" />
                    <circle cx="122" cy="46" r="4.5" fill="#8A6B1F" />
                    <circle cx="54" cy="46" r="1.8" fill="#1C1508" />
                    <circle cx="122" cy="46" r="1.8" fill="#1C1508" />
                    {/* tapered bronze can + cooling fins + sheen */}
                    <path d="M64,34 L112,34 L120,68 L56,68 Z" fill="url(#rig-can)" stroke="#C9A84C" strokeOpacity="0.55" strokeWidth="1" />
                    <path d="M67,42 H109 M69,49 H107 M71,56 H105" stroke="#000000" strokeWidth="2" opacity="0.4" />
                    <path d="M70,36 L80,36 L76,66 L66,66 Z" fill="#ffffff" opacity="0.06" />
                    {/* gold mouth rim */}
                    <rect x="54" y="66" width="68" height="5" rx="2.5" fill="#C9A84C" />
                    {/* barn doors hugging the mouth */}
                    <polygon points="56,62 45,57 43,78 57,74" fill="#1C1307" stroke="#C9A84C" strokeOpacity="0.4" strokeWidth="0.75" />
                    <polygon points="120,62 131,57 133,78 119,74" fill="#1C1307" stroke="#C9A84C" strokeOpacity="0.4" strokeWidth="0.75" />
                    {/* the lit lens the beam pours out of */}
                    <ellipse cx="88" cy="74" rx="19" ry="5" fill="url(#rig-lens)" />
                    <ellipse cx="88" cy="74" rx="10" ry="2.6" fill="#FFF9E0" />
                    {/* bottom barn door, angled below the lens */}
                    <polygon points="64,78 112,78 106,86 70,86" fill="#150E05" stroke="#C9A84C" strokeOpacity="0.4" strokeWidth="0.75" />
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
                    className="absolute left-1/2 top-[6.5%] h-[76%] w-[360px] -translate-x-1/2"
                    style={{
                      clipPath: "polygon(44% 0, 56% 0, 100% 100%, 0 100%)",
                      background:
                        "linear-gradient(to bottom, rgba(255,226,130,0.58) 0%, rgba(255,210,100,0.27) 55%, transparent 94%)",
                    }}
                  />
                </div>
                {/* Light pool where the beam lands — at the King's feet.
                    The fraction rose 75% → 76.7% with the banner tuck:
                    the stage grew 74px taller, and the larger fraction
                    compensates so the pools stay on the landing spots
                    the frame fix left them (rig-measured within ~5px at
                    desktop, laptop and phone) instead of riding up the
                    stage with the fixtures. */}
                <div
                  className="absolute left-1/2 top-[76.7%] h-[10%] w-[420px] -translate-x-1/2 rounded-[50%] blur-[9px]"
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
