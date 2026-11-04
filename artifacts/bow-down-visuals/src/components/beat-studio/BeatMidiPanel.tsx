/* ── Beat Studio MIDI controller panel (W3c) ─────────────────────────────
 * The surface for lib/beat-midi.ts + lib/web-midi.ts: connect a MIDI
 * controller, hear it live through the sequencer's own tracks, and —
 * with Record armed while the transport plays — write what you play
 * into the pattern. The panel is honest about the platform: browsers
 * without Web MIDI (Safari / Firefox today) get a plain absence
 * message instead of a dead button, a blocked permission says so, and
 * the device list shows only the names the browser actually reported
 * — never an invented one. All state lives in the sequencer tab; this
 * component only presents it. */

import { Circle, Piano } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { BEAT_MELODIC_VOICES, type BeatMelodicVoiceId } from "@/lib/beat-melody";

export type BeatMidiPanelStatus = "idle" | "connecting" | "connected" | "blocked";

interface BeatMidiPanelProps {
  supported: boolean;
  status: BeatMidiPanelStatus;
  /** Real input names reported by the browser (may be empty). */
  inputs: string[];
  armed: boolean;
  voice: BeatMelodicVoiceId;
  /** Human label of the last note played (e.g. "Kick · step 5"). */
  lastLabel: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleArm: () => void;
  onVoiceChange: (voice: BeatMelodicVoiceId) => void;
}

export function BeatMidiPanel({
  supported,
  status,
  inputs,
  armed,
  voice,
  lastLabel,
  onConnect,
  onDisconnect,
  onToggleArm,
  onVoiceChange,
}: BeatMidiPanelProps) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const box = isLight
    ? "border-[#c9a84c]/25 bg-[#8a6d2f]/[0.04]"
    : "border-white/10 bg-black/30";
  const label = isLight ? "text-[#4A3B22]/70" : "text-white/60";
  const heading = isLight ? "text-[#2A2118]" : "text-white";
  const dim = isLight ? "text-[#4A3B22]/50" : "text-white/40";
  const pill = isLight
    ? "border-[#c9a84c]/30 text-[#4A3B22] hover:border-[#c9a84c]/60 hover:text-[#2A2118]"
    : "border-white/15 text-white/60 hover:border-primary/60 hover:text-white";
  const pillActive = "bg-primary text-black border-transparent font-black";

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${box}`} data-testid="beat-midi-panel">
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-xs font-black uppercase tracking-wider ${label} flex items-center gap-1.5`}>
          <Piano className="w-4 h-4" /> {t("beatMaker.midiTitle", { defaultValue: "MIDI Controller" })}
        </p>
        {status === "connected" && (
          <button
            type="button" data-testid="beat-midi-disconnect"
            onClick={onDisconnect}
            className={`ml-auto px-3 py-1.5 rounded-full text-sm border transition-colors ${pill}`}
          >
            {t("beatMaker.midiDisconnect", { defaultValue: "Disconnect" })}
          </button>
        )}
      </div>

      {!supported ? (
        <p className={`text-xs ${dim}`} data-testid="beat-midi-unsupported">
          {t("beatMaker.midiUnsupported", {
            defaultValue:
              "This browser can't take MIDI input — Web MIDI works in Chrome and Edge. Hardware playing is off here; clicking steps works exactly as always.",
          })}
        </p>
      ) : status === "blocked" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-red-400" role="alert" data-testid="beat-midi-blocked">
            {t("beatMaker.midiBlocked", {
              defaultValue:
                "The browser didn't hand over MIDI access. Check this site's MIDI permission in the browser, then try again.",
            })}
          </p>
          <button
            type="button" data-testid="beat-midi-connect"
            onClick={onConnect}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${pill}`}
          >
            {t("beatMaker.midiTryAgain", { defaultValue: "Try again" })}
          </button>
        </div>
      ) : status === "connecting" ? (
        <p className={`text-xs ${dim}`} data-testid="beat-midi-connecting" aria-live="polite">
          {t("beatMaker.midiConnecting", { defaultValue: "Waiting for the browser's MIDI permission…" })}
        </p>
      ) : status === "idle" ? (
        <div className="space-y-2">
          <p className={`text-xs ${dim}`}>
            {t("beatMaker.midiIntro", {
              defaultValue:
                "Play the drums, the 808 and the melody from a MIDI controller. Arm Record, press Play, and what you play lands in the pattern — free, and nothing leaves your browser.",
            })}
          </p>
          <button
            type="button" data-testid="beat-midi-connect"
            onClick={onConnect}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${pill}`}
          >
            {t("beatMaker.midiConnect", { defaultValue: "Connect a controller" })}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {inputs.length > 0 ? (
            <p className={`text-xs ${heading}`} data-testid="beat-midi-devices">
              {t("beatMaker.midiConnected", { defaultValue: "Connected:" })}{" "}
              <span className="font-bold">{inputs.join(" · ")}</span>
            </p>
          ) : (
            <p className={`text-xs ${dim}`} data-testid="beat-midi-no-devices">
              {t("beatMaker.midiNoDevices", {
                defaultValue:
                  "MIDI access is on, but no controller showed up. Plug one in, then Disconnect and Connect again so the browser can see it.",
              })}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button" aria-pressed={armed} data-testid="beat-midi-arm"
              onClick={onToggleArm}
              className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors ${
                armed
                  ? "bg-red-500 text-white border-transparent font-black hover:bg-red-600"
                  : pill
              }`}
            >
              <Circle className={`w-3 h-3 ${armed ? "fill-white" : "fill-red-500 text-red-500"}`} />
              {t("beatMaker.midiRecord", { defaultValue: "Record" })}
            </button>
            <span className={`text-xs ${dim}`} aria-live="polite">
              {armed
                ? t("beatMaker.midiArmed", {
                    defaultValue: "Armed — notes you play while the beat runs land in the pattern that's playing.",
                  })
                : t("beatMaker.midiNotArmed", {
                    defaultValue: "Off — you hear the controller live, but nothing is written.",
                  })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-xs ${label}`}>
              {t("beatMaker.midiVoiceLabel", { defaultValue: "Melody plays + records into" })}
            </span>
            {BEAT_MELODIC_VOICES.map((v) => (
              <button
                key={v.id} type="button" aria-pressed={voice === v.id}
                data-testid={`beat-midi-voice-${v.id}`}
                onClick={() => onVoiceChange(v.id)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${voice === v.id ? pillActive : pill}`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {lastLabel && (
            <p className={`text-xs ${dim}`} data-testid="beat-midi-last" aria-live="polite">
              {t("beatMaker.midiLastPlayed", { defaultValue: "Last played: {{label}}", label: lastLabel })}
            </p>
          )}

          <p className={`text-xs ${dim}`}>
            {t("beatMaker.midiMappingHint", {
              defaultValue:
                "Pads follow the standard drum map (GM) — channel 10 is drums only. Keys below C2 play the 808 bass; everything else plays the melody voice above.",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
