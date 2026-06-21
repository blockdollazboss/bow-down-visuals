import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Film, ArrowLeft,
  Copy, CheckCheck, Loader2, Download, Save, ChevronRight,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface FormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  platform: string;
  promoGoal: string;
  songHook: string;
  specialInstructions: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const GENRES  = ["Hip Hop","Drill","Trap","R&B","Pop","Afrobeats","Dancehall","Gospel","Kids Music","Rock","Country","Other"];
const MOODS   = ["Luxury","Dark","Emotional","Street","Romantic","Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly"];
const PLATFORMS = ["TikTok","Instagram Reels","YouTube Shorts","All Platforms"];
const GOALS   = ["Build hype before release","Promote new song","Push music video","Get more streams","Go viral with hook","Promote artist brand","Announce release date"];

/* ─────────────────────────── PLACEHOLDER ─────────────────────────── */

function buildPlaceholder(v: FormValues) {
  const artist = v.artistName || "The Artist";
  const title  = v.songTitle  || "Untitled";
  const genre  = v.genre      || "Hip Hop";
  const mood   = v.mood       || "Energetic";
  const goal   = v.promoGoal  || "Promote new song";
  const hook   = v.songHook   || "your best bar";
  const platform = v.platform || "All Platforms";

  const genreTag  = genre.replace(/\s/g, "");
  const artistTag = artist.replace(/\s/g, "");
  const titleTag  = title.replace(/\s/g, "").replace(/[^a-zA-Z0-9]/g, "");

  return {
    "TikTok Clip Ideas": `Clip 1 — Hook Loop (15 sec)
Start mid-lyric, no intro. The hook plays on loop while you lip sync directly to camera. Fast cuts every 2 bars. End on a freeze-frame with text overlay: "${title} out now."

Clip 2 — Reaction / Point Duet Bait (15–30 sec)
Post a clip of just the hardest bar playing — no talking, no context. Stare into the camera. The goal: people duet and stitch reacting to it.

Clip 3 — Day-in-the-Life With Sound (30–60 sec)
Studio session, drive, or getting ready — your song playing in the background the whole time. Caption: "new music dropping soon." Don't explain. Let curiosity do the work.

Clip 4 — Text Drop (7 sec)
Black screen. White text: "${title}." Then your song drops for 5 seconds. Cut. That's it. Maximum intrigue.

Clip 5 — Behind-the-Scenes Studio Clip
Show the session where this song was made. Raw footage. No polish. The realness is the content. Add the hook as the background audio.`,

    "Instagram Reel Ideas": `Reel 1 — High-Production Visual (15–30 sec)
Best 3–5 shots from your music video or photo shoot, cut to the beat. Lyrics overlay on screen. End on your artist name + release date. Use a bold font and high-contrast palette.

Reel 2 — The Lyric Reveal (15 sec)
Single shot, facing the camera, as the hook plays. Each line of the lyric appears on screen as it's delivered. Simple. Stops the scroll.

Reel 3 — Before & After Energy (30 sec)
Split screen or back-to-back: "before ${title}" (low energy or everyday moment) vs. "after ${title}" (the song drops, energy shifts). Trending format.

Reel 4 — Loop-Bait Intro (8 sec)
Start with the last frame of the clip and loop it back to the beginning — viewers watch twice without realizing. Algorithm loves loop rate.

Reel 5 — Fan Engagement
Post a still photo with your song as the audio. Ask in the caption: "What does this song sound like to you?" Comment replies = reach.`,

    "YouTube Shorts Ideas": `Short 1 — Full Hook Performance (30–60 sec)
Performed straight to camera. No cuts. Single location. Direct eye contact. The simplest format — and the most rewatchable when the energy is right.

Short 2 — Story Format (45–60 sec)
Narrate the meaning behind "${title}" in your own words — 30 seconds talking, then 15 seconds of the actual song. Fans connect when they know the story.

Short 3 — Countdown Drop
"${title}" drops in [X] days. Number on screen each day. Simple image or clip. Posted daily in the week before release. Builds anticipation without giving anything away.

Short 4 — Process Clip
Show the creative process: beat playing, writing in a notebook, recording vocals. Voiceover: "Made this entire record in one session." Real + creative = high engagement.

Short 5 — The Cold Quote Drop
Start with your hardest line from the song in text only — no music. 3 seconds of silence. Then the full hook drops. Let the lyric do the advertising.`,

    "Hook Clip Concepts": `Concept 1 — Straight-to-Camera Delivery
No setup. No intro. The hook starts, you're already in the frame, already in character. The viewer is dropped into the energy immediately.

Concept 2 — Split Lyric Display
Each word of the hook appears on screen one beat at a time. Big white text on black background. Artist performing in the corner. Karaoke energy — designed for sound-off viewers.

Concept 3 — Environment Match
Film the hook performance in an environment that matches the lyric. ${mood === "Luxury" ? "Luxury setting — car, penthouse, overlooking city." : mood === "Street" ? "Urban outdoor setting — block, alley, rooftop." : mood === "Emotional" ? "Intimate indoor setting — bedroom, studio, empty hallway." : "A location that visually represents the song's emotion and theme."}

Concept 4 — Slowmo Freeze
Normal speed through the verse, then the hook hits in slow motion. Dramatic entrance. Works especially well for ${genre} with a hard-hitting production drop.`,

    "Best-Bar Clip Concepts": `Concept 1 — Isolated Bar Drop
Pull the single hardest bar from the song. 10-second clip. That bar plays once. Nothing else. Just the lyric on screen and you performing it. Post it with zero caption.

Concept 2 — Annotation Breakdown
The bar plays while text annotations appear explaining the punchline, the double meaning, or the cultural reference. Educates and entertains simultaneously.

Concept 3 — Studio Raw Take
The recording session moment when you nailed the bar — unedited. Engineer reaction is a bonus. This format consistently outperforms polished clips for engagement.

Concept 4 — Challenge Seed
Post the bar and say "I dare you to say this faster." Participation content. Stitches, duets, and comments = free distribution.`,

    "On-Screen Text Ideas": `Release Announcements:
• "${title}" — Out Now
• New Music. ${artist}. Listen Now.
• Stream "${title}" — Link In Bio
• ${artist} x "${title}" — Available Everywhere

Engagement Prompts:
• Save this if you feel this 🎵
• What does this song remind you of?
• Tell me you've been here without telling me 👇
• This one's for everyone who needed to hear it

Hype Builders (Pre-Release):
• Coming Soon. You're not ready.
• "${title}" drops [DATE]. Set your reminder.
• I've been sitting on this record for too long.
• The visuals are done. The song is mixed. The date is set.

Artist Brand Text:
• ${artist}. No features. No label. Just music.
• Built different. Sounds different.
• This is what happens when you don't quit.`,

    "Caption Ideas": `Drop Day Caption:
🎵 "${title}" is out now.
Every bar, every line — this one means everything.
Stream it. Share it. Save it. Link in bio.
#${genreTag} #${artistTag} #NewMusic #${titleTag}

Pre-Release Tease:
The record I've been working on is almost ready.
"${title}" — coming [DATE].
Let me know if you're ready. 👀
#ComingSoon #${genreTag} #NewMusic

Engagement-Focused:
Drop your fave lyric from "${title}" in the comments 👇
I'll reply to every one.
#${genreTag} #${artistTag}

Emotional Connection:
Made this record during one of the hardest periods of my life.
"${title}" — out now.
If it hits, you'll know why.
#${mood} #${genreTag} #NewMusic #${artistTag}`,

    "Hashtags": `Primary (always use):
#${genreTag} #${artistTag} #NewMusic #NewSong #${titleTag}

Genre-Specific:
${genre === "Hip Hop" ? "#HipHop #Rap #NewRap #HipHopMusic #RapMusic" : genre === "R&B" ? "#RnB #RandB #SoulMusic #NewRnB #RnBVibes" : genre === "Drill" ? "#Drill #DrillMusic #UKDrill #BrooklynDrill #NewDrill" : genre === "Afrobeats" ? "#Afrobeats #Afropop #AfroMusic #NewAfrobeats #AfroVibes" : `#${genreTag} #${genreTag}Music #New${genreTag}`}

Goal-Specific:
${goal === "Go viral with hook" ? "#Viral #ViralMusic #HookSong #SongOfTheDay #MusicTikTok" : goal === "Get more streams" ? "#Spotify #AppleMusic #StreamNow #NewRelease #ListenNow" : goal === "Push music video" ? "#MusicVideo #NewMusicVideo #OfficialVideo #WatchNow" : "#MusicPromotion #IndependentArtist #NewRelease #StreamNow"}

Discovery:
#MusicCreator #IndependentMusic #${mood}Music #SupportIndependentArtists #UnsignedArtist

Platform-Specific:
${platform === "TikTok" || platform === "All Platforms" ? "#MusicTikTok #TikTokMusic #FYP #ForYou #ForYouPage" : ""}${platform === "Instagram Reels" || platform === "All Platforms" ? " #Reels #ReelsMusic #InstagramReels #ReelViral" : ""}${platform === "YouTube Shorts" || platform === "All Platforms" ? " #Shorts #YouTubeShorts #MusicShorts" : ""}`,

    "Posting Strategy": `Pre-Release Schedule (7 days out):
Day 7 — Announce the song title. No audio. Just the name and date.
Day 5 — Post a 7-second mystery clip. No lyrics visible. Just the vibe.
Day 3 — Drop the hook clip. First time audio is heard publicly.
Day 1 — "Tomorrow." Single word post. Maximum tension.
Release Day — Full clip + link in bio + story push + go live 1 hour after.

Posting Times (${platform === "TikTok" ? "TikTok" : platform === "Instagram Reels" ? "Instagram" : platform === "YouTube Shorts" ? "YouTube" : "All Platforms"}):
• Best time: 12PM–3PM and 7PM–10PM in your primary audience timezone
• Post the hook clip first — highest engagement format
• Story + feed + repost all within 30 minutes of each other
• Pin the release post to your profile immediately

Post-Release (Days 1–7):
Day 1 — Music video or lyric video
Day 2 — Behind-the-scenes studio clip
Day 3 — Hardest bar isolated clip
Day 4 — Fan reaction repost or duet
Day 5 — "If you haven't heard it yet" reminder post
Day 7 — First week stream count + thank you post`,

    "Call-To-Action Ideas": `Stream CTAs:
• "Link in bio — go stream it now."
• "It's out. Tap the link. You won't regret it."
• "First week matters. Stream "${title}" today."

Save / Follow CTAs:
• "Save this if it hits. I'll drop more."
• "Follow for the visual dropping next week."
• "Turn on notifications — you don't want to miss what's coming."

Share CTAs:
• "Send this to someone who needs to hear it."
• "Tag an artist who should collab on the remix."
• "Share this with your city. Let's get it to the top."

Comment CTAs:
• "Drop your favorite bar in the comments 👇"
• "Tell me what this song reminds you of."
• "What should the music video look like? Comment your idea."

Engagement CTAs:
• "Like this if you felt that."
• "Duet this with your reaction — I'm watching."
• "Stitch this and tell me your take."`,
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

/* ─────────────────────────── RESULT ─────────────────────────── */

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
          <h2 className="text-2xl font-black text-white">Promo Clip Pack</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleCopy} variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2">
            {copied ? <CheckCheck className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Result"}
          </Button>
          <Button onClick={onClear} variant="outline" size="sm" className="border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white gap-2">
            Clear Result
          </Button>
          <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-2">
            <Save className="h-4 w-4" /> Save Project
            <Badge variant="outline" className="border-white/10 text-white/25 text-[10px] ml-1">Soon</Badge>
          </Button>
          <Button variant="outline" size="sm" disabled className="border-white/5 text-white/25 cursor-not-allowed gap-2">
            <Download className="h-4 w-4" /> Download
            <Badge variant="outline" className="border-white/10 text-white/25 text-[10px] ml-1">Soon</Badge>
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

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function PromoClip() {
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      platform: "", promoGoal: "", songHook: "", specialInstructions: "",
    },
  });

  const watched = watch();

  async function onSubmit(values: FormValues) {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await callGenerateApi("/api/generate-promo-clips", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        genre: values.genre,
        mood: values.mood,
        platform: values.platform,
        promoGoal: values.promoGoal,
        songHook: values.songHook,
        instructions: values.specialInstructions,
      });
      setResult(data);
      setTimeout(() => {
        document.getElementById("promo-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Film className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">
              1 credit
            </Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Promo Clip Maker
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Create TikTok, Reels, and YouTube Shorts ideas to promote your next release.
          </p>

          {/* Output preview pills */}
          <div className="flex flex-wrap gap-2 mt-5">
            {["TikTok Ideas","Reel Concepts","YouTube Shorts","Hook Clips","Caption Pack","Hashtags","Posting Strategy","Call-to-Actions"].map((tag) => (
              <span key={tag} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/50 px-3 py-1 rounded-full">{tag}</span>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">

            {/* Row 1 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Artist Name">
                <Input {...register("artistName", { required: true })} placeholder="e.g. Lil Nova"
                  className={inputClass + (errors.artistName ? " border-red-500/50" : "")} />
                {errors.artistName && <p className="text-red-400 text-xs mt-1">Required</p>}
              </FieldWrapper>
              <FieldWrapper label="Song Title">
                <Input {...register("songTitle")} placeholder="e.g. On My Way Up" className={inputClass} />
              </FieldWrapper>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Genre">
                <StyledSelect name="genre" placeholder="Select genre..." options={GENRES}
                  value={watched.genre} onChange={(v) => setValue("genre", v)} />
              </FieldWrapper>
              <FieldWrapper label="Mood">
                <StyledSelect name="mood" placeholder="Select mood..." options={MOODS}
                  value={watched.mood} onChange={(v) => setValue("mood", v)} />
              </FieldWrapper>
            </div>

            {/* Row 3 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Platform">
                <StyledSelect name="platform" placeholder="Select platform..." options={PLATFORMS}
                  value={watched.platform} onChange={(v) => setValue("platform", v)} />
              </FieldWrapper>
              <FieldWrapper label="Promo Goal">
                <StyledSelect name="promoGoal" placeholder="Select goal..." options={GOALS}
                  value={watched.promoGoal} onChange={(v) => setValue("promoGoal", v)} />
              </FieldWrapper>
            </div>

            {/* Song Hook */}
            <FieldWrapper label="Song Hook / Best Lyrics">
              <Textarea {...register("songHook", { required: true })}
                placeholder="Paste your hook, best bar, or the lyrics you want to build the promo clips around. The more specific, the better the output..."
                className={textareaClass + (errors.songHook ? " border-red-500/50" : "")}
                style={{ minHeight: "140px" }} />
              {errors.songHook && <p className="text-red-400 text-xs mt-1">Required — paste your hook or best bar</p>}
            </FieldWrapper>

            {/* Special Instructions */}
            <FieldWrapper label="Special Instructions">
              <Textarea {...register("specialInstructions")}
                placeholder="Any specific clip formats, content you want to avoid, cultural context, trending sounds to reference, release date, or platform-specific notes..."
                className={textareaClass}
                style={{ minHeight: "100px" }} />
            </FieldWrapper>

            {/* Submit */}
            <div className="pt-2">
              <Button type="submit" size="lg" disabled={loading}
                className="w-full sm:w-auto purple-glow font-bold text-base px-12 rounded-xl gap-3"
                style={{ height: "52px" }}>
                {loading
                  ? <><Loader2 className="h-5 w-5 animate-spin" /> Building your promo pack...</>
                  : <><Film className="h-5 w-5" /> Generate Promo Clip Pack</>}
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
          <div id="promo-result">
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
