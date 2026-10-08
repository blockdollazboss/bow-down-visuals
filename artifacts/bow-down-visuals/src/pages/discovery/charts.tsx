import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Trophy, Flame, Users, Disc3, Clapperboard, Briefcase, Banknote, SlidersHorizontal, X } from "lucide-react";
import { useMinStars } from "@/lib/creator-level";
import { formatMoney } from "@/components/discovery/cards";
import { formatCount } from "@/lib/streaming";
import {
  CreatorCard, TrackRow, VideoCard, SectionHeader,
  ChartSkeleton, CardSkeleton, EmptyState,
  type CreatorLite, type TrackLite, type VideoLite,
} from "@/components/discovery/cards";
import { useFollowStates, CreateCta } from "@/components/discovery/FollowButton";
import { VERTICALS, VERTICAL_META, verticalLabel, type VerticalKey } from "@/lib/verticals";

/* ─── /charts — where the next big creator gets found ─────────────────────
   Tabs: Charts (Top creators / Top audio / Top videos per vertical) |
         Breaking (rising creators) | For Brands (work with creators).
   Windows: Today / This week / All time. Vertical switcher across the
   full set: music, video, gaming, podcast, film, tv, influencer,
   education, other. */

type Tab = "charts" | "breaking" | "earners" | "brands";
type WindowKey = "today" | "week" | "all";

const WINDOWS: Array<{ key: WindowKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];

interface ChartsPayload {
  tracks: TrackLite[];
  videos: VideoLite[];
  creators: CreatorLite[];
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function VerticalSwitcher({
  value,
  onChange,
}: {
  value: VerticalKey | "all";
  onChange: (v: VerticalKey | "all") => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange("all")}
        className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
          value === "all"
            ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black"
            : "border border-white/15 bg-white/5 text-white/60 hover:border-[#e8c86a]/40 hover:text-white"
        }`}
      >
        All creators
      </button>
      {VERTICALS.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
            value === v
              ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black"
              : "border border-white/15 bg-white/5 text-white/60 hover:border-[#e8c86a]/40 hover:text-white"
          }`}
        >
          {VERTICAL_META[v].label}
        </button>
      ))}
    </div>
  );
}

function WindowTabs({ value, onChange }: { value: WindowKey; onChange: (w: WindowKey) => void }) {
  return (
    <div className="flex gap-1 rounded-full border border-white/10 bg-black/40 p-1">
      {WINDOWS.map((w) => (
        <button
          key={w.key}
          onClick={() => onChange(w.key)}
          className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
            value === w.key ? "bg-[#e8c86a] text-black" : "text-white/50 hover:text-white"
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Advanced filters (4★+ creators) ─────────────────────────────────────
   Custom lookback windows + a vertical cross-tab (top creator per lane).
   Base search/charts/follow are never gated — this is precision tooling. */

const DAY_PRESETS = [7, 14, 30, 90];

function AdvancedPanel({ days, setDays }: { days: number | null; setDays: (d: number | null) => void }) {
  const [crossTab, setCrossTab] = useState<Array<{ vertical: string; creator: CreatorLite | null }>>([]);
  const [crossLoading, setCrossLoading] = useState(false);
  const [crossOpen, setCrossOpen] = useState(false);

  const loadCrossTab = async () => {
    if (crossOpen) {
      setCrossOpen(false);
      return;
    }
    setCrossOpen(true);
    if (crossTab.length) return;
    setCrossLoading(true);
    const rows = await Promise.all(
      VERTICALS.map(async (v) => {
        const d = await getJson<{ creators: CreatorLite[] }>(
          `/api/discovery/charts/creators?window=week&vertical=${v}&limit=1`
        );
        return { vertical: v, creator: d?.creators?.[0] ?? null };
      })
    );
    setCrossTab(rows);
    setCrossLoading(false);
  };

  return (
    <div className="w-full max-w-3xl rounded-2xl border border-[#c9a84c]/25 bg-black/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-white/40">Lookback:</span>
        {[null, ...DAY_PRESETS].map((d) => (
          <button
            key={String(d)}
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-all ${
              days === d
                ? "bg-[#e8c86a] text-black"
                : "border border-white/15 text-white/50 hover:border-[#e8c86a]/40 hover:text-white"
            }`}
          >
            {d === null ? "Default" : `${d}d`}
          </button>
        ))}
        <button
          onClick={loadCrossTab}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-[#c9a84c]/40 px-3 py-1 text-xs font-bold text-[#e8c86a] hover:bg-[#e8c86a]/10"
        >
          {crossOpen ? <X className="h-3.5 w-3.5" /> : null}
          {crossOpen ? "Hide cross-tab" : "Compare verticals"}
        </button>
      </div>
      {crossOpen && (
        <div className="mt-3">
          {crossLoading ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {crossTab.map(({ vertical, creator }) => (
                <div
                  key={vertical}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2"
                >
                  <span className="w-20 shrink-0 text-xs font-bold text-[#e8c86a]">
                    {VERTICAL_META[vertical as VerticalKey].label}
                  </span>
                  {creator ? (
                    <Link href={`/artist/${creator.slug}`} className="min-w-0 flex-1 truncate text-sm hover:text-[#e8c86a]">
                      <span className="font-semibold">{creator.display_name}</span>
                      <span className="ml-2 text-xs text-white/40">
                        {formatCount(creator.total_plays)} plays
                      </span>
                    </Link>
                  ) : (
                    <span className="text-xs text-white/30">— open lane —</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Charts() {
  const [tab, setTab] = useState<Tab>("charts");
  const [vertical, setVertical] = useState<VerticalKey | "all">("all");
  const [window, setWindow] = useState<WindowKey>("week");
  const [data, setData] = useState<ChartsPayload | null>(null);
  const [rising, setRising] = useState<CreatorLite[]>([]);
  const [earners, setEarners] = useState<CreatorLite[]>([]);
  const [brands, setBrands] = useState<CreatorLite[]>([]);
  const [loading, setLoading] = useState(true);
  /* Advanced (4-6 stars only): custom lookback + vertical cross-tab.
     Search, charts and follow stay ungated for everyone. */
  const advanced = useMinStars(4);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const v = vertical === "all" ? "" : `&vertical=${vertical}`;
      const dParam = tab === "charts" && days ? `&days=${days}` : "";
      if (tab === "charts") {
        const d = await getJson<ChartsPayload>(`/api/discovery/charts?window=${window}${v}${dParam}&limit=10`);
        if (!cancelled) {
          setData(d ?? { tracks: [], videos: [], creators: [] });
          setLoading(false);
        }
      } else if (tab === "breaking") {
        const d = await getJson<{ rising: CreatorLite[] }>(`/api/discovery/rising?limit=12${v}`);
        if (!cancelled) {
          setRising(d?.rising ?? []);
          setLoading(false);
        }
      } else if (tab === "earners") {
        const d = await getJson<{ earners: CreatorLite[] }>(`/api/discovery/rising-earners?limit=12${v}`);
        if (!cancelled) {
          setEarners(d?.earners ?? []);
          setLoading(false);
        }
      } else {
        const d = await getJson<{ creators: CreatorLite[] }>(`/api/discovery/brands?limit=12${v}`);
        if (!cancelled) {
          setBrands(d?.creators ?? []);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, vertical, window, days]);

  const creatorIds = useMemo(
    () =>
      tab === "charts"
        ? (data?.creators ?? []).map((c) => c.id)
        : tab === "breaking"
          ? rising.map((c) => c.id)
          : tab === "earners"
            ? earners.map((c) => c.id)
            : brands.map((c) => c.id),
    [tab, data, rising, earners, brands]
  );
  const followStates = useFollowStates(creatorIds);

  const verticalBlurb =
    vertical === "all"
      ? "Every lane. Every creator. One cheat code."
      : VERTICAL_META[vertical].tagline;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-6 text-center">
        <p className="mb-2 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
          <Trophy className="h-4 w-4" /> Bow Down Charts
        </p>
        <h1 className="text-3xl font-black tracking-tight md:text-5xl">
          Where the next big creator <span className="bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] bg-clip-text text-transparent">gets found.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/50 md:text-base">
          {tab === "breaking"
            ? "Blowing up right now. Get in early — that's the cheat code."
            : tab === "earners"
              ? "Streaming is vanity, selling is sanity. These creators are getting paid."
              : tab === "brands"
                ? "Real audiences, real creators. Find your next partner before everyone else does."
                : "Top creators, top audio, top videos — ranked by what's actually popping."}
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex justify-center gap-2">
        {(
          [
            { key: "charts", label: "Charts", icon: <Trophy className="h-4 w-4" /> },
            { key: "breaking", label: "Breaking", icon: <Flame className="h-4 w-4" /> },
            { key: "earners", label: "Earners", icon: <Banknote className="h-4 w-4" /> },
            { key: "brands", label: "For Brands", icon: <Briefcase className="h-4 w-4" /> },
          ] as Array<{ key: Tab; label: string; icon: React.ReactNode }>
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-black transition-all ${
              tab === t.key
                ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black shadow-[0_0_24px_rgba(232,200,106,0.35)]"
                : "border border-white/15 bg-white/5 text-white/60 hover:border-[#e8c86a]/40 hover:text-white"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Vertical switcher */}
      <div className="mb-4 flex justify-center">
        <VerticalSwitcher value={vertical} onChange={setVertical} />
      </div>
      <p className="mb-6 text-center text-sm text-white/40">{verticalBlurb}</p>

      {tab === "charts" && (
        <div className="mb-8 flex flex-col items-center gap-3">
          <WindowTabs value={window} onChange={setWindow} />
          {advanced && (
            <button
              onClick={() => setShowAdvanced((x) => !x)}
              className="flex items-center gap-1.5 text-xs font-bold text-white/40 hover:text-[#e8c86a]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showAdvanced ? "Hide advanced filters" : "Advanced filters (4★+)"}
            </button>
          )}
          {advanced && showAdvanced && (
            <AdvancedPanel days={days} setDays={setDays} />
          )}
        </div>
      )}

      {/* ── Charts tab ── */}
      {tab === "charts" && (
        <>
          {loading || !data ? (
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <div className="mb-4 h-6 w-40 animate-pulse rounded bg-white/10" />
                <ChartSkeleton rows={8} />
              </div>
              <div>
                <div className="mb-4 h-6 w-40 animate-pulse rounded bg-white/10" />
                <ChartSkeleton rows={8} />
              </div>
            </div>
          ) : (
            <>
              <section className="mb-10">
                <SectionHeader
                  icon={<Users className="h-5 w-5" />}
                  title={`Top creators${vertical !== "all" ? ` — ${verticalLabel(vertical)}` : ""}`}
                  blurb="Ranked by plays + new followers. Follow them before they blow."
                />
                {data.creators.length === 0 ? (
                  <EmptyState
                    title="No chart-toppers here yet"
                    blurb="This lane is wide open. Publish something and claim the crown — the cheat code favors the bold."
                    ctaHref="/choose-artist"
                    ctaLabel="Start creating"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                    {data.creators.map((c, i) => (
                      <CreatorCard key={c.id} creator={c} rank={i} followState={followStates[c.id]} />
                    ))}
                  </div>
                )}
              </section>

              <div className="grid gap-10 lg:grid-cols-2">
                <section>
                  <SectionHeader
                    icon={<Disc3 className="h-5 w-5" />}
                    title="Top audio"
                    blurb="Tracks and podcast episodes on repeat."
                  />
                  {data.tracks.length === 0 ? (
                    <EmptyState title="Nothing charting yet" blurb="Be the first to drop audio in this lane." />
                  ) : (
                    <div className="grid gap-3">
                      {data.tracks.map((t, i) => (
                        <TrackRow key={t.id} track={t} rank={i} />
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <SectionHeader
                    icon={<Clapperboard className="h-5 w-5" />}
                    title="Top videos"
                    blurb="The videos everybody's watching."
                  />
                  {data.videos.length === 0 ? (
                    <EmptyState title="Nothing charting yet" blurb="Be the first to drop video in this lane." />
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {data.videos.map((v, i) => (
                        <VideoCard key={v.id} video={v} rank={i} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Breaking tab ── */}
      {tab === "breaking" && (
        <section>
          <SectionHeader
            icon={<Flame className="h-5 w-5" />}
            title="Breaking now"
            blurb="Creators gaining followers fastest this week. Early fans win."
          />
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : rising.length === 0 ? (
            <EmptyState
              title="Nothing breaking right this second"
              blurb="The next wave is loading. Check the charts — or be the wave."
              ctaHref="/choose-artist"
              ctaLabel="Start creating"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {rising.map((c) => (
                <CreatorCard key={c.id} creator={c} followState={followStates[c.id]} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Earners tab ── */}
      {tab === "earners" && (
        <section>
          <SectionHeader
            icon={<Banknote className="h-5 w-5" />}
            title="Rising earners"
            blurb="Ranked by real fan payments in the last 30 days. Follow the money."
          />
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : earners.length === 0 ? (
            <EmptyState
              title="No earners on the board yet"
              blurb="Nobody's cashed in here yet — which means the lane is wide open. Sell your first download and take the top spot."
              ctaHref="/choose-artist"
              ctaLabel="Start creating"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {earners.map((c, i) => (
                <div key={c.id} className="relative">
                  <span className="absolute left-2 top-2 z-10 rounded-full bg-emerald-400/90 px-2 py-0.5 text-[11px] font-black text-black">
                    {formatMoney((c as CreatorLite & { earned_cents_30d?: number }).earned_cents_30d)}/mo
                  </span>
                  <CreatorCard creator={c} rank={i} followState={followStates[c.id]} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── For Brands tab ── */}
      {tab === "brands" && (
        <section>
          <SectionHeader
            icon={<Briefcase className="h-5 w-5" />}
            title="Work with creators"
            blurb="Top creators by audience. Outreach happens in Brand Deals — this is the scouting report."
          />
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : brands.length === 0 ? (
            <EmptyState
              title="No creators to scout here yet"
              blurb="This lane is still growing. Check back soon — or list your brand in the marketplace."
              ctaHref="/brand-deals"
              ctaLabel="Open Brand Deals"
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {brands.map((c) => (
                  <CreatorCard key={c.id} creator={c} followState={followStates[c.id]} />
                ))}
              </div>
              <div className="mt-6 flex justify-center">
                <Link href="/brand-deals">
                  <span className="inline-block cursor-pointer rounded-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-8 py-3 text-sm font-black text-black hover:brightness-110">
                    Start outreach in Brand Deals →
                  </span>
                </Link>
              </div>
            </>
          )}
        </section>
      )}

      {/* Browse more */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm">
        <span className="text-white/40">Keep digging:</span>
        <Link href="/browse" className="font-bold text-[#e8c86a] hover:underline">Browse verticals</Link>
        <span className="text-white/20">·</span>
        <Link href="/genres" className="font-bold text-[#e8c86a] hover:underline">Browse genres</Link>
        <span className="text-white/20">·</span>
        <Link href="/search" className="font-bold text-[#e8c86a] hover:underline">Search everything</Link>
      </div>

      <CreateCta />
    </div>
  );
}

