import { useCallback, useEffect, useRef, useState } from "react";
import {
  Palette, Upload, Loader2, CheckCircle2, XCircle, Trash2, Play,
  Share2, Copy, Scissors, Film, Download, Sparkles,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── LUT Import (.cube / .3dl) — CapCut color parity ─────────────────────
   Docks inside the Video Editor Color panel (rendered from EffectsSection).
   House presets (teal-orange, moody, vibrant, noir) work with zero upload;
   users can upload .cube/.3dl files, save them to "My LUTs", preview free,
   and burn the LUT into a scene clip for 150 Visual Bucs via /api/apply-lut. */

const APPLY_COST = 150;

interface HousePreset {
  id: string;
  name: string;
  description: string;
  file: string;
  swatches: string[];
}

interface SavedLut {
  id: string;
  name: string;
  format: string;
  size: number | null;
  url: string | null;
  createdAt: string;
}

type LutSource =
  | { kind: "preset"; preset: HousePreset }
  | { kind: "mylut"; lut: SavedLut }
  | { kind: "upload"; file: File; validated: { title: string; size: number; format: string } };

interface ApplyResult {
  url: string;
  storageRef: string;
  lut: string;
  creditsRemaining: number;
}

export function LutImportSection({
  scenes,
  onReplaceClipVideo,
  onGoToCaptions,
  onGoToExport,
}: {
  scenes: SceneData[];
  /** Replaces a scene's clip URL with the LUT-graded render. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
  /** Handoff: jump to the Captions tab. */
  onGoToCaptions?: () => void;
  /** Handoff: jump to the Export tab with the graded clip queued for multi-ratio export. */
  onGoToExport?: (videoUrl?: string) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [presets, setPresets] = useState<HousePreset[]>([]);
  const [myLuts, setMyLuts] = useState<SavedLut[]>([]);
  const [source, setSource] = useState<LutSource | null>(null);
  const [sceneId, setSceneId] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [using, setUsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const clips = scenes.filter((s) => !!s.demoClipUrl);
  const activeScene = clips.find((s) => s.id === sceneId) ?? clips[0] ?? null;

  useEffect(() => {
    if (!sceneId && clips[0]) setSceneId(clips[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length]);

  /* ── Load presets + saved LUTs (free) ── */
  const loadAll = useCallback(async () => {
    try {
      const pr = await confirmedFetch("/api/lut/presets", { skipConfirm: true });
      if (pr?.ok) {
        const data = (await pr.json()) as { presets: HousePreset[] };
        setPresets(data.presets ?? []);
      }
    } catch { /* non-fatal */ }
    try {
      const mr = await confirmedFetch("/api/lut/my", { skipConfirm: true });
      if (mr?.ok) {
        const data = (await mr.json()) as { luts: SavedLut[] };
        setMyLuts(data.luts ?? []);
      }
    } catch { /* non-fatal */ }
  }, [confirmedFetch]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* ── Upload + validate a LUT file (free) ── */
  async function handleFilePicked(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setValidating(true);
    try {
      const form = new FormData();
      form.append("lut", file);
      const res = await confirmedFetch("/api/lut/validate", {
        method: "POST",
        body: form,
        skipConfirm: true,
      });
      const data = (await res!.json()) as { valid: boolean; error?: string; title?: string; size?: number; format?: string };
      if (!res!.ok || !data.valid) {
        setError(data.error ?? "That file couldn't be read as a LUT.");
        return;
      }
      setSource({ kind: "upload", file, validated: { title: data.title ?? file.name, size: data.size ?? 0, format: data.format ?? "cube" } });
      setPreviewUrl(null);
      toast({ title: "LUT looks good", description: `"${data.title}" · ${data.size}³ lattice — preview it free.` });
    } catch {
      setError("Couldn't validate that file. Try another .cube or .3dl.");
    } finally {
      setValidating(false);
    }
  }

  /* ── Save an uploaded LUT to "My LUTs" (free) ── */
  async function handleSaveUpload() {
    if (source?.kind !== "upload") return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("lut", source.file);
      const res = await confirmedFetch("/api/lut/upload", { method: "POST", body: form, skipConfirm: true });
      const data = (await res!.json()) as { id?: string; name?: string; error?: string };
      if (!res!.ok) {
        setError(data.error ?? "Couldn't save that LUT.");
        return;
      }
      toast({ title: "Saved to My LUTs", description: `"${data.name}" is now reusable across projects.` });
      await loadAll();
      const saved = (await (await confirmedFetch("/api/lut/my", { skipConfirm: true }))!.json()) as { luts: SavedLut[] };
      const row = saved.luts.find((l) => l.id === data.id);
      if (row) setSource({ kind: "mylut", lut: row });
    } catch {
      setError("Couldn't save that LUT.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSaved(id: string) {
    try {
      const res = await confirmedFetch(`/api/lut/my/${id}`, { method: "DELETE", skipConfirm: true });
      if (res?.ok) {
        setMyLuts((prev) => prev.filter((l) => l.id !== id));
        if (source?.kind === "mylut" && source.lut.id === id) setSource(null);
        toast({ title: "LUT deleted" });
      }
    } catch { /* non-fatal */ }
  }

  /* ── Build the multipart payload for preview/apply ── */
  function buildForm(): FormData | null {
    if (!source || !activeScene?.demoClipUrl) return null;
    const form = new FormData();
    form.append("videoUrl", activeScene.demoClipUrl);
    if (source.kind === "preset") form.append("presetId", source.preset.id);
    else if (source.kind === "mylut") form.append("lutId", source.lut.id);
    else form.append("lut", source.file);
    return form;
  }

  /* ── Free thumbnail preview ── */
  async function handlePreview() {
    const form = buildForm();
    if (!form) return;
    setPreviewing(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/lut/preview", { method: "POST", body: form, skipConfirm: true });
      if (!res!.ok) {
        const data = (await res!.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Preview failed.");
        return;
      }
      const blob = await res!.blob();
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch {
      setError("Preview failed — check the clip and try again.");
    } finally {
      setPreviewing(false);
    }
  }

  /* ── Paid apply (150 Visual Bucs) ── */
  async function handleApply() {
    const form = buildForm();
    if (!form) return;
    setApplying(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/apply-lut", {
        method: "POST",
        body: form,
        overrideCost: APPLY_COST,
        overrideFeature: "LUT Apply",
      });
      if (res === null) return; // user cancelled the credit confirm
      const data = (await res.json().catch(() => ({}))) as Partial<ApplyResult> & { error?: string; message?: string };
      if (!res.ok || !data.url) {
        setError(data.message ?? data.error ?? "LUT apply failed — no Visual Bucs were spent.");
        return;
      }
      setResult({ url: data.url!, storageRef: data.storageRef ?? "", lut: data.lut ?? "LUT", creditsRemaining: data.creditsRemaining ?? 0 });
      toast({ title: "LUT burned in", description: `${data.lut} applied — ${APPLY_COST} Visual Bucs.` });
    } catch {
      setError("LUT apply failed — no Visual Bucs were spent.");
    } finally {
      setApplying(false);
    }
  }

  /* ── Handoff: use the graded clip in the editor ── */
  function handleUseInEditor() {
    if (!result || !activeScene || !onReplaceClipVideo) return;
    setUsing(true);
    try {
      onReplaceClipVideo(activeScene.id, result.url);
      toast({ title: "In the timeline", description: `Scene ${activeScene.sceneNumber} now plays the "${result.lut}" grade.` });
    } finally {
      setUsing(false);
    }
  }

  /* ── Virality: one-click share of the graded output ── */
  async function handleNativeShare() {
    if (!result) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Graded with Bow Down Visuals",
          text: `Color graded with the "${result.lut}" LUT on Bow Down Visuals`,
          url: result.url,
        });
      } else {
        await navigator.clipboard.writeText(result.url);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch { /* user cancelled */ }
  }

  function socialShareHref(network: "x" | "facebook" | "whatsapp" | "telegram") {
    if (!result) return "#";
    const url = encodeURIComponent(result.url);
    const text = encodeURIComponent(`Color graded with the "${result.lut}" LUT on Bow Down Visuals`);
    switch (network) {
      case "x": return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
      case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
      case "whatsapp": return `https://wa.me/?text=${text}%20${url}`;
      case "telegram": return `https://t.me/share/url?url=${url}&text=${text}`;
    }
  }

  const sourceLabel =
    source?.kind === "preset" ? source.preset.name
    : source?.kind === "mylut" ? source.lut.name
    : source?.kind === "upload" ? source.validated.title
    : null;

  if (clips.length === 0) {
    return (
      <EditorCard title="LUT Import" subtitle=".cube / .3dl — CapCut-style color, zero upload needed" icon={<Palette className="h-4 w-4" />}>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center">
          <Film className="h-6 w-6 mx-auto text-white/25 mb-2" />
          <p className="text-sm font-semibold text-white/80">No clips on the timeline yet</p>
          <p className="text-xs text-white/40 mt-1">Add a clip to a scene first, then grade it with a LUT.</p>
        </div>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      title="LUT Import"
      subtitle=".cube / .3dl — CapCut-style color, zero upload needed"
      icon={<Palette className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-black uppercase tracking-wider text-[#C9A84C] border border-[#C9A84C]/40 bg-[#C9A84C]/10 rounded-full px-2 py-0.5">
          {APPLY_COST} VB / apply · preview free
        </span>
      }
    >
      <div className="space-y-4">
        {/* ── Scene picker ── */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">Clip to grade</p>
          <div className="flex flex-wrap gap-2">
            {clips.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSceneId(s.id); setPreviewUrl(null); setResult(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  s.id === activeScene?.id
                    ? "bg-[#C9A84C] text-black border-[#C9A84C]"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                Scene {s.sceneNumber}
              </button>
            ))}
          </div>
        </div>

        {/* ── House presets ── */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">House LUTs — no upload needed</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {presets.map((p) => {
              const active = source?.kind === "preset" && source.preset.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { setSource({ kind: "preset", preset: p }); setPreviewUrl(null); setResult(null); setError(null); }}
                  className={`rounded-xl border p-2.5 text-left transition-all ${
                    active ? "border-[#C9A84C] bg-[#C9A84C]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                  title={p.description}
                >
                  <div className="flex h-6 rounded-md overflow-hidden mb-1.5 border border-black/40">
                    {p.swatches.map((c) => (
                      <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <p className="text-xs font-black text-white">{p.name}</p>
                  <p className="text-[10px] text-white/40 leading-tight mt-0.5 line-clamp-2">{p.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Upload your own ── */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">Or import your own</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".cube,.3dl"
              className="hidden"
              onChange={(e) => { void handleFilePicked(e.target.files?.[0]); e.target.value = ""; }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={validating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-50 transition-colors"
            >
              {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {validating ? "Validating…" : "Upload .cube / .3dl"}
            </button>
            {source?.kind === "upload" && (
              <button
                onClick={() => void handleSaveUpload()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-[#C9A84C]/40 text-[#C9A84C] hover:bg-[#C9A84C]/10 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : "Save to My LUTs"}
              </button>
            )}
            {source?.kind === "upload" && (
              <span className="text-[11px] text-white/50">
                "{source.validated.title}" · {source.validated.format.toUpperCase()} · {source.validated.size}³
              </span>
            )}
          </div>
        </div>

        {/* ── My LUTs ── */}
        {myLuts.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">My LUTs</p>
            <div className="flex flex-wrap gap-2">
              {myLuts.map((l) => {
                const active = source?.kind === "mylut" && source.lut.id === l.id;
                return (
                  <div
                    key={l.id}
                    className={`group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      active ? "border-[#C9A84C] bg-[#C9A84C]/10 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <button
                      onClick={() => { setSource({ kind: "mylut", lut: l }); setPreviewUrl(null); setResult(null); setError(null); }}
                      className="flex items-center gap-1.5"
                      title={`${l.format.toUpperCase()} · ${l.size}³ lattice`}
                    >
                      <Sparkles className="h-3 w-3 text-[#C9A84C]" />
                      {l.name}
                    </button>
                    <button
                      onClick={() => void handleDeleteSaved(l.id)}
                      className="p-1 rounded text-white/25 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete this LUT"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
        )}

        {/* ── Preview + Apply ── */}
        {source && (
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                onClick={() => void handlePreview()}
                disabled={previewing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black border border-white/15 text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
              >
                {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {previewing ? "Rendering…" : "Preview free"}
              </button>
              <button
                onClick={() => void handleApply()}
                disabled={applying}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-50 transition-colors"
              >
                {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
                {applying ? "Burning LUT…" : `Apply "${sourceLabel}" · ${APPLY_COST} VB`}
              </button>
            </div>
            {previewUrl && (
              <div className="rounded-lg overflow-hidden border border-white/10">
                <img src={previewUrl} alt={`LUT preview — ${sourceLabel}`} className="w-full max-h-56 object-contain bg-black" />
                <p className="text-[10px] text-white/40 px-2 py-1.5 bg-black/60">Free preview — middle frame with "{sourceLabel}" applied</p>
              </div>
            )}
          </div>
        )}

        {/* ── Graded result + handoffs ── */}
        {result && (
          <div className="rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/[0.05] p-3 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#C9A84C]" />
              <p className="text-sm font-black text-white">Graded with "{result.lut}"</p>
            </div>
            <video src={result.url} controls playsInline className="w-full rounded-lg border border-white/10 max-h-64 bg-black" />
            <div className="flex flex-wrap gap-2">
              {onReplaceClipVideo && activeScene && (
              <button
                onClick={handleUseInEditor}
                disabled={using}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-50 transition-colors"
              >
                {using ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
                {using ? "Attaching…" : "Use in editor"}
              </button>
              )}
              {onGoToCaptions && (
                <button
                  onClick={onGoToCaptions}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
                >
                  Add captions
                </button>
              )}
              {onGoToExport && (
                <button
                  onClick={() => onGoToExport(result.url)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
                >
                  Multi-ratio export
                </button>
              )}
              <a
                href={result.url}
                download={`lut-graded-${result.lut.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
            {/* Virality: one-click share */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.06]">
              <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1">
                <Share2 className="h-3 w-3" /> Share
              </span>
              <button
                onClick={() => void handleNativeShare()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 text-white hover:bg-white/15 transition-colors"
              >
                {shared ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <Share2 className="h-3.5 w-3.5" />}
                {shared ? "Link copied" : "Share"}
              </button>
              <button
                onClick={async () => { await navigator.clipboard.writeText(result.url); setShared(true); setTimeout(() => setShared(false), 2000); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 text-white hover:bg-white/15 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" /> Copy link
              </button>
              {(["x", "facebook", "whatsapp", "telegram"] as const).map((n) => (
                <a
                  key={n}
                  href={socialShareHref(n)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 text-white hover:bg-white/15 transition-colors capitalize"
                >
                  {n === "x" ? "X" : n}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
