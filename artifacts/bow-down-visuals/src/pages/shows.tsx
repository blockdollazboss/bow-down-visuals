import { useState } from "react";
import {
  Ticket, MapPin, Loader2, Sparkles, Search, CalendarDays,
  Mic2, Trophy, PartyPopper, Building2, Radio, Podcast,
  CheckCircle2, AlertTriangle, Copy, Check, ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Thy Cheat Code's Show Finder ──────────────────────────────────────────
   The get-noticed engine: AI-curated performance opportunities — open mics,
   showcases, festivals, venue gigs, radio spots, podcast guest slots.
   POSTs to /api/show-finder (2 credits/search) and /api/show-finder/pitch
   (1 credit/pitch) on GPT-6 Sol. Opportunity types must stay in sync with
   the backend route's OPPORTUNITY_TYPES enum. */

type OpportunityTypeKey = "open-mic" | "showcase" | "festival" | "venue-gig" | "radio" | "podcast";

interface OpportunityTypeOpt {
  key: OpportunityTypeKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

const OPPORTUNITY_OPTS: OpportunityTypeOpt[] = [
  { key: "open-mic", label: "Open Mics", icon: Mic2, blurb: "Stage time, low stakes" },
  { key: "showcase", label: "Showcases", icon: Trophy, blurb: "Industry eyes on you" },
  { key: "festival", label: "Festivals", icon: PartyPopper, blurb: "Big stages, big crowds" },
  { key: "venue-gig", label: "Venue Gigs", icon: Building2, blurb: "Real rooms, real pay" },
  { key: "radio", label: "Radio Spots", icon: Radio, blurb: "Airplay + interviews" },
  { key: "podcast", label: "Podcasts", icon: Podcast, blurb: "Story-driven reach" },
];

const DATE_WINDOWS = [
  { key: "next-30-days", label: "Next 30 days" },
  { key: "next-90-days", label: "Next 90 days" },
  { key: "next-6-months", label: "Next 6 months" },
] as const;

const GENRE_PRESETS = ["Hip-Hop", "R&B", "Pop", "Afrobeats", "Latin", "EDM", "Rock", "Country", "Jazz", "Gospel"];

const SEARCH_COST = 2;
const PITCH_COST = 1;

interface ShowOpportunity {
  title: string;
  type: string;
  organizer: string;
  location: string;
  dateWindow: string;
  whyFit: string;
  howToApply: string;
  verifyNote: string;
}

interface FinderResponse {
  opportunities?: ShowOpportunity[];
  disclaimer?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface PitchResponse {
  pitch?: { subject: string; body: string };
  tips?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const TYPE_ICON: Record<string, LucideIcon> = {
  "Open Mic": Mic2,
  Showcase: Trophy,
  Festival: PartyPopper,
  "Venue Gig": Building2,
  "Radio Spot": Radio,
  "Podcast Guest": Podcast,
};

/* Model returns singular type labels ("Open Mic"); map them to the request enum. */
const TYPE_TO_KEY: Record<string, OpportunityTypeKey> = {
  "Open Mic": "open-mic",
  Showcase: "showcase",
  Festival: "festival",
  "Venue Gig": "venue-gig",
  "Radio Spot": "radio",
  "Podcast Guest": "podcast",
};

export default function ShowFinder() {
  const { user, profile, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [location, setLocation] = useState("");
  const [genre, setGenre] = useState("Hip-Hop");
  const [customGenre, setCustomGenre] = useState("");
  const [types, setTypes] = useState<OpportunityTypeKey[]>(["open-mic", "showcase", "venue-gig"]);
  const [dateWindow, setDateWindow] = useState<string>("next-90-days");
  const [artistBio, setArtistBio] = useState("");
  const [creatorName, setCreatorName] = useState("");

  const [results, setResults] = useState<ShowOpportunity[] | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [pitchFor, setPitchFor] = useState<number | null>(null);
  const [pitch, setPitch] = useState<{ subject: string; body: string } | null>(null);
  const [pitchTips, setPitchTips] = useState<string[]>([]);
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchError, setPitchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleType(key: OpportunityTypeKey) {
    setTypes((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  }

  async function authedPost(endpoint: string, body: unknown) {
    const token = await getAccessToken();
    return confirmedFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function findShows() {
    if (loading || !user) return;
    if (!location.trim()) {
      setError("Tell the scout where you are — opportunities are local first.");
      return;
    }
    if (types.length === 0) {
      setError("Pick at least one opportunity type to hunt for.");
      return;
    }
    const finalGenre = (customGenre.trim() || genre).slice(0, 80);
    if (!finalGenre) {
      setError("Pick a genre so the scout can match the right rooms.");
      return;
    }

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setResults(null);
    setPitchFor(null);
    setPitch(null);
    try {
      const res = await authedPost("/api/show-finder", {
        location: location.trim().slice(0, 120),
        genre: finalGenre,
        opportunityTypes: types,
        dateWindow,
        artistBio: artistBio.trim().slice(0, 600),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as FinderResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.opportunities) || data.opportunities.length === 0) {
        throw new Error(data.message || data.error || "Show hunt failed — try again.");
      }
      setResults(data.opportunities);
      setDisclaimer(data.disclaimer || "");
      refreshProfile();
      setTimeout(() => {
        document.getElementById("show-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Show hunt failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  async function draftPitch(index: number, opp: ShowOpportunity) {
    if (pitchLoading || !user) return;
    const name = creatorName.trim() || profile?.display_name || "Independent Artist";
    setPitchFor(index);
    setPitch(null);
    setPitchTips([]);
    setPitchError(null);
    setPitchLoading(true);
    try {
      const res = await authedPost("/api/show-finder/pitch", {
        opportunityTitle: opp.title,
        opportunityType: TYPE_TO_KEY[opp.type] ?? "showcase",
        organizer: opp.organizer,
        creatorName: name.slice(0, 100),
        genre: (customGenre.trim() || genre).slice(0, 80),
        artistBio: artistBio.trim().slice(0, 600),
        location: location.trim().slice(0, 120),
      });
      if (!res) {
        setPitchFor(null);
        return; // user cancelled the credit confirmation
      }
      const data = (await res.json().catch(() => ({}))) as PitchResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        setPitchFor(null);
        return;
      }
      if (!res.ok || !data.pitch?.subject || !data.pitch?.body) {
        throw new Error(data.message || data.error || "Pitch draft failed — try again.");
      }
      setPitch(data.pitch);
      setPitchTips(data.tips ?? []);
      refreshProfile();
    } catch (err) {
      setPitchError(err instanceof Error ? err.message : "Pitch draft failed — try again.");
    } finally {
      setPitchLoading(false);
    }
  }

  function copyPitch() {
    if (!pitch) return;
    void navigator.clipboard
      .writeText(`Subject: ${pitch.subject}\n\n${pitch.body}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Ticket className="h-3 w-3" aria-hidden="true" /> Thy Cheat Code's stage tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Show <span className="text-primary">Finder</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Stop waiting to be discovered. Tell the scout where you are and what
            you play — it hunts down open mics, showcases, festivals, and gigs
            that fit, plus a pitch draft for every stage.
          </p>
        </div>

        {/* Thy Cheat Code's coaching callout */}
        <div className="relative mt-8 flex gap-3 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 to-transparent p-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="text-sm leading-relaxed text-white/70">
            <span className="font-bold text-primary">Thy Cheat Code's take: </span>
            open mics build your live muscle, showcases put industry eyes on you,
            and festivals are the long game. Hunt in that order — and always send
            a live video with your pitch. Bookers book what they can <em>see</em>.
          </div>
        </div>

        {/* ── INPUTS ─────────────────────────────────────────────────── */}
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          {/* location + genre */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                Your city / area
              </p>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden="true" />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Atlanta, GA"
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                Your genre
              </p>
              <input
                value={customGenre}
                onChange={(e) => setCustomGenre(e.target.value)}
                maxLength={80}
                placeholder={genre}
                className={inputClass}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {GENRE_PRESETS.map((g) => (
                  <button
                    key={g}
                    onClick={() => { setGenre(g); setCustomGenre(""); }}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                      !customGenre.trim() && genre === g
                        ? "bg-primary text-black"
                        : "border border-white/10 text-white/50 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* opportunity types */}
          <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40">
            What are you hunting?
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {OPPORTUNITY_OPTS.map((o) => {
              const Icon = o.icon;
              const selected = types.includes(o.key);
              return (
                <button
                  key={o.key}
                  onClick={() => toggleType(o.key)}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/30"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                        selected ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                  </span>
                  <span className={`mt-2 block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                    {o.label}
                  </span>
                  <span className="block text-[11px] text-white/35">{o.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* date window + bio */}
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                <CalendarDays className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Date window
              </p>
              <div className="flex flex-wrap gap-2">
                {DATE_WINDOWS.map((w) => (
                  <button
                    key={w.key}
                    onClick={() => setDateWindow(w.key)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      dateWindow === w.key
                        ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                Your artist name <span className="text-white/25 normal-case tracking-normal">(for pitches)</span>
              </p>
              <input
                value={creatorName}
                onChange={(e) => setCreatorName(e.target.value)}
                maxLength={100}
                placeholder="e.g. TRGDY TRBLZ"
                className={inputClass}
              />
            </div>
          </div>

          <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Quick bio <span className="text-white/25 normal-case tracking-normal">(helps the scout match you)</span>
          </p>
          <textarea
            value={artistBio}
            onChange={(e) => setArtistBio(e.target.value)}
            maxLength={600}
            rows={3}
            placeholder="e.g. High-energy hip-hop artist, 2 years performing, opened for…"
            className={`${inputClass} resize-none`}
          />

          {error && (
            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </div>
          )}

          <button
            onClick={findShows}
            disabled={loading || !user}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> The scout is hunting…
              </>
            ) : (
              <>
                <Search className="h-5 w-5" aria-hidden="true" /> Find My Stages · {SEARCH_COST} credits
              </>
            )}
          </button>
          {!user && (
            <p className="mt-3 text-center text-xs text-white/40">Sign in to run the show hunt.</p>
          )}
        </div>

        {outOfCredits && (
          <div className="mt-8">
            <OutOfCredits />
          </div>
        )}

        {/* ── RESULTS ────────────────────────────────────────────────── */}
        {results && (
          <div id="show-results" className="relative mt-12">
            <h2 className="font-display text-2xl font-black tracking-tight">
              Your stages <span className="text-primary">({results.length})</span>
            </h2>
            {disclaimer && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] leading-relaxed text-amber-200/90">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {disclaimer}
              </div>
            )}
            <div className="mt-6 space-y-5">
              {results.map((opp, i) => {
                const Icon = TYPE_ICON[opp.type] ?? Ticket;
                const pitching = pitchFor === i;
                return (
                  <div
                    key={i}
                    className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#14100a] to-black"
                  >
                    <div className="p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10">
                            <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                          </span>
                          <div>
                            <h3 className="text-lg font-black leading-snug">{opp.title}</h3>
                            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-primary/80">
                              {opp.type}
                              {opp.organizer && <span className="text-white/35"> · {opp.organizer}</span>}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                        <p className="flex items-center gap-2 text-white/60">
                          <MapPin className="h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
                          {opp.location || "Location TBD — verify"}
                        </p>
                        <p className="flex items-center gap-2 text-white/60">
                          <CalendarDays className="h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
                          {opp.dateWindow || "Date TBD — verify"}
                        </p>
                      </div>

                      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">Why it's a fit</p>
                        <p className="mt-1.5 text-sm leading-relaxed text-white/75">{opp.whyFit}</p>
                      </div>

                      <div className="mt-3">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">How to apply</p>
                        <p className="mt-1.5 text-sm leading-relaxed text-white/70">{opp.howToApply}</p>
                      </div>

                      {opp.verifyNote && (
                        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-200/70">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Verify: {opp.verifyNote}
                        </p>
                      )}

                      <button
                        onClick={() => (pitching ? setPitchFor(null) : draftPitch(i, opp))}
                        disabled={pitchLoading}
                        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                      >
                        {pitchLoading && pitching ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Drafting your pitch…
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" aria-hidden="true" />
                            {pitching ? "Hide pitch draft" : `Draft my pitch · ${PITCH_COST} credit`}
                            <ChevronDown className={`h-4 w-4 transition ${pitching ? "rotate-180" : ""}`} aria-hidden="true" />
                          </>
                        )}
                      </button>

                      {pitching && (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/60 p-5">
                          {pitchError && (
                            <p className="flex items-start gap-2 text-sm text-red-300">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                              {pitchError}
                            </p>
                          )}
                          {pitch && !pitchLoading && (
                            <>
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-bold">
                                  <span className="text-white/40">Subject: </span>
                                  {pitch.subject}
                                </p>
                                <button
                                  onClick={copyPitch}
                                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
                                >
                                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                                  {copied ? "Copied" : "Copy"}
                                </button>
                              </div>
                              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/75">{pitch.body}</p>
                              {pitchTips.length > 0 && (
                                <div className="mt-4 border-t border-white/10 pt-4">
                                  <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
                                    Send it with
                                  </p>
                                  <ul className="mt-2 space-y-1.5">
                                    {pitchTips.map((t, ti) => (
                                      <li key={ti} className="flex items-start gap-2 text-[13px] text-white/60">
                                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
                                        {t}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
