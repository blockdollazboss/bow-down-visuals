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
  Lock, Copy, Sparkles, User, Video, Zap, Film,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";

import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { getSupabase } from "@/lib/supabase";
import { GenerateArtistImageModal } from "@/components/GenerateArtistImageModal";
import { buildArtistImagePrompt } from "@/components/generate-artist-image";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface ArtistVaultRecord {
  id: string;
  user_id: string;
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
  personality: string | null;
  do_not_change_rules: string | null;
  reference_image_url: string | null;
  reference_image_path: string | null;
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
  personality: string;
  doNotChangeRules: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const ARTIST_TYPES = [
  "Rapper", "Singer", "Producer", "AI Artist",
  "Content Creator", "Label", "Kids Music Creator", "Other",
];

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
    if (vault.reference_image_url) lines.push(`Artist Reference Image URL: ${vault.reference_image_url}`);
    if (vault.do_not_change_rules) lines.push("", `⛔ DO NOT CHANGE: ${vault.do_not_change_rules}`);
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
  if (vault.reference_image_url) lines.push(`Artist Reference Image URL: ${vault.reference_image_url}`);
  if (vault.do_not_change_rules) lines.push("", `⛔ DO NOT CHANGE: ${vault.do_not_change_rules}`);
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
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl border border-primary/30 bg-[#0a0a0a] p-6 md:p-8 shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">Character Consistency Lock</h3>
              <p className="text-xs text-white/40">{vault.artist_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors shrink-0 ml-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Character Detail Level toggle */}
        <div className="mb-5">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Character Detail Level</p>
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
              <Video className="h-4 w-4" /> Video Safe
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
              <Film className="h-4 w-4" /> High Detail
            </button>
          </div>
          <p className="text-[11px] text-white/30 mt-2 leading-relaxed">
            {mode === "video_safe"
              ? "Recommended for Runway video clips. Cleaner jewelry, simpler tattoos, more realistic motion."
              : "Best for thumbnails, cover art, and still images. Full tattoo and jewelry detail."}
          </p>
        </div>

        {/* Warning note */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 mb-5">
          <p className="text-xs text-amber-400/80 leading-relaxed">
            ⚠️ Tiny jewelry, tattoos, and text may vary in AI video. For best realism, use <strong>Video Safe</strong> mode for clips and <strong>High Detail</strong> mode for still images.
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
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/20 transition-all mb-3"
        >
          <Zap className="h-4 w-4" /> Improve Video Realism
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
              <><CheckCircle2 className="h-4 w-4" /> Copied!</>
            ) : (
              <><Copy className="h-4 w-4" /> Copy Prompt</>
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
              <><CheckCircle2 className="h-4 w-4" /> Applied!</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Apply To All Video Prompts</>
            )}
          </button>
        </div>
        {applied && (
          <p className="text-[11px] text-green-400/60 text-center mt-3">
            ✓ Character consistency rules will be included in your video scene prompts.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── STYLE CONSTANTS ─────────────────────────── */

const selectClass =
  "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";
const inputClass =
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";
const textareaClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";

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
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
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
      if (!res.ok) throw new Error(data.error || "Voice cloning failed.");
      setPickerOpen(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice cloning failed.");
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
        setStage("Stripping the song to its vocals…");
        res = await fetch(`/api/artist-vaults/${vault.id}/voice/from-song`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ songId: fileOrId }),
        });
      } else {
        const form = new FormData();
        form.append("song", fileOrId);
        setStage("Uploading the song…");
        res = await fetch(`/api/artist-vaults/${vault.id}/voice/from-song`, {
          method: "POST",
          headers,
          body: form,
        });
      }
      setStage("Cloning the vocals into a voice…");
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(data.error || "Could not build a voice from this song.");
      setSongPickerOpen(false);
      setStage(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build a voice from this song.");
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
      if (!res.ok) throw new Error(data.error || "Could not load songs.");
      setSongs(data.songs ?? []);
      setSongPickerOpen((v) => !v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load songs.");
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
      if (!res.ok) throw new Error(data.error || "Could not load voices.");
      setVoices(data.voices ?? []);
      setPickerOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load voices.");
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
      if (!res.ok) throw new Error("Could not lock this voice.");
      setPickerOpen(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not lock this voice.");
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
      if (!res.ok) throw new Error("Could not remove the voice.");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the voice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">Locked Voice</p>
      </div>
      <p className="text-xs text-white/40 mb-3">
        Every song made for {vault.artist_name} sings in this voice. Same voice, every time.
      </p>

      {vault.voice_id ? (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate">{vault.voice_name ?? "Locked voice"}</p>
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
            title="Remove locked voice"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <label
            className={`inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Clone from recording
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
            Choose a voice
          </Button>
          <label
            className={`inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}
            title="Upload a song — the site strips it to its vocals and clones them"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            From a song
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
            From my songs
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {busy && stage && (
        <p className="mt-3 text-xs text-white/50 flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          {stage} This can take a few minutes — vocal isolation is heavy work.
        </p>
      )}

      {songPickerOpen && !vault.voice_id && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
          <p className="px-3 py-2 text-xs text-white/40">
            Pick a song — its vocals get stripped and cloned into the locked voice (2 credits).
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
            <p className="px-3 py-4 text-sm text-white/40">No songs yet — upload one on the Songs page first.</p>
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
            <p className="px-3 py-4 text-sm text-white/40">No voices found.</p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {!vault.voice_id && (
        <p className="mt-2 text-[11px] text-white/30">
          Tip: upload 30+ seconds of clean singing or talking for the best clone.
        </p>
      )}
    </div>
  );
}

function VaultModal({ vault, onClose, onEdit, onLock, onSetActive, isActive, onVoiceChanged }: {
  vault: ArtistVaultRecord; onClose: () => void; onEdit: () => void; onLock: () => void;
  onSetActive: () => void; isActive: boolean; onVoiceChanged: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
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
                {vault.artist_type && (
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{vault.artist_type}</Badge>
                )}
                {vault.genre && (
                  <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{vault.genre}</Badge>
                )}
                {vault.visual_style && (
                  <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{vault.visual_style}</Badge>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors shrink-0 ml-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <DetailRow label="Voice Style" value={vault.voice_style} />
          <DetailRow label="Personality" value={vault.personality} />
          <DetailRow label="Hair" value={vault.hair} />
          <DetailRow label="Tattoos" value={vault.tattoos} />
          <DetailRow label="Jewelry" value={vault.jewelry} />
          <DetailRow label="Clothing Style" value={vault.clothing_style} />
          <DetailRow label="Brand Colors" value={vault.brand_colors} />
          <DetailRow label="Visual Style" value={vault.visual_style} />
        </div>

        {vault.do_not_change_rules && (
          <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 mb-3">
            <p className="text-xs text-red-400/80 uppercase tracking-wider font-semibold mb-1">⛔ Do Not Change Rules</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">{vault.do_not_change_rules}</p>
          </div>
        )}

        <LockedVoiceSection vault={vault} onChanged={onVoiceChanged} />

        <div className="flex flex-wrap gap-2.5 mt-6 pt-4 border-t border-white/[0.06]">
          <Button
            onClick={onSetActive}
            className={`flex-1 gap-2 font-bold rounded-xl ${
              isActive
                ? "border border-green-500/40 bg-green-500/[0.10] text-green-400 hover:bg-green-500/20"
                : "border border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            {isActive ? <><CheckCircle2 className="h-4 w-4" /> Active Artist</> : <><User className="h-4 w-4" /> Set As Active Artist</>}
          </Button>
          <Button onClick={onLock} className="flex-1 gap-2 border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/20 font-bold rounded-xl">
            <Lock className="h-4 w-4" /> Lock Character Consistency
          </Button>
          <Button onClick={onEdit} className="flex-1 gold-glow font-bold rounded-xl gap-2">
            <Pencil className="h-4 w-4" /> Edit Profile
          </Button>
          <Button onClick={onClose} variant="ghost" className="text-white/40 hover:text-white rounded-xl px-6">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function VaultCard({ vault, onOpen, onEdit, onDelete, onLock, onSetActive, isActive }: {
  vault: ArtistVaultRecord;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLock: () => void;
  onSetActive: () => void;
  isActive: boolean;
}) {
  const G = (o: number) => `rgba(201,168,76,${o})`;
  const GOLD = "#C9A84C";
  const initials = vault.artist_name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");

  return (
    <div style={{
      borderRadius: 20,
      border: isActive ? `2px solid ${G(0.55)}` : "1px solid rgba(255,255,255,0.07)",
      boxShadow: isActive ? `0 0 50px ${G(0.15)}, 0 8px 32px rgba(0,0,0,0.6)` : "none",
      overflow: "hidden",
      transition: "all 0.2s ease",
      background: isActive ? "#0d0900" : "#0a0a0a",
    }}>
      {/* Full-photo top section */}
      <div style={{
        height: 220,
        background: vault.reference_image_url
          ? `url(${vault.reference_image_url}) top center/cover no-repeat`
          : isActive
            ? "linear-gradient(135deg, #1a1200 0%, #0d0800 60%, #000 100%)"
            : "linear-gradient(135deg, #111 0%, #0a0a0a 100%)",
        position: "relative",
      }}>
        {/* Initials avatar (no photo) */}
        {!vault.reference_image_url && (
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
            <span style={{ fontSize: 8.5, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>ACTIVE</span>
          </div>
        )}

        {/* Name strip at very bottom of photo */}
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.85) 100%)",
          padding: "36px 14px 12px",
        }}>
          <p style={{
            fontFamily: "Georgia, serif",
            fontSize: isActive ? 16 : 14,
            fontWeight: 900, color: "#fff",
            letterSpacing: isActive ? "0.04em" : "0",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textShadow: "0 1px 6px rgba(0,0,0,0.9)",
          }}>{vault.artist_name}</p>
          {vault.artist_type && (
            <p style={{ fontSize: 9.5, color: isActive ? G(0.85) : "rgba(255,255,255,0.55)", marginTop: 2, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {vault.artist_type}
            </p>
          )}
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
              ? <><CheckCircle2 className="h-3.5 w-3.5" /> Active Artist</>
              : <><User className="h-3.5 w-3.5" /> Set As Active Artist</>}
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
            <Lock className="h-3.5 w-3.5" /> Lock Character Consistency
          </button>

          {/* Row actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {[
              { label: "Open", icon: <Eye className="h-3.5 w-3.5" />, fn: onOpen },
              { label: "Edit", icon: <Pencil className="h-3.5 w-3.5" />, fn: onEdit },
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
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function ArtistVault() {
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
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("video_safe");

  const { register, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: {
      artistName: "", artistType: "",
      genre: "", voiceStyle: "", visualStyle: "", hair: "", tattoos: "", jewelry: "",
      clothingStyle: "", brandColors: "", personality: "", doNotChangeRules: "",
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
      setPhotoError(`Image must be under ${MAX_MB}MB.`);
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setPhotoError("Allowed types: JPG, JPEG, PNG, WebP.");
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
          throw new Error(`Artist image bucket missing. Create Supabase bucket ${PHOTO_BUCKET}.`);
        }
        throw uploadError;
      }
      const { data: { publicUrl } } = sb.storage
        .from(PHOTO_BUCKET)
        .getPublicUrl(filePath);
      setPhotoUrl(publicUrl);
      setPhotoPath(filePath);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function removePhoto() {
    if (!photoUrl || !user) { setPhotoUrl(null); setPhotoPath(null); return; }
    try {
      const sb = getSupabase();
      const pathToRemove = photoPath ?? (() => {
        const url = new URL(photoUrl);
        return url.pathname.split(`/${PHOTO_BUCKET}/`)[1] ?? null;
      })();
      if (pathToRemove) await sb.storage.from(PHOTO_BUCKET).remove([pathToRemove]);
    } catch { /* best-effort delete */ }
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
    setValue("artistType", vault.artist_type ?? "");
    setValue("genre", vault.genre ?? "");
    setValue("voiceStyle", vault.voice_style ?? "");
    setValue("visualStyle", vault.visual_style ?? "");
    setValue("hair", vault.hair ?? "");
    setValue("tattoos", vault.tattoos ?? "");
    setValue("jewelry", vault.jewelry ?? "");
    setValue("clothingStyle", vault.clothing_style ?? "");
    setValue("brandColors", vault.brand_colors ?? "");
    setValue("personality", vault.personality ?? "");
    setValue("doNotChangeRules", vault.do_not_change_rules ?? "");
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
        personality: values.personality || null,
        do_not_change_rules: values.doNotChangeRules || null,
        reference_image_url: photoUrl || null,
        reference_image_path: photoPath || null,
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
        personality: partialVault.personality,
        doNotChangeRules: partialVault.do_not_change_rules,
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
        throw new Error(err.error ?? "Save failed");
      }
      await fetchVaults();
      setSaveSuccess(true);
      setEditId(null);
      reset();
      setPhotoUrl(null);
      setPhotoError(null);
      setTimeout(() => setSaveSuccess(false), 5000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteVault(id: string) {
    if (!window.confirm("Delete this artist profile? This cannot be undone.")) return;
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

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      {openVault && (
        <VaultModal
          vault={openVault}
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
        onClose={() => setShowGenModal(false)}
        onGenerated={(url, path) => {
          setPhotoUrl(url);
          setPhotoPath(path);
          setPhotoError(null);
          setShowGenModal(false);
        }}
        initialPrompt={buildArtistImagePrompt(watch())}
        hasReferencePhoto={!!photoUrl}
        referenceImageUrl={photoUrl}
        userId={user?.id ?? null}
      />

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Archive className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-white/5 text-white/40 border-white/10 text-xs font-bold tracking-wide">Free</Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">Artist Profiles</h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Save your artist's look, style, colors, and brand once — then load it on any tool to keep all your visuals consistent.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {["Artist Description", "Visual Style", "Hair & Tattoos", "Jewelry", "Clothing", "Brand Colors", "Do Not Change Rules", "Special Style Rules"].map((t) => (
              <span key={t} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/50 px-3 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>

        {/* Status banners */}
        {saveSuccess && (
          <div className="mb-6 flex items-center gap-3 p-4 rounded-xl border border-primary/25 bg-primary/5">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <p className="text-sm font-bold text-white">
              Artist profile {isEditing ? "updated" : "saved"} successfully!
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
                {isEditing ? "Edit Artist Profile" : "New Artist Profile"}
              </span>
            </div>
            {isEditing && (
              <button onClick={startNew}
                className="text-xs text-white/30 hover:text-white transition-colors flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Profile
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="p-6 md:p-8 space-y-8">

            {/* Row 1: Artist Name + Artist Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Artist Name">
                <Input
                  {...register("artistName", { required: true })}
                  placeholder="Your stage name"
                  className={inputClass}
                />
              </FieldWrapper>
              <FieldWrapper label="Artist Type">
                <StyledSelect name="artistType" placeholder="Select type..." options={ARTIST_TYPES}
                  value={watched.artistType} onChange={(v) => setValue("artistType", v)} />
              </FieldWrapper>
            </div>

            {/* Personality */}
            <FieldWrapper label="Personality" hint="Describe your artist's energy, attitude, story, and vibe">
              <Textarea
                {...register("personality")}
                placeholder="e.g. Young Black artist from Atlanta, street-meets-luxury sound, raw emotion with commercial appeal. Known for cinematic visuals and hard-hitting bars. Started with nothing, now building a legacy..."
                className={textareaClass}
                style={{ minHeight: "120px" }}
              />
            </FieldWrapper>

            {/* Row 2: Genre + Visual Style */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Music Genre">
                <StyledSelect name="genre" placeholder="Select genre..." options={GENRES}
                  value={watched.genre} onChange={(v) => setValue("genre", v)} />
              </FieldWrapper>
              <FieldWrapper label="Visual Style">
                <StyledSelect name="visualStyle" placeholder="Select visual style..." options={VISUAL_STYLES}
                  value={watched.visualStyle} onChange={(v) => setValue("visualStyle", v)} />
              </FieldWrapper>
            </div>

            {/* Appearance section */}
            <div>
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">Appearance & Wardrobe</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Hair" hint="Color, length, style, any signature looks">
                  <Input {...register("hair")} placeholder="e.g. long dreads, black with gold tips..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Tattoos" hint="Notable tattoos — placement and description">
                  <Input {...register("tattoos")} placeholder="e.g. neck tattoos, full left sleeve, chest piece..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Jewelry" hint="Chains, rings, watches — your signature pieces">
                  <Input {...register("jewelry")} placeholder="e.g. gold chain cross pendant, diamond studs, AP watch..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Clothing Style" hint="Your signature wardrobe aesthetic">
                  <Input {...register("clothingStyle")} placeholder="e.g. all black designer fits, vintage streetwear, no labels..." className={inputClass} />
                </FieldWrapper>
              </div>
            </div>

            {/* Brand section */}
            <div>
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">Brand Identity</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Brand Colors" hint="Your signature color palette">
                  <Input {...register("brandColors")} placeholder="e.g. black, gold, and deep red..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Voice Style" hint="How your artist sounds — tone, delivery, energy">
                  <Input {...register("voiceStyle")} placeholder="e.g. deep baritone, melodic trap, aggressive delivery..." className={inputClass} />
                </FieldWrapper>
              </div>
            </div>

            {/* Artist Photo Upload */}
            <div>
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">Artist Photo</p>
              <div className="flex items-start gap-5">
                {/* Preview */}
                <div className="shrink-0">
                  {photoUrl ? (
                    <div className="relative h-24 w-24 rounded-xl overflow-hidden border border-white/[0.12]">
                      <img src={photoUrl} alt="Artist" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-24 w-24 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-white/20" />
                    </div>
                  )}
                </div>
                {/* Controls */}
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-white/40">Upload a front-facing photo. Used as your visual reference across all AI tools. Max 10MB (JPG, PNG, WebP).</p>
                  <div className="flex flex-wrap gap-2">
                    <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-primary/60 focus-within:outline-none ${uploadingPhoto ? "opacity-50 pointer-events-none" : "bg-white/[0.06] hover:bg-white/[0.10] text-white/80 hover:text-white border border-white/[0.10]"}`}>
                      {uploadingPhoto ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</>
                      ) : (
                        <><Upload className="h-4 w-4" /> {photoUrl ? "Replace Photo" : "Upload Photo"}</>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        aria-label={photoUrl ? "Replace reference photo" : "Upload reference photo"}
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
                        <X className="h-4 w-4" /> Remove
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowGenModal(true)}
                      data-testid="btn-generate-artist-image"
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                      <Sparkles className="h-4 w-4" /> Generate with AI
                    </button>
                  </div>
                  {photoError && <p className="text-xs text-red-400">{photoError}</p>}
                </div>
              </div>
            </div>

            {/* Do Not Change Rules */}
            <div className="rounded-xl border border-red-500/15 bg-red-500/[0.03] p-5">
              <FieldWrapper label="⛔ Do Not Change Rules" hint="Hard rules the AI must NEVER violate for this artist">
                <Textarea
                  {...register("doNotChangeRules")}
                  placeholder="e.g. Never show the artist without jewelry. Never use cartoon or anime visual style. Do not use pastel or pink colors. Never generate the artist without their signature chain. Never make lyrics sound too soft or pop..."
                  className={textareaClass}
                  style={{ minHeight: "110px" }}
                />
              </FieldWrapper>
            </div>

            {/* Character Detail Level */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-4">
              <div>
                <p className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">Character Detail Level</p>
                <p className="text-xs text-white/35">
                  Controls how tattoos and jewelry are described in AI prompts. Use Video Safe for Runway clips to avoid distorted ink and melted chains.
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
                  <span>Video Safe</span>
                  {detailLevel === "video_safe" && <span className="text-[10px] opacity-70">(default)</span>}
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
                  <span>High Detail Still Image</span>
                </button>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
                <p className="text-[11px] text-amber-400/80 leading-relaxed">
                  ⚠️ Tiny jewelry, tattoos, and text may vary in AI video. For best realism, use <strong>Video Safe</strong> for clips and <strong>High Detail</strong> for thumbnails and still images.
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
                  <><Loader2 className="h-5 w-5 animate-spin" /> Saving...</>
                ) : isEditing ? (
                  <><Save className="h-5 w-5" /> Update Artist Profile</>
                ) : (
                  <><Save className="h-5 w-5" /> Save Artist Profile</>
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
                  Cancel
                </Button>
              )}
              <p className="w-full text-white/25 text-xs">Free — no credits required</p>
            </div>

          </form>
        </div>

        {/* Saved Profiles Grid */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-black text-white">Saved Profiles</h2>
              <p className="text-sm text-white/40 mt-1">
                {loadingVaults
                  ? "Loading..."
                  : vaults.length === 0
                    ? "No profiles saved yet"
                    : `${vaults.length} profile${vaults.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            {vaults.length > 0 && (
              <button
                onClick={startNew}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-sm text-white/60 hover:text-white hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <Plus className="h-4 w-4" /> New Profile
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
              <p className="text-white/30 text-sm">Fill out the form above to save your first artist profile.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vaults.map((vault) => (
                <VaultCard
                  key={vault.id}
                  vault={vault}
                  onOpen={() => setOpenVault(vault)}
                  onEdit={() => startEdit(vault)}
                  onDelete={() => deleteVault(vault.id)}
                  onLock={() => setConsistencyVault(vault)}
                  onSetActive={() => setActiveArtist(vault as unknown as ArtistVault)}
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
