import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon, ArrowLeft, Copy, CheckCheck, Loader2, Download, Save, ChevronRight } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";

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

function buildPlaceholder(v: FormValues) {
  const artist = v.artistName || "The Artist";
  const title  = v.songTitle  || "Untitled";
  const style  = v.artStyle   || "Cinematic Dark";
  const color  = v.colorTheme || "black and purple";
  const mood   = v.mood       || "Dark";
  const text   = v.featuredText || "OUT NOW";
  const platform = v.platform || "All Platforms";

  return {
    "Thumbnail Concept 1 — Primary": `Style: ${style}\nPlatform: ${platform}\n\n${artist} positioned center-left in frame. Direct eye contact with lens. Background: ${color.toLowerCase()} gradient with subtle bokeh or light leak. Foreground: artist name in bold white uppercase, song title "${title}" below in lighter weight.\n\nMood: ${mood}. Lighting: Single key light from top-left, strong rim light separating subject from background. The cover reads clearly at both full size and 80×80px thumbnail.`,

    "Thumbnail Concept 2 — Atmospheric": `Style: ${style}\nPlatform: ${platform}\n\nNo visible artist face. Environment or symbolic imagery fills the frame — representing the song's emotion. Color palette: ${color}. Song title "${title}" in large display type fills lower third. Artist name "${artist}" small and centered at top.\n\nBest for: Ambient, emotional, and atmospheric releases. Feels cinematic.`,

    "Thumbnail Concept 3 — Minimal Bold": `Style: Minimalist / ${style}\nPlatform: ${platform}\n\nBlack background. "${title}" in a single massive typeface, full-bleed. Color: ${color}. Artist name "${artist}" in small caps beneath.\n\nOptional: A single design element — a crown, a chain, a flame — positioned above the title. Clean. Luxury. Iconic.`,

    "Color Direction": `Primary: ${color}\nAccents: ${mood === "Luxury" ? "Gold (#C9A84C), cream white, champagne" : mood === "Dark" ? "Deep purple (#4B0082), midnight blue, cold white" : mood === "Romantic" ? "Rose gold, blush pink, warm white" : mood === "Street" ? "Concrete grey, electric orange, raw white" : "Purple (#7C3AED), silver, off-white"}\n\nBackground: Dark end of the palette — let the artist and text stand out.\nText: Primary white (#FFFFFF) for artist name, off-white (#E5E5E5) for song title, accent color for decorative elements.\n\nColor grade inspiration: ${mood === "Luxury" ? "Beyoncé - Renaissance, Drake - Certified Lover Boy" : mood === "Dark" ? "Travis Scott - Astroworld, NF - The Search" : "Match the energy of the song's production"}`,

    "Typography Notes": `Artist Name: All-caps, bold or black weight, sans-serif. Recommended: Druk Wide, Neue Haas Grotesk, or similar condensed black.\nSong Title: Mixed case or title case, slightly lighter weight, same family.\nFeatured Text ("${text}"): Small caps, widest tracking, colored in accent.\n\nHierarchy (top to bottom):\n1. Artist Name — largest / most prominent\n2. Song Title — secondary\n3. "${text}" — tertiary label\n\nRule: Text should be legible at 150×150px (Spotify grid) and 1920×1080 (YouTube banner).`,

    "Background Prompts": `Prompt 1 — Abstract:\n"${style.toLowerCase()} abstract background, ${color} color palette, ${mood.toLowerCase()} atmosphere, soft light rays, bokeh, no text, 4K --ar 1:1"\n\nPrompt 2 — Environment:\n"${mood === "Luxury" ? "penthouse rooftop at night, city lights, rain on glass" : mood === "Street" ? "empty urban alley, wet pavement, sodium lamp glow" : mood === "Dark" ? "foggy forest at night, moonlight, mist" : "atmospheric music background, cinematic"}, ${color} palette, no people --ar 1:1"\n\nPrompt 3 — Texture:\n"${color} gradient texture, music cover art background, ${style.toLowerCase()}, grain overlay, film quality, no text --ar 1:1"`,

    "Text Overlay Copy": `Option A (Direct):\n"${title.toUpperCase()}"\n${artist.toUpperCase()}\n${text}\n\nOption B (Branded):\n${artist.toUpperCase()} — "${title}"\nAvailable Everywhere\n\nOption C (Minimal):\n${artist}\n\nOption D (Date drop):\n${title.toUpperCase()}\nOUT [DATE]\n${artist}`,

    "Midjourney / DALL-E Prompts": `Portrait Prompt:\n"Professional music artist portrait, ${artist} style, ${style.toLowerCase()}, ${mood.toLowerCase()} lighting, ${color} color palette, album cover composition, 4K, ultra detailed, no watermarks --ar 1:1 --style raw"\n\nFull Cover Prompt:\n"Album cover art, "${title}" by ${artist}, ${style.toLowerCase()}, ${color} palette, ${mood.toLowerCase()} mood, bold typography composition, professional, streaming quality --ar 1:1"\n\nYouTube Thumbnail Variant:\n"YouTube music thumbnail, ${artist}, ${style.toLowerCase()}, ${color} scheme, professional quality, text-ready layout --ar 16:9"`,

    "Cover Art Final Notes": `Deliver in:\n• 3000×3000px (minimum) for streaming platforms — Spotify, Apple Music require this\n• 1920×1080px for YouTube banner\n• 1080×1080px for Instagram / social posts\n• 1080×1920px for Story / TikTok cover\n\nFile format: PNG or JPEG at 300 DPI (300 DPI for print, 72 DPI for digital)\n\nNaming convention: ${artistName_safe(artist)}_${titleName_safe(title)}_cover_v1.png\n\nBefore publishing, test the thumbnail at 80×80px — if ${artist} and "${title}" are still readable, you're good to go.`,
  };
}

function artistName_safe(s: string) { return s.replace(/\s+/g, "_").toLowerCase(); }
function titleName_safe(s: string)  { return s.replace(/\s+/g, "_").toLowerCase(); }

function ResultSection({ data, onClear }: { data: Record<string, string>; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    const text = Object.entries(data).map(([k, v]) => `## ${k}\n\n${v}`).join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="space-y-6 mt-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold tracking-widest text-primary uppercase">Result Ready</span>
          </div>
          <h2 className="text-2xl font-black text-white">Thumbnail Pack</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleCopy} variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2">
            {copied ? <CheckCheck className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Result"}
          </Button>
          <Button onClick={onClear} variant="outline" size="sm" className="border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white gap-2">
            Clear Result
          </Button>
          <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-1.5">
            <Save className="h-3.5 w-3.5" /> Save <Badge variant="outline" className="border-white/10 text-white/20 text-[10px] ml-1">Soon</Badge>
          </Button>
          <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-1.5">
            <Download className="h-3.5 w-3.5" /> Download <Badge variant="outline" className="border-white/10 text-white/20 text-[10px] ml-1">Soon</Badge>
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        {Object.entries(data).map(([heading, content], i) => (
          <div key={heading} className="p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-primary/20 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-primary/50 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-base font-bold text-white">{heading}</h3>
            </div>
            <p className="text-white/60 text-sm leading-relaxed whitespace-pre-line">{content}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap pt-2">
        <Button onClick={handleCopy} className="purple-glow font-semibold gap-2">
          {copied ? <CheckCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy Result"}
        </Button>
        <Button onClick={onClear} variant="outline" size="sm" className="border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white gap-1.5">
          Clear Result
        </Button>
        <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-1.5">
          <Save className="h-3.5 w-3.5" /> Save Project Coming Soon
        </Button>
        <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-1.5">
          <Download className="h-3.5 w-3.5" /> Download Coming Soon
        </Button>
      </div>
    </div>
  );
}

export default function Thumbnail() {
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: { artistName: "", songTitle: "", platform: "", artStyle: "", colorTheme: "", mood: "", featuredText: "", specialRequests: "" },
  });
  const watched = watch();

  async function onSubmit(values: FormValues) {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await callGenerateApi("/api/generate-thumbnail", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        platform: values.platform,
        artStyle: values.artStyle,
        colorTheme: values.colorTheme,
        mood: values.mood,
        featuredText: values.featuredText,
        requests: values.specialRequests,
      });
      setResult(data);
      setTimeout(() => {
        document.getElementById("thumb-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-purple-600/8 rounded-full blur-[100px]" />
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
              <Button type="submit" size="lg" disabled={loading} className="w-full sm:w-auto purple-glow font-bold text-base px-12 rounded-xl gap-3" style={{ height: "52px" }}>
                {loading ? <><Loader2 className="h-5 w-5 animate-spin" /> Building your pack...</> : <><ImageIcon className="h-5 w-5" /> Generate Thumbnail Pack</>}
              </Button>
              <p className="text-white/25 text-xs mt-3">Uses 1 credit per generation</p>
            </div>
          </form>
        </div>

        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {result && (
          <div id="thumb-result">
            <ResultSection data={result} onClear={() => { setResult(null); setError(null); }} />
          </div>
        )}

        <div className="mt-16 pt-8 border-t border-white/[0.05] text-center">
          <p className="text-white/20 text-sm">© 2026 Bow Down Visuals. Create the Song. Create the Video. Promote the Release.</p>
        </div>
      </div>
    </div>
  );
}
