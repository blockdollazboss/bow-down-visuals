import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import { Image as ImageIcon, ArrowLeft, Loader2, ChevronRight } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult } from "@/components/GenerationResult";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { vaultToPayload } from "@/lib/prompt-improve";
import { usePageTitle } from "@/hooks/use-page-title";

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

const selectClass   = "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors appearance-none cursor-pointer";
const inputClass    = "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors rounded-xl";
const textareaClass = "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors rounded-xl resize-none";

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
  usePageTitle("Thumbnail Maker", "AI thumbnail designer — click-magnet thumbnails for every video.");
  const { getAccessToken, refreshProfile } = useAuth();
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [thumbnailImageUrl, setThumbnailImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(null);
  const [recentThumbs, setRecentThumbs] = useState<Array<{ id: string; thumbnail_url: string | null; song_title: string | null }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/thumbnails", { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRecentThumbs((data.thumbnails ?? []).slice(0, 8));
      } catch {
        /* Library strip is a nicety — never block the maker on it. */
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken, thumbnailImageUrl]);
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
    setThumbnailImageUrl(null);
    setImageError(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const { rawResult, creditsRemaining, creditsUsed: used, thumbnailImageUrl: imageUrl, imageError: imgErr } = await callGenerateApi("/api/generate-thumbnail", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        platform: values.platform,
        artStyle: values.artStyle,
        colorTheme: values.colorTheme,
        mood: values.mood,
        featuredText: values.featuredText,
        requests: values.specialRequests,
        artistVault: loadedVault ? vaultToPayload(loadedVault) : null,
      }, token);
      setRawResult(rawResult);
      setThumbnailImageUrl(imageUrl ?? null);
      setImageError(imgErr ?? null);
      if (used !== undefined) setCreditsUsed(used);
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
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>
      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" /> Back to Dashboard
        </Link>
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <ImageIcon className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">up to 3 credits</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">Thumbnail Maker</h1>
          <p className="text-white/50 text-lg max-w-2xl">Generate a real, ready-to-use AI thumbnail image plus cover art concepts and prompts for your release.</p>
          <div className="flex flex-wrap gap-2 mt-5">
            {["AI-Generated Thumbnail Image","3 Thumbnail Concepts","Color Direction","Typography Notes","Background Prompts","Text Overlay Copy","Midjourney Prompts","Cover Art Notes"].map((t) => (
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
              <p className="text-white/25 text-xs mt-3">Uses 1 credit for the concept pack, plus 2 more if the AI thumbnail image renders successfully (3 total)</p>
            </div>
          </form>
        </div>

        {outOfCredits && <OutOfCredits />}

        {recentThumbs.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Your recent thumbnails</h2>
              <Link href="/thumbnails" className="text-xs font-semibold text-primary hover:underline">
                View full library
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recentThumbs.map((t) => (
                <Link
                  key={t.id}
                  href="/thumbnails"
                  className="shrink-0 w-44 rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-primary/40 transition-colors"
                >
                  {t.thumbnail_url ? (
                    <img src={t.thumbnail_url} alt={t.song_title ?? "Thumbnail"} className="w-44 aspect-video object-cover" loading="lazy" />
                  ) : (
                    <div className="w-44 aspect-video flex items-center justify-center bg-black/40">
                      <ImageIcon className="h-6 w-6 text-white/15" />
                    </div>
                  )}
                  <p className="px-2.5 py-2 text-xs text-white/60 truncate">{t.song_title ?? "Untitled"}</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {rawResult && (
          <div id="thumb-result">
            {thumbnailImageUrl ? (
              <div className="mb-6 rounded-2xl border border-primary/25 bg-primary/[0.04] p-5">
                <p className="text-xs font-bold tracking-widest text-primary uppercase mb-3">Your AI-Generated Thumbnail</p>
                <img
                  src={thumbnailImageUrl}
                  alt="AI-generated thumbnail"
                  className="w-full rounded-xl border border-white/10"
                  data-testid="img-generated-thumbnail"
                />
                <div className="flex justify-end mt-3">
                  <a href={thumbnailImageUrl} download="thumbnail.png" target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10">
                      Download Image
                    </Button>
                  </a>
                </div>
              </div>
            ) : imageError && (
              <div className="mb-6 p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
                <p className="text-yellow-400 text-sm font-medium">Couldn't render the AI thumbnail image ({imageError}). Your prompt pack below is ready to use.</p>
              </div>
            )}
            <GenerationResult
              result={rawResult}
              onReset={() => { setRawResult(null); setThumbnailImageUrl(null); setImageError(null); setError(null); setOutOfCredits(false); }}
              saveMetadata={{
                projectType: "Thumbnail Maker",
                artistName: watched.artistName,
                songTitle: watched.songTitle,
                genre: "",
                mood: watched.mood,
                inputData: watched as unknown as Record<string, unknown>,
                creditsUsed,
                thumbnailImageUrl,
              }}
            />
          </div>
        )}

      </div>
    </div>
  );
}
