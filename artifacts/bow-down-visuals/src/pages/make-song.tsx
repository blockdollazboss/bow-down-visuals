import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import { Music, ArrowLeft, ChevronRight, Loader2, Upload, Sparkles, Disc3, Blend, Mic, Tag, Users, Timer } from "lucide-react";
import InspoTab, { type InspoGeneratedData } from "@/components/InspoTab";
import { AudioTranscribe } from "@/components/AudioTranscribe";
import SongMashup from "@/components/SongMashup";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { AssetHandoffs } from "@/components/hub/AssetHandoffs";
import { CoverSongModal } from "@/components/song/CoverSongModal";
import { PublishToProfileButton } from "@/components/publish/PublishToProfileButton";
import { VocalPolishModal } from "@/components/song/VocalPolishModal";
import { HarmonyGeneratorModal } from "@/components/song/HarmonyGeneratorModal";
import { LrcExportModal } from "@/components/song/LrcExportModal";
import type { HubAsset } from "@/lib/hub-project";
import { useHubProject } from "@/lib/hub-project";
import { pushSongPackageToProject, extractSongPackage } from "@/lib/hub-song";
import { useToast } from "@/hooks/use-toast";
import { GenerationResult } from "@/components/GenerationResult";
import { HumToSong } from "@/components/HumToSong";
import { SongReworkPanel } from "@/components/SongReworkPanel";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface SongFormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  songTopic: string;
  cleanOrExplicit: string;
  voiceStyle: string;
  beatStyle: string;
  songLength: string;
  specialInstructions: string;
}

/* ─────────────────────────── DROPDOWN OPTIONS ─────────────────────────── */

const GENRES: Array<{ value: string; labelKey: string }> = [
  { value: "Hip Hop", labelKey: "makeSong.genreHipHop" },
  { value: "Drill", labelKey: "makeSong.genreDrill" },
  { value: "Trap", labelKey: "makeSong.genreTrap" },
  { value: "R&B", labelKey: "makeSong.genreRB" },
  { value: "Pop", labelKey: "makeSong.genrePop" },
  { value: "Afrobeats", labelKey: "makeSong.genreAfrobeats" },
  { value: "Dancehall", labelKey: "makeSong.genreDancehall" },
  { value: "Gospel", labelKey: "makeSong.genreGospel" },
  { value: "Kids Music", labelKey: "makeSong.genreKidsMusic" },
  { value: "Rock", labelKey: "makeSong.genreRock" },
  { value: "Country", labelKey: "makeSong.genreCountry" },
  { value: "Other", labelKey: "makeSong.genreOther" },
];

const MOODS: Array<{ value: string; labelKey: string }> = [
  { value: "Luxury", labelKey: "makeSong.moodLuxury" },
  { value: "Dark", labelKey: "makeSong.moodDark" },
  { value: "Emotional", labelKey: "makeSong.moodEmotional" },
  { value: "Street", labelKey: "makeSong.moodStreet" },
  { value: "Romantic", labelKey: "makeSong.moodRomantic" },
  { value: "Energetic", labelKey: "makeSong.moodEnergetic" },
  { value: "Pain", labelKey: "makeSong.moodPain" },
  { value: "Victory", labelKey: "makeSong.moodVictory" },
  { value: "Party", labelKey: "makeSong.moodParty" },
  { value: "Inspirational", labelKey: "makeSong.moodInspirational" },
  { value: "Funny", labelKey: "makeSong.moodFunny" },
  { value: "Kid-Friendly", labelKey: "makeSong.moodKidFriendly" },
];

const LENGTHS: Array<{ value: string; labelKey: string }> = [
  { value: "30 seconds", labelKey: "makeSong.length30s" },
  { value: "60 seconds", labelKey: "makeSong.length60s" },
  { value: "2 minutes", labelKey: "makeSong.length2min" },
  { value: "Full song", labelKey: "makeSong.lengthFull" },
];



/* ─────────────────────────── FORM FIELD WRAPPERS ─────────────────────────── */

function FieldWrapper({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{label}</Label>
      {children}
      {hint && <p className="text-xs text-white/30 leading-snug mt-1">{hint}</p>}
    </div>
  );
}

const inputClass =
  "h-11 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 placeholder:text-white/25 focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 rounded-xl hover:border-white/[0.18]";

const selectClass =
  "h-11 w-full rounded-xl bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 text-sm focus:outline-none focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 appearance-none cursor-pointer hover:border-white/[0.18]";

function StyledSelect({
  name,
  placeholder,
  options,
  value,
  onChange,
}: {
  name: string;
  placeholder: string;
  options: Array<{ value: string; labelKey: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
        style={{ colorScheme: "dark" }}
      >
        <option value="" disabled style={{ background: "#111" }}>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "#111" }}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function MakeSong() {
  const { t } = useTranslation();
  usePageTitle(t("makeSong.pageTitle"), t("makeSong.pageDescription"));
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [mode, setMode] = useState<"simple" | "custom" | "inspo">("simple");
  /* Mashup tab — docked Song Mashup (Suno parity), no separate page.
     "hum" — docked Hum-to-Song (Suno parity), no separate page. */
  const [mashupTab, setMashupTab] = useState<"create" | "mashup" | "hum">("create");
  const [mashupA, setMashupA] = useState<string | null>(null);
  const [mashupB, setMashupB] = useState<string | null>(null);
  const [simplePrompt, setSimplePrompt] = useState("");
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(null);
  const [uploadedLyrics, setUploadedLyrics] = useState<string>("");
  const [uploadedSongUrl, setUploadedSongUrl] = useState<string | null>(null);
  const [uploadedSongFile, setUploadedSongFile] = useState<File | null>(null);
  const [projectBeat, setProjectBeat] = useState<HubAsset | null>(null);
  /* Cover Song (Suno Cover parity) — modal over the finished song. */
  const [coverOpen, setCoverOpen] = useState(false);
  /* AI Vocal Polish (Suno parity) — modal over the finished song. */
  const [polishOpen, setPolishOpen] = useState(false);
  /* AI Harmony Generator (Suno parity) — modal over the finished song. */
  const [harmonyOpen, setHarmonyOpen] = useState(false);
  /* Synced Lyrics Export (.lrc) — tap-to-sync (free) or AI align, docked with the other song actions. */
  const [lrcOpen, setLrcOpen] = useState(false);
  const { toast } = useToast();
  const {
    setProjectName, setProjectType, setProjectConcept,
    addAsset, hasKind, latestOfKind, project,
  } = useHubProject();

  /* Deep-link protocols:
     - /make-song?audioUrl=… pre-fills an extracted audio track as the song.
     - /make-song?mode=inspo opens the Inspo tab (shared vibe links).
     - /make-song?tab=mashup&songA=<id>&songB=<id> opens the Mashup tab
       with songs pre-selected (from "Mashup with another" links). */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const audioUrl = params.get("audioUrl");
      if (audioUrl) {
        setUploadedSongUrl(audioUrl);
        window.history.replaceState(null, "", window.location.pathname);
      }
      if (params.get("mode") === "inspo") {
        setMode("inspo");
        window.history.replaceState(null, "", window.location.pathname);
      }
      const deepA = params.get("songA");
      const deepB = params.get("songB");
      if (params.get("tab") === "mashup" || deepA) {
        setMashupTab("mashup");
        if (deepA) setMashupA(deepA);
        if (deepB) setMashupB(deepB);
        window.history.replaceState(null, "", window.location.pathname);
      } else if (params.get("tab") === "hum") {
        setMashupTab("hum");
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<SongFormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      songTopic: "", cleanOrExplicit: "", voiceStyle: "",
      beatStyle: "", songLength: "", specialInstructions: "",
    },
  });

  const watched = watch();

  function handleVaultLoad(vault: ArtistVault) {
    if (!watched.artistName) setValue("artistName", vault.artist_name);
    if (!watched.genre && vault.genre) setValue("genre", vault.genre);
    setLoadedVault(vault);
  }

  async function onSubmit(values: SongFormValues) {
    await generateSong({
      artistName: values.artistName,
      songTitle: values.songTitle,
      genre: values.genre,
      mood: values.mood,
      songTopic: values.songTopic,
      explicit: values.cleanOrExplicit,
      voiceStyle: values.voiceStyle,
      beatStyle: values.beatStyle,
      songLength: values.songLength,
      instructions: values.specialInstructions,
    });
  }

  async function onSimpleSubmit() {
    if (!simplePrompt.trim()) return;
    await generateSong({
      artistName: "",
      songTitle: "",
      genre: "",
      mood: "",
      songTopic: simplePrompt.trim(),
      explicit: "",
      voiceStyle: "",
      beatStyle: "",
      songLength: "",
      instructions: "Create a complete song from this description. Write the lyrics and choose the style automatically.",
    });
  }

  async function generateSong(params: {
    artistName: string; songTitle: string; genre: string; mood: string;
    songTopic: string; explicit: string; voiceStyle: string;
    beatStyle: string; songLength: string; instructions: string;
  }) {
    setLoading(true);
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const result = await callGenerateApi("/api/generate-song", {
        ...params,
        artistVault: loadedVault,
      }, token, confirmedFetch);
      if (!result) return;
      const { rawResult, creditsRemaining } = result;
      handleSongSuccess(rawResult, creditsRemaining, {
        artistName: params.artistName,
        songTitle: params.songTitle,
        genre: params.genre,
        mood: params.mood,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("makeSong.generationFailed");
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* Shared success path for all three modes (Simple / Custom / Inspo):
     the finished song package flows into the hub project — name, concept,
     lyrics, video idea, cover prompt — so Video Studio, Thumbnail Maker,
     Promo Clips, Hook Studio and Scheduler pick it up with zero re-typing. */
  function handleSongSuccess(
    rawResult: string,
    creditsRemaining: number | undefined,
    meta: { artistName: string; songTitle: string; genre: string; mood: string },
  ) {
    setRawResult(rawResult);
    try {
      pushSongPackageToProject({
        artistName: meta.artistName,
        songTitle: meta.songTitle,
        genre: meta.genre,
        mood: meta.mood,
        rawResult,
        audioUrl: null,
        setProjectName,
        setProjectType,
        setProjectConcept,
        addAsset,
        hasKind,
        latestOfKind,
      });
      toast({ title: t("hubSpine.songSavedTitle"), description: t("hubSpine.songSavedDesc") });
    } catch {
      /* hub push is best-effort — the song result itself already rendered */
    }
    if (creditsRemaining !== undefined) refreshProfile();
    setTimeout(() => {
      document.getElementById("song-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  /* Inspo Mode callback — sync inspo's artist/title/genre/mood into the
     shared form state so the result block + handoffs read them normally. */
  function handleInspoGenerated(data: InspoGeneratedData) {
    if (data.artistName) setValue("artistName", data.artistName, { shouldDirty: true });
    if (data.songTitle) setValue("songTitle", data.songTitle, { shouldDirty: true });
    if (data.genre) setValue("genre", data.genre, { shouldDirty: true });
    if (data.mood) setValue("mood", data.mood, { shouldDirty: true });
    handleSongSuccess(data.rawResult, data.creditsRemaining, {
      artistName: data.artistName,
      songTitle: data.songTitle,
      genre: data.genre,
      mood: data.mood,
    });
  }

  /* Spine: an uploaded song also joins the hub project — audio + transcribed
     lyrics travel to Video Studio / Editor / Promo Clips like a generated one. */
  useEffect(() => {
    if (!uploadedSongUrl || uploadedSongUrl.startsWith("blob:")) return;
    try {
      pushSongPackageToProject({
        artistName: watched.artistName,
        songTitle: watched.songTitle || uploadedSongFile?.name?.replace(/\.[^.]+$/, "") || "",
        genre: watched.genre,
        mood: watched.mood,
        rawResult: uploadedLyrics ? `## FULL LYRICS\n${uploadedLyrics}` : "",
        audioUrl: uploadedSongUrl,
        setProjectName,
        setProjectType,
        setProjectConcept,
        addAsset,
        hasKind,
        latestOfKind,
      });
    } catch {
      /* best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedSongUrl]);

  return (
    <div className="min-h-screen bg-black text-white lux-page">

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          {t("makeSong.backToDashboard")}
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <Music className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">{t("makeSong.priceBadge")}</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {t("makeSong.title")}
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            {t("makeSong.subtitle")}
          </p>
        </div>

        <ProjectFlowBar
          kinds={["beat"]}
          actionLabel={t("makeSong.buildOnIt")}
          onPick={(beat) => {
            setProjectBeat(beat);
            const genre = beat.meta?.genre;
            const bpm = beat.meta?.bpm;
            if (!watched.beatStyle) {
              setValue("beatStyle", genre && bpm ? `${genre} at ${bpm} BPM` : beat.label, { shouldDirty: true });
            }
            if (genre && !watched.genre) setValue("genre", genre, { shouldDirty: true });
          }}
        />

        {projectBeat && (
          <div className="rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 mb-6 flex items-center gap-3">
            <audio src={projectBeat.url} controls className="h-8 flex-1 min-w-0" />
            <p className="text-xs text-white/60 shrink-0">
              {t("makeSong.buildingOnPrefix")}<span className="text-white font-semibold">{projectBeat.label}</span>
            </p>
          </div>
        )}

        {/* Create / Mashup tabs — Mashup is docked inside Song Maker (no separate page) */}
        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={() => setMashupTab("create")}
            className={`px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${
              mashupTab === "create"
                ? "bg-primary text-black font-bold"
                : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/10"
            }`}
          >
            <Music className="h-4 w-4" />
            {t("mashup.tabCreate")}
          </button>
          <button
            type="button"
            onClick={() => setMashupTab("mashup")}
            className={`px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${
              mashupTab === "mashup"
                ? "bg-primary text-black font-bold"
                : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/10"
            }`}
          >
            <Blend className="h-4 w-4" />
            {t("mashup.tabMashup")}
          </button>
          <button
            type="button"
            onClick={() => setMashupTab("hum")}
            className={`px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${
              mashupTab === "hum"
                ? "bg-primary text-black font-bold"
                : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/10"
            }`}
          >
            <Mic className="h-4 w-4" />
            Hum it
          </button>
        </div>

        {mashupTab === "hum" ? (
          <div className="lux-card-static p-6 md:p-8">
            <HumToSong />
          </div>
        ) : mashupTab === "mashup" ? (
          <div className="lux-card-static p-6 md:p-8">
            <SongMashup preselectA={mashupA} preselectB={mashupB} />
          </div>
        ) : (
        <>
        {/* Form card */}
        <div className="lux-card-static p-6 md:p-8">
          {/* Producer Tag Maker — secondary entry (lives in Beat Maker, no sidebar sprawl) */}
          <Link
            href="/beat-maker?tab=tag"
            className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 hover:bg-primary/[0.12] transition-colors group"
          >
            <span className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center shrink-0">
              <Tag className="w-4 h-4 text-primary" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-white">{t("producerTag.songMakerEntry")}</span>
              <span className="block text-xs text-white/50">“It's the Shark!” — your signature drop, 5 effect presets</span>
            </span>
            <span className="text-sm font-semibold text-primary group-hover:underline whitespace-nowrap">
              {t("producerTag.songMakerEntryCta")}
            </span>
          </Link>
          {/* Simple / Custom / Inspo mode toggle - Suno pattern */}
          <div className="flex gap-2 mb-6 flex-wrap">
            <button
              type="button"
              onClick={() => setMode("simple")}
              className={`px-5 py-2.5 rounded-xl font-medium transition-all ${
                mode === "simple"
                  ? "bg-primary text-black"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={`px-5 py-2.5 rounded-xl font-medium transition-all ${
                mode === "custom"
                  ? "bg-primary text-black"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              Custom
            </button>
            <button
              type="button"
              onClick={() => setMode("inspo")}
              className={`px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${
                mode === "inspo"
                  ? "bg-primary text-black"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              <Sparkles className="h-4 w-4" />
              Inspo
            </button>
          </div>

          {mode === "inspo" ? (
            /* Inspo mode — playlist vibe → style DNA → song */
            <InspoTab
              getAccessToken={getAccessToken}
              confirmedFetch={confirmedFetch}
              refreshProfile={refreshProfile}
              onGenerated={handleInspoGenerated}
              onOutOfCredits={() => { setOutOfCredits(true); refreshProfile(); }}
            />
          ) : mode === "simple" ? (
            /* Simple mode - one text box, AI does everything */
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Describe your song
                </label>
                <textarea
                  value={simplePrompt}
                  onChange={(e) => setSimplePrompt(e.target.value)}
                  placeholder="A upbeat pop song about summer love, catchy chorus..."
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
                />
                <p className="text-xs text-white/40 mt-2">
                  Just describe it — AI writes the lyrics, picks the style, and generates the song.
                </p>
              </div>

              {/* One-click genre presets */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Quick styles
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "🎵 Pop Hit", prompt: "catchy pop song with memorable chorus" },
                    { label: "🎤 Hip Hop", prompt: "hard-hitting hip hop track with confident flow" },
                    { label: "🎸 Rock Anthem", prompt: "powerful rock anthem with epic guitars" },
                    { label: "💃 Dance", prompt: "high-energy dance track with infectious beat" },
                    { label: "😢 Ballad", prompt: "emotional ballad with heartfelt lyrics" },
                    { label: "🌙 Lo-Fi", prompt: "chill lo-fi track with mellow vibes" },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setSimplePrompt(preset.prompt)}
                      className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm hover:border-primary/50 hover:bg-primary/5 transition-all"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={onSimpleSubmit}
                disabled={!simplePrompt.trim() || loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-primary text-black font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all"
              >
                {loading ? "Generating..." : "Generate Song"}
              </button>
            </div>
          ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

            {/* Upload your own song — skip generation, go straight to video */}
            <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.015] p-5">
              <div className="flex items-center gap-2.5 mb-1.5">
                <Upload className="h-4 w-4 text-primary" />
                <p className="text-sm font-bold text-white">{t("makeSong.haveSongTitle")}</p>
              </div>
              <p className="text-xs text-white/35 mb-3 leading-relaxed">
                {t("makeSong.haveSongHint")}
              </p>
              <AudioTranscribe
                onTranscript={(text) => setUploadedLyrics(text)}
                onFileUrl={(url) => setUploadedSongUrl(url)}
                onFile={(f) => setUploadedSongFile(f)}
              />
              {uploadedSongUrl && (
                <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <p className="text-xs text-white/40 flex-1">
                    {t("makeSong.songReady", { name: uploadedSongFile ? uploadedSongFile.name : t("makeSong.yourSong") })}
                    {uploadedLyrics && <> {t("makeSong.lyricsTranscribed")}</>} {t("makeSong.headToStep2")}
                  </p>
                  <Link href="/make-video">
                    <Button type="button" size="sm" className="gold-glow font-bold gap-1.5 whitespace-nowrap">
                      {t("makeSong.continueToStep2")} <ChevronRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}
            </div>

            {/* Artist vault preset pick — gated at level 2 (key presets / style picks) */}
            <div data-min-stars="2">
              <ArtistVaultSelector onLoad={handleVaultLoad} loadedVaultId={loadedVault?.id} context="music" />
            </div>

            {/* Row 1: Artist + Song Title */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label={t("makeSong.artistNameLabel")}>
                <Input
                  {...register("artistName", { required: true })}
                  placeholder={t("makeSong.artistNamePlaceholder")}
                  className={inputClass + (errors.artistName ? " border-red-500/50" : "")}
                />
                {errors.artistName && <p className="text-red-400 text-xs mt-1">{t("makeSong.artistNameRequired")}</p>}
              </FieldWrapper>
              <FieldWrapper label={t("makeSong.songTitleLabel")}>
                <Input
                  {...register("songTitle")}
                  placeholder={t("makeSong.songTitlePlaceholder")}
                  className={inputClass}
                />
              </FieldWrapper>
            </div>

            {/* Row 2: Genre + Mood — style picks (2) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="2">
              <FieldWrapper label={t("makeSong.genreLabel")}>
                <StyledSelect
                  name="genre"
                  placeholder={t("makeSong.selectGenre")}
                  options={GENRES}
                  value={watched.genre}
                  onChange={(v) => setValue("genre", v)}
                />
              </FieldWrapper>
              <FieldWrapper label={t("makeSong.moodLabel")}>
                <StyledSelect
                  name="mood"
                  placeholder={t("makeSong.selectMood")}
                  options={MOODS}
                  value={watched.mood}
                  onChange={(v) => setValue("mood", v)}
                />
              </FieldWrapper>
            </div>

            {/* Row 3: Song Topic */}
            <FieldWrapper label={t("makeSong.songTopicLabel")} hint={t("makeSong.songTopicHint")}>
              <Input
                {...register("songTopic", { required: true })}
                placeholder={t("makeSong.songTopicPlaceholder")}
                className={inputClass + (errors.songTopic ? " border-red-500/50" : "")}
              />
              {errors.songTopic && <p className="text-red-400 text-xs mt-1">{t("makeSong.songTopicRequired")}</p>}
            </FieldWrapper>

            {/* Row 4: Clean/Explicit + Song Length — tweak options (3) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="3">
              <FieldWrapper label={t("makeSong.cleanOrExplicitLabel")} hint={t("makeSong.cleanHint")}>
                <StyledSelect
                  name="cleanOrExplicit"
                  placeholder={t("makeSong.selectOption")}
                  options={[{ value: "Clean", labelKey: "makeSong.cleanOption" }, { value: "Explicit", labelKey: "makeSong.explicitOption" }]}
                  value={watched.cleanOrExplicit}
                  onChange={(v) => setValue("cleanOrExplicit", v)}
                />
              </FieldWrapper>
              <FieldWrapper label={t("makeSong.songLengthLabel")}>
                <StyledSelect
                  name="songLength"
                  placeholder={t("makeSong.selectLength")}
                  options={LENGTHS}
                  value={watched.songLength}
                  onChange={(v) => setValue("songLength", v)}
                />
              </FieldWrapper>
            </div>

            {/* Row 5: Voice Style + Beat Style — tweak options (3) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="3">
              <FieldWrapper label={t("makeSong.voiceStyleLabel")} hint={t("makeSong.voiceStyleHint")}>
                <Input
                  {...register("voiceStyle")}
                  placeholder={t("makeSong.voiceStylePlaceholder")}
                  className={inputClass}
                />
              </FieldWrapper>
              <FieldWrapper label={t("makeSong.beatStyleLabel")} hint={t("makeSong.beatStyleHint")}>
                <Input
                  {...register("beatStyle")}
                  placeholder={t("makeSong.beatStylePlaceholder")}
                  className={inputClass}
                />
              </FieldWrapper>
            </div>

            {/* Row 6: Special Instructions — manual prompt editing (4) */}
            <div data-min-stars="4">
              <FieldWrapper label={t("makeSong.specialInstructionsLabel")} hint={t("makeSong.specialInstructionsHint")}>
                <Textarea
                  {...register("specialInstructions")}
                  placeholder={t("makeSong.specialInstructionsPlaceholder")}
                  className="min-h-[100px] bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 py-3 placeholder:text-white/25 focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 rounded-xl resize-none hover:border-white/[0.18]"
                />
              </FieldWrapper>
            </div>

            {/* Submit */}
            <div className="pt-2">
              <Button
                type="submit"
                size="lg"
                disabled={loading}
                className="w-full sm:w-auto gold-glow font-bold text-base h-13 px-12 rounded-xl gap-3"
                style={{ height: "52px" }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {t("makeSong.buildingSong")}
                  </>
                ) : (
                  <>
                    <Music className="h-5 w-5" />
                    {t("makeSong.createMySong")}
                  </>
                )}
              </Button>
              <p className="text-white/25 text-xs mt-3">{t("makeSong.usesCredits")}</p>
            </div>
          </form>
          )}
        </div>
        </>
        )}

        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {rawResult && (
          <div id="song-result" className="space-y-6">
            <GenerationResult
              result={rawResult}
              onReset={() => { setRawResult(null); setError(null); }}
              saveMetadata={{
                projectType: "Make a Song",
                artistName: watched.artistName,
                songTitle: watched.songTitle,
                genre: watched.genre,
                mood: watched.mood,
                inputData: watched as unknown as Record<string, unknown>,
                creditsUsed: 1,
              }}
            />
            {(() => {
              const songAsset = latestOfKind("song");
              const audioUrl = songAsset && !songAsset.url.startsWith("blob:") ? songAsset.url : null;
              const pkg = extractSongPackage(rawResult);
              return (
                <>
                  {audioUrl && (
                    <AssetHandoffs
                      asset={songAsset!}
                      handoffs={["karaoke", "audiogram", "social-kit"]}
                      lyricsText={pkg.lyrics}
                      coverUrl={latestOfKind("image")?.url}
                      brandName={watched.artistName || project.name}
                      tagline={pkg.concept.slice(0, 120) || undefined}
                    />
                  )}
                  {audioUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => setCoverOpen(true)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
                      >
                        <Disc3 className="h-4 w-4" />
                        Make a cover — same song, new style (400 Visual Bucs)
                      </button>
                      <CoverSongModal
                        open={coverOpen}
                        onClose={() => setCoverOpen(false)}
                        source={{
                          audioUrl,
                          title: watched.songTitle || pkg.bestTitle || "Untitled Song",
                          artistName: watched.artistName || undefined,
                        }}
                        initialLyrics={pkg.lyrics}
                      />
                      {/* Publish to my profile: creation → publish → live → selling, one click. */}
                      <PublishToProfileButton
                        type="audio"
                        category="music"
                        audioUrl={audioUrl}
                        title={watched.songTitle || pkg.bestTitle || "Untitled Song"}
                        artworkUrl={(() => { const u = latestOfKind("image")?.url; return u && !u.startsWith("blob:") ? u : undefined; })()}
                        genre={watched.genre || undefined}
                        from="/make-song"
                        fromLabel="Song Maker"
                      />
                      {/* AI Vocal Polish: gentle tuning nudge + key/tempo shift, docked with the other song actions. */}
                      <button
                        type="button"
                        onClick={() => setPolishOpen(true)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
                      >
                        <Mic className="h-4 w-4" />
                        {t("vocalPolish.buttonLabel")} ({t("vocalPolish.buttonCost")})
                      </button>
                      <VocalPolishModal
                        open={polishOpen}
                        onClose={() => setPolishOpen(false)}
                        source={{
                          audioUrl,
                          title: watched.songTitle || pkg.bestTitle || "Untitled Song",
                          artistName: watched.artistName || undefined,
                        }}
                      />
                      {/* AI Harmony Generator: backing-vocal harmonies, docked with the other song actions. */}
                      <button
                        type="button"
                        onClick={() => setHarmonyOpen(true)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
                      >
                        <Users className="h-4 w-4" />
                        {t("harmony.buttonLabel")} ({t("harmony.buttonCost")})
                      </button>
                      <HarmonyGeneratorModal
                        open={harmonyOpen}
                        onClose={() => setHarmonyOpen(false)}
                        source={{
                          audioUrl,
                          title: watched.songTitle || pkg.bestTitle || "Untitled Song",
                          artistName: watched.artistName || undefined,
                        }}
                        initialLyrics={pkg.lyrics}
                      />
                      {/* Synced Lyrics Export (.lrc) — DistroKid parity: tap-to-sync (free) or AI align. */}
                      {pkg.lyrics.trim() && (
                        <>
                          <button
                            type="button"
                            onClick={() => setLrcOpen(true)}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
                          >
                            <Timer className="h-4 w-4" />
                            {t("lrcExport.buttonLabel")}
                            <span className="text-[11px] font-semibold text-white/45">
                              ({t("lrcExport.buttonSub", { credits: 200 })})
                            </span>
                          </button>
                          <LrcExportModal
                            open={lrcOpen}
                            onClose={() => setLrcOpen(false)}
                            source={{
                              audioUrl,
                              title: watched.songTitle || pkg.bestTitle || "Untitled Song",
                              artistName: watched.artistName || undefined,
                              lyrics: pkg.lyrics,
                            }}
                          />
                        </>
                      )}
                    </>
                  )}
                  {/* Suno-parity rework: remix the arrangement or replace one section. */}
                  <SongReworkPanel
                    source={{
                      title: watched.songTitle || pkg.bestTitle || "Untitled Song",
                      artistName: watched.artistName || undefined,
                      genre: watched.genre || undefined,
                      mood: watched.mood || undefined,
                      lyrics: pkg.lyrics || undefined,
                      audioUrl,
                    }}
                  />
                </>
              );
            })()}
          </div>
        )}

      </div>
    </div>
  );
}
