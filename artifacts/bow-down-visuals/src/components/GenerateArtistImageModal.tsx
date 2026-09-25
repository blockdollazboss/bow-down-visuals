import { useState, useEffect, useRef } from "react";
import { X, Loader2, Sparkles, ImageIcon, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import {
  ARTIST_IMAGE_MODELS,
  ARTIST_IMAGE_RATIOS,
} from "./generate-artist-image";
import type { ArtistImageModel, ArtistImageRatio } from "./generate-artist-image";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen image — parent sets it as the reference photo. */
  onGenerated: (url: string, path: string | null) => void;
  initialPrompt: string;
  hasReferencePhoto: boolean;
  referenceImageUrl: string | null;
  userId: string | null;
}

interface RecentImage { name: string; url: string; path: string }

export function GenerateArtistImageModal({ open, onClose, onGenerated, initialPrompt, hasReferencePhoto, referenceImageUrl, userId }: Props) {
  const { getAccessToken, refreshProfile } = useAuth();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [model, setModel] = useState<ArtistImageModel>("gpt-image-2.5-sunburst");
  const [ratio, setRatio] = useState<ArtistImageRatio>("1080:1920");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentImage[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Refresh the pre-filled prompt + recents each time the modal opens. */
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setError(null);
      setProgress(null);
      void loadRecent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => () => stopPolling(), []);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function loadRecent() {
    if (!userId) return;
    try {
      const sb = getSupabase();
      const { data, error: listErr } = await sb.storage
        .from("artist-references")
        .list(`${userId}/generated`, { limit: 12, sortBy: { column: "created_at", order: "desc" } });
      if (listErr || !data) return;
      setRecent(
        data
          .filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
          .map((f) => {
            const p = `${userId}/generated/${f.name}`;
            const { data: { publicUrl } } = sb.storage.from("artist-references").getPublicUrl(p);
            return { name: f.name, url: publicUrl, path: p };
          }),
      );
    } catch { /* best-effort */ }
  }

  const selectedModel = ARTIST_IMAGE_MODELS.find((m) => m.id === model)!;
  /* Turbo requires a reference photo (API constraint) — fall back to Gen4. */
  const effectiveModel: ArtistImageModel = model === "gen4_image_turbo" && !hasReferencePhoto ? "gen4_image" : model;
  const effectiveCredits = ARTIST_IMAGE_MODELS.find((m) => m.id === effectiveModel)!.credits;

  function startPolling(taskId: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/generate-artist-image/${taskId}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        const data = await res.json() as { status: string; url?: string | null; path?: string | null; progress?: number; error?: string };
        if (data.status === "succeeded") {
          stopPolling();
          setGenerating(false);
          if (data.url) {
            refreshProfile();
            void loadRecent();
            onGenerated(data.url, data.path ?? null);
          } else {
            setError("Generation finished but returned no image. Credits were not charged.");
          }
        } else if (data.status === "failed" || data.status === "cancelled") {
          stopPolling();
          setGenerating(false);
          setError(data.error ?? "Image generation failed. Credits were not charged.");
        } else {
          setProgress(typeof data.progress === "number" ? data.progress : null);
        }
      } catch {
        stopPolling();
        setGenerating(false);
        setError("Network error while polling. Credits were not charged.");
      }
    }, 5000);
  }

  async function startGeneration() {
    if (!prompt.trim()) { setError("Describe the look first."); return; }
    setGenerating(true);
    setError(null);
    setProgress(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generate-artist-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          promptText: prompt.trim(),
          model: effectiveModel,
          ratio,
          referenceImageUrl: hasReferencePhoto ? referenceImageUrl : null,
        }),
      });
      const data = await res.json() as { taskId?: string; status?: string; url?: string | null; path?: string | null; error?: string; message?: string };
      if (!res.ok || !data.taskId) {
        throw new Error(data.message ?? data.error ?? `Image API error (HTTP ${res.status})`);
      }
      /* GPT Image 2.5 returns synchronously — no polling needed. */
      if (data.status === "succeeded" && data.url) {
        setGenerating(false);
        refreshProfile();
        void loadRecent();
        onGenerated(data.url, data.path ?? null);
        return;
      }
      startPolling(data.taskId);
    } catch (e) {
      setGenerating(false);
      const msg = e instanceof Error ? e.message : "Failed to start generation";
      setError(msg === "out_of_credits" ? "Not enough credits. Please buy more credits to continue." : msg);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={generating ? undefined : onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0c0e] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-black text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Generate Artist Photo
          </h3>
          {!generating && (
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <p className="text-xs text-white/40 mb-5">
          {hasReferencePhoto
            ? "Your uploaded photo is used as a face reference, so the generated look keeps your artist's identity."
            : "No photo uploaded yet — describe the look and the AI will create it from scratch."}
        </p>

        {/* Prompt */}
        <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Look description</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={generating}
          rows={4}
          className="mt-1.5 w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 disabled:opacity-50"
          placeholder="e.g. cinematic hip-hop artist portrait, gold chains, dark studio lighting…"
        />

        {/* Model */}
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mt-4 mb-2">Model</p>
        <div className="flex gap-2 flex-wrap">
          {ARTIST_IMAGE_MODELS.map((m) => {
            const disabled = m.id === "gen4_image_turbo" && !hasReferencePhoto;
            const active = effectiveModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled || generating}
                onClick={() => setModel(m.id)}
                title={disabled ? "Turbo needs an uploaded photo as a face reference" : m.hint}
                data-testid={`artist-model-${m.id}`}
                className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""} disabled:opacity-50`}
              >
                {m.label} · {m.credits} credits
                <span className="block text-[10px] font-medium opacity-70">{disabled ? "needs photo" : m.hint}</span>
              </button>
            );
          })}
        </div>

        {/* Ratio */}
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mt-4 mb-2">Shape</p>
        <div className="flex gap-2">
          {ARTIST_IMAGE_RATIOS.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={generating}
              onClick={() => setRatio(r.id)}
              data-testid={`artist-ratio-${r.id}`}
              className={`px-3.5 py-1.5 rounded-full border text-xs font-bold transition-colors ${
                ratio === r.id
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
              } disabled:opacity-50`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={startGeneration}
            disabled={generating || !prompt.trim()}
            data-testid="btn-generate-artist-image"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-primary text-black hover:brightness-110 transition-all disabled:opacity-50 gold-glow"
          >
            {generating ? (<><Loader2 className="h-4 w-4 animate-spin" /> Generating…{progress !== null ? ` ${Math.round(progress * 100)}%` : ""}</>) : (<><Sparkles className="h-4 w-4" /> Generate · {effectiveCredits} credits</>)}
          </button>
          {!generating && (
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white/50 hover:text-white border border-white/10 bg-white/5 transition-colors">
              Cancel
            </button>
          )}
        </div>
        {generating && <p className="mt-2 text-[11px] text-white/30">Usually takes 30–90 seconds. You can close this and come back — use the recent list below.</p>}

        {/* Recent generations */}
        {recent.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Recent generations</p>
            <div className="grid grid-cols-4 gap-2">
              {recent.map((img) => (
                <button
                  key={img.path}
                  type="button"
                  disabled={generating}
                  onClick={() => { refreshProfile(); onGenerated(img.url, img.path); }}
                  className="group relative aspect-[3/4] rounded-lg overflow-hidden border border-white/10 hover:border-primary/50 transition-colors disabled:opacity-50"
                  title="Use as reference photo"
                >
                  <img src={img.url} alt="Generated artist look" className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Check className="h-5 w-5 text-primary" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {recent.length === 0 && !generating && (
          <div className="mt-6 flex items-center gap-2 text-white/25 text-xs">
            <ImageIcon className="h-4 w-4" /> Your generations will appear here for quick re-use.
          </div>
        )}
      </div>
    </div>
  );
}
