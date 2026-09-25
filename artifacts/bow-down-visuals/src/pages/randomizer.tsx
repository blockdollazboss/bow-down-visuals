import { useState } from "react";
import { Link } from "wouter";
import {
  Dices, Sparkles, Loader2, Lightbulb, Clapperboard, Zap,
  Image as ImageIcon, Music, Compass, Flame, ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { CheatCodeName } from "@/components/pixel-headline";

/* ─── Thy Cheat Code's Content Randomizer ─────────────────────────────────
   Public teaser page: the free dice roll is 100% client-side (zero server
   cost). The "Generate 5 fresh with AI" button POSTs to /api/randomizer
   (1 credit per roll, GPT-6 Sol). Category keys must stay in sync with the
   backend route's CATEGORIES enum. */

type CategoryKey =
  | "video-ideas"
  | "hooks"
  | "thumbnails"
  | "song-concepts"
  | "niche-picker"
  | "challenges";

interface Category {
  key: CategoryKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
  freeIdeas: string[];
}

const CATEGORIES: Category[] = [
  {
    key: "video-ideas",
    label: "Video Ideas",
    icon: Clapperboard,
    blurb: "Fresh concepts for your next music video or content drop.",
    freeIdeas: [
      "Day in the life of your artist persona — but every scene is a different music video set",
      "React to your own old songs and roast your past self",
      "Turn your song's lyrics into a 30-second movie trailer",
      "Film the same chorus in 5 wildly different locations, cut on the beat",
      "Behind-the-scenes of your AI video generation — show the prompts, show the magic",
      "POV: your song plays as the villain walks in slow motion",
      "Teach one bar of your verse, then challenge fans to flip it",
      "Green-screen yourself into famous album covers while your track plays",
      "Speedrun: write, record, and shoot a hook in 60 minutes",
      "Your song + a trending meme format = instant promo clip",
      "Acoustic-to-anthem: start stripped down, drop into the full mix",
      "Ask fans to pick your next single's cover art — then reveal the AI options",
    ],
  },
  {
    key: "hooks",
    label: "Hooks",
    icon: Zap,
    blurb: "First-3-second openers that stop the scroll.",
    freeIdeas: [
      "Stop scrolling — this took 47 tries to get right",
      "POV: you just found your new favorite artist",
      "I bet you can't name this sample",
      "This song was made entirely by AI… or was it?",
      "Wait for the drop at 0:07",
      "Nobody talks about this part of being an independent artist",
      "I asked AI to finish my verse — here's what happened",
      "Your playlist is missing this",
      "This is what heartbreak sounds like in 2026",
      "One take. No edits. Full song.",
      "The label said no, so I did it myself",
      "Comment 'FIRE' and I'll drop the full version",
    ],
  },
  {
    key: "thumbnails",
    label: "Thumbnails",
    icon: ImageIcon,
    blurb: "High-click-through concepts for YouTube and beyond.",
    freeIdeas: [
      "Split face: calm on the left, full performance energy on the right",
      "Giant gold text over a dark stage — 3 words max",
      "Your artist portrait with a glowing crown, black background",
      "Before/after: rough demo vs. final master waveform",
      "Close-up of hands on the mic, dramatic side lighting",
      "Red circle + arrow pointing at the wildest frame of your video",
      "You vs. the AI: side-by-side portrait showdown",
      "Neon city backdrop, you silhouetted in the center",
      "Freeze the exact frame the beat drops — add shockwave lines",
      "Stacked polaroids of every look from the shoot",
      "Dark room, single spotlight, gold jewelry catching the light",
      "Big shocked expression + the song title in bold condensed type",
    ],
  },
  {
    key: "song-concepts",
    label: "Song Concepts",
    icon: Music,
    blurb: "Themes and angles worth writing your next track about.",
    freeIdeas: [
      "An anthem about quitting your 9-to-5 to chase the dream",
      "A late-night R&B confession recorded like a voicemail",
      "Trap banger about your hometown finally getting its shine",
      "A diss track aimed at your own self-doubt",
      "Love song for the grind — romance between you and the hustle",
      "Drill track narrated like a nature documentary",
      "Gospel-tinged hook about making it out, verses pure street poetry",
      "A breakup song where the 'ex' is your old sound",
      "Party starter built around a viral dance challenge",
      "Storytelling rap: one verse, one night, one decision that changed everything",
      "Afrobeats fusion celebrating your roots",
      "Cinematic intro track for your alter ego's origin story",
    ],
  },
  {
    key: "niche-picker",
    label: "Niche Picker",
    icon: Compass,
    blurb: "Positioning angles you could own as a creator.",
    freeIdeas: [
      "AI music video director — you make other artists' visuals",
      "The sample detective — you find and flip obscure samples on camera",
      "One-song-a-day challenger — relentless output niche",
      "Genre-blender — you fuse two genres nobody combined before",
      "The hook doctor — you fix weak choruses live",
      "Behind-the-beat educator — you teach production with personality",
      "Character artist — every release is a new persona with lore",
      "Hometown hero documentarian — you put your city on the map",
      "AI vs. human collaborator — every song is a man-vs-machine duel",
      "The remix royalty — you flip trending sounds weekly",
      "Lyric breakdown analyst — you decode bars like film theory",
      "Tiny-desk-style intimate performer — raw, no production hiding",
    ],
  },
  {
    key: "challenges",
    label: "Challenges",
    icon: Flame,
    blurb: "Forcing functions for output and growth.",
    freeIdeas: [
      "Post one clip every day for 30 days — no excuses",
      "Make a song using only sounds from your kitchen",
      "Let your comments pick your next beat — then deliver in 48 hours",
      "Recreate a viral video shot-for-shot with your own twist",
      "Go live and write a verse with chat voting on every bar",
      "Drop a 15-second teaser every day for a week before release",
      "Collab with a creator you've never met — full song in one stream",
      "Perform your song in the weirdest location you can find",
      "Flip the same sample 3 different ways in 3 videos",
      "Teach a fan your chorus over video call, post their attempt",
      "No-face challenge: promote a song for a week without showing your face",
      "Speedrun your entire release rollout in 24 hours",
    ],
  },
];

const AI_CREDIT_COST = 1;

interface RandomizerResponse {
  ideas?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function pickRandom<T>(items: T[], except?: T): T {
  if (items.length === 1) return items[0];
  let pick = items[Math.floor(Math.random() * items.length)];
  let guard = 0;
  while (pick === except && guard++ < 10) {
    pick = items[Math.floor(Math.random() * items.length)];
  }
  return pick;
}

export default function Randomizer() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [activeKey, setActiveKey] = useState<CategoryKey>("video-ideas");
  const [freeIdea, setFreeIdea] = useState<string | null>(null);
  const [aiIdeas, setAiIdeas] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const active = CATEGORIES.find((c) => c.key === activeKey)!;
  const ActiveIcon = active.icon;

  function selectCategory(key: CategoryKey) {
    setActiveKey(key);
    setFreeIdea(null);
    setAiIdeas([]);
    setError(null);
    setOutOfCredits(false);
  }

  function freeRoll() {
    const cat = CATEGORIES.find((c) => c.key === activeKey)!;
    setFreeIdea(pickRandom(cat.freeIdeas, freeIdea ?? undefined));
  }

  async function aiRoll() {
    if (aiLoading || !user) return;
    setAiLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/randomizer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ category: activeKey }),
      });
      const data = (await res.json().catch(() => ({}))) as RandomizerResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.ideas) || data.ideas.length === 0) {
        throw new Error(data.message || data.error || "AI roll failed — try again.");
      }
      setAiIdeas(data.ideas);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("ai-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI roll failed — try again.");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Dices className="h-3 w-3" aria-hidden="true" /> <CheatCodeName possessive /> dice
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Content <span className="text-primary">Randomizer</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Stuck staring at a blank page? Roll the dice for a free spark — or let
            GPT-6 cook up five fresh, made-for-you ideas for a single credit.
          </p>
        </div>

        {/* category tabs */}
        <div className="relative mt-10 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Randomizer categories">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const selected = c.key === activeKey;
            return (
              <button
                key={c.key}
                role="tab"
                aria-selected={selected}
                onClick={() => selectCategory(c.key)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  selected
                    ? "bg-primary text-black shadow-[0_0_18px_rgba(212,175,55,0.35)]"
                    : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {c.label}
              </button>
            );
          })}
        </div>

        {/* main panel */}
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <ActiveIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">{active.label}</h2>
              <p className="text-sm text-white/45">{active.blurb}</p>
            </div>
          </div>

          {/* free roll */}
          <div className="mt-8 text-center">
            <button
              onClick={freeRoll}
              className="group inline-flex items-center gap-2.5 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95"
            >
              <Dices className="h-6 w-6 transition group-hover:rotate-12" aria-hidden="true" />
              Roll the dice
            </button>
            <p className="mt-2.5 text-xs text-white/35">Free forever — roll as much as you want</p>

            {freeIdea && (
              <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-primary/30 bg-black/60 p-5 text-left">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Your roll
                </p>
                <p className="text-[15px] leading-relaxed text-white/90">{freeIdea}</p>
              </div>
            )}
          </div>

          {/* divider */}
          <div className="my-8 flex items-center gap-4" aria-hidden="true">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/30">or go deeper</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          </div>

          {/* AI roll */}
          <div className="text-center">
            {user ? (
              <button
                onClick={aiRoll}
                disabled={aiLoading}
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-6 py-3.5 text-base font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
              >
                {aiLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                )}
                {aiLoading ? "Cooking up ideas…" : `Generate 5 fresh with AI`}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-6 py-3.5 text-base font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                Sign in to generate with AI
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {AI_CREDIT_COST} credit per AI roll · powered by GPT-6
            </p>
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {error && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>

          {/* AI results */}
          {aiIdeas.length > 0 && (
            <div id="ai-results" className="mt-8">
              <div className="mb-4 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Fresh from the AI
                </p>
                {user && (
                  <button
                    onClick={aiRoll}
                    disabled={aiLoading}
                    className="flex items-center gap-1.5 rounded-full border border-primary/40 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    <Dices className="h-3.5 w-3.5" aria-hidden="true" />
                    Re-roll ({AI_CREDIT_COST} credit)
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {aiIdeas.map((idea, i) => (
                  <div
                    key={`${activeKey}-${i}`}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
                  >
                    <p className="mb-1.5 text-[11px] font-black text-primary/70">#{i + 1}</p>
                    <p className="text-sm leading-relaxed text-white/85">{idea}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Like an idea? Ask{" "}
          <CheatCodeName /> 🦈{" "}
          in the chat bubble to turn it into a full plan.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
