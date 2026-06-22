import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon, ArrowLeft, Loader2, ChevronRight } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult } from "@/components/GenerationResult";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";

interface FormValues {
  artistName: string;
  songTitle: string;
  platform: string;
  artStyle: string;
  colorTheme: string;
  mood: string;
  featuredText: string;
  specialRequests: string;
}

const PLATFORMS  = ["YouTube","Spotify","Apple Music","SoundCloud","All Platforms"];
const ART_STYLES = ["Photo-Realistic","Illustrated","Minimalist","Bold Graphic","Vintage","Futuristic","Cinematic Dark","Street Art","Anime","3D Render"];
const MOODS      = ["Luxury","Dark","Emotional","Street","Romantic","Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly"];

const selectClass   = "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";
const inputClass    = "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";
const textareaClass = "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";

function StyledSelect({ name, placeholder, options, value, onChange }: {
  name: string; placeholder: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)}
        className={selectClass} style={{ colorScheme: "dark" }}>
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o) => <option key={o} value={o} style={{ background: "#111" }}>{o}</option>)}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

export default function Thumbnail() {
  const { getAccessToken, refreshProfile } = useAuth();
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(null);
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: { artistName: "", songTitle: "", platform: "", artStyle: "", colorTheme: "", mood: "", featuredText: "", specialRequests: "" },
  });
  const watched = watch();

  function handleVaultLoad(vault: ArtistVault) {
    if (!watched.artistName) setValue("artistName", vault.artist_name);
    if (!watched.artStyle && vault.visual_style) setValue("artStyle", vault.visual_style);
    if (!watched.colorTheme && vault.brand_colors) setValue("colorTheme", vault.brand_colors);
    setLoadedVault(vault);
  }

  async function onSubmit(values: FormValues) {
    setLoading(true);
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const { rawResult, creditsRemaining } = await callGenerateApi("/api/generate-thumbnail", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        platform: values.platform,
        artStyle: values.artStyle,
        colorTheme: values.colorTheme,
        mood: values.mood,
        featuredText: values.featuredText,
        requests: values.specialRequests,
        artistVault: loadedVault,
      }, token);
      setRawResult(rawResult);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("thumb-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>
      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" /> Back to Dashboard
        </Link>
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <ImageIcon className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">1 credit</Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">Thumbnail Maker</h1>
          <p className="text-white/50 text-lg max-w-2xl">Generate cover art concepts, thumbnail directions, and AI image prompts for your release.</p>
          <div className="flex flex-wrap gap-2 mt-5">
            {["3 Thumbnail Concepts","Color Direction","Typography Notes","Background Prompts","Text Overlay Copy","Midjourney Prompts","Cover Art Notes"].map((t) => (
              <span key={t} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/50 px-3 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            <ArtistVaultSelector onLoad={handleVaultLoad} loadedVaultId={loadedVault?.id} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Artist Name</Label>
                <Input {...register("artistName", { required: true })} placeholder="e.g. Lil Nova" className={inputClass + (errors.artistName ? " border-red-500/50" : "")} />
                {errors.artistName && <p className="text-red-400 text-xs">Required</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Song / Video Title</Label>
                <Input {...register("songTitle")} placeholder="e.g. On My Way Up" className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Platform</Label>
                <StyledSelect name="platform" placeholder="Select platform..." options={PLATFORMS} value={watched.platform} onChange={(v) => setValue("platform", v)} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Art Style</Label>
                <StyledSelect name="artStyle" placeholder="Select style..." options={ART_STYLES} value={watched.artStyle} onChange={(v) => setValue("artStyle", v)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Color Theme</Label>
                <Input {...register("colorTheme")} placeholder="e.g. black and gold, purple and white..." className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Mood</Label>
                <StyledSelect name="mood" placeholder="Select mood..." options={MOODS} value={watched.mood} onChange={(v) => setValue("mood", v)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Featured Text <span className="text-white/25 font-normal normal-case tracking-normal">(optional)</span></Label>
              <Input {...register("featuredText")} placeholder="e.g. OUT NOW, NEW SINGLE, FT. ARTIST..." className={inputClass} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">Special Requests <span className="text-white/25 font-normal normal-case tracking-normal">(optional)</span></Label>
              <Textarea {...register("specialRequests")} placeholder="Specific visual elements, references, things to include or avoid, cultural context..." className={textareaClass} style={{ minHeight: "100px" }} />
            </div>
            <div className="pt-2">
              <Button type="submit" size="lg" disabled={loading} className="w-full sm:w-auto gold-glow font-bold text-base px-12 rounded-xl gap-3" style={{ height: "52px" }}>
                {loading ? <><Loader2 className="h-5 w-5 animate-spin" /> Building your pack...</> : <><ImageIcon className="h-5 w-5" /> Generate Thumbnail Pack</>}
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
          <div id="thumb-result">
            <GenerationResult
              result={rawResult}
              onReset={() => { setRawResult(null); setError(null); setOutOfCredits(false); }}
              saveMetadata={{
                projectType: "Thumbnail Maker",
                artistName: watched.artistName,
                songTitle: watched.songTitle,
                genre: "",
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
