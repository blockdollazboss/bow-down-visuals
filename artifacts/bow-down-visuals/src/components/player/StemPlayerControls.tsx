import { Layers } from "lucide-react";
import { useStreamingPlayerOptional } from "@/contexts/StreamingPlayerContext";
import { stemGain } from "@/lib/stems-player";

/* ─── N14 Stems Player controls ───
   Docked into the existing player surfaces (global player bar +
   the /track/:id page). Renders ONLY when the currently playing
   track actually carries stems — a stemless song gets NO controls
   here at all (honest absence, never greyed-out dead buttons), and
   a partial stem set shows exactly those stems.

   Playback only: these buttons flip mute/solo, which the player
   applies as per-stem gains. There is no download, export, or
   save affordance for stem audio anywhere in this component. */

export function StemPlayerControls({ compact = false }: { compact?: boolean }) {
  const player = useStreamingPlayerOptional();
  if (!player || !player.stems || player.stems.length === 0) return null;
  const { stems, stemMix } = player;

  return (
    <div
      data-testid="stem-player-controls"
      className="rounded-xl border border-[#e8c86a]/25 bg-white/5 px-3 py-2.5"
      aria-label="Stem controls"
    >
      <div className="flex items-center gap-2 mb-2">
        <Layers className="h-3.5 w-3.5 text-[#e8c86a]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#e8c86a]">
          Stems — play with the mix
        </span>
        <span className="text-[10px] text-white/35">Playback only</span>
      </div>
      <div className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2"}`}>
        {stems.map((stem) => {
          const mix = stemMix[stem.key] ?? { muted: false, solo: false };
          const audible = stemGain(stem.key, stemMix) > 0;
          return (
            <div
              key={stem.key}
              data-testid={`stem-row-${stem.key}`}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 ${
                audible ? "border-[#e8c86a]/40" : "border-white/10 opacity-60"
              }`}
            >
              <span className={`text-xs font-semibold ${audible ? "text-white/90" : "text-white/50"}`}>
                {stem.label}
              </span>
              <button
                type="button"
                onClick={() => player.toggleStemMute(stem.key)}
                aria-pressed={mix.muted}
                aria-label={`${mix.muted ? "Unmute" : "Mute"} ${stem.label}`}
                data-testid={`stem-mute-${stem.key}`}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  mix.muted
                    ? "bg-red-500/80 text-white"
                    : "bg-white/10 text-white/60 hover:text-[#e8c86a]"
                }`}
              >
                Mute
              </button>
              <button
                type="button"
                onClick={() => player.toggleStemSolo(stem.key)}
                aria-pressed={mix.solo}
                aria-label={`Solo ${stem.label}`}
                data-testid={`stem-solo-${stem.key}`}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  mix.solo
                    ? "bg-[#e8c86a] text-black"
                    : "bg-white/10 text-white/60 hover:text-[#e8c86a]"
                }`}
              >
                Solo
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
