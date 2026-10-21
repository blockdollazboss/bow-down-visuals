import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Disc3, Loader2, Play, Pause, Sparkles, Plus, Search, SlidersHorizontal,
  Tag, BadgeDollarSign, Store, BarChart3, Music2, AlertTriangle, CheckCircle2,
  X, Wand2, RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";
import {
  initialSectionStates, markSectionLoading, settleSection,
  type SectionStates,
} from "@/lib/dashboard-sections";
import {
  BEAT_LICENSE_FORMATS,
  defaultTermsForTier,
  describeTermsInline,
  formatLabel,
  templateTerms,
  type BeatLicenseTemplate,
  type BeatLicenseTerms,
} from "@/lib/beat-license-terms";

/* ─── Section resilience (the shared seam, lib/dashboard-sections) ────
   This page loads two independent sections: the browse list
   (GET /api/beats?…) and the seller dashboard tab
   (GET /api/beats/mine/dashboard — one payload: my beats + sales +
   stats). Each settles on its own through the seam: a failed section
   shows its own failure card with its own Retry in its own area, and
   never renders as its empty state. There is no page-wide error flag —
   one section failing can never take the other (or the page) down. */
type BeatsSectionKey = "browse" | "dashboard";
const BEATS_SECTION_KEYS: readonly BeatsSectionKey[] = ["browse", "dashboard"];

/* ─── Beat Marketplace ──────────────────────────────────────────────────────
   Producers list beats (free), artists browse / preview / license them.
   License tiers: Basic / Premium / Exclusive. Site takes 15% commission.
   Payments (0132): licensing runs through secure checkout (test mode) at
   the listed tier price; the license activates only when the payment
   confirms on return (POST /api/beats/licenses/verify).
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
  /** The producer's custom license templates (0188), offered next to
      the fixed tiers in the license modal. Producer-scoped: every beat
      from the same producer carries the same templates. */
  license_templates?: BeatLicenseTemplate[];
}

interface License {
  id: string;
  beat_id: string;
  tier: string;
  template_id?: string | null;
  /** The purchased terms snapshot (0188) — buyer surfaces render the
      terms from this copy, never from the live template. */
  terms?: BeatLicenseTerms | null;
  price_cents: number;
  status: string;
  created_at: string;
}

const LICENSE_TIERS = [
  { key: "basic", labelKey: "beats.tierBasicLabel", blurbKey: "beats.tierBasicBlurb" },
  { key: "premium", labelKey: "beats.tierPremiumLabel", blurbKey: "beats.tierPremiumBlurb" },
  { key: "exclusive", labelKey: "beats.tierExclusiveLabel", blurbKey: "beats.tierExclusiveBlurb" },
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
  usePageTitle("Beat Marketplace", "Buy and sell beats: producers list instrumentals, and artists preview and license them by tier.");
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const [beats, setBeats] = useState<Beat[]>([]);
  /* Per-section load states, driven by the shared seam. A section's
     failure card renders only when THAT section failed. The loaded ref
     guards the data: once the browse list has loaded, a later failed
     reload (e.g. a filter re-run) must NOT blank the beats already on
     screen — the section settles back to ok and the shown data stays. */
  const [sectionStates, setSectionStates] = useState<SectionStates<BeatsSectionKey>>(
    () => initialSectionStates(BEATS_SECTION_KEYS),
  );
  const beatsLoadedRef = useRef(false);
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

  /* License modal — the buyer's chosen offer is exactly one of a fixed
     tier (licenseTier) or one of the producer's custom templates
     (licenseTemplateId). */
  const [licenseBeat, setLicenseBeat] = useState<Beat | null>(null);
  const [licenseTier, setLicenseTier] = useState<string>("basic");
  const [licenseTemplateId, setLicenseTemplateId] = useState<string | null>(null);
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
  const [listOk, setListOk] = useState(false);
  const [aiTagging, setAiTagging] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Dashboard */
  const [myBeats, setMyBeats] = useState<Beat[]>([]);
  const [sales, setSales] = useState<License[]>([]);
  const [stats, setStats] = useState<{ beatCount: number; saleCount: number; grossCents: number; netCents: number } | null>(null);
  /* Dashboard-load failures are NOT zero sales / no beats — the
     dashboard SECTION gets its own failure state with a retry, scoped
     to the dashboard tab. dashLoadedRef guards the data: once the
     dashboard has loaded, a later failed reload (e.g. the BeatRow
     refresh after applying AI tags) must NOT blank what's on screen. */
  const dashLoadedRef = useRef(false);

  const fetchBeats = async () => {
    setSectionStates((prev) => markSectionLoading(prev, "browse"));
    try {
      const q = new URLSearchParams();
      if (genre) q.set("genre", genre);
      if (mood) q.set("mood", mood);
      if (search) q.set("search", search);
      if (minBpm) q.set("minBpm", minBpm);
      if (maxBpm) q.set("maxBpm", maxBpm);
      const res = await fetch(`/api/beats?${q.toString()}`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json() as { beats?: Beat[] };
      setBeats(data.beats ?? []);
      beatsLoadedRef.current = true;
      setSectionStates((prev) => settleSection(prev, "browse", true));
    } catch {
      /* Settle to ok when beats are already on screen (their data
         stays); only a failed FIRST load fails the section. */
      setSectionStates((prev) => settleSection(prev, "browse", beatsLoadedRef.current));
    }
  };

  useEffect(() => { fetchBeats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Returning from checkout: verify the payment server-side — the
     license is only real once this confirms it. */
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get("session_id");
    if (!sid) return;
    window.history.replaceState(null, "", "/beats");
    (async () => {
      try {
        const res = await fetch("/api/beats/licenses/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        setVerifyMsg(
          res.ok && data.success
            ? "Payment confirmed — your license is active. Find it in your dashboard."
            : (data.error ?? "We couldn't confirm that payment. If you were charged, contact support."),
        );
      } catch {
        setVerifyMsg("We couldn't confirm that payment. If you were charged, contact support.");
      }
    })();
  }, []);

  const fetchDashboard = async () => {
    /* The section shows its spinner only until the first successful
       load — a later refresh keeps the shown dashboard on screen. */
    if (!dashLoadedRef.current) {
      setSectionStates((prev) => markSectionLoading(prev, "dashboard"));
    }
    try {
      const res = await fetch("/api/beats/mine/dashboard");
      if (!res.ok) throw new Error("load failed");
      const data = await res.json() as { beats?: Beat[]; sales?: License[]; stats?: typeof stats };
      setMyBeats(data.beats ?? []);
      setSales(data.sales ?? []);
      setStats(data.stats ?? null);
      dashLoadedRef.current = true;
      setSectionStates((prev) => settleSection(prev, "dashboard", true));
    } catch {
      /* Same guard as browse: settle to ok when a loaded dashboard is
         on screen; only a failed FIRST load fails the section. */
      setSectionStates((prev) => settleSection(prev, "dashboard", dashLoadedRef.current));
    }
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
      setListMsg(t("beats.errorTitleUrlRequired"));
      setListOk(false);
      return;
    }
    setListing(true);
    setListMsg(null);
    setListOk(false);
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
        setListMsg(data.error ?? t("beats.errorListingFailed"));
        setListOk(false);
      } else {
        setListMsg(t("beats.listingLive", { title: data.beat?.title ?? "" }));
        setListOk(true);
        setTitle(""); setAudioUrl(""); setBpm(""); setMusicalKey("");
        setMoodTags(""); setDescription("");
        fetchBeats();
      }
    } catch {
      setListMsg(t("beats.errorListingRetry"));
      setListOk(false);
    }
    setListing(false);
  }

  async function runAiTags() {
    // AI tags apply to the sell form's metadata draft — we need a saved beat,
    // so this runs against the most recent listing or prompts to list first.
    setListMsg(t("beats.aiTagsHint"));
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
        /* Exactly one offer: the chosen custom template, else the tier. */
        body: JSON.stringify(licenseTemplateId ? { templateId: licenseTemplateId } : { tier: licenseTier }),
      });
      const data = await res.json() as { message?: string; error?: string; checkoutUrl?: string };
      if (!res.ok) {
        setLicenseMsg(data.error ?? t("beats.errorLicenseFailed"));
        setLicensing(false);
        return;
      }
      /* The licensed beat flows into the hub project + straight into song-making. */
      try {
        addAsset({
          kind: "beat",
          url: licenseBeat.audio_url || licenseBeat.preview_url || "",
          label: licenseBeat.title,
          detail: `${licenseBeat.genre || ""} · ${licenseBeat.bpm || "?"} BPM`.trim(),
          meta: { beatId: licenseBeat.id, tier: licenseTier, ...(licenseTemplateId ? { templateId: licenseTemplateId } : {}) },
        });
      } catch { /* hub unavailable — non-fatal */ }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setLicenseMsg(data.message ?? t("beats.licenseReserved"));
    } catch {
      setLicenseMsg(t("beats.errorLicenseRetry"));
    }
    setLicensing(false);
  }

  const filteredCount = useMemo(() => beats.length, [beats]);

  return (
    <div className="min-h-screen bg-black text-white">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />

      <main className="max-w-7xl mx-auto px-5 md:px-8 py-10">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#C9A84C]/40 bg-[#C9A84C]/10 text-[#E3C566] text-xs font-semibold mb-4">
            <Disc3 className="w-3.5 h-3.5" /> {t("beats.badge")}
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">
            {t("beats.heroTitle1")} <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#E3C566] to-[#C9A84C]">{t("beats.heroTitle2")}</span>
          </h1>
          <p className="text-white/50 mt-3 max-w-xl mx-auto">
            {t("beats.heroSubtitle")}
          </p>
          <Link
            href="/ai-audio?tab=beats"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-xl bg-primary text-black text-sm font-bold hover:bg-primary/90 transition-colors"
          >
            <Wand2 className="w-4 h-4" /> {t("beats.makeOwnBeat")}
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-2 mb-8 flex-wrap">
          {([
            { key: "browse", labelKey: "beats.tabBrowse", icon: Search },
            { key: "sell", labelKey: "beats.tabSell", icon: Plus },
            { key: "dashboard", labelKey: "beats.tabDashboard", icon: BarChart3 },
          ] as const).map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                tab === tb.key
                  ? "bg-[#C9A84C]/15 border-[#C9A84C]/50 text-[#E3C566]"
                  : "border-white/10 text-white/50 hover:text-white hover:border-white/20"
              }`}
            >
              <tb.icon className="w-4 h-4" /> {t(tb.labelKey)}
            </button>
          ))}
        </div>

        {verifyMsg && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {verifyMsg}
            <button onClick={() => setVerifyMsg(null)} aria-label="Dismiss" className="ml-auto"><X className="h-4 w-4" /></button>
          </div>
        )}

        {tab === "browse" && (
          <>
            {/* Filters */}
            <div className={`flex flex-wrap items-center gap-2 mb-6 p-4 rounded-2xl border ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
              <SlidersHorizontal className="w-4 h-4 text-white/40" />
              <select value={genre} onChange={(e) => setGenre(e.target.value)}
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80">
                <option value="">{t("beats.allGenres")}</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder={t("beats.moodPlaceholder")}
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm w-36 placeholder:text-white/25" />
              <input value={minBpm} onChange={(e) => setMinBpm(e.target.value)} placeholder={t("beats.minBpmPlaceholder")} type="number"
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm w-24 placeholder:text-white/25" />
              <input value={maxBpm} onChange={(e) => setMaxBpm(e.target.value)} placeholder={t("beats.maxBpmPlaceholder")} type="number"
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm w-24 placeholder:text-white/25" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("beats.searchPlaceholder")}
                className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px] placeholder:text-white/25" />
              <button onClick={fetchBeats}
                className="px-4 py-1.5 rounded-lg bg-[#C9A84C] text-black text-sm font-bold hover:bg-[#DDBB62]">
                {t("beats.filterButton")}
              </button>
            </div>

            {sectionStates.browse === "loading" ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]" /></div>
            ) : sectionStates.browse === "failed" ? (
              <div data-testid="beats-browse-failure" className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
                <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
                <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load beats.</p>
                <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  Something went wrong on our end — the marketplace is safe, this page just couldn't reach it.
                </p>
                <button
                  type="button"
                  onClick={() => fetchBeats()}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
                >
                  <RotateCcw className="h-4 w-4" /> Try again
                </button>
              </div>
            ) : beats.length === 0 ? (
              <div className="text-center py-16 text-white/40">
                <Music2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                {t("beats.emptyBrowse")}
              </div>
            ) : (
              <>
                <p className="text-white/40 text-sm mb-4">{t("beats.beatCount", { count: filteredCount })}</p>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {beats.map((beat) => (
                    <div key={beat.id} className={`rounded-2xl border p-4 hover:border-[#C9A84C]/40 transition-colors ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => togglePlay(beat)}
                          className="shrink-0 w-12 h-12 rounded-full bg-[#C9A84C] text-black flex items-center justify-center hover:bg-[#DDBB62]"
                          aria-label={playingId === beat.id ? t("beats.pausePreview") : t("beats.playPreview")}
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
                        <span className="text-sm text-[#E3C566] font-semibold">{t("beats.fromPrice", { price: centsToDollars(beat.basic_price_cents) })}</span>
                        <button
                          onClick={() => { setLicenseBeat(beat); setLicenseTier("basic"); setLicenseTemplateId(null); setLicenseMsg(null); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A84C] text-black text-sm font-bold hover:bg-[#DDBB62]"
                        >
                          <BadgeDollarSign className="w-4 h-4" /> {t("beats.licenseButton")}
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
          <div className={`max-w-2xl mx-auto rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><Store className="w-5 h-5 text-[#C9A84C]" /> {t("beats.sellTitle")}</h2>
            <p className="text-white/40 text-sm mb-6">{t("beats.sellSubtitle")}</p>

            <label className="block text-sm text-white/60 mb-1">{t("beats.titleLabel")}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("beats.titlePlaceholder")}
              className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 placeholder:text-white/25" />

            <label className="block text-sm text-white/60 mb-1">{t("beats.audioUrlLabel")}</label>
            <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://…"
              className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 placeholder:text-white/25" />

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">{t("beats.genreLabel")}</label>
                <select value={sellGenre} onChange={(e) => setSellGenre(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm">
                  {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">{t("beats.bpmLabel")}</label>
                <input value={bpm} onChange={(e) => setBpm(e.target.value)} type="number" placeholder="140"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/25" />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">{t("beats.keyLabel")}</label>
                <input value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)} placeholder={t("beats.keyPlaceholder")}
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/25" />
              </div>
            </div>

            <label className="block text-sm text-white/60 mb-1">{t("beats.moodTagsLabel")}</label>
            <div className="flex gap-2 mb-4">
              <input value={moodTags} onChange={(e) => setMoodTags(e.target.value)} placeholder={t("beats.moodTagsPlaceholder")}
                className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/25" />
              <button onClick={runAiTags} title={t("beats.aiTagsTooltip")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#C9A84C]/50 text-[#E3C566] text-sm font-semibold hover:bg-[#C9A84C]/10">
                <Sparkles className="w-4 h-4" /> {t("beats.aiTagsButton")}
              </button>
            </div>

            <label className="block text-sm text-white/60 mb-1">{t("beats.descriptionLabel")}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder={t("beats.descriptionPlaceholder")}
              className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 placeholder:text-white/25" />

            <label className="block text-sm text-white/60 mb-2">{t("beats.licensePricesLabel")}</label>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div>
                <label className="block text-xs text-white/40 mb-1">{t("beats.tierBasicLabel")}</label>
                <input value={basicPrice} onChange={(e) => setBasicPrice(e.target.value)} type="number" step="0.01" min="0"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">{t("beats.tierPremiumLabel")}</label>
                <input value={premiumPrice} onChange={(e) => setPremiumPrice(e.target.value)} type="number" step="0.01" min="0"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">{t("beats.tierExclusiveLabel")}</label>
                <input value={exclusivePrice} onChange={(e) => setExclusivePrice(e.target.value)} type="number" step="0.01" min="0"
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            {listMsg && (
              <p className={`text-sm mb-4 ${listOk ? "text-green-300" : "text-red-300"}`}>{listMsg}</p>
            )}

            <button onClick={submitListing} disabled={listing}
              className="w-full py-2.5 rounded-xl bg-[#C9A84C] text-black font-bold hover:bg-[#DDBB62] disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {listing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
              {t("beats.listButton")}
            </button>
          </div>
        )}

        {tab === "dashboard" && (
          <div className="max-w-4xl mx-auto">
            {!user ? (
              <p className="text-center text-white/40 py-12">{t("beats.signInDashboard")}</p>
            ) : sectionStates.dashboard === "loading" ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]" /></div>
            ) : sectionStates.dashboard === "failed" ? (
              <div data-testid="beats-dashboard-failure" className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
                <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
                <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your dashboard.</p>
                <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  Something went wrong on our end — your beats and sales are safe, this page just couldn't load them.
                </p>
                <button
                  type="button"
                  onClick={() => fetchDashboard()}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
                >
                  <RotateCcw className="h-4 w-4" /> Try again
                </button>
              </div>
            ) : (
              <>
                {stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    {[
                      { labelKey: "beats.statBeatsListed", value: String(stats.beatCount) },
                      { labelKey: "beats.statLicenses", value: String(stats.saleCount) },
                      { labelKey: "beats.statGross", value: centsToDollars(stats.grossCents) },
                      { labelKey: "beats.statYourCut", value: centsToDollars(stats.netCents) },
                    ].map((s) => (
                      <div key={s.labelKey} className={`rounded-2xl border p-4 text-center ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                        <p className="text-2xl font-black text-[#E3C566]">{s.value}</p>
                        <p className="text-xs text-white/40 mt-1">{t(s.labelKey)}</p>
                      </div>
                    ))}
                  </div>
                )}

                <h3 className="font-bold mb-3">{t("beats.yourBeatsTitle")}</h3>
                {myBeats.length === 0 ? (
                  <p className="text-white/40 text-sm mb-8">{t("beats.noBeatsYet")}</p>
                ) : (
                  <div className="space-y-2 mb-8">
                    {myBeats.map((b) => (
                      <BeatRow key={b.id} beat={b} onAiTags={suggestTagsForBeat} aiTagging={aiTagging} onRefresh={fetchDashboard} />
                    ))}
                  </div>
                )}

                <h3 className="font-bold mb-3">{t("beats.salesTitle")}</h3>
                {sales.length === 0 ? (
                  <p className="text-white/40 text-sm">{t("beats.noSalesYet")}</p>
                ) : (
                  <div className="space-y-2">
                    {sales.map((s) => (
                      <div key={s.id} className={`rounded-xl border px-4 py-3 text-sm ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 capitalize">{s.terms?.name ?? t("beats.licenseRow", { tier: s.tier })}</span>
                          <span className="text-white/40">{centsToDollars(s.price_cents)}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "completed" ? "bg-green-500/15 text-green-300" : "bg-[#C9A84C]/15 text-[#E3C566]"}`}>
                            {s.status === "pending_payment" ? t("beats.paymentComingSoon") : s.status}
                          </span>
                        </div>
                        {/* The terms exactly as sold — from the license's
                            purchase-time snapshot, so later template edits
                            never change what this sale shows. */}
                        {s.terms && (
                          <p className="text-xs text-white/40 mt-1">{describeTermsInline(s.terms)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <LicenseTemplatesSection />
              </>
            )}
          </div>
        )}
      </main>

      {/* License modal */}
      {licenseBeat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setLicenseBeat(null)}>
          <div className={`w-full max-w-md rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA]" : "border-[#C9A84C]/40 bg-[#171208]"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-bold text-lg">{t("beats.licenseModalTitle", { title: licenseBeat.title })}</h3>
              <button onClick={() => setLicenseBeat(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2 mb-4 max-h-[60vh] overflow-y-auto pr-1">
              {LICENSE_TIERS.map((tier) => {
                const soldOut = tier.key === "exclusive" && licenseBeat.exclusive_sold;
                const selected = licenseTemplateId === null && licenseTier === tier.key;
                return (
                  <button
                    key={tier.key}
                    disabled={soldOut}
                    onClick={() => { setLicenseTier(tier.key); setLicenseTemplateId(null); }}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selected ? "border-[#C9A84C]/70 bg-[#C9A84C]/10" : "border-white/10 hover:border-white/25"
                    } ${soldOut ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{t(tier.labelKey)}</span>
                      <span className="text-yellow-200 font-semibold">{soldOut ? t("beats.soldOut") : centsToDollars(priceFor(licenseBeat, tier.key))}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1">{t(tier.blurbKey)}</p>
                    <p className="text-xs text-white/50 mt-1">{describeTermsInline(defaultTermsForTier(tier.key))}</p>
                  </button>
                );
              })}
              {(licenseBeat.license_templates ?? []).length > 0 && (
                <p className="text-xs font-semibold uppercase tracking-wide text-white/40 pt-2">
                  {t("beats.customLicensesHeading", { defaultValue: "Producer's custom licenses" })}
                </p>
              )}
              {(licenseBeat.license_templates ?? []).map((tpl) => {
                const soldOut = tpl.isExclusive && licenseBeat.exclusive_sold;
                const selected = licenseTemplateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    disabled={soldOut}
                    onClick={() => setLicenseTemplateId(tpl.id)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selected ? "border-[#C9A84C]/70 bg-[#C9A84C]/10" : "border-white/10 hover:border-white/25"
                    } ${soldOut ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{tpl.name}</span>
                      <span className="text-yellow-200 font-semibold">{soldOut ? t("beats.soldOut") : centsToDollars(tpl.priceCents)}</span>
                    </div>
                    <p className="text-xs text-white/50 mt-1">{describeTermsInline(templateTerms(tpl))}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex items-start gap-2 text-xs text-yellow-200/80 bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-3 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {t("beats.paymentNote")}
            </div>
            {licenseMsg && (
              <p className="text-sm mb-3 flex items-center gap-2 text-green-300"><CheckCircle2 className="w-4 h-4" />{licenseMsg}</p>
            )}
            <button onClick={reserveLicense} disabled={licensing}
              className="w-full py-2.5 rounded-xl bg-[#C9A84C] text-black font-bold hover:bg-[#DDBB62] disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {licensing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeDollarSign className="w-4 h-4" />}
              {t("beats.reserveLicenseButton", {
                tier: licenseTemplateId
                  ? ((licenseBeat.license_templates ?? []).find((x) => x.id === licenseTemplateId)?.name ?? "")
                  : t(LICENSE_TIERS.find((x) => x.key === licenseTier)?.labelKey ?? ""),
              })}
            </button>
            {licenseBeat && (
              <Link
                href={`/make-song?audioUrl=${encodeURIComponent(licenseBeat.audio_url || licenseBeat.preview_url || "")}`}
                className="mt-2 w-full py-2.5 rounded-xl border border-primary/40 text-primary font-bold hover:bg-primary/10 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                <Disc3 className="w-4 h-4" />{t("beats.useInSong", { defaultValue: "Use this beat in a song" })}
              </Link>
            )}
          </div>
        </div>
      )}

      {outOfCredits && <OutOfCredits />}


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
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
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
    <div className={`rounded-xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{beat.title}</p>
          <p className="text-xs text-white/40">{t("beats.beatRowMeta", { genre: beat.genre, plays: beat.plays })}</p>
        </div>
        <button onClick={handleAiTags} disabled={aiTagging}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-yellow-500/40 text-yellow-200 text-xs font-semibold hover:bg-yellow-500/10 disabled:opacity-50">
          {aiTagging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {t("beats.aiTagsButton")}
        </button>
      </div>
      {suggestion && (
        <div className="mt-3 rounded-lg border border-yellow-500/25 bg-yellow-500/5 p-3">
          <p className="text-xs text-white/60 mb-1">{t("beats.aiSuggestsPrefix")}<span className="text-yellow-200 font-semibold">{suggestion.genre}</span></p>
          <div className="flex flex-wrap gap-1 mb-2">
            {suggestion.moodTags.map((t) => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/60">#{t}</span>
            ))}
          </div>
          <button onClick={applySuggestion} disabled={applying}
            className="text-xs px-3 py-1.5 rounded-lg bg-[#C9A84C] text-black font-bold hover:bg-[#DDBB62] disabled:opacity-50 inline-flex items-center gap-1">
            {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {t("beats.applyToBeat")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Custom license templates (0188) ─────────────────────────────────────
   Producer-side manager: define named license offers with your own
   price and terms; they appear on all your beats next to the fixed
   tiers. Every sale snapshots the terms as sold — editing or deleting
   a template here changes future sales only, never a sold license.
   The section loads and fails on its own (the dashboard seam's rule):
   a templates failure shows its own retry, never blanks the rest. */

interface TemplateFormState {
  name: string;
  priceDollars: string;
  format: string;
  streamsCap: string;
  salesCap: string;
  musicVideosCap: string;
  radioTvAllowed: boolean;
  livePerformancesCap: string;
  termYears: string;
  territory: string;
  creditLine: string;
  termsNote: string;
  isExclusive: boolean;
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: "",
  priceDollars: "",
  format: "mp3",
  streamsCap: "",
  salesCap: "",
  musicVideosCap: "",
  radioTvAllowed: false,
  livePerformancesCap: "",
  termYears: "",
  territory: "Worldwide",
  creditLine: "",
  termsNote: "",
  isExclusive: false,
};

function templateToForm(tpl: BeatLicenseTemplate): TemplateFormState {
  const cap = (v: number | null) => (v === null ? "" : String(v));
  return {
    name: tpl.name,
    priceDollars: (tpl.priceCents / 100).toFixed(2),
    format: tpl.format,
    streamsCap: cap(tpl.streamsCap),
    salesCap: cap(tpl.salesCap),
    musicVideosCap: cap(tpl.musicVideosCap),
    radioTvAllowed: tpl.radioTvAllowed,
    livePerformancesCap: cap(tpl.livePerformancesCap),
    termYears: tpl.termYears === null ? "" : String(tpl.termYears),
    territory: tpl.territory,
    creditLine: tpl.creditLine ?? "",
    termsNote: tpl.termsNote ?? "",
    isExclusive: tpl.isExclusive,
  };
}

function formToPayload(form: TemplateFormState) {
  const cap = (v: string) => {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  };
  return {
    name: form.name.trim(),
    priceCents: Math.round(Number(form.priceDollars || "0") * 100),
    format: form.format,
    streamsCap: cap(form.streamsCap),
    salesCap: cap(form.salesCap),
    musicVideosCap: cap(form.musicVideosCap),
    radioTvAllowed: form.radioTvAllowed,
    livePerformancesCap: cap(form.livePerformancesCap),
    termYears: cap(form.termYears),
    territory: form.territory.trim() || "Worldwide",
    creditLine: form.creditLine.trim() === "" ? null : form.creditLine.trim(),
    termsNote: form.termsNote.trim() === "" ? null : form.termsNote.trim(),
    isExclusive: form.isExclusive,
  };
}

function LicenseTemplatesSection() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<BeatLicenseTemplate[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "failed">("loading");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm bg-transparent ${
    isLight ? "border-[#C9A84C]/40 text-[#2A1E07]" : "border-white/15 text-white"
  }`;

  async function loadTemplates() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/beats/license-templates/mine");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { templates?: BeatLicenseTemplate[] };
      setTemplates(data.templates ?? []);
      setLoadState("ok");
    } catch {
      setLoadState("failed");
    }
  }

  useEffect(() => { void loadTemplates(); }, []);

  async function saveTemplate() {
    if (!form) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(
        editingId ? `/api/beats/license-templates/${editingId}` : "/api/beats/license-templates",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(form)),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? t("beats.templateSaveFailed", { defaultValue: "Couldn't save that template — check the fields and try again." }));
        return;
      }
      setForm(null);
      setEditingId(null);
      await loadTemplates();
    } catch {
      setFormError(t("beats.templateSaveFailed", { defaultValue: "Couldn't save that template — check the fields and try again." }));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    try {
      const res = await fetch(`/api/beats/license-templates/${id}`, { method: "DELETE" });
      if (res.ok) await loadTemplates();
    } catch { /* section reload surfaces failures */ }
  }

  const numField = (
    label: string,
    key: "streamsCap" | "salesCap" | "musicVideosCap" | "livePerformancesCap" | "termYears",
    hint: string,
  ) => (
    <label className="block">
      <span className="text-xs text-white/50">{label}</span>
      <input
        type="number"
        min={0}
        value={form?.[key] ?? ""}
        onChange={(e) => form && setForm({ ...form, [key]: e.target.value })}
        placeholder={hint}
        className={inputCls}
      />
    </label>
  );

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold">{t("beats.templatesTitle", { defaultValue: "Your custom licenses" })}</h3>
        {!form && (
          <button
            onClick={() => { setEditingId(null); setForm(EMPTY_TEMPLATE_FORM); setFormError(null); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A84C] text-black text-xs font-bold hover:bg-[#DDBB62]"
          >
            <Plus className="w-3.5 h-3.5" /> {t("beats.templateNew", { defaultValue: "New license" })}
          </button>
        )}
      </div>
      <p className="text-xs text-white/40 mb-3">
        {t("beats.templatesBlurb", { defaultValue: "Set your own price and terms — your custom licenses appear on every beat you sell, next to Basic, Premium and Exclusive. Licenses already sold keep the terms they were sold with." })}
      </p>

      {loadState === "loading" ? (
        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-[#C9A84C]" /></div>
      ) : loadState === "failed" ? (
        <div className={`rounded-xl border p-4 text-sm flex items-center justify-between ${cardCls}`}>
          <span className="text-white/60">{t("beats.templatesLoadFailed", { defaultValue: "Couldn't load your custom licenses." })}</span>
          <button onClick={() => void loadTemplates()} className="inline-flex items-center gap-1.5 text-[#E3C566] font-semibold">
            <RotateCcw className="w-3.5 h-3.5" /> {t("beats.retry", { defaultValue: "Retry" })}
          </button>
        </div>
      ) : templates.length === 0 && !form ? (
        <p className="text-white/40 text-sm">{t("beats.templatesEmpty", { defaultValue: "No custom licenses yet — the three standard tiers are what buyers see." })}</p>
      ) : (
        <div className="space-y-2 mb-4">
          {templates.map((tpl) => (
            <div key={tpl.id} className={`rounded-xl border px-4 py-3 text-sm ${cardCls}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{tpl.name}</span>
                <span className="text-[#E3C566] font-semibold">{centsToDollars(tpl.priceCents)}</span>
              </div>
              <p className="text-xs text-white/40 mt-1">{describeTermsInline(templateTerms(tpl))}</p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => { setEditingId(tpl.id); setForm(templateToForm(tpl)); setFormError(null); }}
                  className="text-xs font-semibold text-[#E3C566] hover:underline"
                >
                  {t("beats.templateEdit", { defaultValue: "Edit" })}
                </button>
                <button
                  onClick={() => void deleteTemplate(tpl.id)}
                  className="text-xs font-semibold text-red-300 hover:underline"
                >
                  {t("beats.templateDelete", { defaultValue: "Delete" })}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className={`rounded-2xl border p-4 space-y-3 ${cardCls}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-white/50">{t("beats.templateName", { defaultValue: "License name" })}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Unlimited Lease" />
            </label>
            <label className="block">
              <span className="text-xs text-white/50">{t("beats.templatePrice", { defaultValue: "Price (USD)" })}</span>
              <input type="number" min={0} step="0.01" value={form.priceDollars} onChange={(e) => setForm({ ...form, priceDollars: e.target.value })} className={inputCls} placeholder="150.00" />
            </label>
            <label className="block">
              <span className="text-xs text-white/50">{t("beats.templateFormat", { defaultValue: "Files included" })}</span>
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} className={inputCls}>
                {BEAT_LICENSE_FORMATS.map((f) => (
                  <option key={f} value={f}>{formatLabel(f)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-white/50">{t("beats.templateTerritory", { defaultValue: "Territory" })}</span>
              <input value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} className={inputCls} />
            </label>
            {numField(t("beats.templateStreamsCap", { defaultValue: "Streams cap" }), "streamsCap", t("beats.templateUnlimitedHint", { defaultValue: "Blank = unlimited" }))}
            {numField(t("beats.templateSalesCap", { defaultValue: "Copies sold cap" }), "salesCap", t("beats.templateUnlimitedHint", { defaultValue: "Blank = unlimited" }))}
            {numField(t("beats.templateVideosCap", { defaultValue: "Music videos cap" }), "musicVideosCap", t("beats.templateUnlimitedHint", { defaultValue: "Blank = unlimited" }))}
            {numField(t("beats.templateLiveCap", { defaultValue: "Live performances cap" }), "livePerformancesCap", t("beats.templateUnlimitedHint", { defaultValue: "Blank = unlimited" }))}
            {numField(t("beats.templateTermYears", { defaultValue: "Term (years)" }), "termYears", t("beats.templatePerpetualHint", { defaultValue: "Blank = perpetual" }))}
            <label className="block">
              <span className="text-xs text-white/50">{t("beats.templateCreditLine", { defaultValue: "Credit line" })}</span>
              <input value={form.creditLine} onChange={(e) => setForm({ ...form, creditLine: e.target.value })} className={inputCls} placeholder="Prod. by …" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.radioTvAllowed} onChange={(e) => setForm({ ...form, radioTvAllowed: e.target.checked })} />
            {t("beats.templateRadioTv", { defaultValue: "Radio & TV use allowed" })}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isExclusive} onChange={(e) => setForm({ ...form, isExclusive: e.target.checked })} />
            {t("beats.templateExclusive", { defaultValue: "Exclusive — sells once, then the beat is off the market" })}
          </label>
          <label className="block">
            <span className="text-xs text-white/50">{t("beats.templateTermsNote", { defaultValue: "Extra terms (shown to the buyer)" })}</span>
            <textarea value={form.termsNote} onChange={(e) => setForm({ ...form, termsNote: e.target.value })} rows={2} className={inputCls} />
          </label>
          {formError && <p className="text-sm text-red-300">{formError}</p>}
          <div className="flex gap-2">
            <button onClick={() => void saveTemplate()} disabled={saving}
              className="px-4 py-2 rounded-xl bg-[#C9A84C] text-black font-bold hover:bg-[#DDBB62] disabled:opacity-50 inline-flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t("beats.templateSave", { defaultValue: "Save license" })}
            </button>
            <button onClick={() => { setForm(null); setEditingId(null); }} className="px-4 py-2 rounded-xl border border-white/15 text-sm font-semibold hover:border-white/30">
              {t("beats.templateCancel", { defaultValue: "Cancel" })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
