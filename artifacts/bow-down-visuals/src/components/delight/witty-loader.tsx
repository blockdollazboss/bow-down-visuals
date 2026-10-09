import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crown } from "lucide-react";

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* ambient gold glow — the throne room is never dark */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-primary/[0.07] blur-[130px] pointer-events-none"
      />
      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        {/* crown mark */}
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center shadow-[0_0_40px_rgba(212,175,55,0.25)]">
            <Crown className="h-8 w-8 text-primary" aria-hidden />
          </div>
          <div className="absolute inset-0 rounded-2xl border border-primary/40 animate-ping opacity-20" aria-hidden />
        </div>
        <p
          key={line}
          className="text-white/80 text-base font-semibold animate-in fade-in duration-500 max-w-xs"
        >
          {line}
        </p>
        <p className="text-white/30 text-xs">
          {t("delight.loaderSub", { defaultValue: "Thy Cheat Code is getting your world ready" })}
        </p>
      </div>
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
