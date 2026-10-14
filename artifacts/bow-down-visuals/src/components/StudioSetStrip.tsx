import { useEffect, useRef } from "react";
import { getThemeBeat } from "@/lib/theme-analyser";

/* StudioSetStrip — the homepage hero's film set, standing on a soft
   stage-floor gradient across the seam between the hero and the
   social-proof band (the floor gradient melts the backdrop/fog edges
   the owner flagged 2026-10-12; the set stands on the seam).

   REDESIGN (owner directive 2026-10-14): the owner rejected both the
   triple-size set of 2026-10-13 (softbox slabs + hard glow ovals
   plowing through the headline, the CTAs and the small King) and a
   same-day relocation that moved the set below the hero ("You moved
   it completely. It was just supposed to be a little bit smaller").
   This is a WHOLE NEW SET, in the established place and layer order
   (fog → set → King → copy; the strip still rides at z-[20] with the
   pull-up over the hero's bottom rows), a little smaller than the
   original (strip 630/720px → 580/660px), composed AROUND the copy
   and the King instead of over them:

   - Two designed SPOTLIGHT LAMPS on stands — the same fixture family
     as the hero's SpotlightRig lamps (tapered metal can, gold mouth
     rim, lit lens, yoke bolts, gold finish) — in the side gutters:
     a tall key lamp at the left, a slimmer fill lamp at the right
     edge. Their heads stay clear of the King (left) and of the copy
     column (right) by construction.
   - A readable cinema camera on a low tripod at center-left, below
     the King's feet and left of the copy column.
   - Floor props only in the middle band (road case, clapperboard,
     coiled cable) — all below the copy's lowest row at every size.
   - EVERY light is feathered: beams are gradient cones softened by
     a Gaussian blur, glows and floor pools are radial gradients that
     dissolve at their edges — no hard-edged beams, no flat glow
     ovals, no panel glare. A scene-space guard clip additionally
     guarantees no set light can spill into the copy column's or the
     King's measured airspace (desktop + laptop geometry union).
   - The lamps breathe with the theme song's beat, gentler even than
     the rig: the whole light layer swells ±10% opacity on a kick and
     eases back; reduced-motion and silence leave it at rest.

   FIT (owner directive 2026-10-12, unchanged): preserveAspectRatio
   "meet", NEVER "slice"; the whole set fits the frame at every
   width, anchored to the floor (YMax). Halos may bleed a few units
   past the side edges — a halo is light, not equipment; every
   silhouette stays in frame. Verified with the preview rig by
   measured bounding boxes (desktop 2048, laptop 1676, mobile 390,
   both themes): zero equipment overlap with any copy element or
   the King canvas.

   Pure decoration: pointer-events-none, aria-hidden. */

interface SetPalette {
  silhouette: string;
  canBody: string;
  canStroke: string;
  yoke: string;
  rim: string;
  beamHi: string;
  beamMid: string;
  glowCore: string;
  glowMid: string;
  poolCore: string;
  poolMid: string;
  shadow: string;
  floorShadow: string;
  panelTone: string;
}

const DARK: SetPalette = {
  silhouette: "#060504",
  canBody: "#1C1307",
  canStroke: "rgba(201,168,76,0.6)",
  yoke: "#8A6B1F",
  rim: "#C9A84C",
  beamHi: "rgba(255,226,130,0.50)",
  beamMid: "rgba(255,210,100,0.20)",
  glowCore: "rgba(255,232,150,0.55)",
  glowMid: "rgba(255,214,110,0.20)",
  poolCore: "rgba(255,214,110,0.40)",
  poolMid: "rgba(255,206,98,0.16)",
  shadow: "rgba(0,0,0,0.55)",
  floorShadow: "rgba(0,0,0,0.5)",
  panelTone: "rgba(245,214,122,0.30)",
};

const LIGHT: SetPalette = {
  silhouette: "#2A1E07",
  canBody: "#241A0C",
  canStroke: "rgba(122,90,18,0.75)",
  yoke: "#8A6B1F",
  rim: "#A8871F",
  beamHi: "rgba(216,164,32,0.38)",
  beamMid: "rgba(200,150,30,0.15)",
  glowCore: "rgba(255,214,110,0.50)",
  glowMid: "rgba(214,164,32,0.20)",
  poolCore: "rgba(190,150,50,0.32)",
  poolMid: "rgba(168,135,31,0.14)",
  shadow: "rgba(90,66,16,0.30)",
  floorShadow: "rgba(90,66,16,0.26)",
  panelTone: "rgba(122,90,18,0.35)",
};

/* One spotlight fixture in the SpotlightRig's design language, drawn
   pointing down in local units (can ≈ 68 wide): tapered metal can,
   gold mouth rim, lit lens, side sheen, pivot bolts, and a gold
   cradle yoke whose arms hug the can's sides and meet in a crossbar
   below it, where the stand's pole attaches. Place with a transform
   (translate/rotate/scale). */
function SpotLamp({ p, transform }: { p: SetPalette; transform: string }) {
  return (
    <g transform={transform}>
      {/* cradle yoke — gold arms hugging the can, crossbar below */}
      <path
        d="M-34 0 L-34 34 Q-34 44 -25 44 L25 44 Q34 44 34 34 L34 0"
        fill="none"
        stroke={p.yoke}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* tapered can */}
      <path
        d="M-27 -15 L27 -15 L34 27 L-34 27 Z"
        fill={p.canBody}
        stroke={p.canStroke}
        strokeWidth="1.2"
      />
      {/* metal sheen down one side */}
      <path d="M-22 -13 L-13 -13 L-15 25 L-23 25 Z" fill="#ffffff" opacity="0.06" />
      {/* pivot bolts, sitting on the yoke arms over the can's sides */}
      <circle cx="-34" cy="10" r="3.8" fill={p.yoke} />
      <circle cx="34" cy="10" r="3.8" fill={p.yoke} />
      {/* gold mouth rim */}
      <rect x="-36" y="27" width="72" height="5" rx="2.5" fill={p.rim} />
      {/* lit lens */}
      <ellipse cx="0" cy="37" rx="17" ry="4.6" fill="url(#sset-lens)" />
    </g>
  );
}

export function StudioSetStrip({ isLight }: { isLight: boolean }) {
  const p = isLight ? LIGHT : DARK;
  const lightsRef = useRef<SVGGElement | null>(null);

  /* Beat breath — the set's light layer swells gently with the theme
     song's kicks, mirroring the SpotlightRig's driving detection but
     capped far lower (±10% opacity): a soft light dance, never a
     strobe. Silent or reduced-motion: the layer rests untouched. */
  useEffect(() => {
    const el = lightsRef.current;
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let cancelled = false;
    let lastPulseAt = 0;
    const loop = () => {
      if (cancelled) return;
      const beat = getThemeBeat();
      const nowMs = performance.now();
      if (beat && beat.pulse > 0.02) lastPulseAt = nowMs;
      const driving = !!beat && nowMs - lastPulseAt < 1500;
      if (driving && beat) {
        const boost = Math.min(1, beat.pulse * 1.15);
        el.style.opacity = (0.9 + boost * 0.1).toFixed(3);
      } else if (el.style.opacity) {
        el.style.opacity = "";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative z-[20] -mt-[550px] h-[580px] w-full sm:-mt-[628px] sm:h-[660px]"
    >
      {/* Stage floor — the seam cover: a soft gradient floor that
          fades in over the hero's bottom edge and melts into the band. */}
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? "linear-gradient(to bottom, transparent 0%, rgba(120,90,30,0.10) 42%, rgba(120,90,30,0.24) 72%, rgba(120,90,30,0.12) 90%, transparent 100%)"
            : "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.52) 42%, rgba(0,0,0,0.92) 72%, rgba(0,0,0,0.55) 90%, transparent 100%)",
        }}
      />
      <svg
        viewBox="0 0 1440 720"
        preserveAspectRatio="xMidYMax meet"
        className="absolute inset-0 h-full w-full"
        style={{
          color: p.silhouette,
          filter: isLight
            ? "drop-shadow(0 8px 14px rgba(122,90,18,0.30))"
            : "drop-shadow(0 -3px 10px rgba(212,160,23,0.30))",
        }}
      >
        <defs>
          {/* Beam gradients — user-space, lens point → pool point, so
              the light is born at the lens and dissolves at the floor. */}
          <linearGradient id="sset-beam-key" gradientUnits="userSpaceOnUse" x1="111" y1="535" x2="445" y2="698">
            <stop offset="0%" stopColor={p.beamHi} />
            <stop offset="48%" stopColor={p.beamMid} />
            <stop offset="100%" stopColor={p.beamMid} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sset-beam-fill" gradientUnits="userSpaceOnUse" x1="1388" y1="418" x2="1366" y2="700">
            <stop offset="0%" stopColor={p.beamHi} />
            <stop offset="48%" stopColor={p.beamMid} />
            <stop offset="100%" stopColor={p.beamMid} stopOpacity="0" />
          </linearGradient>
          {/* Radial glow + pool — feathered by construction. */}
          <radialGradient id="sset-glow">
            <stop offset="0%" stopColor={p.glowCore} />
            <stop offset="45%" stopColor={p.glowMid} />
            <stop offset="100%" stopColor={p.glowMid} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sset-pool">
            <stop offset="0%" stopColor={p.poolCore} />
            <stop offset="55%" stopColor={p.poolMid} />
            <stop offset="100%" stopColor={p.poolMid} stopOpacity="0" />
          </radialGradient>
          {/* The lamp lens — hot core to warm gold rim, the rig's lens. */}
          <radialGradient id="sset-lens">
            <stop offset="0%" stopColor="#FFF9E0" />
            <stop offset="55%" stopColor="#FFE9A8" />
            <stop offset="100%" stopColor="#E8B33C" />
          </radialGradient>
          {/* Feathering for the beam cones — softens their side edges. */}
          <filter id="sset-blur9" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id="sset-blur5" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          {/* Light guard — the set's light may paint anywhere EXCEPT
              the copy column's airspace (scene x 680–1365, y 0–630)
              and the King's (x 190–537, y 0–405): the union of the
              desktop + laptop measured zones, with margin. */}
          <clipPath id="sset-light-guard">
            <path
              fillRule="evenodd"
              d="M0 0 H1440 V720 H0 Z M680 0 H1365 V630 H680 Z M190 0 H537 V405 H190 Z"
            />
          </clipPath>
        </defs>

        {/* floor shadow — one soft bed the whole set stands on */}
        <g data-piece="FLOOR">
          <ellipse cx="720" cy="713" rx="700" ry="8" fill={p.floorShadow} />
        </g>

        {/* ── LIGHT — every beam, glow and pool, all feathered ── */}
        <g data-piece="LIGHT-FX" ref={lightsRef} clipPath="url(#sset-light-guard)">
          {/* key lamp: lens glow, beam + brighter core, floor pool */}
          <ellipse cx="111" cy="532" rx="92" ry="58" fill="url(#sset-glow)" />
          <polygon points="84,520 138,512 592,682 292,702" fill="url(#sset-beam-key)" filter="url(#sset-blur9)" />
          <polygon points="94,522 128,517 520,684 352,698" fill="url(#sset-beam-key)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="445" cy="700" rx="168" ry="16" fill="url(#sset-pool)" />
          {/* fill lamp: lens glow, beam + core, floor pool */}
          <ellipse cx="1388" cy="416" rx="82" ry="54" fill="url(#sset-glow)" />
          <polygon points="1370,406 1406,402 1432,690 1268,694" fill="url(#sset-beam-fill)" filter="url(#sset-blur9)" />
          <polygon points="1378,408 1398,405 1404,688 1302,692" fill="url(#sset-beam-fill)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="1366" cy="702" rx="112" ry="14" fill="url(#sset-pool)" />
          {/* a soft wash pooled under the camera's mark */}
          <ellipse cx="415" cy="706" rx="195" ry="12" fill="url(#sset-pool)" opacity="0.55" />
        </g>

        {/* ── KEY LAMP (left) — designed spotlight on a stand ── */}
        <g data-piece="KEY-LAMP">
          {/* stand: pole, gold collar, three splayed feet */}
          <rect x="101" y="536" width="15" height="156" fill="currentColor" />
          <rect x="97" y="556" width="23" height="10" rx="3" fill={p.rim} />
          <polygon points="108,648 56,718 76,718 110,668" fill="currentColor" />
          <polygon points="109,648 102,720 118,720 112,668" fill="currentColor" />
          <polygon points="110,648 164,718 144,718 111,668" fill="currentColor" />
          {/* the lamp, tilted down-stage toward its pool */}
          <SpotLamp p={p} transform="translate(84 474) rotate(-24) scale(1.8)" />
        </g>

        {/* ── CINEMA CAMERA (center-left) on a low tripod ── */}
        <g data-piece="CAMERA">
          <ellipse cx="408" cy="714" rx="150" ry="7" fill={p.shadow} />
          {/* tripod: three legs + mid-spreader + pan handle */}
          <polygon points="388,606 316,718 340,718 402,626" fill="currentColor" />
          <polygon points="428,606 496,718 472,718 414,626" fill="currentColor" />
          <polygon points="406,610 398,720 416,720 414,626" fill="currentColor" />
          <polygon points="352,664 452,664 454,671 350,671" fill="currentColor" />
          <polygon points="382,596 318,646 326,654 388,606" fill="currentColor" />
          <rect x="296" y="648" width="26" height="9" rx="4" transform="rotate(38 309 652)" fill="currentColor" />
          {/* fluid head */}
          <circle cx="408" cy="600" r="13" fill="currentColor" />
          <rect x="384" y="578" width="48" height="16" rx="4" fill="currentColor" />
          {/* body */}
          <rect x="306" y="516" width="180" height="90" rx="10" fill="currentColor" />
          <polygon points="306,516 486,516 486,530 306,536" fill="currentColor" opacity="0.55" />
          {/* film magazine — sloped hump on top */}
          <path d="M330,516 L338,488 Q340,478 352,478 L452,478 Q464,478 466,489 L472,516 Z" fill="currentColor" />
          {/* top handle */}
          <rect x="362" y="468" width="42" height="8" rx="4" fill="currentColor" />
          <rect x="368" y="476" width="7" height="5" fill="currentColor" />
          <rect x="392" y="476" width="7" height="5" fill="currentColor" />
          {/* eyepiece extending back */}
          <rect x="278" y="540" width="30" height="14" rx="4" fill="currentColor" />
          <circle cx="272" cy="547" r="9" fill="currentColor" />
          {/* lens cylinder + gold focus rings */}
          <rect x="486" y="534" width="32" height="54" rx="4" fill="currentColor" />
          <rect x="494" y="534" width="4" height="54" fill={p.rim} opacity="0.85" />
          <rect x="504" y="534" width="4" height="54" fill={p.rim} opacity="0.85" />
          {/* matte box + top flag */}
          <polygon points="518,526 546,520 546,596 518,590" fill="currentColor" />
          <polygon points="516,526 548,518 552,526 520,534" fill="currentColor" />
          {/* tally light */}
          <circle cx="474" cy="528" r="4.5" fill="#E8B33C" />
        </g>

        {/* ── FILL LAMP (right edge) — the rig's own fixture, floor-
            standing at the stage's right edge: slimmer than the key,
            tilted just off vertical, its beam a soft shaft like the
            rig's. Head + stand keep inside the scene's right gutter
            so nothing crosses the copy column at any measured size. ── */}
        <g data-piece="FILL-LAMP">
          {/* stand: pole, gold collar, three splayed feet */}
          <rect x="1380" y="422" width="12" height="266" fill="currentColor" />
          <rect x="1376" y="452" width="20" height="10" rx="3" fill={p.rim} />
          <polygon points="1386,636 1354,718 1372,718 1387,658" fill="currentColor" />
          <polygon points="1387,636 1380,720 1394,720 1389,658" fill="currentColor" />
          <polygon points="1388,636 1420,718 1402,718 1389,658" fill="currentColor" />
          {/* the lamp, tilted slightly down-stage toward its pool */}
          <SpotLamp p={p} transform="translate(1394 382) rotate(10) scale(1)" />
        </g>

        {/* ── FLOOR PROPS (center-right) — road case, clapperboard,
            coiled cable: all low, below the copy's lowest row ── */}
        <g data-piece="PROPS">
          <ellipse cx="880" cy="715" rx="290" ry="6" fill={p.shadow} />
          {/* coiled cable on the floor */}
          <ellipse cx="625" cy="700" rx="62" ry="10" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.9" />
          <ellipse cx="625" cy="703" rx="40" ry="7" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.9" />
          {/* road case */}
          <rect x="756" y="636" width="250" height="84" rx="8" fill="currentColor" />
          <rect x="756" y="664" width="250" height="4" fill={p.panelTone} />
          <rect x="756" y="700" width="250" height="6" fill={p.rim} opacity="0.45" />
          <rect x="852" y="628" width="58" height="10" rx="5" fill="currentColor" />
          {/* gold latches */}
          <rect x="796" y="658" width="18" height="30" rx="3" fill={p.rim} />
          <rect x="948" y="658" width="18" height="30" rx="3" fill={p.rim} />
          {/* corner protectors */}
          <path d="M756,652 v-8 a8,8 0 0 1 8,-8 h10 M990,636 h8 a8,8 0 0 1 8,8 v10" fill="none" stroke={p.rim} strokeWidth="3" opacity="0.7" />
          {/* clapperboard leaning on the case */}
          <g transform="rotate(-7 1056 686)">
            <rect x="1004" y="660" width="106" height="60" rx="4" fill="currentColor" />
            <rect x="1004" y="646" width="106" height="15" rx="3" fill="currentColor" />
            <polygon points="1012,649 1028,649 1018,658 1006,658" fill={p.panelTone} />
            <polygon points="1040,649 1056,649 1046,658 1030,658" fill={p.panelTone} />
            <polygon points="1068,649 1084,649 1074,658 1058,658" fill={p.panelTone} />
            <polygon points="1096,649 1108,649 1102,658 1086,658" fill={p.panelTone} />
            <rect x="1012" y="676" width="60" height="5" rx="2" fill={p.panelTone} />
            <rect x="1012" y="690" width="78" height="5" rx="2" fill={p.panelTone} />
          </g>
        </g>
      </svg>
    </div>
  );
}
