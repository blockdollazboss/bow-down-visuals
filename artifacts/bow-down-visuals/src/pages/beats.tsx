import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Disc3, Loader2, Play, Pause, Sparkles, Plus, Search, SlidersHorizontal,
  Tag, BadgeDollarSign, Store, BarChart3, Music2, AlertTriangle, CheckCircle2,
  X,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Beat Marketplace ──────────────────────────────────────────────────────
   Producers list beats (free), artists browse / preview / license them.
   License tiers: Basic / Premium / Exclusive. Site takes 15% commission.
   v1 honesty: license "purchase" records intent only — payment processing
   is coming soon, so no money moves yet. The UI says so plainly.
   AI tag suggester: 1 credit, analyzes metadata, suggests genre + mood tags. */

interface Beat {
  id: string;
  user_id: string;
  title: string;
  audio_url: string;
  preview_url: string | null;
  genre: string;
  bpm: number | null;
  musical_key: string | null;
  mood_tags: string[];
  description: string | null;
  basic_price_cents: number;
  premium_price_cents: number;
  exclusive_price_cents: number;
  exclusive_sold: boolean;
  plays: number;
  created_at: string;
}

interface License {
  id: string;
  beat_id: string;
  tier: string;
  price_cents: number;
  status: string;
  created_at: string;
}

const LICENSE_TIERS = [
  { key: "basic", label: "Basic", blurb: "MP3 lease · 1 music video · 50k streams" },
  { key: "premium", label: "Premium", blurb: "WAV + MP3 · 2 music videos · 500k streams" },
  { key: "exclusive", label: "Exclusive", blurb: "Full ownership · stems · unlimited" },
] as const;

const GENRES = ["hip-hop", "trap", "drill", "r&b", "afrobeats", "pop", "edm", "lofi", "rock", "latin"];

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function priceFor(beat: Beat, tier: string): number {
  return tier === "basic" ? beat.basic_price_cents
    : tier === "premium" ? beat.premium_price_cents
    : beat.exclusive_price_cents;
}

export default function Beats() {
  const { user } = useAuth();
  const [beats, setBeats] = useState<Beat[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"browse" | "sell" | "dashboard">("browse");

  /* Browse filters */
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [search, setSearch] = useState("");
  const [minBpm, setMinBpm] = useState("");
  const [maxBpm, setMaxBpm] = useState("");

  /* Player */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  /* License modal */
  const [licenseBeat, setLicenseBeat] = useState<Beat | null>(null);
  const [licenseTier, setLicenseTier] = useState<string>("basic");
  const [licensing, setLicensing] = useState(false);
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null);

  /* Sell form */
  const [title, setTitle] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [sellGenre, setSellGenre] = useState("hip-hop");
  const [bpm, setBpm] = useState("");
  const [musicalKey, setMusicalKey] = useState("");
  const [moodTags, setMoodTags] = useState("");
  const [description, setDescription] = useState("");
  const [basicPrice, setBasicPrice] = useState("29.99");
  const [premiumPrice, setPremiumPrice] = useState("99.99");
  const [exclusivePrice, setExclusivePrice] = useState("499.99");
  const [listing, setListing] = useState(false);
  const [listMsg, setListMsg] = useState<string | null>(null);
  const [aiTagging, setAiTagging] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Dashboard */
  const [myBeats, setMyBeats] = useState<Beat[]>([]);
  const [sales, setSales] = useState<License[]>([]);
  const [stats, setStats] = useState<{ beatCount: number; saleCount: number; grossCents: number; netCents: number } | null>(null);

  const fetchBeats = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (genre) q.set("genre", genre);
      if (mood) q.set("mood", mood);
      if (search) q.set("search", search);
      if (minBpm) q.set("minBpm", minBpm);
      if (maxBpm) q.set("maxBpm", maxBpm);
      const res = await fetch(`/api/beats?${q.toString()}`);
      if (res.ok) {
        const data = await res.json() as { beats?: Beat[] };
        setBeats(data.beats ?? []);
      }
    } catch { /* page still renders */ }
    setLoading(false);
  };

  useEffect(() => { fetchBeats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDashboard = async () => {
    try {
      const res = await fetch("/api/beats/mine/dashboard");
      if (res.ok) {
        const data = await res.json() as { beats?: Beat[]; sales?: License[]; stats?: typeof stats };
        setMyBeats(data.beats ?? []);
        setSales(data.sales ?? []);
        setStats(data.stats ?? null);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (tab === "dashboard" && user) fetchDashboard();
  }, [tab, user]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlay(beat: Beat) {
    const el = audioRef.current;
    if (!el) return;
    if (playingId === beat.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = beat.preview_url ?? beat.audio_url;
    el.play().catch(() => {});
    setPlayingId(beat.id);
  }

  async function submitListing() {
    if (!title.trim() || !audioUrl.trim()) {
      setListMsg("Title and audio URL are required.");
      return;
    }
    setListing(true);
    setListMsg(null);
    try {
      const res = await fetch("/api/beats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          audioUrl: audioUrl.trim(),
          genre: sellGenre,
          bpm: bpm ? Number(bpm) : undefined,
          musicalKey: musicalKey.trim() || undefined,
          moodTags: moodTags.split(",").map((t) => t.trim()).filter(Boolean),
          description: description.trim() || undefined,
          basicPriceCents: Math.round(Number(basicPrice) * 100),
          premiumPriceCents: Math.round(Number(premiumPrice) * 100),
          exclusivePriceCents: Math.round(Number(exclusivePrice) * 100),
        }),
      });
      const data = await res.json() as { beat?: Beat; error?: string };
      if (!res.ok) {
        setListMsg(data.error ?? "Listing failed.");
      } else {
        setListMsg(`"${data.beat?.title}" is live on the marketplace.`);
        setTitle(""); setAudioUrl(""); setBpm(""); setMusicalKey("");
        setMoodTags(""); setDescription("");
        fetchBeats();
      }
    } catch {
      setListMsg("Listing failed — try again.");
    }
    setListing(false);
  }

  async function runAiTags() {
    // AI tags apply to the sell form's metadata draft — we need a saved beat,
    // so this runs against the most recent listing or prompts to list first.
    setListMsg("List your beat first, then run AI tags from your dashboard.");
  }

  async function suggestTagsForBeat(beatId: string): Promise<{ genre: string; moodTags: string[] } | null> {
    setAiTagging(true);
    try {
      const res = await fetch(`/api/beats/${beatId}/ai-tags`, { method: "POST" });
      if (res.status === 402) {
        setOutOfCredits(true);
        return null;
      }
      const data = await res.json() as { genre?: string; moodTags?: string[]; error?: string };
      if (!res.ok) return null;
      return { genre: data.genre ?? sellGenre, moodTags: data.moodTags ?? [] };
    } catch {
      return null;
    } finally {
      setAiTagging(false);
    }
  }

  async function reserveLicense() {
    if (!licenseBeat) return;
    setLicensing(true);
    setLicenseMsg(null);
    try {
      const res = await fetch(`/api/beats/${licenseBeat.id}/license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: licenseTier }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) {
        setLicenseMsg(data.error ?? "License failed.");
      } else {
        setLicenseMsg(data.message ?? "License reserved.");
      }
    } catch {
      setLicenseMsg("License failed — try again.");
    }
    setLicensing(false);
  }

  const filteredCount = useMemo(() => beats.length, [beats]);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />

      <main className="max-w-7xl mx-auto px-5 md:px-8 py-10">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-xs font-semibold mb-4">
            <Disc3 className="w-3.5 h-3.5" /> BEAT MARKETPLACE
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">
            Buy beats. <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-amber-500">Sell beats.</span>
          </h1>
          <p className="text-white/50 mt-3 max-w-xl mx-auto">
            Producers list for free. Artists license in one click. 15% site commission on sales.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-2 mb-8">
          {([
            { key: "browse", label: "Browse Beats", icon: Search },
            { key: "sell", label: "Sell a Beat", icon: Plus },
            { key: "dashboard", label: "Producer Dashboard", icon: BarChart3 },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                tab === t.key
                  ? "bg-yellow-500/15 border-yellow-500/40 text-yellow-200"
                  : "border-white/10 text-white/50 hover:text-white hover:border-white/20"
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "browse" && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-6 p-4 rounded-2xl border border-white/10 bg-white/[0.02]">
              <SlidersHorizontal className="w-4 h-4 text-white/40" />
              <select value={genre} onChange={(e) => setGenre(e.target.value)}
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80">
                <option value="">All genres</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Mood (e.g. dark)"
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm w-36 placeholder:text-white/25" />
              <input value={minBpm} onChange={(e) => setMinBpm(e.target.value)} placeholder="Min BPM" type="number"
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm w-24 placeholder:text-white/25" />
              <input value={maxBpm} onChange={(e) => setMaxBpm(e.target.value)} placeholder="Max BPM" type="number"
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm w-24 placeholder:text-white/25" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles…"
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px] placeholder:text-white/25" />
              <button onClick={fetchBeats}
                className="px-4 py-1.5 rounded-lg bg-yellow-500 text-black text-sm font-bold hover:bg-yellow-400">
                Filter
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-yellow-400" /></div>
            ) : beats.length === 0 ? (
              <div className="text-center py-16 text-white/40">
                <Music2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                No beats match. Try clearing the filters — or list the first one.
              </div>
            ) : (
              <>
                <p className="text-white/40 text-sm mb-4">{filteredCount} beat{filteredCount === 1 ? "" : "s"}</p>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {beats.map((beat) => (
                    <div key={beat.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 hover:border-yellow-500/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => togglePlay(beat)}
                          className="shrink-0 w-12 h-12 rounded-full bg-yellow-500 text-black flex items-center justify-center hover:bg-yellow-400"
                          aria-label={playingId === beat.id ? "Pause preview" : "Play preview"}
                        >
                          {playingId === beat.id ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold truncate">{beat.title}</h3>
                          <p className="text-xs text-white/40">
                            {beat.genre}{beat.bpm ? ` · ${beat.bpm} BPM` : ""}{beat.musical_key ? ` · ${beat.musical_key}` : ""}
                          </p>
                        </div>
                      </div>
                      {beat.mood_tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {beat.mood_tags.slice(0, 5).map((t) => (
                            <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">#{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-4">
                        <span className="text-sm text-yellow-200 font-semibold">from {centsToDollars(beat.basic_price_cents)}</span>
                        <button
                          onClick={() => { setLicenseBeat(beat); setLicenseTier("basic"); setLicenseMsg(null); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500 text-black text-sm font-bold hover:bg-yellow-400"
                        >
                          <BadgeDollarSign className="w-4 h-4" /> License
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "sell" && (
          <div className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><Store className="w-5 h-5 text-yellow-400" /> List a beat — free</h2>
            <p className="text-white/40 text-sm mb-6">Listing is free. The site takes 15% only when you sell.</p>

            <label className="block text-sm text-white/60 mb-1">Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midnight Drive"
              className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 placeholder:text-white/25" />

            <label className="block text-sm text-white/60 mb-1">Audio URL (MP3/WAV) *</label>
            <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://…"
              className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 placeholder:text-white/25" />

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Genre</label>
                <select value={sellGenre} onChange={(e) => setSellGenre(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm">
                  {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">BPM</label>
                <input value={bpm} onChange={(e) => setBpm(e.target.value)} type="number" placeholder="140"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/25" />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Key</label>
                <input value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)} placeholder="C min"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/25" />
              </div>
            </div>

            <label className="block text-sm text-white/60 mb-1">Mood tags (comma-separated)</label>
            <div className="flex gap-2 mb-4">
              <input value={moodTags} onChange={(e) => setMoodTags(e.target.value)} placeholder="dark, aggressive, bouncy"
                className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/25" />
              <button onClick={runAiTags} title="List your beat first, then use AI tags from the dashboard"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-yellow-500/40 text-yellow-200 text-sm font-semibold hover:bg-yellow-500/10">
                <Sparkles className="w-4 h-4" /> AI tags · 1cr
              </button>
            </div>

            <label className="block text-sm text-white/60 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="What makes this beat special?"
              className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 placeholder:text-white/25" />

            <label className="block text-sm text-white/60 mb-2">License prices (USD)</label>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div>
                <label className="block text-xs text-white/40 mb-1">Basic</label>
                <input value={basicPrice} onChange={(e) => setBasicPrice(e.target.value)} type="number" step="0.01" min="0"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Premium</label>
                <input value={premiumPrice} onChange={(e) => setPremiumPrice(e.target.value)} type="number" step="0.01" min="0"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Exclusive</label>
                <input value={exclusivePrice} onChange={(e) => setExclusivePrice(e.target.value)} type="number" step="0.01" min="0"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            {listMsg && (
              <p className={`text-sm mb-4 ${listMsg.includes("live") ? "text-green-300" : "text-red-300"}`}>{listMsg}</p>
            )}

            <button onClick={submitListing} disabled={listing}
              className="w-full py-2.5 rounded-xl bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {listing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
              List beat — free
            </button>
          </div>
        )}

        {tab === "dashboard" && (
          <div className="max-w-4xl mx-auto">
            {!user ? (
              <p className="text-center text-white/40 py-12">Sign in to see your producer dashboard.</p>
            ) : (
              <>
                {stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    {[
                      { label: "Beats listed", value: String(stats.beatCount) },
                      { label: "Licenses", value: String(stats.saleCount) },
                      { label: "Gross", value: centsToDollars(stats.grossCents) },
                      { label: "Your cut (85%)", value: centsToDollars(stats.netCents) },
                    ].map((s) => (
                      <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center">
                        <p className="text-2xl font-black text-yellow-200">{s.value}</p>
                        <p className="text-xs text-white/40 mt-1">{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                <h3 className="font-bold mb-3">Your beats</h3>
                {myBeats.length === 0 ? (
                  <p className="text-white/40 text-sm mb-8">No beats listed yet — use the Sell tab.</p>
                ) : (
                  <div className="space-y-2 mb-8">
                    {myBeats.map((b) => (
                      <BeatRow key={b.id} beat={b} onAiTags={suggestTagsForBeat} aiTagging={aiTagging} onRefresh={fetchDashboard} />
                    ))}
                  </div>
                )}

                <h3 className="font-bold mb-3">Sales</h3>
                {sales.length === 0 ? (
                  <p className="text-white/40 text-sm">No sales yet.</p>
                ) : (
                  <div className="space-y-2">
                    {sales.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
                        <span className="text-white/70 capitalize">{s.tier} license</span>
                        <span className="text-white/40">{centsToDollars(s.price_cents)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "completed" ? "bg-green-500/15 text-green-300" : "bg-yellow-500/15 text-yellow-300"}`}>
                          {s.status === "pending_payment" ? "Payment coming soon" : s.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* License modal */}
      {licenseBeat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setLicenseBeat(null)}>
          <div className="w-full max-w-md rounded-2xl border border-yellow-500/30 bg-[#0a0a0a] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-bold text-lg">License "{licenseBeat.title}"</h3>
              <button onClick={() => setLicenseBeat(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2 mb-4">
              {LICENSE_TIERS.map((t) => {
                const soldOut = t.key === "exclusive" && licenseBeat.exclusive_sold;
                return (
                  <button
                    key={t.key}
                    disabled={soldOut}
                    onClick={() => setLicenseTier(t.key)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      licenseTier === t.key ? "border-yellow-500/60 bg-yellow-500/10" : "border-white/10 hover:border-white/25"
                    } ${soldOut ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{t.label}</span>
                      <span className="text-yellow-200 font-semibold">{soldOut ? "Sold" : centsToDollars(priceFor(licenseBeat, t.key))}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1">{t.blurb}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex items-start gap-2 text-xs text-yellow-200/80 bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-3 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              Payment processing is coming soon — reserving a license records your intent. No charge is made today.
            </div>
            {licenseMsg && (
              <p className="text-sm mb-3 flex items-center gap-2 text-green-300"><CheckCircle2 className="w-4 h-4" />{licenseMsg}</p>
            )}
            <button onClick={reserveLicense} disabled={licensing}
              className="w-full py-2.5 rounded-xl bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {licensing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeDollarSign className="w-4 h-4" />}
              Reserve {LICENSE_TIERS.find((t) => t.key === licenseTier)?.label} license
            </button>
          </div>
        </div>
      )}

      {outOfCredits && <OutOfCredits />}

      <SiteFooter />
    </div>
  );
}

/* Producer beat row with AI-tag button */
function BeatRow({ beat, onAiTags, aiTagging, onRefresh }: {
  beat: Beat;
  onAiTags: (beatId: string) => Promise<{ genre: string; moodTags: string[] } | null>;
  aiTagging: boolean;
  onRefresh: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [suggestion, setSuggestion] = useState<{ genre: string; moodTags: string[] } | null>(null);

  async function handleAiTags() {
    const s = await onAiTags(beat.id);
    if (s) setSuggestion(s);
  }

  async function applySuggestion() {
    if (!suggestion) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/beats/${beat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre: suggestion.genre, moodTags: suggestion.moodTags }),
      });
      if (res.ok) {
        setSuggestion(null);
        onRefresh();
      }
    } catch { /* ignore */ }
    setApplying(false);
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{beat.title}</p>
          <p className="text-xs text-white/40">{beat.genre} · {beat.plays} plays</p>
        </div>
        <button onClick={handleAiTags} disabled={aiTagging}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-yellow-500/40 text-yellow-200 text-xs font-semibold hover:bg-yellow-500/10 disabled:opacity-50">
          {aiTagging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          AI tags · 1cr
        </button>
      </div>
      {suggestion && (
        <div className="mt-3 rounded-lg border border-yellow-500/25 bg-yellow-500/5 p-3">
          <p className="text-xs text-white/60 mb-1">AI suggests: <span className="text-yellow-200 font-semibold">{suggestion.genre}</span></p>
          <div className="flex flex-wrap gap-1 mb-2">
            {suggestion.moodTags.map((t) => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/60">#{t}</span>
            ))}
          </div>
          <button onClick={applySuggestion} disabled={applying}
            className="text-xs px-3 py-1.5 rounded-lg bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-50 inline-flex items-center gap-1">
            {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Apply to beat
          </button>
        </div>
      )}
    </div>
  );
}
