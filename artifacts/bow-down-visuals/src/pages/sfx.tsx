import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioWaveform, Loader2, Sparkles, Download, Trash2, Library,
  Package, Check, Zap, Bomb, Wind, TrendingUp, MousePointerClick,
  Cloud, Footprints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";
import { useTranslation } from "react-i18next";
import {
  loadSfxLibrary,
  saveSfxItem,
  removeSfxItem,
  createZip,
  encodeWav,
  sfxSlug,
  type SfxItem,
} from "@/lib/sfx";

/* ─── Thy Cheat Code's Text-to-SFX ──────────────────────────────────────────
   Describe a sound effect in words — AI generates it. POST /api/generate-sfx
   at 1 credit per SFX (ElevenLabs sound generation). Category keys must stay
   in sync with the backend route's SFX_CATEGORY_KEYS. */

interface SfxCategory {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  blurbKey: string;
}

const CATEGORIES: SfxCategory[] = [
  { key: "impacts", labelKey: "sfx.categoryImpacts", icon: Bomb, blurbKey: "sfx.categoryImpactsBlurb" },
  { key: "whooshes", labelKey: "sfx.categoryWhooshes", icon: Wind, blurbKey: "sfx.categoryWhooshesBlurb" },
  { key: "risers", labelKey: "sfx.categoryRisers", icon: TrendingUp, blurbKey: "sfx.categoryRisersBlurb" },
  { key: "ui", labelKey: "sfx.categoryUi", icon: MousePointerClick, blurbKey: "sfx.categoryUiBlurb" },
  { key: "ambient", labelKey: "sfx.categoryAmbient", icon: Cloud, blurbKey: "sfx.categoryAmbientBlurb" },
  { key: "foley", labelKey: "sfx.categoryFoley", icon: Footprints, blurbKey: "sfx.categoryFoleyBlurb" },
];

const CREDIT_COST = 1;
const MIN_DURATION = 1;
const MAX_DURATION = 10;

interface GenerateResponse {
  url?: string;
  durationSeconds?: number;
  category?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  genHistoryId?: string;
  error?: string;
  message?: string;
  code?: string;
}

interface LibraryResponse {
  items?: { id: string; prompt: string; url: string; createdAt: string }[];
  error?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

/** Decode an MP3 URL to WAV bytes via the Web Audio API. */
async function mp3UrlToWav(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = await res.arrayBuffer();
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("This browser can't decode audio for WAV export.");
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) {
      channels.push(audio.getChannelData(c).slice());
    }
    return encodeWav(channels, audio.sampleRate);
  } finally {
    void ctx.close().catch(() => {});
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}

export default function TextToSfx() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("impacts");
  const [duration, setDuration] = useState(3);
  const [result, setResult] = useState<SfxItem | null>(null);
  const { addAsset } = useHubProject();
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [library, setLibrary] = useState<SfxItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [packing, setPacking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Load the local library, then merge anything the server knows about
     (e.g. generated on another device). */
  useEffect(() => {
    setLibrary(loadSfxLibrary());
    if (!user) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/sfx/library", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json().catch(() => ({}))) as LibraryResponse;
        if (res.ok && Array.isArray(data.items)) {
          setLibrary((prev) => {
            let next = prev;
            for (const it of data.items!) {
              if (!next.some((p) => p.id === it.id || p.url === it.url)) {
                next = saveSfxItem(next, {
                  id: it.id,
                  prompt: it.prompt || t("sfx.soundEffectFallback"),
                  category: "foley",
                  durationSeconds: 0,
                  url: it.url,
                  createdAt: it.createdAt,
                });
              }
            }
            return next;
          });
        }
      } catch {
        /* library merge is a nicety — local list still works */
      }
    })();
  }, [user, getAccessToken]);

  const generate = useCallback(async () => {
    if (loading || !user) return;
    if (prompt.trim().length < 3) {
      setError(t("sfx.errorShortPrompt"));
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/generate-sfx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          durationSeconds: duration,
          category,
        }),
      });
      if (!res) { setLoading(false); return; } // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as GenerateResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        void refreshProfile();
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.message || data.error || t("sfx.errorGenerationFailed"));
      }
      const item: SfxItem = {
        id: data.genHistoryId ?? `${Date.now()}`,
        prompt: prompt.trim(),
        category,
        durationSeconds: data.durationSeconds ?? duration,
        url: data.url,
        createdAt: new Date().toISOString(),
      };
      setResult(item);
      setLibrary((prev) => saveSfxItem(prev, item));
      addAsset({
        kind: "sfx",
        url: item.url,
        label: item.prompt.length > 60 ? item.prompt.slice(0, 60) + "…" : item.prompt,
        detail: `SFX · ${item.category} · ${item.durationSeconds}s`,
      });
      void refreshProfile();
      setTimeout(() => {
        document.getElementById("sfx-result")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        void audioRef.current?.play().catch(() => {});
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sfx.errorGenerationFailed"));
    } finally {
      setLoading(false);
    }
  }, [loading, user, prompt, duration, category, getAccessToken, refreshProfile]);

  async function downloadWav(item: SfxItem) {
    setConverting(item.id);
    setError(null);
    try {
      const wav = await mp3UrlToWav(item.url);
      downloadBlob(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), `${sfxSlug(item.prompt)}.wav`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sfx.errorWavFailed"));
    } finally {
      setConverting(null);
    }
  }

  function downloadMp3(item: SfxItem) {
    const a = document.createElement("a");
    a.href = item.url;
    a.download = `${sfxSlug(item.prompt)}.mp3`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function downloadPack() {
    const items = library.filter((i) => selected.has(i.id));
    if (items.length === 0 || packing) return;
    setPacking(true);
    setError(null);
    try {
      const entries = [];
      for (const item of items) {
        const wav = await mp3UrlToWav(item.url);
        entries.push({ name: `${sfxSlug(item.prompt)}.wav`, data: wav });
      }
      const zip = createZip(entries);
      downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }), `bdv-sfx-pack-${items.length}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sfx.errorPackFailed"));
    } finally {
      setPacking(false);
    }
  }

  function removeItem(id: string) {
    setLibrary((prev) => removeSfxItem(prev, id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (result?.id === id) setResult(null);
  }

  const selectedCount = selected.size;

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Sparkles className="h-3 w-3" aria-hidden="true" /> {t("sfx.heroBadge")}
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            {t("sfx.titleStart")}<span className="text-primary">{t("sfx.titleAccent")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            {t("sfx.heroDescription")}
          </p>
        </div>

        {/* ── generator card ──────────────────────────────────────────── */}
        <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <AudioWaveform className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">{t("sfx.generateCardTitle")}</h2>
              <p className="text-sm text-white/45">
                {t("sfx.generateCardSubtitle", { cost: CREDIT_COST, max: MAX_DURATION })}
              </p>
            </div>
          </div>

          {/* categories */}
          <p data-min-stars="2" className="mt-8 mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("sfx.categoryLabel")}
          </p>
          <div data-min-stars="2" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATEGORIES.map(({ key, labelKey, icon: Icon, blurbKey }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                  category === key
                    ? "border-primary/60 bg-primary/10 shadow-[0_0_18px_rgba(218,165,32,0.18)]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${category === key ? "text-primary" : "text-white/40"}`} aria-hidden="true" />
                <span>
                  <span className="block text-[13px] font-bold">{t(labelKey)}</span>
                  <span className="block text-[11px] text-white/40">{t(blurbKey)}</span>
                </span>
              </button>
            ))}
          </div>

          {/* prompt */}
          <label htmlFor="sfx-prompt" className="mt-6 mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("sfx.promptLabel")}
          </label>
          <textarea
            id="sfx-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("sfx.promptPlaceholder")}
            className={`${inputClass} resize-none`}
            maxLength={500}
          />

          {/* duration */}
          <div data-min-stars="3" className="mt-6 flex items-center gap-4">
            <label htmlFor="sfx-duration" className="text-[11px] font-bold uppercase tracking-widest text-white/40 shrink-0">
              {t("sfx.durationLabel")}
            </label>
            <input
              id="sfx-duration"
              type="range"
              min={MIN_DURATION}
              max={MAX_DURATION}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="flex-1 accent-[#C9A84C] cursor-pointer"
            />
            <span className="w-12 text-right text-sm font-bold tabular-nums text-primary">{duration}s</span>
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={loading || !user}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f7dd7f] to-[#C9A84C] px-6 py-3.5 text-sm font-black uppercase tracking-widest text-black transition hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("sfx.generatingLabel")}</>
            ) : (
              <><Zap className="h-4 w-4" aria-hidden="true" /> {t("sfx.generateButton", { cost: CREDIT_COST })}</>
            )}
          </button>
          {!user && (
            <p className="mt-3 text-center text-xs text-white/40">{t("sfx.signInPrompt")}</p>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
          )}
          {outOfCredits && (
            <div className="mt-6"><OutOfCredits /></div>
          )}
        </div>

        {/* ── result ──────────────────────────────────────────────────── */}
        {result && (
          <div id="sfx-result" className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
            <h2 className="text-lg font-bold">{t("sfx.resultTitle")}</h2>
            <p className="mt-1 text-sm text-white/50 line-clamp-2">“{result.prompt}”</p>
            <audio ref={audioRef} src={result.url} controls className="mt-4 w-full accent-[#C9A84C]" />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadWav(result)}
                disabled={converting === result.id}
                className="flex items-center gap-1.5 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-40"
              >
                {converting === result.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                WAV
              </button>
              <button
                type="button"
                onClick={() => downloadMp3(result)}
                className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 transition hover:border-white/30 hover:text-white"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> MP3
              </button>
            </div>
          </div>
        )}

        {/* ── library ─────────────────────────────────────────────────── */}
        <div className="relative mt-12">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Library className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-bold">{t("sfx.libraryTitle")}</h2>
                <p className="text-sm text-white/45">
                  {library.length === 0
                    ? t("sfx.libraryEmptyDesc")
                    : t("sfx.librarySubtitle", { count: library.length })}
                </p>
              </div>
            </div>
            {selectedCount > 0 && (
              <button
                type="button"
                data-min-stars="5"
                onClick={() => void downloadPack()}
                disabled={packing}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-xs font-black uppercase tracking-widest text-black transition hover:brightness-110 disabled:opacity-40"
              >
                {packing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Package className="h-3.5 w-3.5" aria-hidden="true" />}
                {t("sfx.packButton", { count: selectedCount })}
              </button>
            )}
          </div>

          {library.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-white/15 p-10 text-center text-sm text-white/35">
              {t("sfx.libraryEmpty")}
            </div>
          ) : (
            <ul className="mt-6 space-y-2">
              {library.map((item) => {
                const isSel = selected.has(item.id);
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 rounded-2xl border p-3 transition ${
                      isSel ? "border-primary/60 bg-primary/[0.07]" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelect(item.id)}
                      data-min-stars="5"
                      aria-label={isSel ? t("sfx.deselectLabel") : t("sfx.selectForPackLabel")}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                        isSel ? "border-primary bg-primary text-black" : "border-white/20 text-transparent hover:border-white/40"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.prompt}</p>
                      <p className="text-[11px] uppercase tracking-widest text-white/35">
                        {item.category}{item.durationSeconds > 0 ? ` · ${item.durationSeconds}s` : ""}
                      </p>
                      <audio src={item.url} controls className="mt-2 h-8 w-full accent-[#C9A84C]" preload="none" />
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => void downloadWav(item)}
                        disabled={converting === item.id}
                        className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition hover:border-primary/50 hover:text-primary disabled:opacity-40"
                      >
                        {converting === item.id
                          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          : <Download className="h-3 w-3" aria-hidden="true" />}
                        WAV
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={t("sfx.removeFromLibraryLabel")}
                        className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition hover:border-red-500/50 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" /> Del
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>


    </div>
  );
}
