import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  MapPin, Loader2, Sparkles, Plus, Pencil, Trash2, X, Route,
  Wallet, CheckCircle2, Circle, CalendarDays, ChevronDown, ChevronUp,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  showDateLabel,
  showDateTimeLabel,
  datetimeLocalToIso,
  isoToDatetimeLocal,
  sortDatesChronologically,
  daysUntil,
  formatMoney,
  totalMiles,
  validateTourDateForm,
  loadTourPlan,
  saveTourPlan,
  clearTourPlan,
  buildPromoChecklist,
} from "@/lib/tour";
import type { TourDate, TourPlan, OptimizedStop } from "@/lib/tour";
import { useTranslation } from "react-i18next";

/* ─── Tour Planner ────────────────────────────────────────────────────────
   Plan tours and live shows:
   - Add / edit / delete tour dates (city, venue, date, notes) — FREE.
   - AI routing + budget estimator: optimal stop order to minimize travel
     plus travel/lodging/venue/crew/food/contingency budget — 3 credits.
   - Promo checklist per city with links to the Content Scheduler.
   Honest framing throughout: routing and budget are AI estimates, not
   guarantees. */

const CREDIT_COST = 3;

const STATUS_LABELS: Record<TourDate["status"], string> = {
  upcoming: "tour.statusUpcoming",
  confirmed: "tour.statusConfirmed",
  completed: "tour.statusCompleted",
  cancelled: "tour.statusCancelled",
};

const TRANSPORTS = [
  { key: "van", labelKey: "tour.transportVan", blurbKey: "tour.transportVanBlurb" },
  { key: "bus", labelKey: "tour.transportBus", blurbKey: "tour.transportBusBlurb" },
  { key: "flights", labelKey: "tour.transportFlights", blurbKey: "tour.transportFlightsBlurb" },
  { key: "mixed", labelKey: "tour.transportMixed", blurbKey: "tour.transportMixedBlurb" },
] as const;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

interface ApiError {
  error?: string;
  message?: string;
}

export default function Tour() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [dates, setDates] = useState<TourDate[]>([]);
  const [loadingDates, setLoadingDates] = useState(true);
  const [plan, setPlan] = useState<TourPlan | null>(null);

  /* composer */
  const [city, setCity] = useState("");
  const [venue, setVenue] = useState("");
  const [showDate, setShowDate] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* optimizer */
  const [homeBase, setHomeBase] = useState("");
  const [transport, setTransport] = useState<(typeof TRANSPORTS)[number]["key"]>("van");
  const [crewSize, setCrewSize] = useState(4);
  const [optimizing, setOptimizing] = useState(false);

  /* ui */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [expandedCity, setExpandedCity] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setPlan(loadTourPlan());
  }, []);

  const fetchDates = useCallback(async () => {
    if (!user) {
      setLoadingDates(false);
      return;
    }
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/tour/dates", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json().catch(() => ({}))) as {
        dates?: TourDate[];
      };
      if (res.ok && Array.isArray(data.dates)) {
        setDates(data.dates);
      }
    } catch {
      /* dates list is a nicety — the page still works */
    } finally {
      setLoadingDates(false);
    }
  }, [user, getAccessToken]);

  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  function resetForm() {
    setCity("");
    setVenue("");
    setShowDate("");
    setNotes("");
    setEditingId(null);
  }

  function startEdit(d: TourDate) {
    setCity(d.city);
    setVenue(d.venue);
    setShowDate(isoToDatetimeLocal(d.show_date));
    setNotes(d.notes ?? "");
    setEditingId(d.id);
    setError(null);
    document.getElementById("tour-composer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveDate() {
    if (saving || !user) return;
    const formError = validateTourDateForm({ city, venue, show_date: showDate });
    if (formError) {
      setError(formError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const payload = {
        city: city.trim(),
        venue: venue.trim(),
        show_date: datetimeLocalToIso(showDate),
        notes: notes.trim(),
      };
      const url = editingId ? `/api/tour/dates/${editingId}` : "/api/tour/dates";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        date?: TourDate;
      } & ApiError;
      if (!res.ok || !data.date) {
        throw new Error(data.message || data.error || t("tour.saveFailed"));
      }
      resetForm();
      await fetchDates();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tour.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDate(id: string) {
    if (deletingId || !user) return;
    setDeletingId(id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/tour/dates/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(data.message || data.error || t("tour.deleteFailed"));
      }
      setDates((prev) => prev.filter((d) => d.id !== id));
      /* Invalidate the cached plan — its stops may reference a deleted date. */
      setPlan(null);
      clearTourPlan();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tour.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  async function optimize() {
    if (optimizing || !user) return;
    if (dates.length < 2) {
      setError(t("tour.needTwoDates"));
      return;
    }
    if (!homeBase.trim()) {
      setError(t("tour.homeBaseRequired"));
      return;
    }
    setOptimizing(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/tour/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          home_base: homeBase.trim(),
          transport,
          crew_size: crewSize,
          date_ids: dates.map((d) => d.id),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<TourPlan> & {
        creditsUsed?: number;
        creditsRemaining?: number;
      } & ApiError;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.stops) || !data.budget) {
        throw new Error(data.message || data.error || t("tour.optimizeFailed"));
      }
      const newPlan: TourPlan = {
        stops: data.stops as OptimizedStop[],
        budget: data.budget,
        routing_notes: data.routing_notes ?? "",
        created_at: new Date().toISOString(),
      };
      setPlan(newPlan);
      saveTourPlan(newPlan);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("tour-plan")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tour.optimizeFailed"));
    } finally {
      setOptimizing(false);
    }
  }

  function toggleCheck(key: string) {
    setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const sorted = sortDatesChronologically(dates);
  const miles = plan ? totalMiles(plan.stops) : 0;

  const budgetRows: Array<{ labelKey: string; value: number }> = plan
    ? [
        { labelKey: "tour.budgetTravel", value: plan.budget.travel },
        { labelKey: "tour.budgetLodging", value: plan.budget.lodging },
        { labelKey: "tour.budgetVenues", value: plan.budget.venues },
        { labelKey: "tour.budgetCrew", value: plan.budget.crew },
        { labelKey: "tour.budgetFood", value: plan.budget.food_per_diem },
        { labelKey: "tour.budgetContingency", value: plan.budget.contingency },
      ]
    : [];

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-5xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <MapPin className="h-3 w-3" aria-hidden="true" />{t("tour.heroBadge")}</p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            {t("tour.heroTitleA")} <span className="text-primary">{t("tour.heroTitleB")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">{t("tour.heroSubtitle")}</p>
        </div>

        {!user && (
          <p className="relative mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-white/55">{t("tour.signInPrompt")}</p>
        )}

        {/* ── composer ─────────────────────────────────────────────── */}
        <div
          id="tour-composer"
          className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <CalendarDays className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">
                {editingId ? t("tour.editDateTitle") : t("tour.addDateTitle")}
              </h2>
              <p className="text-sm text-white/45">{t("tour.composerSub")}</p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tour-city" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">{t("tour.cityLabel")}</label>
              <input
                id="tour-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                maxLength={120}
                placeholder={t("tour.cityPlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="tour-venue" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">{t("tour.venueLabel")}</label>
              <input
                id="tour-venue"
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                maxLength={200}
                placeholder={t("tour.venuePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="tour-date" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">{t("tour.showDateLabel")}</label>
              <input
                id="tour-date"
                type="datetime-local"
                value={showDate}
                onChange={(e) => setShowDate(e.target.value)}
                className={`${inputClass} [color-scheme:dark]`}
              />
            </div>
            <div>
              <label htmlFor="tour-notes" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("tour.notesLabel")} <span className="normal-case text-white/25">{t("tour.optionalNote")}</span>
              </label>
              <input
                id="tour-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                placeholder={t("tour.notesPlaceholder")}
                className={inputClass}
              />
            </div>
          </div>

          {error && (
            <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={saveDate}
              disabled={saving || !user}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{t("tour.saving")}</>
              ) : editingId ? (
                <>
                  <Pencil className="h-5 w-5" aria-hidden="true" />{t("tour.saveChangesFree")}</>
              ) : (
                <>
                  <Plus className="h-5 w-5" aria-hidden="true" />{t("tour.addDateFree")}</>
              )}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 px-6 py-4 text-sm font-bold text-white/70 transition hover:border-white/30 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />{t("tour.cancel")}</button>
            )}
          </div>
        </div>

        {/* ── date list ────────────────────────────────────────────── */}
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <h2 className="text-lg font-bold">{t("tour.yourDates")}{" "}
            <span className="text-sm font-semibold text-white/40">
              ({dates.length})
            </span>
          </h2>
          {loadingDates ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-white/45">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("tour.loadingDates")}</p>
          ) : dates.length === 0 ? (
            <p className="mt-4 text-sm text-white/45">{t("tour.noDates")}</p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {sorted.map((d) => {
                const until = daysUntil(d.show_date);
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">
                        {d.city} <span className="font-semibold text-white/40">· {d.venue}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-white/45">
                        {showDateTimeLabel(d.show_date)}
                        {" · "}
                        <span className="font-semibold text-primary/90">
                          {t(STATUS_LABELS[d.status])}
                        </span>
                        {until >= 0 && d.status !== "cancelled" && (
                          <span className="text-white/35">
                            {" · "}
                            {until === 0 ? t("tour.today") : until === 1 ? t("tour.tomorrow") : t("tour.inDays", { days: until })}
                          </span>
                        )}
                      </p>
                      {d.notes && (
                        <p className="mt-0.5 truncate text-xs text-white/35">{d.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => startEdit(d)}
                        aria-label={t("tour.editCityAria", { city: d.city })}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition hover:border-primary/50 hover:text-primary"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => deleteDate(d.id)}
                        disabled={deletingId === d.id}
                        aria-label={t("tour.deleteCityAria", { city: d.city })}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition hover:border-red-500/50 hover:text-red-300 disabled:opacity-40"
                      >
                        {deletingId === d.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── optimizer ────────────────────────────────────────────── */}
        <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Route className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">{t("tour.optimizerTitle")}</h2>
              <p className="text-sm text-white/45">
                {t("tour.optimizerSub", { cost: CREDIT_COST })}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="tour-home" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">{t("tour.homeBaseLabel")}</label>
              <input
                id="tour-home"
                type="text"
                value={homeBase}
                onChange={(e) => setHomeBase(e.target.value)}
                maxLength={120}
                placeholder={t("tour.homeBasePlaceholder")}
                className={inputClass}
              />
            </div>
            <div data-min-stars="3">
              <label htmlFor="tour-crew" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">{t("tour.crewSizeLabel")}</label>
              <input
                id="tour-crew"
                type="number"
                min={1}
                max={50}
                value={crewSize}
                onChange={(e) => setCrewSize(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className={inputClass}
              />
            </div>
            <div data-min-stars="2" className="sm:col-span-1">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("tour.transportLabel")}</p>
              <div className="grid grid-cols-2 gap-2">
                {TRANSPORTS.map((opt) => {
                  const selected = opt.key === transport;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setTransport(opt.key)}
                      aria-pressed={selected}
                      className={`rounded-xl border p-2.5 text-left transition ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                      }`}
                    >
                      <p className={`text-xs font-bold ${selected ? "text-white" : "text-white/70"}`}>
                        {t(opt.labelKey)}
                      </p>
                      <p className="text-[10px] text-white/35">{t(opt.blurbKey)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            onClick={optimize}
            disabled={optimizing || !user || dates.length < 2}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {optimizing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{t("tour.optimizing")}</>
            ) : (
              <>
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                {t("tour.optimizeButton", { count: dates.length, cost: CREDIT_COST })}
              </>
            )}
          </button>
          {dates.length < 2 && (
            <p className="mt-3 text-center text-xs text-white/35">{t("tour.needTwoDatesUnlock")}</p>
          )}
          <p className="mt-4 text-center text-xs leading-relaxed text-white/35">{t("tour.estimateDisclaimer")}</p>
        </div>

        {outOfCredits && (
          <div className="mt-6">
            <OutOfCredits />
          </div>
        )}

        {/* ── plan results ─────────────────────────────────────────── */}
        {plan && (
          <div id="tour-plan" className="relative mt-8 space-y-8">
            {/* routing */}
            <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xl font-bold">
                  <Route className="h-5 w-5 text-primary" aria-hidden="true" />{t("tour.routeTitle")}</h2>
                <span className="text-xs font-semibold text-white/40">
                  {t("tour.totalMiles", { miles: miles.toLocaleString("en-US") })}
                </span>
              </div>
              {plan.routing_notes && (
                <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-white/65">
                  {plan.routing_notes}
                </p>
              )}
              <ol className="mt-6 space-y-0">
                {plan.stops.map((s, i) => (
                  <li key={s.date_id} className="relative flex gap-4 pb-6 last:pb-0">
                    {i < plan.stops.length - 1 && (
                      <span
                        className="absolute left-[17px] top-10 bottom-0 w-px bg-primary/25"
                        aria-hidden="true"
                      />
                    )}
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-sm font-black text-primary">
                      {s.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white">
                        {s.city} <span className="font-semibold text-white/40">· {s.venue}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-white/45">{showDateLabel(s.show_date)}</p>
                      {s.travel_from_previous && (
                        <p className="mt-1.5 text-xs leading-relaxed text-white/55">
                          {s.travel_from_previous}
                          {s.estimated_travel_miles != null && s.estimated_travel_miles > 0 && (
                            <span className="text-white/35">
                              {" "}· ~{s.estimated_travel_miles.toLocaleString("en-US")} mi
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* budget */}
            <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />{t("tour.budgetTitle")}</h2>
              <p className="mt-1 text-sm text-white/45">{t("tour.budgetSub")}</p>
              <div className="mt-6 space-y-2.5">
                {budgetRows.map((row) => (
                  <div
                    key={row.labelKey}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-3"
                  >
                    <span className="text-sm font-semibold text-white/70">{t(row.labelKey)}</span>
                    <span className="text-sm font-black text-white">
                      {formatMoney(row.value, plan.budget.currency)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/10 px-4 py-4">
                  <span className="text-base font-black text-white">{t("tour.estimatedTotal")}</span>
                  <span className="text-xl font-black text-primary">
                    {formatMoney(plan.budget.total, plan.budget.currency)}
                  </span>
                </div>
              </div>
              {plan.budget.notes.length > 0 && (
                <ul className="mt-5 space-y-1.5">
                  {plan.budget.notes.map((n, i) => (
                    <li key={i} className="text-xs leading-relaxed text-white/45">
                      · {n}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-center text-[11px] text-white/30">
                {t("tour.planGenerated", { date: new Date(plan.created_at).toLocaleString() })}
              </p>
            </div>
          </div>
        )}

        {/* ── promo checklist ──────────────────────────────────────── */}
        {dates.length > 0 && (
          <div className="relative mt-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
            <h2 className="text-lg font-bold">{t("tour.promoTitle")}</h2>
            <p className="mt-1 text-sm text-white/45">{t("tour.promoSub")}</p>
            <div className="mt-5 space-y-3">
              {sorted.map((d) => {
                const expanded = expandedCity === d.id;
                const items = buildPromoChecklist(d.city, showDateLabel(d.show_date));
                const done = items.filter((it) => checkedItems[`${d.id}:${it.id}`]).length;
                return (
                  <div
                    key={d.id}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-black/40"
                  >
                    <button
                      onClick={() => setExpandedCity(expanded ? null : d.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.02]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-white">
                          {d.city} <span className="font-semibold text-white/40">· {d.venue}</span>
                        </span>
                        <span className="block text-xs text-white/40">
                          {showDateLabel(d.show_date)} · {t("tour.doneCount", { done, total: items.length })}
                        </span>
                      </span>
                      {expanded ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
                      )}
                    </button>
                    {expanded && (
                      <div className="space-y-2 border-t border-white/10 px-4 py-4">
                        {items.map((it) => {
                          const key = `${d.id}:${it.id}`;
                          const checked = !!checkedItems[key];
                          return (
                            <div key={it.id} className="flex items-start gap-3">
                              <button
                                onClick={() => toggleCheck(key)}
                                aria-pressed={checked}
                                aria-label={checked ? t("tour.uncheckAria", { label: it.label }) : t("tour.checkAria", { label: it.label })}
                                className="mt-0.5 shrink-0 text-primary transition hover:scale-110"
                              >
                                {checked ? (
                                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                                ) : (
                                  <Circle className="h-5 w-5 text-white/30" aria-hidden="true" />
                                )}
                              </button>
                              <div className="min-w-0">
                                <p
                                  className={`text-sm font-semibold ${
                                    checked ? "text-white/35 line-through" : "text-white/85"
                                  }`}
                                >
                                  {it.label}
                                </p>
                                <p className="text-xs leading-relaxed text-white/45">{it.detail}</p>
                                {it.link && (
                                  <Link
                                    href={it.link.href}
                                    className="mt-1 inline-block text-xs font-bold text-primary hover:underline"
                                  >
                                    {it.link.label} →
                                  </Link>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>


    </div>
  );
}
