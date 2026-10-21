import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Play, Compass, MousePointerClick, CheckCircle2, Circle, Search,
  ArrowLeft, ArrowRight, Loader2, Clapperboard, Download, Link2,
  BookOpen, RotateCcw, Crown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { startGuideOnArrival } from "@/lib/chat-doors";
import {
  fetchTutorialCatalog,
  fetchTutorialDetail,
  fetchMyTutorialProgress,
  recordTutorialProgress,
  filterCatalog,
  inProgressCards,
  tutorialCardState,
  resumeChapter,
  resumeLabel,
  formatTimestamp,
  TUTORIAL_CATEGORY_LABELS,
  type TutorialCatalog,
  type TutorialCard,
  type TutorialDetail,
  type TutorialProgress,
  type ProgressBeat,
} from "@/lib/tutorials";

/* ─── How-To Videos — the Academy's tutorial tab (Tutorials V1) ─────────
   Official Bow Down tutorials + creator tutorials, organized by series,
   searchable in plain language. Every tutorial carries the three
   doors: Watch it (the video — or, while production is still landing,
   an honest "in production" slot over the full written walkthrough),
   Walk me through it (the page's GuideMe tour), and Try it now (the
   deep link into the real tool). Progress is server-side: opening a
   tutorial starts it, chapters tick off, and a returning fan lands
   exactly where they left off. Free — nothing here touches credits. */

export default function TutorialsPanel() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [, setLocation] = useLocation();

  const [catalog, setCatalog] = useState<TutorialCatalog | null>(null);
  const [progressById, setProgressById] = useState<Map<string, TutorialProgress>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get("tutorial");
    } catch {
      return null;
    }
  });
  const [detail, setDetail] = useState<TutorialDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  const card = isLight
    ? "rounded-2xl border border-[#C9A84C]/50 bg-[#F7ECD2]"
    : "rounded-2xl border border-primary/25 bg-zinc-950";
  const sub = isLight ? "text-zinc-600" : "text-zinc-400";
  const head = isLight ? "text-zinc-900" : "text-white";
  const chip = isLight
    ? "border-[#C9A84C]/50 text-zinc-700"
    : "border-white/15 text-zinc-300";

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const [cat, progress] = await Promise.all([
          fetchTutorialCatalog(),
          user ? fetchMyTutorialProgress(getAccessToken).catch(() => new Map()) : Promise.resolve(new Map()),
        ]);
        if (!cancelled) {
          setCatalog(cat);
          setProgressById(progress as Map<string, TutorialProgress>);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(false);
    (async () => {
      try {
        const d = await fetchTutorialDetail(selectedSlug);
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setDetailError(true);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSlug]);

  const beat = useCallback(
    async (tutorialId: string, b: ProgressBeat) => {
      if (!user) return;
      try {
        const p = await recordTutorialProgress(getAccessToken, tutorialId, b);
        setProgressById((prev) => new Map(prev).set(tutorialId, p));
      } catch {
        /* Progress is best-effort — a failed write never blocks the lesson. */
      }
    },
    [user, getAccessToken],
  );

  /* Opening a tutorial starts it (once per tutorial per session). */
  const startedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (detail && user && !startedRef.current.has(detail.id)) {
      startedRef.current.add(detail.id);
      void beat(detail.id, {});
    }
  }, [detail, user, beat]);

  const visible = useMemo(
    () => (catalog ? filterCatalog(catalog, query) : null),
    [catalog, query],
  );
  const resumeCards = useMemo(
    () => (catalog && !query ? inProgressCards(catalog, progressById) : []),
    [catalog, progressById, query],
  );

  const openTutorial = (slug: string) => {
    setSelectedSlug(slug);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tutorial", slug);
      window.history.replaceState(null, "", url.toString());
    } catch { /* deep link is a nicety, not a dependency */ }
    window.scrollTo({ top: 0 });
  };

  const closeTutorial = () => {
    setSelectedSlug(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("tutorial");
      window.history.replaceState(null, "", url.toString());
    } catch { /* ignore */ }
  };

  if (selectedSlug) {
    return (
      <TutorialDetailView
        detail={detail}
        loading={detailLoading}
        error={detailError}
        progress={detail ? progressById.get(detail.id) : undefined}
        onBack={closeTutorial}
        onOpen={openTutorial}
        onBeat={beat}
        onWalk={(route) => {
          setLocation(route);
          startGuideOnArrival(route);
        }}
        card={card}
        sub={sub}
        head={head}
        chip={chip}
        isLight={isLight}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 md:px-6">
      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
          <Clapperboard className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className={`text-2xl font-black md:text-3xl ${head}`}>
            {t("tutorials.heading", { defaultValue: "How-To Videos" })}
          </h2>
          <p className={`mt-1 max-w-xl text-sm ${sub}`}>
            {t("tutorials.sub", {
              defaultValue:
                "Free video walkthroughs from Bow Down Visuals and the creators here — watch it, walk through it on the real page, then try it yourself. Your place is saved as you go.",
            })}
          </p>
        </div>
      </div>

      {/* ── Search ── */}
      <div className={`mt-6 flex items-center gap-2 rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/40 bg-white/70" : "border-white/10 bg-white/[0.04]"}`}>
        <Search className={`h-4 w-4 shrink-0 ${sub}`} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("tutorials.searchPlaceholder", { defaultValue: "How do I…? (try “get paid” or “make a song”)" })}
          className={`w-full bg-transparent text-sm outline-none ${isLight ? "text-zinc-900 placeholder:text-zinc-400" : "text-white placeholder:text-zinc-500"}`}
        />
      </div>

      {loadError ? (
        <div className={`${card} mt-8 p-6 text-center`}>
          <p className={`text-sm font-semibold ${head}`}>
            {t("tutorials.loadError", { defaultValue: "The tutorials wouldn't load." })}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black"
          >
            <RotateCcw className="h-4 w-4" /> {t("tutorials.retry", { defaultValue: "Retry" })}
          </button>
        </div>
      ) : !visible ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : visible.series.length === 0 && visible.standalone.length === 0 ? (
        <div className={`${card} mt-8 p-6 text-center`}>
          <BookOpen className="mx-auto h-8 w-8 text-primary" />
          <p className={`mt-3 text-sm font-semibold ${head}`}>
            {query
              ? t("tutorials.noMatches", { defaultValue: "Nothing matches that yet." })
              : t("tutorials.emptyTitle", { defaultValue: "The first how-to videos are in production." })}
          </p>
          <p className={`mt-1 text-sm ${sub}`}>
            {t("tutorials.emptyBody", {
              defaultValue: "When a tutorial lands, it shows up here — free to watch, with the walkthrough written out step by step.",
            })}
          </p>
        </div>
      ) : (
        <>
          {/* ── Continue where you left off ── */}
          {resumeCards.length > 0 && (
            <section className="mt-8">
              <h3 className={`text-sm font-black uppercase tracking-widest ${sub}`}>
                {t("tutorials.continueHeading", { defaultValue: "Continue where you left off" })}
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {resumeCards.map((c) => (
                  <TutorialCardView
                    key={c.id}
                    cardData={c}
                    progress={progressById.get(c.id)}
                    onOpen={() => openTutorial(c.slug)}
                    card={card}
                    sub={sub}
                    head={head}
                    chip={chip}
                    resume
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Series shelves ── */}
          {visible.series.map((s) => (
            <section key={s.id} className="mt-10">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={`text-lg font-black ${head}`}>{s.title}</h3>
                {s.isOfficial && <OfficialChip chip={chip} />}
              </div>
              {s.description && <p className={`mt-1 text-sm ${sub}`}>{s.description}</p>}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {s.tutorials.map((c) => (
                  <TutorialCardView
                    key={c.id}
                    cardData={c}
                    progress={progressById.get(c.id)}
                    onOpen={() => openTutorial(c.slug)}
                    card={card}
                    sub={sub}
                    head={head}
                    chip={chip}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* ── Standalone tutorials, grouped by path ── */}
          {visible.standalone.length > 0 && (
            <section className="mt-10">
              <h3 className={`text-lg font-black ${head}`}>
                {t("tutorials.moreHeading", { defaultValue: "More tutorials" })}
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {visible.standalone.map((c) => (
                  <TutorialCardView
                    key={c.id}
                    cardData={c}
                    progress={progressById.get(c.id)}
                    onOpen={() => openTutorial(c.slug)}
                    card={card}
                    sub={sub}
                    head={head}
                    chip={chip}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ─── shared bits ────────────────────────────────────────────────────── */

function OfficialChip({ chip }: { chip: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${chip}`}>
      <Crown className="h-3 w-3 text-primary" />
      {t("tutorials.officialBadge", { defaultValue: "Bow Down Visuals" })}
    </span>
  );
}

function TutorialCardView({
  cardData,
  progress,
  onOpen,
  card,
  sub,
  head,
  chip,
  resume = false,
}: {
  cardData: TutorialCard;
  progress?: TutorialProgress;
  onOpen: () => void;
  card: string;
  sub: string;
  head: string;
  chip: string;
  resume?: boolean;
}) {
  const { t } = useTranslation();
  const state = tutorialCardState(progress);
  return (
    <button type="button" onClick={onOpen} className={`${card} p-4 text-left transition hover:border-primary/60`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-base font-bold leading-snug ${head}`}>{cardData.title}</p>
        {state === "completed" ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            {t("tutorials.completed", { defaultValue: "Completed" })}
          </span>
        ) : state === "in_progress" ? (
          <span className="shrink-0 text-xs font-bold text-primary">
            {t("tutorials.inProgress", { defaultValue: "In progress" })}
          </span>
        ) : null}
      </div>
      {cardData.description && (
        <p className={`mt-1 line-clamp-2 text-sm ${sub}`}>{cardData.description}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {cardData.isOfficial ? (
          <OfficialChip chip={chip} />
        ) : cardData.creatorName ? (
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${chip}`}>
            {t("tutorials.byCreator", { defaultValue: "by {{name}}", name: cardData.creatorName })}
          </span>
        ) : null}
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${chip}`}>
          {cardData.chapterCount === 1
            ? t("tutorials.chapterOne", { defaultValue: "1 chapter" })
            : t("tutorials.chaptersCount", { defaultValue: "{{count}} chapters", count: cardData.chapterCount })}
        </span>
        {cardData.hasVideo ? (
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${chip}`}>
            <Play className="mr-1 inline h-3 w-3" />
            {cardData.videoDurationSec ? formatTimestamp(cardData.videoDurationSec) : t("tutorials.video", { defaultValue: "Video" })}
          </span>
        ) : (
          <span className="rounded-full border border-amber-500/50 px-2 py-0.5 font-semibold text-amber-500">
            {t("tutorials.videoInProduction", { defaultValue: "Video in production — walkthrough ready" })}
          </span>
        )}
        {resume && (
          <span className="ml-auto inline-flex items-center gap-1 font-bold text-primary">
            {t("tutorials.resume", { defaultValue: "Resume" })} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </button>
  );
}

/* ─── detail ─────────────────────────────────────────────────────────── */

function TutorialDetailView({
  detail,
  loading,
  error,
  progress,
  onBack,
  onOpen,
  onBeat,
  onWalk,
  card,
  sub,
  head,
  chip,
  isLight,
}: {
  detail: TutorialDetail | null;
  loading: boolean;
  error: boolean;
  progress?: TutorialProgress;
  onBack: () => void;
  onOpen: (slug: string) => void;
  onBeat: (tutorialId: string, beat: ProgressBeat) => Promise<void>;
  onWalk: (route: string) => void;
  card: string;
  sub: string;
  head: string;
  chip: string;
  isLight: boolean;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastReportedRef = useRef(0);

  const scrollToWatch = () => {
    document.getElementById("tut-watch")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const seekToChapter = (startSec: number | null, chapterId: string) => {
    const video = videoRef.current;
    if (detail?.video && video && startSec !== null) {
      video.currentTime = startSec;
      void video.play().catch(() => {});
      void onBeat(detail.id, { chapterId, positionSec: startSec });
    } else {
      document.getElementById(`tut-chapter-${chapterId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (detail) void onBeat(detail.id, { chapterId });
    }
  };

  if (loading || (!detail && !error)) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8">
        <BackButton onBack={onBack} sub={sub} />
        <div className={`${card} mt-6 p-6 text-center`}>
          <p className={`text-sm font-semibold ${head}`}>
            {t("tutorials.loadError", { defaultValue: "The tutorials wouldn't load." })}
          </p>
        </div>
      </div>
    );
  }

  const resume = resumeChapter(detail, progress);
  const resumeText = resumeLabel(detail, progress);
  const doneSet = new Set(progress?.completedChapterIds ?? []);
  const levelResources = detail.resources.filter((r) => !r.chapterId);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 md:px-6">
      <BackButton onBack={onBack} sub={sub} />

      <h2 className={`mt-4 text-2xl font-black md:text-3xl ${head}`}>{detail.title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {detail.isOfficial ? (
          <OfficialChip chip={chip} />
        ) : detail.creator ? (
          <Link href={`/artist/${detail.creator.slug}`} className={`rounded-full border px-2 py-0.5 font-semibold hover:border-primary/60 ${chip}`}>
            {t("tutorials.byCreator", { defaultValue: "by {{name}}", name: detail.creator.displayName })}
          </Link>
        ) : null}
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${chip}`}>
          {TUTORIAL_CATEGORY_LABELS[detail.category]}
        </span>
        {progress?.status === "completed" && (
          <span className="inline-flex items-center gap-1 font-bold text-emerald-500">
            <CheckCircle2 className="h-4 w-4" /> {t("tutorials.completed", { defaultValue: "Completed" })}
          </span>
        )}
      </div>
      {detail.description && <p className={`mt-3 text-sm leading-relaxed ${sub}`}>{detail.description}</p>}

      {/* ── The three doors ── */}
      <div className="mt-5 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={scrollToWatch}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-black"
        >
          <Play className="h-4 w-4" /> {t("tutorials.watchIt", { defaultValue: "Watch it" })}
        </button>
        {detail.guideRoute ? (
          <button
            type="button"
            onClick={() => onWalk(detail.guideRoute!)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold ${isLight ? "border-[#C9A84C]/60 text-zinc-800" : "border-primary/40 text-white"}`}
          >
            <Compass className="h-4 w-4 text-primary" /> {t("tutorials.walkMe", { defaultValue: "Walk me through it" })}
          </button>
        ) : <span />}
        {detail.tryRoute ? (
          <Link
            href={detail.tryRoute}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold ${isLight ? "border-[#C9A84C]/60 text-zinc-800" : "border-primary/40 text-white"}`}
          >
            <MousePointerClick className="h-4 w-4 text-primary" /> {t("tutorials.tryItNow", { defaultValue: "Try it now" })}
          </Link>
        ) : <span />}
      </div>

      {/* ── Resume banner ── */}
      {resume && resumeText && (
        <div className={`${card} mt-5 flex flex-wrap items-center gap-3 p-4`}>
          <RotateCcw className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${head}`}>
              {t("tutorials.pickUp", { defaultValue: "Pick up where you left off" })}
            </p>
            <p className={`text-sm ${sub}`}>{resumeText}</p>
          </div>
          <button
            type="button"
            onClick={() => seekToChapter(resume.startSec, resume.id)}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black"
          >
            {t("tutorials.resume", { defaultValue: "Resume" })}
          </button>
        </div>
      )}

      {/* ── Watch ── */}
      <div id="tut-watch" className="mt-6 scroll-mt-24">
        {detail.video ? (
          <video
            ref={videoRef}
            controls
            preload="metadata"
            poster={detail.video.thumbnailUrl ?? undefined}
            src={detail.video.url}
            className="w-full rounded-2xl border border-primary/25 bg-black"
            onLoadedMetadata={(e) => {
              if (progress && progress.lastPositionSec > 5 && progress.status !== "completed") {
                e.currentTarget.currentTime = progress.lastPositionSec;
              }
            }}
            onTimeUpdate={(e) => {
              const now = Math.floor(e.currentTarget.currentTime);
              if (Math.abs(now - lastReportedRef.current) >= 10) {
                lastReportedRef.current = now;
                const chapter = [...detail.chapters]
                  .reverse()
                  .find((c) => c.startSec !== null && c.startSec <= now);
                void onBeat(detail.id, { positionSec: now, chapterId: chapter?.id ?? null });
              }
            }}
            onPause={(e) => {
              void onBeat(detail.id, { positionSec: Math.floor(e.currentTarget.currentTime) });
            }}
            onEnded={() => {
              void onBeat(detail.id, { markCompleted: true });
            }}
          />
        ) : (
          <div className={`${card} p-6 text-center`}>
            <Clapperboard className="mx-auto h-9 w-9 text-primary" />
            <p className={`mt-3 text-base font-bold ${head}`}>
              {t("tutorials.videoInProductionTitle", { defaultValue: "This tutorial's video is in production." })}
            </p>
            <p className={`mx-auto mt-1 max-w-md text-sm ${sub}`}>
              {t("tutorials.videoInProductionNote", {
                defaultValue:
                  "The full walkthrough is written out below — every step, in order. When the video lands, it will play right here.",
              })}
            </p>
          </div>
        )}
      </div>

      {/* ── Chapters ── */}
      {detail.chapters.length > 0 && (
        <section className="mt-8">
          <h3 className={`text-sm font-black uppercase tracking-widest ${sub}`}>
            {t("tutorials.chaptersHeading", { defaultValue: "Chapters" })}
          </h3>
          <div className="mt-3 space-y-3">
            {detail.chapters.map((chapter) => {
              const done = doneSet.has(chapter.id);
              const isResume = resume?.id === chapter.id;
              const chapterResources = detail.resources.filter((r) => r.chapterId === chapter.id);
              return (
                <article
                  key={chapter.id}
                  id={`tut-chapter-${chapter.id}`}
                  className={`${card} scroll-mt-24 p-4 ${isResume ? "ring-1 ring-primary" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void onBeat(detail.id, done ? { uncompleteChapterId: chapter.id } : { completeChapterId: chapter.id })}
                      className="mt-0.5 shrink-0"
                      aria-label={done
                        ? t("tutorials.markNotDone", { defaultValue: "Mark chapter not done" })
                        : t("tutorials.markDone", { defaultValue: "Mark chapter done" })}
                    >
                      {done
                        ? <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                        : <Circle className={`h-6 w-6 ${sub}`} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`text-sm font-bold ${head}`}>
                          {chapter.position}. {chapter.title}
                        </p>
                        {chapter.startSec !== null && (
                          <button
                            type="button"
                            onClick={() => seekToChapter(chapter.startSec, chapter.id)}
                            className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary"
                          >
                            {formatTimestamp(chapter.startSec)}
                          </button>
                        )}
                      </div>
                      {chapter.body && (
                        <p className={`mt-1.5 text-sm leading-relaxed ${sub}`}>{chapter.body}</p>
                      )}
                      {chapterResources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {chapterResources.map((r) => (
                            <ResourceLink key={r.id} resource={r} chip={chip} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {detail.chapters.every((c) => doneSet.has(c.id)) && progress?.status !== "completed" && (
            <p className={`mt-3 text-sm font-semibold ${sub}`}>
              {t("tutorials.allChaptersDone", { defaultValue: "Every chapter done — nice work." })}
            </p>
          )}
        </section>
      )}

      {/* Chapter-less tutorials still need a finish line. */}
      {detail.chapters.length === 0 && progress?.status !== "completed" && (
        <button
          type="button"
          onClick={() => void onBeat(detail.id, { markCompleted: true })}
          className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black"
        >
          <CheckCircle2 className="h-4 w-4" /> {t("tutorials.markComplete", { defaultValue: "Mark as complete" })}
        </button>
      )}

      {/* ── Resources ── */}
      {levelResources.length > 0 && (
        <section className="mt-8">
          <h3 className={`text-sm font-black uppercase tracking-widest ${sub}`}>
            {t("tutorials.resourcesHeading", { defaultValue: "Downloads & links" })}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {levelResources.map((r) => (
              <ResourceLink key={r.id} resource={r} chip={chip} />
            ))}
          </div>
        </section>
      )}

      {/* ── Transcript ── */}
      {detail.transcript && (
        <section className="mt-8">
          <details className={`${card} p-4`}>
            <summary className={`cursor-pointer text-sm font-bold ${head}`}>
              {t("tutorials.transcriptHeading", { defaultValue: "Transcript" })}
            </summary>
            <pre className={`mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed ${sub}`}>
              {detail.transcript}
            </pre>
          </details>
        </section>
      )}

      {/* ── Next ── */}
      {detail.next && (
        <button
          type="button"
          onClick={() => onOpen(detail.next!.slug)}
          className={`${card} mt-8 flex w-full items-center gap-3 p-4 text-left transition hover:border-primary/60`}
        >
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-bold uppercase tracking-widest ${sub}`}>
              {t("tutorials.nextUp", { defaultValue: "Next up" })}
            </p>
            <p className={`mt-0.5 truncate text-base font-bold ${head}`}>{detail.next.title}</p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
        </button>
      )}
    </div>
  );
}

function BackButton({ onBack, sub }: { onBack: () => void; sub: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onBack}
      className={`inline-flex items-center gap-1.5 text-sm font-bold ${sub} hover:text-primary`}
    >
      <ArrowLeft className="h-4 w-4" /> {t("tutorials.backToAll", { defaultValue: "All tutorials" })}
    </button>
  );
}

function ResourceLink({ resource, chip }: { resource: TutorialDetail["resources"][number]; chip: string }) {
  const Icon = resource.kind === "download" ? Download : Link2;
  return (
    <a
      href={resource.url}
      target={resource.url.startsWith("/") ? undefined : "_blank"}
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold hover:border-primary/60 ${chip}`}
    >
      <Icon className="h-3.5 w-3.5 text-primary" /> {resource.title}
    </a>
  );
}
