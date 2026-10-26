import { useEffect, useState } from "react";
import {
  MIC_BAND_ROTATE_MS,
  nextMicBandIndex,
  type MicBandPromo,
} from "@/lib/mic-band";

/* ─────────── Hero hanging-mic promo band (owner, 2026-10-25) ───────────
   A broadcast-style flag wrapped around the hanging microphone's head:
   it is rendered INSIDE the mic's pendulum (see HangingMic), so it
   rides the mic's own swing exactly — it has no motion of its own.
   The only thing that changes in place is the CONTENT, which rotates
   through the standing promotions served by GET /api/mic-band/promos
   (the launch, the current jackpot and the takeover offers — all
   from their live sources; no promo copy is written here).

   Themes: dark = black flag, gold ink (the mic's own finish);
   light = ivory flag, bronze ink — the hero badges' light treatment.
   On small screens the flag shifts left from the mic's center line:
   the phone mic hangs in the right-edge corridor, and a centered
   flag would run off the viewport's right edge. */

export function MicPromoBand({
  promos,
  isLight,
}: {
  promos: MicBandPromo[];
  isLight: boolean;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (promos.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => nextMicBandIndex(i, promos.length)),
      MIC_BAND_ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, [promos]);

  const promo = promos[index % Math.max(1, promos.length)];
  if (!promo) return null;

  return (
    <div
      data-mic="promo-band"
      data-promo-id={promo.id}
      role="note"
      aria-label={`${promo.kicker}: ${promo.headline}. ${promo.detail}`}
      className={`absolute left-1/2 top-[46%] z-10 w-[118px] -translate-x-[64%] rounded-md border px-2 py-1.5 text-center shadow-[0_6px_18px_rgba(0,0,0,0.45)] sm:-translate-x-1/2 lg:w-[148px] lg:px-2.5 lg:py-2 ${
        isLight
          ? "border-[#C9A84C] bg-[#FBF6E9]/95 shadow-[0_6px_18px_rgba(122,90,18,0.35)]"
          : "border-[#C9A84C]/80 bg-[#0D0701]/95"
      }`}
    >
      <style>{`
        @keyframes mic-band-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .mic-band-anim { animation: none !important; } }
      `}</style>
      {/* Wrap tabs — the gold straps that visually tie the flag
          around the grille on both sides. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[3px] rounded-l-md ${isLight ? "bg-[#C9A84C]" : "bg-[#C9A84C]/90"}`}
      />
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 right-0 w-[3px] rounded-r-md ${isLight ? "bg-[#C9A84C]" : "bg-[#C9A84C]/90"}`}
      />
      <div key={promo.id} className="mic-band-anim" style={{ animation: "mic-band-in 0.45s ease-out" }}>
        <p
          className={`text-[7.5px] font-bold uppercase tracking-[0.22em] lg:text-[8.5px] ${
            isLight ? "text-[#7A5A12]" : "text-[#C9A84C]"
          }`}
        >
          {promo.kicker}
        </p>
        <p
          className={`mt-0.5 text-[12px] font-black leading-tight lg:text-[14px] ${
            isLight ? "text-[#2A1E07]" : "text-[#F5DE8E]"
          }`}
        >
          {promo.headline}
        </p>
        <p
          className={`mt-0.5 text-[8.5px] font-medium leading-tight lg:text-[9.5px] ${
            isLight ? "text-[#6B5B36]" : "text-white/60"
          }`}
        >
          {promo.detail}
        </p>
      </div>
      {promos.length > 1 && (
        <div aria-hidden="true" className="mt-1 flex items-center justify-center gap-1">
          {promos.map((p, i) => (
            <span
              key={p.id}
              className={`h-1 w-1 rounded-full ${
                i === index % promos.length
                  ? isLight
                    ? "bg-[#7A5A12]"
                    : "bg-[#E8C86A]"
                  : isLight
                    ? "bg-[#C9A84C]/40"
                    : "bg-white/25"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
