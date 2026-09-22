import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Music, ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult } from "@/components/GenerationResult";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";

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

const GENRES = [
  "Hip Hop", "Drill", "Trap", "R&B", "Pop",
  "Afrobeats", "Dancehall", "Gospel", "Kids Music",
  "Rock", "Country", "Other",
];

const MOODS = [
  "Luxury", "Dark", "Emotional", "Street", "Romantic",
  "Energetic", "Pain", "Victory", "Party",
  "Inspirational", "Funny", "Kid-Friendly",
];

const LENGTHS = ["30 seconds", "60 seconds", "2 minutes", "Full song"];



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
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";

const selectClass =
  "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";

function StyledSelect({
  name,
  placeholder,
  options,
  value,
  onChange,
}: {
  name: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
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
          <option key={o} value={o} style={{ background: "#111" }}>
            {o}
          </option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function MakeSong() {
  const { getAccessToken, refreshProfile } = useAuth();
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(null);

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
    setLoading(true);
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const { rawResult, creditsRemaining } = await callGenerateApi("/api/generate-song", {
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
        artistVault: loadedVault,
      }, token);
      setRawResult(rawResult);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("song-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Music className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">
              1 credit
            </Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Make a Song
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Create lyrics, hooks, verses, beat direction, vocal style, and AI music prompts for your next release.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

            <ArtistVaultSelector onLoad={handleVaultLoad} loadedVaultId={loadedVault?.id} />

            {/* Row 1: Artist + Song Title */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Artist Name">
                <Input
                  {...register("artistName", { required: true })}
                  placeholder="e.g. Lil Nova"
                  className={inputClass + (errors.artistName ? " border-red-500/50" : "")}
                />
                {errors.artistName && <p className="text-red-400 text-xs mt-1">Artist name is required</p>}
              </FieldWrapper>
              <FieldWrapper label="Song Title">
                <Input
                  {...register("songTitle")}
                  placeholder="e.g. On My Way Up"
                  className={inputClass}
                />
              </FieldWrapper>
            </div>

            {/* Row 2: Genre + Mood */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Genre">
                <StyledSelect
                  name="genre"
                  placeholder="Select genre..."
                  options={GENRES}
                  value={watched.genre}
                  onChange={(v) => setValue("genre", v)}
                />
              </FieldWrapper>
              <FieldWrapper label="Mood">
                <StyledSelect
                  name="mood"
                  placeholder="Select mood..."
                  options={MOODS}
                  value={watched.mood}
                  onChange={(v) => setValue("mood", v)}
                />
              </FieldWrapper>
            </div>

            {/* Row 3: Song Topic */}
            <FieldWrapper label="Song Topic" hint="What is the song actually about? Be specific — the more detail you give, the better the output.">
              <Input
                {...register("songTopic", { required: true })}
                placeholder="e.g. coming up from nothing, losing someone, street life, first love..."
                className={inputClass + (errors.songTopic ? " border-red-500/50" : "")}
              />
              {errors.songTopic && <p className="text-red-400 text-xs mt-1">Song topic is required</p>}
            </FieldWrapper>

            {/* Row 4: Clean/Explicit + Song Length */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Clean or Explicit" hint="Clean = no profanity. Explicit = no restrictions on language.">
                <StyledSelect
                  name="cleanOrExplicit"
                  placeholder="Select..."
                  options={["Clean", "Explicit"]}
                  value={watched.cleanOrExplicit}
                  onChange={(v) => setValue("cleanOrExplicit", v)}
                />
              </FieldWrapper>
              <FieldWrapper label="Song Length">
                <StyledSelect
                  name="songLength"
                  placeholder="Select length..."
                  options={LENGTHS}
                  value={watched.songLength}
                  onChange={(v) => setValue("songLength", v)}
                />
              </FieldWrapper>
            </div>

            {/* Row 5: Voice Style + Beat Style */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Voice Style" hint="How does the artist sound? e.g. deep and raspy, high melodic, aggressive, smooth.">
                <Input
                  {...register("voiceStyle")}
                  placeholder="e.g. deep, raspy, melodic, aggressive, smooth..."
                  className={inputClass}
                />
              </FieldWrapper>
              <FieldWrapper label="Beat Style" hint="Describe the instrumental. e.g. dark 808s, lo-fi piano, boom bap drums, live strings.">
                <Input
                  {...register("beatStyle")}
                  placeholder="e.g. dark 808s, trap drums, live piano, boom bap..."
                  className={inputClass}
                />
              </FieldWrapper>
            </div>

            {/* Row 6: Special Instructions */}
            <FieldWrapper label="Special Instructions" hint="Optional — add references, cultural notes, things to avoid, or any detail the AI should know about.">
              <Textarea
                {...register("specialInstructions")}
                placeholder="Any extra details — references, specific themes, things to avoid, cultural notes..."
                className="min-h-[100px] bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none"
              />
            </FieldWrapper>

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
                    Building your song package...
                  </>
                ) : (
                  <>
                    <Music className="h-5 w-5" />
                    Create My Song
                  </>
                )}
              </Button>
              <p className="text-white/25 text-xs mt-3">Uses 1 credit per generation</p>
            </div>
          </form>
        </div>

        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {rawResult && (
          <div id="song-result">
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
          </div>
        )}

      </div>
    </div>
  );
}
