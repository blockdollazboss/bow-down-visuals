import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Archive, ArrowLeft, Save, ChevronRight, CheckCircle2,
  Loader2, Trash2, Pencil, Eye, X, Plus, Upload, ImageIcon,
  Lock, Copy, Sparkles, User, Video, Zap, Film, Camera,
  AlertTriangle, Download, Repeat, Users, Palette,
} from "lucide-react";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";

import type { ArtistVault } from "@/components/ArtistVaultSelector";
import {
  normalizeSubjectType,
  SUBJECT_TYPE_META,
  SubjectBadge,
  type SubjectType,
} from "@/components/ArtistVaultSelector";
import { getSupabase } from "@/lib/supabase";
import { GenerateArtistImageModal, type ArtistImageModalMode } from "@/components/GenerateArtistImageModal";
import { buildArtistImagePrompt } from "@/components/generate-artist-image";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import { CHARACTER_THEMES, getCharacterTheme, themeAlpha } from "@/lib/character-themes";
import { downloadImage } from "@/lib/download-image";
import { LinkedCharactersSection } from "@/components/LinkedCharactersSection";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface ArtistVaultRecord {
  id: string;
  user_id: string;
  team_id?: string | null;
  artist_name: string;
  artist_type: string | null;
  genre: string | null;
  voice_style: string | null;
  visual_style: string | null;
  hair: string | null;
  tattoos: string | null;
  jewelry: string | null;
  clothing_style: string | null;
  brand_colors: string | null;
  theme_id: string | null;
  personality: string | null;
  do_not_change_rules: string | null;
  description: string | null;
  special_style_rules: string | null;
  reference_image_url: string | null;
  reference_image_path: string | null;
  reference_video_url: string | null;
  reference_video_path: string | null;
  consistency_prompt: string | null;
  voice_id: string | null;
  voice_name: string | null;
  voice_preview_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface FormValues {
  artistName: string;
  artistType: string;
  genre: string;
  voiceStyle: string;
  visualStyle: string;
  hair: string;
  tattoos: string;
  jewelry: string;
  clothingStyle: string;
  brandColors: string;
  themeId: string;
  personality: string;
  doNotChangeRules: string;
  artistDescription: string;
  specialStyleRules: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const GENRES = [
  "Hip Hop", "Drill", "Trap", "R&B", "Pop",
  "Afrobeats", "Dancehall", "Gospel", "Kids Music",
  "Rock", "Country", "Other",
];

const VISUAL_STYLES = [
  "Street Cinematic", "Luxury Rap", "Dark Emotional", "Cartoon",
  "Anime", "Kids Friendly", "Performance", "Club",
  "Romantic R&B", "Documentary",
];

/* ─────────────────────────── CHARACTER CONSISTENCY ─────────────────────────── */

type DetailLevel = "video_safe" | "high_detail";

function generateConsistencyPrompt(vault: ArtistVaultRecord, mode: DetailLevel = "video_safe"): string {
  if (mode === "video_safe") {
    const lines: string[] = [
      `[CHARACTER CONSISTENCY: ${vault.artist_name}] — VIDEO SAFE`,
      "Use the active artist profile as the main character reference.",
      "Keep the same face, skin tone, hairstyle, body type, age range, build, clothing color and style direction, and overall identity in every shot.",
      vault.reference_image_url
        ? "Use the uploaded artist reference image as the visual consistency guide."
        : "No reference image uploaded — match details below as closely as possible.",
      "",
      "VIDEO-SAFE CHARACTER RULES:",
      "Keep jewelry simple and realistic: clean gold chains, small diamond studs, subtle natural shine.",
      "Do not force tiny pendant letters, chain text, complex bracelet charms, detailed ring shapes, or many jewelry pieces at once.",
      "Keep tattoos minimal and clean. Do not add random tattoos. Only hint at tattoo detail in close-up shots.",
      "For wide shots: focus on face, outfit, mood, and motion — jewelry and tattoos should be subtle.",
      "For close-up shots: allow slightly more jewelry and tattoo detail, but keep it clean and realistic.",
      "⛔ AVOID: warped jewelry, melted chains, fake plastic shine, messy tattoos, random face tattoos,",
      "   distorted ink, unreadable tattoo or jewelry text, extra random accessories, distorted hands.",
      "",
      `Artist: ${vault.artist_name}`,
    ];
    if (vault.artist_type)    lines.push(`Artist Type: ${vault.artist_type}`);
    if (vault.genre)           lines.push(`Genre: ${vault.genre}`);
    if (vault.visual_style)    lines.push(`Visual Style: ${vault.visual_style}`);
    if (vault.hair)            lines.push(`Hair: ${vault.hair}`);
    if (vault.tattoos)         lines.push(`Tattoos (video-simplified): ${vault.tattoos} — show minimally, no detail forcing`);
    if (vault.jewelry)         lines.push(`Jewelry (video-simplified): ${vault.jewelry} — keep clean and realistic, no tiny text or complex detail`);
    if (vault.clothing_style)  lines.push(`Clothing Style: ${vault.clothing_style}`);
    if (vault.brand_colors)    lines.push(`Brand Colors: ${vault.brand_colors}`);
    if (vault.personality)     lines.push(`Personality: ${vault.personality}`);
    if (vault.description)     lines.push(`Artist Description: ${vault.description}`);
    if (vault.reference_image_url) lines.push(`Artist Reference Image URL: ${vault.reference_image_url}`);
    if (vault.do_not_change_rules) lines.push("", `⛔ DO NOT CHANGE: ${vault.do_not_change_rules}`);
    if (vault.special_style_rules) lines.push("", `🎨 SPECIAL STYLE RULES: ${vault.special_style_rules}`);
    lines.push(
      "",
      "⚠️ Tiny jewelry, tattoos, and text may vary in AI video. Video Safe mode gives the most realistic motion.",
      "---",
    );
    return lines.join("\n");
  }

  // High Detail mode (for still images, thumbnails, cover art)
  const lines: string[] = [
    `[CHARACTER CONSISTENCY: ${vault.artist_name}] — HIGH DETAIL`,
    "Use the active artist profile as the main character reference.",
    "Keep the same face, skin tone, hairstyle, body type, tattoos, jewelry, clothing direction, colors, and overall identity.",
    "Do not add random tattoos, logos, scars, jewelry, face marks, or accessories.",
    vault.reference_image_url
      ? "Use the uploaded artist reference image as the visual consistency guide."
      : "No reference image uploaded — fill in details below as accurately as possible.",
    "",
    `Artist: ${vault.artist_name}`,
  ];
  if (vault.artist_type)       lines.push(`Artist Type: ${vault.artist_type}`);
  if (vault.genre)              lines.push(`Genre: ${vault.genre}`);
  if (vault.visual_style)       lines.push(`Visual Style: ${vault.visual_style}`);
  if (vault.hair)               lines.push(`Hair: ${vault.hair}`);
  if (vault.tattoos)            lines.push(`Tattoos / Body Marks: ${vault.tattoos}`);
  if (vault.jewelry)            lines.push(`Jewelry / Accessories: ${vault.jewelry}`);
  if (vault.clothing_style)     lines.push(`Clothing Style: ${vault.clothing_style}`);
  if (vault.brand_colors)       lines.push(`Brand Colors: ${vault.brand_colors}`);
  if (vault.personality)        lines.push(`Personality: ${vault.personality}`);
  if (vault.description)        lines.push(`Artist Description: ${vault.description}`);
  if (vault.reference_image_url) lines.push(`Artist Reference Image URL: ${vault.reference_image_url}`);
  if (vault.do_not_change_rules) lines.push("", `⛔ DO NOT CHANGE: ${vault.do_not_change_rules}`);
  if (vault.special_style_rules) lines.push("", `🎨 SPECIAL STYLE RULES: ${vault.special_style_rules}`);
  lines.push(
    "",
    "⚠️ AI tools may still vary results, but this consistency lock gives the best chance of keeping the same character.",
    "For best realism: use Video Safe mode for video clips, High Detail mode for still images and thumbnails.",
    "---",
  );
  return lines.join("\n");
}

function ConsistencyModal({
  vault, onClose,
}: {
  vault: ArtistVaultRecord; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DetailLevel>("video_safe");
  const prompt = generateConsistencyPrompt(vault, mode);
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const { setConsistencyPrompt } = useActiveArtist();

  function handleCopy() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      const el = document.createElement("textarea");
      el.value = prompt;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function handleApply() {
    setConsistencyPrompt(prompt);
    setApplied(true);
    setTimeout(() => setApplied(false), 3000);
  }

  function handleImproveRealism() {
    setMode("video_safe");
    setConsistencyPrompt(generateConsistencyPrompt(vault, "video_safe"));
    setApplied(true);
    setTimeout(() => setApplied(false), 3000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} role="button" aria-label={t("artistVault.closeDialog")} tabIndex={-1} />
      <div className="relative w-full max-w-xl rounded-2xl border border-primary/30 bg-[#0a0a0a] p-6 md:p-8 shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">{t("artistVault.consistencyTitle")}</h3>
              <p className="text-xs text-white/40">{vault.artist_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors shrink-0 ml-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Character Detail Level toggle */}
        <div data-min-stars="5" className="mb-5">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("artistVault.detailLevelTitle")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("video_safe")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                mode === "video_safe"
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/20"
              }`}
            >
              <Video className="h-4 w-4" /> {t("artistVault.videoSafe")}
            </button>
            <button
              type="button"
              onClick={() => setMode("high_detail")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                mode === "high_detail"
                  ? "border-white/30 bg-white/[0.07] text-white"
                  : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/20"
              }`}
            >
              <Film className="h-4 w-4" /> {t("artistVault.highDetail")}
            </button>
          </div>
          <p className="text-[11px] text-white/30 mt-2 leading-relaxed">
            {mode === "video_safe"
              ? t("artistVault.videoSafeBlurb")
              : t("artistVault.highDetailBlurb")}
          </p>
        </div>

        {/* Warning note */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 mb-5">
          <p className="text-xs text-amber-400/80 leading-relaxed">
            {t("artistVault.warnPrefix")} <strong>{t("artistVault.videoSafe")}</strong> {t("artistVault.modalWarnMiddle")} <strong>{t("artistVault.highDetail")}</strong> {t("artistVault.modalWarnSuffix")}
          </p>
        </div>

        {/* Prompt textarea */}
        <textarea
          readOnly
          value={prompt}
          rows={12}
          className="w-full rounded-xl border border-white/[0.10] bg-white/[0.03] px-4 py-3 text-xs text-white/70 font-mono leading-relaxed resize-none focus:outline-none mb-4"
        />

        {/* Improve Video Realism button */}
        <button
          type="button"
          onClick={handleImproveRealism}
          data-min-stars="4"
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/20 transition-all mb-3"
        >
          <Zap className="h-4 w-4" /> {t("artistVault.improveRealism")}
        </button>

        {/* Copy + Apply buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm border transition-all ${
              copied
                ? "border-green-500/40 bg-green-500/[0.10] text-green-400"
                : "border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            {copied ? (
              <><CheckCircle2 className="h-4 w-4" /> {t("artistVault.copied")}</>
            ) : (
              <><Copy className="h-4 w-4" /> {t("artistVault.copyPrompt")}</>
            )}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm border transition-all ${
              applied
                ? "border-green-500/40 bg-green-500/[0.10] text-green-400"
                : "border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            {applied ? (
              <><CheckCircle2 className="h-4 w-4" /> {t("artistVault.applied")}</>
            ) : (
              <><Sparkles className="h-4 w-4" /> {t("artistVault.applyToAll")}</>
            )}
          </button>
        </div>
        {applied && (
          <p className="text-[11px] text-green-400/60 text-center mt-3">
            {t("artistVault.appliedNote")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── STYLE CONSTANTS ─────────────────────────── */

const selectClass =
  "h-11 w-full rounded-xl bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 text-sm focus:outline-none focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 appearance-none cursor-pointer hover:border-white/[0.18]";
const inputClass =
  "h-11 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 placeholder:text-white/25 focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 rounded-xl hover:border-white/[0.18]";
const textareaClass =
  "bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 py-3 placeholder:text-white/25 focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 rounded-xl resize-none hover:border-white/[0.18]";

/* ─────────────────────────── SUB-COMPONENTS ─────────────────────────── */

function StyledSelect({
  name, placeholder, options, value, onChange,
}: {
  name: string; placeholder: string; options: string[];
  value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)}
        className={selectClass} style={{ colorScheme: "dark" }}>
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o} style={{ background: "#111" }}>{o}</option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

function FieldWrapper({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{label}</Label>
      {hint && <p className="text-xs text-white/30 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="lux-card-static p-4">
      <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-1">{label}</p>
      <p className="text-sm text-white/80 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

interface VoiceOption {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category: string | null;
}

/**
 * Locked Voice — the artist's ElevenLabs voice. Every song generated for
 * this artist is vocal-swapped to it. Clone from a recording, strip a song
 * to its vocals, or pick one.
 */
function LockedVoiceSection({ vault, onChanged }: {
  vault: ArtistVaultRecord;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [songs, setSongs] = useState<{ id: string; title: string }[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  async function authHeaders(): Promise<HeadersInit> {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function handleCloneFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      Array.from(files).slice(0, 3).forEach((f) => form.append("files", f));
      const res = await fetch(`/api/artist-vaults/${vault.id}/voice/clone`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(data.error || t("artistVault.voiceCloneFailed"));
      setPickerOpen(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.voiceCloneFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleFromSong(fileOrId: File | string) {
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      const headers = await authHeaders();
      if (typeof fileOrId === "string") {
        setStage(t("artistVault.strippingVocals"));
        res = await fetch(`/api/artist-vaults/${vault.id}/voice/from-song`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ songId: fileOrId }),
        });
      } else {
        const form = new FormData();
        form.append("song", fileOrId);
        setStage(t("artistVault.uploadingSong"));
        res = await fetch(`/api/artist-vaults/${vault.id}/voice/from-song`, {
          method: "POST",
          headers,
          body: form,
        });
      }
      setStage(t("artistVault.cloningVocals"));
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(data.error || t("artistVault.voiceFromSongFailed"));
      setSongPickerOpen(false);
      setStage(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.voiceFromSongFailed"));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function loadSongs() {
    setLoadingSongs(true);
    setError(null);
    try {
      const res = await fetch("/api/songs", { headers: await authHeaders() });
      const data = await res.json().catch(() => ({} as { error?: string; songs?: { id: string; title: string }[] }));
      if (!res.ok) throw new Error(data.error || t("artistVault.loadSongsFailed"));
      setSongs(data.songs ?? []);
      setSongPickerOpen((v) => !v);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.loadSongsFailed"));
    } finally {
      setLoadingSongs(false);
    }
  }
  async function loadVoices() {
    setLoadingVoices(true);
    setError(null);
    try {
      const res = await fetch("/api/voices", { headers: await authHeaders() });
      const data = await res.json().catch(() => ({} as { error?: string; voices?: VoiceOption[] }));
      if (!res.ok) throw new Error(data.error || t("artistVault.loadVoicesFailed"));
      setVoices(data.voices ?? []);
      setPickerOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.loadVoicesFailed"));
    } finally {
      setLoadingVoices(false);
    }
  }

  async function pickVoice(v: VoiceOption) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artist-vaults/${vault.id}/voice`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId: v.voice_id,
          voiceName: v.name,
          voicePreviewUrl: v.preview_url,
        }),
      });
      if (!res.ok) throw new Error(t("artistVault.lockVoiceFailed"));
      setPickerOpen(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.lockVoiceFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function removeVoice() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artist-vaults/${vault.id}/voice`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(t("artistVault.removeVoiceFailed"));
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.removeVoiceFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-min-stars="4" className="lux-card-static p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">{t("artistVault.lockedVoice")}</p>
      </div>
      <p className="text-xs text-white/40 mb-3">
        {t("artistVault.lockedVoiceBlurb", { name: vault.artist_name })}
      </p>

      {vault.voice_id ? (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate">{vault.voice_name ?? t("artistVault.lockedVoiceFallback")}</p>
            {vault.voice_preview_url && (
              <audio controls src={vault.voice_preview_url} className="mt-2 h-8 w-full max-w-xs" />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={removeVoice}
            disabled={busy}
            className="text-white/50 hover:text-red-400 shrink-0"
            title={t("artistVault.removeVoiceTitle")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <>
        <div className="flex flex-wrap gap-2">
          <label
            className={`inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("artistVault.cloneFromRecording")}
            <input
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => { void handleCloneFiles(e.target.files); e.target.value = ""; }}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void loadVoices(); }}
            disabled={busy || loadingVoices}
            className="rounded-xl border-white/15 text-white/80 h-[38px] px-4"
          >
            {loadingVoices ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("artistVault.chooseVoice")}
          </Button>
          <label
            className={`inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}
            title={t("artistVault.fromSongTitle")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("artistVault.fromSong")}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFromSong(f);
                e.target.value = "";
              }}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void loadSongs(); }}
            disabled={busy || loadingSongs}
            className="rounded-xl border-white/15 text-white/80 h-[38px] px-4"
          >
            {loadingSongs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("artistVault.fromMySongs")}
          </Button>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-primary/80">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">{t("artistVault.songTipBold")}</span>{" "}
            {t("artistVault.songTipRest")}
          </span>
        </p>
        </>
      )}

      {/* Single section-level error display (kept at the bottom of the section). */}
      {busy && stage && (
        <p className="mt-3 text-xs text-white/50 flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          {stage} {t("artistVault.stageSuffix")}
        </p>
      )}

      {songPickerOpen && !vault.voice_id && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
          <p className="px-3 py-2 text-xs text-white/40">
            {t("artistVault.songPickerHint", { credits: 200 })}
          </p>
          {songs.map((s) => (
            <button
              key={s.id}
              onClick={() => { void handleFromSong(s.id); }}
              disabled={busy}
              className="w-full px-3 py-2 hover:bg-white/5 text-sm text-white/80 truncate text-left hover:text-white disabled:opacity-50"
            >
              {s.title}
            </button>
          ))}
          {songs.length === 0 && (
            <p className="px-3 py-4 text-sm text-white/40">{t("artistVault.noSongsYet")}</p>
          )}
        </div>
      )}

      {pickerOpen && !vault.voice_id && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
          {voices.map((v) => (
            <div
              key={v.voice_id}
              className="w-full px-3 py-2 hover:bg-white/5 flex items-center justify-between gap-2"
            >
              <button
                onClick={() => { void pickVoice(v); }}
                disabled={busy}
                className="text-sm text-white/80 truncate text-left flex-1 hover:text-white"
              >
                {v.name}
              </button>
              {v.preview_url && (
                <audio controls src={v.preview_url} className="h-7 w-40 shrink-0" />
              )}
            </div>
          ))}
          {voices.length === 0 && (
            <p className="px-3 py-4 text-sm text-white/40">{t("artistVault.noVoicesFound")}</p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {!vault.voice_id && (
        <p className="mt-2 text-[11px] text-white/30">
          {t("artistVault.voiceTip")}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────── REFERENCE VIDEO ─────────────────────── */

const REF_VIDEO_CREDITS = 15;
const LOOP_VIDEO_CREDITS = 2;

function ReferenceVideoSection({ vault, onChanged }: {
  vault: ArtistVaultRecord;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loopBusy, setLoopBusy] = useState(false);
  const [loopStage, setLoopStage] = useState<string | null>(null);

  async function authHeaders(): Promise<HeadersInit> {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function pollTask(taskId: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const res = await fetch(`/api/artist-vaults/${vault.id}/reference-video/${taskId}`, {
        headers: await authHeaders(),
      });
      const data = await res.json().catch(() => ({} as { status?: string; error?: string }));
      if (data.status === "SUCCEEDED") return;
      if (data.status === "FAILED" || data.status === "CANCELLED") {
        throw new Error(data.error || t("artistVault.videoGenFailed"));
      }
    }
    throw new Error(t("artistVault.videoStillProcessing"));
  }

  async function handleGenerate() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      setStage(t("artistVault.submittingJob"));
      const res = await fetch(`/api/artist-vaults/${vault.id}/reference-video`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = await res.json().catch(() => ({} as { taskId?: string; error?: string; message?: string }));
      if (!res.ok) throw new Error(data.message || data.error || t("artistVault.videoStartFailed"));
      setStage(t("artistVault.animatingCharacter"));
      await pollTask(data.taskId!);
      setStage(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.videoGenFailedGeneric"));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artist-vaults/${vault.id}/reference-video`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(t("artistVault.videoRemoveFailed"));
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.videoRemoveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleMakeLoop() {
    setLoopBusy(true);
    setError(null);
    try {
      setLoopStage(t("artistVault.smoothingLoop"));
      const res = await fetch(`/api/artist-vaults/${vault.id}/reference-video/loop`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = await res.json().catch(() => ({} as { taskId?: string; error?: string }));
      if (!res.ok) throw new Error(data.error || t("artistVault.loopStartFailed"));
      // Poll — FFmpeg takes ~30s; charged only on success.
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pres = await fetch(`/api/artist-vaults/${vault.id}/reference-video/loop/${data.taskId}`, {
          headers: await authHeaders(),
        });
        const pdata = await pres.json().catch(() => ({} as { status?: string; error?: string }));
        if (pdata.status === "succeeded") break;
        if (pdata.status === "failed") throw new Error(pdata.error || t("artistVault.loopFailed"));
      }
      setLoopStage(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("artistVault.loopFailedGeneric"));
    } finally {
      setLoopBusy(false);
      setLoopStage(null);
    }
  }

  const hasPhoto = !!vault.reference_image_url;

  return (
    <div data-min-stars="4" className="lux-card-static p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Video className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">{t("artistVault.referenceVideo")}</p>
      </div>
      <p className="text-xs text-white/40 mb-3">
        {t("artistVault.referenceVideoBlurb", { name: vault.artist_name })}
      </p>

      {vault.reference_video_url ? (
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <video
            src={vault.reference_video_url}
            poster={vault.reference_image_url ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            className="w-36 rounded-xl border border-white/10 object-cover aspect-[9/16]"
          />
          <div className="flex-1">
            <p className="text-sm font-bold text-white mb-1">{t("artistVault.portraitActive")}</p>
            <p className="text-xs text-white/40 mb-3">
              {t("artistVault.portraitHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => { void handleMakeLoop(); }}
                disabled={busy || loopBusy}
                title={t("artistVault.loopTitle")}
                className="gap-2 rounded-xl border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/20 font-bold"
              >
                {loopBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
                {t("artistVault.makeLoop", { credits: LOOP_VIDEO_CREDITS })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { void handleDelete(); }}
                disabled={busy || loopBusy}
                className="text-white/50 hover:text-red-400 gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t("artistVault.removeVideo")}
              </Button>
            </div>
            {loopBusy && loopStage && (
              <p className="mt-2 text-[11px] text-white/40 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {loopStage}
              </p>
            )}
          </div>
        </div>
      ) : confirming ? (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-4">
          <p className="text-sm font-bold text-white mb-1">{t("artistVault.generatePortraitTitle")}</p>
          <p className="text-xs text-white/50 mb-3">
            {t("artistVault.generatePortraitBlurbPrefix", { name: vault.artist_name })}{" "}
            <span className="text-primary font-semibold">{t("artistVault.creditsCount", { credits: REF_VIDEO_CREDITS })}</span> {t("artistVault.generatePortraitBlurbSuffix")}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => { void handleGenerate(); }}
              disabled={busy}
              className="gold-glow font-bold gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {t("artistVault.generatePortraitButton", { credits: REF_VIDEO_CREDITS })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy} className="text-white/50">
              {t("artistVault.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={busy || !hasPhoto}
            title={hasPhoto ? t("artistVault.generatePortraitTitle2") : t("artistVault.savePhotoFirst")}
            className="gap-2 rounded-xl border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/20 font-bold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            {t("artistVault.generatePortrait")}
          </Button>
          {!hasPhoto && (
            <p className="mt-2 text-[11px] text-white/30">{t("artistVault.savePhotoFirst")}</p>
          )}
          {busy && stage && (
            <p className="mt-3 text-xs text-white/50 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> {stage}
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/* ─────────────────────────── WARDROBE ─────────────────────────── */

interface WardrobeOutfit {
  id: string;
  label: string;
  image_url: string;
  image_path: string | null;
  is_default: boolean;
}

/** Must match MAX_OUTFITS_PER_ARTIST in the outfits API route. */
const MAX_OUTFITS = 5;

function WardrobeSection({ vaultId, hasReferencePhoto, refreshKey, onGenerateOutfit }: {
  vaultId: string;
  hasReferencePhoto: boolean;
  refreshKey: number;
  onGenerateOutfit: () => void;
}) {
  const { t } = useTranslation();
  const { getAccessToken, user } = useAuth();
  const [outfits, setOutfits] = useState<WardrobeOutfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const fetchOutfits = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${vaultId}/outfits`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("artistVault.wardrobeLoadFailed"));
      setOutfits(data.outfits ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("artistVault.wardrobeLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOutfits(); }, [vaultId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const wardrobeFull = outfits.length >= MAX_OUTFITS;

  const addOutfit = async (outfitLabel: string, url: string, path: string | null) => {
    if (wardrobeFull) {
      setError(t("artistVault.wardrobeFull", { max: MAX_OUTFITS }));
      return;
    }
    if (!outfitLabel.trim() || !/^https?:\/\//i.test(url.trim())) {
      setError(t("artistVault.outfitNameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${vaultId}/outfits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ label: outfitLabel.trim(), image_url: url.trim(), image_path: path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("artistVault.outfitAddFailed"));
      setLabel("");
      setImageUrl("");
      setShowAdd(false);
      await fetchOutfits();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("artistVault.outfitAddFailed"));
    } finally {
      setBusy(false);
    }
  };

  const uploadOutfitImage = async (file: File, outfitLabel: string) => {
    if (!user) return;
    setUploading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const filePath = `${user.id}/${vaultId}/wardrobe/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await sb.storage
        .from("artist-references")
        .upload(filePath, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = sb.storage.from("artist-references").getPublicUrl(filePath);
      await addOutfit(outfitLabel.trim() || t("artistVault.customOutfit"), publicUrl, filePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("artistVault.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const setDefault = async (id: string) => {
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${vaultId}/outfits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ is_default: true }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("artistVault.setDefaultFailed"));
      await fetchOutfits();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("artistVault.setDefaultFailed"));
    }
  };

  const saveLabel = async (id: string) => {
    if (!editLabel.trim()) { setEditingId(null); return; }
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${vaultId}/outfits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ label: editLabel.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("artistVault.renameFailed"));
      setEditingId(null);
      await fetchOutfits();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("artistVault.renameFailed"));
    }
  };

  const removeOutfit = async (id: string) => {
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${vaultId}/outfits/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("artistVault.removeOutfitFailed"));
      await fetchOutfits();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("artistVault.removeOutfitFailed"));
    }
  };

  return (
    <div data-min-stars="3" className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-white/30 uppercase tracking-wider">{t("artistVault.wardrobeTitle")}</p>
          {wardrobeFull && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-primary/80 bg-primary/10 border border-primary/25">
              {t("artistVault.outfitCount", { count: outfits.length, max: MAX_OUTFITS })}
            </span>
          )}
        </div>
        {!wardrobeFull && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onGenerateOutfit}
              disabled={!hasReferencePhoto}
              title={hasReferencePhoto ? t("artistVault.genOutfitTitle") : t("artistVault.savePhotoForOutfit")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:brightness-110 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              <Camera className="h-3.5 w-3.5" /> {t("artistVault.generateOutfit")}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 hover:text-white bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.10] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> {t("artistVault.addOutfit")}
            </button>
          </div>
        )}
      </div>

      {showAdd && !wardrobeFull && (
        <div className="rounded-lg border border-white/[0.08] bg-black/30 p-3 mb-3 space-y-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("artistVault.outfitNamePlaceholder")}
            className="bg-white/[0.04] border-white/[0.10] text-white text-sm"
          />
          <div className="flex gap-2">
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder={t("artistVault.imageUrlPlaceholder")}
              className="bg-white/[0.04] border-white/[0.10] text-white text-sm flex-1"
            />
            <Button
              type="button"
              disabled={busy}
              onClick={() => addOutfit(label, imageUrl, null)}
              className="shrink-0 font-bold rounded-lg"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("artistVault.addButton")}
            </Button>
          </div>
          <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${uploading ? "opacity-50 pointer-events-none" : "bg-white/[0.06] hover:bg-white/[0.10] text-white/80 hover:text-white border border-white/[0.10]"}`}>
            {uploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("artistVault.uploading")}</> : <><Upload className="h-3.5 w-3.5" /> {t("artistVault.uploadImage")}</>}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label={t("artistVault.uploadOutfitImageAria")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadOutfitImage(file, label);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-white/40 py-4 text-center">{t("artistVault.loadingWardrobe")}</p>
      ) : outfits.length === 0 ? (
        <p className="text-sm text-white/40 py-4 text-center">
          {t("artistVault.noOutfits")}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {outfits.map((o) => (
            <div key={o.id} className="rounded-xl overflow-hidden border border-white/[0.08] bg-black/40">
              <div className="relative aspect-square bg-white/[0.03]">
                <img src={o.image_url} alt={o.label} className="h-full w-full object-cover object-top" loading="lazy" />
                {o.is_default && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide text-black bg-primary">
                    {t("artistVault.defaultBadge")}
                  </span>
                )}
              </div>
              <div className="p-2.5">
                {editingId === o.id ? (
                  <div className="flex gap-1.5">
                    <Input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveLabel(o.id); if (e.key === "Escape") setEditingId(null); }}
                      className="bg-white/[0.04] border-white/[0.10] text-white text-xs h-8"
                      autoFocus
                    />
                    <button type="button" onClick={() => saveLabel(o.id)} className="text-primary hover:brightness-110 shrink-0" title={t("artistVault.saveNameTitle")}>
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-xs font-bold text-white truncate" title={o.label}>{o.label}</p>
                    <button
                      type="button"
                      onClick={() => { setEditingId(o.id); setEditLabel(o.label); }}
                      className="text-white/30 hover:text-white shrink-0 transition-colors"
                      title={t("artistVault.renameOutfit")}
                      aria-label={t("artistVault.renameOutfit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-2">
                  {!o.is_default && (
                    <button
                      type="button"
                      onClick={() => setDefault(o.id)}
                      className="flex-1 px-2 py-1 rounded-lg text-[11px] font-bold text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                      {t("artistVault.setDefault")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeOutfit(o.id)}
                    title={t("artistVault.removeOutfitTitle")}
                    aria-label={t("artistVault.removeOutfitAria")}
                    className="p-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {!hasReferencePhoto && (
        <p className="mt-2 text-[11px] text-white/30">{t("artistVault.savePhotoForOutfit")}</p>
      )}
    </div>
  );
}

function VaultModal({ vault, allVaults, onClose, onEdit, onLock, onSetActive, isActive, onVoiceChanged, wardrobeRefreshKey, onGenerateOutfit }: {
  vault: ArtistVaultRecord; allVaults: ArtistVaultRecord[]; onClose: () => void; onEdit: () => void; onLock: () => void;
  onSetActive: () => void; isActive: boolean; onVoiceChanged: () => Promise<void>;
  wardrobeRefreshKey: number; onGenerateOutfit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} role="button" aria-label={t("artistVault.closeDialog")} tabIndex={-1} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-white/[0.08] bg-[#0a0a0a] p-6 md:p-8 shadow-2xl my-auto">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 rounded-xl overflow-hidden shrink-0">
              {vault.reference_image_url ? (
                <img src={vault.reference_image_url} alt={vault.artist_name} className="h-full w-full object-cover object-top" />
              ) : (
                <div className="h-full w-full bg-primary flex items-center justify-center">
                  <span className="text-white font-black text-xl">
                    {(vault.artist_name || "A")[0].toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-white truncate">{vault.artist_name}</h2>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <SubjectBadge type={normalizeSubjectType(vault.artist_type)} />
                {vault.genre && (
                  <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{vault.genre}</Badge>
                )}
                {vault.visual_style && (
                  <Badge className="bg-white/5 text-white/50 border-white/10 text-xs flex items-center gap-1">
                    <Palette className="h-3 w-3" aria-hidden="true" />
                    {vault.visual_style}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label={t("artistVault.closeButton")} className="text-white/40 hover:text-white transition-colors shrink-0 ml-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        {vault.description && (
          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 mb-3">
            <p className="text-sm text-white/75 whitespace-pre-wrap">{vault.description}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <DetailRow label={t("artistVault.detailVoiceStyle")} value={vault.voice_style} />
          <DetailRow label={t("artistVault.detailPersonality")} value={vault.personality} />
          <DetailRow label={t("artistVault.detailHair")} value={vault.hair} />
          <DetailRow label={t("artistVault.detailTattoos")} value={vault.tattoos} />
          <DetailRow label={t("artistVault.detailJewelry")} value={vault.jewelry} />
          <DetailRow label={t("artistVault.detailClothing")} value={vault.clothing_style} />
          <DetailRow label={t("artistVault.detailBrandColors")} value={vault.brand_colors} />
          <DetailRow label={t("artistVault.detailVisualStyle")} value={vault.visual_style} />
          <DetailRow label={t("artistVault.detailTheme")} value={getCharacterTheme(vault.theme_id).name} />
        </div>

        {vault.do_not_change_rules && (
          <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 mb-3">
            <p className="text-xs text-red-400/80 uppercase tracking-wider font-semibold mb-1">{t("artistVault.doNotChangeTitle")}</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">{vault.do_not_change_rules}</p>
          </div>
        )}

        {vault.special_style_rules && (
          <div className="rounded-xl bg-primary/[0.05] border border-primary/20 p-4 mb-3">
            <p className="text-xs text-primary/80 uppercase tracking-wider font-semibold mb-1">{t("artistVault.specialStyleTitle")}</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">{vault.special_style_rules}</p>
          </div>
        )}

        <LockedVoiceSection vault={vault} onChanged={onVoiceChanged} />

        <ReferenceVideoSection vault={vault} onChanged={onVoiceChanged} />

        <LinkedCharactersSection vault={vault as unknown as ArtistVault} allVaults={allVaults as unknown as ArtistVault[]} />

        <WardrobeSection
          vaultId={vault.id}
          hasReferencePhoto={!!vault.reference_image_url}
          refreshKey={wardrobeRefreshKey}
          onGenerateOutfit={onGenerateOutfit}
        />

        <div className="flex flex-wrap gap-2.5 mt-6 pt-4 border-t border-white/[0.06]">
          <Button
            onClick={onSetActive}
            className={`flex-1 gap-2 font-bold rounded-xl ${
              isActive
                ? "border border-green-500/40 bg-green-500/[0.10] text-green-400 hover:bg-green-500/20"
                : "border border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            {isActive ? <><CheckCircle2 className="h-4 w-4" /> {t("artistVault.activeArtist")}</> : <><User className="h-4 w-4" /> {t("artistVault.setAsActive")}</>}
          </Button>
          <Button onClick={onLock} className="flex-1 gap-2 border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/20 font-bold rounded-xl">
            <Lock className="h-4 w-4" /> {t("artistVault.lockConsistency")}
          </Button>
          <Button onClick={onEdit} className="flex-1 gold-glow font-bold rounded-xl gap-2">
            <Pencil className="h-4 w-4" /> {t("artistVault.editProfile")}
          </Button>
          {vault.reference_image_url && (
            <Button
              onClick={() => downloadImage(vault.reference_image_url!, `${vault.artist_name}-character-sheet.png`)}
              className="flex-1 gap-2 border border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] font-bold rounded-xl"
            >
              <Download className="h-4 w-4" /> {t("artistVault.downloadSheet")}
            </Button>
          )}
          <Button onClick={onClose} variant="ghost" className="text-white/40 hover:text-white rounded-xl px-6">
            {t("artistVault.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function VaultCard({ vault, onOpen, onEdit, onDelete, onLock, onSetActive, onShare, isActive }: {
  vault: ArtistVaultRecord;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLock: () => void;
  onSetActive: () => void;
  onShare: () => void;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const G = (o: number) => `rgba(201,168,76,${o})`;
  const GOLD = "#C9A84C";
  const initials = vault.artist_name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  /* Character's own theme color — name labels shine in the matching color. */
  const vTheme = getCharacterTheme(vault.theme_id);
  const TC = vTheme.primary;

  return (
    <>
    {lightboxOpen && vault.reference_image_url && (
      <PhotoLightbox
        photoUrl={vault.reference_image_url}
        artistName={vault.artist_name}
        onClose={() => setLightboxOpen(false)}
      />
    )}
    <div style={{
      borderRadius: 20,
      border: isActive ? `2px solid ${G(0.55)}` : "1px solid rgba(255,255,255,0.07)",
      boxShadow: isActive ? `0 0 50px ${G(0.15)}, 0 8px 32px rgba(0,0,0,0.6)` : "none",
      overflow: "hidden",
      transition: "all 0.2s ease",
      background: isActive ? "#0d0900" : "#0a0a0a",
    }}>
      {/* Full-photo top section — click to enlarge */}
      <div
        onClick={() => vault.reference_image_url && setLightboxOpen(true)}
        style={{
        height: 220,
        background: vault.reference_image_url
          ? `url(${vault.reference_image_url}) top center/cover no-repeat`
          : isActive
            ? "linear-gradient(135deg, #1a1200 0%, #0d0800 60%, #000 100%)"
            : "linear-gradient(135deg, #111 0%, #0a0a0a 100%)",
        position: "relative",
        cursor: vault.reference_image_url ? "zoom-in" : "default",
      }}>
        {/* Living portrait video — when there's no still photo but a video exists */}
        {!vault.reference_image_url && vault.reference_video_url && (
          <video
            src={vault.reference_video_url}
            autoPlay
            muted
            loop
            playsInline
            ref={(v) => { if (v) v.muted = true; }}
            onEnded={(e) => { const v = e.currentTarget; v.currentTime = 0; v.play().catch(() => {}); }}
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%", objectFit: "cover",
              pointerEvents: "none",
            }}
          />
        )}
        {/* Initials avatar (no photo or video) */}
        {!vault.reference_image_url && !vault.reference_video_url && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: isActive ? `linear-gradient(135deg, ${G(0.25)}, ${G(0.06)})` : "rgba(255,255,255,0.06)",
              border: isActive ? `2px solid ${G(0.45)}` : "1px solid rgba(255,255,255,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: isActive ? `0 0 28px ${G(0.3)}` : "none",
            }}>
              <span style={{ fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 900, color: isActive ? GOLD : "rgba(255,255,255,0.4)" }}>{initials}</span>
            </div>
          </div>
        )}

        {/* ACTIVE badge */}
        {isActive && (
          <div style={{
            position: "absolute", top: 10, right: 10, zIndex: 2,
            display: "flex", alignItems: "center", gap: 4,
            background: "rgba(0,0,0,0.55)", border: `1px solid ${G(0.5)}`,
            borderRadius: 7, padding: "3px 8px",
            backdropFilter: "blur(8px)",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: GOLD, boxShadow: `0 0 5px ${GOLD}` }} />
            <span style={{ fontSize: 8.5, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>{t("artistVault.activeBadge")}</span>
          </div>
        )}

        {/* Name strip at very bottom of photo */}
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 2,
          background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.85) 100%)",
          padding: "36px 14px 12px",
        }}>
          <p style={{
            fontFamily: "Georgia, serif",
            fontSize: isActive ? 16 : 14,
            fontWeight: 900, color: TC,
            letterSpacing: isActive ? "0.04em" : "0",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textShadow: "0 1px 6px rgba(0,0,0,0.9)",
          }}>{vault.artist_name}</p>
            <p style={{ fontSize: 9.5, color: isActive ? themeAlpha(TC, 0.85) : "rgba(255,255,255,0.55)", marginTop: 2, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {SUBJECT_TYPE_META[normalizeSubjectType(vault.artist_type)].label}
            </p>
        </div>

        {/* Gold left accent bar */}
        {isActive && (
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
            background: `linear-gradient(to bottom, ${GOLD}, ${G(0.3)})`,
          }} />
        )}
      </div>

      {/* Action buttons */}
      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Active / Set Active button */}
          <button onClick={onSetActive} style={{
            width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 0", borderRadius: 10,
            border: isActive ? `1px solid ${G(0.4)}` : "1px solid rgba(255,255,255,0.1)",
            background: isActive ? G(0.1) : "rgba(255,255,255,0.03)",
            color: isActive ? GOLD : "rgba(255,255,255,0.5)",
            fontSize: 11.5, fontWeight: 800,
            cursor: "pointer", letterSpacing: "0.04em",
            boxShadow: isActive ? `0 0 12px ${G(0.1)}` : "none",
          }}>
            {isActive
              ? <><CheckCircle2 className="h-3.5 w-3.5" /> {t("artistVault.activeArtist")}</>
              : <><User className="h-3.5 w-3.5" /> {t("artistVault.setAsActive")}</>}
          </button>

          {/* Lock Consistency */}
          <button onClick={onLock} style={{
            width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 0", borderRadius: 10,
            border: `1px solid ${G(0.25)}`,
            background: G(0.06),
            color: GOLD, fontSize: 11.5, fontWeight: 800,
            cursor: "pointer", letterSpacing: "0.04em",
          }}>
            <Lock className="h-3.5 w-3.5" /> {t("artistVault.lockConsistency")}
          </button>

          {/* Row actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {[
              { label: t("artistVault.openButton"), icon: <Eye className="h-3.5 w-3.5" />, fn: onOpen },
              { label: t("artistVault.editButton"), icon: <Pencil className="h-3.5 w-3.5" />, fn: onEdit },
            ].map(({ label, icon, fn }) => (
              <button key={label} onClick={fn} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 12px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                color: "rgba(255,255,255,0.55)",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>{icon} {label}</button>
            ))}
            <button onClick={onShare} title={vault.team_id ? t("artistVault.unshareTitle") : t("artistVault.shareTitle")} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", borderRadius: 8,
              border: vault.team_id ? `1px solid ${G(0.4)}` : "1px solid rgba(255,255,255,0.08)",
              background: vault.team_id ? G(0.1) : "rgba(255,255,255,0.03)",
              color: vault.team_id ? GOLD : "rgba(255,255,255,0.55)",
              fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}><Users className="h-3.5 w-3.5" /> {vault.team_id ? t("artistVault.sharedLabel") : t("artistVault.shareLabel")}</button>
            <button onClick={onDelete} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "6px 10px", borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "transparent",
              color: "rgba(255,255,255,0.3)",
              cursor: "pointer", marginLeft: "auto",
            }}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function ArtistVault() {
  const { t } = useTranslation();
  usePageTitle(t("artistVault.pageTitle"), t("artistVault.pageDescription"));
  const { getAccessToken, user } = useAuth();
  const [vaults, setVaults] = useState<ArtistVaultRecord[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [openVault, setOpenVault] = useState<ArtistVaultRecord | null>(null);
  const [consistencyVault, setConsistencyVault] = useState<ArtistVaultRecord | null>(null);
  const { activeArtist, setActiveArtist } = useActiveArtist();
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genModalMode, setGenModalMode] = useState<ArtistImageModalMode>("generate");
  const [wardrobeGenVaultId, setWardrobeGenVaultId] = useState<string | null>(null);
  const [wardrobeRefreshKey, setWardrobeRefreshKey] = useState(0);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("video_safe");

  const { register, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: {
      artistName: "", artistType: "singer",
      genre: "", voiceStyle: "", visualStyle: "", hair: "", tattoos: "", jewelry: "",
      clothingStyle: "", brandColors: "", themeId: "gold-royalty", personality: "", doNotChangeRules: "",
      artistDescription: "", specialStyleRules: "",
    },
  });

  const watched = watch();
  const isEditing = editId !== null;

  async function fetchVaults(): Promise<ArtistVaultRecord[]> {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/artist-vaults", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = (await res.json()) as { vaults: ArtistVaultRecord[] };
        setVaults(data.vaults);
        return data.vaults;
      }
    } catch {
      /* silent */
    } finally {
      setLoadingVaults(false);
    }
    return [];
  }

  useEffect(() => { fetchVaults(); }, []);

  const PHOTO_BUCKET = "artist-references";
  const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  async function uploadPhoto(file: File) {
    if (!user) return;
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      setPhotoError(t("artistVault.imageTooLarge", { max: MAX_MB }));
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setPhotoError(t("artistVault.allowedTypes"));
      return;
    }
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const sb = getSupabase();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const artistFolder = editId ?? "new";
      const filePath = `${user.id}/${artistFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await sb.storage
        .from(PHOTO_BUCKET)
        .upload(filePath, file, { upsert: true, contentType: file.type });
      if (uploadError) {
        const msg = uploadError.message ?? "";
        if (msg.toLowerCase().includes("bucket") && msg.toLowerCase().includes("not found")) {
          throw new Error(t("artistVault.bucketMissing", { bucket: PHOTO_BUCKET }));
        }
        throw uploadError;
      }
      const { data: { publicUrl } } = sb.storage
        .from(PHOTO_BUCKET)
        .getPublicUrl(filePath);
      setPhotoUrl(publicUrl);
      setPhotoPath(filePath);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : t("artistVault.uploadFailed"));
    } finally {
      setUploadingPhoto(false);
    }
  }

  function removePhoto() {
    // Intentionally non-destructive: this only clears the form. It must NOT
    // delete the file from Supabase storage — that permanently destroyed paid
    // AI generations (e.g. 2-credit artist images) when users just wanted to
    // clear an unsaved form. Orphaned uploads are cheap; regenerating deleted
    // images costs credits. Saved-vault deletion (deleteVault) still removes
    // its file, behind an explicit confirmation.
    setPhotoUrl(null);
    setPhotoPath(null);
  }

  function startNew() {
    setEditId(null);
    reset();
    setPhotoUrl(null);
    setPhotoPath(null);
    setPhotoError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEdit(vault: ArtistVaultRecord) {
    setEditId(vault.id);
    setValue("artistName", vault.artist_name);
    setValue("artistType", normalizeSubjectType(vault.artist_type));
    setValue("genre", vault.genre ?? "");
    setValue("voiceStyle", vault.voice_style ?? "");
    setValue("visualStyle", vault.visual_style ?? "");
    setValue("hair", vault.hair ?? "");
    setValue("tattoos", vault.tattoos ?? "");
    setValue("jewelry", vault.jewelry ?? "");
    setValue("clothingStyle", vault.clothing_style ?? "");
    setValue("brandColors", vault.brand_colors ?? "");
    setValue("themeId", vault.theme_id ?? "gold-royalty");
    setValue("personality", vault.personality ?? "");
    setValue("doNotChangeRules", vault.do_not_change_rules ?? "");
    setValue("artistDescription", vault.description ?? "");
    setValue("specialStyleRules", vault.special_style_rules ?? "");
    setPhotoUrl(vault.reference_image_url ?? null);
    setPhotoPath(vault.reference_image_path ?? null);
    setPhotoError(null);
    setOpenVault(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onSubmit(values: FormValues) {
    setSaving(true);
    setApiError(null);
    setSaveSuccess(false);
    try {
      const token = await getAccessToken();
      const partialVault: ArtistVaultRecord = {
        id: editId ?? "",
        user_id: user?.id ?? "",
        artist_name: values.artistName,
        artist_type: values.artistType || null,
        genre: values.genre || null,
        voice_style: values.voiceStyle || null,
        visual_style: values.visualStyle || null,
        hair: values.hair || null,
        tattoos: values.tattoos || null,
        jewelry: values.jewelry || null,
        clothing_style: values.clothingStyle || null,
        brand_colors: values.brandColors || null,
        theme_id: values.themeId || "gold-royalty",
        personality: values.personality || null,
        do_not_change_rules: values.doNotChangeRules || null,
        description: values.artistDescription || null,
        special_style_rules: values.specialStyleRules || null,
        reference_image_url: photoUrl || null,
        reference_image_path: photoPath || null,
        reference_video_url: null,
        reference_video_path: null,
        consistency_prompt: null,
        voice_id: null,
        voice_name: null,
        voice_preview_url: null,
        is_active: false,
        created_at: "",
      };
      const consistency = generateConsistencyPrompt(partialVault, detailLevel);
      const body = {
        artistName: partialVault.artist_name,
        artistType: partialVault.artist_type,
        genre: partialVault.genre,
        voiceStyle: partialVault.voice_style,
        visualStyle: partialVault.visual_style,
        hair: partialVault.hair,
        tattoos: partialVault.tattoos,
        jewelry: partialVault.jewelry,
        clothingStyle: partialVault.clothing_style,
        brandColors: partialVault.brand_colors,
        themeId: partialVault.theme_id,
        personality: partialVault.personality,
        doNotChangeRules: partialVault.do_not_change_rules,
        artistDescription: partialVault.description,
        specialStyleRules: partialVault.special_style_rules,
        referenceImageUrl: partialVault.reference_image_url,
        referenceImagePath: partialVault.reference_image_path,
        consistencyPrompt: consistency,
      };
      const url = editId ? `/api/artist-vaults/${editId}` : "/api/artist-vaults";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? t("artistVault.saveFailedShort"));
      }
      await fetchVaults();
      setSaveSuccess(true);
      setEditId(null);
      reset();
      setPhotoUrl(null);
      setPhotoError(null);
      setTimeout(() => setSaveSuccess(false), 5000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t("artistVault.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteVault(id: string) {
    if (!window.confirm(t("artistVault.deleteConfirm"))) return;
    try {
      const token = await getAccessToken();
      const vault = vaults.find((v) => v.id === id);
      if (vault?.reference_image_url) {
        try {
          const sb = getSupabase();
          const pathToRemove = vault.reference_image_path ?? (() => {
            const u = new URL(vault.reference_image_url!);
            return u.pathname.split("/artist-references/")[1] ?? null;
          })();
          if (pathToRemove) await sb.storage.from("artist-references").remove([pathToRemove]);
        } catch { /* best-effort */ }
      }
      await fetch(`/api/artist-vaults/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setVaults((prev) => prev.filter((v) => v.id !== id));
      if (editId === id) { setEditId(null); reset(); setPhotoUrl(null); setPhotoPath(null); }
    } catch {
      /* silent */
    }
  }

  async function shareVault(id: string) {
    const vault = vaults.find((v) => v.id === id);
    if (!vault) return;
    const sharing = !vault.team_id;
    if (sharing && !window.confirm(t("artistVault.shareConfirm"))) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${id}/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ share: sharing }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || t("artistVault.shareUpdateFailed"));
        return;
      }
      const data = await res.json().catch(() => ({}));
      setVaults((prev) => prev.map((v) => v.id === id ? { ...v, team_id: data.teamId ?? (sharing ? "shared" : null) } : v));
    } catch {
      /* silent */
    }
  }

  return (
    <div className="min-h-screen bg-black text-white lux-page">

      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      {openVault && (
        <VaultModal
          vault={openVault}
          allVaults={vaults}
          onClose={() => setOpenVault(null)}
          onEdit={() => startEdit(openVault)}
          onLock={() => { setOpenVault(null); setConsistencyVault(openVault); }}
          onSetActive={() => { setActiveArtist(openVault as unknown as ArtistVault); setOpenVault(null); }}
          isActive={activeArtist?.id === openVault?.id}
          onVoiceChanged={async () => {
            const vaults = await fetchVaults();
            const fresh = vaults.find((v) => v.id === openVault?.id);
            if (fresh) setOpenVault(fresh);
          }}
          wardrobeRefreshKey={wardrobeRefreshKey}
          onGenerateOutfit={() => {
            setWardrobeGenVaultId(openVault.id);
            setGenModalMode("photoshoot");
            setShowGenModal(true);
          }}
        />
      )}

      {consistencyVault && (
        <ConsistencyModal
          vault={consistencyVault}
          onClose={() => setConsistencyVault(null)}
        />
      )}

      <GenerateArtistImageModal
        open={showGenModal}
        onClose={() => { setShowGenModal(false); setWardrobeGenVaultId(null); }}
        mode={genModalMode}
        onGenerated={wardrobeGenVaultId
          ? async (url, path) => {
              // Wardrobe flow: a photo-shoot generation becomes a wardrobe outfit.
              const vid = wardrobeGenVaultId;
              setWardrobeGenVaultId(null);
              setShowGenModal(false);
              try {
                const token = await getAccessToken();
                await fetch(`/api/artist-vaults/${vid}/outfits`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
                  body: JSON.stringify({ label: t("artistVault.photoShootLook"), image_url: url, image_path: path }),
                });
                setWardrobeRefreshKey((k) => k + 1);
              } catch {
                /* generation succeeded; the wardrobe section surfaces load errors */
              }
            }
          : genModalMode === "photoshoot"
            ? () => { /* shoot results stay in the modal's gallery; identity photo untouched */ }
            : (url, path) => {
              setPhotoUrl(url);
              setPhotoPath(path);
              setPhotoError(null);
              setShowGenModal(false);
            }}
        initialPrompt={(() => {
          const wv = wardrobeGenVaultId ? (vaults.find((v) => v.id === wardrobeGenVaultId) ?? openVault) : null;
          return wv
            ? `Full-body studio photo of ${wv.artist_name} wearing a brand new signature outfit on a clean light grey studio background — keep the exact same face, identity and art style as the reference photo`
            : buildArtistImagePrompt(watch());
        })()}
        hasReferencePhoto={(() => {
          const wv = wardrobeGenVaultId ? (vaults.find((v) => v.id === wardrobeGenVaultId) ?? openVault) : null;
          return wv ? !!wv.reference_image_url : !!photoUrl;
        })()}
        referenceImageUrl={(() => {
          const wv = wardrobeGenVaultId ? (vaults.find((v) => v.id === wardrobeGenVaultId) ?? openVault) : null;
          return wv ? (wv.reference_image_url ?? null) : photoUrl;
        })()}
        userId={user?.id ?? null}
      />

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          {t("artistVault.backToDashboard")}
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Archive className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-white/5 text-white/40 border-white/10 text-xs font-bold tracking-wide">{t("artistVault.freeBadge")}</Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">{t("artistVault.profilesTitle")}</h1>
          <p className="text-white/50 text-lg max-w-2xl">
            {t("artistVault.profilesSubtitle")}
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {[t("artistVault.tagArtistDescription"), t("artistVault.tagVisualStyle"), t("artistVault.tagHairTattoos"), t("artistVault.tagJewelry"), t("artistVault.tagClothing"), t("artistVault.tagBrandColors"), t("artistVault.tagDoNotChange"), t("artistVault.tagSpecialStyle")].map((tag) => (
              <span key={tag} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/50 px-3 py-1 rounded-full">{tag}</span>
            ))}
          </div>
        </div>

        {/* Status banners */}
        {saveSuccess && (
          <div className="mb-6 flex items-center gap-3 p-4 rounded-xl border border-primary/25 bg-primary/5">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <p className="text-sm font-bold text-white">
              {t("artistVault.profileSaved", { action: isEditing ? t("artistVault.savedActionUpdated") : t("artistVault.savedActionSaved") })}
            </p>
            <button onClick={() => setSaveSuccess(false)} className="ml-auto text-white/30 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {apiError && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-sm text-red-400">{apiError}</p>
          </div>
        )}

        {/* Form card */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05] bg-white/[0.01]">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center">
                <Archive className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-sm font-bold text-white/70 uppercase tracking-wider">
                {isEditing ? t("artistVault.editProfileTitle") : t("artistVault.newProfileTitle")}
              </span>
            </div>
            {isEditing && (
              <button onClick={startNew}
                className="text-xs text-white/30 hover:text-white transition-colors flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> {t("artistVault.newProfileButton")}
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="p-6 md:p-8 space-y-8">

            {/* Row 1: Artist Name */}
            <FieldWrapper label={t("artistVault.fieldArtistName")}>
              <Input
                {...register("artistName", { required: true })}
                placeholder={t("artistVault.stageNamePlaceholder")}
                className={inputClass}
              />
            </FieldWrapper>

            {/* Subject Type */}
            <FieldWrapper label={t("artistVault.fieldSubjectType")} hint={t("artistVault.fieldSubjectTypeHint")}>
              <div data-min-stars="2" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {(Object.keys(SUBJECT_TYPE_META) as SubjectType[]).map((t) => {
                  const meta = SUBJECT_TYPE_META[t];
                  const TypeIcon = meta.icon;
                  const active = watched.artistType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setValue("artistType", t)}
                      className={`rounded-2xl border p-4 text-left transition-all duration-200 ${
                        active
                          ? `${meta.badge} ${meta.glow} border-opacity-70 ring-2 ring-current ring-opacity-30 scale-[1.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]`
                          : "border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] hover:border-white/25 hover:from-white/[0.07] hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <TypeIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className={`text-sm font-bold tracking-wide ${active ? "" : "text-white"}`}>{meta.label}</span>
                      </span>
                      <span className="block mt-2 text-xs text-white/45 leading-relaxed font-medium">{meta.description}</span>
                    </button>
                  );
                })}
              </div>
            </FieldWrapper>

            {/* Personality */}
            <FieldWrapper label={t("artistVault.fieldPersonality")} hint={t("artistVault.fieldPersonalityHint")}>
              <Textarea
                {...register("personality")}
                placeholder={t("artistVault.personalityPlaceholder")}
                className={textareaClass}
                style={{ minHeight: "120px" }}
              />
            </FieldWrapper>

            {/* Artist Description */}
            <FieldWrapper label={t("artistVault.fieldArtistDescription")} hint={t("artistVault.fieldArtistDescriptionHint")}>
              <Textarea
                {...register("artistDescription")}
                placeholder={t("artistVault.descriptionPlaceholder")}
                className={textareaClass}
                style={{ minHeight: "90px" }}
              />
            </FieldWrapper>

            {/* Row 2: Genre + Visual Style */}
            <div data-min-stars="2" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label={t("artistVault.fieldGenre")}>
                <StyledSelect name="genre" placeholder={t("artistVault.selectGenre")} options={GENRES}
                  value={watched.genre} onChange={(v) => setValue("genre", v)} />
              </FieldWrapper>
              <FieldWrapper label={t("artistVault.fieldVisualStyle")}>
                <StyledSelect name="visualStyle" placeholder={t("artistVault.selectVisualStyle")} options={VISUAL_STYLES}
                  value={watched.visualStyle} onChange={(v) => setValue("visualStyle", v)} />
              </FieldWrapper>
            </div>

            {/* Appearance section */}
            <div data-min-stars="3">
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">{t("artistVault.appearanceSection")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label={t("artistVault.fieldHair")} hint={t("artistVault.fieldHairHint")}>
                  <Input {...register("hair")} placeholder={t("artistVault.hairPlaceholder")} className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label={t("artistVault.fieldTattoos")} hint={t("artistVault.fieldTattoosHint")}>
                  <Input {...register("tattoos")} placeholder={t("artistVault.tattoosPlaceholder")} className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label={t("artistVault.fieldJewelry")} hint={t("artistVault.fieldJewelryHint")}>
                  <Input {...register("jewelry")} placeholder={t("artistVault.jewelryPlaceholder")} className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label={t("artistVault.fieldClothing")} hint={t("artistVault.fieldClothingHint")}>
                  <Input {...register("clothingStyle")} placeholder={t("artistVault.clothingPlaceholder")} className={inputClass} />
                </FieldWrapper>
              </div>
            </div>

            {/* Brand section */}
            <div data-min-stars="2">
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">{t("artistVault.brandSection")}</p>
              {/* Character theme picker — their colors, their identity */}
              <div className="mb-5">
                <Label className="text-sm font-semibold text-white/80 mb-1 block">{t("artistVault.characterTheme")}</Label>
                <p className="text-xs text-white/35 mb-3">{t("artistVault.characterThemeHint")}</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {CHARACTER_THEMES.map((theme) => {
                    const selected = (watched.themeId || "gold-royalty") === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setValue("themeId", theme.id)}
                        title={`${theme.name} — ${theme.vibe}`}
                        className="rounded-xl border p-2.5 text-left transition-all cursor-pointer"
                        style={selected ? {
                          borderColor: theme.primary,
                          background: `linear-gradient(135deg, ${theme.primary}26, transparent)`,
                          boxShadow: `0 0 16px ${theme.primary}44`,
                        } : {
                          borderColor: "rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div
                          className="h-8 rounded-lg mb-2"
                          style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.deep})` }}
                        />
                        <p className="text-xs font-bold text-white leading-tight">{theme.name}</p>
                        <p className="text-[10px] text-white/35 leading-tight mt-0.5">{theme.vibe}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label={t("artistVault.fieldBrandColors")} hint={t("artistVault.fieldBrandColorsHint")}>
                  <Input {...register("brandColors")} placeholder={t("artistVault.brandColorsPlaceholder")} className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label={t("artistVault.fieldVoiceStyle")} hint={t("artistVault.fieldVoiceStyleHint")}>
                  <Input {...register("voiceStyle")} placeholder={t("artistVault.voiceStylePlaceholder")} className={inputClass} />
                </FieldWrapper>
              </div>
            </div>

            {/* Artist Photo Upload */}
            <div>
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">{t("artistVault.artistPhotoSection")}</p>
              <div className="flex items-start gap-5">
                {/* Preview */}
                <div className="shrink-0">
                  {photoUrl ? (
                    <div className="relative h-24 w-24 rounded-xl overflow-hidden border border-white/[0.12]">
                      <img src={photoUrl} alt={t("artistVault.artistPhotoAlt")} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-24 w-24 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-white/20" />
                    </div>
                  )}
                </div>
                {/* Controls */}
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-white/40">{t("artistVault.photoHint")}</p>
                  <div className="flex flex-wrap gap-2">
                    <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-primary/60 focus-within:outline-none ${uploadingPhoto ? "opacity-50 pointer-events-none" : "bg-white/[0.06] hover:bg-white/[0.10] text-white/80 hover:text-white border border-white/[0.10]"}`}>
                      {uploadingPhoto ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> {t("artistVault.uploading")}</>
                      ) : (
                        <><Upload className="h-4 w-4" /> {photoUrl ? t("artistVault.replacePhoto") : t("artistVault.uploadPhoto")}</>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        aria-label={photoUrl ? t("artistVault.replacePhotoAria") : t("artistVault.uploadPhotoAria")}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadPhoto(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {photoUrl && (
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-red-400/70 hover:text-red-400 bg-red-500/[0.04] hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 transition-colors"
                      >
                        <X className="h-4 w-4" /> {t("artistVault.removePhoto")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setGenModalMode("generate"); setShowGenModal(true); }}
                      data-testid="btn-generate-artist-image"
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                      <Sparkles className="h-4 w-4" /> {t("artistVault.generateWithAI")}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setGenModalMode("photoshoot"); setShowGenModal(true); }}
                      data-testid="btn-artist-photo-shoot"
                      title={photoUrl ? t("artistVault.photoShootTitle") : t("artistVault.savePhotoForShoot")}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-black bg-primary hover:brightness-110 transition-all gold-glow"
                    >
                      <Camera className="h-4 w-4" /> {t("artistVault.photoShoot")}
                    </button>
                  </div>
                  {photoError && <p className="text-xs text-red-400">{photoError}</p>}
                </div>
              </div>
            </div>

            {/* Do Not Change Rules */}
            <div data-min-stars="4" className="rounded-xl border border-red-500/15 bg-red-500/[0.03] p-5">
              <FieldWrapper label={t("artistVault.doNotChangeTitle")} hint={t("artistVault.doNotChangeHint")}>
                <Textarea
                  {...register("doNotChangeRules")}
                  placeholder={t("artistVault.doNotChangePlaceholder")}
                  className={textareaClass}
                  style={{ minHeight: "110px" }}
                />
              </FieldWrapper>
            </div>

            {/* Special Style Rules */}
            <div data-min-stars="4" className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
              <FieldWrapper label={t("artistVault.specialStyleTitle")} hint={t("artistVault.specialStyleHint")}>
                <Textarea
                  {...register("specialStyleRules")}
                  placeholder={t("artistVault.specialStylePlaceholder")}
                  className={textareaClass}
                  style={{ minHeight: "90px" }}
                />
              </FieldWrapper>
            </div>

            {/* Character Detail Level */}
            <div data-min-stars="5" className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-4">
              <div>
                <p className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">{t("artistVault.detailLevelTitle")}</p>
                <p className="text-xs text-white/35">
                  {t("artistVault.detailLevelHint")}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDetailLevel("video_safe")}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border transition-all ${
                    detailLevel === "video_safe"
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/20"
                  }`}
                >
                  <Video className="h-4 w-4" />
                  <span>{t("artistVault.videoSafe")}</span>
                  {detailLevel === "video_safe" && <span className="text-[10px] opacity-70">{t("artistVault.defaultTag")}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setDetailLevel("high_detail")}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border transition-all ${
                    detailLevel === "high_detail"
                      ? "border-white/30 bg-white/[0.07] text-white"
                      : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/20"
                  }`}
                >
                  <Film className="h-4 w-4" />
                  <span>{t("artistVault.highDetailStill")}</span>
                </button>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
                <p className="text-[11px] text-amber-400/80 leading-relaxed">
                  {t("artistVault.warnPrefix")} <strong>{t("artistVault.videoSafe")}</strong> {t("artistVault.formWarnMiddle")} <strong>{t("artistVault.highDetail")}</strong> {t("artistVault.formWarnSuffix")}
                </p>
              </div>
            </div>

            {/* Submit buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="submit"
                size="lg"
                disabled={saving}
                className="gold-glow font-bold text-base px-10 rounded-xl gap-3"
                style={{ height: "52px" }}
              >
                {saving ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> {t("artistVault.saving")}</>
                ) : isEditing ? (
                  <><Save className="h-5 w-5" /> {t("artistVault.updateProfile")}</>
                ) : (
                  <><Save className="h-5 w-5" /> {t("artistVault.saveProfile")}</>
                )}
              </Button>
              {isEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={startNew}
                  disabled={saving}
                  className="font-bold text-base px-6 rounded-xl text-white/40 hover:text-white"
                  style={{ height: "52px" }}
                >
                  {t("artistVault.cancel")}
                </Button>
              )}
              <p className="w-full text-white/25 text-xs">{t("artistVault.freeNote")}</p>
            </div>

          </form>
        </div>

        {/* Saved Profiles Grid */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-black text-white">{t("artistVault.savedProfiles")}</h2>
              <p className="text-sm text-white/40 mt-1">
                {loadingVaults
                  ? t("artistVault.loading")
                  : vaults.length === 0
                    ? t("artistVault.noProfilesYet")
                    : t("artistVault.profileCount", { count: vaults.length })}
              </p>
            </div>
            {vaults.length > 0 && (
              <button
                onClick={startNew}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-sm text-white/60 hover:text-white hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <Plus className="h-4 w-4" /> {t("artistVault.newProfileButton")}
              </button>
            )}
          </div>

          {loadingVaults ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-white/30" />
            </div>
          ) : vaults.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-10 text-center">
              <Archive className="h-10 w-10 text-white/15 mx-auto mb-3" />
              <p className="text-white/30 text-sm">{t("artistVault.emptyProfiles")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lux-stagger">
              {vaults.map((vault) => (
                <VaultCard
                  key={vault.id}
                  vault={vault}
                  onOpen={() => setOpenVault(vault)}
                  onEdit={() => startEdit(vault)}
                  onDelete={() => deleteVault(vault.id)}
                  onLock={() => setConsistencyVault(vault)}
                  onSetActive={() => setActiveArtist(vault as unknown as ArtistVault)}
                  onShare={() => shareVault(vault.id)}
                  isActive={activeArtist?.id === vault.id}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
