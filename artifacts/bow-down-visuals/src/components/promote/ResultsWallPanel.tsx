import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, BadgeCheck, Eye, EyeOff, Loader2, RefreshCw, RotateCcw, Trophy,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  EXAMPLE_WALL_EVENTS,
  RESULTS_WALL_KIND_LABELS,
  RESULTS_WALL_KINDS,
  RESULTS_WALL_SOURCE_LABELS,
  milestoneHeadline,
  shapeWallForDisplay,
  type MyResultsState,
  type ResultsWallKind,
  type WallEventWire,
} from "@/lib/results-wall";

/* ─── Results Wall (Stack-200, dedupe audit #177 — TRULY NEW) ────────────
   Docked in Promote — never a standalone page, never a sidebar item.
   This panel is the wall's only public screen plus the creator's own
   opt-in controls, in the flow where promotion already lives.

   HONESTY LAW on screen:
   - Every card is an event the API derived from the platform's own
     records (sales / follows / VB ledger / weekly chart). The panel has
     NO create/edit affordance for a number — none exists anywhere.
   - Creators appear ONLY if they opted in (server-side gate); the
     "Your results" section below is where that switch lives, next to
     per-kind hide switches. Turning off removes the creator at the
     server's next read — revocation is instant, not cached here.
   - When the wall is empty, one EXAMPLE card (Thy Cheat Code, the real
     official account) shows the shape of a result, badged EXAMPLE so it
     can never be mistaken for a real milestone.
   - Earnings are Visual Bucs only — no cash, no conversion, anywhere. */

type LoadState = "loading" | "ready" | "error" | "not-ready";

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function EventCard({ event, example = false }: { event: WallEventWire; example?: boolean }) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const headline = milestoneHeadline(event);
  if (!headline) return null;
  return (
    <div
      className={`relative rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/35 bg-white/60" : "border-white/10 bg-black/40"}`}
      data-testid={example ? "results-wall-example-card" : "results-wall-card"}
    >
      {example && (
        <span className="absolute right-4 top-4 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-500">
          {t("resultsWall.exampleBadge", { defaultValue: "Example" })}
        </span>
      )}
      <div className="flex items-start gap-3.5">
        {event.creator.avatarUrl ? (
          <img
            src={event.creator.avatarUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
            {event.creator.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <Link
            href={`/artist/${event.creator.slug}`}
            className={`font-bold hover:text-primary ${isLight ? "text-[#2A1E07]" : "text-white"}`}
          >
            {event.creator.displayName}
          </Link>
          <p className={`mt-0.5 text-[15px] font-semibold leading-snug ${isLight ? "text-[#2A1E07]" : "text-white/90"}`}>
            {headline}
          </p>
          <p className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
            <span className="inline-flex items-center gap-1 font-semibold text-primary">
              <BadgeCheck className="h-3.5 w-3.5" />
              {t("resultsWall.verified", { defaultValue: "Platform verified" })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{RESULTS_WALL_SOURCE_LABELS[event.detail.source]}</span>
            <span aria-hidden="true">·</span>
            <span>{fmtDate(event.occurredAt)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function YourResults() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>("loading");
  const [me, setMe] = useState<MyResultsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setState("loading");
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/results-wall/me", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 503) { setState("not-ready"); return; }
      if (!res.ok) throw new Error("load failed");
      setMe((await res.json()) as MyResultsState);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [user, getAccessToken]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  if (!user) return null;

  async function authedFetch(path: string, init: RequestInit) {
    const token = await getAccessToken();
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  async function toggleOptIn(next: boolean) {
    if (!me || saving) return;
    const prev = me;
    setMe({ ...me, prefs: { ...me.prefs, optedIn: next } });
    setSaving(true);
    try {
      const res = await authedFetch("/api/results-wall/opt-in", {
        method: "PUT",
        body: JSON.stringify({ optedIn: next }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = (await res.json()) as { prefs: MyResultsState["prefs"] };
      setMe((cur) => (cur ? {
        ...cur,
        prefs: d.prefs,
        events: cur.events.map((e) => ({
          ...e,
          visibleOnWall: d.prefs.optedIn && !d.prefs.hiddenKinds.includes(e.kind),
        })),
      } : cur));
      toast({
        title: next
          ? t("resultsWall.optedInSaved", { defaultValue: "You're on the Results Wall" })
          : t("resultsWall.optedOutSaved", { defaultValue: "You're off the Results Wall" }),
      });
    } catch {
      setMe(prev);
      toast({ title: t("resultsWall.saveFailed", { defaultValue: "That switch didn't save. Give it another shot." }), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleKind(kind: ResultsWallKind, show: boolean) {
    if (!me || saving) return;
    const prev = me;
    const hiddenKinds = show
      ? me.prefs.hiddenKinds.filter((k) => k !== kind)
      : Array.from(new Set([...me.prefs.hiddenKinds, kind]));
    setMe({
      ...me,
      prefs: { ...me.prefs, hiddenKinds },
      events: me.events.map((e) => ({
        ...e,
        visibleOnWall: e.kind === kind ? me.prefs.optedIn && show : e.visibleOnWall,
      })),
    });
    setSaving(true);
    try {
      const res = await authedFetch("/api/results-wall/visibility", {
        method: "PUT",
        body: JSON.stringify({ hiddenKinds }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = (await res.json()) as { prefs: MyResultsState["prefs"] };
      setMe((cur) => (cur ? { ...cur, prefs: d.prefs } : cur));
    } catch {
      setMe(prev);
      toast({ title: t("resultsWall.saveFailed", { defaultValue: "That switch didn't save. Give it another shot." }), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function scanNow() {
    if (scanning) return;
    setScanning(true);
    try {
      const res = await authedFetch("/api/results-wall/scan", { method: "POST" });
      if (!res.ok) throw new Error("scan failed");
      const d = (await res.json()) as MyResultsState & { scan?: { recorded: number } };
      setMe(d);
      toast({
        title: d.scan && d.scan.recorded > 0
          ? t("resultsWall.scanFound", { defaultValue: "{{count}} new verified milestone(s) recorded", count: d.scan.recorded })
          : t("resultsWall.scanNone", { defaultValue: "Checked — no new milestones yet" }),
      });
    } catch {
      toast({ title: t("resultsWall.scanFailed", { defaultValue: "The check didn't go through. Give it another shot." }), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }

  const shell = isLight
    ? "border-[#C9A84C]/35 bg-white/50"
    : "border-white/10 bg-black/30";
  const heading = isLight ? "text-[#2A1E07]" : "text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <div className={`mt-8 rounded-2xl border p-5 md:p-6 ${shell}`} data-testid="results-wall-your-results">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className={`text-base font-black ${heading}`}>
          {t("resultsWall.yoursTitle", { defaultValue: "Your results" })}
        </h3>
        {state === "ready" && me?.hasProfile && (
          <button
            type="button"
            onClick={() => void scanNow()}
            disabled={scanning}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("resultsWall.scanCta", { defaultValue: "Check my records now" })}
          </button>
        )}
      </div>

      {state === "loading" && (
        <p className={`mt-3 inline-flex items-center gap-2 text-sm ${muted}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("resultsWall.loadingYours", { defaultValue: "Loading your results…" })}
        </p>
      )}

      {state === "not-ready" && (
        <p className={`mt-3 text-sm ${muted}`}>
          {t("resultsWall.notReady", { defaultValue: "The Results Wall isn't switched on for this server yet — check back soon." })}
        </p>
      )}

      {state === "error" && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("resultsWall.loadYoursError", { defaultValue: "Your results wouldn't load just now." })}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("resultsWall.retry", { defaultValue: "Try again" })}
          </button>
        </div>
      )}

      {state === "ready" && me && !me.hasProfile && (
        <p className={`mt-3 text-sm ${muted}`}>
          {t("resultsWall.noProfile", { defaultValue: "Your results live on your creator profile." })}{" "}
          <Link href="/artist-setup" className="font-bold text-primary hover:underline">
            {t("resultsWall.noProfileCta", { defaultValue: "Create your profile" })}
          </Link>
        </p>
      )}

      {state === "ready" && me && me.hasProfile && (
        <>
          <div className="mt-4 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold ${heading}`}>
                {t("resultsWall.optInTitle", { defaultValue: "Show my verified results on the wall" })}
              </p>
              <p className={`mt-0.5 text-xs leading-relaxed ${muted}`}>
                {t("resultsWall.optInDesc", {
                  defaultValue:
                    "Off by default. When on, only milestones the platform itself verified — sales, followers, Visual Bucs earned, chart placements — can appear under your name. Turn it off and you come off the wall right away.",
                })}
              </p>
            </div>
            <Switch
              checked={me.prefs.optedIn}
              disabled={saving}
              onCheckedChange={(v: boolean) => void toggleOptIn(v)}
              aria-label={t("resultsWall.optInTitle", { defaultValue: "Show my verified results on the wall" })}
            />
          </div>

          {me.prefs.optedIn && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {RESULTS_WALL_KINDS.map((kind) => {
                const shown = !me.prefs.hiddenKinds.includes(kind);
                return (
                  <div key={kind} className="flex items-center gap-3 py-1.5">
                    <span className={shown ? "text-primary" : muted}>
                      {shown ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </span>
                    <span className={`min-w-0 flex-1 text-sm ${heading}`}>{RESULTS_WALL_KIND_LABELS[kind]}</span>
                    <Switch
                      checked={shown}
                      disabled={saving}
                      onCheckedChange={(v: boolean) => void toggleKind(kind, v)}
                      aria-label={RESULTS_WALL_KIND_LABELS[kind]}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {me.events.length === 0 ? (
            <p className={`mt-4 text-sm ${muted}`}>
              {t("resultsWall.noMilestonesYet", {
                defaultValue:
                  "No verified milestones yet. Your first sale, follower milestones, Visual Bucs earned and chart placements land here the moment the platform's own records cross the line — nothing is typed in, ever.",
              })}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {me.events.map((e) => (
                <li
                  key={e.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm ${isLight ? "border-[#C9A84C]/25 bg-white/50" : "border-white/[0.07] bg-white/[0.02]"}`}
                >
                  <span className={`font-semibold ${heading}`}>{milestoneHeadline(e)}</span>
                  <span className={muted}>{fmtDate(e.occurredAt)}</span>
                  <span
                    className={`ml-auto inline-flex items-center gap-1 text-xs font-bold ${e.visibleOnWall ? "text-emerald-500" : muted}`}
                  >
                    {e.visibleOnWall ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {e.visibleOnWall
                      ? t("resultsWall.onWall", { defaultValue: "On the wall" })
                      : t("resultsWall.onlyYou", { defaultValue: "Only you see this" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function ResultsWallPanel() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>("loading");
  const [events, setEvents] = useState<WallEventWire[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState("loading");
      try {
        const res = await fetch("/api/results-wall?limit=50");
        if (res.status === 503) { if (!cancelled) setState("not-ready"); return; }
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as { events?: unknown };
        if (cancelled) return;
        setEvents(shapeWallForDisplay(d.events));
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [retryNonce]);

  return (
    <section
      id="results-wall"
      className={`rounded-2xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="results-wall-panel"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Trophy className="h-5 w-5" />
        </span>
        <div>
          <h2 className={`text-xl font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("resultsWall.title", { defaultValue: "Results Wall" })}
          </h2>
          <p className={`mt-0.5 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {t("resultsWall.subtitle", {
              defaultValue:
                "Real creator outcomes, verified by the platform itself — first sales, chart placements, follower and Visual Bucs milestones. Creators choose to appear; nothing here is typed in, estimated or borrowed.",
            })}
          </p>
        </div>
      </div>

      {state === "loading" && (
        <p className={`mt-6 inline-flex items-center gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("resultsWall.loading", { defaultValue: "Loading verified results…" })}
        </p>
      )}

      {state === "not-ready" && (
        <p className={`mt-6 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          {t("resultsWall.notReady", { defaultValue: "The Results Wall isn't switched on for this server yet — check back soon." })}
        </p>
      )}

      {state === "error" && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("resultsWall.loadError", { defaultValue: "The Results Wall wouldn't load just now." })}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("resultsWall.retry", { defaultValue: "Try again" })}
          </button>
        </div>
      )}

      {state === "ready" && events.length === 0 && (
        <div className="mt-6">
          <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {t("resultsWall.empty", {
              defaultValue:
                "No verified results on the wall yet. The first creators to opt in and cross a milestone — a first sale, a chart placement, a follower milestone — will appear here, proven by the platform's own records.",
            })}
          </p>
          <div className="mt-4">
            {EXAMPLE_WALL_EVENTS.map((e) => (
              <EventCard key={e.id} event={e} example />
            ))}
          </div>
        </div>
      )}

      {state === "ready" && events.length > 0 && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}

      {user ? (
        <YourResults />
      ) : (
        state === "ready" && (
          <p className={`mt-6 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("resultsWall.signInPrompt", { defaultValue: "Signed-in creators can opt in below their own verified milestones — " })}
            <Link href="/login" className="font-bold text-primary hover:underline">
              {t("resultsWall.signInCta", { defaultValue: "Sign in to see yours" })}
            </Link>
          </p>
        )
      )}
    </section>
  );
}
