import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Shape of GET /api/public/stats. All numbers are REAL DB aggregates — never invented. */
export interface PublicStats {
  creators: number;
  tracks_published: number;
  videos_published: number;
  plays: number;
  paid_out_usd: number;
  referral_bucs_awarded: number;
  verticals: Record<string, number>;
  generated_at: string;
  cached?: boolean;
  stale?: boolean;
}

/* Module-level promise cache: every band on a page shares one fetch. */
let statsPromise: Promise<PublicStats | null> | null = null;

function fetchStats(): Promise<PublicStats | null> {
  if (!statsPromise) {
    statsPromise = fetch("/api/public/stats", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<PublicStats>) : null))
      .catch(() => null)
      .then((d) => {
        // If the endpoint is unavailable, don't retry-bang it on every mount.
        if (!d) statsPromise = null;
        return d;
      });
  }
  return statsPromise;
}

export function usePublicStats(): PublicStats | null {
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    let live = true;
    fetchStats().then((d) => {
      if (live) setStats(d);
    });
    return () => {
      live = false;
    };
  }, []);
  return stats;
}

/** Per-vertical plural labels for the flavor line ("2,140 musicians earning"). */
const VERTICAL_LABELS: Record<string, string> = {
  music: "musicians",
  video: "video creators",
  gaming: "streamers & gamers",
  podcast: "podcasters",
  film: "filmmakers",
  tv: "series creators",
  influencer: "influencers",
  education: "educators",
  other: "creators",
};

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function formatMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Animated count-up that starts the first time the band scrolls into view. */
function useCountUp(target: number | null, start: boolean, durationMs = 1400): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!start || target === null) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(target * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [start, target, durationMs]);
  return value;
}

interface SocialProofBandProps {
  /** "full": 4-stat grid; "compact": single headline line. */
  variant?: "full" | "compact";
  /** Show a per-vertical flavor line, e.g. vertical="music" → "2,140 musicians". */
  vertical?: string;
  className?: string;
}

/**
 * SocialProofBand — gold/black luxury live-stats band.
 * Numbers come from GET /api/public/stats (real DB aggregates, 10-min cached).
 * Renders nothing until real data arrives AND at least one creator exists —
 * we never display invented numbers.
 */
export function SocialProofBand({ variant = "full", vertical, className = "" }: SocialProofBandProps) {
  const { t } = useTranslation();
  const stats = usePublicStats();
  const bandRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = bandRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ready = stats !== null && stats.creators > 0;
  const creators = useCountUp(ready ? stats.creators : null, inView && ready);
  const media = useCountUp(ready ? stats.tracks_published + stats.videos_published : null, inView && ready);
  const plays = useCountUp(ready ? stats.plays : null, inView && ready);
  const paidOut = useCountUp(ready ? stats.paid_out_usd : null, inView && ready);

  const verticalCount = vertical && stats?.verticals ? stats.verticals[vertical] ?? 0 : 0;
  const verticalLabel = vertical ? VERTICAL_LABELS[vertical] ?? "creators" : "";

  if (!ready) return null;

  if (variant === "compact") {
    return (
      <section
        ref={bandRef as never}
        aria-label={t("socialProof.ariaLabel")}
        className={`relative z-10 flex items-center justify-center px-4 py-3 ${className}`}
      >
        <p className="text-center text-sm font-semibold text-white/60">
          {t("socialProof.joinCta")}{" "}
          <span className="text-primary font-black tabular-nums">{formatInt(creators)}</span>{" "}
          {t("socialProof.creatorsWord")}
          <span className="mx-2 text-white/20" aria-hidden>·</span>
          <span className="text-white/45 font-medium">
            <span className="text-primary/90 font-bold tabular-nums">{formatInt(media)}</span>{" "}
            {t("socialProof.mediaPublished")}
          </span>
        </p>
      </section>
    );
  }

  const statDefs = [
    { value: formatInt(creators), label: t("socialProof.stats.creators") },
    { value: formatInt(media), label: t("socialProof.stats.media") },
    { value: formatInt(plays), label: t("socialProof.stats.plays") },
    { value: formatMoney(paidOut), label: t("socialProof.stats.paidOut") },
  ];

  return (
    <section
      ref={bandRef as never}
      aria-label={t("socialProof.ariaLabel")}
      className={`relative border-y border-primary/15 bg-gradient-to-b from-black via-[#0d0a04] to-black px-5 py-12 md:py-14 ${className}`}
    >
      <div className="mx-auto max-w-6xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary/80">
          {t("socialProof.kicker")}
        </p>
        <h2 className="mt-3 text-2xl md:text-3xl font-black tracking-tight text-white">
          {t("socialProof.headlinePrefix")}{" "}
          <span className="bg-gradient-to-r from-yellow-300 via-primary to-yellow-300 bg-clip-text text-transparent tabular-nums">
            {formatInt(creators)}
          </span>{" "}
          {t("socialProof.headlineSuffix")}
        </h2>
        {vertical && verticalCount > 0 && (
          <p className="mt-2 text-sm font-semibold text-primary/90">
            <span className="tabular-nums">{formatInt(verticalCount)}</span> {verticalLabel}{" "}
            {t("socialProof.verticalSuffix")}
          </p>
        )}
        <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
          {statDefs.map((s) => (
            <div key={s.label}>
              <div className="text-3xl md:text-4xl font-black tracking-tight text-white tabular-nums drop-shadow-[0_0_18px_rgba(201,168,76,0.25)]">
                {s.value}
              </div>
              <div className="mt-1.5 text-xs md:text-sm text-white/45 font-medium">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[11px] text-white/25">
          {t("socialProof.liveNote")}
        </p>
      </div>
    </section>
  );
}

export default SocialProofBand;
