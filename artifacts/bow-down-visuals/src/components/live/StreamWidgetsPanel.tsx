import { useEffect, useState } from "react";
import { Loader2, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import { formatBucs } from "@/lib/visual-bucs";
import { setWidgetData, resetWidgetData, type WidgetData } from "@/lib/stream-kit/widget-data";

/* ─── Stream widgets panel ────────────────────────────────────────────────
   The studio side of the overlay widgets: the real numbers behind
   the three scene sources (latest follower, tip ticker, tip goal),
   refreshed while live, plus the goal setter. Empty states are
   honest — "No tips yet" here, and on the Program feed those same
   widgets simply don't draw until there's something real to show.
   Add the widgets themselves from Scenes & sources → Stream Widget. */

type LoadState = "idle" | "loading" | "ready" | "error";

export default function StreamWidgetsPanel({ streamId }: { streamId: string | null }) {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<WidgetData | null>(null);
  const [load, setLoad] = useState<LoadState>("idle");
  const [goalInput, setGoalInput] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!streamId) {
      setData(null);
      setLoad("idle");
      resetWidgetData();
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const loadOnce = async () => {
      try {
        const res = await fetch(`/api/live/${streamId}/widgets`);
        if (!res.ok) throw new Error("widgets failed");
        const json = (await res.json()) as WidgetData;
        if (cancelled) return;
        setData(json);
        setWidgetData(json);
        setLoad("ready");
        setGoalInput(json.goal.goalVb ? String(json.goal.goalVb) : "");
      } catch {
        if (!cancelled) setLoad("error");
      }
    };
    setLoad("loading");
    void loadOnce();
    timer = setInterval(() => void loadOnce(), 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [streamId]);

  async function saveGoal() {
    if (!streamId || savingGoal) return;
    const parsed = goalInput.trim() === "" ? null : Number(goalInput);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
      setNote("A goal is a whole number of Visual Bucs — or leave it blank to clear it.");
      return;
    }
    setSavingGoal(true);
    setNote(null);
    try {
      const res = await apiFetch(getAccessToken, `/api/live/${streamId}/tip-goal`, {
        method: "POST",
        body: JSON.stringify({ goalVb: parsed }),
      });
      const json = await res.json().catch(() => null);
      if (res.status !== 200) throw new Error((json?.error as string) ?? "goal failed");
      setNote(parsed ? `Goal set — the goal bar tracks tips toward ${formatBucs(parsed)}.` : "Goal cleared.");
      // Refresh so the bar + numbers reflect the saved goal at once.
      const w = await fetch(`/api/live/${streamId}/widgets`);
      if (w.ok) {
        const dto = (await w.json()) as WidgetData;
        setData(dto);
        setWidgetData(dto);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That goal couldn't be saved. Try again.");
    }
    setSavingGoal(false);
  }

  return (
    <section
      data-dark-lock
      className="rounded-2xl border border-[#C9A84C]/25 bg-[#0d0a04] p-4 text-white"
      data-testid="stream-widgets-panel"
    >
      <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-[#fbbf24]">
        <Target className="h-4 w-4" /> Widgets
      </h3>
      <p className="mt-1 text-xs text-white/50">
        Add these to a scene from Scenes &amp; sources → Stream Widget. They draw only real stream data — with
        nothing to show, they stay invisible on your feed.
      </p>

      {!streamId && (
        <p className="mt-3 text-sm text-white/45" data-testid="widgets-idle">
          Widgets wake up when you go live.
        </p>
      )}
      {streamId && load === "loading" && !data && (
        <p className="mt-3 flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" /> Loading widget data…
        </p>
      )}
      {streamId && load === "error" && (
        <p className="mt-3 text-sm font-bold text-amber-200" data-testid="widgets-error">
          Widget data couldn&rsquo;t load — the widgets stay hidden until it&rsquo;s back.
        </p>
      )}
      {streamId && data && (
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-white/50">Latest follower</dt>
            <dd className="font-bold" data-testid="widget-latest-follower">
              {data.latestFollower ? data.latestFollower.displayName : "No followers yet"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-white/50">Tips this stream</dt>
            <dd className="font-bold" data-testid="widget-tips-total">
              {data.goal.tipCount > 0 ? `${formatBucs(data.goal.totalVb)} across ${data.goal.tipCount} tip${data.goal.tipCount === 1 ? "" : "s"}` : "No tips yet"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-white/50">Tip goal</dt>
            <dd className="font-bold" data-testid="widget-goal">
              {data.goal.goalVb ? `${formatBucs(data.goal.totalVb)} of ${formatBucs(data.goal.goalVb)}` : "No goal set"}
            </dd>
          </div>
        </dl>
      )}

      {streamId && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="Goal in Visual Bucs (blank clears)"
            aria-label="Tip goal in Visual Bucs"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/35 focus:border-[#C9A84C]/70 focus:outline-none"
            data-testid="widget-goal-input"
          />
          <button
            type="button"
            onClick={() => void saveGoal()}
            disabled={savingGoal}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-black transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="widget-goal-save"
          >
            {savingGoal ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save goal
          </button>
        </div>
      )}
      {note && (
        <p className="mt-2 text-xs font-semibold text-amber-200/90" role="alert">
          {note}
        </p>
      )}
    </section>
  );
}
