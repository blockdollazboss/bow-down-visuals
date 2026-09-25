import { useState, useEffect, useRef } from "react";
import { X, Loader2, Sparkles, ImageIcon, Check, Camera } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import {
  ARTIST_IMAGE_MODELS,
  ARTIST_IMAGE_RATIOS,
  SHOOT_POSES,
  SHOOT_OUTFITS,
  SHOOT_BACKGROUNDS,
  composePhotoShootBrief,
} from "./generate-artist-image";
import type { ArtistImageModel, ArtistImageRatio } from "./generate-artist-image";

export type ArtistImageModalMode = "generate" | "photoshoot";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen image — parent sets it as the reference photo. */
  onGenerated: (url: string, path: string | null) => void;
  initialPrompt: string;
  hasReferencePhoto: boolean;
  referenceImageUrl: string | null;
  userId: string | null;
  /** "photoshoot" locks identity (Turbo + face reference) and offers wardrobe/pose/backdrop presets. */
  mode?: ArtistImageModalMode;
}

interface RecentImage { name: string; url: string; path: string }

export function GenerateArtistImageModal({ open, onClose, onGenerated, initialPrompt, hasReferencePhoto, referenceImageUrl, userId, mode = "generate" }: Props) {
  const { getAccessToken, refreshProfile } = useAuth();
  const isShoot = mode === "photoshoot";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [model, setModel] = useState<ArtistImageModel>("gpt-image-2.5-sunburst");
  const [ratio, setRatio] = useState<ArtistImageRatio>("1080:1920");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentImage[]>([]);
  const [poseId, setPoseId] = useState(SHOOT_POSES[0].id);
  const [outfit, setOutfit] = useState(SHOOT_OUTFITS[0].text);
  const [background, setBackground] = useState(SHOOT_BACKGROUNDS[0].text);
  const [shootSaved, setShootSaved] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Refresh the pre-filled prompt + recents each time the modal opens. */
  useEffect(() => {
    if (open) {
      if (isShoot) {
        const p = SHOOT_POSES[0].id;
        const o = SHOOT_OUTFITS[0].text;
        const b = SHOOT_BACKGROUNDS[0].text;
        setPoseId(p);
        setOutfit(o);
        setBackground(b);
        setPrompt(composePhotoShootBrief(p, o, b));
      } else {
        setPrompt(initialPrompt);
      }
      setError(null);
      setProgress(null);
      setShootSaved(false);
      void loadRecent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode ]);

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
  /* Photo Shoot always runs Turbo with the face reference (identity lock).
     Portrait mode falls back to Gen4 when Turbo is picked without a photo. */
  const effectiveModel: ArtistImageModel = isShoot
    ? "gen4_image_turbo"
    : model === "gen4_image_turbo" && !hasReferencePhoto ? "gen4_image" : model;
  const effectiveCredits = ARTIST_IMAGE_MODELS.find((m) => m.id === effectiveModel)!.credits;

  const chipClass = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full border text-xs font-bold transition-colors ${
      active
        ? "border-primary/60 bg-primary/15 text-primary"
        : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
    } disabled:opacity-50`;

  /** Photo-shoot chips fill the brief; the brief textarea stays editable. */
  function applyShootChange(next: { poseId?: string; outfit?: string; background?: string }) {
    const p = next.poseId ?? poseId;
    const o = next.outfit ?? outfit;
    const b = next.background ?? background;
    setPoseId(p);
    setOutfit(o);
    setBackground(b);
    setPrompt(composePhotoShootBrief(p, o, b));
  }

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
            if (isShoot) setShootSaved(true);
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
    /* Photo shoots are identity-locked: no face reference, no shoot. */
    if (isShoot && !hasReferencePhoto) {
      setError("Save an Artist Photo first — photo shoots need your locked face to keep the same identity.");
      return;
    }
    setGenerating(true);
    setError(null);
    setProgress(null);
    setShootSaved(false);
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
        if (isShoot) setShootSaved(true);
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
            {isShoot
              ? (<><Camera className="h-5 w-5 text-primary" /> Artist Photo Shoot</>)
              : (<><Sparkles className="h-5 w-5 text-primary" /> Generate Artist Photo</>)}
          </h3>
          {!generating && (
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <p className="text-xs text-white/40 mb-5">
          {isShoot
            ? (hasReferencePhoto
              ? "Your saved Artist Photo locks the face — pick a wardrobe, pose, and backdrop for a brand-new look with the same identity."
              : "Photo shoots need a locked face. Save an Artist Photo first, then come back to change up the outfits.")
            : (hasReferencePhoto
              ? "Your uploaded photo is used as a face reference, so the generated look keeps your artist's identity."
              : "No photo uploaded yet — describe the look and the AI will create it from scratch.")}
        </p>

        {isShoot && !hasReferencePhoto && (
          <p className="mb-5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3.5 py-2.5">
            No Artist Photo saved yet. Upload or generate one first — the shoot keeps that exact face while changing the outfit.
          </p>
        )}

        {/* Photo Shoot: wardrobe / pose / backdrop presets */}
        {isShoot && (
          <>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Wardrobe</p>
            <div className="flex gap-2 flex-wrap mb-2">
              {SHOOT_OUTFITS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  disabled={generating}
                  onClick={() => applyShootChange({ outfit: o.text })}
                  className={chipClass(outfit === o.text)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <input
              value={outfit}
              onChange={(e) => applyShootChange({ outfit: e.target.value })}
              disabled={generating}
              placeholder="Or describe a custom outfit…"
              className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 disabled:opacity-50"
            />

            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mt-4 mb-2">Pose</p>
            <div className="flex gap-2 flex-wrap">
              {SHOOT_POSES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={generating}
                  onClick={() => applyShootChange({ poseId: p.id })}
                  className={chipClass(poseId === p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mt-4 mb-2">Backdrop</p>
            <div className="flex gap-2 flex-wrap mb-2">
              {SHOOT_BACKGROUNDS.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  disabled={generating}
                  onClick={() => applyShootChange({ background: b.text })}
                  className={chipClass(background === b.text)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <input
              value={background}
              onChange={(e) => applyShootChange({ background: e.target.value })}
              disabled={generating}
              placeholder="Or describe a custom backdrop…"
              className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 disabled:opacity-50"
            />
          </>
        )}

        {/* Prompt */}
        <div className={isShoot ? "mt-4" : undefined}>
        <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider">{isShoot ? "Shoot brief" : "Look description"}</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={generating}
          rows={isShoot ? 3 : 4}
          className="mt-1.5 w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 disabled:opacity-50"
          placeholder={isShoot ? "Your shoot brief — the chips above fill this in, edit it freely…" : "e.g. cinematic hip-hop artist portrait, gold chains, dark studio lighting…"}
        />
        </div>

        {/* Model — locked to Turbo (identity lock) in Photo Shoot mode */}
        {isShoot ? (
          <p className="mt-4 text-xs text-white/50 flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-3.5 py-2.5">
            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
            Identity lock on — your Artist Photo is the face reference. Turbo · 2 credits per shoot.
          </p>
        ) : (
          <>
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
          </>
        )}

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
            disabled={generating || !prompt.trim() || (isShoot && !hasReferencePhoto)}
            data-testid="btn-generate-artist-image"
            title={isShoot && !hasReferencePhoto ? "Save an Artist Photo first" : undefined}
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
        {isShoot && shootSaved && !generating && (
          <p className="mt-3 text-xs text-primary bg-primary/10 border border-primary/20 rounded-xl px-3.5 py-2.5">
            Look saved to your shoot results below — roll another outfit!
          </p>
        )}
        {generating && <p className="mt-2 text-[11px] text-white/30">Usually takes 30–90 seconds. You can close this and come back — use the recent list below.</p>}

        {/* Recent generations */}
        {recent.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">
              {isShoot ? "Photo shoot results" : "Recent generations"}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {recent.map((img) => isShoot ? (
                <div
                  key={img.path}
                  className="relative aspect-[3/4] rounded-lg overflow-hidden border border-white/10"
                  title="Photo shoot result"
                >
                  <img src={img.url} alt="Photo shoot result" className="h-full w-full object-cover" loading="lazy" />
                </div>
              ) : (
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
