/**
 * TrendsDesk — the Promote Room's native Trend Predictor desk
 * (stack1500 world parity wave #3, census item 40).
 *
 * Call what's coming in your niche before it lands: pick the
 * niche (or write your own), the platforms and your audience
 * size, and the forecast names the trends with confidence,
 * timing, reasoning and early signals. Any trend expands
 * into content ideas, and trends worth watching join the
 * watchlist — the SAME localStorage list the website's
 * Trends page keeps, so the room and the page share it.
 *
 * Prices from the registry: the forecast is 200 Bucs, ideas
 * 100. Both ride the confirmed-spend seam like the page: a
 * decline runs nothing; a 402 lands in the out-of-Bucs
 * state. Predictions are pattern analysis, not guarantees —
 * the rail's disclaimer renders with every forecast.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage } from "../../../lib/api-error";
import {
  TREND_AUDIENCES,
  TREND_FEATURE_FORECAST,
  TREND_FEATURE_IDEAS,
  TREND_FORECAST_COST,
  TREND_FORECAST_PATH,
  TREND_IDEAS_COST,
  TREND_IDEAS_PATH,
  TREND_NICHES,
  TREND_PLATFORMS,
  TREND_WATCHLIST_KEY,
  buildForecastPayload,
  buildIdeasPayload,
  loadWatchlist,
  trendForecastOf,
  trendIdeasOf,
  type TrackedTrend,
  type TrendForecast,
  type TrendItem,
} from "@/lib/world/trends-desk";

function GuestGate({ isLight }: { isLight: boolean }) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  return (
    <div className="space-y-3" data-testid="world-trends-desk">
      <p className={`text-base font-black ${strong}`}>Trend Predictor</p>
      <p className={`text-sm ${muted}`}>
        You&rsquo;re visiting as a guest — forecasts run on your account, so the desk needs you
        signed in.
      </p>
      <Link
        href="/login"
        data-testid="world-trends-desk-signin"
        className="bdv-touch-target inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37] px-4 py-2 text-xs font-bold text-black"
      >
        Sign in to run a forecast
      </Link>
    </div>
  );
}

export function TrendsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { confirmedFetch } = useConfirmedApi();
  const { getAccessToken, refreshProfile } = useAuth();
  const [niche, setNiche] = useState("Music");
  const [customNiche, setCustomNiche] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["tiktok"]);
  const [audience, setAudience] = useState("growing");
  const [forecast, setForecast] = useState<TrendForecast | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState(false);
  const [ideasFor, setIdeasFor] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [ideasOut, setIdeasOut] = useState(false);
  const [watchlist, setWatchlist] = useState<TrackedTrend[]>([]);

  useEffect(() => {
    setWatchlist(loadWatchlist(window.localStorage));
  }, []);

  if (isGuest) return <GuestGate isLight={isLight} />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const finalNiche = () => (customNiche.trim() || niche).slice(0, 120);
  const isTracked = (trend: string) => watchlist.some((t) => t.trend === trend);

  function persistWatchlist(list: TrackedTrend[]) {
    setWatchlist(list);
    try {
      window.localStorage.setItem(TREND_WATCHLIST_KEY, JSON.stringify(list));
    } catch {
      /* storage full/blocked — the watchlist just won't persist */
    }
  }

  function track(trend: TrendItem) {
    if (isTracked(trend.trend)) return;
    persistWatchlist([
      { ...trend, niche: finalNiche(), trackedAt: new Date().toISOString() },
      ...watchlist,
    ]);
  }

  function untrack(name: string) {
    persistWatchlist(watchlist.filter((t) => t.trend !== name));
  }

  async function runForecast() {
    const payload = buildForecastPayload(niche, customNiche, platforms, audience);
    if (!payload || running) {
      if (!payload) setError("Name your niche and pick at least one platform first.");
      return;
    }
    setRunning(true);
    setError(null);
    setOut(false);
    setIdeasFor(null);
    setIdeas([]);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await confirmedFetch(TREND_FORECAST_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        overrideCost: TREND_FORECAST_COST,
        overrideFeature: TREND_FEATURE_FORECAST,
      });
      if (res === null) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOut(true);
        void refreshProfile().catch(() => {});
        return;
      }
      const parsed = res.ok ? trendForecastOf(data) : null;
      if (!parsed) throw new Error(apiErrorMessage(data, "The forecast didn't land — try again."));
      setForecast(parsed);
      void refreshProfile().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "The forecast didn't land — try again.");
    } finally {
      setRunning(false);
    }
  }

  async function runIdeas(trend: TrendItem) {
    if (ideasBusy) return;
    setIdeasFor(trend.trend);
    setIdeas([]);
    setIdeasError(null);
    setIdeasOut(false);
    setIdeasBusy(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await confirmedFetch(TREND_IDEAS_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildIdeasPayload(finalNiche(), trend)),
        overrideCost: TREND_IDEAS_COST,
        overrideFeature: TREND_FEATURE_IDEAS,
      });
      if (res === null) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setIdeasOut(true);
        void refreshProfile().catch(() => {});
        return;
      }
      const parsed = res.ok ? trendIdeasOf(data) : null;
      if (!parsed) throw new Error(apiErrorMessage(data, "The ideas didn't land — try again."));
      setIdeas(parsed);
      void refreshProfile().catch(() => {});
    } catch (e) {
      setIdeasError(e instanceof Error ? e.message : "The ideas didn't land — try again.");
    } finally {
      setIdeasBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="world-trends-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Trend Predictor</p>
        <p className={`text-xs ${muted}`}>
          What&rsquo;s about to move in your niche — called early, with the signals showing why.
        </p>
      </div>

      <div>
        <p className={`text-xs font-bold ${muted}`}>Niche</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {TREND_NICHES.map((n) => (
            <button
              key={n}
              type="button"
              className={chipCls(customNiche.trim() === "" && niche === n)}
              onClick={() => setNiche(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <input
          className={`${inputCls} mt-2`}
          data-testid="world-trends-desk-custom-niche"
          placeholder="…or your own niche"
          maxLength={120}
          value={customNiche}
          onChange={(e) => setCustomNiche(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <p className={`text-xs font-bold ${muted}`}>Platforms</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TREND_PLATFORMS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={chipCls(platforms.includes(p.key))}
                onClick={() =>
                  setPlatforms((prev) =>
                    prev.includes(p.key) ? prev.filter((x) => x !== p.key) : [...prev, p.key],
                  )
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className={`text-xs font-bold ${muted}`}>Your audience</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TREND_AUDIENCES.map((a) => (
              <button
                key={a.key}
                type="button"
                className={chipCls(audience === a.key)}
                onClick={() => setAudience(a.key)}
              >
                {a.label} · {a.blurb}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        data-testid="world-trends-desk-run"
        className={goldBtn}
        disabled={running}
        onClick={() => void runForecast()}
      >
        {running ? "Reading the signals…" : `Run the forecast — ${TREND_FORECAST_COST} Bucs`}
      </button>
      {out ? (
        <p className={errCls}>
          You&rsquo;re out of Visual Bucs for the {TREND_FEATURE_FORECAST}. Top up at the
          Treasury&rsquo;s Visual Buc Packs desk and run it again.
        </p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {forecast ? (
        <div className="space-y-2" data-testid="world-trends-desk-results">
          {forecast.disclaimer ? (
            <p className={`text-xs italic ${muted}`}>{forecast.disclaimer}</p>
          ) : null}
          {forecast.trends.map((trend) => (
            <article key={trend.trend} className={`rounded-xl border p-3 ${cardCls}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-sm font-black ${strong}`}>{trend.trend}</p>
                <span className={chipCls(trend.confidence >= 70)}>
                  {trend.confidence}% confidence
                </span>
                {trend.timeframe ? <span className={`text-xs ${muted}`}>{trend.timeframe}</span> : null}
                <span className="ml-auto flex gap-1.5">
                  <button
                    type="button"
                    data-testid={`world-trends-desk-ideas-${trend.trend}`}
                    className={chipCls(false)}
                    disabled={ideasBusy}
                    onClick={() => void runIdeas(trend)}
                  >
                    {ideasBusy && ideasFor === trend.trend ? "Thinking…" : `Content ideas — ${TREND_IDEAS_COST} Bucs`}
                  </button>
                  {isTracked(trend.trend) ? (
                    <button type="button" className={chipCls(true)} onClick={() => untrack(trend.trend)}>
                      Watching ✓
                    </button>
                  ) : (
                    <button type="button" className={chipCls(false)} onClick={() => track(trend)}>
                      Watch it
                    </button>
                  )}
                </span>
              </div>
              {trend.reasoning ? (
                <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`}>{trend.reasoning}</p>
              ) : null}
              {trend.earlySignals.length > 0 ? (
                <p className={`mt-1 text-xs ${muted}`}>
                  Early signals: {trend.earlySignals.join(" · ")}
                </p>
              ) : null}
              {ideasFor === trend.trend ? (
                <div className="mt-2">
                  {ideasOut ? (
                    <p className={errCls}>
                      You&rsquo;re out of Visual Bucs for the ideas. Top up at the Treasury&rsquo;s
                      Visual Buc Packs desk and try again.
                    </p>
                  ) : null}
                  {ideasError ? <p className={errCls}>{ideasError}</p> : null}
                  {ideas.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5" data-testid="world-trends-desk-ideas">
                      {ideas.map((idea, i) => (
                        <li key={i} className={`text-sm ${muted}`}>{idea}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {watchlist.length > 0 ? (
        <section data-testid="world-trends-desk-watchlist">
          <p className={`text-sm font-bold ${strong}`}>Your watchlist</p>
          <ul className="mt-1 space-y-1">
            {watchlist.map((t) => (
              <li key={`${t.trend}-${t.trackedAt}`} className={`flex items-center gap-2 text-sm ${muted}`}>
                <span className={`font-bold ${strong}`}>{t.trend}</span>
                <span className="text-xs">{t.niche} · {t.confidence}%</span>
                <button type="button" className={`ml-auto ${chipCls(false)}`} onClick={() => untrack(t.trend)}>
                  Stop watching
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
