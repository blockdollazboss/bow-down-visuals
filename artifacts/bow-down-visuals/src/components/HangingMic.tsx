import { useEffect, useRef } from "react";

/* ─────────────────── Homepage hero hanging microphone ─────────────────── */
/* The studio set's ceiling-suspended condenser (owner, 2026-10-14:
   "it should be hanging down from the ceiling… and mouse tracked
   swing"). It is its OWN hero layer, the SpotlightRig pattern: the
   set strip is a bottom-band component painting at z-20, so a cable
   born inside it would slice across the King (z-4) and the headline
   (z-10). Mounted here at z-[6] — above the King, below the copy —
   the cable hangs clean from the banner to the set's world.

   Placement (probe-measured corridors, hero-set-preview-v8):
   - Desktop/laptop (≥lg): the only honest slot is the vertical
     corridor between the King canvas's right edge (x914 at 2048,
     x732 at 1676) and the copy column's left edge (x1004 / x825) —
     ~90px wide. The anchor sits at corridor center: viewport center
     −60px at laptop widths (corridor center −59.5 at 1676) and
     −65px at ≥1800px (corridor center −65 at 2048; the drift is
     the copy column's pr-[4%] resolving against viewport width —
     in practice the −60px rule is the one the cascade delivers at
     both widths, so the anchor sits ~5px right of corridor center
     at 2048). The head is 46px wide; the swing is capped at ±1.5°
     on laptop widths and ±1.15° at ≥1800px, which keeps the head's
     swept envelope (its rotated AABB, bottom corner binding) clear
     of both the King canvas and every copy element at both
     extremes — worst case ~4px on the copy side at 2048, ~7px at
     1676.
   - Below lg there is no center corridor (King + copy span the
     width), so the mic moves to the right-edge corridor beside the
     King figure (canvas right edge x314 at 390): a 34px head,
     ±1.0° swing, its cable passing behind the tips chip — the chip
     lives in the copy layer above this one and paints over the
     cable, the same accepted layering as the rig fixtures on
     phones. The head itself never touches an element box.

   The mount plugs into the banner's bottom edge the way the rig
   fixtures do: in section-local coords the banner's bottom edge is
   y88 at every size (the hero's -mt-[88px] sees to that), so the
   gold collar straddles y88 and the pendulum pivots there.

   Motion: the pendulum angle chases the window pointer
   (normalized −1…1, the rig's pattern) through a two-stage
   exponential lerp — an S-curve approach with natural lag on
   attack and release, and a hard guarantee the spring prototype
   lacked: the angle can never pass its cap (±1.5° laptop,
   ±1.15° at ≥1800px, ±1.0° below lg), so the swept envelope the
   clearances were computed against is the worst case, not a
   settled sample. (The first build's damped
   spring overshot to 2.59° on laptop and put the head inside the
   King canvas at the extreme — probe-caught, hence the lerp.)
   prefers-reduced-motion or a coarse pointer (touch): perfectly
   still — no listener, no loop.

   Pure decoration: pointer-events-none, aria-hidden. */

const PIVOT_Y = 88; // section-local px — the banner's bottom edge

export function HangingMic({ className = "" }: { className?: string }) {
  const swingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = swingRef.current;
    if (!el || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    if (reduce || !finePointer) return; // perfectly still

    const maxAngle = () => {
      const w = window.innerWidth;
      // ≥1800px steps down to 1.15°: there the anchor lands ~5px
      // right of corridor center (see the header note), and 1.15°
      // is what keeps the head's swept AABB ≥4px off the copy
      // column at full settle.
      const deg = w >= 1800 ? 1.15 : w >= 1024 ? 1.5 : 1.0;
      return deg * (Math.PI / 180);
    };
    let target = 0; // radians, scaled at event time
    let lead = 0;
    let angle = 0;
    let raf = 0;
    let cancelled = false;

    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      // Sign: a hanging pendulum's bob moves OPPOSITE its CSS
      // rotation (positive rotation swings the bob left), so the
      // target negates the pointer — mouse right, mic swings right.
      target = -nx * maxAngle();
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      if (cancelled) return;
      // Two-stage exponential lerp: lag both ways, never overshoots
      // the cap the corridor clearances were computed against.
      lead += (target - lead) * 0.055;
      angle += (lead - angle) * 0.055;
      if (Math.abs(target - angle) < 1e-6) angle = target;
      el.style.transform = `rotate(${angle.toFixed(6)}rad)`;
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
    <div aria-hidden className={`pointer-events-none ${className}`}>
      {/* Anchor: corridor center on ≥lg (viewport center −60px,
          −65px at ≥1800px — see the header note); right-edge
          corridor below lg (10% in from the right edge — x351 at
          390, beside the King figure). Zero-width: children center
          themselves on the anchor line. */}
      <div className="absolute top-0 h-full left-auto right-[10%] w-0 lg:left-1/2 lg:right-auto lg:-ml-[60px] min-[1800px]:-ml-[65px]">
        {/* Ceiling collar — straddles the banner's bottom edge
            (local y88): its top tucks behind the banner, its gold
            rim emerges at the edge, and the cable drops out of it.
            Fixed (never rotates with the pendulum). */}
        <div
          data-mic="mount"
          className="absolute -translate-x-1/2"
          style={{ top: PIVOT_Y - 12, left: 0 }}
        >
          <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden>
            <defs>
              <linearGradient id="mic-collar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6B4C16" />
                <stop offset="60%" stopColor="#2A1D08" />
                <stop offset="100%" stopColor="#17100A" />
              </linearGradient>
            </defs>
            <path d="M4,12 L8,1 H18 L22,12 Z" fill="url(#mic-collar)" stroke="#C9A84C" strokeOpacity="0.55" strokeWidth="0.75" />
            <rect x="6" y="11" width="14" height="3.5" rx="1.5" fill="#C9A84C" />
            <rect x="10.5" y="14.5" width="5" height="3.5" rx="1" fill="#241708" stroke="#C9A84C" strokeOpacity="0.5" strokeWidth="0.5" />
          </svg>
        </div>

        {/* Pendulum: rotates about the anchor point at the banner's
            bottom edge (transform-origin 0 0 of a zero-width box
            whose top-left IS the pivot). Height 52% of the hero puts
            the head's bottom at ~59–60% of the hero's height — deep
            in the set's world. */}
        <div
          ref={swingRef}
          data-mic="pendulum"
          className="absolute w-0 will-change-transform"
          style={{ top: PIVOT_Y, left: 0, height: "52%", transformOrigin: "0 0" }}
        >
          <div className="flex h-full w-[34px] -ml-[17px] flex-col items-center lg:w-[46px] lg:-ml-[23px]">
            {/* The cable — thin, dark, a hint of cylindrical sheen. */}
            <div
              data-mic="cable"
              className="w-[2px] flex-1"
              style={{
                background:
                  "linear-gradient(90deg, #0B0702 0%, #4A3410 50%, #0B0702 100%)",
              }}
            />
            {/* The microphone — shaded brass condenser, hanging
                grille-down in its shock mount. */}
            <div data-mic="head" style={{ filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.5))" }}>
              <svg viewBox="0 0 46 96" className="block h-auto w-full" aria-hidden>
                <defs>
                  <linearGradient id="mic-body" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#120A02" />
                    <stop offset="28%" stopColor="#4A3410" />
                    <stop offset="48%" stopColor="#7A5A1C" />
                    <stop offset="72%" stopColor="#241708" />
                    <stop offset="100%" stopColor="#0D0701" />
                  </linearGradient>
                  <linearGradient id="mic-grille" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#17100A" />
                    <stop offset="30%" stopColor="#3D2C10" />
                    <stop offset="50%" stopColor="#54401A" />
                    <stop offset="74%" stopColor="#20160A" />
                    <stop offset="100%" stopColor="#100A03" />
                  </linearGradient>
                  <pattern id="mic-mesh" width="3" height="3" patternUnits="userSpaceOnUse">
                    <circle cx="1.1" cy="1.1" r="0.85" fill="#C9A84C" opacity="0.5" />
                    <circle cx="2.6" cy="2.6" r="0.85" fill="#8A6B1F" opacity="0.45" />
                  </pattern>
                </defs>
                {/* cable entry + gold collar ring */}
                <rect x="20.5" y="0" width="5" height="7" fill="#17100A" />
                <rect x="16.5" y="5.5" width="13" height="3.5" rx="1.5" fill="#C9A84C" />
                {/* shock mount: top band + side rails + lower band */}
                <rect x="3" y="9" width="40" height="5.5" rx="2.5" fill="#241708" stroke="#C9A84C" strokeOpacity="0.6" strokeWidth="0.75" />
                <rect x="4" y="14" width="3.5" height="24" rx="1.5" fill="#8A6B1F" />
                <rect x="38.5" y="14" width="3.5" height="24" rx="1.5" fill="#8A6B1F" />
                <rect x="3" y="36" width="40" height="4.5" rx="2" fill="#241708" stroke="#C9A84C" strokeOpacity="0.5" strokeWidth="0.75" />
                {/* body cylinder */}
                <rect x="13" y="11" width="20" height="41" rx="4" fill="url(#mic-body)" stroke="#C9A84C" strokeOpacity="0.35" strokeWidth="0.75" />
                <rect x="13" y="16" width="20" height="2.5" fill="#C9A84C" opacity="0.85" />
                <circle cx="23" cy="33" r="1.7" fill="#E8B33C" />
                <rect x="15.5" y="20" width="2.5" height="28" rx="1.2" fill="#FFFFFF" opacity="0.07" />
                {/* gold rim between body and grille */}
                <rect x="12" y="50" width="22" height="4" rx="2" fill="#C9A84C" />
                {/* grille head — mesh over dark bronze, rounded foot */}
                <path d="M13,54 H33 V82 Q33,92 23,92 Q13,92 13,82 Z" fill="url(#mic-grille)" />
                <path d="M13,54 H33 V82 Q33,92 23,92 Q13,92 13,82 Z" fill="url(#mic-mesh)" opacity="0.55" />
                <rect x="16" y="57" width="3" height="30" rx="1.5" fill="#FFFFFF" opacity="0.06" />
                <ellipse cx="23" cy="90.5" rx="6.5" ry="1.8" fill="#E8B33C" opacity="0.35" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
