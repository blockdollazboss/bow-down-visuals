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
      {/* Shark King logo — levitating hero with pulsing aura + shine sweep */}
      <CrownedLogo />
      {/* ── Premium asymmetric layout ── */}
      {/* Center-top: the show title, under the logo */}
      <div className="absolute top-40 md:top-44 left-1/2 -translate-x-1/2 z-10 text-center max-w-lg px-6">
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

      {/* Bottom-left: promo card */}
      <div
        key={promoIdx}
        className="absolute bottom-8 left-6 md:left-10 z-10 max-w-xs animate-in fade-in duration-500"
      >
        <div className="border-l-2 border-primary/60 pl-5">
          <p className="text-primary font-black text-xl uppercase tracking-[0.2em]">{promo.title}</p>
          <p className="text-white/70 text-sm mt-3 leading-relaxed">{promo.desc}</p>
        </div>
      </div>

      {/* Bottom-right: true-scale barcode */}
      <div className="absolute bottom-8 right-6 md:right-10 z-10">
        <BarcodeStrip />
      </div>
    </div>
  );
}

/* CrownedLogo — the Shark King levitates with a breathing gold aura,
   a slow-orbiting light ring, and a periodic shine sweep. No mouse needed. */
function CrownedLogo() {
  return (
    <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10">
      <div className="relative animate-[float_4s_ease-in-out_infinite]">
        {/* Breathing aura */}
        <div
          aria-hidden
          className="absolute inset-0 -m-6 rounded-full bg-primary/20 blur-2xl animate-[breathe_3s_ease-in-out_infinite]"
        />
        {/* Orbiting light ring */}
        <div aria-hidden className="absolute inset-0 -m-3 animate-[spin_12s_linear_infinite]">
          <div className="absolute inset-0 rounded-full border border-transparent border-t-primary/70 border-r-primary/30" />
        </div>
        {/* The mark, double size */}
        <div className="relative overflow-hidden rounded-3xl">
          <img
            src="/logo-static.webp"
            alt="Bow Down Visuals"
            className="h-28 w-28 object-contain drop-shadow-[0_0_30px_rgba(212,175,55,0.5)]"
          />
          {/* Shine sweep */}
          <div
            aria-hidden
            className="absolute inset-0 animate-[shine_5s_ease-in-out_infinite]"
            style={{
              background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.35) 50%, transparent 60%)",
              backgroundSize: "250% 100%",
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes breathe { 0%, 100% { opacity: 0.5; transform: scale(0.95); } 50% { opacity: 1; transform: scale(1.08); } }
        @keyframes shine { 0% { background-position: 120% 0; } 60%, 100% { background-position: -120% 0; } }
      `}</style>
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
