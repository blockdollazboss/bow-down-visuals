import { Volume2, Download, Music2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { ReferenceAudioPlayer } from "@/components/ReferenceAudioPlayer";
import { FinalVideoExport } from "@/components/FinalVideoExport";
import type { SceneData } from "@/lib/scene-parser";
import {
  VIDEO_FORMATS,
  type EditorSettings, type VideoFormat, type ExportResolution, type ExportQuality,
} from "@/lib/editor-settings";
import { EditorCard, Field, Chip, Segmented } from "@/components/editor/controls";

interface ExportSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  projectId: string;
  audioUrl: string | null;
}

const RESOLUTION_OPTIONS: { value: ExportResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];
const QUALITY_OPTIONS: { value: ExportQuality; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "final", label: "Final" },
];

export function ExportSection({ scenes, settings, setSettings, projectId, audioUrl }: ExportSectionProps) {
  const ms = settings.musicStudio;
  const hasFinalMix = ms.stems.length > 0 || ms.aiMixPlan !== null;

  function setVideoAudio(patch: Partial<typeof ms.videoAudio>) {
    setSettings({ ...settings, musicStudio: { ...ms, videoAudio: { ...ms.videoAudio, ...patch } } });
  }

  return (
    <div className="space-y-5">
      <EditorCard title="Audio" subtitle="How your song sits under the clips" icon={<Volume2 className="h-4 w-4" />}>
        <div className="space-y-5">
          {audioUrl ? <ReferenceAudioPlayer url={audioUrl} label="Your Song" /> : (
            <p className="text-xs text-white/35">No song uploaded with this project.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Audio start" hint={`${settings.audio.startSec.toFixed(1)}s`}>
              <Slider value={[settings.audio.startSec]} min={0} max={60} step={0.5} onValueChange={([v]) => setSettings({ ...settings, audio: { ...settings.audio, startSec: v ?? 0 } })} />
            </Field>
            <Field label="Song volume" hint={`${settings.audio.volume}%`}>
              <Slider value={[settings.audio.volume]} min={0} max={100} step={5} onValueChange={([v]) => setSettings({ ...settings, audio: { ...settings.audio, volume: v ?? 100 } })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip active={settings.audio.fadeIn} onClick={() => setSettings({ ...settings, audio: { ...settings.audio, fadeIn: !settings.audio.fadeIn } })}>Fade in</Chip>
            <Chip active={settings.audio.fadeOut} onClick={() => setSettings({ ...settings, audio: { ...settings.audio, fadeOut: !settings.audio.fadeOut } })}>Fade out</Chip>
          </div>
        </div>
      </EditorCard>

      <EditorCard title="Music ↔ Video Sync" subtitle="Which audio plays under the final video" icon={<Music2 className="h-4 w-4" />}>
        <div className="space-y-5">
          <Field label="Audio source">
            <div className="flex flex-wrap gap-2">
              <AudioSourceBtn
                active={ms.videoAudio.source === "uploaded"}
                onClick={() => setVideoAudio({ source: "uploaded" })}
                label="Uploaded Song"
                note="The original song on this project"
                testId="audio-source-uploaded"
              />
              <AudioSourceBtn
                active={ms.videoAudio.source === "finalMix"}
                onClick={() => setVideoAudio({ source: "finalMix" })}
                label="Music Studio Mix"
                note={hasFinalMix ? "Your studio mix & master" : "Add stems or a mix plan first"}
                disabled={!hasFinalMix}
                testId="audio-source-finalmix"
              />
            </div>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Audio offset" hint={`${ms.videoAudio.startSec.toFixed(1)}s`}>
              <Slider value={[ms.videoAudio.startSec]} min={0} max={60} step={0.5} onValueChange={([v]) => setVideoAudio({ startSec: v ?? 0 })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip active={ms.videoAudio.matchVideoLength} onClick={() => setVideoAudio({ matchVideoLength: !ms.videoAudio.matchVideoLength })}>Match video length</Chip>
            <Chip active={ms.videoAudio.fadeIn} onClick={() => setVideoAudio({ fadeIn: !ms.videoAudio.fadeIn })}>Fade in</Chip>
            <Chip active={ms.videoAudio.fadeOut} onClick={() => setVideoAudio({ fadeOut: !ms.videoAudio.fadeOut })}>Fade out</Chip>
          </div>
        </div>
      </EditorCard>

      <EditorCard title="Export Settings" subtitle="Format, resolution and quality" icon={<Download className="h-4 w-4" />}>
        <div className="space-y-5">
          <Field label="Format">
            <div className="flex flex-wrap gap-2">
              {VIDEO_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSettings({ ...settings, export: { ...settings.export, format: f.id as VideoFormat } })}
                  className={`px-3.5 py-2 rounded-xl border text-sm font-black transition-colors ${
                    settings.export.format === f.id ? "border-primary/50 bg-primary/10 text-primary" : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20"
                  }`}
                  data-testid={`export-format-${f.id}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Resolution">
            <Segmented
              value={settings.export.resolution}
              options={RESOLUTION_OPTIONS}
              onChange={(v) => setSettings({ ...settings, export: { ...settings.export, resolution: v } })}
            />
          </Field>
          <Field label="Quality">
            <Segmented
              value={settings.export.quality}
              options={QUALITY_OPTIONS}
              onChange={(v) => setSettings({ ...settings, export: { ...settings.export, quality: v } })}
            />
          </Field>
        </div>
      </EditorCard>

      <FinalVideoExport scenes={scenes} projectId={projectId} audioUrl={audioUrl} />
    </div>
  );
}

function AudioSourceBtn({
  active, onClick, label, note, disabled, testId,
}: {
  active: boolean; onClick: () => void; label: string; note: string; disabled?: boolean; testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`flex flex-col items-start px-4 py-2.5 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? "border-primary/50 bg-primary/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"
      }`}
    >
      <span className={`text-sm font-black ${active ? "text-primary" : "text-white/70"}`}>{label}</span>
      <span className="text-[10px] text-white/35">{note}</span>
    </button>
  );
}
