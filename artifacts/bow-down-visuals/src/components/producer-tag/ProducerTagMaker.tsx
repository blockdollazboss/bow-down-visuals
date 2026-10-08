import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Tag, Loader2, Download, Sparkles, Trash2, Share2, Check,
  Disc3, Wand2, Mic, AlertTriangle, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Producer Tag Maker ────────────────────────────────────────────────
   Signature tag studio for producers ("Prod. by Cheat Code", "It's the
   Shark!"). Text -> TTS (OpenAI voices or the user's cloned Artist Vault
   voice) -> server-side ffmpeg effects chain -> MP3/WAV. Tags are saved to
   the hub project as sfx assets so Song Maker can pick them up, and a
   localStorage library keeps the last 20. */

const TAG_COST = CREDIT_COSTS["/api/producer-tag"]?.cost ?? 100;
const LIBRARY_KEY = "bdv-producer-tags-v1";
const LIBRARY_CAP = 20;

const VOICES = [
  { id: "alloy", label: "Alloy", blurb: "Neutral and balanced" },
  { id: "echo", label: "Echo", blurb: "Warm and resonant" },
  { id: "fable", label: "Fable", blurb: "Expressive storyteller" },
  { id: "onyx", label: "Onyx", blurb: "Deep and commanding" },
  { id: "nova", label: "Nova", blurb: "Bright and energetic" },
  { id: "shimmer", label: "Shimmer", blurb: "Soft and clear" },
] as const;

const PRESETS = [
  { id: "dark", icon: "🌑", blurb: "Dropped, menacing, low" },
  { id: "hype", icon: "🔥", blurb: "Loud hype-man energy" },
  { id: "chipmunk", icon: "🐿️", blurb: "Squeaky viral tag" },
  { id: "radio", icon: "📻", blurb: "Megaphone radio voice" },
  { id: "epic", icon: "⚡", blurb: "Reverse-reverb swell" },
] as const;

type PresetId = typeof PRESETS[number]["id"];

interface SavedTag {
  id: string;
  text: string;
  url: string;
  preset: string;
  voiceName: string;
  format: "mp3" | "wav";
  createdAt: number;
}

interface TagResponse {
  url?: string;
  storageRef?: string;
  text?: string;
  voice?: string;
  voiceName?: string;
  preset?: string;
  format?: "mp3" | "wav";
  creditsRemaining?: number;
  error?: string;
  message?: string;
  detail?: string;
}

interface VaultVoiceInfo {
  available: boolean;
  vaultId?: string;
  vaultName?: string;
  voiceName?: string;
}

function loadLibrary(): SavedTag[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedTag[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, LIBRARY_CAP) : [];
  } catch {
    return [];
  }
}

export function ProducerTagMaker() {
  const { t } = useTranslation();
  const { refreshProfile, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset, getShareLink } = useHubProject();

  const [text, setText] = useState("");
  const [voice, setVoice] = useState<string>("alloy");
  const [preset, setPreset] = useState<PresetId>("dark");
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState<SavedTag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [library, setLibrary] = useState<SavedTag[]>(loadLibrary);
  const [showLibrary, setShowLibrary] = useState(true);
  const [vaultVoice, setVaultVoice] = useState<VaultVoiceInfo | null>(null);
  const [shared, setShared] = useState(false);
  const [added, setAdded] = useState(false);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* "My cloned voice" option — only when the user has a vault voice. */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch("/api/producer-tag/vault-voice", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled) return;
        if (res.ok) setVaultVoice((await res.json()) as VaultVoiceInfo);
      } catch {
        /* optional feature — the default voices always work */
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistLibrary = useCallback((tags: SavedTag[]) => {
    setLibrary(tags);
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(tags.slice(0, LIBRARY_CAP)));
    } catch {
      /* storage full — keep the in-memory list */
    }
  }, []);

  async function generate() {
    const tagText = text.trim();
    if (!tagText || generating) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setAdded(false);
    try {
      const res = await confirmedFetch("/api/producer-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: tagText,
          voice: voice === "vault" ? "vault" : voice,
          preset,
          format,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as TagResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.url) {
        setError(data.detail || data.message || data.error || t("producerTag.errorGenerateFailed"));
        return;
      }
      const tag: SavedTag = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: data.text ?? tagText,
        url: data.url,
        preset: data.preset ?? preset,
        voiceName: data.voiceName ?? voice,
        format: data.format ?? format,
        createdAt: Date.now(),
      };
      setCurrent(tag);
      persistLibrary([tag, ...library].slice(0, LIBRARY_CAP));
      if (data.creditsRemaining !== undefined) refreshProfile();
    } catch {
      setError(t("producerTag.errorNetwork"));
    } finally {
      setGenerating(false);
    }
  }

  function deleteTag(id: string) {
    const next = library.filter((tag) => tag.id !== id);
    persistLibrary(next);
    if (current?.id === id) setCurrent(next[0] ?? null);
  }

  function addToProject() {
    if (!current) return;
    addAsset({
      kind: "sfx",
      url: current.url,
      label: `Tag: ${current.text}`,
      detail: `${presetLabel(current.preset)} · ${current.voiceName}`,
      meta: { purpose: "producer-tag", preset: current.preset, voice: current.voiceName, text: current.text },
    });
    setAdded(true);
  }

  function presetLabel(id: string) {
    return PRESETS.find((p) => p.id === id)?.icon
      ? `${PRESETS.find((p) => p.id === id)!.icon} ${t(`producerTag.presets.${id}` as never)}`
      : id;
  }

  async function shareTag() {
    if (!current) return;
    const shareLink = getShareLink();
    const copy = t("producerTag.shareText", {
      text: current.text,
      url: current.url,
      link: shareLink,
    });
    try {
      await navigator.clipboard.writeText(copy);
    } catch {
      /* clipboard blocked — still show the text below */
    }
    setShared(true);
    if (shareTimer.current) clearTimeout(shareTimer.current);
    shareTimer.current = setTimeout(() => setShared(false), 2500);
  }

  const trimmed = text.trim();
  const canGenerate = trimmed.length > 0 && !generating;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* ── Studio ── */}
      <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center">
            <Tag className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-white font-bold text-lg leading-tight">{t("producerTag.title")}</h3>
            <p className="text-white/50 text-sm">{t("producerTag.subtitle")}</p>
          </div>
        </div>

        <div>
          <Label className="text-white/70 text-sm mb-2 block">{t("producerTag.textLabel")}</Label>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 120))}
            placeholder={t("producerTag.textPlaceholder")}
            maxLength={120}
            className="h-12 bg-white/[0.04] border-white/[0.08] text-white text-base placeholder:text-white/25 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 rounded-xl"
          />
          <p className="text-xs text-white/30 mt-1.5 text-right">{text.length}/120</p>
        </div>

        <div>
          <Label className="text-white/70 text-sm mb-2 flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5" /> {t("producerTag.voiceLabel")}
          </Label>
          <div className="flex flex-wrap gap-2">
            {VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVoice(v.id)}
                title={v.blurb}
                className={`px-3.5 py-2 rounded-full text-sm border transition-colors ${
                  voice === v.id
                    ? "bg-primary text-black border-primary font-semibold"
                    : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
                }`}
              >
                {v.label}
              </button>
            ))}
            {vaultVoice?.available && (
              <button
                key="vault"
                type="button"
                onClick={() => setVoice("vault")}
                title={t("producerTag.vaultVoiceBlurb", { name: vaultVoice.vaultName ?? "" })}
                className={`px-3.5 py-2 rounded-full text-sm border transition-colors flex items-center gap-1.5 ${
                  voice === "vault"
                    ? "bg-primary text-black border-primary font-semibold"
                    : "border-primary/40 text-primary hover:bg-primary/10"
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" /> {t("producerTag.vaultVoice")}
              </button>
            )}
          </div>
        </div>

        <div>
          <Label className="text-white/70 text-sm mb-2 block">{t("producerTag.presetLabel")}</Label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`rounded-xl border px-3 py-3 text-center transition-all ${
                  preset === p.id
                    ? "border-primary bg-primary/15 shadow-[0_0_18px_rgba(212,175,55,0.25)]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25"
                }`}
              >
                <div className="text-2xl leading-none">{p.icon}</div>
                <div className={`text-xs font-bold mt-1.5 ${preset === p.id ? "text-primary" : "text-white/80"}`}>
                  {t(`producerTag.presets.${p.id}` as never)}
                </div>
                <div className="text-[10px] text-white/40 mt-0.5 leading-tight">{p.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Label className="text-white/70 text-sm">{t("producerTag.formatLabel")}</Label>
          <div className="flex gap-2 p-1 rounded-xl bg-white/[0.04] border border-white/10">
            {(["mp3", "wav"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                  format === f ? "bg-primary text-black" : "text-white/60 hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <Button
          onClick={generate}
          disabled={!canGenerate}
          className="w-full h-12 rounded-xl bg-primary text-black font-bold hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {t("producerTag.cookingButton")}</>
          ) : (
            <><Sparkles className="w-5 h-5 mr-2" /> {t("producerTag.generateButton", { cost: TAG_COST.toLocaleString("en-US") })} <VisualBucsIcon className="w-4 h-4 ml-1" /></>
          )}
        </Button>

        {/* ── Result ── */}
        {current && (
          <div className="rounded-xl bg-black/40 border border-primary/30 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white font-bold truncate">“{current.text}”</p>
                <p className="text-white/40 text-xs mt-0.5">
                  {presetLabel(current.preset)} · {current.voiceName} · {current.format.toUpperCase()}
                </p>
              </div>
            </div>
            <audio src={current.url} controls className="w-full" />
            <div className="grid grid-cols-2 gap-2">
              <a
                href={current.url}
                download={`producer-tag-${current.text.slice(0, 24).replace(/[^a-z0-9]+/gi, "-")}.${current.format}`}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Download className="w-4 h-4" /> {t("producerTag.download")}
              </a>
              <button
                type="button"
                onClick={addToProject}
                className={`flex items-center justify-center gap-2 h-10 rounded-xl border text-sm font-medium transition-colors ${
                  added
                    ? "border-emerald-400/50 text-emerald-300"
                    : "border-primary/40 text-primary hover:bg-primary/10"
                }`}
              >
                {added ? <Check className="w-4 h-4" /> : <Disc3 className="w-4 h-4" />}
                {added ? t("producerTag.addedToBeat") : t("producerTag.addToBeat")}
              </button>
              <button
                type="button"
                onClick={shareTag}
                className={`col-span-2 flex items-center justify-center gap-2 h-10 rounded-xl border text-sm font-medium transition-colors ${
                  shared
                    ? "border-emerald-400/50 text-emerald-300"
                    : "border-white/15 text-white/80 hover:border-white/30 hover:text-white"
                }`}
              >
                {shared ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {shared ? t("producerTag.shareCopied") : t("producerTag.shareButton")}
              </button>
            </div>
            {added && (
              <p className="text-xs text-white/50 text-center">
                {t("producerTag.addedHint")} <Link href="/make-song" className="text-primary font-semibold hover:underline">{t("producerTag.openSongMaker")}</Link>
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Saved library ── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <button
          type="button"
          onClick={() => setShowLibrary((v) => !v)}
          className="w-full flex items-center justify-between mb-4"
        >
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Tag className="w-4 h-4 text-primary" /> {t("producerTag.libraryTitle")}
            <span className="text-xs text-white/40 font-normal">({library.length}/{LIBRARY_CAP})</span>
          </h3>
          <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${showLibrary ? "" : "-rotate-90"}`} />
        </button>
        {showLibrary && (
          library.length > 0 ? (
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {library.map((tag) => (
                <div
                  key={tag.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    current?.id === tag.id ? "border-primary/50 bg-primary/[0.07]" : "border-white/10 bg-black/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrent(tag)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="text-white text-sm font-semibold truncate">“{tag.text}”</p>
                      <p className="text-white/35 text-[11px] mt-0.5">
                        {presetLabel(tag.preset)} · {tag.voiceName}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTag(tag.id)}
                      title={t("producerTag.deleteTag")}
                      className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 rounded-xl border border-dashed border-white/15 flex flex-col items-center justify-center text-center p-6">
              <Tag className="w-8 h-8 text-white/20 mb-3" />
              <p className="text-white/40 text-sm">{t("producerTag.libraryEmpty")}</p>
            </div>
          )
        )}
      </div>

      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
    </div>
  );
}
