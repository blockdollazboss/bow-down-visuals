import { Sparkles, SlidersHorizontal } from "lucide-react";
import type { EditorSettings, MusicStudioSettings } from "@/lib/editor-settings";
import { AiAutoMix } from "@/components/editor/music/AiAutoMix";
import { ManualDAW } from "@/components/editor/music/ManualDAW";
import { useMixPreview } from "@/components/editor/music/useMixPreview";

interface MusicStudioProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  artistName?: string;
  songTitle?: string;
}

const MODES: { id: MusicStudioSettings["mode"]; label: string; note: string; icon: typeof Sparkles }[] = [
  { id: "auto", label: "AI Auto Mix", note: "Pick a sound, get a pro mix plan", icon: Sparkles },
  { id: "manual", label: "Manual DAW", note: "Upload stems, mix & export it yourself", icon: SlidersHorizontal },
];

export function MusicStudio({ settings, onChange, artistName, songTitle }: MusicStudioProps) {
  const ms = settings.musicStudio;
  const preview = useMixPreview(ms.stems, ms.master);

  function setMode(mode: MusicStudioSettings["mode"]) {
    onChange({ ...settings, musicStudio: { ...ms, mode } });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = ms.mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              data-testid={`music-mode-${m.id}`}
              className={`flex items-center gap-3 text-left rounded-xl border p-4 transition-all ${
                active
                  ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_24px_rgba(234,179,8,0.08)]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary/15 text-primary" : "bg-white/[0.04] text-white/40"}`}>
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-black ${active ? "text-white" : "text-white/70"}`}>{m.label}</p>
                <p className="text-[11px] text-white/40">{m.note}</p>
              </div>
            </button>
          );
        })}
      </div>

      {ms.mode === "auto" ? (
        <AiAutoMix settings={settings} onChange={onChange} artistName={artistName} songTitle={songTitle} />
      ) : (
        <ManualDAW settings={settings} onChange={onChange} preview={preview} />
      )}
    </div>
  );
}
