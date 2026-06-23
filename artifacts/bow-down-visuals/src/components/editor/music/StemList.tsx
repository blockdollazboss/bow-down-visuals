import { useRef, useState } from "react";
import {
  Upload, Loader2, Trash2, Volume2, VolumeX, Headphones, Lock, LockOpen, Music4, Repeat2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  STEM_TYPES, STEM_ACCEPT, STEM_MAX_MB, STEM_EQ_PRESETS,
  REVERB_AMOUNTS, AUTOTUNE_STYLES, FX_LEVELS,
  type EditorSettings, type AudioStem, type StemEffects,
} from "@/lib/editor-settings";
import { uploadStemFile, removeStemFile, makeStem, readAudioDuration } from "@/lib/audio-stems";
import { Field, Dropdown, Collapsible, Chip } from "@/components/editor/controls";

type Variant = "tracks" | "mixer" | "effects";

interface StemListProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  variant: Variant;
}

export function StemList({ settings, onChange, variant }: StemListProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const ms = settings.musicStudio;
  const stems = ms.stems;
  const anySolo = stems.some((s) => s.solo);

  function setStems(next: AudioStem[]) {
    onChange({ ...settings, musicStudio: { ...ms, stems: next } });
  }
  function patchStem(id: string, patch: Partial<AudioStem>) {
    setStems(stems.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function patchEffects(id: string, patch: Partial<StemEffects>) {
    setStems(stems.map((s) => (s.id === id ? { ...s, effects: { ...s.effects, ...patch } } : s)));
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to upload stems.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const added: AudioStem[] = [];
      for (const file of Array.from(files)) {
        const duration = await readAudioDuration(file);
        const upload = await uploadStemFile(user.id, file);
        added.push(makeStem(file, upload, "Other Stem", duration));
      }
      setStems([...stems, ...added]);
      toast({ title: "Stems uploaded", description: `${added.length} stem${added.length > 1 ? "s" : ""} added.` });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function startReplace(id: string) {
    setReplacingId(id);
    replaceRef.current?.click();
  }

  async function handleReplace(fileList: FileList | null) {
    const file = fileList?.[0];
    const id = replacingId;
    if (replaceRef.current) replaceRef.current.value = "";
    if (!file || !id) {
      setReplacingId(null);
      return;
    }
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to replace stems.", variant: "destructive" });
      setReplacingId(null);
      return;
    }
    const target = stems.find((s) => s.id === id);
    if (!target) {
      setReplacingId(null);
      return;
    }
    setUploading(true);
    try {
      const duration = await readAudioDuration(file);
      const upload = await uploadStemFile(user.id, file);
      const oldPath = target.storagePath;
      patchStem(id, {
        url: upload.url,
        storagePath: upload.storagePath,
        fileType: file.type || "audio",
        fileSize: file.size,
        durationSec: duration,
        uploadedAt: new Date().toISOString(),
      });
      if (oldPath && oldPath !== upload.storagePath) await removeStemFile(oldPath);
      toast({ title: "Stem replaced", description: `${target.name} now uses ${file.name}.` });
    } catch (err) {
      toast({ title: "Replace failed", description: err instanceof Error ? err.message : "Could not replace.", variant: "destructive" });
    } finally {
      setUploading(false);
      setReplacingId(null);
    }
  }

  async function deleteStem(stem: AudioStem) {
    setStems(stems.filter((s) => s.id !== stem.id));
    await removeStemFile(stem.storagePath);
  }

  return (
    <div className="space-y-4">
      <input
        ref={replaceRef}
        type="file"
        accept={STEM_ACCEPT}
        className="hidden"
        onChange={(e) => handleReplace(e.target.files)}
        data-testid="input-stem-replace"
      />
      {variant === "tracks" && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={STEM_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            data-testid="input-stem-upload"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid="btn-upload-stem"
            className="w-full flex items-center justify-center gap-2.5 h-12 rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-sm font-bold text-white/55 hover:text-white hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : `Upload stems (WAV / MP3 / M4A / FLAC, ≤${STEM_MAX_MB}MB)`}
          </button>
        </>
      )}

      {stems.length === 0 ? (
        <div className="text-center py-8">
          <Music4 className="h-7 w-7 text-white/15 mx-auto mb-2" />
          <p className="text-sm text-white/40">No stems yet. Upload your vocals, beat and 808s to start mixing.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {stems.map((stem) => {
            const dimmed = anySolo && !stem.solo;
            return (
              <div
                key={stem.id}
                data-testid={`stem-row-${stem.id}`}
                className={`rounded-xl border bg-white/[0.02] overflow-hidden transition-opacity ${
                  stem.locked ? "border-amber-500/20" : "border-white/[0.07]"
                } ${dimmed ? "opacity-40" : ""}`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={stem.name}
                      disabled={stem.locked}
                      onChange={(e) => patchStem(stem.id, { name: e.target.value })}
                      className="w-full bg-transparent text-sm font-semibold text-white/85 focus:outline-none disabled:opacity-70"
                      data-testid={`stem-name-${stem.id}`}
                    />
                    <p className="text-[10px] text-white/30 truncate">
                      {stem.type} · {(stem.fileSize / (1024 * 1024)).toFixed(1)}MB
                      {stem.durationSec ? ` · ${formatDuration(stem.durationSec)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <ToggleBtn active={stem.muted} title="Mute" onClick={() => patchStem(stem.id, { muted: !stem.muted })} testId={`stem-mute-${stem.id}`}>
                      {stem.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </ToggleBtn>
                    <ToggleBtn active={stem.solo} accent="green" title="Solo" onClick={() => patchStem(stem.id, { solo: !stem.solo })} testId={`stem-solo-${stem.id}`}>
                      <Headphones className="h-3.5 w-3.5" />
                    </ToggleBtn>
                    <ToggleBtn active={stem.locked} accent="amber" title="Lock" onClick={() => patchStem(stem.id, { locked: !stem.locked })} testId={`stem-lock-${stem.id}`}>
                      {stem.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                    </ToggleBtn>
                    <button
                      type="button"
                      onClick={() => deleteStem(stem)}
                      disabled={stem.locked}
                      title="Delete"
                      data-testid={`stem-delete-${stem.id}`}
                      className="h-7 w-7 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors disabled:opacity-25"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {variant === "tracks" && (
                  <div className="px-4 pb-3 space-y-3 border-t border-white/[0.04] pt-3">
                    <Waveform />
                    <div className="flex items-center gap-2">
                      <audio
                        controls
                        preload="none"
                        src={stem.url}
                        className="h-8 w-full min-w-0 rounded-md"
                        data-testid={`stem-player-${stem.id}`}
                      />
                      <button
                        type="button"
                        onClick={() => startReplace(stem.id)}
                        disabled={stem.locked || uploading}
                        title="Replace file"
                        data-testid={`stem-replace-${stem.id}`}
                        className="h-8 px-2.5 shrink-0 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 text-[11px] font-bold text-white/55 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
                      >
                        <Repeat2 className="h-3.5 w-3.5" /> Replace
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Stem type">
                        <Dropdown value={stem.type} options={STEM_TYPES} onChange={(v) => patchStem(stem.id, { type: v })} testId={`stem-type-${stem.id}`} />
                      </Field>
                      <Field label="Start offset" hint={`${stem.startTime.toFixed(1)}s`}>
                        <Slider value={[stem.startTime]} min={0} max={30} step={0.5} disabled={stem.locked} onValueChange={([v]) => patchStem(stem.id, { startTime: v ?? 0 })} />
                      </Field>
                    </div>
                  </div>
                )}

                {variant === "mixer" && (
                  <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-white/[0.04] pt-3">
                    <Field label="Volume" hint={`${stem.volume}%`}>
                      <Slider value={[stem.volume]} min={0} max={100} step={1} disabled={stem.locked} onValueChange={([v]) => patchStem(stem.id, { volume: v ?? 100 })} />
                    </Field>
                    <Field label="Pan" hint={panLabel(stem.pan)}>
                      <Slider value={[stem.pan]} min={-100} max={100} step={5} disabled={stem.locked} onValueChange={([v]) => patchStem(stem.id, { pan: v ?? 0 })} />
                    </Field>
                    <Field label="Trim start" hint={`${stem.trimStart.toFixed(1)}s`}>
                      <Slider value={[stem.trimStart]} min={0} max={30} step={0.5} disabled={stem.locked} onValueChange={([v]) => patchStem(stem.id, { trimStart: v ?? 0 })} />
                    </Field>
                    <Field label="Trim end" hint={`${stem.trimEnd.toFixed(1)}s`}>
                      <Slider value={[stem.trimEnd]} min={0} max={30} step={0.5} disabled={stem.locked} onValueChange={([v]) => patchStem(stem.id, { trimEnd: v ?? 0 })} />
                    </Field>
                  </div>
                )}

                {variant === "effects" && (
                  <div className="px-4 pb-3 border-t border-white/[0.04] pt-3">
                    <Collapsible title={`${stem.name} effects`}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="EQ preset"><Dropdown value={stem.effects.eq} options={STEM_EQ_PRESETS} onChange={(v) => patchEffects(stem.id, { eq: v })} testId={`stem-eq-${stem.id}`} /></Field>
                        <Field label="Autotune"><Dropdown value={stem.effects.autotune} options={AUTOTUNE_STYLES} onChange={(v) => patchEffects(stem.id, { autotune: v as StemEffects["autotune"] })} /></Field>
                        <Field label="Reverb"><Dropdown value={stem.effects.reverb} options={REVERB_AMOUNTS} onChange={(v) => patchEffects(stem.id, { reverb: v as StemEffects["reverb"] })} /></Field>
                        <Field label="Delay"><Dropdown value={stem.effects.delay} options={REVERB_AMOUNTS} onChange={(v) => patchEffects(stem.id, { delay: v as StemEffects["delay"] })} /></Field>
                        <Field label="Compression"><Dropdown value={stem.effects.compression} options={FX_LEVELS} onChange={(v) => patchEffects(stem.id, { compression: v as StemEffects["compression"] })} /></Field>
                        <Field label="Saturation"><Dropdown value={stem.effects.saturation} options={FX_LEVELS} onChange={(v) => patchEffects(stem.id, { saturation: v as StemEffects["saturation"] })} /></Field>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <Chip active={stem.effects.deEsser} onClick={() => patchEffects(stem.id, { deEsser: !stem.effects.deEsser })}>De-esser</Chip>
                        <Chip active={stem.effects.noiseReduction} onClick={() => patchEffects(stem.id, { noiseReduction: !stem.effects.noiseReduction })}>Noise reduction</Chip>
                      </div>
                    </Collapsible>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function panLabel(pan: number): string {
  if (pan === 0) return "Center";
  return pan < 0 ? `L ${Math.abs(pan)}` : `R ${pan}`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const WAVE_BARS = [38, 62, 45, 80, 55, 92, 48, 70, 40, 88, 52, 75, 44, 96, 50, 68, 42, 84, 58, 72, 46, 90, 54, 66, 78, 48, 82, 60];

/** Static visual placeholder for a stem waveform (real rendering coming soon). */
function Waveform() {
  return (
    <div
      className="flex items-end gap-[2px] h-10 px-2 rounded-lg bg-white/[0.03] border border-white/[0.05] overflow-hidden"
      data-testid="stem-waveform"
      aria-hidden="true"
    >
      {WAVE_BARS.map((h, i) => (
        <span key={i} className="flex-1 rounded-full bg-primary/25" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function ToggleBtn({
  active, onClick, title, children, accent, testId,
}: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
  accent?: "green" | "amber"; testId?: string;
}) {
  const activeCls =
    accent === "green" ? "border-green-500/40 bg-green-500/10 text-green-300"
    : accent === "amber" ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : "border-red-500/40 bg-red-500/10 text-red-300";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-testid={testId}
      className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
        active ? activeCls : "border-white/10 bg-white/5 text-white/45 hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
