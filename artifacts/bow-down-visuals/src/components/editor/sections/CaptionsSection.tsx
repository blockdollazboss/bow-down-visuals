import { useEffect, useState } from "react";
import {
  Captions, Plus, Trash2, Wand2, RotateCcw, Eye, EyeOff,
  CheckCircle2, AlertCircle, Info, Pencil,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  CAPTION_MODE_DEFS,
  CAPTION_STYLE_PRESET_DEFS,
  CAPTION_FONT_SIZES,
  type CaptionLine,
  type CaptionMode,
  type CaptionStylePreset,
  type EditorSettings,
} from "@/lib/editor-settings";
import { EditorCard, Field, Segmented, TextInput } from "@/components/editor/controls";

interface Props {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Project lyrics — auto-fills the lyrics box */
  lyrics?: string;
  /** Song duration in seconds — used to spread captions evenly */
  songDuration?: number;
}

type StatusType = "success" | "error" | "info";
interface Status { type: StatusType; message: string }

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Strip section headers like [Verse 1], [Hook], (Bridge) and return clean lines */
function parseLyricLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^\[.*\]$/.test(l) &&
        !/^\(.*\)$/.test(l) &&
        !/^#+\s/.test(l),
    );
}

function generateAutoLines(lyricsText: string, songDuration?: number): CaptionLine[] {
  const raw = parseLyricLines(lyricsText);
  if (raw.length === 0) return [];
  const secPer =
    songDuration && songDuration > 0 ? songDuration / raw.length : 2;
  return raw.map((text, i): CaptionLine => ({
    id: newLineId(),
    startSec: parseFloat((i * secPer).toFixed(1)),
    endSec: parseFloat(((i + 1) * secPer).toFixed(1)),
    text,
  }));
}

function generateHookLines(hookText: string, songDuration?: number): CaptionLine[] {
  const lines = hookText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const secPer =
    songDuration && songDuration > 0 ? songDuration / lines.length : 4;
  return lines.map((text, i): CaptionLine => ({
    id: newLineId(),
    startSec: parseFloat((i * secPer).toFixed(1)),
    endSec: parseFloat(((i + 1) * secPer).toFixed(1)),
    text,
  }));
}

function generateBestBarLines(bestBarText: string): CaptionLine[] {
  if (!bestBarText.trim()) return [];
  return [{
    id: newLineId(),
    startSec: 0,
    endSec: 999,
    text: bestBarText.trim(),
  }];
}

function secToLabel(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: Status }) {
  const colors =
    status.type === "success"
      ? "border-green-500/25 bg-green-500/[0.07] text-green-400"
      : status.type === "error"
      ? "border-red-500/25 bg-red-500/[0.07] text-red-400"
      : "border-white/10 bg-white/[0.03] text-white/50";
  const Icon =
    status.type === "success" ? CheckCircle2
    : status.type === "error" ? AlertCircle
    : Info;
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${colors}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {status.message}
    </div>
  );
}

export function CaptionsSection({ settings, setSettings, lyrics, songDuration }: Props) {
  const c = settings.captions;
  const [linesVisible, setLinesVisible] = useState(true);
  const [generateStatus, setGenerateStatus] = useState<Status | null>(null);
  const [lyricsAutoFilled, setLyricsAutoFilled] = useState(false);

  /* quickLyrics: the text shown in the "Generate From Lyrics" box.
     Priority: existing lyricsText saved in settings → incoming lyrics prop → empty. */
  const [quickLyrics, setQuickLyrics] = useState<string>(
    c.lyricsText || lyrics || "",
  );

  /* When the project finishes loading lyrics arrive asynchronously — backfill once */
  useEffect(() => {
    if (lyrics && !quickLyrics) {
      setQuickLyrics(lyrics);
      setLyricsAutoFilled(true);
    }
  }, [lyrics]); // eslint-disable-line react-hooks/exhaustive-deps

  function setCaption<K extends keyof typeof c>(key: K, value: (typeof c)[K]) {
    setSettings({ ...settings, captions: { ...c, [key]: value } });
  }

  function setMode(mode: CaptionMode) {
    setSettings({ ...settings, captions: { ...c, mode } });
  }

  function setStylePreset(stylePreset: CaptionStylePreset) {
    setSettings({ ...settings, captions: { ...c, stylePreset } });
  }

  /* ── Generate captions from the quick-lyrics box ── */
  function handleGenerateFromLyrics() {
    const text = quickLyrics.trim();
    if (!text) {
      setGenerateStatus({
        type: "error",
        message: "No lyrics found. Paste lyrics or upload a song first.",
      });
      return;
    }
    const lines = generateAutoLines(text, songDuration);
    if (lines.length === 0) {
      setGenerateStatus({
        type: "error",
        message: "No lyric lines found after stripping section headers. Add some lyric text.",
      });
      return;
    }
    setSettings({
      ...settings,
      captions: { ...c, mode: "auto", lyricsText: text, lines },
    });
    setLinesVisible(true);
    setGenerateStatus({
      type: "success",
      message: `✓ ${lines.length} caption${lines.length !== 1 ? "s" : ""} generated successfully.`,
    });
  }

  /* ── Generate for the existing per-mode buttons ── */
  function handleGenerate() {
    let lines: CaptionLine[] = [];
    if (c.mode === "auto") lines = generateAutoLines(c.lyricsText, songDuration);
    else if (c.mode === "hook") lines = generateHookLines(c.hookText, songDuration);
    else if (c.mode === "best-bar") lines = generateBestBarLines(c.bestBarText);
    setCaption("lines", lines);
    setLinesVisible(true);
  }

  function handleClear() {
    setSettings({
      ...settings,
      captions: { ...c, lines: [], lyricsText: "", hookText: "", bestBarText: "" },
    });
    setGenerateStatus(null);
  }

  function addManualLine() {
    const lastEnd = c.lines[c.lines.length - 1]?.endSec ?? 0;
    setCaption("lines", [
      ...c.lines,
      { id: newLineId(), startSec: parseFloat(lastEnd.toFixed(1)), endSec: parseFloat((lastEnd + 2).toFixed(1)), text: "" },
    ]);
  }

  function updateLine(id: string, patch: Partial<CaptionLine>) {
    setCaption("lines", c.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function deleteLine(id: string) {
    setCaption("lines", c.lines.filter((l) => l.id !== id));
  }

  const hasCaptions = c.mode !== "none";
  const canGenerate = c.mode === "auto" || c.mode === "hook" || c.mode === "best-bar";

  return (
    <div className="space-y-5">

      {/* ══════════════════════════════════════════════════
          GENERATE CAPTIONS FROM LYRICS — always visible
      ══════════════════════════════════════════════════ */}
      <EditorCard
        title="Generate Captions From Lyrics"
        subtitle="Auto-fill from your project or paste lyrics — one line becomes one caption"
        icon={<Wand2 className="h-4 w-4" />}
      >
        <div className="space-y-3">

          {/* Auto-filled badge */}
          {lyricsAutoFilled && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/[0.06] text-xs text-primary/80">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Lyrics loaded automatically from your project.
            </div>
          )}

          {/* Lyrics textarea */}
          <textarea
            value={quickLyrics}
            onChange={(e) => { setQuickLyrics(e.target.value); setGenerateStatus(null); }}
            placeholder={
              "Paste your lyrics here…\n\nEach line becomes one caption.\n[Verse 1], [Hook], [Chorus] labels are stripped automatically."
            }
            rows={9}
            data-testid="caption-lyrics-input"
            className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
          />

          {/* Timing info */}
          {songDuration ? (
            <p className="text-[11px] text-white/40 flex items-center gap-1.5">
              <Info className="h-3 w-3 shrink-0" />
              Song duration: {fmtDuration(songDuration)} — captions will be spread evenly across the song.
            </p>
          ) : (
            <p className="text-[11px] text-white/35 flex items-center gap-1.5">
              <Info className="h-3 w-3 shrink-0" />
              Caption timing is estimated (2 sec each). You can adjust it manually after generating.
            </p>
          )}

          {/* Generate button */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              onClick={handleGenerateFromLyrics}
              data-testid="btn-generate-captions-from-lyrics"
              className="gold-glow font-bold gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Generate Captions From Lyrics
            </Button>
            {quickLyrics && !lyrics && (
              <p className="text-[11px] text-white/30">or upload a song to auto-fill</p>
            )}
          </div>

          {/* Status message */}
          {generateStatus && <StatusBadge status={generateStatus} />}
        </div>
      </EditorCard>

      {/* ── Mode Selector ── */}
      <EditorCard
        title="Caption Mode"
        subtitle="Choose how captions are added to the video"
        icon={<Captions className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {CAPTION_MODE_DEFS.map((m) => {
            const active = c.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                data-testid={`caption-mode-${m.id}`}
                className={`text-left rounded-xl border p-3.5 transition-all ${
                  active
                    ? "border-primary/60 bg-primary/[0.07] shadow-[0_0_16px_rgba(234,179,8,0.07)]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <p className={`text-sm font-black ${active ? "text-white" : "text-white/65"}`}>{m.label}</p>
                <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{m.description}</p>
              </button>
            );
          })}
        </div>
      </EditorCard>

      {/* ── Style Presets ── */}
      {hasCaptions && (
        <EditorCard title="Caption Style" subtitle="Visual look burned into the video">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {CAPTION_STYLE_PRESET_DEFS.map((p) => {
              const active = c.stylePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStylePreset(p.id)}
                  data-testid={`caption-style-${p.id}`}
                  className={`text-left rounded-xl border bg-gradient-to-br p-3 transition-all ${
                    active
                      ? `${p.accent} opacity-100`
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <p className={`text-xs font-black ${active ? "text-white" : "text-white/60"}`}>{p.name}</p>
                  <p className="text-[10px] text-white/35 mt-0.5 leading-relaxed">{p.description}</p>
                </button>
              );
            })}
          </div>
        </EditorCard>
      )}

      {/* ── Caption Controls ── */}
      {hasCaptions && (
        <EditorCard title="Caption Controls" subtitle="Fine-tune how captions look">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Position">
                <Segmented
                  value={c.position as "Top" | "Center" | "Bottom"}
                  options={[
                    { value: "Top", label: "Top" },
                    { value: "Center", label: "Center" },
                    { value: "Bottom", label: "Bottom" },
                  ]}
                  onChange={(v) => setCaption("position", v)}
                />
              </Field>
              <Field label="Font Size">
                <Segmented
                  value={c.fontSize as typeof CAPTION_FONT_SIZES[number]}
                  options={CAPTION_FONT_SIZES.map((s) => ({ value: s, label: s }))}
                  onChange={(v) => setCaption("fontSize", v)}
                />
              </Field>
            </div>

            <Field label="Text Color">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={c.textColor}
                  onChange={(e) => setCaption("textColor", e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
                  data-testid="caption-text-color"
                />
                <span className="text-xs text-white/40 font-mono">{c.textColor.toUpperCase()}</span>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { key: "outline",    label: "Outline",        hint: "Text outline / border" },
                  { key: "background", label: "Background Box", hint: "Filled box behind text" },
                ] as const
              ).map(({ key, label, hint }) => (
                <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <div>
                    <p className="text-xs font-semibold text-white/70">{label}</p>
                    <p className="text-[10px] text-white/30">{hint}</p>
                  </div>
                  <Switch
                    checked={c[key]}
                    onCheckedChange={(v) => setCaption(key, v)}
                    data-testid={`caption-toggle-${key}`}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-white/70">Show Artist Name</p>
                  <p className="text-[10px] text-white/30">Burn artist name at the start of video</p>
                </div>
                <Switch
                  checked={c.showArtistName}
                  onCheckedChange={(v) => setCaption("showArtistName", v)}
                  data-testid="caption-toggle-artist"
                />
              </div>
              {c.showArtistName && (
                <TextInput
                  value={c.artistNameText}
                  placeholder="Artist name"
                  onChange={(v) => setCaption("artistNameText", v)}
                  testId="caption-artist-name"
                />
              )}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-white/70">Show Song Title</p>
                  <p className="text-[10px] text-white/30">Burn song title at the start of video</p>
                </div>
                <Switch
                  checked={c.showSongTitle}
                  onCheckedChange={(v) => setCaption("showSongTitle", v)}
                  data-testid="caption-toggle-title"
                />
              </div>
              {c.showSongTitle && (
                <TextInput
                  value={c.songTitleText}
                  placeholder="Song title"
                  onChange={(v) => setCaption("songTitleText", v)}
                  testId="caption-song-title"
                />
              )}
            </div>
          </div>
        </EditorCard>
      )}

      {/* ── Content by mode (lyrics / hook / best-bar text inputs) ── */}
      {c.mode === "auto" && (
        <EditorCard title="Full Lyrics" subtitle="Paste full lyrics — captions will be split automatically">
          <div className="space-y-3">
            <textarea
              value={c.lyricsText}
              onChange={(e) => setCaption("lyricsText", e.target.value)}
              placeholder={"Paste your lyrics here…\n\nEach line becomes one caption.\n[Section headers] are stripped automatically."}
              rows={10}
              data-testid="caption-full-lyrics-input"
              className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
            />
            <p className="text-[11px] text-white/30">
              Each non-empty line → one caption. Section labels like [Verse 1] are stripped. Timing is spread evenly; adjust manually after generating.
            </p>
          </div>
        </EditorCard>
      )}

      {c.mode === "hook" && (
        <EditorCard title="Hook Text" subtitle="Type the hook or chorus lines you want to show">
          <textarea
            value={c.hookText}
            onChange={(e) => setCaption("hookText", e.target.value)}
            placeholder={"Type your hook / chorus here…\nOne line per caption."}
            rows={5}
            data-testid="caption-hook-input"
            className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
          />
        </EditorCard>
      )}

      {c.mode === "best-bar" && (
        <EditorCard title="Best Bar" subtitle="The one bar you want burned over the entire video">
          <div className="space-y-3">
            <textarea
              value={c.bestBarText}
              onChange={(e) => setCaption("bestBarText", e.target.value)}
              placeholder="Type your best bar here…"
              rows={3}
              data-testid="caption-bestbar-input"
              className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
            />
            <p className="text-[11px] text-white/30">This line will be shown throughout the entire video.</p>
          </div>
        </EditorCard>
      )}

      {/* ── Action Buttons ── */}
      {hasCaptions && (
        <div className="flex flex-wrap gap-2.5">
          {canGenerate && (
            <Button
              size="sm"
              onClick={handleGenerate}
              data-testid="btn-generate-captions"
              className="gap-1.5"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Re-Generate
            </Button>
          )}
          {c.mode === "manual" && (
            <Button
              size="sm"
              variant="outline"
              onClick={addManualLine}
              data-testid="btn-add-caption-row"
              className="gap-1.5 border-white/15"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Caption
            </Button>
          )}
          {c.lines.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLinesVisible((v) => !v)}
                className="gap-1.5 border-white/15"
              >
                {linesVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {linesVisible ? "Hide" : "Show"} Lines ({c.lines.length})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClear}
                data-testid="btn-clear-captions"
                className="gap-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear All
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── Caption Lines table ── */}
      {(hasCaptions || c.lines.length > 0) && c.lines.length > 0 && linesVisible && (
        <EditorCard
          title={`Caption Lines — ${c.lines.length}`}
          subtitle="Edit timing and text for each line. Changes save automatically."
        >
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[70px_70px_1fr_auto] gap-2 px-1">
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">Start (s)</span>
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">End (s)</span>
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">Caption Text</span>
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">Del</span>
            </div>

            <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
              {c.lines.map((line, i) => (
                <div key={line.id} data-testid={`caption-row-${i}`} className="grid grid-cols-[70px_70px_1fr_auto] gap-2 items-center group">
                  <input
                    type="number"
                    value={line.startSec}
                    min={0}
                    step={0.1}
                    onChange={(e) => updateLine(line.id, { startSec: parseFloat(e.target.value) || 0 })}
                    data-testid={`caption-line-${i}-start`}
                    title={secToLabel(line.startSec)}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-primary/40 transition-colors [appearance:textfield]"
                  />
                  <input
                    type="number"
                    value={line.endSec}
                    min={0}
                    step={0.1}
                    onChange={(e) => updateLine(line.id, { endSec: parseFloat(e.target.value) || 0 })}
                    data-testid={`caption-line-${i}-end`}
                    title={line.endSec >= 999 ? "Full video" : secToLabel(line.endSec)}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-primary/40 transition-colors [appearance:textfield]"
                  />
                  <input
                    type="text"
                    value={line.text}
                    onChange={(e) => updateLine(line.id, { text: e.target.value })}
                    placeholder="Caption text…"
                    data-testid={`caption-line-${i}-text`}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => deleteLine(line.id)}
                    data-testid={`caption-line-${i}-delete`}
                    title="Delete caption"
                    className="h-7 w-7 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400/40 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-[10px] text-white/25">
                Start/End in seconds. End=999 means show for the full video duration.
              </p>
              {c.mode === "manual" && (
                <button
                  type="button"
                  onClick={addManualLine}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-primary/70 hover:text-primary transition-colors"
                  data-testid="btn-add-caption-inline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Caption
                </button>
              )}
            </div>

            <div className="pt-2 border-t border-white/[0.05]">
              <p className="text-[11px] text-white/35 flex items-center gap-1.5">
                <Pencil className="h-3 w-3 shrink-0" />
                Captions saved with your project automatically.
                {c.lines.length > 0 && !songDuration && (
                  <span className="text-white/25"> · Caption timing is estimated. Adjust times manually to sync with your song.</span>
                )}
              </p>
            </div>
          </div>
        </EditorCard>
      )}

      {/* ── Captions off notice ── */}
      {c.mode === "none" && c.lines.length === 0 && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <Captions className="h-4 w-4 text-white/20 shrink-0 mt-0.5" />
          <p className="text-xs text-white/35 leading-relaxed">
            No captions will be burned into the exported video. Click <strong className="text-white/50">Generate Captions From Lyrics</strong> above to get started, or select a caption mode to add text overlays manually.
          </p>
        </div>
      )}

    </div>
  );
}
