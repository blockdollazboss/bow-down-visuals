import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Mic2, ArrowLeft, Loader2, ChevronRight, Music, Video } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult } from "@/components/GenerationResult";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface FormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  songTopic: string;
  cleanOrExplicit: string;
  voiceStyle: string;
  beatStyle: string;
  videoStyle: string;
  platform: string;
  artistDescription: string;
  specialInstructions: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const GENRES = ["Hip Hop","Drill","Trap","R&B","Pop","Afrobeats","Dancehall","Gospel","Kids Music","Rock","Country","Other"];
const MOODS  = ["Luxury","Dark","Emotional","Street","Romantic","Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly"];
const VIDEO_STYLES = ["Street Cinematic","Luxury Rap Video","Brooklyn Drill","Dark Emotional Story","Performance Video","Club Video","Cartoon Music Video","Anime Music Video","Kids Nursery Rhyme","Romantic R&B Visual","Documentary Style"];
const PLATFORMS = ["TikTok / Reels / Shorts - 9:16","YouTube Music Video - 16:9","Square Social Post - 1:1","All Formats"];

/* ─────────────────────────── PLACEHOLDER RESULT ─────────────────────────── */

function buildPlaceholder(v: FormValues) {
  const artist = v.artistName || "The Artist";
  const title  = v.songTitle  || "Untitled";
  const genre  = v.genre      || "Hip Hop";
  const mood   = v.mood       || "Dark";
  const topic  = v.songTopic  || "the grind";
  const style  = v.videoStyle || "Street Cinematic";
  const platform = v.platform || "YouTube Music Video - 16:9";
  const isVertical = platform.includes("9:16");
  const ar = isVertical ? "9:16" : platform.includes("1:1") ? "1:1" : "16:9";

  return {
    song: {
      "Song Concept": `A ${mood.toLowerCase()} ${genre} anthem about ${topic}. The song captures ${artist}'s raw perspective — equal parts vulnerability and confidence. The narrative builds across two verses and escalates into a hook built for replay. This is the record that defines this chapter of the ${artist} catalog.`,

      "Full Lyrics": `[Intro]\nYeah, it's ${artist}. You already know.\n\n[Hook]\nEvery move I make is calculated, never faking\nPaid the price they never see, the sacrifice I'm taking\n${mood === "Dark" ? "Something in the dark in me, was never meant for playing" : "Something in the light in me, they tried to keep from shaping"}\nGot my eyes on everything — nobody here can take it\n\n[Verse 1]\nStarted with a vision, now it's turning into something\nAll the nights alone I prayed for what was coming\n${genre === "Drill" ? "Opps tried to stop it, but the bag kept running" : "People doubted every move — I kept it from them"}\nNow the tables turning and my name is what they're bumping\n\n[Verse 2]\nEvery setback was a setup, every loss a lesson\n${mood === "Luxury" ? "Designer on my back but the mind is what I'm dressing" : "Hunger on my back and my faith is what I'm stressing"}\nNever lost my vision through the pain and the depression\nStayed consistent, now they asking for a blessing\n\n[Bridge]\nThis ain't luck — this is work you cannot see\nEvery door they closed just made me find the key\nI was built for this before they believed\nAnd I'll still be standing when they finally leave\n\n[Outro]\n${artist}.\n"${title}."\nThis is just the beginning.\nBow Down.`,

      "Hook": `Every move I make is calculated, never faking\nPaid the price they never see, the sacrifice I'm taking\n${mood === "Dark" ? "Something in the dark in me, was never meant for playing" : "Something in the light in me, they tried to keep from shaping"}\nGot my eyes on everything — nobody here can take it`,

      "Verse 1": `Started with a vision, now it's turning into something\nAll the nights alone I prayed for what was coming\n${genre === "Drill" ? "Opps tried to stop it, but the bag kept running" : "People doubted every move — I kept it from them"}\nNow the tables turning and my name is what they're bumping`,

      "Verse 2": `Every setback was a setup, every loss a lesson\n${mood === "Luxury" ? "Designer on my back but the mind is what I'm dressing" : "Hunger on my back and my faith is what I'm stressing"}\nNever lost my vision through the pain and the depression\nStayed consistent, now they asking for a blessing`,

      "Bridge": `This ain't luck — this is work you cannot see\nEvery door they closed just made me find the key\nI was built for this before they believed\nAnd I'll still be standing when they finally leave`,

      "Outro": `${artist}.\n"${title}."\nThis is just the beginning.\nBow Down.`,

      "AI Music Prompt": `Generate a ${mood.toLowerCase()} ${genre} instrumental. ${v.beatStyle || `Rolling 808 bass, layered hi-hats, melodic piano or synth lead.`} BPM: ${genre === "Drill" ? "140–145" : genre === "R&B" ? "75–85" : "90–105"}. Key: ${mood === "Dark" || mood === "Pain" ? "F minor" : "G major"}. Cinematic build on the intro, full drop at 0:32. Master for streaming at -14 LUFS.`,

      "Suggested Beat Style": `${v.beatStyle || `${mood} melodic ${genre} — punchy 808s, crisp snare, layered hi-hats, atmospheric pad in the background. The beat should breathe on the verses and hit harder on the hook.`}`,

      "Suggested Vocal Style": `${v.voiceStyle || `Confident delivery with controlled emotion. Subtle autotune for texture. Heavy ad-libs on the hook. Layer the hook 3x — lead, harmony, and whisper layer. ${v.cleanOrExplicit === "Explicit" ? "Full explicit delivery — raw and unfiltered." : "Clean version — radio-ready substitutions throughout."}`}`,
    },
    visual: {
      "Music Video Treatment": `"${title}" by ${artist} is a ${style.toLowerCase()} visual built for ${platform.split(" -")[0]}. The concept starts in darkness and ends in light — mirroring the song's arc. Every scene serves the narrative. The color grade is intentional. The pacing locks with the beat. This is a world-building visual for the ${artist} brand.

Director's Note: Shoot ${mood === "Dark" || mood === "Pain" ? "at night or in controlled low-light environments" : "during golden hour and magic hour for natural warmth"}. Practical locations over studio sets. Authenticity over perfection.`,

      "Visual Style": `Color Grade: ${mood === "Dark" || mood === "Pain" ? "Deep blacks, cool blue shadows, minimal highlights." : mood === "Luxury" ? "Warm gold tones, rich shadows, cinematic depth." : mood === "Romantic" ? "Soft warm tones, natural light, shallow depth of field." : "High contrast, punchy colors, dynamic range."}\n\nLighting: ${style.includes("Luxury") ? "High-key with rim lights, neon accents, practicals in bg." : style.includes("Drill") ? "Low-key motivated lighting — street practicals only." : "Mixed natural and practical lighting."}\n\nCamera: ${genre === "Drill" || mood === "Dark" ? "Handheld on verses, locked off on hook. Close-ups heavy." : "Fluid steadicam on verses, drone establishing shots."}\n\nAspect Ratio: ${ar} — ${isVertical ? "1080×1920 vertical" : ar === "1:1" ? "1080×1080 square" : "1920×1080 widescreen"}`,

      "Scene-by-Scene Breakdown": `[00:00–00:08] — Cold Open\nStatic wide shot of the environment. No artist. Atmosphere only. Sound: ambient ${mood === "Dark" ? "city noise, wind" : "morning air, distance"}.

[00:08–00:20] — Artist Introduction\n${artist} enters frame. Slow motion, 50% speed. Camera pushes in. Direct eye contact with lens.

[00:20–01:00] — Verse 1\nHandheld camera. Close-ups on face, hands, environment. Each lyrical bar gets a matching visual. Intercut between performance and b-roll.

[01:00–01:20] — Pre-Hook\nEnergy builds. Quick cuts — 12 frames each. Artist moving toward camera.

[01:20–01:50] — Hook\nWIDE SHOT. ${artist} center frame, full environment visible. Locked-off camera. Slow zoom. This is the moment.

[01:50–02:30] — Verse 2\nNew location or new lighting. Story deepens. Close-ups more extreme.

[02:30–02:50] — Bridge\nEmotional peak. Slow motion. Single location. Just the artist and the camera.

[02:50–03:20] — Outro\nCamera pulls back to full environment. Artist walks away. Final frame: silhouette, horizon.`,

      "AI Video Prompts": `Prompt 1 — Performance Hero Shot\n"${style} music video, ${artist} performing to camera, ${mood.toLowerCase()} atmosphere, ${genre} aesthetic, cinematic lighting, ${ar} frame, 4K, professional color grade --ar ${ar}"\n\nPrompt 2 — Environment / Location\n"${style.includes("Street") ? "empty urban alley at night, wet pavement, street lights" : style.includes("Luxury") ? "luxury penthouse, golden hour, city skyline" : "atmospheric music video environment, moody"}, no people, establishing shot, ${genre} aesthetic, cinematic 4K --ar ${ar}"\n\nPrompt 3 — Hook Wide Shot\n"wide shot music video, artist centered, ${style.toLowerCase()}, dynamic composition, ${mood.toLowerCase()} palette, cinematic, professional 4K --ar ${ar}"\n\nPrompt 4 — Close-Up Detail\n"extreme close-up, artist hands and jewelry, ${mood.toLowerCase()} video, dramatic side lighting, shallow DOF, bokeh background, cinematic --ar ${ar}"`,

      "Thumbnail Prompts": `YouTube Thumbnail (16:9)\n"${artist} music video thumbnail, intense expression, ${mood.toLowerCase()} background, ${style.toLowerCase()} aesthetic, title '${title}' bold white text bottom third, high contrast, 1920×1080"\n\nVertical / TikTok Cover (9:16)\n"vertical music video cover, ${artist} full body, ${style.toLowerCase()}, dramatic lighting, '${title}' at top, premium, 1080×1920"\n\nSquare (1:1)\n"square cover art, ${artist} centered, ${style.toLowerCase()}, '${title}' clean bold font, ${mood.toLowerCase()} palette, 1080×1080"`,

      "Promo Clip Ideas": `Clip 1 — Teaser (15 sec)\nBest 3 shots from the video. No lyrics. Just music and visuals. End card: "${title} — Out Now."\n\nClip 2 — Hook Highlight (15 sec)\nJust the hook on loop with lyrics overlaid as captions. High rewatch value.\n\nClip 3 — Behind the Scenes (30–60 sec)\nRaw shoot day footage. Shows the work. Makes the release feel earned.\n\nClip 4 — Day-of Drop\n"It's here." — Black screen, white text. First 5 seconds of video. Link in bio.`,

      "Caption Pack": `Drop day:\n🎬 "${title}" — The full visual is here.\nWatch now. Link in bio.\n#${genre.replace(/\s/g,"")} #${artist.replace(/\s/g,"")} #MusicVideo\n\nTeaser (3–5 days before):\nThe video is coming. 🎥\n"${title}" — [Release Date]\n#ComingSoon #${genre.replace(/\s/g,"")}\n\nHook clip:\nThis hook is different. 🔥\n"${title}" — full video link in bio.\n#NewMusic #${mood}`,

      "Release Promo Ideas": `Week Before Release:\n• Post the first 8 seconds of the video as a story teaser\n• Share a B-roll behind-the-scenes clip with no audio\n• Drop the song title and release date — no other context\n\nRelease Day:\n• Post the full video at 12PM in your primary market timezone\n• Go live on IG/TikTok 1 hour after drop to react with fans\n• Pin the YouTube link across all platforms\n\nWeek After:\n• Post the hook clip with lyrics overlay for algorithm push\n• Share fan reactions and comments as stories\n• Release the behind-the-scenes video as a follow-up`,
    },
  };
}


/* ─────────────────────────── FORM HELPERS ─────────────────────────── */

function FieldWrapper({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}

const inputClass    = "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";
const textareaClass = "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";
const selectClass   = "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";

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

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function SongAndVideo() {
  const { getAccessToken, refreshProfile } = useAuth();
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      songTopic: "", cleanOrExplicit: "", voiceStyle: "", beatStyle: "",
      videoStyle: "", platform: "", artistDescription: "", specialInstructions: "",
    },
  });

  const watched = watch();

  async function onSubmit(values: FormValues) {
    setLoading(true);
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const { rawResult, creditsRemaining } = await callGenerateApi("/api/generate-song-video", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        genre: values.genre,
        mood: values.mood,
        explicit: values.cleanOrExplicit,
        songTopic: values.songTopic,
        voiceStyle: values.voiceStyle,
        beatStyle: values.beatStyle,
        videoStyle: values.videoStyle,
        platform: values.platform,
        artistDescription: values.artistDescription,
        instructions: values.specialInstructions,
      }, token);
      setRawResult(rawResult);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("sv-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-yellow-600/8 rounded-full blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Mic2 className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">
              2 credits
            </Badge>
            <Badge className="bg-white/5 text-white/40 border-white/10 text-xs font-bold tracking-wide">
              Most Popular
            </Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Make Song + Video
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Create a full song package and a cinematic music video plan in one workflow.
          </p>

          {/* Package preview pills */}
          <div className="flex flex-wrap gap-2 mt-5">
            {["Lyrics + Hook","Beat Direction","Vocal Style","AI Music Prompt","Video Treatment","Scene Breakdown","AI Video Prompts","Thumbnail Prompts","Caption Pack"].map((tag) => (
              <span key={tag} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/50 px-3 py-1 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Form sections */}
        <div className="space-y-6">

          {/* Section A — Song Info */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.05] bg-white/[0.01]">
              <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center">
                <Music className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-sm font-bold text-white/70 uppercase tracking-wider">Song Details</span>
            </div>
            <form id="song-video-form" onSubmit={handleSubmit(onSubmit)} className="p-6 md:p-8 space-y-8">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Artist Name">
                  <Input {...register("artistName", { required: true })} placeholder="e.g. Lil Nova" className={inputClass + (errors.artistName ? " border-red-500/50" : "")} />
                  {errors.artistName && <p className="text-red-400 text-xs mt-1">Required</p>}
                </FieldWrapper>
                <FieldWrapper label="Song Title">
                  <Input {...register("songTitle")} placeholder="e.g. On My Way Up" className={inputClass} />
                </FieldWrapper>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Genre">
                  <StyledSelect name="genre" placeholder="Select genre..." options={GENRES} value={watched.genre} onChange={(v) => setValue("genre", v)} />
                </FieldWrapper>
                <FieldWrapper label="Mood">
                  <StyledSelect name="mood" placeholder="Select mood..." options={MOODS} value={watched.mood} onChange={(v) => setValue("mood", v)} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Song Topic">
                <Textarea {...register("songTopic", { required: true })}
                  placeholder="Describe the story, theme, or feeling of the song. Include any personal details, metaphors, or narrative elements you want woven into the lyrics..."
                  className={textareaClass + (errors.songTopic ? " border-red-500/50" : "")}
                  style={{ minHeight: "120px" }} />
                {errors.songTopic && <p className="text-red-400 text-xs mt-1">Required</p>}
              </FieldWrapper>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Clean or Explicit">
                  <StyledSelect name="cleanOrExplicit" placeholder="Select..." options={["Clean","Explicit"]} value={watched.cleanOrExplicit} onChange={(v) => setValue("cleanOrExplicit", v)} />
                </FieldWrapper>
                <FieldWrapper label="Voice Style">
                  <Input {...register("voiceStyle")} placeholder="e.g. deep, raspy, melodic, aggressive..." className={inputClass} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Beat Style">
                <Input {...register("beatStyle")} placeholder="e.g. dark 808s, trap drums, live piano, boom bap, guitar loop..." className={inputClass} />
              </FieldWrapper>

            </form>
          </div>

          {/* Section B — Video Info */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.05] bg-white/[0.01]">
              <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center">
                <Video className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-sm font-bold text-white/70 uppercase tracking-wider">Video Details</span>
            </div>
            <div className="p-6 md:p-8 space-y-8">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Video Style">
                  <StyledSelect name="videoStyle" placeholder="Select style..." options={VIDEO_STYLES} value={watched.videoStyle} onChange={(v) => setValue("videoStyle", v)} />
                </FieldWrapper>
                <FieldWrapper label="Platform">
                  <StyledSelect name="platform" placeholder="Select platform..." options={PLATFORMS} value={watched.platform} onChange={(v) => setValue("platform", v)} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Artist Description">
                <Textarea {...register("artistDescription", { required: true })}
                  placeholder="Describe the artist's look, personality, and visual brand. Include style references, wardrobe, tattoos, jewelry, vibe, and anything important for the video direction..."
                  className={textareaClass + (errors.artistDescription ? " border-red-500/50" : "")}
                  style={{ minHeight: "130px" }} />
                {errors.artistDescription && <p className="text-red-400 text-xs mt-1">Required</p>}
              </FieldWrapper>

              <FieldWrapper label="Special Instructions">
                <Textarea {...register("specialInstructions")}
                  placeholder="Specific shots, locations, cultural elements, references, things to avoid, or anything else the AI should know..."
                  className={textareaClass}
                  style={{ minHeight: "100px" }} />
              </FieldWrapper>

            </div>
          </div>

          {/* Submit */}
          <div className="pt-2">
            <Button
              type="submit"
              form="song-video-form"
              size="lg"
              disabled={loading}
              className="w-full sm:w-auto gold-glow font-bold text-base px-12 rounded-xl gap-3"
              style={{ height: "56px" }}
            >
              {loading ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Building your package...</>
              ) : (
                <><Mic2 className="h-5 w-5" /> Generate Song + Video Package</>
              )}
            </Button>
            <p className="text-white/25 text-xs mt-3">Uses 2 credits per generation · Song Package + Visual Package</p>
          </div>
        </div>

        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {rawResult && (
          <div id="sv-result">
            <GenerationResult
              result={rawResult}
              onReset={() => { setRawResult(null); setError(null); setOutOfCredits(false); }}
              saveMetadata={{
                projectType: "Make Song + Video",
                artistName: watched.artistName,
                songTitle: watched.songTitle,
                genre: watched.genre,
                mood: watched.mood,
                inputData: watched as unknown as Record<string, unknown>,
                creditsUsed: 2,
              }}
            />
          </div>
        )}

      </div>
    </div>
  );
}
