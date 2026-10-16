import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  isGameSoundMuted,
  setGameSoundMuted,
  subscribeGameSoundMuted,
} from "@/lib/game-sound";

/* ─── The games' mute control ─────────────────────────────────────────────
   One button, every game: the synth in lib/game-sound.ts is shared by
   the Arcade and the Party Games, and so is its mute. House pattern —
   sound is on by default, the off switch is always one tap away and
   the choice persists on the device. */

export default function GameSoundToggle({
  light,
  className = "",
}: {
  light: boolean;
  className?: string;
}) {
  const muted = useSyncExternalStore(
    subscribeGameSoundMuted,
    isGameSoundMuted,
    () => false,
  );
  return (
    <button
      type="button"
      onClick={() => setGameSoundMuted(!muted)}
      aria-pressed={muted}
      title={muted ? "Turn game sound on" : "Mute game sound"}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${
        light
          ? "bg-[#7A5A12]/10 text-[#7A5A12] hover:bg-[#7A5A12]/20"
          : "bg-white/[0.06] text-white/85 hover:bg-white/[0.12]"
      } ${className}`}
      data-testid="game-sound-toggle"
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      {muted ? "Sound off" : "Sound on"}
    </button>
  );
}
