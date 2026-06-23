import { Captions } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  CAPTION_STYLES, CAPTION_POSITIONS, CAPTION_FONT_SIZES,
  type EditorSettings,
} from "@/lib/editor-settings";
import { EditorCard, Field, Dropdown, TextInput } from "@/components/editor/controls";
import { PlanNote } from "@/components/editor/sections/shared";

interface CaptionsSectionProps {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
}

export function CaptionsSection({ settings, setSettings }: CaptionsSectionProps) {
  return (
    <div className="space-y-5">
      <EditorCard title="Captions" subtitle="Lyric captions for the export" icon={<Captions className="h-4 w-4" />}>
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white/80">Show captions</p>
              <p className="text-[11px] text-white/35">Burn lyric captions onto the final video</p>
            </div>
            <Switch
              checked={settings.captions.enabled}
              onCheckedChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, enabled: v } })}
              data-testid="toggle-captions"
            />
          </div>
          {settings.captions.enabled && (
            <div className="space-y-4">
              <Field label="Title text" hint="shown over the intro / first clip">
                <TextInput
                  value={settings.captions.titleText}
                  placeholder="e.g. ARTIST — SONG TITLE"
                  onChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, titleText: v } })}
                  testId="caption-title-text"
                />
              </Field>
              <Field label="Lyric caption text" hint="overrides per-scene lyrics (edit-plan only)">
                <TextInput
                  value={settings.captions.lyricText}
                  placeholder="Custom lyric caption line"
                  onChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, lyricText: v } })}
                  testId="caption-lyric-text"
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Style">
                  <Dropdown value={settings.captions.style} options={CAPTION_STYLES} onChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, style: v } })} testId="caption-style" />
                </Field>
                <Field label="Font size">
                  <Dropdown value={settings.captions.fontSize} options={CAPTION_FONT_SIZES} onChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, fontSize: v } })} testId="caption-font-size" />
                </Field>
                <Field label="Position">
                  <Dropdown value={settings.captions.position} options={CAPTION_POSITIONS} onChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, position: v } })} testId="caption-position" />
                </Field>
                <Field label="Timing offset" hint={`${settings.captions.timingOffset.toFixed(1)}s`}>
                  <Slider value={[settings.captions.timingOffset]} min={-2} max={2} step={0.1} onValueChange={([v]) => setSettings({ ...settings, captions: { ...settings.captions, timingOffset: v ?? 0 } })} />
                </Field>
              </div>
            </div>
          )}
        </div>
      </EditorCard>
      <PlanNote />
    </div>
  );
}
