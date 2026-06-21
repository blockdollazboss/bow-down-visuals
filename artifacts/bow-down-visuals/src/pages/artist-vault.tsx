import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Archive, ArrowLeft, Save, ChevronRight, CheckCircle2, Mic2, Video, Film, Image as ImageIcon, Music } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";

interface VaultValues {
  artistName: string;
  genre: string;
  subGenre: string;
  mood: string;
  voiceStyle: string;
  beatStyle: string;
  videoStyle: string;
  targetAudience: string;
  artistBio: string;
  visualBrand: string;
  socialLinks: string;
}

const GENRES     = ["Hip Hop","Drill","Trap","R&B","Pop","Afrobeats","Dancehall","Gospel","Kids Music","Rock","Country","Other"];
const MOODS      = ["Luxury","Dark","Emotional","Street","Romantic","Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly"];
const VIDEO_STYLES = ["Street Cinematic","Luxury Rap Video","Brooklyn Drill","Dark Emotional Story","Performance Video","Club Video","Cartoon Music Video","Anime Music Video","Romantic R&B Visual","Documentary Style"];

const selectClass   = "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";
const inputClass    = "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";
const textareaClass = "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";

function StyledSelect({ name, placeholder, options, value, onChange }: {
  name: string; placeholder: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass} style={{ colorScheme: "dark" }}>
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o) => <option key={o} value={o} style={{ background: "#111" }}>{o}</option>)}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

function FieldWrapper({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{label}</Label>
      {hint && <p className="text-xs text-white/30 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function SavedVaultCard({ data }: { data: VaultValues }) {
  const TOOLS = [
    { label: "Make a Song", href: "/make-song", icon: Music },
    { label: "Make a Music Video", href: "/make-video", icon: Video },
    { label: "Make Song + Video", href: "/song-and-video", icon: Mic2 },
    { label: "Promo Clip Maker", href: "/promo-clip", icon: Film },
    { label: "Thumbnail Maker", href: "/thumbnail", icon: ImageIcon },
  ];
  return (
    <div className="mt-10 space-y-6">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <span className="text-xs font-bold tracking-widest text-primary uppercase">Artist Profile Saved</span>
      </div>

      {/* Profile card */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 md:p-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <span className="text-white font-black text-2xl">{(data.artistName || "A")[0].toUpperCase()}</span>
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">{data.artistName || "Your Artist Name"}</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {data.genre && <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{data.genre}</Badge>}
              {data.mood && <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{data.mood}</Badge>}
              {data.subGenre && <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{data.subGenre}</Badge>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {[
            { label: "Voice Style", value: data.voiceStyle },
            { label: "Beat Style", value: data.beatStyle },
            { label: "Video Style", value: data.videoStyle },
            { label: "Target Audience", value: data.targetAudience },
          ].filter(f => f.value).map((field) => (
            <div key={field.label} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-1">{field.label}</p>
              <p className="text-sm text-white font-medium">{field.value}</p>
            </div>
          ))}
        </div>

        {data.artistBio && (
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 mb-4">
            <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-2">Artist Bio</p>
            <p className="text-sm text-white/70 leading-relaxed">{data.artistBio}</p>
          </div>
        )}
        {data.visualBrand && (
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-2">Visual Brand</p>
            <p className="text-sm text-white/70 leading-relaxed">{data.visualBrand}</p>
          </div>
        )}
      </div>

      {/* Quick launch */}
      <div>
        <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-3">Launch a tool with your vault loaded</p>
        <div className="flex flex-wrap gap-2">
          {TOOLS.map((tool) => (
            <Link key={tool.href} href={tool.href}>
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-sm text-white/60 hover:text-white hover:border-primary/30 hover:bg-primary/5 transition-colors">
                <tool.icon className="h-3.5 w-3.5" />
                {tool.label}
              </button>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ArtistVault() {
  const [saved, setSaved] = useState<VaultValues | null>(null);
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, watch, setValue } = useForm<VaultValues>({
    defaultValues: { artistName: "", genre: "", subGenre: "", mood: "", voiceStyle: "", beatStyle: "", videoStyle: "", targetAudience: "", artistBio: "", visualBrand: "", socialLinks: "" },
  });
  const watched = watch();

  function onSubmit(values: VaultValues) {
    setSaving(true);
    setTimeout(() => { setSaved(values); setSaving(false); }, 900);
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
              <Archive className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-white/5 text-white/40 border-white/10 text-xs font-bold tracking-wide">Free</Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">Artist Vault</h1>
          <p className="text-white/50 text-lg max-w-2xl">Save your artist profile once. Every tool pulls from your vault — no re-entering your info every time.</p>
          <div className="flex flex-wrap gap-2 mt-5">
            {["Artist Bio","Genre & Mood","Voice Style","Beat Style","Visual Brand","Quick Launch"].map((t) => (
              <span key={t} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/50 px-3 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>

        {saved && (
          <div className="mb-6 flex items-center gap-3 p-4 rounded-xl border border-primary/25 bg-primary/5">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-bold text-white">Vault saved successfully</p>
              <p className="text-xs text-white/40">Your artist profile is ready. Edit it any time below.</p>
            </div>
            <button onClick={() => setSaved(null)} className="ml-auto text-xs text-white/30 hover:text-white transition-colors">Edit</button>
          </div>
        )}

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Artist Name">
                <Input {...register("artistName")} placeholder="Your stage name" className={inputClass} />
              </FieldWrapper>
              <FieldWrapper label="Sub-Genre / Niche" hint="optional — e.g. Brooklyn Drill, Emo R&B">
                <Input {...register("subGenre")} placeholder="e.g. Brooklyn Drill, Afro Trap..." className={inputClass} />
              </FieldWrapper>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Primary Genre">
                <StyledSelect name="genre" placeholder="Select genre..." options={GENRES} value={watched.genre} onChange={(v) => setValue("genre", v)} />
              </FieldWrapper>
              <FieldWrapper label="Default Mood">
                <StyledSelect name="mood" placeholder="Select mood..." options={MOODS} value={watched.mood} onChange={(v) => setValue("mood", v)} />
              </FieldWrapper>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Voice Style" hint="How you sound — e.g. deep, melodic, raspy">
                <Input {...register("voiceStyle")} placeholder="e.g. deep, raspy, melodic, aggressive..." className={inputClass} />
              </FieldWrapper>
              <FieldWrapper label="Beat Style" hint="What you rap or sing over">
                <Input {...register("beatStyle")} placeholder="e.g. dark 808s, live piano, boom bap..." className={inputClass} />
              </FieldWrapper>
            </div>

            <FieldWrapper label="Default Video Style">
              <StyledSelect name="videoStyle" placeholder="Select style..." options={VIDEO_STYLES} value={watched.videoStyle} onChange={(v) => setValue("videoStyle", v)} />
            </FieldWrapper>

            <FieldWrapper label="Target Audience" hint="Who listens to you?">
              <Input {...register("targetAudience")} placeholder="e.g. 18–30 year old hip hop fans in New York and Atlanta..." className={inputClass} />
            </FieldWrapper>

            <FieldWrapper label="Artist Bio" hint="Used across all AI outputs — write it in your own voice">
              <Textarea {...register("artistBio")} placeholder="Tell the story of who you are as an artist. Where you're from, what drives you, what makes your sound unique. The more specific, the better every tool performs..." className={textareaClass} style={{ minHeight: "140px" }} />
            </FieldWrapper>

            <FieldWrapper label="Visual Brand" hint="Describe how you look and present yourself visually">
              <Textarea {...register("visualBrand")} placeholder="Describe your look: wardrobe style, jewelry, tattoos, hair, overall aesthetic. Include color palettes, brands, visual references that match your artist identity..." className={textareaClass} style={{ minHeight: "120px" }} />
            </FieldWrapper>

            <FieldWrapper label="Social Links" hint="optional — for context">
              <Input {...register("socialLinks")} placeholder="Instagram, TikTok, YouTube, Spotify..." className={inputClass} />
            </FieldWrapper>

            <div className="pt-2">
              <Button type="submit" size="lg" disabled={saving} className="w-full sm:w-auto purple-glow font-bold text-base px-12 rounded-xl gap-3" style={{ height: "52px" }}>
                {saving ? <><Save className="h-5 w-5 animate-pulse" /> Saving to vault...</> : <><Save className="h-5 w-5" /> Save to Artist Vault</>}
              </Button>
              <p className="text-white/25 text-xs mt-3">Free — no credits required</p>
            </div>
          </form>
        </div>

        {saved && <SavedVaultCard data={saved} />}

        <div className="mt-16 pt-8 border-t border-white/[0.05] text-center">
          <p className="text-white/20 text-sm">© 2026 Bow Down Visuals. Create the Song. Create the Video. Promote the Release.</p>
        </div>
      </div>
    </div>
  );
}
