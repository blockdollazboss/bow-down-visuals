import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Crown, Music2, Play, Sparkles, Upload } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Cover Fridays card (N19) — the house's weekly cover ritual,
 * docked under the Challenge of the Week inside the contest hub
 * on Home / the contests page / the dashboard / the winners'
 * circle. This week's published cover theme comes from the
 * calendar alone (GET /api/challenges/cover-fridays), so the card
 * ALWAYS has the theme to show; the house ensures the week's
 * challenge itself, so entering is one click into the same
 * publish prefill the weekly card uses. The King crowns by Monday
 * under the published house rule — the most-played cover takes
 * it — and the crowned cover is featured right here, credited.
 * No entry fee, no prize Bucs: the feature IS the prize. Like
 * every hub surface the card never blocks the page: a failed
 * read hides it instead of showing an invented theme.
 */

interface CoverTheme {
  key: string;
  title: string;
  description: string;
  hashtag: string;
}

interface CrownedCover {
  weekKey: string;
  themeTitle: string;
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string | null;
  creatorUserId: string;
  displayName: string;
  slug: string;
  viewCount: number;
  likeCount: number;
  crownedAt: string;
}

interface CoverFridaysData {
  weekKey: string;
  theme: CoverTheme;
  challenge: {
    slug: string;
    status: string;
    deadline: string;
    entryCount: number;
  } | null;
  featured: CrownedCover | null;
  pastCrowns: CrownedCover[];
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function CoverFridaysCard() {
  const isLight = useIsLightTheme();
  const { user } = useAuth();
  const [data, setData] = useState<CoverFridaysData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/challenges/cover-fridays")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: CoverFridaysData | null) => {
        if (!cancelled && json && json.theme) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  const ink = isLight ? "text-[#241B05]" : "text-white";
  const sub = isLight ? "text-[#5C4A1E]" : "text-zinc-400";
  const featured = data.featured;
  const live = data.challenge && data.challenge.status === "live";
  const enterHref = data.challenge
    ? user
      ? `/publish?type=video&category=video&challenge=${encodeURIComponent(data.challenge.slug)}&description=${encodeURIComponent(`#${data.theme.hashtag} ${data.theme.title} — my Cover Fridays entry`)}`
      : "/login"
    : null;

  return (
    <section
      data-testid="cover-fridays-card"
      className={`relative overflow-hidden rounded-3xl border p-5 sm:p-6 ${
        isLight
          ? "border-[#7A5A12]/25 bg-gradient-to-br from-[#FFF6DE] via-[#FBEFD2] to-white shadow-[0_18px_44px_-24px_rgba(122,90,18,0.45)]"
          : "border-white/10 bg-gradient-to-br from-amber-500/[0.08] via-transparent to-transparent bg-white/[0.03]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
            isLight ? "bg-[#7A5A12] text-[#FFF6DE]" : "bg-amber-400 text-zinc-950"
          }`}
        >
          <Music2 className="h-3 w-3" /> Cover Fridays
        </span>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${sub}`}>
          The house cover ritual · {data.weekKey}
        </span>
      </div>

      <h3 className={`mt-3 text-xl font-black tracking-tight sm:text-2xl ${ink}`}>
        {data.theme.title}
      </h3>
      <p className={`mt-1 max-w-2xl text-sm leading-relaxed ${sub}`}>{data.theme.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
            isLight ? "border-[#7A5A12]/35 text-[#7A5A12]" : "border-amber-300/30 text-amber-200"
          }`}
        >
          #{data.theme.hashtag}
        </span>
        {data.challenge && (
          <span className={`text-xs font-semibold ${sub}`}>
            {fmtCount(data.challenge.entryCount)}{" "}
            {data.challenge.entryCount === 1 ? "cover" : "covers"} in this week
          </span>
        )}
      </div>

      <p className={`mt-3 text-xs leading-relaxed ${sub}`}>
        Post your cover by Sunday night — by Monday the King crowns the most-played cover and it
        is featured right here, credited. No entry fee: the feature is the prize.
      </p>

      {enterHref && live && (
        <div className="mt-4">
          <Link
            href={enterHref}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide transition hover:opacity-90 ${
              isLight ? "bg-[#241B05] text-[#F5D97E]" : "bg-amber-400 text-zinc-950"
            }`}
          >
            {user ? <Upload className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {user ? "Enter your cover" : "Sign in to enter"}
          </Link>
        </div>
      )}

      {featured && (
        <div
          className={`mt-5 border-t pt-4 ${isLight ? "border-[#7A5A12]/20" : "border-white/10"}`}
        >
          <div
            className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] ${
              isLight ? "text-[#7A5A12]" : "text-amber-300"
            }`}
          >
            <Crown className="h-3.5 w-3.5" /> The crowned cover — {featured.themeTitle}
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            {featured.thumbnailUrl ? (
              <img
                src={featured.thumbnailUrl}
                alt=""
                className="h-14 w-24 shrink-0 rounded-xl object-cover"
                loading="lazy"
              />
            ) : (
              <span
                className={`flex h-14 w-24 shrink-0 items-center justify-center rounded-xl ${
                  isLight ? "bg-[#7A5A12]/10" : "bg-white/5"
                }`}
              >
                <Play className={`h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`} />
              </span>
            )}
            <div className="min-w-0">
              <div className={`truncate text-sm font-bold ${ink}`}>{featured.videoTitle}</div>
              <div className={`text-xs ${sub}`}>
                by{" "}
                {featured.slug ? (
                  <Link
                    href={`/artist/${featured.slug}`}
                    className={`font-semibold underline-offset-2 hover:underline ${
                      isLight ? "text-[#7A5A12]" : "text-amber-300"
                    }`}
                  >
                    {featured.displayName}
                  </Link>
                ) : (
                  featured.displayName
                )}{" "}
                · {fmtCount(featured.viewCount)} plays
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
