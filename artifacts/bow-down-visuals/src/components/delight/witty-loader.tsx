import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/* ─── WittyLoader — the loading screen is a first impression, not a spinner ──
   Rotating mascot-voiced status lines in Thy Cheat Code's voice: royal,
   playful, confident. Used on every protected page load (ProtectedRoute)
   and anywhere a wait should feel like part of the show. */

const FALLBACK_LINES = [
  "Waking up Thy Cheat Code…",
  "Polishing the crown…",
  "Sharpening the shark teeth…",
  "Rolling out the gold carpet…",
  "Summoning your creative vault…",
  "Tuning the cheat codes…",
  "Lighting the throne room…",
];

/* Rotating feature highlight promos - shown below the status line */
const FEATURE_PROMOS = [
  { title: "Refer & Earn", desc: "Invite creators, earn 25% of their credit purchases for 90 days." },
  { title: "AI Music Videos", desc: "Turn your songs into cinematic music videos in minutes." },
  { title: "Viral Thumbnails", desc: "Scroll-stopping thumbnails with AI A/B testing." },
  { title: "Thy Hook Vault", desc: "Hooks engineered to stop the scroll." },
  { title: "4K Masterpiece Exports", desc: "Crystal-clear 4K quality on every export." },
];

export function useWittyLine(intervalMs = 2200): string {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const lines = (t("delight.loaderLines", { returnObjects: true, defaultValue: FALLBACK_LINES }) as unknown as string[]) || FALLBACK_LINES;
  const safe = Array.isArray(lines) && lines.length > 0 ? lines : FALLBACK_LINES;

  useEffect(() => {
    if (safe.length <= 1) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % safe.length), intervalMs);
    return () => window.clearInterval(id);
  }, [safe.length, intervalMs]);

  return safe[idx % safe.length] ?? FALLBACK_LINES[0]!;
}

export default function WittyLoader({ message }: { message?: string }) {
  const witty = useWittyLine();
  const { t } = useTranslation();
  const line = message ?? witty;

  const [promoIdx, setPromoIdx] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setPromoIdx((i) => (i + 1) % FEATURE_PROMOS.length), 4000);
    return () => window.clearInterval(id);
  }, []);
  const promo = FEATURE_PROMOS[promoIdx % FEATURE_PROMOS.length]!;

  return (
    <div className="fixed inset-0 z-[20000] bg-background overflow-hidden">
      {/* Single promo background - Shark King with Visual Bucs */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/media-generation-loading-bg-referral-v5-0-3fc90681-441f-4765-be51-9110960be106.webp)" }}
      />
      {/* One uniform dark veil - no banding, no double-background */}
      <div aria-hidden className="absolute inset-0 bg-black/55" />
      {/* Shark King logo — magnetic 3D, tracks your cursor */}
      <MagneticLogo />
      {/* ── Cinematic asymmetric layout ── */}
      {/* Bottom-left: the show title */}
      <div className="absolute bottom-28 left-6 md:left-10 z-10 max-w-sm">
        <p
          key={line}
          className="text-white text-xl md:text-2xl font-bold leading-snug animate-in fade-in duration-500 drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]"
        >
          {line}
        </p>
        <p className="text-white/50 text-xs mt-1">
          {t("delight.loaderSub", { defaultValue: "Thy Cheat Code is getting your world ready" })}
        </p>
      </div>

      {/* Right edge: vertical promo card */}
      <div
        key={promoIdx}
        className="absolute right-6 md:right-10 top-1/2 -translate-y-1/2 z-10 hidden sm:block max-w-xs animate-in fade-in duration-500"
      >
        <div className="border-l-2 border-primary/60 pl-5">
          <p className="text-primary font-black text-xl uppercase tracking-[0.2em]">{promo.title}</p>
          <p className="text-white/70 text-sm mt-3 leading-relaxed">{promo.desc}</p>
        </div>
      </div>

      {/* Bottom center: true-scale barcode */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <BarcodeStrip />
      </div>
    </div>
  );
}

/* MagneticLogo — the Shark King watches your cursor.
   3D tilt toward the mouse + glow intensifies on approach. */
function MagneticLogo() {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, glow: 0.35 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const maxDist = Math.max(window.innerWidth, window.innerHeight) / 2;
        const proximity = Math.max(0, 1 - dist / maxDist);
        // Tilt toward cursor, capped at ±18deg
        const tiltY = Math.max(-18, Math.min(18, (dx / window.innerWidth) * 36));
        const tiltX = Math.max(-18, Math.min(18, -(dy / window.innerHeight) * 36));
        setTilt({ x: tiltX, y: tiltY, glow: 0.35 + proximity * 0.65 });
      });
    };
    const onLeave = () => setTilt({ x: 0, y: 0, glow: 0.35 });
    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="absolute top-6 left-6 z-10" style={{ perspective: "600px" }}>
      <div
        ref={ref}
        className="transition-transform duration-150 ease-out will-change-transform"
        style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${1 + (tilt.glow - 0.35) * 0.25})` }}
      >
        <img
          src="/logo-static.webp"
          alt="Bow Down Visuals"
          className="h-14 w-14 object-contain"
          style={{ filter: `drop-shadow(0 0 ${12 + tilt.glow * 24}px rgba(212,175,55,${tilt.glow}))` }}
        />
      </div>
    </div>
  );
}

/* BarcodeStrip — true-scale scannable-style barcode, fixed proportions.
   Real barcode anatomy: quiet zones, guard bars, 1:2:3:4 width ratios. */
function BarcodeStrip() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) return 0;
        return p + Math.random() * 8 + 2;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // UPC-style pattern: guard | data | middle guard | data | guard
  // Widths in module units (1 = thinnest bar), true 1:2:3:4 ratios
  const MODULE = 2; // px per module — true print scale
  const bars: number[] = [
    1, 1, 1, // left guard (bar-space-bar)
    3, 1, 2, 1, 1, 4, 2, 1, 3, 2, 1, 4, // left data
    1, 1, 1, 1, 1, // center guard (space-bar-space-bar-space)
    2, 4, 1, 2, 3, 1, 4, 1, 2, 1, 3, 1, // right data
    1, 1, 1, // right guard
  ];
  const totalModules = bars.reduce((a, b) => a + b, 0);
  let filled = 0;

  return (
    <div className="flex flex-col items-center">
      {/* Quiet zone + barcode */}
      <div className="bg-white/[0.03] rounded-sm px-5 py-3">
        <div className="flex items-stretch" style={{ height: "56px" }}>
          {bars.map((w, i) => {
            const barStart = (filled / totalModules) * 100;
            filled += w;
            const barEnd = (filled / totalModules) * 100;
            const isLit = progress >= barEnd;
            const isPartial = progress > barStart && progress < barEnd;
            // Alternate bar/space: even indices are bars, odd are spaces
            const isBar = i % 2 === 0;
            return (
              <div
                key={i}
                className="transition-colors duration-200"
                style={{
                  width: `${w * MODULE}px`,
                  height: "100%",
                  backgroundColor: !isBar
                    ? "transparent"
                    : isLit
                      ? "#d4af37"
                      : isPartial
                        ? "rgba(212,175,55,0.45)"
                        : "rgba(255,255,255,0.14)",
                  boxShadow: isBar && isLit ? "0 0 6px rgba(212,175,55,0.55)" : "none",
                }}
              />
            );
          })}
        </div>
      </div>
      <p className="text-white/40 text-[11px] font-mono mt-2 tracking-widest">
        {Math.min(100, Math.floor(progress))}%
      </p>
    </div>
  );
}

/* Legacy centered barcode loader — kept for inline use elsewhere */
function BarcodeLoader() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) return 0;
        return p + Math.random() * 8 + 2;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // Deterministic pseudo-random bar widths for a barcode look
  const bars = [3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 3, 1, 2, 4, 1, 2, 3, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 2, 4];
  const totalWidth = bars.reduce((a, b) => a + b, 0) + bars.length * 2;
  let filled = 0;

  return (
    <div className="mt-6 w-64">
      <div className="flex items-end gap-[2px] h-10 justify-center">
        {bars.map((w, i) => {
          const barStart = (filled / totalWidth) * 100;
          filled += w + 2;
          const barEnd = (filled / totalWidth) * 100;
          const isLit = progress >= barEnd;
          const isPartial = progress > barStart && progress < barEnd;
          return (
            <div
              key={i}
              className="transition-colors duration-200"
              style={{
                width: `${w * 2}px`,
                height: "100%",
                backgroundColor: isLit
                  ? "#d4af37"
                  : isPartial
                    ? "rgba(212,175,55,0.5)"
                    : "rgba(255,255,255,0.12)",
                boxShadow: isLit ? "0 0 8px rgba(212,175,55,0.6)" : "none",
              }}
            />
          );
        })}
      </div>
      <p className="text-white/40 text-xs mt-2 font-mono">{Math.min(100, Math.floor(progress))}%</p>
    </div>
  );
}

/* ─── useGeneratingLine — witty status for AI generation waits ─────────────
   Video/song/image generation takes 30s–40min. The wait should feel like
   part of the show, not a dead spinner. */

const FALLBACK_GENERATING = [
  "Thy Cheat Code is cooking…",
  "The sharks are rendering frames…",
  "Sprinkling gold dust on pixels…",
  "Teaching AI your vibe…",
  "This is the part where magic happens…",
  "Almost worthy of the crown…",
];

export function useGeneratingLine(intervalMs = 3000): string {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const lines = (t("delight.generatingLines", { returnObjects: true, defaultValue: FALLBACK_GENERATING }) as unknown as string[]) || FALLBACK_GENERATING;
  const safe = Array.isArray(lines) && lines.length > 0 ? lines : FALLBACK_GENERATING;

  useEffect(() => {
    if (safe.length <= 1) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % safe.length), intervalMs);
    return () => window.clearInterval(id);
  }, [safe.length, intervalMs]);

  return safe[idx % safe.length] ?? FALLBACK_GENERATING[0]!;
}

/* ─── GeneratingStatus — inline witty status under a generate button ─────── */
export function GeneratingStatus() {
  const line = useGeneratingLine();
  return (
    <p key={line} className="text-center text-sm text-primary/90 font-semibold animate-in fade-in duration-500 pt-1">
      {line}
    </p>
  );
}
