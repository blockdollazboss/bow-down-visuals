import {
  Scissors, Captions, ArrowLeftRight, Wand2, Download,
  ArrowUp, ArrowDown, Copy, Trash2, Volume2, VolumeX, Check, Film, Info, Link2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { ClipSequencePlayer } from "@/components/ClipSequencePlayer";
import { ReferenceAudioPlayer } from "@/components/ReferenceAudioPlayer";
import { FinalVideoExport } from "@/components/FinalVideoExport";
import type { SceneData } from "@/lib/scene-parser";
import {
  TRANSITIONS, EFFECTS, OVERLAYS, CAPTION_STYLES, CAPTION_POSITIONS, VIDEO_FORMATS,
  getClipEdit, defaultClipEdit, sceneHasClip,
  type EditorSettings, type ClipEdit, type VideoFormat, type ExportResolution, type ExportQuality,
} from "@/lib/editor-settings";
import { EditorCard, Field, Chip, Dropdown, Segmented, Collapsible } from "@/components/editor/controls";

interface ManualEditorProps {
  scenes: SceneData[];
  setScenes: (s: SceneData[]) => void;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  projectId: string;
  audioUrl: string | null;
}

const EDIT_PLAN_NOTE =
  "Trims, transitions, effects, captions and overlays are saved as an edit plan — they're applied when final rendering is enabled, not burned into clips yet.";

const RESOLUTION_OPTIONS: { value: ExportResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];
const QUALITY_OPTIONS: { value: ExportQuality; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "final", label: "Final" },
];

export function ManualEditor({ scenes, setScenes, settings, setSettings, projectId, audioUrl }: ManualEditorProps) {
  /* ── scene-array mutations (real, persisted on scenes) ── */
  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setScenes(next);
  }
  function remove(id: string) {
    setScenes(scenes.filter((s) => s.id !== id));
  }
  function duplicate(index: number) {
    const orig = scenes[index]!;
    const copy: SceneData = { ...orig, id: `${orig.id}-copy-${Date.now()}`, approved: false };
    const next = [...scenes];
    next.splice(index + 1, 0, copy);
    setScenes(next);
  }
  function toggleApprove(id: string) {
    setScenes(scenes.map((s) => (s.id === id ? { ...s, approved: !s.approved } : s)));
  }

  /* ── per-clip edit-plan mutations (stored in settings.clips) ── */
  function patchClip(sceneId: string, patch: Partial<ClipEdit>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
  }

  function toggleListItem(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  }

  return (
    <Tabs defaultValue="edit" className="space-y-5">
      <TabsList className="grid grid-cols-5 w-full bg-white/[0.03] border border-white/[0.07] rounded-xl p-1 h-auto">
        <TabTrigger value="edit" icon={<Scissors className="h-3.5 w-3.5" />} label="Edit" />
        <TabTrigger value="captions" icon={<Captions className="h-3.5 w-3.5" />} label="Captions" />
        <TabTrigger value="transitions" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Transitions" />
        <TabTrigger value="effects" icon={<Wand2 className="h-3.5 w-3.5" />} label="Effects" />
        <TabTrigger value="export" icon={<Download className="h-3.5 w-3.5" />} label="Export" />
      </TabsList>

      {/* ── EDIT ── */}
      <TabsContent value="edit" className="space-y-5 mt-0">
        <ClipSequencePlayer
          scenes={scenes.filter(sceneHasClip)}
          allScenes={scenes}
          title="Timeline Preview"
          emptyTitle="No clips to preview yet."
          emptyHint="Generate Runway clips on your scenes first — they'll play here in order."
        />
        <PlanNote />
        {scenes.length === 0 ? (
          <EmptyScenes />
        ) : (
          <div className="space-y-3">
            {scenes.map((scene, i) => {
              const edit = getClipEdit(settings, scene.id);
              const hasClip = sceneHasClip(scene);
              return (
                <div key={scene.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden" data-testid={`clip-row-${i}`}>
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.05]">
                    <span className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-[11px] font-black text-primary">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white/80 truncate">
                        {scene.section || `Scene ${i + 1}`}
                      </p>
                      <p className="text-[11px] text-white/35 truncate">
                        {scene.lyricLine || scene.action || scene.location || "—"}
                      </p>
                    </div>
                    {hasClip ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 shrink-0">Clip</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-white/30 shrink-0">No clip</span>
                    )}
                    {/* row actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <IconBtn title="Move up" disabled={i === 0} onClick={() => move(i, -1)} testId={`btn-up-${i}`}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn title="Move down" disabled={i === scenes.length - 1} onClick={() => move(i, 1)} testId={`btn-down-${i}`}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn title="Duplicate" onClick={() => duplicate(i)} testId={`btn-duplicate-${i}`}><Copy className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn title="Remove" danger onClick={() => remove(scene.id)} testId={`btn-remove-${i}`}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                    </div>
                  </div>

                  <div className="p-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleApprove(scene.id)}
                        data-testid={`btn-approve-${i}`}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                          scene.approved
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" /> {scene.approved ? "Approved" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => patchClip(scene.id, { muted: !edit.muted })}
                        data-testid={`btn-mute-${i}`}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                          edit.muted
                            ? "border-red-500/40 bg-red-500/10 text-red-300"
                            : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
                        }`}
                      >
                        {edit.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                        {edit.muted ? "Muted" : "Mute"}
                      </button>
                    </div>

                    <Collapsible title="Trim · Volume · Replace">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Trim start" hint={`${edit.trimStart.toFixed(1)}s`}>
                          <Slider value={[edit.trimStart]} min={0} max={10} step={0.5} onValueChange={([v]) => patchClip(scene.id, { trimStart: v ?? 0 })} />
                        </Field>
                        <Field label="Trim end" hint={`${edit.trimEnd.toFixed(1)}s`}>
                          <Slider value={[edit.trimEnd]} min={0} max={10} step={0.5} onValueChange={([v]) => patchClip(scene.id, { trimEnd: v ?? 0 })} />
                        </Field>
                        <Field label="Clip volume" hint={`${edit.volume}%`}>
                          <Slider value={[edit.volume]} min={0} max={100} step={5} onValueChange={([v]) => patchClip(scene.id, { volume: v ?? 100 })} />
                        </Field>
                        <Field label="Replace clip URL" hint="edit-plan only">
                          <div className="flex items-center gap-2">
                            <Link2 className="h-4 w-4 text-white/30 shrink-0" />
                            <Input
                              value={edit.replaceUrl ?? ""}
                              onChange={(e) => patchClip(scene.id, { replaceUrl: e.target.value || null })}
                              placeholder="https://…"
                              className="h-9 text-xs bg-white/[0.04] border-white/[0.1] text-white/80"
                              data-testid={`input-replace-${i}`}
                            />
                          </div>
                        </Field>
                      </div>
                    </Collapsible>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </TabsContent>

      {/* ── CAPTIONS ── */}
      <TabsContent value="captions" className="space-y-5 mt-0">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Style">
                  <Dropdown value={settings.captions.style} options={CAPTION_STYLES} onChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, style: v } })} testId="caption-style" />
                </Field>
                <Field label="Position">
                  <Dropdown value={settings.captions.position} options={CAPTION_POSITIONS} onChange={(v) => setSettings({ ...settings, captions: { ...settings.captions, position: v } })} testId="caption-position" />
                </Field>
                <Field label="Timing offset" hint={`${settings.captions.timingOffset.toFixed(1)}s`}>
                  <Slider value={[settings.captions.timingOffset]} min={-2} max={2} step={0.1} onValueChange={([v]) => setSettings({ ...settings, captions: { ...settings.captions, timingOffset: v ?? 0 } })} />
                </Field>
              </div>
            )}
          </div>
        </EditorCard>
        <PlanNote />
      </TabsContent>

      {/* ── TRANSITIONS ── */}
      <TabsContent value="transitions" className="space-y-5 mt-0">
        <EditorCard title="Transitions" subtitle="Set the transition into each clip" icon={<ArrowLeftRight className="h-4 w-4" />}>
          {scenes.length === 0 ? <EmptyScenes /> : (
            <div className="space-y-2.5">
              {scenes.map((scene, i) => {
                const edit = getClipEdit(settings, scene.id);
                return (
                  <div key={scene.id} className="flex items-center gap-3">
                    <span className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 text-[10px] font-black text-white/40">{i + 1}</span>
                    <span className="flex-1 min-w-0 text-xs text-white/55 truncate">{scene.section || scene.lyricLine || `Scene ${i + 1}`}</span>
                    <div className="w-44 shrink-0">
                      <Dropdown
                        value={edit.transition}
                        options={i === 0 ? ["Hard Cut"] : TRANSITIONS}
                        onChange={(v) => patchClip(scene.id, { transition: v })}
                        testId={`transition-${i}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </EditorCard>
        <PlanNote />
      </TabsContent>

      {/* ── EFFECTS ── */}
      <TabsContent value="effects" className="space-y-5 mt-0">
        <EditorCard title="Global Effects" subtitle="Applied across the whole video" icon={<Wand2 className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            {EFFECTS.map((fx) => (
              <Chip key={fx} active={settings.effects.includes(fx)} onClick={() => setSettings({ ...settings, effects: toggleListItem(settings.effects, fx) })}>{fx}</Chip>
            ))}
          </div>
        </EditorCard>

        <EditorCard title="Overlays" subtitle="Branding and on-screen elements" icon={<Film className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            {OVERLAYS.map((ov) => (
              <Chip key={ov} active={settings.overlays.includes(ov)} onClick={() => setSettings({ ...settings, overlays: toggleListItem(settings.overlays, ov) })}>{ov}</Chip>
            ))}
          </div>
        </EditorCard>

        <Collapsible title="Per-Clip Effects">
          {scenes.length === 0 ? <EmptyScenes /> : (
            <div className="space-y-2.5">
              {scenes.map((scene, i) => {
                const edit = getClipEdit(settings, scene.id);
                return (
                  <div key={scene.id} className="flex items-center gap-3">
                    <span className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 text-[10px] font-black text-white/40">{i + 1}</span>
                    <span className="flex-1 min-w-0 text-xs text-white/55 truncate">{scene.section || scene.lyricLine || `Scene ${i + 1}`}</span>
                    <div className="w-44 shrink-0">
                      <Dropdown value={edit.effect} options={["None", ...EFFECTS]} onChange={(v) => patchClip(scene.id, { effect: v })} testId={`effect-${i}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Collapsible>
        <PlanNote />
      </TabsContent>

      {/* ── EXPORT ── */}
      <TabsContent value="export" className="space-y-5 mt-0">
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
      </TabsContent>
    </Tabs>
  );
}

function TabTrigger({ value, icon, label }: { value: string; icon: React.ReactNode; label: string }) {
  return (
    <TabsTrigger
      value={value}
      data-testid={`tab-${value}`}
      className="flex items-center gap-1.5 rounded-lg py-2 text-xs font-bold text-white/45 data-[state=active]:bg-primary data-[state=active]:text-black transition-colors"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  );
}

function IconBtn({
  children, onClick, title, disabled, danger, testId,
}: {
  children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean; danger?: boolean; testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-25 disabled:cursor-not-allowed ${
        danger
          ? "border-red-500/20 bg-red-500/5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
          : "border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function PlanNote() {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/[0.06] border border-blue-500/15">
      <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-blue-200/80 leading-relaxed">{EDIT_PLAN_NOTE}</p>
    </div>
  );
}

function EmptyScenes() {
  return (
    <div className="text-center py-10">
      <Film className="h-8 w-8 text-white/15 mx-auto mb-3" />
      <p className="text-sm text-white/40">No scenes in this project yet.</p>
    </div>
  );
}
