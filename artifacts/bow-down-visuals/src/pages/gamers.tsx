import { useState } from "react";
import { Link } from "wouter";
import {
  Gamepad2, Trophy, Zap, Sparkles, Layers, Image as ImageIcon, Scissors,
  Film, Copy, Check, Loader2, ChevronRight, Cpu, Monitor, Mic, Camera,
  Lightbulb, Flame, Tag, Radio, Clapperboard, Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Home of Gamers ──────────────────────────────────────────────────────
   The gaming wing of Bow Down Visuals: dark arena background, neon/RGB
   accents, esports energy — its own world, not the gold/black luxury theme.
   Everything on this page ships fully populated: the AI generator comes
   pre-filled with a game and shows a labeled sample output on first load,
   the ticker/setup/playbook are curated editorial — zero empty states. */

const CREDIT_COST = 1;

type ContentTypeKey = "stream" | "video" | "shorts";

const CONTENT_TYPES: { key: ContentTypeKey; label: string; blurb: string }[] = [
  { key: "stream", label: "Stream", blurb: "Clickable Twitch / YouTube / Kick titles" },
  { key: "video", label: "Video", blurb: "Long-form YouTube gaming concepts" },
  { key: "shorts", label: "Shorts", blurb: "Vertical clips under 60 seconds" },
];

interface IdeasResponse {
  titles?: string[];
  videoIdeas?: string[];
  tags?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

/* Curated sample output so the generator looks alive on first load —
   clearly labeled as a sample; real AI output replaces it on generate. */
const SAMPLE_TITLES = [
  "RADIANT GRIND DAY 12 — no breaks, no mercy",
  "I 1v5 clutched with 1HP and my chat lost it",
  "Iron to Immortal: the comeback arc starts NOW",
  "Pro coach reviews my VOD live — roast incoming",
  "Ranked but every death = 10 pushups",
];
const SAMPLE_IDEAS = [
  "I hired a Radiant coach for 7 days — here's what actually changed",
  "Testing the WORST ranked agent combos so you don't have to",
  "1v1ing viewers until I lose — winner gets a skin",
  "Breaking down a pro aim routine frame by frame",
  "Ranked with randoms, zero comms, full chaos",
];
const SAMPLE_TAGS = [
  "valorant", "valorantclips", "rankedgrind", "fps", "pcgaming",
  "clutch", "gaming", "twitch", "radiant", "aimtraining",
];

const TRENDING_GAMES = [
  { name: "Valorant", tag: "Tactical FPS" },
  { name: "Fortnite", tag: "Battle Royale" },
  { name: "Call of Duty", tag: "FPS" },
  { name: "Minecraft", tag: "Sandbox" },
  { name: "GTA VI", tag: "Open World" },
  { name: "League of Legends", tag: "MOBA" },
  { name: "Apex Legends", tag: "Battle Royale" },
  { name: "Roblox", tag: "UGC Platform" },
  { name: "Elden Ring", tag: "Soulslike" },
  { name: "Rocket League", tag: "Sports" },
];

interface ToolCard {
  href: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  accent: string;
  glow: string;
}

const TOOL_CARDS: ToolCard[] = [
  {
    href: "/stream-pack",
    label: "Stream Overlays & Alerts",
    icon: Layers,
    blurb: "Animated overlays, alerts, and panels that make your stream look pro on day one.",
    accent: "text-cyan-300",
    glow: "hover:border-cyan-400/60 hover:shadow-[0_0_36px_-8px_rgba(0,240,255,0.5)]",
  },
  {
    href: "/thumbnail-maker",
    label: "Gaming Thumbnails",
    icon: ImageIcon,
    blurb: "AI thumbnails built for the click — bold faces, big plays, zero Photoshop needed.",
    accent: "text-fuchsia-400",
    glow: "hover:border-fuchsia-400/60 hover:shadow-[0_0_36px_-8px_rgba(255,43,214,0.5)]",
  },
  {
    href: "/promo-clip",
    label: "Clip Highlights",
    icon: Scissors,
    blurb: "Turn full VODs into viral highlight clips ready for TikTok, Shorts, and Reels.",
    accent: "text-lime-300",
    glow: "hover:border-lime-300/60 hover:shadow-[0_0_36px_-8px_rgba(182,255,46,0.45)]",
  },
  {
    href: "/intros-outros",
    label: "Gaming Intros & Outros",
    icon: Film,
    blurb: "Esports-grade intro stingers and end cards with your branding baked in.",
    accent: "text-violet-400",
    glow: "hover:border-violet-400/60 hover:shadow-[0_0_36px_-8px_rgba(124,58,237,0.55)]",
  },
  {
    href: "/hooks",
    label: "Gaming Hook Generator",
    icon: Zap,
    blurb: "First-3-second openers for gaming content — stop the scroll before they swipe.",
    accent: "text-amber-300",
    glow: "hover:border-amber-300/60 hover:shadow-[0_0_36px_-8px_rgba(252,211,77,0.45)]",
  },
  {
    href: "/go-live",
    label: "Go Live Multistream",
    icon: Radio,
    blurb: "Push your stream to Twitch, YouTube, and Kick from one dashboard — no restream juggling.",
    accent: "text-rose-400",
    glow: "hover:border-rose-400/60 hover:shadow-[0_0_36px_-8px_rgba(251,113,133,0.5)]",
  },
];

const SETUP_OF_THE_DAY = {
  name: "The Neon Citadel",
  tagline: "A 4K-ready battle station tuned for streaming and ranked alike.",
  parts: [
    { icon: Cpu, item: "RTX 5080 GPU", note: "4K high-refresh gaming while encoding the stream — no dropped frames." },
    { icon: Monitor, item: '27" 360Hz OLED', note: "See them before they see you. Motion clarity is a cheat code." },
    { icon: Mic, item: "Shure SM7dB", note: "Broadcast voice with the preamp built in — zero room noise." },
    { icon: Camera, item: "Sony ZV-E10", note: "That crisp facecam look the big streamers run." },
    { icon: Lightbulb, item: "2× RGB light panels", note: "Match your overlay palette. Lighting is branding." },
  ],
};

const PLAYBOOK_TIPS = [
  {
    title: "Open with the play, not the lobby",
    body: "The first 30 seconds decide everything. Start the VOD at the clutch — introductions can wait.",
  },
  {
    title: "Clip it while it's hot",
    body: "Mark timestamps mid-stream. Your future self will thank you when highlight hour hits.",
  },
  {
    title: "Title like a thumbnail",
    body: "Curiosity + stakes in under 70 characters. If it doesn't make YOU click, rewrite it.",
  },
  {
    title: "Raid up, not down",
    body: "End every stream by sending your community to another creator. The algorithm remembers generosity.",
  },
];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-cyan-400/50 hover:text-cyan-300"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-lime-300" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function GamersHub() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  /* ── AI generator state (pre-filled so nothing waits on the user) ── */
  const [game, setGame] = useState("Valorant");
  const [niche, setNiche] = useState("");
  const [contentType, setContentType] = useState<ContentTypeKey>("stream");
  const [titles, setTitles] = useState<string[]>(SAMPLE_TITLES);
  const [videoIdeas, setVideoIdeas] = useState<string[]>(SAMPLE_IDEAS);
  const [tags, setTags] = useState<string[]>(SAMPLE_TAGS);
  const [isSample, setIsSample] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  async function authedPost(body: Record<string, unknown>) {
    const token = await getAccessToken().catch(() => null);
    return confirmedFetch("/api/gamers/ideas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function generate() {
    if (loading || !user) return;
    if (!game.trim()) {
      setError("Tell us which game first — the AI needs a target.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedPost({ game: game.trim(), niche: niche.trim(), contentType });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as IdeasResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.titles?.length || !data.videoIdeas?.length) {
        throw new Error(data.message || data.error || "Generation failed");
      }
      setTitles(data.titles.slice(0, 5));
      setVideoIdeas(data.videoIdeas.slice(0, 5));
      setTags((data.tags ?? []).slice(0, 10));
      setIsSample(false);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The generator hiccupped — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="gamers-scanlines relative min-h-screen bg-[#050510] text-white">
      <MarketingNav />

      {/* ── HERO ── */}
      <header className="relative overflow-hidden">
        <div className="gamers-grid-floor pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="gamers-glow-pulse h-[260px] w-[620px] rounded-full bg-fuchsia-600/20 blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-5xl px-5 pb-16 pt-16 text-center md:pt-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300">
            <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" /> Player One Ready
          </p>
          <h1 className="gamers-rgb-text text-5xl font-black uppercase leading-none tracking-tight md:text-8xl">
            Home of Gamers
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/60 md:text-lg">
            The content creator cheat code for the gaming universe. AI stream titles,
            viral clip tools, thumbnails, overlays — everything a gaming creator
            needs, one arena.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#idea-generator"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-600 px-6 py-3 text-sm font-bold text-white shadow-[0_0_28px_-6px_rgba(0,240,255,0.6)] transition hover:brightness-110"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Generate stream ideas
            </a>
            <a
              href="#toolkit"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-bold text-white/80 transition hover:border-cyan-400/50 hover:text-white"
            >
              Browse gamer tools <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-3">
            {[
              { n: "5", l: "Gamer tools wired in" },
              { n: "3", l: "Content types" },
              { n: "1", l: "Credit per idea pack" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-4">
                <p className="gamers-rgb-text text-3xl font-black">{s.n}</p>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-white/40">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── TRENDING TICKER ── */}
      <div className="relative border-y border-white/10 bg-black/60 py-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="z-10 flex shrink-0 items-center gap-1.5 bg-black px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-lime-300">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" /> Trending in the arena
          </span>
          <div className="gamers-ticker-track flex shrink-0 items-center gap-8 whitespace-nowrap">
            {[...TRENDING_GAMES, ...TRENDING_GAMES].map((g, i) => (
              <span key={i} className="flex items-center gap-2 text-sm text-white/70">
                <Gamepad2 className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                <span className="font-bold text-white">{g.name}</span>
                <span className="text-white/35">· {g.tag}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <main className="relative mx-auto max-w-5xl px-5 pb-24">
        {/* ── AI IDEA GENERATOR ── */}
        <section id="idea-generator" className="scroll-mt-24 pt-14">
          <div className="overflow-hidden rounded-3xl border border-fuchsia-500/25 bg-gradient-to-b from-[#0d0716] to-[#050510] p-6 md:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-fuchsia-300">
                  <Wand2 className="h-3 w-3" aria-hidden="true" /> AI powered · {CREDIT_COST} credit
                </p>
                <h2 className="text-2xl font-black uppercase tracking-tight md:text-3xl">
                  Stream Title <span className="gamers-rgb-text">&amp; Idea Generator</span>
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">
                  Drop in your game — the AI writes clickable stream titles, video
                  concepts, and tags tuned for Twitch, YouTube, and Kick.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="gamers-game" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                  Your game
                </label>
                <input
                  id="gamers-game"
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  placeholder="e.g. Valorant"
                  maxLength={120}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="gamers-niche" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                  Niche / angle <span className="text-white/25">(optional)</span>
                </label>
                <input
                  id="gamers-niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="e.g. clutch plays, ranked grind, funny moments"
                  maxLength={120}
                  className={inputClass}
                />
              </div>
            </div>

            <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              Content type
            </p>
            <div className="flex flex-wrap gap-2">
              {CONTENT_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setContentType(t.key)}
                  title={t.blurb}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-bold transition ${
                    contentType === t.key
                      ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-200 shadow-[0_0_20px_-6px_rgba(0,240,255,0.6)]"
                      : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={generate}
              disabled={loading || !user}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-violet-600 to-fuchsia-600 px-6 py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-[0_0_32px_-8px_rgba(124,58,237,0.8)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" /> Generate ideas · {CREDIT_COST} credit
                </>
              )}
            </button>
            {!user && (
              <p className="mt-3 text-xs text-white/40">
                <Link href="/login" className="text-cyan-300 underline">Sign in</Link> to generate — browsing is free.
              </p>
            )}
            {outOfCredits && (
              <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>
            )}
            {error && !outOfCredits && (
              <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{error}</p>
            )}

            {/* results */}
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-cyan-300">
                    <Radio className="h-4 w-4" aria-hidden="true" /> Stream titles
                  </h3>
                  {isSample && (
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/40">
                      Sample
                    </span>
                  )}
                </div>
                <ul className="space-y-2.5">
                  {titles.map((t, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-sm text-white/85">
                      <span>{t}</span>
                      <CopyButton text={t} />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-fuchsia-300">
                    <Clapperboard className="h-4 w-4" aria-hidden="true" /> Video ideas
                  </h3>
                  {isSample && (
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/40">
                      Sample
                    </span>
                  )}
                </div>
                <ul className="space-y-2.5">
                  {videoIdeas.map((t, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-sm text-white/85">
                      <span>{t}</span>
                      <CopyButton text={t} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-lime-300">
                  <Tag className="h-4 w-4" aria-hidden="true" /> Tags
                </h3>
                {isSample && (
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/40">
                    Sample
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.map((t, i) => (
                  <span key={i} className="rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-xs font-semibold text-lime-200">
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── TOOLKIT HUB ── */}
        <section id="toolkit" className="scroll-mt-24 pt-14">
          <div className="mb-6 text-center">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-cyan-300">
              <Trophy className="h-3 w-3" aria-hidden="true" /> Loadout
            </p>
            <h2 className="text-2xl font-black uppercase tracking-tight md:text-3xl">
              The Gamer <span className="gamers-rgb-text">Toolkit</span>
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-white/55">
              Every tool reframed for the grind — click a card to load it up.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_CARDS.map((card) => (
              <Link key={card.href} href={card.href} className={`group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition ${card.glow}`}>
                <card.icon className={`h-8 w-8 ${card.accent}`} aria-hidden="true" />
                <h3 className="mt-4 text-base font-black uppercase tracking-wide">{card.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{card.blurb}</p>
                <span className={`mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest ${card.accent}`}>
                  Open tool <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── SETUP OF THE DAY ── */}
        <section className="pt-14">
          <div className="overflow-hidden rounded-3xl border border-cyan-400/25 bg-gradient-to-b from-[#071018] to-[#050510] p-6 md:p-10">
            <div className="mb-6 text-center">
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-lime-300/40 bg-lime-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-lime-300">
                <Zap className="h-3 w-3" aria-hidden="true" /> Free · Setup of the day
              </p>
              <h2 className="text-2xl font-black uppercase tracking-tight md:text-3xl">
                {SETUP_OF_THE_DAY.name}
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-white/55">{SETUP_OF_THE_DAY.tagline}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {SETUP_OF_THE_DAY.parts.map((p) => (
                <div key={p.item} className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/40 p-4">
                  <span className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-2.5">
                    <p.icon className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-black uppercase tracking-wide">{p.item}</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/55">{p.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PLAYBOOK ── */}
        <section className="pt-14">
          <div className="mb-6 text-center">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-fuchsia-300">
              <Flame className="h-3 w-3" aria-hidden="true" /> Free · Streamer playbook
            </p>
            <h2 className="text-2xl font-black uppercase tracking-tight md:text-3xl">
              Plays that <span className="gamers-rgb-text">win viewers</span>
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {PLAYBOOK_TIPS.map((tip, i) => (
              <div key={tip.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <p className="gamers-rgb-text text-3xl font-black">0{i + 1}</p>
                <h3 className="mt-2 text-base font-black">{tip.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{tip.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
