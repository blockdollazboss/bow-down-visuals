import { useEffect, useRef } from "react";
import { getThemeBeat } from "@/lib/theme-analyser";

/* StudioSetStrip — the homepage hero's film set, standing on a soft
   stage-floor gradient across the seam between the hero and the
   social-proof band (the floor gradient melts the backdrop/fog edges
   the owner flagged 2026-10-12; the set stands on the seam).

   OPTION B — "DIRECTOR'S STAGE", THE OWNER'S VERSION (2026-10-14):
   the owner rejected two earlier builds the same day — a relocation
   ("You moved it completely") and a flat-silhouette redesign ("that
   looks completely stupid") — then picked Option B from a design
   preview and corrected it three times in his own words. This build
   is his spec, not an interpretation of it:

   - The set stays IN the hero, in its original place and layer order
     (fog → set → King → copy; the strip still rides at z-[20] with
     the pull-up over the hero's bottom rows), a little smaller than
     the giant tripled version (strip 630/720px → 580/660px), artwork
     composed AROUND the copy and the King.
   - A cinema camera on a LOW DOLLY TRACK across the middle, AIMING
     FORWARD — front-on round lens and matte box facing the viewer.
   - Two tall spotlight lamps with barn doors, one at each side,
     heads FRONT-FACING — round lenses looking out at the viewer.
     Their beams project FORWARD: feathered cones widening from each
     lens toward the viewer, ending in a gentle glow at the FRONT
     edge of the stage. Not at each other, not across the set, not
     raking down into floor pools (owner corrected the aim three
     times — forward is the whole point).
   - A LOW director's chair at the far left edge only.
   - SPEAKERS on both sides of the floor instead of briefcases/road
     cases (owner edit) — shaded cabinets, visible cones, gold trim.
     No road case, no briefcase, no clapperboard.
   - BOLD floor wires (owner edit — he could not see the previous
     attempt): thick, high-contrast cables snaking between lamps,
     speakers and camera, a foreground run across the front, and a
     clearly readable coil beside the dolly.
   - STYLE LAW (the reason the silhouette build died): every piece is
     a dimensionally SHADED illustration — multi-stop brass/walnut/
     bronze gradients, rim light, cast shadows — in BOTH themes. If a
     piece reads as a flat black pictogram, it is wrong.
   - EVERY light is feathered (gradient cones softened by Gaussian
     blur, radial glows that dissolve at their edges), and a
     scene-space guard clip guarantees no set light can spill into
     the copy column's or the King's measured airspace (desktop +
     laptop geometry union).
   - The lamps breathe with the theme song's beat: the whole light
     layer swells ±10% opacity on a kick and eases back; reduced
     motion and silence leave it at rest.

   FIT (owner directive 2026-10-12, unchanged): preserveAspectRatio
   "meet", NEVER "slice"; the whole set fits the frame at every
   width, anchored to the floor (YMax). Halos may bleed a few units
   past the side edges — a halo is light, not equipment; every
   silhouette stays in frame. Verified with the preview rig by
   measured bounding boxes (desktop 2048, laptop 1676, mobile 390,
   both themes): zero equipment overlap with any copy element or
   the King canvas.

   FRAME FIX (owner, 2026-10-14 — "the set should be fit in this
   frame. It need to be slid up"): the v3 build's floor ran to page
   y1244 at desktop — past the 1211px hero's bottom and 92px below
   the 1152px first-screen capture — so the set read as cut off.
   Measured diagnosis + fix, all of it sm+ only (mobile already fit
   and keeps the exact v3 geometry):
   - The strip rides 106px higher via a purely visual translate
     (layout, the hero's height and mobile are untouched).
   - The key lamp's stand shortens at sm+ (lens 492→560): raised at
     full height, its barn doors crossed the King canvas's bottom
     edge — laptop was the binding size (8px clearance now).
   - The camera scales to 0.81 about its floor mark at sm+, same
     reason (its top flag grazed the King's bottom edge).
   - Both speakers move in from under the copy column to flank the
     camera at sm+: the copy column's airspace has no room for a
     floor piece once the floor rises past its lowest rows.
   - The floor shadow splits into two beds that stop at the copy
     column's edges, and the floor wires pass BEHIND the copy
     column (split runs) instead of crossing it — same reason.
   Re-verified with the preview rig (hero-set-preview-v4): every
   equipment bottom inside the hero and, at 2048/1676, at or above
   the copy column's own bottom line; zero overlaps, 6/6 configs.

   Pure decoration: pointer-events-none, aria-hidden. */

interface SetPalette {
  ink: string;
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
  /* Gradient stop triples [top, mid, bottom] (brass: [edge, hi, edge]). */
  can: [string, string, string];
  walnut: [string, string, string];
  brass: [string, string, string];
  body: [string, string, string];
  fabric: [string, string, string];
  metal: [string, string, string];
  cab: [string, string, string];
}

const DARK: SetPalette = {
  ink: "#241A0C",
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
  can: ["#4A3410", "#241708", "#120A02"],
  walnut: ["#513619", "#2A1A0C", "#170D04"],
  brass: ["#7A5A12", "#E8C86A", "#6D5216"],
  body: ["#3D2A10", "#1A1206", "#0A0602"],
  fabric: ["#5A421C", "#3A2A10", "#241806"],
  metal: ["#4D3A16", "#241A0C", "#0F0A04"],
  cab: ["#3A2812", "#1F1408", "#100A03"],
};

const LIGHT: SetPalette = {
  ink: "#2A1E07",
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
  can: ["#6B4D1C", "#3A2810", "#241806"],
  walnut: ["#7A5A28", "#4A3312", "#2A1C08"],
  brass: ["#8A6B1F", "#E8C86A", "#A8871F"],
  body: ["#54401E", "#2A1E0C", "#170F05"],
  fabric: ["#8A6A30", "#5F4718", "#3A2A10"],
  metal: ["#6D5216", "#3A2A10", "#1F1507"],
  cab: ["#5F451C", "#33240E", "#1F1507"],
};

const n = (v: number) => Math.round(v * 10) / 10;

/* One FRONT-FACING spotlight: round lit lens looking out at the
   viewer, barn doors framing the housing, gold cradle yoke, and a
   tripod stand planted on the floor. The lens sits at (cx, lensY);
   s scales the head + stand spread; floorY is the scene floor. */
function FrontLamp({
  p,
  cx,
  lensY,
  s,
  floorY,
}: {
  p: SetPalette;
  cx: number;
  lensY: number;
  s: number;
  floorY: number;
}) {
  const legTop = floorY - 64;
  return (
    <g>
      {/* cast shadow bed under the stand — kept inside the lamp's own
          footprint: at 92·s the fill lamp's shadow tip crossed the
          copy column's edge (desktop) and the scene's right edge
          (mobile); 58·s keeps it clear at every measured size */}
      <ellipse cx={cx} cy={floorY - 2} rx={n(58 * s)} ry="6" fill={p.shadow} />
      {/* tripod legs */}
      <polygon
        points={`${n(cx - 3 * s)},${legTop} ${n(cx - 57 * s)},${floorY} ${n(cx - 40 * s)},${floorY} ${cx},${legTop + 13}`}
        fill="url(#sset-metal)"
      />
      <polygon
        points={`${n(cx - 2.5 * s)},${legTop + 5} ${n(cx - 6.5 * s)},${floorY} ${n(cx + 6.5 * s)},${floorY} ${n(cx + 2.5 * s)},${legTop + 5}`}
        fill="url(#sset-metal)"
      />
      <polygon
        points={`${n(cx + 3 * s)},${legTop} ${n(cx + 57 * s)},${floorY} ${n(cx + 40 * s)},${floorY} ${cx},${legTop + 13}`}
        fill="url(#sset-metal)"
      />
      {/* pole + gold collar */}
      <rect
        x={n(cx - 6 * s)}
        y={n(lensY + 54 * s)}
        width={n(12 * s)}
        height={n(floorY - 12 - (lensY + 54 * s))}
        fill="url(#sset-metal)"
      />
      <rect x={n(cx - 11 * s)} y={n(lensY + 47 * s)} width={n(22 * s)} height={n(9 * s)} rx="3" fill="url(#sset-brass)" />
      {/* head, lens at (cx, lensY) */}
      <g transform={`translate(${cx} ${lensY}) scale(${s})`}>
        {/* barn doors — flaps framing the housing on all four sides */}
        <polygon points="-36,-32 36,-32 50,-52 -50,-52" fill="url(#sset-metal)" stroke={p.canStroke} strokeWidth="1" />
        <polygon points="-32,-28 -32,28 -52,42 -52,-42" fill="url(#sset-metal)" stroke={p.canStroke} strokeWidth="1" />
        <polygon points="32,-28 32,28 52,42 52,-42" fill="url(#sset-metal)" stroke={p.canStroke} strokeWidth="1" />
        <polygon points="-32,32 32,32 44,48 -44,48" fill="url(#sset-metal)" stroke={p.canStroke} strokeWidth="1" />
        {/* tapered bronze can */}
        <circle cx="0" cy="0" r="38" fill="url(#sset-can)" stroke={p.rim} strokeWidth="1.2" strokeOpacity="0.6" />
        <circle cx="0" cy="0" r="34" fill="none" stroke="#000000" strokeOpacity="0.35" strokeWidth="1.5" />
        {/* bezel + lit lens — hot core to warm gold rim */}
        <circle cx="0" cy="0" r="30" fill="#0A0603" stroke="url(#sset-brass)" strokeWidth="2.5" />
        <circle cx="0" cy="0" r="24" fill="url(#sset-lens)" />
        <circle cx="0" cy="0" r="24" fill="none" stroke={p.rim} strokeWidth="1" strokeOpacity="0.8" />
        <circle cx="-8" cy="-9" r="5" fill="#ffffff" opacity="0.5" />
        {/* cradle yoke + pivot bolts + mount knob */}
        <path
          d="M-52,-4 L-52,24 Q-52,38 -38,38 L38,38 Q52,38 52,24 L52,-4"
          fill="none"
          stroke={p.yoke}
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="-52" cy="2" r="5.5" fill={p.yoke} />
        <circle cx="52" cy="2" r="5.5" fill={p.yoke} />
        <circle cx="-52" cy="2" r="2" fill="#150E05" />
        <circle cx="52" cy="2" r="2" fill="#150E05" />
        <rect x="-5" y="38" width="10" height="9" rx="2" fill={p.yoke} />
      </g>
    </g>
  );
}

/* One floor-standing speaker cabinet (94×80 local units, origin at
   its top-left): shaded walnut cabinet, gold trim, and a visible
   tweeter / mid / woofer stack with gold dust caps. */
function SpeakerCab({ p, x, y }: { p: SetPalette; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="47" cy="82" rx="56" ry="5" fill={p.shadow} />
      <rect x="0" y="0" width="94" height="80" rx="7" fill="url(#sset-cab)" stroke={p.canStroke} strokeWidth="1" />
      <rect x="3" y="3" width="88" height="3" rx="1.5" fill="#ffffff" opacity="0.05" />
      <rect x="1.5" y="1.5" width="91" height="77" rx="6" fill="none" stroke={p.rim} strokeWidth="1" opacity="0.45" />
      {/* front baffle */}
      <rect x="9" y="9" width="76" height="62" rx="4" fill="#0D0803" />
      {/* woofer */}
      <circle cx="47" cy="50" r="16" fill="url(#sset-cone)" stroke="#3A2A10" strokeWidth="2" />
      <circle cx="47" cy="50" r="6" fill="url(#sset-cap)" />
      {/* mid */}
      <circle cx="47" cy="27" r="8.5" fill="url(#sset-cone)" stroke="#3A2A10" strokeWidth="1.5" />
      <circle cx="47" cy="27" r="3" fill="url(#sset-cap)" />
      {/* tweeter */}
      <circle cx="47" cy="13" r="4" fill="url(#sset-cap)" stroke="#6D5216" strokeWidth="0.75" />
      {/* corner screws */}
      <circle cx="6" cy="6" r="1.6" fill={p.rim} opacity="0.8" />
      <circle cx="88" cy="6" r="1.6" fill={p.rim} opacity="0.8" />
      <circle cx="6" cy="74" r="1.6" fill={p.rim} opacity="0.8" />
      <circle cx="88" cy="74" r="1.6" fill={p.rim} opacity="0.8" />
    </g>
  );
}

/* A bold floor cable in three passes — soft shadow, dark body, thin
   gold top highlight — so it stays readable even at phone size. */
function WirePath({ d, w, className }: { d: string; w: number; className?: string }) {
  return (
    <g fill="none" strokeLinecap="round" className={className}>
      <path d={d} stroke="#000000" strokeOpacity="0.5" strokeWidth={w + 2.5} transform="translate(0 2)" />
      <path d={d} stroke="#16100A" strokeWidth={w} />
      <path d={d} stroke="#D8B25C" strokeOpacity="0.5" strokeWidth="1.8" transform="translate(0 -2.2)" />
    </g>
  );
}

const SLEEPERS = [312, 358, 404, 450, 496, 542, 588, 634];

export function StudioSetStrip({ isLight }: { isLight: boolean }) {
  const p = isLight ? LIGHT : DARK;
  /* Two light layers (mobile + sm+ twins, frame fix) — the beat
     breath drives both; only one is displayed at any width. */
  const lightsRef = useRef<(SVGGElement | null)[]>([]);

  /* Beat breath — the set's light layer swells gently with the theme
     song's kicks, mirroring the SpotlightRig's driving detection but
     capped far lower (±10% opacity): a soft light dance, never a
     strobe. Silent or reduced-motion: the layer rests untouched. */
  useEffect(() => {
    const els = lightsRef.current.filter((e): e is SVGGElement => !!e);
    if (!els.length || typeof window === "undefined") return;
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
        els.forEach((el) => { el.style.opacity = (0.9 + boost * 0.1).toFixed(3); });
      } else {
        els.forEach((el) => { if (el.style.opacity) el.style.opacity = ""; });
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
      className="pointer-events-none relative z-[20] -mt-[550px] h-[580px] w-full sm:-mt-[628px] sm:h-[660px] sm:-translate-y-[106px]"
    >
      {/* Frame fix: the sm:-translate-y-[106px] above is the "slide
          up" — visual only, so the hero's layout height, the seam
          the strip melts into, and mobile are all unchanged. */}
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
          color: p.ink,
          filter: isLight
            ? "drop-shadow(0 8px 14px rgba(122,90,18,0.30))"
            : "drop-shadow(0 -3px 10px rgba(212,160,23,0.30))",
        }}
      >
        <defs>
          {/* Material gradients — the shaded-illustration law: no
              piece is a flat fill; brass, walnut, bronze and fabric
              all carry a light-to-dark falloff. */}
          <linearGradient id="sset-can" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.can[0]} />
            <stop offset="55%" stopColor={p.can[1]} />
            <stop offset="100%" stopColor={p.can[2]} />
          </linearGradient>
          <linearGradient id="sset-walnut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.walnut[0]} />
            <stop offset="55%" stopColor={p.walnut[1]} />
            <stop offset="100%" stopColor={p.walnut[2]} />
          </linearGradient>
          <linearGradient id="sset-brass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={p.brass[0]} />
            <stop offset="50%" stopColor={p.brass[1]} />
            <stop offset="100%" stopColor={p.brass[2]} />
          </linearGradient>
          <linearGradient id="sset-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.body[0]} />
            <stop offset="55%" stopColor={p.body[1]} />
            <stop offset="100%" stopColor={p.body[2]} />
          </linearGradient>
          <linearGradient id="sset-fabric" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.fabric[0]} />
            <stop offset="55%" stopColor={p.fabric[1]} />
            <stop offset="100%" stopColor={p.fabric[2]} />
          </linearGradient>
          <linearGradient id="sset-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.metal[0]} />
            <stop offset="55%" stopColor={p.metal[1]} />
            <stop offset="100%" stopColor={p.metal[2]} />
          </linearGradient>
          <linearGradient id="sset-cab" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.cab[0]} />
            <stop offset="55%" stopColor={p.cab[1]} />
            <stop offset="100%" stopColor={p.cab[2]} />
          </linearGradient>
          {/* Speaker cone + gold dust cap. */}
          <radialGradient id="sset-cone">
            <stop offset="0%" stopColor="#1F1508" />
            <stop offset="60%" stopColor="#0D0903" />
            <stop offset="100%" stopColor="#050403" />
          </radialGradient>
          <radialGradient id="sset-cap">
            <stop offset="0%" stopColor="#FFE9A8" />
            <stop offset="60%" stopColor="#C9A84C" />
            <stop offset="100%" stopColor="#8A6B1F" />
          </radialGradient>
          {/* Camera glass — a cool deep lens with a bright heart. */}
          <radialGradient id="sset-glass">
            <stop offset="0%" stopColor="#7D93A8" />
            <stop offset="35%" stopColor="#22303E" />
            <stop offset="70%" stopColor="#05070A" />
            <stop offset="100%" stopColor="#020304" />
          </radialGradient>
          {/* Beam gradients — user-space, lens point → front edge, so
              the light is born at the lens and dissolves forward. */}
          <linearGradient id="sset-beam-key" gradientUnits="userSpaceOnUse" x1="262" y1="492" x2="262" y2="706">
            <stop offset="0%" stopColor={p.beamHi} />
            <stop offset="48%" stopColor={p.beamMid} />
            <stop offset="100%" stopColor={p.beamMid} stopOpacity="0" />
          </linearGradient>
          {/* The sm+ key lamp sits lower (lens 560) — its beam gets a
              gradient born at that lens point. */}
          <linearGradient id="sset-beam-key-sm" gradientUnits="userSpaceOnUse" x1="262" y1="560" x2="262" y2="706">
            <stop offset="0%" stopColor={p.beamHi} />
            <stop offset="48%" stopColor={p.beamMid} />
            <stop offset="100%" stopColor={p.beamMid} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sset-beam-fill" gradientUnits="userSpaceOnUse" x1="1395" y1="398" x2="1395" y2="706">
            <stop offset="0%" stopColor={p.beamHi} />
            <stop offset="48%" stopColor={p.beamMid} />
            <stop offset="100%" stopColor={p.beamMid} stopOpacity="0" />
          </linearGradient>
          {/* Radial glow + front-edge pool — feathered by construction. */}
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
          {/* Light guards — the set's light may paint anywhere EXCEPT
              the copy column's and the King's measured airspace.
              Two versions (frame fix): the base guard is the v3
              union for the unchanged mobile geometry (copy
              x 680–1365 y 0–630, King x 190–537 y 0–405); the sm
              guard matches the raised strip — its copy cut runs to
              y 735 (the copy's lowest row in post-shift scene
              coordinates) and its King cut spans the King's full
              measured width (x 70–615) to y 470. */}
          <clipPath id="sset-light-guard">
            <path
              fillRule="evenodd"
              d="M0 0 H1440 V720 H0 Z M680 0 H1365 V630 H680 Z M190 0 H537 V405 H190 Z"
            />
          </clipPath>
          <clipPath id="sset-light-guard-sm">
            <path
              fillRule="evenodd"
              d="M0 0 H1440 V720 H0 Z M690 0 H1355 V735 H690 Z M70 0 H615 V470 H70 Z"
            />
          </clipPath>
        </defs>

        {/* floor shadow — one soft bed the whole set stands on.
            Mobile keeps the single full-width bed. At sm+ the bed
            becomes two beds that stop at the copy column's edges:
            raised 106px, a full-width bed's shadow would cross the
            copy's lowest rows (frame fix). */}
        <g data-piece="FLOOR">
          <ellipse cx="720" cy="713" rx="700" ry="8" fill={p.floorShadow} className="sm:hidden" />
          <ellipse cx="330" cy="713" rx="340" ry="8" fill={p.floorShadow} className="hidden sm:block" />
        </g>
        <g data-piece="FLOOR-R" className="hidden sm:block">
          <ellipse cx="1406" cy="713" rx="46" ry="8" fill={p.floorShadow} />
        </g>

        {/* ── LIGHT — every beam and glow, all feathered, all aimed
            FORWARD: cones widen from each lens toward the viewer and
            dissolve into a soft glow at the stage's front edge.
            Two twins (frame fix): mobile keeps the v3 geometry (key
            lens 492, v3 guard); sm+ matches the shortened key lamp
            (lens 560) and the sm guard. ── */}
        <g data-piece="LIGHT-FX" className="sm:hidden" ref={(el) => { lightsRef.current[0] = el; }} clipPath="url(#sset-light-guard)">
          {/* key lamp (left): lens glow, forward cone + core, front glow */}
          <ellipse cx="262" cy="492" rx="98" ry="62" fill="url(#sset-glow)" />
          <polygon points="232,502 292,502 386,700 138,700" fill="url(#sset-beam-key)" filter="url(#sset-blur9)" />
          <polygon points="246,502 278,502 340,700 184,700" fill="url(#sset-beam-key)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="262" cy="707" rx="175" ry="15" fill="url(#sset-pool)" />
          {/* fill lamp (right): lens glow, forward cone + core, front glow */}
          <ellipse cx="1395" cy="398" rx="74" ry="50" fill="url(#sset-glow)" />
          <polygon points="1372,408 1418,408 1446,700 1322,700" fill="url(#sset-beam-fill)" filter="url(#sset-blur9)" />
          <polygon points="1382,408 1408,408 1428,700 1352,700" fill="url(#sset-beam-fill)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="1395" cy="707" rx="125" ry="13" fill="url(#sset-pool)" />
          {/* a soft wash pooled under the camera's mark */}
          <ellipse cx="470" cy="709" rx="205" ry="12" fill="url(#sset-pool)" opacity="0.5" />
        </g>
        <g data-piece="LIGHT-FX" className="hidden sm:block" ref={(el) => { lightsRef.current[1] = el; }} clipPath="url(#sset-light-guard-sm)">
          {/* key lamp (left, lens 560 at sm+): glow, cone + core, front glow */}
          <ellipse cx="262" cy="560" rx="98" ry="62" fill="url(#sset-glow)" />
          <polygon points="232,570 292,570 386,700 138,700" fill="url(#sset-beam-key-sm)" filter="url(#sset-blur9)" />
          <polygon points="246,570 278,570 340,700 184,700" fill="url(#sset-beam-key-sm)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="262" cy="707" rx="175" ry="15" fill="url(#sset-pool)" />
          {/* fill lamp (right): lens glow, forward cone + core, front glow */}
          <ellipse cx="1395" cy="398" rx="74" ry="50" fill="url(#sset-glow)" />
          <polygon points="1372,408 1418,408 1446,700 1322,700" fill="url(#sset-beam-fill)" filter="url(#sset-blur9)" />
          <polygon points="1382,408 1408,408 1428,700 1352,700" fill="url(#sset-beam-fill)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="1395" cy="707" rx="125" ry="13" fill="url(#sset-pool)" />
          {/* a soft wash pooled under the camera's mark */}
          <ellipse cx="470" cy="709" rx="205" ry="12" fill="url(#sset-pool)" opacity="0.5" />
        </g>

        {/* ── DIRECTOR'S CHAIR — far left edge only, kept LOW ── */}
        <g data-piece="CHAIR">
          <ellipse cx="88" cy="714" rx="64" ry="6" fill={p.shadow} />
          {/* back posts */}
          <rect x="44" y="540" width="8" height="160" fill="url(#sset-walnut)" />
          <rect x="124" y="540" width="8" height="160" fill="url(#sset-walnut)" />
          {/* backrest canvas + brass top rail */}
          <rect x="38" y="540" width="100" height="54" rx="7" fill="url(#sset-fabric)" stroke={p.canStroke} strokeWidth="0.75" />
          <rect x="38" y="540" width="100" height="9" rx="4" fill="url(#sset-brass)" opacity="0.85" />
          {/* armrests */}
          <rect x="30" y="592" width="26" height="8" rx="4" fill="url(#sset-walnut)" />
          <rect x="120" y="592" width="26" height="8" rx="4" fill="url(#sset-walnut)" />
          <rect x="40" y="600" width="6" height="10" fill="url(#sset-walnut)" />
          <rect x="130" y="600" width="6" height="10" fill="url(#sset-walnut)" />
          {/* seat canvas */}
          <polygon points="40,606 136,606 132,624 44,624" fill="url(#sset-fabric)" stroke={p.canStroke} strokeWidth="0.5" />
          {/* X legs + stretcher */}
          <polygon points="48,624 58,624 128,706 116,706" fill="url(#sset-walnut)" />
          <polygon points="128,624 118,624 48,706 60,706" fill="url(#sset-walnut)" />
          <rect x="52" y="664" width="72" height="6" fill="url(#sset-walnut)" opacity="0.8" />
        </g>

        {/* ── KEY LAMP (left) — front-facing spotlight on a tripod.
            Mobile keeps the tall stand (lens 492 — it fit). At sm+
            the stand is shorter (lens 560): raised at full height,
            the head's barn doors crossed the King canvas's bottom
            edge, laptop binding (frame fix). ── */}
        <g data-piece="KEY-LAMP">
          <g className="sm:hidden">
            <FrontLamp p={p} cx={262} lensY={492} s={1} floorY={717} />
          </g>
          <g className="hidden sm:block">
            <FrontLamp p={p} cx={262} lensY={560} s={1} floorY={717} />
          </g>
        </g>

        {/* ── CINEMA CAMERA (center-left) on a low dolly track,
            aiming FORWARD — front-on lens + matte box. Frame fix:
            at sm+ it scales to 0.81 about its floor mark — raised
            full-size, its top flag crossed the King canvas's bottom
            edge (laptop binding). Mobile keeps full size. ── */}
        <g data-piece="CAMERA" className="sm:[transform-box:fill-box] sm:[transform-origin:50%_100%] sm:scale-[0.81]">
          <ellipse cx="470" cy="713" rx="185" ry="7" fill={p.shadow} />
          {/* dolly track: sleepers + two rails */}
          {SLEEPERS.map((x) => (
            <rect key={x} x={x} y="690" width="30" height="20" fill="#17100A" opacity="0.8" />
          ))}
          <rect x="296" y="691" width="368" height="5" rx="2.5" fill="url(#sset-brass)" />
          <rect x="296" y="703" width="368" height="5" rx="2.5" fill="url(#sset-brass)" opacity="0.75" />
          {/* dolly deck + wheels on the rails */}
          <rect x="392" y="662" width="156" height="28" rx="6" fill="url(#sset-walnut)" stroke={p.canStroke} strokeWidth="0.75" />
          <circle cx="424" cy="693" r="10" fill="#0D0903" stroke={p.rim} strokeWidth="1.5" />
          <circle cx="424" cy="693" r="3" fill="url(#sset-cap)" />
          <circle cx="516" cy="693" r="10" fill="#0D0903" stroke={p.rim} strokeWidth="1.5" />
          <circle cx="516" cy="693" r="3" fill="url(#sset-cap)" />
          {/* pedestal column + collar */}
          <rect x="450" y="598" width="40" height="64" fill="url(#sset-body)" />
          <rect x="444" y="592" width="52" height="12" rx="3" fill="url(#sset-brass)" />
          {/* body — shaded charcoal-bronze, lighter toward the top */}
          <rect x="370" y="490" width="200" height="110" rx="14" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="1" />
          <polygon points="370,504 570,504 570,518 370,524" fill="#ffffff" opacity="0.05" />
          {/* side grips */}
          <rect x="350" y="516" width="20" height="50" rx="6" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="0.75" />
          <rect x="570" y="516" width="20" height="50" rx="6" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="0.75" />
          {/* top handle */}
          <rect x="440" y="468" width="8" height="22" fill="url(#sset-body)" />
          <rect x="492" y="468" width="8" height="22" fill="url(#sset-body)" />
          <rect x="436" y="460" width="68" height="10" rx="5" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="0.75" />
          {/* matte box — the front frame the lens looks through */}
          <rect x="402" y="482" width="136" height="134" rx="10" fill="#120B04" stroke={p.rim} strokeWidth="1" strokeOpacity="0.5" />
          <rect x="420" y="500" width="100" height="98" rx="6" fill="#050403" />
          {/* top flag */}
          <polygon points="402,482 538,482 550,462 390,462" fill="#17100A" stroke={p.canStroke} strokeWidth="0.5" />
          {/* the lens — gold focus rings around deep glass */}
          <circle cx="470" cy="549" r="38" fill="none" stroke="#8A6B1F" strokeWidth="2" />
          <circle cx="470" cy="549" r="34" fill="url(#sset-glass)" stroke={p.rim} strokeWidth="3" />
          <circle cx="458" cy="536" r="6" fill="#ffffff" opacity="0.55" />
          {/* tally light + gold brand plate */}
          <circle cx="548" cy="502" r="9" fill="#FFB02E" opacity="0.35" />
          <circle cx="548" cy="502" r="5" fill="#FFB02E" />
          <rect x="452" y="578" width="36" height="12" rx="2" fill="url(#sset-brass)" opacity="0.9" />
        </g>

        {/* ── SPEAKERS — floor cabinets flanking the set, in place of
            the old road case + clapperboard. Mobile keeps the v3
            spots. At sm+ both cabinets flank the camera instead:
            their old spots sit under the copy column, whose airspace
            has no room for a floor piece once the strip is raised
            (frame fix). ── */}
        <g data-piece="SPEAKERS">
          <g className="sm:hidden">
            <SpeakerCab p={p} x={648} y={638} />
            <SpeakerCab p={p} x={1160} y={638} />
          </g>
          <g className="hidden sm:block">
            <SpeakerCab p={p} x={186} y={638} />
            <SpeakerCab p={p} x={586} y={638} />
          </g>
        </g>

        {/* ── FILL LAMP (right edge) — front-facing spotlight, slimmer
            than the key, standing in the right gutter so its head and
            stand stay clear of the copy column at every size ── */}
        <g data-piece="FILL-LAMP">
          <FrontLamp p={p} cx={1395} lensY={398} s={0.72} floorY={717} />
        </g>

        {/* ── FLOOR WIRES — bold cables: a snake between lamps,
            speakers and camera, a coil beside the dolly, the camera's
            power lead, and a foreground run across the front.
            Mobile keeps the full-width runs (v3). At sm+ the snake
            and the foreground run pass BEHIND the copy column in two
            segments instead of crossing its lowest rows (frame fix);
            the right-hand stubs live in WIRES-R. ── */}
        <g data-piece="WIRES">
          <WirePath
            className="sm:hidden"
            d="M148,707 C 225,693 305,716 385,704 C 455,694 525,715 612,704 C 695,694 762,715 852,705 C 948,695 1042,716 1132,705 C 1222,695 1312,715 1392,702"
            w={7}
          />
          <WirePath
            className="hidden sm:block"
            d="M148,707 C 225,693 305,716 385,704 C 455,694 525,715 612,704 C 645,699 668,702 690,700"
            w={7}
          />
          {/* camera power lead, dropping to the coil */}
          <WirePath d="M500,636 C 540,668 570,690 596,698" w={6} />
          {/* coil beside the dolly */}
          <g fill="none" strokeLinecap="round">
            <ellipse cx="608" cy="702" rx="47" ry="10.5" stroke="#16100A" strokeWidth="7" />
            <ellipse cx="608" cy="702" rx="34" ry="8" stroke="#16100A" strokeWidth="6" />
            <ellipse cx="608" cy="702" rx="22" ry="5.5" stroke="#16100A" strokeWidth="5" />
            <path d="M561,702 A47,10.5 0 0 1 655,702" stroke="#D8B25C" strokeOpacity="0.5" strokeWidth="1.8" />
          </g>
          {/* foreground run across the front of the stage */}
          <WirePath
            className="sm:hidden"
            d="M64,715 C 320,706 560,718 800,710 C 1040,702 1240,717 1396,709"
            w={7.5}
          />
          <WirePath
            className="hidden sm:block"
            d="M64,715 C 320,706 560,718 690,711"
            w={7.5}
          />
        </g>
        {/* the wires' right-hand stubs at sm+ — they emerge from
            behind the copy column's right edge to reach the fill
            lamp's feet */}
        <g data-piece="WIRES-R" className="hidden sm:block">
          <WirePath d="M1355,704 C 1368,698 1380,702 1392,702" w={7} />
          <WirePath d="M1355,710 C 1368,706 1382,708 1396,709" w={7.5} />
        </g>
      </svg>
    </div>
  );
}
