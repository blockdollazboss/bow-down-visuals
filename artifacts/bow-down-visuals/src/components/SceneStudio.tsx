import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera, Clock, MapPin, Zap, Film, Loader2,
  Sparkles, Video, CheckCircle2, AlertCircle, AlertTriangle, X,
  ChevronDown, ChevronUp, RotateCcw,
  ArrowUp, ArrowDown, Trash2, Plus, Save, Eye,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useCreditConfirm } from "@/contexts/CreditConfirmContext";
import type { SceneData } from "@/lib/scene-parser";
import { getPreviousClipUrl } from "@/lib/scene-chaining";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { OutOfCredits } from "@/components/OutOfCredits";
import { vaultToPayload, requestImprovedPrompt, sceneSeedPrompt, isWeakPrompt, ImprovePromptError, type ImprovePromptErrorType } from "@/lib/prompt-improve";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

/* ─── Section color badges ──────────────────────────────────── */
const SECTION_COLORS: Record<string, string> = {
  intro:  "bg-white/[0.12] text-zinc-200 border-white/20",
  verse:  "bg-blue-500/20 text-blue-300 border-blue-500/30",
  hook:   "bg-primary/20 text-primary border-primary/30",
  chorus: "bg-primary/20 text-primary border-primary/30",
  bridge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  outro:  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  pre:    "bg-orange-500/20 text-orange-300 border-orange-500/30",
  break:  "bg-green-500/20 text-green-300 border-green-500/30",
};

function sectionColor(section: string): string {
  const lower = section.toLowerCase();
  for (const key of Object.keys(SECTION_COLORS)) {
    if (lower.includes(key)) return SECTION_COLORS[key]!;
  }
  return "bg-white/10 text-white/60 border-white/20";
}

/* Does the vault have a usable HTTPS reference photo for image-to-video? */
function hasReferencePhoto(vault: ArtistVault): boolean {
  const url = vault.reference_image_url?.trim();
  return !!url && /^https:\/\//i.test(url);
}

/** Details captured for an "Improve Prompt" failure so the badge can explain what happened. */
interface ImproveFailure {
  message: string;
  errorType: ImprovePromptErrorType;
}

/** Short label + color treatment per failure type, so users can tell at a glance whether retrying will help. */
const IMPROVE_FAILURE_STYLE: Record<ImprovePromptErrorType, { label: string; className: string }> = {
  rate_limit:     { label: "Rate Limited",   className: "text-amber-400" },
  content_policy: { label: "Content Policy", className: "text-orange-400" },
  invalid_prompt: { label: "Invalid Prompt", className: "text-red-400" },
  server_error:   { label: "Server Error",   className: "text-red-400" },
  unknown:        { label: "Improve Failed", className: "text-red-400" },
};

/* ─── Build artist consistency prefix for Runway prompt ──────
   When a reference photo will be sent to Runway (image-to-video), the photo
   anchors the artist's face/look, so we use a short identity note and let the
   scene description dominate (gen4.5 image-to-video caps promptText at ~1000
   chars). Without a photo we fall back to the full text-only consistency block. */
function buildConsistencyPrefix(vault: ArtistVault, outfitLabel?: string | null): string {
  if (hasReferencePhoto(vault)) {
    const parts: string[] = [
      `SAME ARTIST AS REFERENCE PHOTO: ${vault.artist_name}. Keep the exact same face, skin tone, hairstyle and identity from the reference image. Do NOT create a new person.`,
    ];
    if (outfitLabel) parts.push(`Outfit: ${outfitLabel} — dress the artist in this exact outfit.`);
    else if (vault.clothing_style) parts.push(`Clothing: ${vault.clothing_style}`);
    if (vault.do_not_change_rules) parts.push(`Do Not Change: ${vault.do_not_change_rules}`);
    parts.push("---");
    return parts.join("\n");
  }

  const parts: string[] = [
    `CHARACTER CONSISTENCY — ACTIVE ARTIST: ${vault.artist_name}`,
    `Use ${vault.artist_name} as the main character. Do NOT create a random new person.`,
    `Keep the exact same face, skin tone, hairstyle, body type, tattoos, jewelry, clothing style, and overall identity throughout.`,
  ];
  if (vault.personality)         parts.push(`Description: ${vault.personality}`);
  if (vault.visual_style)        parts.push(`Visual Style: ${vault.visual_style}`);
  if (vault.hair)                parts.push(`Hair: ${vault.hair}`);
  if (vault.tattoos)             parts.push(`Tattoos: ${vault.tattoos}`);
  if (vault.jewelry)             parts.push(`Jewelry: ${vault.jewelry}`);
  if (vault.clothing_style)      parts.push(`Clothing: ${vault.clothing_style}`);
  if (vault.brand_colors)        parts.push(`Brand Colors: ${vault.brand_colors}`);
  if (vault.consistency_prompt)  parts.push(`Consistency Guide: ${vault.consistency_prompt}`);
  if (vault.do_not_change_rules) parts.push(`⛔ Do Not Change: ${vault.do_not_change_rules}`);
  parts.push("---");
  return parts.join("\n");
}

/* Does the given URL look like a usable, already-generated clip we can chain from? */
function hasUsableClip(url: string | null | undefined): boolean {
  return !!url && /^https:\/\//i.test(url);
}

/* Wardrobe outfit as returned by GET /api/artist-vaults/:vaultId/outfits */
interface WardrobeOutfit { id: string; label: string; image_url: string; is_default: boolean; }

/* ─── Inline Runway clip generator ─────────────────────────── */export interface RunwayGeneratorProps {
  scene: SceneData;
  onUpdate: (patch: Partial<SceneData>) => void;
  artistVault?: ArtistVault | null;
  projectId?: string | null;
  /** Increment to auto-trigger generation (skips confirm) for "Create All" */
  createAllTrigger?: number;
  /** Final clip URL of the immediately-preceding scene, if it has one.
   *  When present, its last frame is used as the image reference so wardrobe/
   *  lighting/pose flow naturally between scenes instead of resetting to the
   *  static vault photo. */
  previousClipUrl?: string | null;
}

export function InlineRunwayGenerator({ scene, onUpdate, artistVault, projectId, createAllTrigger, previousClipUrl }: RunwayGeneratorProps) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();

  const [isGenerating, setIsGenerating] = useState(false);
  const [taskId, setTaskId]             = useState<string | null>(null);
  const [progress, setProgress]         = useState<number | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [showFinalPrompt, setShowFinalPrompt] = useState(false);
  /* Video model selection — Seedance 2.5 is the premium option with longer
     scenes and higher resolution, priced per second. */
  const [clipModel, setClipModel]     = useState<"gen4.5" | "seedance2_5">("gen4.5");
  const [clipDuration, setClipDuration] = useState(5);
  const [clipRes, setClipRes]         = useState<"720p" | "1080p">("720p");
  const [referenceSource, setReferenceSource] = useState<"previous_scene" | "vault_photo" | "none" | null>(
    scene.referenceSource ?? null,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Wardrobe: the artist's outfits, picked per scene. The picked outfit's
        image becomes the visual reference for generation (instead of the base
        vault photo), so the character wears that outfit in the clip. ── */
  const [outfits, setOutfits] = useState<WardrobeOutfit[]>([]);
  const [pickedOutfitId, setPickedOutfitId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOutfits([]);
    setPickedOutfitId(null);
    const vaultId = artistVault?.id;
    if (!vaultId) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/artist-vaults/${vaultId}/outfits`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const list: WardrobeOutfit[] = data.outfits ?? [];
        setOutfits(list);
        const def = list.find((o) => o.is_default);
        if (def) setPickedOutfitId(def.id);
      } catch {
        /* wardrobe is optional — generation works without it */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistVault?.id]);

  const pickedOutfit = outfits.find((o) => o.id === pickedOutfitId) ?? null;
  const outfitRefUrl = pickedOutfit && /^https:\/\//i.test(pickedOutfit.image_url)
    ? pickedOutfit.image_url
    : null;

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; });

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  useEffect(() => () => stopPolling(), []);

  /* Auto-trigger from "Create All Video Clips" — skip confirm step */
  const hasClipForTrigger = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
  useEffect(() => {
    if (!createAllTrigger) return;
    if (hasClipForTrigger || isGenerating || outOfCredits) return;
    void startGeneration({ skipConfirm: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAllTrigger]);

  /* Build the final prompt that will actually be sent to Runway */
  function buildFinalPrompt(): string {
    const basePrompt = (scene.aiVideoPrompt ?? "").trim() ||
      [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
        .filter(Boolean).join(", ") ||
      "cinematic music video scene, dramatic lighting, luxury aesthetic";

    if (artistVault) {
      const prefix = buildConsistencyPrefix(artistVault, pickedOutfit?.label ?? null);
      return `${prefix}\n${basePrompt}`;
    }
    return basePrompt;
  }

  async function autoSaveClip(clipUrl: string, jobId: string, finalPrompt: string) {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generated-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectId:   projectId ?? null,
          sceneId:     scene.id ?? null,
          title:       scene.section || scene.timestamp || "Scene Clip",
          prompt:      scene.aiVideoPrompt || null,
          finalPrompt,
          runwayJobId: jobId,
          videoUrl:    clipUrl,
          status:      "completed",
        }),
      });

      if (res.ok) {
        /* Clip saved — refresh credits display so dashboard shows the deduction */
        refreshProfile();
      } else {
        const body = await res.json().catch(() => ({})) as { creditMessage?: string };
        const creditMsg = body.creditMessage ?? "Clip generated but saving failed.";
        toast({ title: "Save failed", description: creditMsg, variant: "destructive" });
        refreshProfile(); /* refresh regardless so credits are up to date */
      }
    } catch {
      /* best-effort — clip is already in the UI */
    }
  }

  function startPolling(id: string, finalPrompt: string, usedReferenceSource: "previous_scene" | "vault_photo" | "none") {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/generate-runway-clip/${id}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        const data = await res.json() as { status: string; url?: string; progress?: number; error?: string };
        if (data.status === "succeeded" && data.url) {
          stopPolling();
          setIsGenerating(false);
          setTaskId(null);
          /* Auto-save clip to DB immediately — before any UI update */
          void autoSaveClip(data.url, id, finalPrompt);
          onUpdateRef.current({
            demoClipUrl: data.url,
            provider: "Runway",
            generationStatus: "completed",
            promptUsed: finalPrompt,
            generatedAt: new Date().toISOString(),
            referenceSource: usedReferenceSource,
          });
          toast({ title: "Runway clip ready!", description: "Your clip has been generated and saved." });
        } else if (data.status === "failed" || data.status === "cancelled") {
          stopPolling();
          setIsGenerating(false);
          setError(data.error ?? "Runway generation failed");
          onUpdateRef.current({ generationStatus: "failed" });
        } else {
          setProgress(typeof data.progress === "number" ? data.progress : null);
        }
      } catch {
        stopPolling();
        setIsGenerating(false);
        setError("Network error while polling Runway");
        onUpdateRef.current({ generationStatus: "failed" });
      }
    }, 5000);
  }

  async function startGeneration(opts?: { skipConfirm?: boolean }) {
    const finalPrompt = buildFinalPrompt();
    const chaining = hasUsableClip(previousClipUrl);

    setIsGenerating(true);
    setError(null);
    setProgress(null);
    /* Optimistic guess for the "generating…" badge — server confirms/corrects
       via the response's referenceSource once the extraction actually runs. */
    setReferenceSource(
      chaining ? "previous_scene" : artistVault && hasReferencePhoto(artistVault) ? "vault_photo" : "none",
    );

    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/generate-runway-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          promptText: finalPrompt,
          negativePrompt: scene.negativePrompt ?? "",
          ratio: "720:1280",
          referenceImageUrl:
            outfitRefUrl ??
            scene.locationImageUrl ??
            (artistVault && hasReferencePhoto(artistVault)
              ? artistVault.reference_image_url
              : null),
          previousClipUrl: chaining ? previousClipUrl : null,
          model: clipModel,
          durationSec: clipModel === "seedance2_5" ? clipDuration : 5,
          resolution: clipRes,
        }),
        overrideCost: clipCost,
        overrideFeature: "Generate Video Clip",
        skipConfirm: opts?.skipConfirm,
      });
      if (!res) { setIsGenerating(false); setProgress(null); return; } // user cancelled
      const data = await res.json() as { taskId?: string; error?: string; referenceSource?: "previous_scene" | "vault_photo" | "none" };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? `Runway API error (HTTP ${res.status})`);
      const resolvedSource = data.referenceSource ?? "none";
      setReferenceSource(resolvedSource);
      setTaskId(data.taskId);
      startPolling(data.taskId, finalPrompt, resolvedSource);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start Runway generation";
      setIsGenerating(false);
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      setError(msg);
      onUpdateRef.current({ generationStatus: "failed" });
    }
  }

  function handleRemoveClip() {
    stopPolling();
    setIsGenerating(false);
    setTaskId(null);
    setError(null);
    setProgress(null);
    setShowRemoveConfirm(false);
    onUpdateRef.current({
      demoClipUrl: null,
      generationStatus: null,
      provider: null,
      promptUsed: null,
      generatedAt: null,
      referenceSource: null,
    });
    setReferenceSource(null);
  }

  const hasClip = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
  const finalPromptPreview = buildFinalPrompt();
  const hasArtist = !!artistVault;
  const willChain = hasUsableClip(previousClipUrl);

  /* Site-credit cost for the current picker selection. The per-second rates
     must match the server's SEEDANCE per-tier defaults (3 at 720p, 6 at 1080p). */
  const SEEDANCE_CREDITS_PER_SEC_CLIENT_720P = 3;
  const SEEDANCE_CREDITS_PER_SEC_CLIENT_1080P = 6;
  const clipCost = clipModel === "seedance2_5"
    ? clipDuration * (clipRes === "1080p" ? SEEDANCE_CREDITS_PER_SEC_CLIENT_1080P : SEEDANCE_CREDITS_PER_SEC_CLIENT_720P)
    : 5;
  const genTimeHint = clipModel === "seedance2_5" ? "Usually takes 1–4 minutes" : "Usually takes 30–90 seconds";

  /* Human-readable label for whichever reference the last/next generation used or will use. */
  function referenceLabel(source: "previous_scene" | "vault_photo" | "none" | null): string | null {
    if (source === "previous_scene") return "Chained from previous scene's final frame";
    if (source === "vault_photo") return "Artist Vault photo reference";
    return null;
  }

  /* Generating state */
  if (isGenerating) {
    const label = referenceLabel(referenceSource);
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-primary/25 bg-primary/5">
        <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary/90">Generating Runway clip…</p>
          {label && (
            <p className="text-[10px] text-primary/60 mt-0.5 flex items-center gap-1" data-testid="text-reference-source">
              <ShieldCheck className="h-3 w-3" /> {label}
            </p>
          )}
          <p className="text-[11px] text-white/30 mt-0.5">{genTimeHint}</p>
          {progress !== null && (
            <div className="mt-2 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-1000"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
          {taskId && (
            <p className="text-[9px] text-white/20 font-mono mt-1">Task: {taskId.slice(0, 16)}…</p>
          )}
        </div>
      </div>
    );
  }

  /* Out of credits */
  if (outOfCredits) {
    return <OutOfCredits />;
  }

  /* Error state */
  if (error) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/5">
        <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-red-300">Generation failed</p>
          <p className="text-[11px] text-red-400/70 mt-0.5 break-words">{error}</p>
        </div>
        <button
          onClick={() => { setError(null); }}
          className="text-white/30 hover:text-white/60 transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  /* Has clip */
  if (hasClip) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-400 uppercase tracking-widest">
            <CheckCircle2 className="h-3 w-3" /> Clip Ready — {scene.provider ?? "Runway"}
          </span>
          {referenceLabel(scene.referenceSource ?? referenceSource) && (
            <span
              className="flex items-center gap-1 text-[9px] font-semibold text-primary/60"
              data-testid="text-reference-source"
            >
              <ShieldCheck className="h-2.5 w-2.5" /> {referenceLabel(scene.referenceSource ?? referenceSource)}
            </span>
          )}
          {showRemoveConfirm ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/40">Remove clip?</span>
              <button
                onClick={handleRemoveClip}
                className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors"
              >Yes</button>
              <button
                onClick={() => setShowRemoveConfirm(false)}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
              >No</button>
            </div>
          ) : (
            <button
              onClick={() => setShowRemoveConfirm(true)}
              className="text-[10px] text-white/25 hover:text-white/50 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="h-2.5 w-2.5" /> Re-generate
            </button>
          )}
        </div>
        <video
          src={scene.demoClipUrl!}
          controls
          playsInline
          className="w-full rounded-xl bg-black border border-white/10 max-h-64"
        />
      </div>
    );
  }

  /* Idle — show generate button + final prompt preview */
  return (
    <div className="space-y-3">
      {/* Reference/consistency badge — scene-chain takes priority over the vault photo */}
      {/* Wardrobe outfit picker — per scene. The picked outfit's photo becomes
          the visual reference so the artist wears it in this scene's clip. */}
      {hasArtist && outfits.length > 0 && (
        <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]" data-testid="outfit-picker">
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1.5">
            👔 Outfit for this scene
          </p>
          <div className="flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setPickedOutfitId(null)}
              title="Use the artist's base vault photo"
              className={`relative h-11 w-11 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                pickedOutfitId === null ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {artistVault!.reference_video_url ? (
                <video src={artistVault!.reference_video_url} poster={artistVault!.reference_image_url ?? undefined} autoPlay muted loop playsInline className="h-full w-full object-cover object-top" />
              ) : artistVault!.reference_image_url ? (
                <img src={artistVault!.reference_image_url} alt="Base look" className="h-full w-full object-cover object-top" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-white/10 text-[9px] text-white/50 font-bold">Base</span>
              )}
            </button>
            {outfits.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setPickedOutfitId(o.id)}
                title={o.label}
                className={`relative h-11 w-11 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                  pickedOutfitId === o.id ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"
                }`}
              >
                <img src={o.image_url} alt={o.label} className="h-full w-full object-cover object-top" loading="lazy" />
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/40 mt-1.5">
            {pickedOutfit ? <>Wearing: <span className="text-white/70 font-semibold">{pickedOutfit.label}</span></> : "Base vault look"}
          </p>
        </div>
      )}

      {willChain ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20" data-testid="text-reference-source">
          <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
              Chained From Previous Scene
            </p>
            <p className="text-[10px] text-white/40 leading-snug">
              The final frame of the previous scene's clip will anchor this generation so wardrobe, lighting, and pose flow naturally between scenes.
            </p>
          </div>
        </div>
      ) : hasArtist && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20" data-testid="text-reference-source">
          <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
              Artist Consistency Applied
            </p>
            <p className="text-[10px] text-white/40 leading-snug">
              {artistVault!.artist_name} will be used as the main character.
              {pickedOutfit
                ? ` Outfit "${pickedOutfit.label}" is used as the visual reference for this scene.`
                : hasReferencePhoto(artistVault!)
                  ? " Vault photo is used as a visual reference so the artist's face & look stay consistent across scenes."
                  : " Text-only character consistency applied. Add a photo to your Artist Vault to lock in the artist's face across scenes."}
            </p>
          </div>
        </div>
      )}

      {/* Final Prompt preview */}
      <div>
        <button
          onClick={() => setShowFinalPrompt((s) => !s)}
          className="flex items-center gap-1.5 text-[10px] font-bold text-white/30 hover:text-white/60 transition-colors mb-1.5"
        >
          <Eye className="h-3 w-3" />
          {showFinalPrompt ? "Hide" : "Preview"} Final Prompt Sent To Runway
          {showFinalPrompt ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showFinalPrompt && (
          <pre className="text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap bg-white/[0.025] border border-white/[0.06] rounded-lg px-3 py-2.5 font-mono max-h-48 overflow-y-auto">
            {finalPromptPreview}
          </pre>
        )}
      </div>

      {/* Model + duration picker */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Model</span>
          {([
            { id: "gen4.5", label: "Standard" },
            { id: "seedance2_5", label: "Premium" },
          ] as const).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setClipModel(m.id)}
              data-testid={`model-pick-${m.id}`}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                clipModel === m.id
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
              }`}
            >
              {m.label}
              {m.id === "seedance2_5" && (
                <span className="ml-1 text-[9px] font-black uppercase tracking-wide text-primary/80">Pro</span>
              )}
            </button>
          ))}
        </div>
        {clipModel === "seedance2_5" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Length</span>
            {[5, 10, 15, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setClipDuration(d)}
                data-testid={`duration-pick-${d}s`}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                  clipDuration === d
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                }`}
              >
                {d}s
              </button>
            ))}
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider ml-2">Quality</span>
            {(["720p", "1080p"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setClipRes(r)}
                data-testid={`res-pick-${r}`}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                  clipRes === r
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Generate controls — credit confirmation handled by the universal popup */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-white/50">Generate costs {clipCost} credits.</span>
        <Button
          size="sm"
          onClick={() => startGeneration()}
          className="gap-2 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 font-bold text-xs h-8"
          variant="outline"
          data-testid={`btn-generate-runway`}
        >
          <Video className="h-3.5 w-3.5" />
          Generate Runway Clip
        </Button>
      </div>
    </div>
  );
}

/* ─── Location picker ───────────────────────────────────────────
   Visual picker for the user's Locations library (/locations). Picking sets
   the scene's location label + locationImageUrl; clearing restores free text.
   The library is fetched once per page load and shared across scene cards. */
interface LibraryLocation {
  id: string;
  label: string;
  image_url: string;
}

let locationsCache: LibraryLocation[] | null = null;
let locationsFetch: Promise<LibraryLocation[]> | null = null;

function fetchLocationsLibrary(getAccessToken: () => Promise<string | null>): Promise<LibraryLocation[]> {
  if (locationsCache) return Promise.resolve(locationsCache);
  if (!locationsFetch) {
    locationsFetch = (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/locations", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json()) as { locations?: LibraryLocation[] };
        locationsCache = res.ok ? (data.locations ?? []) : [];
      } catch {
        locationsCache = [];
      }
      return locationsCache;
    })();
  }
  return locationsFetch;
}

function LocationPicker({ scene, onPick }: {
  scene: SceneData;
  onPick: (patch: Partial<SceneData>) => void;
}) {
  const { getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<LibraryLocation[] | null>(null);

  useEffect(() => {
    if (open && locations === null) {
      void fetchLocationsLibrary(getAccessToken).then(setLocations);
    }
  }, [open, locations, getAccessToken]);

  const picked = scene.locationImageUrl
    ? locations?.find((l) => l.image_url === scene.locationImageUrl) ?? null
    : null;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5 shrink-0">
          <MapPin className="h-2.5 w-2.5" /> Location
        </span>
        {scene.locationImageUrl ? (
          <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.07] pl-1 pr-2 py-1">
            <img
              src={scene.locationImageUrl}
              alt={scene.location || "Scene location"}
              className="h-8 w-12 rounded-lg object-cover"
            />
            <span className="text-xs font-semibold text-white/80 max-w-[160px] truncate">
              {picked?.label ?? scene.location ?? "Location"}
            </span>
            <button
              onClick={() => onPick({ locationImageUrl: null })}
              className="text-white/40 hover:text-white/80 transition-colors"
              title="Clear location image (keeps the text)"
              aria-label="Clear location image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-white/50 text-xs font-bold hover:text-white/80 hover:border-white/20 transition-colors"
          >
            <MapPin className="h-3.5 w-3.5" />
            {scene.location ? `“${scene.location}” — pick image` : "Pick a location"}
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {open && !scene.locationImageUrl && (
        <div className="absolute z-30 mt-2 w-[320px] max-w-[80vw] rounded-xl border border-white/10 bg-zinc-950 p-3 shadow-2xl shadow-black/60">
          {locations === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-white/50 mb-2">No locations saved yet.</p>
              <a href="/locations" className="text-xs font-bold text-primary hover:text-primary/80">
                Add some in your Locations library →
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto">
              {locations.map((l) => (
                <button
                  key={l.id}
                  onClick={() => {
                    onPick({ location: l.label, locationImageUrl: l.image_url });
                    setOpen(false);
                  }}
                  className="group rounded-lg overflow-hidden border border-white/10 hover:border-primary/50 transition-colors text-left"
                  title={`Use “${l.label}” for this scene`}
                >
                  <img src={l.image_url} alt={l.label} className="h-16 w-full object-cover" loading="lazy" />
                  <p className="px-2 py-1.5 text-[11px] font-semibold text-white/70 group-hover:text-white truncate">
                    {l.label}
                  </p>
                </button>
              ))}
            </div>
          )}
          <a
            href="/locations"
            className="block mt-2 text-center text-[11px] font-bold text-white/40 hover:text-primary transition-colors"
          >
            Manage locations →
          </a>
        </div>
      )}
    </div>
  );
}

/* ─── Scene card ────────────────────────────────────────────── */
interface SceneCardProps {
  scene: SceneData;
  index: number;
  onUpdate: (id: string, patch: Partial<SceneData>) => void;
  artistVault?: ArtistVault | null;
  videoStyle?: string;
  platform?: string;
  projectId?: string | null;
  /** Driven by "Improve All Prompts" — shows progress on this card during a bulk run. */
  externalImproving?: boolean;
  /** Details of why the last bulk "Improve All Prompts" run failed to improve this scene, if it did. */
  improveFailure?: ImproveFailure | null;
  /** Final clip URL of the immediately-preceding scene, used to chain continuity. */
  previousClipUrl?: string | null;
}

function SceneCard({ scene, index, onUpdate, artistVault, videoStyle, platform, projectId, externalImproving, improveFailure, previousClipUrl }: SceneCardProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();

  const [collapsed, setCollapsed]         = useState(false);
  const [showPrompt, setShowPrompt]       = useState(false);
  const [aiPrompt, setAiPrompt]           = useState(scene.aiVideoPrompt);
  const [negPrompt, setNegPrompt]         = useState(scene.negativePrompt);
  const [improving, setImproving]         = useState(false);

  /* Keep local textarea state in sync if parent updates the scene */
  useEffect(() => { setAiPrompt(scene.aiVideoPrompt); }, [scene.aiVideoPrompt]);
  useEffect(() => { setNegPrompt(scene.negativePrompt); }, [scene.negativePrompt]);

  function handleUpdate(patch: Partial<SceneData>) {
    onUpdate(scene.id, patch);
  }

  function saveAiPrompt() {
    if (aiPrompt !== scene.aiVideoPrompt) handleUpdate({ aiVideoPrompt: aiPrompt });
  }

  function saveNegPrompt() {
    if (negPrompt !== scene.negativePrompt) handleUpdate({ negativePrompt: negPrompt });
  }

  async function handleImprovePrompt() {
    setShowPrompt(true);
    const seed = aiPrompt.trim() || sceneSeedPrompt(scene);
    if (!seed) {
      toast({ title: "Enter a prompt first", description: "Type an AI Video Prompt before improving it.", variant: "destructive" });
      return;
    }
    setImproving(true);
    try {
      const token = await getAccessToken();
      const improvedPrompt = await requestImprovedPrompt({
        token, prompt: seed, scene,
        artistVault: artistVault ? vaultToPayload(artistVault) : null,
        videoStyle, platform,
        fetchImpl: confirmedFetch,
      });
      if (!improvedPrompt) return; // user cancelled the credit confirmation
      setAiPrompt(improvedPrompt);
      handleUpdate({ aiVideoPrompt: improvedPrompt });
      toast({ title: "Prompt improved!", description: "Your AI Video Prompt has been enhanced for Runway." });
    } catch (err) {
      const message = err instanceof ImprovePromptError ? err.message : "Something went wrong. Please try again.";
      toast({ title: "Could not improve prompt", description: message, variant: "destructive" });
    } finally {
      setImproving(false);
    }
  }

  const busy = improving || !!externalImproving;
  const hasClip = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
  const summary =
    scene.lyricLine || scene.action || scene.location || `Scene ${index + 1}`;

  return (
    <div
      className={`rounded-2xl border bg-white/[0.025] overflow-hidden transition-colors ${
        scene.approved
          ? "border-primary/40"
          : improveFailure
            ? "border-red-500/40"
            : "border-white/10 hover:border-white/20"
      }`}
      data-testid={`scene-card-${index}`}
    >
      {/* ── Card header ── */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] bg-white/[0.02]">
        {/* Scene number */}
        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[11px] font-black text-primary">{index + 1}</span>
        </div>

        {/* Timestamp */}
        {scene.timestamp && (
          <span className="flex items-center gap-1 text-xs text-white/40 shrink-0">
            <Clock className="h-3 w-3" />
            {scene.timestamp}
          </span>
        )}

        {/* Section badge */}
        {scene.section && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sectionColor(scene.section)}`}>
            {scene.section}
          </span>
        )}

        {/* Status indicator */}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {scene.approved && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-primary">
              <CheckCircle2 className="h-3 w-3" /> Approved
            </span>
          )}
          {!scene.approved && hasClip && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-green-400">
              <CheckCircle2 className="h-3 w-3" /> Clip Ready
            </span>
          )}
          {improveFailure && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`flex items-center gap-1 text-[10px] font-bold cursor-help ${IMPROVE_FAILURE_STYLE[improveFailure.errorType].className}`}
                    data-testid={`badge-improve-failed-${index}`}
                  >
                    <AlertCircle className="h-3 w-3" /> {IMPROVE_FAILURE_STYLE[improveFailure.errorType].label}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs" data-testid={`tooltip-improve-failed-${index}`}>
                  {improveFailure.message}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!improveFailure && !busy && isWeakPrompt(scene) && (
            <button
              onClick={handleImprovePrompt}
              className="flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 transition-colors"
              title="This scene's AI Video Prompt is short or generic — click to improve it"
              data-testid={`badge-weak-prompt-${index}`}
            >
              <AlertTriangle className="h-3 w-3" /> Weak Prompt
            </button>
          )}
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-white/30 hover:text-white/60 transition-colors"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </span>
      </div>

      {/* ── Card body ── */}
      {!collapsed && (
        <div className="px-5 py-4 space-y-4">

          {/* Scene summary (always visible) */}
          <p className="text-sm text-white/55 leading-relaxed border-l-2 border-primary/20 pl-3">
            {scene.lyricLine ? <span className="italic">"{summary}"</span> : summary}
          </p>

          {/* Action buttons (always visible) */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleImprovePrompt}
              disabled={busy}
              className="h-8 text-xs gap-1.5 border-primary/20 bg-primary/5 text-primary/80 hover:bg-primary/15 hover:text-primary font-bold"
              data-testid={`btn-improve-prompt-${index}`}
            >
              {busy
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Improving…</>
                : <><Sparkles className="h-3.5 w-3.5" /> Improve Prompt for Artist</>}
            </Button>

            <button
              onClick={() => setShowPrompt((s) => !s)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-white/50 text-xs font-bold hover:text-white/80 hover:border-white/20 transition-colors"
              data-testid={`btn-toggle-prompt-${index}`}
            >
              <Zap className="h-3.5 w-3.5" />
              {showPrompt ? "Hide AI Prompt" : "AI Prompt & Details"}
              {showPrompt ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {hasClip && (
              <Button
                size="sm"
                onClick={() => handleUpdate({ approved: !scene.approved })}
                variant="outline"
                className={`h-8 text-xs gap-1.5 font-bold ${
                  scene.approved
                    ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/10"
                    : "border-white/10 bg-white/[0.03] text-white/50 hover:text-primary hover:border-primary/30 hover:bg-primary/10"
                }`}
                data-testid={`btn-approve-clip-${index}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {scene.approved ? "Approved ✓" : "Approve Clip"}
              </Button>
            )}
          </div>

          {/* Location picker — visual pick from the user's Locations library */}
          <LocationPicker scene={scene} onPick={handleUpdate} />

          {/* AI Video Prompt & scene details (collapsed by default) */}
          {showPrompt && (
            <div className="space-y-4 pt-1">
              {/* Visual description + Camera direction */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(scene.location || scene.action) && (
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3.5 py-3 space-y-1.5">
                    <p className="text-[9px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                      <MapPin className="h-2.5 w-2.5" /> Visual Description
                    </p>
                    {scene.location && (
                      <p className="text-xs text-white/60 leading-relaxed">
                        <span className="text-white/30">Location: </span>{scene.location}
                      </p>
                    )}
                    {scene.locationImageUrl && (
                      <img
                        src={scene.locationImageUrl}
                        alt={scene.location || "Scene location"}
                        className="mt-1.5 h-16 w-28 rounded-lg object-cover border border-white/10"
                        loading="lazy"
                      />
                    )}
                    {scene.action && (
                      <p className="text-xs text-white/60 leading-relaxed flex items-start gap-1.5">
                        <Zap className="h-3 w-3 text-primary/40 shrink-0 mt-0.5" />
                        {scene.action}
                      </p>
                    )}
                  </div>
                )}

                {(scene.cameraMovement || scene.lighting || scene.mood) && (
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3.5 py-3 space-y-1.5">
                    <p className="text-[9px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                      <Camera className="h-2.5 w-2.5" /> Camera Direction
                    </p>
                    {scene.cameraMovement && (
                      <p className="text-xs text-white/60 leading-relaxed">
                        <span className="text-white/30">Camera: </span>{scene.cameraMovement}
                      </p>
                    )}
                    {scene.lighting && (
                      <p className="text-xs text-white/60 leading-relaxed">
                        <span className="text-white/30">Lighting: </span>{scene.lighting}
                      </p>
                    )}
                    {scene.mood && (
                      <p className="text-xs text-white/60 leading-relaxed">
                        <span className="text-white/30">Mood: </span>{scene.mood}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* AI Video Prompt */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-primary/70 uppercase tracking-widest flex items-center gap-1.5">
                  <Zap className="h-2.5 w-2.5" /> AI Video Prompt
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onBlur={saveAiPrompt}
                  rows={4}
                  placeholder="Describe the visual for this scene…"
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-3 text-sm text-white/80 leading-relaxed resize-none focus:outline-none focus:border-primary/40 transition-colors placeholder:text-white/20"
                  data-testid={`textarea-ai-prompt-${index}`}
                />
              </div>

              {/* Negative Prompt */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest block">
                  Negative Prompt
                </label>
                <textarea
                  value={negPrompt}
                  onChange={(e) => setNegPrompt(e.target.value)}
                  onBlur={saveNegPrompt}
                  rows={2}
                  placeholder="Things to avoid in the video (e.g. blurry, text, watermark)…"
                  className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-xs text-white/50 leading-relaxed resize-none focus:outline-none focus:border-white/20 transition-colors placeholder:text-white/15"
                  data-testid={`textarea-neg-prompt-${index}`}
                />
              </div>
            </div>
          )}

          {/* Generate Runway Clip + preview */}
          <div className="pt-1 border-t border-white/[0.04]">
            <InlineRunwayGenerator
              scene={{ ...scene, aiVideoPrompt: aiPrompt, negativePrompt: negPrompt }}
              onUpdate={(patch) => handleUpdate(patch)}
              artistVault={artistVault}
              projectId={projectId}
              previousClipUrl={previousClipUrl}
            />
          </div>

          {/* Silent preview note */}
          <p className="text-[11px] text-white/30 flex items-start gap-1.5">
            <Film className="h-3 w-3 text-primary/40 shrink-0 mt-0.5" />
            Runway clips are silent previews. Your uploaded song will be added during final export.
          </p>

        </div>
      )}
    </div>
  );
}

/* ─── SceneStudio ───────────────────────────────────────────── */
interface SceneStudioProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
  artistVault?: ArtistVault | null;
  videoStyle?: string;
  platform?: string;
  /** When true, expose scene-management controls (reorder, add, remove). */
  manageable?: boolean;
  /** Explicit save action (e.g. persist timeline to project). Renders a Save button when provided. */
  onSave?: () => void;
  /** Saving spinner state for the Save button. */
  saving?: boolean;
  /** Project ID for auto-saving generated clips. */
  projectId?: string | null;
}

export function SceneStudio({
  scenes, onScenesChange, artistVault, videoStyle, platform,
  manageable = false, onSave, saving = false, projectId,
}: SceneStudioProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const { confirmSpend } = useCreditConfirm();
  const [improvingIds, setImprovingIds] = useState<Set<string>>(new Set());
  const [improveAllTotal, setImproveAllTotal] = useState(0);
  const improveAllActive = improveAllTotal > 0;
  /** Scene ID → failure detail from the most recent "Improve All Prompts" / "Retry Failed" run. */
  const [failedReasons, setFailedReasons] = useState<Map<string, ImproveFailure>>(new Map());

  const handleUpdate = useCallback(
    (id: string, patch: Partial<SceneData>) => {
      onScenesChange(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      if (patch.aiVideoPrompt !== undefined) {
        setFailedReasons((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [scenes, onScenesChange],
  );

  const moveScene = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= scenes.length) return;
      const next = [...scenes];
      [next[index], next[target]] = [next[target], next[index]];
      onScenesChange(next);
    },
    [scenes, onScenesChange],
  );

  const removeScene = useCallback(
    (id: string) => onScenesChange(scenes.filter((s) => s.id !== id)),
    [scenes, onScenesChange],
  );

  const addScene = useCallback(() => {
    const newScene: SceneData = {
      id: `scene-${Date.now()}`,
      sceneNumber: scenes.length + 1,
      timestamp: "", section: "", lyricLine: "", location: "",
      action: "", cameraMovement: "", lighting: "", mood: "",
      aiVideoPrompt: "", negativePrompt: "", approved: false, demoClipUrl: null,
      thumbnailUrl: null, clipId: null, runwayJobId: null,
      provider: null, generationStatus: null, promptUsed: null, generatedAt: null,
    };
    onScenesChange([...scenes, newScene]);
  }, [scenes, onScenesChange]);

  const runImprovePrompts = useCallback(
    async (targets: SceneData[], opts?: { isRetry?: boolean }) => {
      if (improveAllActive || targets.length === 0) return;

      // One confirmation for the whole batch (1 credit per prompt)
      const okToSpend = await confirmSpend({ cost: targets.length, feature: "Improve Prompts" });
      if (!okToSpend) return;
      const skipConfirmFetch: typeof confirmedFetch = (url, init) =>
        confirmedFetch(url, { ...init, skipConfirm: true });

      setImproveAllTotal(targets.length);
      setImprovingIds(new Set(targets.map((s) => s.id)));

      let working = [...scenes];
      let ok = 0;
      const newlyFailed = new Map<string, ImproveFailure>();
      try {
        const token = await getAccessToken();

        await Promise.allSettled(
          targets.map(async (scene) => {
            try {
              const improved = await requestImprovedPrompt({
                token, prompt: sceneSeedPrompt(scene), scene,
                artistVault: artistVault ? vaultToPayload(artistVault) : null,
                videoStyle, platform,
                fetchImpl: skipConfirmFetch,
              });
              if (!improved) throw new Error("cancelled");
              working = working.map((s) => (s.id === scene.id ? { ...s, aiVideoPrompt: improved } : s));
              onScenesChange(working);
              ok++;
            } catch (err) {
              newlyFailed.set(scene.id, {
                message: err instanceof ImprovePromptError ? err.message : "Something went wrong. Please try again.",
                errorType: err instanceof ImprovePromptError ? err.errorType : "unknown",
              });
            } finally {
              setImprovingIds((prev) => {
                const next = new Set(prev);
                next.delete(scene.id);
                return next;
              });
            }
          }),
        );

        setFailedReasons((prev) => {
          const next = new Map(prev);
          for (const t of targets) next.delete(t.id);
          for (const [id, reason] of newlyFailed) next.set(id, reason);
          return next;
        });

        const fail = newlyFailed.size;
        toast({
          title: fail === 0 ? "All prompts improved!" : `Improved ${ok} of ${targets.length} scenes`,
          description:
            fail === 0
              ? `Enhanced ${ok} scene${ok !== 1 ? "s" : ""} for Runway.`
              : `${fail} scene${fail !== 1 ? "s" : ""} could not be improved — hover a scene's badge for details, or use "Retry Failed".`,
          variant: fail === 0 ? undefined : "destructive",
        });
      } catch (err) {
        const reason: ImproveFailure = {
          message: err instanceof ImprovePromptError ? err.message : "Something went wrong starting the batch. Please try again.",
          errorType: err instanceof ImprovePromptError ? err.errorType : "unknown",
        };
        setFailedReasons((prev) => {
          const next = new Map(prev);
          for (const t of targets) next.set(t.id, reason);
          return next;
        });
        toast({
          title: opts?.isRetry ? "Could not retry prompts" : "Could not improve prompts",
          description: reason.message,
          variant: "destructive",
        });
      } finally {
        setImproveAllTotal(0);
        setImprovingIds(new Set());
      }
    },
    [scenes, artistVault, videoStyle, platform, getAccessToken, onScenesChange, toast, improveAllActive],
  );

  const handleImproveAllPrompts = useCallback(() => {
    const targets = scenes.filter((s) => sceneSeedPrompt(s).length > 0);
    if (targets.length === 0) {
      toast({
        title: "Nothing to improve",
        description: "Add some scene details or prompts first.",
        variant: "destructive",
      });
      return;
    }
    setFailedReasons(new Map());
    void runImprovePrompts(targets);
  }, [scenes, toast, runImprovePrompts]);

  const failedScenes = scenes.filter((s) => failedReasons.has(s.id));

  const handleRetryFailed = useCallback(() => {
    if (failedScenes.length === 0) return;
    void runImprovePrompts(failedScenes, { isRetry: true });
  }, [failedScenes, runImprovePrompts]);

  if (scenes.length === 0 && !manageable) return null;

  const clipsReady = scenes.filter((s) => s.generationStatus === "completed").length;

  return (
    <div className="space-y-4" data-testid="scene-studio">
      {/* Section heading */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Film className="h-4.5 w-4.5 text-primary" style={{ width: "1.125rem", height: "1.125rem" }} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-wider">
              Scene Cards For Video Generation
            </h2>
            <p className="text-xs text-white/30 mt-0.5">
              {scenes.length} scene{scenes.length !== 1 ? "s" : ""}
              {clipsReady > 0 ? ` · ${clipsReady} clip${clipsReady !== 1 ? "s" : ""} ready` : ""}
            </p>
          </div>
        </div>
        {(scenes.length > 0 || manageable) && (
          <div className="flex items-center gap-2 flex-wrap">
            {scenes.length > 0 && (
              <Button
                size="sm" variant="outline"
                onClick={handleImproveAllPrompts}
                disabled={improveAllActive}
                className="border-primary/20 bg-primary/5 text-primary/80 hover:bg-primary/15 hover:text-primary font-bold gap-1.5 h-9"
                data-testid="btn-improve-all-prompts"
              >
                {improveAllActive
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Improving {improveAllTotal - improvingIds.size}/{improveAllTotal}…</>
                  : <><Sparkles className="h-4 w-4" /> Improve All Prompts</>}
              </Button>
            )}
            {failedScenes.length > 0 && (
              <Button
                size="sm" variant="outline"
                onClick={handleRetryFailed}
                disabled={improveAllActive}
                className="border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:text-red-300 font-bold gap-1.5 h-9"
                data-testid="btn-retry-failed-prompts"
              >
                <RotateCcw className="h-4 w-4" />
                Retry Failed ({failedScenes.length})
              </Button>
            )}
            {manageable && (
              <>
                <Button
                  size="sm" variant="outline" onClick={addScene}
                  className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white gap-1.5 h-9"
                  data-testid="btn-add-scene"
                >
                  <Plus className="h-4 w-4" /> Add Scene
                </Button>
                {onSave && (
                  <Button
                    size="sm" onClick={onSave} disabled={saving}
                    className="gold-glow font-bold gap-1.5 h-9"
                    data-testid="btn-save-scenes"
                  >
                    {saving
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                      : <><Save className="h-4 w-4" /> Save</>}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {scenes.map((scene, i) => (
          <div key={scene.id} className="space-y-1.5">
            {manageable && (
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button" onClick={() => moveScene(i, -1)} disabled={i === 0}
                  className="h-7 w-7 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  title="Move up" data-testid={`btn-scene-up-${i}`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1}
                  className="h-7 w-7 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  title="Move down" data-testid={`btn-scene-down-${i}`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" onClick={() => removeScene(scene.id)}
                  className="h-7 w-7 rounded-lg border border-red-500/20 bg-red-500/5 flex items-center justify-center text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Remove scene" data-testid={`btn-scene-remove-${i}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <SceneCard
              scene={scene}
              index={i}
              onUpdate={handleUpdate}
              artistVault={artistVault}
              videoStyle={videoStyle}
              platform={platform}
              projectId={projectId}
              externalImproving={improvingIds.has(scene.id)}
              improveFailure={failedReasons.get(scene.id) ?? null}
              previousClipUrl={getPreviousClipUrl(scenes, i)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
