import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import {
  Wallet, Loader2, AlertTriangle, Target, CheckCircle2, Circle,
  Plus, Trash2, TrendingUp, PiggyBank, ListChecks,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import {
  fmtPlanMoney, fmtPlanMoneyShort, trackerProgress, parseGoalCents,
  type PlanNumbersDto, type CoachActionItemDto,
} from "@/lib/coach-tracker";

/* ─── Action Tracker panel (mounted INSIDE the /coach page as a tab) ────
   The persistent half of the coach: plan numbers computed server-side
   from the creator's OWN money ledger + platform earnings
   (GET /api/coach/plan-numbers), a typed monthly income goal
   (PUT /api/coach/goal), and checkable action items saved from a plan
   or typed by hand (/api/coach/action-items). Free endpoints — no
   credits move here; the paid plan build lives on the Money Plan tab. */

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const sectionTitle =
  "mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80";

const cardCls = (isLight: boolean) =>
  `rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`;

export default function ActionTrackerPanel() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [numbers, setNumbers] = useState<PlanNumbersDto | null>(null);
  const [items, setItems] = useState<CoachActionItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [goalInput, setGoalInput] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalMsg, setGoalMsg] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [numRes, itemRes] = await Promise.all([
        confirmedFetch("/api/coach/plan-numbers", { skipConfirm: true }),
        confirmedFetch("/api/coach/action-items", { skipConfirm: true }),
      ]);
      if (!numRes || !itemRes) return;
      const numData = (await numRes.json().catch(() => ({}))) as PlanNumbersDto & { error?: string };
      if (!numRes.ok) throw new Error(numData.error || t("coachTracker.errorLoad", { defaultValue: "Couldn't load your tracker — try again." }));
      const itemData = (await itemRes.json().catch(() => ({}))) as { items?: CoachActionItemDto[]; error?: string };
      if (!itemRes.ok) throw new Error(itemData.error || t("coachTracker.errorLoad", { defaultValue: "Couldn't load your tracker — try again." }));
      setNumbers(numData);
      setItems(Array.isArray(itemData.items) ? itemData.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("coachTracker.errorLoad", { defaultValue: "Couldn't load your tracker — try again." }));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveGoal(cents: number | null) {
    if (goalSaving) return;
    setGoalSaving(true);
    setGoalMsg(null);
    try {
      const res = await confirmedFetch("/api/coach/goal", {
        skipConfirm: true,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyGoalCents: cents }),
      });
      if (!res) return;
      if (!res.ok) throw new Error(t("coachTracker.errorGoal", { defaultValue: "Couldn't save your goal — try again." }));
      setGoalInput("");
      setGoalMsg(
        cents == null
          ? t("coachTracker.goalCleared", { defaultValue: "Goal cleared." })
          : t("coachTracker.goalSaved", { defaultValue: "Goal saved — your plan numbers now measure against it." }),
      );
      await load();
    } catch (err) {
      setGoalMsg(err instanceof Error ? err.message : t("coachTracker.errorGoal", { defaultValue: "Couldn't save your goal — try again." }));
    } finally {
      setGoalSaving(false);
    }
  }

  async function toggleItem(item: CoachActionItemDto) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const res = await confirmedFetch(`/api/coach/action-items/${item.id}`, {
        skipConfirm: true,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !item.done }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as { item?: CoachActionItemDto; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error || "Update failed.");
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item! : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function addItem() {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      const res = await confirmedFetch("/api/coach/action-items", {
        skipConfirm: true,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, source: "custom" }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as { items?: CoachActionItemDto[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Save failed.");
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setNewTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setAdding(false);
    }
  }

  async function deleteItem(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await confirmedFetch(`/api/coach/action-items/${id}`, { skipConfirm: true, method: "DELETE" });
      if (!res) return;
      if (!res.ok) throw new Error("Delete failed.");
      setItems((prev) => prev.filter((i) => i.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!user) {
    return (
      <div className={`mt-8 ${cardCls(isLight)} p-10 text-center`}>
        <ListChecks className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
        <p className="mt-4 text-sm text-white/60">
          {t("coachTracker.signInPrompt", { defaultValue: "Sign in to see your plan numbers and action tracker." })}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`mt-8 flex items-center justify-center gap-2 ${cardCls(isLight)} p-12 text-sm`}>
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        {t("coachTracker.loading", { defaultValue: "Reading your numbers…" })}
      </div>
    );
  }

  const progress = trackerProgress(items);
  const goal = numbers?.goal ?? null;

  return (
    <div className="mt-8">
      {error && (
        <div className="mb-6 rounded-3xl border border-red-500/30 bg-red-500/[0.06] p-6 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-red-400" aria-hidden="true" />
          <p className="mt-2 text-sm text-white/70">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
          >
            {t("coachTracker.retry", { defaultValue: "Retry" })}
          </button>
        </div>
      )}

      {/* ── YOUR NUMBERS ─────────────────────────────────────────────── */}
      <p className={sectionTitle}>
        <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
        {t("coachTracker.numbersTitle", { defaultValue: "Your numbers — straight from your books" })}
      </p>
      {numbers && !numbers.hasData ? (
        <div className={`${cardCls(isLight)} text-center`}>
          <Wallet className="mx-auto h-9 w-9 text-white/20" aria-hidden="true" />
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/60">
            {t("coachTracker.notEnoughData", {
              defaultValue:
                "Not enough data yet. Track income in the Money Tracker or earn on the platform and your real run-rate, goal gap, and pace show up here — computed from your numbers, never invented.",
            })}
          </p>
          <p className="mt-3 text-xs text-white/40">
            {t("coachTracker.catalogSoFar", {
              defaultValue: "What your coach can already see: {{songs}} songs · {{releases}} releases · {{products}} store products",
              songs: numbers.platform.songs,
              releases: numbers.platform.releases,
              products: numbers.platform.storeProducts,
            })}
          </p>
        </div>
      ) : numbers ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className={cardCls(isLight)}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("coachTracker.thisMonth", { defaultValue: "This month (tracked)" })}
              </p>
              <p className="mt-2 font-display text-2xl font-black text-emerald-300">{fmtPlanMoney(numbers.currentMonth.incomeCents)}</p>
              <p className="mt-1 text-xs text-white/45">
                {t("coachTracker.netLine", { defaultValue: "Net {{amount}}", amount: fmtPlanMoney(numbers.currentMonth.netCents) })}
              </p>
            </div>
            <div className={cardCls(isLight)}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("coachTracker.avgMonth", { defaultValue: "Average month" })}
              </p>
              {numbers.trailing.avgMonthlyIncomeCents != null ? (
                <>
                  <p className="mt-2 font-display text-2xl font-black text-white">{fmtPlanMoney(numbers.trailing.avgMonthlyIncomeCents)}</p>
                  <p className="mt-1 text-xs text-white/45">
                    {t("coachTracker.avgMonthsNote", {
                      defaultValue: "Across your last {{count}} tracked months · net {{amount}}/mo",
                      count: numbers.trailing.monthsCounted,
                      amount: fmtPlanMoney(numbers.trailing.avgMonthlyNetCents ?? 0),
                    })}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  {t("coachTracker.noFullMonth", { defaultValue: "No complete tracked month yet — your average lands after your first full month." })}
                </p>
              )}
            </div>
            <div className={cardCls(isLight)}>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                <PiggyBank className="h-3.5 w-3.5" aria-hidden="true" />
                {t("coachTracker.platformEarnings", { defaultValue: "Earned on Bow Down Visuals" })}
              </p>
              <p className="mt-2 font-display text-2xl font-black text-primary">{fmtPlanMoney(numbers.platform.earningsCents)}</p>
              <p className="mt-1 text-xs text-white/45">
                {numbers.platform.tipsVb > 0
                  ? t("coachTracker.tipsLine", { defaultValue: "Plus {{vb}} Visual Bucs in stream tips", vb: numbers.platform.tipsVb.toLocaleString("en-US") })
                  : t("coachTracker.allTimeLedger", { defaultValue: "Tracked all-time net: {{amount}}", amount: fmtPlanMoney(numbers.allTimeLedger.netCents) })}
              </p>
            </div>
          </div>

          {/* ── GOAL ─────────────────────────────────────────────────── */}
          <div className={`mt-3 ${cardCls(isLight)}`}>
            <p className={sectionTitle}>
              <Target className="h-3.5 w-3.5" aria-hidden="true" />
              {t("coachTracker.goalTitle", { defaultValue: "Monthly income goal" })}
            </p>
            {goal ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-3xl font-black text-white">{fmtPlanMoneyShort(goal.monthlyGoalCents)}<span className="text-base text-white/40">/mo</span></p>
                  {goal.met ? (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">
                      {t("coachTracker.goalMet", { defaultValue: "Your average month already clears it" })}
                    </span>
                  ) : goal.percentOfGoal != null ? (
                    <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                      {t("coachTracker.goalPct", { defaultValue: "{{pct}}% of goal", pct: goal.percentOfGoal })}
                    </span>
                  ) : null}
                </div>
                {goal.percentOfGoal != null && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300"
                      style={{ width: `${Math.min(100, Math.max(0, goal.percentOfGoal))}%` }}
                    />
                  </div>
                )}
                <p className="mt-3 text-sm leading-relaxed text-white/65">
                  {goal.met
                    ? t("coachTracker.goalMetBody", { defaultValue: "Your trailing average month is at or past this goal. Raise it when you're ready for the next rung." })
                    : goal.monthlyGapCents != null
                      ? t("coachTracker.goalGapBody", {
                          defaultValue: "Gap: {{gap}} more per month. At your current net pace, banking one month at goal takes about {{months}} months of net.",
                          gap: fmtPlanMoney(goal.monthlyGapCents),
                          months: goal.monthsOfNetToBankGoalMonth ?? "—",
                        })
                      : t("coachTracker.goalNoPace", { defaultValue: "Once a full tracked month lands, this shows your gap and pace against the goal." })}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <input
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    inputMode="decimal"
                    placeholder={t("coachTracker.goalNewPlaceholder", { defaultValue: "New goal — $ per month" })}
                    className={`${inputClass} max-w-[220px] !py-2.5`}
                    aria-label={t("coachTracker.goalTitle", { defaultValue: "Monthly income goal" })}
                  />
                  <button
                    onClick={() => {
                      const cents = parseGoalCents(goalInput);
                      if (cents == null) {
                        setGoalMsg(t("coachTracker.goalInvalid", { defaultValue: "Enter a goal above $0." }));
                        return;
                      }
                      saveGoal(cents);
                    }}
                    disabled={goalSaving}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
                  >
                    {goalSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : t("coachTracker.goalUpdate", { defaultValue: "Update goal" })}
                  </button>
                  <button
                    onClick={() => saveGoal(null)}
                    disabled={goalSaving}
                    className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/60 transition hover:text-white disabled:opacity-50"
                  >
                    {t("coachTracker.goalClear", { defaultValue: "Clear" })}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-white/60">
                  {t("coachTracker.goalPrompt", { defaultValue: "Set the monthly income you're aiming for. Your plan numbers measure your real run-rate against it — gap, pace, and all." })}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <input
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    inputMode="decimal"
                    placeholder={t("coachTracker.goalPlaceholder", { defaultValue: "$ per month — e.g. 1500" })}
                    className={`${inputClass} max-w-[220px] !py-2.5`}
                    aria-label={t("coachTracker.goalTitle", { defaultValue: "Monthly income goal" })}
                  />
                  <button
                    onClick={() => {
                      const cents = parseGoalCents(goalInput);
                      if (cents == null) {
                        setGoalMsg(t("coachTracker.goalInvalid", { defaultValue: "Enter a goal above $0." }));
                        return;
                      }
                      saveGoal(cents);
                    }}
                    disabled={goalSaving}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
                  >
                    {goalSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : t("coachTracker.goalSet", { defaultValue: "Set my goal" })}
                  </button>
                </div>
              </>
            )}
            {goalMsg && <p className="mt-3 text-xs font-semibold text-primary/90">{goalMsg}</p>}
          </div>
        </>
      ) : null}

      {/* ── ACTION ITEMS ───────────────────────────────────────────── */}
      <p className={`${sectionTitle} mt-8`}>
        <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
        {t("coachTracker.itemsTitle", { defaultValue: "Action tracker" })}
        {progress.total > 0 && (
          <span className="ml-auto text-white/45 normal-case tracking-normal">
            {t("coachTracker.progress", { defaultValue: "{{done}} of {{total}} done", done: progress.done, total: progress.total })}
          </span>
        )}
      </p>
      {progress.total > 0 && (
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all" style={{ width: `${progress.pct}%` }} />
        </div>
      )}
      <div className={cardCls(isLight)}>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-white/50">
            {t("coachTracker.itemsEmpty", {
              defaultValue: "Nothing tracked yet. Build a money plan and save its moves here — or add your own below. They'll still be here when you come back.",
            })}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <button
                  onClick={() => toggleItem(item)}
                  disabled={busyId === item.id}
                  aria-label={item.done ? "Mark not done" : "Mark done"}
                  className="shrink-0 text-primary transition hover:scale-110 disabled:opacity-50"
                >
                  {busyId === item.id ? (
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                  ) : item.done ? (
                    <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                  ) : (
                    <Circle className="h-6 w-6 text-white/30" aria-hidden="true" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${item.done ? "text-white/40 line-through" : "text-white"}`}>{item.title}</p>
                  <p className="text-[11px] text-white/35">
                    {item.source === "plan"
                      ? t("coachTracker.sourcePlan", { defaultValue: "From your money plan" })
                      : item.source === "niche"
                        ? t("coachTracker.sourceNiche", { defaultValue: "From your niche analysis" })
                        : t("coachTracker.sourceCustom", { defaultValue: "Added by you" })}
                    {item.done && item.completedAt
                      ? ` · ${t("coachTracker.doneOn", { defaultValue: "done {{date}}", date: new Date(item.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) })}`
                      : ""}
                  </p>
                </div>
                {confirmDeleteId === item.id ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => deleteItem(item.id)}
                      disabled={busyId === item.id}
                      className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                    >
                      {t("coachTracker.confirmDelete", { defaultValue: "Remove" })}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-bold text-white/60 transition hover:text-white"
                    >
                      {t("coachTracker.cancelDelete", { defaultValue: "Keep" })}
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(item.id)}
                    aria-label={t("coachTracker.deleteItem", { defaultValue: "Remove item" })}
                    className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-red-500/50 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
            }}
            maxLength={300}
            placeholder={t("coachTracker.addPlaceholder", { defaultValue: "Add your own move — e.g. Pitch three podcasts this week" })}
            className={`${inputClass} !py-2.5`}
            aria-label={t("coachTracker.addLabel", { defaultValue: "New action item" })}
          />
          <button
            onClick={addItem}
            disabled={adding || !newTitle.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {t("coachTracker.add", { defaultValue: "Add" })}
          </button>
        </div>
      </div>
    </div>
  );
}
