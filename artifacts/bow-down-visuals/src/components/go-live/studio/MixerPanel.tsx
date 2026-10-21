/**
 * MixerPanel — the parity studio's audio mixer UI: a fader + live meter
 * + mute per channel (mic through the voice chain, screen-share audio
 * when the browser grants it) and the master bus. What's mixed here is
 * exactly what the published stream and the recordings carry.
 */
import type { ReactNode } from "react";
import { Mic, MonitorUp, Volume2, VolumeX } from "lucide-react";
import type { AudioMixer } from "@/lib/stream-kit/audio-mixer";
import LevelMeter from "./LevelMeter";

function ChannelRow({
  name,
  icon,
  mixer,
  channelId,
  isLight,
  onChange,
  note,
}: {
  name: string;
  icon: ReactNode;
  mixer: AudioMixer | null;
  channelId: string;
  isLight: boolean;
  onChange: () => void;
  note?: string;
}) {
  const label = isLight ? "text-[#6B5B36]" : "text-zinc-400";
  const state = mixer?.getInputState(channelId) ?? null;
  const disabled = !mixer || !state;
  return (
    <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="flex items-center gap-2">
        <span className="text-[#C9A84C]">{icon}</span>
        <span className={`flex-1 truncate text-sm font-medium ${isLight ? "text-[#2A1E07]" : "text-zinc-100"}`}>{name}</span>
        <LevelMeter getAnalyser={() => mixer?.getAnalyser(channelId) ?? null} />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!mixer || !state) return;
            mixer.setMuted(channelId, !state.muted);
            onChange();
          }}
          title={state?.muted ? "Unmute" : "Mute"}
          className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C] disabled:opacity-30"
        >
          {state?.muted ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round((state?.volume ?? 1) * 100)}
        disabled={disabled}
        onChange={(e) => {
          mixer?.setVolume(channelId, Number(e.target.value) / 100);
          onChange();
        }}
        className="mt-1.5 w-full accent-[#C9A84C] disabled:opacity-40"
        aria-label={`${name} volume`}
      />
      {note && <p className={`mt-1 text-[11px] leading-snug ${label}`}>{note}</p>}
    </div>
  );
}

export default function MixerPanel({
  mixer,
  isLight,
  onChange,
  screenSharing,
  screenHasAudio,
}: {
  mixer: AudioMixer | null;
  isLight: boolean;
  onChange: () => void;
  screenSharing: boolean;
  screenHasAudio: boolean;
}) {
  const label = isLight ? "text-[#6B5B36]" : "text-zinc-400";
  const master = mixer?.masterState ?? null;
  return (
    <div>
      <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${label}`}>Audio mixer</p>
      <div className="space-y-2">
        <ChannelRow
          name="Microphone"
          icon={<Mic className="h-4 w-4" />}
          mixer={mixer}
          channelId="mic"
          isLight={isLight}
          onChange={onChange}
          note={!mixer ? "Start the camera to bring the mic into the mix. Noise cancellation and voice effects ride this channel." : undefined}
        />
        <ChannelRow
          name="Screen audio"
          icon={<MonitorUp className="h-4 w-4" />}
          mixer={mixer}
          channelId="screen"
          isLight={isLight}
          onChange={onChange}
          note={
            !screenSharing
              ? "Joins when you share a screen or window with sound."
              : screenHasAudio
                ? undefined
                : "This share came without audio — the browser only grants it for tab/window shares with sound on."
          }
        />
        <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-[#C9A84C]/10" : "border-[#C9A84C]/25 bg-[#C9A84C]/5"}`}>
          <div className="flex items-center gap-2">
            <span className={`flex-1 text-sm font-semibold ${isLight ? "text-[#2A1E07]" : "text-zinc-100"}`}>Master</span>
            <LevelMeter getAnalyser={() => mixer?.getAnalyser("master") ?? null} width={96} />
            <button
              type="button"
              disabled={!mixer}
              onClick={() => {
                if (!mixer || !master) return;
                mixer.setMasterMuted(!master.muted);
                onChange();
              }}
              title={master?.muted ? "Unmute master" : "Mute everything"}
              className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C] disabled:opacity-30"
            >
              {master?.muted ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((master?.volume ?? 1) * 100)}
            disabled={!mixer}
            onChange={(e) => {
              mixer?.setMasterVolume(Number(e.target.value) / 100);
              onChange();
            }}
            className="mt-1.5 w-full accent-[#C9A84C] disabled:opacity-40"
            aria-label="Master volume"
          />
        </div>
      </div>
    </div>
  );
}
