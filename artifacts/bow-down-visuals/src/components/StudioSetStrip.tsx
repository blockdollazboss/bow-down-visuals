import { useEffect, useRef } from "react";
import { getThemeBeat } from "@/lib/theme-analyser";

/* StudioSetStrip — the homepage hero's film set, standing on the seam
   between the hero and the social-proof band (the floor gradient melts
   the backdrop/fog edges the owner flagged 2026-10-12; the set stands
   on the seam).

   OPTION C — "THE PALACE STAGE", THE OWNER'S PICK (2026-10-14): after
   the restored Option B set still read wrong to him ("The studio
   setup is not looking good" — shelf-line floor, lopsided layout, toy
   speakers, flat chair, washed-out wires), the owner was shown three
   drawn layouts and picked C in his own words: "Build C — The Palace
   Stage — that's my pick for the studio set." This build is that
   drawing, fitted to the hero's real measured geometry:

   - The set is spaced WIDE on a DARK MARBLE STAGE FLOOR: a real floor
     plane (marble gradient, veining, perspective seams, contact
     shadows pooled under every piece) with a THIN GOLD TRIM LINE SET
     INTO the floor near its front edge — a line in the floor, never
     again the glowing shelf the pieces perched on.
   - Lamps posted at the two FRONT CORNERS, heads FRONT-FACING —
     round lenses looking out at the viewer, beams projecting FORWARD
     in feathered cones to a soft glow at the stage's front edge (the
     forward-aim law from the Option B round stands untouched).
   - Two TALL FLOOR MONITORS (the speakers, grown up): shaded walnut
     towers with twin woofers, gold-ringed drivers and dust caps,
     standing just inside the corner lamps. The left monitor stands
     in the front row; the right monitor stands a step BACK on the
     floor (its base rides higher on the plane) — the copy column's
     measured airspace leaves no tall slot in the front row on the
     right, and depth was the smallest change that kept it tall.
   - The dolly CAMERA sits center-left on an EXTENDED track (rails +
     sleepers spanning its full travel) and SLIDES LEFT AND RIGHT,
     MOUSE-TRACKED (owner directive, 2026-10-14): it rides its rails
     following the cursor, lerped and bounded to ±40 scene units,
     resting centered for reduced-motion visitors.
   - The DIRECTOR'S CHAIR sits RIGHT of the camera (the director's /
     host's spot), rebuilt dimensional — walnut frame, shaded fabric
     back with brass studs, padded seat, X legs — no more flat bench.
   - Wires run DARKER AND THICKER than the B round, trailing across
     the floor between the pieces to a clearly readable COIL on the
     open floor right of the chair.
   - STYLE LAW (unchanged): every piece is a dimensionally SHADED
     illustration — multi-stop brass/walnut/bronze gradients, rim
     light, cast shadows — in BOTH themes. Flat pictograms are wrong.
   - The lamps breathe with the theme song's beat: the whole light
     layer swells ±10% opacity on a kick and eases back; reduced
     motion and silence leave it at rest.

   THE HANGING MICROPHONE IS *NOT* IN THIS FILE — deliberately. The
   owner directed a condenser mic hanging on a cable from the top of
   the hero frame, swinging mouse-tracked, near the chair. This strip
   is a bottom-band component: its box (580/660px) is pulled up over
   the hero's bottom rows only, so the frame top sits ~430–920px
   ABOVE the strip's top edge (the distance varies by breakpoint and
   by the hero's content-driven height, which the strip cannot know),
   and anything the strip paints rides at z-[20], ABOVE the King
   (z-[4]) and the copy (z-10). On phones the hero stacks full-width
   (King canvas + every copy row), so a strip-born cable would slice
   across the King and the headline and break the zero-overlap law
   below. The mic belongs in its own hero-anchored layer (the
   SpotlightRig pattern, home.tsx) — flagged to the owner as a
   structural decision on 2026-10-14 rather than hacked in here.

   FIT (owner directive 2026-10-12, unchanged): preserveAspectRatio
   "meet", NEVER "slice"; the whole set fits the frame at every
   width, anchored to the floor (YMax). Verified with the preview rig
   by measured bounding boxes (desktop 2048, laptop 1676, mobile 390,
   both themes): zero equipment overlap with any copy element or the
   King canvas — at REST and at the camera slide's two extremes.

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
  vein: string;
  seam: string;
  /* Gradient stop triples [top, mid, bottom] (brass: [edge, hi, edge]). */
  can: [string, string, string];
  walnut: [string, string, string];
  brass: [string, string, string];
  body: [string, string, string];
  fabric: [string, string, string];
  metal: [string, string, string];
  cab: [string, string, string];
  marble: [string, string, string];
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
  vein: "rgba(232,200,106,0.055)",
  seam: "rgba(0,0,0,0.16)",
  can: ["#4A3410", "#241708", "#120A02"],
  walnut: ["#513619", "#2A1A0C", "#170D04"],
  brass: ["#7A5A12", "#E8C86A", "#6D5216"],
  body: ["#3D2A10", "#1A1206", "#0A0602"],
  fabric: ["#5A421C", "#3A2A10", "#241806"],
  metal: ["#4D3A16", "#241A0C", "#0F0A04"],
  cab: ["#3A2812", "#1F1408", "#100A03"],
  marble: ["#1D1308", "#120B05", "#0A0602"],
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
  vein: "rgba(122,90,18,0.09)",
  seam: "rgba(122,90,18,0.13)",
  can: ["#6B4D1C", "#3A2810", "#241806"],
  walnut: ["#7A5A28", "#4A3312", "#2A1C08"],
  brass: ["#8A6B1F", "#E8C86A", "#A8871F"],
  body: ["#54401E", "#2A1E0C", "#170F05"],
  fabric: ["#8A6A30", "#5F4718", "#3A2A10"],
  metal: ["#6D5216", "#3A2A10", "#1F1507"],
  cab: ["#5F451C", "#33240E", "#1F1507"],
  marble: ["#EEDCAB", "#E2CC8F", "#D2B878"],
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

/* One TALL floor monitor (the grown-up speaker): a shaded walnut
   tower standing on the floor at (x, baseY), w wide and 217 tall —
   dark baffle, gold dome tweeter, and TWIN woofers with brass
   rings and gold dust caps. Proper studio size: ~2.7x the height
   of the toy cabinets it replaces. */
function MonitorCab({
  p,
  x,
  baseY,
  w = 96,
}: {
  p: SetPalette;
  x: number;
  baseY: number;
  w?: number;
}) {
  const h = 217;
  const y = baseY - h;
  const cx = x + w / 2;
  const wr = n(w * 0.3);
  return (
    <g>
      {/* contact shadow pooled on the marble — kept tight to the
          cabinet: a wider bed pushed the right monitor's measured
          box 1px into the laptop copy column (rig-measured) */}
      <ellipse cx={cx} cy={baseY - 2} rx={n(w / 2 + 2)} ry="6" fill={p.shadow} />
      {/* cabinet */}
      <rect x={x} y={y} width={w} height={h} rx="8" fill="url(#sset-cab)" stroke={p.canStroke} strokeWidth="1" />
      <rect x={n(x + 3)} y={n(y + 3)} width={n(w - 6)} height="3" rx="1.5" fill="#ffffff" opacity="0.06" />
      <rect x={n(x + 1.5)} y={n(y + 1.5)} width={n(w - 3)} height={n(h - 3)} rx="7" fill="none" stroke={p.rim} strokeWidth="1" opacity="0.45" />
      {/* front baffle */}
      <rect x={n(x + 9)} y={n(y + 9)} width={n(w - 18)} height={n(h - 18)} rx="5" fill="#0D0803" />
      {/* tweeter — gold dome */}
      <circle cx={cx} cy={n(y + 31)} r="11" fill="url(#sset-cap)" stroke="#6D5216" strokeWidth="1" />
      <circle cx={cx} cy={n(y + 31)} r="15.5" fill="none" stroke={p.rim} strokeWidth="1" opacity="0.5" />
      {/* twin woofers — cone, brass ring, gold dust cap */}
      <circle cx={cx} cy={n(y + 88)} r={wr} fill="url(#sset-cone)" stroke="url(#sset-brass)" strokeWidth="3" />
      <circle cx={cx} cy={n(y + 88)} r={n(wr * 0.38)} fill="url(#sset-cap)" />
      <circle cx={cx} cy={n(y + 160)} r={wr} fill="url(#sset-cone)" stroke="url(#sset-brass)" strokeWidth="3" />
      <circle cx={cx} cy={n(y + 160)} r={n(wr * 0.38)} fill="url(#sset-cap)" />
      {/* power LED + corner screws */}
      <circle cx={n(x + w - 14)} cy={n(baseY - 15)} r="2.6" fill="#FFB02E" />
      <circle cx={n(x + 6)} cy={n(y + 6)} r="1.6" fill={p.rim} opacity="0.8" />
      <circle cx={n(x + w - 6)} cy={n(y + 6)} r="1.6" fill={p.rim} opacity="0.8" />
      <circle cx={n(x + 6)} cy={n(baseY - 6)} r="1.6" fill={p.rim} opacity="0.8" />
      <circle cx={n(x + w - 6)} cy={n(baseY - 6)} r="1.6" fill={p.rim} opacity="0.8" />
    </g>
  );
}

/* A bold floor cable in three passes — soft shadow, near-black body,
   thin gold top highlight. Option C runs them darker and thicker so
   they stay readable against the marble at phone size. */
function WirePath({ d, w }: { d: string; w: number }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="#000000" strokeOpacity="0.55" strokeWidth={w + 3} transform="translate(0 2)" />
      <path d={d} stroke="#0A0603" strokeWidth={w} />
      <path d={d} stroke="#D8B25C" strokeOpacity="0.38" strokeWidth="1.6" transform="translate(0 -2.4)" />
    </g>
  );
}

/* Dolly track sleepers across the camera's full travel. */
const SLEEPERS = [402, 447, 492, 537, 582];

/* Camera slide range (scene units) — bounded by the measured
   clearances: at +40 the right grip stays ~35px clear of the copy
   column (desktop), at -40 the lens stays clear of the left monitor. */
const CAM_SLIDE = 40;

export function StudioSetStrip({ isLight }: { isLight: boolean }) {
  const p = isLight ? LIGHT : DARK;
  const lightsRef = useRef<SVGGElement | null>(null);
  const camRef = useRef<SVGGElement | null>(null);

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

  /* Camera dolly slide — MOUSE-TRACKED (owner directive, 2026-10-14):
     the camera rides its rails left and right following the cursor,
     the same tracking family as the top rig's glide (window pointer →
     normalized −1…1, lerped rAF at the rig's own 0.08 ease). Bounded
     to ±CAM_SLIDE scene units so the camera's envelope clears the
     copy column, the King and the left monitor at BOTH extremes
     (preview-rig measured). Reduced-motion: no listener, no loop —
     the camera rests centered on its track. */
  useEffect(() => {
    const g = camRef.current;
    if (!g || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let target = 0;
    let cur = 0;
    let raf = 0;
    let cancelled = false;
    const onMove = (e: PointerEvent) => {
      target = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    const loop = () => {
      if (cancelled) return;
      cur += (target - cur) * 0.08;
      if (Math.abs(target - cur) < 0.001) cur = target;
      g.style.transform = `translateX(${(cur * CAM_SLIDE).toFixed(1)}px)`;
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
    <div
      aria-hidden="true"
      className="pointer-events-none relative z-[20] -mt-[550px] h-[580px] w-full sm:-mt-[628px] sm:h-[660px] sm:-translate-y-[16px]"
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
          {/* The marble stage floor — melts in from transparent at
              its back edge (no hard horizon line) and deepens toward
              the front edge where the set stands. */}
          <linearGradient id="sset-marble" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.marble[0]} stopOpacity="0" />
            <stop offset="24%" stopColor={p.marble[0]} stopOpacity="0.55" />
            <stop offset="55%" stopColor={p.marble[1]} stopOpacity="0.92" />
            <stop offset="100%" stopColor={p.marble[2]} stopOpacity="0.98" />
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
          <linearGradient id="sset-beam-key" gradientUnits="userSpaceOnUse" x1="240" y1="492" x2="240" y2="706">
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

        {/* ── THE MARBLE STAGE FLOOR — a real floor plane the set
            stands ON: marble body melting in at its back edge,
            veining, perspective seams, and the thin gold trim line
            SET INTO the floor near its front edge. ── */}
        <g data-piece="FLOOR">
          <polygon points="0,642 1440,642 1440,720 0,720" fill="url(#sset-marble)" />
          {/* marble veining — quiet wavy streaks across the plane */}
          <g fill="none" stroke={p.vein} strokeWidth="2">
            <path d="M60,664 C 340,652 560,672 820,660 C 1040,650 1240,668 1390,658" />
            <path d="M180,690 C 420,682 700,694 980,684 C 1140,678 1280,690 1400,686" />
            <path d="M420,706 C 640,700 900,710 1180,702" />
          </g>
          {/* perspective seams — two depth lines + converging joints */}
          <g stroke={p.seam} strokeWidth="1.5">
            <line x1="0" y1="668" x2="1440" y2="668" />
            <line x1="0" y1="694" x2="1440" y2="694" />
          </g>
          <g stroke={p.seam} strokeWidth="1.2">
            <line x1="180" y1="720" x2="430" y2="642" />
            <line x1="560" y1="720" x2="640" y2="642" />
            <line x1="880" y1="720" x2="800" y2="642" />
            <line x1="1260" y1="720" x2="1010" y2="642" />
          </g>
          {/* the gold trim line, set INTO the floor: a dark groove,
              the brass inlay itself, and a hair of light beneath it */}
          <line x1="0" y1="700" x2="1440" y2="700" stroke="#000000" strokeOpacity="0.30" strokeWidth="3" />
          <line x1="0" y1="702" x2="1440" y2="702" stroke="url(#sset-brass)" strokeWidth="2" opacity="0.9" />
          <line x1="0" y1="704.5" x2="1440" y2="704.5" stroke="#FFE9A8" strokeOpacity="0.22" strokeWidth="1" />
          {/* one soft bed of shadow the whole set stands on */}
          <ellipse cx="720" cy="713" rx="700" ry="8" fill={p.floorShadow} />
        </g>

        {/* ── LIGHT — every beam and glow, all feathered, all aimed
            FORWARD: cones widen from each lens toward the viewer and
            dissolve into a soft glow at the stage's front edge. ── */}
        <g data-piece="LIGHT-FX" ref={lightsRef} clipPath="url(#sset-light-guard)">
          {/* key lamp (left corner): lens glow, forward cone + core, front glow */}
          <ellipse cx="240" cy="492" rx="98" ry="62" fill="url(#sset-glow)" />
          <polygon points="210,502 270,502 364,700 116,700" fill="url(#sset-beam-key)" filter="url(#sset-blur9)" />
          <polygon points="224,502 256,502 318,700 162,700" fill="url(#sset-beam-key)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="240" cy="707" rx="175" ry="15" fill="url(#sset-pool)" />
          {/* fill lamp (right corner): lens glow, forward cone + core, front glow */}
          <ellipse cx="1395" cy="398" rx="74" ry="50" fill="url(#sset-glow)" />
          <polygon points="1372,408 1418,408 1446,700 1322,700" fill="url(#sset-beam-fill)" filter="url(#sset-blur9)" />
          <polygon points="1382,408 1408,408 1428,700 1352,700" fill="url(#sset-beam-fill)" filter="url(#sset-blur5)" opacity="0.55" />
          <ellipse cx="1395" cy="707" rx="125" ry="13" fill="url(#sset-pool)" />
          {/* a soft wash pooled under the camera's mark */}
          <ellipse cx="500" cy="709" rx="205" ry="12" fill="url(#sset-pool)" opacity="0.5" />
        </g>

        {/* ── KEY LAMP (left front corner) — front-facing spotlight ── */}
        <g data-piece="KEY-LAMP">
          <FrontLamp p={p} cx={240} lensY={492} s={1} floorY={717} />
        </g>

        {/* ── DOLLY TRACK — extended rails + sleepers spanning the
            camera's full travel; the track itself never moves. It
            starts just right of the left monitor (its first sleeper
            tucks behind the monitor's base) and runs under the
            chair's left edge. ── */}
        <g data-piece="TRACK">
          {SLEEPERS.map((x) => (
            <rect key={x} x={x} y="690" width="30" height="20" fill="#17100A" opacity="0.8" />
          ))}
          <rect x="400" y="691" width="220" height="5" rx="2.5" fill="url(#sset-brass)" />
          <rect x="400" y="703" width="220" height="5" rx="2.5" fill="url(#sset-brass)" opacity="0.75" />
        </g>

        {/* ── LEFT TALL MONITOR — just inside the key lamp ── */}
        <g data-piece="MONITOR-L">
          <MonitorCab p={p} x={310} baseY={717} />
        </g>

        {/* ── DIRECTOR'S CHAIR — right of the camera, the host's
            spot: walnut frame, shaded fabric back with a brass top
            rail and studs, padded seat, X legs. Dimensional, low. ── */}
        <g data-piece="CHAIR">
          <ellipse cx="631" cy="714" rx="56" ry="6" fill={p.shadow} />
          {/* back posts — the back rides tall (top 542) so the chair
              reads beside the camera instead of hiding behind it */}
          <rect x="584" y="542" width="9" height="155" fill="url(#sset-walnut)" />
          <rect x="669" y="542" width="9" height="155" fill="url(#sset-walnut)" />
          {/* backrest — fabric panel in a walnut frame, brass rail */}
          <rect x="578" y="542" width="106" height="52" rx="8" fill="url(#sset-walnut)" stroke={p.canStroke} strokeWidth="0.75" />
          <rect x="586" y="552" width="90" height="34" rx="6" fill="url(#sset-fabric)" />
          <rect x="586" y="552" width="90" height="8" rx="4" fill="#ffffff" opacity="0.05" />
          <rect x="578" y="542" width="106" height="10" rx="5" fill="url(#sset-brass)" opacity="0.9" />
          <circle cx="600" cy="547" r="1.8" fill="#2A1E07" opacity="0.55" />
          <circle cx="631" cy="547" r="1.8" fill="#2A1E07" opacity="0.55" />
          <circle cx="662" cy="547" r="1.8" fill="#2A1E07" opacity="0.55" />
          {/* armrests + supports */}
          <rect x="574" y="626" width="28" height="9" rx="4" fill="url(#sset-walnut)" />
          <rect x="660" y="626" width="28" height="9" rx="4" fill="url(#sset-walnut)" />
          <rect x="584" y="635" width="6" height="12" fill="url(#sset-walnut)" />
          <rect x="672" y="635" width="6" height="12" fill="url(#sset-walnut)" />
          {/* padded seat */}
          <polygon points="580,644 682,644 678,664 584,664" fill="url(#sset-fabric)" stroke={p.canStroke} strokeWidth="0.5" />
          <polygon points="580,644 682,644 681,652 581,652" fill="#ffffff" opacity="0.05" />
          {/* X legs + stretcher */}
          <polygon points="588,664 598,664 668,712 656,712" fill="url(#sset-walnut)" />
          <polygon points="674,664 664,664 594,712 606,712" fill="url(#sset-walnut)" />
          <rect x="592" y="688" width="78" height="6" fill="url(#sset-walnut)" opacity="0.85" />
        </g>

        {/* ── CINEMA CAMERA (center-left) on the dolly track, aiming
            FORWARD — and it RIDES the track, mouse-tracked: the
            sliding group carries the whole camera (deck, wheels,
            pedestal, body, lens) plus its floor shadow and the
            power lead that drags along the floor behind it. ── */}
        <g data-piece="CAMERA">
          <g ref={camRef} style={{ willChange: "transform" }}>
            {/* the camera's own ground shadow rides with it — kept
                close to the deck (rx 122): the old 185-wide bed made
                the sliding envelope reach the copy column at the
                right extreme (rig-measured) */}
            <ellipse cx="500" cy="713" rx="122" ry="7" fill={p.shadow} />
            {/* dolly deck + wheels on the rails */}
            <rect x="422" y="662" width="156" height="28" rx="6" fill="url(#sset-walnut)" stroke={p.canStroke} strokeWidth="0.75" />
            <circle cx="454" cy="693" r="10" fill="#0D0903" stroke={p.rim} strokeWidth="1.5" />
            <circle cx="454" cy="693" r="3" fill="url(#sset-cap)" />
            <circle cx="546" cy="693" r="10" fill="#0D0903" stroke={p.rim} strokeWidth="1.5" />
            <circle cx="546" cy="693" r="3" fill="url(#sset-cap)" />
            {/* pedestal column + collar */}
            <rect x="480" y="598" width="40" height="64" fill="url(#sset-body)" />
            <rect x="474" y="592" width="52" height="12" rx="3" fill="url(#sset-brass)" />
            {/* body — shaded charcoal-bronze, lighter toward the top */}
            <rect x="400" y="490" width="200" height="110" rx="14" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="1" />
            <polygon points="400,504 600,504 600,518 400,524" fill="#ffffff" opacity="0.05" />
            {/* side grips */}
            <rect x="380" y="516" width="20" height="50" rx="6" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="0.75" />
            <rect x="600" y="516" width="20" height="50" rx="6" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="0.75" />
            {/* top handle */}
            <rect x="470" y="468" width="8" height="22" fill="url(#sset-body)" />
            <rect x="522" y="468" width="8" height="22" fill="url(#sset-body)" />
            <rect x="466" y="460" width="68" height="10" rx="5" fill="url(#sset-body)" stroke={p.canStroke} strokeWidth="0.75" />
            {/* matte box — the front frame the lens looks through */}
            <rect x="432" y="482" width="136" height="134" rx="10" fill="#120B04" stroke={p.rim} strokeWidth="1" strokeOpacity="0.5" />
            <rect x="450" y="500" width="100" height="98" rx="6" fill="#050403" />
            {/* top flag */}
            <polygon points="432,482 568,482 580,462 420,462" fill="#17100A" stroke={p.canStroke} strokeWidth="0.5" />
            {/* the lens — gold focus rings around deep glass */}
            <circle cx="500" cy="549" r="38" fill="none" stroke="#8A6B1F" strokeWidth="2" />
            <circle cx="500" cy="549" r="34" fill="url(#sset-glass)" stroke={p.rim} strokeWidth="3" />
            <circle cx="488" cy="536" r="6" fill="#ffffff" opacity="0.55" />
            {/* tally light + gold brand plate */}
            <circle cx="578" cy="502" r="9" fill="#FFB02E" opacity="0.35" />
            <circle cx="578" cy="502" r="5" fill="#FFB02E" />
            <rect x="482" y="578" width="36" height="12" rx="2" fill="url(#sset-brass)" opacity="0.9" />
            {/* power lead — drops from the pedestal to the floor and
                drags with the dolly as it rides */}
            <WirePath d="M500,638 C 532,668 552,690 582,700" w={6} />
          </g>
        </g>

        {/* ── FILL LAMP (right front corner) — front-facing spotlight,
            standing in the right gutter so its head, pole and stand
            stay clear of the copy column at every size (the B round's
            proven placement) ── */}
        <g data-piece="FILL-LAMP">
          <FrontLamp p={p} cx={1395} lensY={398} s={0.72} floorY={717} />
        </g>

        {/* ── RIGHT TALL MONITOR — just inside the fill lamp, standing
            a step BACK on the floor (base 664): the copy column's
            airspace caps any front-row piece in its x-range at the
            share row's underside, so depth is what keeps it tall.
            Painted after the fill lamp, so the lamp's pole passes
            behind the cabinet — the lamp stands behind it, its head
            riding above the monitor's top. ── */}
        <g data-piece="MONITOR-R">
          <MonitorCab p={p} x={1356} baseY={664} w={82} />
        </g>

        {/* ── FLOOR WIRES — darker, thicker (Option C): a snake
            between lamps, monitors, camera and chair, a coil on the
            open floor right of the chair, a lead climbing to the
            right monitor's raised base, and a foreground run ── */}
        <g data-piece="WIRES">
          <WirePath
            d="M120,706 C 200,694 300,715 400,705 C 480,696 560,714 660,705 C 760,696 860,715 960,706 C 1060,697 1160,714 1260,705 C 1310,700 1340,712 1370,706"
            w={7}
          />
          {/* lead up to the right monitor's raised base */}
          <WirePath d="M1332,706 C 1352,692 1366,678 1380,668" w={6} />
          {/* coil on the open floor right of the chair */}
          <g fill="none" strokeLinecap="round">
            <ellipse cx="790" cy="703" rx="47" ry="10.5" stroke="#0A0603" strokeWidth="7.5" />
            <ellipse cx="790" cy="703" rx="34" ry="8" stroke="#0A0603" strokeWidth="6.5" />
            <ellipse cx="790" cy="703" rx="22" ry="5.5" stroke="#0A0603" strokeWidth="5.5" />
            <path d="M743,703 A47,10.5 0 0 1 837,703" stroke="#D8B25C" strokeOpacity="0.38" strokeWidth="1.6" />
          </g>
          {/* foreground run across the front of the stage */}
          <WirePath d="M40,716 C 300,708 560,718 820,711 C 1080,704 1260,717 1400,710" w={8} />
        </g>
      </svg>
    </div>
  );
}
