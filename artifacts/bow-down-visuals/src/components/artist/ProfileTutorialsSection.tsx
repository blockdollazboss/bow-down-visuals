import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Clapperboard, Play, CheckCircle2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  fetchTutorialCatalog,
  formatTimestamp,
  type TutorialCard,
} from "@/lib/tutorials";

/* ─── Tutorials shelf — public profile section (Tutorials V1) ───────────
   The creator's tutorials, listed on their Grand Stage profile: the
   profile is the website, so the teaching lives here too, one tap
   from the music and the store. Self-fetching like the Stage pin;
   the section renders NOTHING when the creator has no tutorials
   (an absent shelf is honest), and a failed load is a small honest
   error + retry — never a fake-empty shelf. Cards deep-link into
   the Academy's How-To Videos tab at that exact tutorial. */

export default function ProfileTutorialsSection({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<TutorialCard[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const catalog = await fetchTutorialCatalog({ profileSlug: slug });
        if (cancelled) return;
        setCards([
          ...catalog.series.flatMap((s) => s.tutorials),
          ...catalog.standalone,
        ]);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [slug, retryNonce]);

  if (status === "loading") return null;

  if (status === "error") {
    return (
      <section className="mx-auto w-full max-w-4xl px-4 py-6">
        <div
          className="flex flex-wrap items-center gap-3 rounded-2xl border p-4"
          style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-panel)" }}
        >
          <p className="flex-1 text-sm" style={{ color: "var(--ap-text-muted)" }}>
            {t("tutorials.shelfError", { defaultValue: "Tutorials wouldn't load." })}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold"
            style={{ backgroundColor: "var(--ap-accent)", color: "var(--ap-on-accent, #000)" }}
          >
            <RotateCcw className="h-4 w-4" /> {t("tutorials.retry", { defaultValue: "Retry" })}
          </button>
        </div>
      </section>
    );
  }

  if (!cards || cards.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex items-center gap-2.5">
        <Clapperboard className="h-5 w-5" style={{ color: "var(--ap-accent)" }} />
        <h2
          className="text-xl font-black"
          style={{ fontFamily: "var(--ap-display-font)", color: "var(--ap-text)" }}
        >
          {t("tutorials.shelfHeading", { defaultValue: "Tutorials" })}
        </h2>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/academy?tab=tutorials&tutorial=${encodeURIComponent(c.slug)}`}
            className="block rounded-2xl border p-4 transition"
            style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-panel)" }}
          >
            <p className="text-base font-bold leading-snug" style={{ color: "var(--ap-text)" }}>
              {c.title}
            </p>
            {c.description && (
              <p className="mt-1 line-clamp-2 text-sm" style={{ color: "var(--ap-text-muted)" }}>
                {c.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--ap-text-muted)" }}>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold" style={{ borderColor: "var(--ap-border)" }}>
                <CheckCircle2 className="h-3 w-3" />
                {c.chapterCount === 1
                  ? t("tutorials.chapterOne", { defaultValue: "1 chapter" })
                  : t("tutorials.chaptersCount", { defaultValue: "{{count}} chapters", count: c.chapterCount })}
              </span>
              {c.hasVideo ? (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold" style={{ borderColor: "var(--ap-border)" }}>
                  <Play className="h-3 w-3" />
                  {c.videoDurationSec ? formatTimestamp(c.videoDurationSec) : t("tutorials.video", { defaultValue: "Video" })}
                </span>
              ) : (
                <span className="rounded-full border border-amber-500/50 px-2 py-0.5 font-semibold text-amber-500">
                  {t("tutorials.videoInProductionShort", { defaultValue: "Video in production" })}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
