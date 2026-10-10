import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/* ─── Shared loader timing — every loading screen matches ──
   The barcode is the single source of truth: it drives the progress,
   the headline/promo slides, and the dismissal. */

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
  { title: "Spotlight Takeover — $2,500", desc: "Your brand over the drone video for 7 days. Prime placement." },
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

export default function WittyLoader({ message, onComplete }: { message?: string; onComplete?: () => void }) {
  const { t } = useTranslation();

  // Barcode is the single source of truth — progress drives everything.
  // Slide changes at the halfway mark, so each headline/promo gets ~half the fill.
  const [progress, setProgress] = useState(0);
  const completedRef = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) return 0;
        const next = p + Math.random() * 8 + 2;
        if (next >= 100 && !completedRef.current) {
          completedRef.current = true;
          onComplete?.();
        }
        return next;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [onComplete]);

  const lines = (t("delight.loaderLines", { returnObjects: true, defaultValue: FALLBACK_LINES }) as unknown as string[]) || FALLBACK_LINES;
  const safe = Array.isArray(lines) && lines.length > 0 ? lines : FALLBACK_LINES;
  // Slide flips at the halfway mark of the barcode fill
  const slideIdx = progress >= 50 ? 1 : 0;
  const line = message ?? safe[slideIdx % safe.length] ?? FALLBACK_LINES[0]!;
  const promo = FEATURE_PROMOS[slideIdx % FEATURE_PROMOS.length]!;

  return (
    <div className="fixed inset-0 z-[20000] bg-background overflow-hidden dark-lock" data-dark-lock>
      {/* Throne room backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/media-generation-loading-bg-referral-v5-0-3fc90681-441f-4765-be51-9110960be106.webp)" }}
      />
      {/* Cinematic right gradient — the poster reads right side */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "linear-gradient(260deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0.15) 65%, rgba(0,0,0,0.35) 100%)" }}
      />
      {/* Vignette — theater darkness at the edges */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)" }}
      />

      {/* Bottom-center: brand eyebrow */}
      <p className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-primary/90 text-[11px] font-bold uppercase tracking-[0.35em] whitespace-nowrap">
        Bow Down Visuals presents
      </p>

      {/* Top-left: now featuring */}
      <div
        key={slideIdx}
        className="absolute top-6 left-6 md:left-14 z-10 max-w-[280px] animate-in fade-in slide-in-from-left duration-700"
      >
          <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.3em]">Now featuring</p>
          <div className="mt-2 border border-primary/25 rounded-xl bg-black/40 backdrop-blur-sm p-5">
            <p className="text-primary font-black text-lg uppercase tracking-wider">{promo.title}</p>
            <p className="text-white/65 text-[13px] mt-2 leading-relaxed">{promo.desc}</p>
          </div>
      </div>

      {/* ── TOP-RIGHT: the title treatment ── */}
      <div className="absolute top-8 right-6 md:right-14 z-10 max-w-md text-right">
        {/* The headline — gold luxury */}
        <h1
          key={slideIdx}
          className="text-transparent bg-clip-text bg-gradient-to-b from-[#f5e6b8] via-[#d4af37] to-[#8a6d1f] text-3xl md:text-4xl font-black leading-[1.05] mt-3 animate-in fade-in slide-in-from-right duration-700 drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: "0.02em" }}
        >
          {line}
        </h1>
        <p className="text-white/50 text-sm mt-3">
          {t("delight.loaderSub", { defaultValue: "Thy Cheat Code is getting your world ready" })}
        </p>
      </div>

      {/* ── BOTTOM-LEFT: the crowned mark ── */}
      <div className="absolute bottom-8 left-6 md:left-14 z-10">
        <CrownedLogo />
      </div>

      {/* ── BOTTOM-RIGHT: ticket-stub barcode ── */}
      <div className="absolute bottom-8 right-6 md:right-10 z-10">
        <BarcodeStrip progress={progress} />
      </div>

    </div>
  );
}

/* CrownedLogo — bare Shark King mark, no box. Levitates with a breathing
   gold aura and orbiting light ring. The aura brightens and the mark swells
   subtly as your cursor approaches — alive, not gimmicky. */
function CrownedLogo() {
  const [proximity, setProximity] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = wrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy);
        const maxDist = Math.max(window.innerWidth, window.innerHeight) * 0.4;
        setProximity(Math.max(0, 1 - dist / maxDist));
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative w-fit">
      <div
        className="relative animate-[float_4s_ease-in-out_infinite] transition-transform duration-300 ease-out"
        style={{ transform: `scale(${1 + proximity * 0.1})` }}
      >
        {/* Breathing aura — brightens with cursor proximity */}
        <div
          aria-hidden
          className="absolute inset-0 -m-8 rounded-full blur-2xl animate-[breathe_3s_ease-in-out_infinite] transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle, rgba(212,175,55,${0.08 + proximity * 0.15}) 0%, transparent 70%)`,
          }}
        />
        {/* Orbiting light ring */}
        <div aria-hidden className="absolute inset-0 -m-4 animate-[spin_12s_linear_infinite]">
          <div className="absolute inset-0 rounded-full border border-transparent border-t-primary/70 border-r-primary/30" />
        </div>
        {/* Bare mark — no box, no container */}
        <img
          src="/logo-static.webp"
          alt="Bow Down Visuals"
          className="relative h-28 w-28 object-contain"
          style={{ filter: `drop-shadow(0 0 ${8 + proximity * 12}px rgba(212,175,55,${0.25 + proximity * 0.25}))` }}
        />
      </div>
      <style>{`
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes breathe { 0%, 100% { opacity: 0.5; transform: scale(0.95); } 50% { opacity: 1; transform: scale(1.08); } }
      `}</style>
    </div>
  );
}

/* BarcodeStrip — a real UPC-A barcode label in the Bow Down theme.
   Black sticker, gold bars, 12 typewriter digits below that count
   from 000000000000 to 999999999999 with progress. */
function BarcodeStrip({ progress }: { progress: number }) {

  // UPC-A: 12 digits, guard | 6 left | middle guard | 6 right | guard
  const MODULE = 2;
  const bars: number[] = [
    1, 1, 1,
    3, 1, 2, 1, 1, 4, 2, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2, 1,
    1, 1, 1, 1, 1,
    2, 4, 1, 2, 3, 1, 4, 1, 2, 1, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1,
    1, 1, 1,
  ];
  const totalModules = bars.reduce((a, b) => a + b, 0);
  let filled = 0;
  // 12-digit counter scaled by progress
  const counter = Math.floor((Math.min(100, progress) / 100) * 999999999999);
  const digits = String(counter).padStart(12, "0");

  return (
    <div
      className="bg-black border border-primary/40 rounded-md px-4 pt-3 pb-2 shadow-[0_4px_24px_rgba(0,0,0,0.5),0_0_20px_rgba(212,175,55,0.15)]"
      style={{ transform: "rotate(-1.5deg)" }}
    >
      {/* Quiet zone + gold bars */}
      <div className="flex items-stretch" style={{ height: "48px" }}>
        {bars.map((w, i) => {
          const barStart = (filled / totalModules) * 100;
          filled += w;
          const barEnd = (filled / totalModules) * 100;
          const isLit = progress >= barEnd;
          const isBar = i % 2 === 0;
          return (
            <div
              key={i}
              className="transition-colors duration-200"
              style={{
                width: `${w * MODULE}px`,
                height: "100%",
                backgroundColor: !isBar ? "transparent" : isLit ? "#d4af37" : "#2a2a2a",
                boxShadow: isBar && isLit ? "0 0 4px rgba(212,175,55,0.5)" : "none",
              }}
            />
          );
        })}
      </div>
      {/* 12 typewriter digits */}
      <p
        className="text-center text-primary font-mono font-bold mt-1"
        style={{ fontSize: "13px", letterSpacing: "0.18em" }}
      >
        {digits.slice(0, 6)} {digits.slice(6)}
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
