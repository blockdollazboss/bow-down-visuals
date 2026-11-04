/**
 * TourDesk — the My Studio board's native Tour Planner desk
 * (stack1600 world parity wave #4, desk #97, census item B2).
 *
 * Plan the run without leaving the World: the member's tour
 * dates — city, venue, show date, status, notes — on the same
 * /api/tour/dates rails the website's Tour Planner keeps, so
 * the desk and the page are two faces of ONE list. Date work
 * is free, exactly like the page. The AI route + budget
 * optimizer (300 Visual Bucs, confirmed here first — the
 * page's unconfirmed post is not copied) orders the stops to
 * minimize travel and estimates the budget; the figures are
 * AI estimates, and the desk says so in the page's own words.
 *
 * The plan itself rides the page's discipline: cached in
 * lib/tour's store shared with the website, and invalidated
 * on both faces the moment a date is added, edited or
 * deleted — a plan never points at a show that moved.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  clearTourPlan,
  formatMoney,
  loadTourPlan,
  saveTourPlan,
  showDateTimeLabel,
  sortDatesChronologically,
  totalMiles,
  type TourDate,
  type TourPlan,
} from "@/lib/tour";
import {
  EMPTY_TOUR_DRAFT,
  TOUR_OPTIMIZE_COST,
  TOUR_OPTIMIZE_FEATURE,
  TOUR_OPTIMIZE_PATH,
  TOUR_DATES_PATH,
  TOUR_STATUSES,
  TOUR_STATUS_LABELS,
  TOUR_TRANSPORTS,
  TOUR_TRANSPORT_LABELS,
  buildOptimizePayload,
  buildTourDatePayload,
  draftOfDate,
  optimizeReady,
  planOfResponse,
  tourDatePath,
  tourDatesOfResponse,
  tourDraftError,
  withoutTourDate,
  type TourDateDraft,
  type TourTransport,
} from "@/lib/world/tour-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

const ESTIMATE_DISCLAIMER =
  "Routing and budget figures are AI estimates based on typical indie-tour costs — not quotes or guarantees. Confirm real prices before you book anything.";

export function TourDesk({ isLight }: { isLight: boolean }) {
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const deskHeaders = useDeskAuthHeaders();

  const [dates, setDates] = useState<TourDate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<TourDateDraft>(EMPTY_TOUR_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [homeBase, setHomeBase] = useState("");
  const [transport, setTransport] = useState<TourTransport>("van");
  const [crewSize, setCrewSize] = useState(4);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [plan, setPlan] = useState<TourPlan | null>(null);

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

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const headers = await deskHeaders();
      const res = await fetch(TOUR_DATES_PATH, { headers });
      if (!res.ok) throw new Error("load failed");
      const parsed = tourDatesOfResponse(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("load failed");
      setDates(sortDatesChronologically(parsed));
    } catch {
      setFailed(true);
    }
  }, [deskHeaders]);

  useEffect(() => {
    void load();
    setPlan(loadTourPlan());
  }, [load]);

  /* A changed run invalidates the cached plan on both faces. */
  const invalidatePlan = useCallback(() => {
    setPlan(null);
    clearTourPlan();
  }, []);

  function patchDraft(patch: Partial<TourDateDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function resetComposer() {
    setDraft(EMPTY_TOUR_DRAFT);
    setEditingId(null);
  }

  function startEdit(d: TourDate) {
    setDraft(draftOfDate(d));
    setEditingId(d.id);
    setNote(null);
  }

  async function saveDate() {
    if (saving) return;
    const problem = tourDraftError(draft);
    if (problem) {
      setNote(problem);
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(editingId ? tourDatePath(editingId) : TOUR_DATES_PATH, {
        method: editingId ? "PUT" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(buildTourDatePayload(draft)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Couldn't save the tour date — try again."));
      }
      resetComposer();
      invalidatePlan();
      await load();
    } catch (err) {
      setNote(plainErrorText(err, "Couldn't save the tour date — try again."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDate(d: TourDate) {
    if (deletingId) return;
    setDeletingId(d.id);
    setNote(null);
    /* Optimistic removal, restored whole if the rail refuses. */
    setDates((prev) => (prev ? withoutTourDate(prev, d.id) : prev));
    if (editingId === d.id) resetComposer();
    invalidatePlan();
    try {
      const headers = await deskHeaders();
      const res = await fetch(tourDatePath(d.id), { method: "DELETE", headers });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Couldn't delete the tour date — try again."));
      }
    } catch (err) {
      setNote(plainErrorText(err, "Couldn't delete the tour date — try again."));
      void load();
    } finally {
      setDeletingId(null);
    }
  }

  async function optimize() {
    if (optimizing || !dates || !optimizeReady(dates, { homeBase, transport, crewSize })) return;
    setOptimizing(true);
    setOptimizeError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(TOUR_OPTIMIZE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOptimizePayload(dates, { homeBase, transport, crewSize })),
        overrideCost: TOUR_OPTIMIZE_COST,
        overrideFeature: TOUR_OPTIMIZE_FEATURE,
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "The tour optimizer hiccupped — any charge was refunded. Try again."));
      }
      const built = planOfResponse(data, dates.map((d) => d.id));
      if (!built) throw new Error("The plan came back unusable — your Visual Bucs were refunded. Try again.");
      const newPlan: TourPlan = {
        stops: built.stops,
        budget: built.budget,
        routing_notes: built.routingNotes,
        created_at: new Date().toISOString(),
      };
      setPlan(newPlan);
      saveTourPlan(newPlan);
      refreshProfile();
    } catch (err) {
      setOptimizeError(plainErrorText(err, "The tour optimizer hiccupped — try again."));
    } finally {
      setOptimizing(false);
    }
  }

  const budgetRows = plan
    ? [
        { label: "Travel", value: plan.budget.travel },
        { label: "Lodging", value: plan.budget.lodging },
        { label: "Venues", value: plan.budget.venues },
        { label: "Crew", value: plan.budget.crew },
        { label: "Food per-diem", value: plan.budget.food_per_diem },
        { label: "Contingency", value: plan.budget.contingency },
      ]
    : [];

  return (
    <div className="space-y-3" data-testid="world-tour-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Tour Planner</p>
        <p className={`text-xs ${muted}`}>
          Your tour dates, kept here and on the website — one list. Dates are free; the AI route +
          budget plan is {TOUR_OPTIMIZE_COST.toLocaleString()} Visual Bucs.
        </p>
      </div>

      {failed ? (
        <div data-testid="world-tour-desk-failed">
          <p className={errCls}>Your tour dates wouldn&rsquo;t load. Give it another shot.</p>
          <button type="button" className={`mt-2 ${chipCls(false)}`} onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : dates === null ? (
        <p className={`text-sm ${muted}`}>Loading your tour dates…</p>
      ) : dates.length === 0 ? (
        <p className={`text-sm ${muted}`} data-testid="world-tour-desk-empty">
          No tour dates yet — add your first stop below.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {dates.map((d) => (
            <li
              key={d.id}
              className={`rounded-xl border px-3 py-2 ${cardCls}`}
              data-testid={`world-tour-desk-item-${d.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-bold ${strong}`}>{d.city}</span>
                <span className={`text-xs ${muted}`}>{d.venue}</span>
                <span className={chipCls(d.status === "confirmed")}>
                  {TOUR_STATUS_LABELS[d.status]}
                </span>
                <span className="ml-auto flex gap-1.5">
                  <button
                    type="button"
                    className={chipCls(false)}
                    data-testid={`world-tour-desk-edit-${d.id}`}
                    onClick={() => startEdit(d)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={chipCls(false)}
                    data-testid={`world-tour-desk-delete-${d.id}`}
                    disabled={deletingId !== null}
                    onClick={() => void deleteDate(d)}
                  >
                    {deletingId === d.id ? "Deleting…" : "Delete"}
                  </button>
                </span>
              </div>
              <p className={`mt-0.5 text-xs ${muted}`}>{showDateTimeLabel(d.show_date)}</p>
              {d.notes ? <p className={`mt-0.5 text-xs ${muted}`}>{d.notes}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-tour-desk-composer">
        <p className={`text-sm font-bold ${strong}`}>{editingId ? "Edit this stop" : "Add a stop"}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            data-testid="world-tour-desk-city"
            aria-label="City"
            className={inputCls}
            value={draft.city}
            maxLength={120}
            onChange={(e) => patchDraft({ city: e.target.value })}
            placeholder="City"
          />
          <input
            data-testid="world-tour-desk-venue"
            aria-label="Venue"
            className={inputCls}
            value={draft.venue}
            maxLength={200}
            onChange={(e) => patchDraft({ venue: e.target.value })}
            placeholder="Venue"
          />
          <input
            data-testid="world-tour-desk-show-date"
            aria-label="Show date and time"
            type="datetime-local"
            className={inputCls}
            value={draft.showDateLocal}
            onChange={(e) => patchDraft({ showDateLocal: e.target.value })}
          />
          <input
            data-testid="world-tour-desk-notes"
            aria-label="Notes (optional)"
            className={inputCls}
            value={draft.notes}
            maxLength={1000}
            onChange={(e) => patchDraft({ notes: e.target.value })}
            placeholder="Notes — load-in, contacts…"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Show status">
          {TOUR_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={draft.status === s}
              data-testid={`world-tour-desk-status-${s}`}
              className={chipCls(draft.status === s)}
              onClick={() => patchDraft({ status: s })}
            >
              {TOUR_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="world-tour-desk-save"
            className={goldBtn}
            disabled={saving}
            onClick={() => void saveDate()}
          >
            {saving ? "Saving…" : editingId ? "Save changes" : "Add date"}
          </button>
          {editingId ? (
            <button type="button" className={chipCls(false)} onClick={resetComposer}>
              Cancel edit
            </button>
          ) : null}
        </div>
        {note ? (
          <p className={`mt-2 ${errCls}`} data-testid="world-tour-desk-note">{note}</p>
        ) : null}
      </div>

      <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-tour-desk-optimizer">
        <p className={`text-sm font-bold ${strong}`}>Routing + budget</p>
        <p className={`text-xs ${muted}`}>
          The smart order for your stops plus a full budget breakdown —{" "}
          {TOUR_OPTIMIZE_COST.toLocaleString()} Visual Bucs per plan.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            data-testid="world-tour-desk-home-base"
            aria-label="Home base city"
            className={inputCls}
            value={homeBase}
            maxLength={120}
            onChange={(e) => setHomeBase(e.target.value)}
            placeholder="Home base city"
          />
          <label className={`flex items-center gap-2 text-xs ${muted}`}>
            Crew size
            <input
              data-testid="world-tour-desk-crew"
              aria-label="Crew size"
              type="number"
              min={1}
              max={50}
              className={inputCls}
              value={crewSize}
              onChange={(e) => setCrewSize(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Transport">
          {TOUR_TRANSPORTS.map((tp) => (
            <button
              key={tp}
              type="button"
              role="radio"
              aria-checked={transport === tp}
              data-testid={`world-tour-desk-transport-${tp}`}
              className={chipCls(transport === tp)}
              onClick={() => setTransport(tp)}
            >
              {TOUR_TRANSPORT_LABELS[tp]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="world-tour-desk-optimize"
            className={goldBtn}
            disabled={
              optimizing ||
              !dates ||
              !optimizeReady(dates, { homeBase, transport, crewSize })
            }
            onClick={() => void optimize()}
          >
            {optimizing
              ? "Planning the route…"
              : `Optimize ${dates?.length ?? 0} stops · ${TOUR_OPTIMIZE_COST.toLocaleString()} Visual Bucs`}
          </button>
          {dates && dates.length < 2 ? (
            <span className={`text-xs ${muted}`}>Add at least 2 tour dates before running the AI optimizer.</span>
          ) : null}
        </div>
        {outOfCredits ? (
          <p className={`mt-2 ${errCls}`}>
            You&rsquo;re out of Visual Bucs — top up at the Visual Buc Packs desk in the Treasury and
            the optimizer is ready again.
          </p>
        ) : null}
        {optimizeError ? (
          <p className={`mt-2 ${errCls}`} data-testid="world-tour-desk-optimize-error">{optimizeError}</p>
        ) : null}
        <p className={`mt-2 text-xs ${muted}`}>{ESTIMATE_DISCLAIMER}</p>
      </div>

      {plan ? (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-tour-desk-plan">
          <p className={`text-sm font-bold ${strong}`}>Your route, in order</p>
          <ol className="mt-2 space-y-1.5">
            {plan.stops.map((s) => (
              <li key={s.date_id} className="text-sm">
                <span className={`font-bold ${strong}`}>
                  {s.order}. {s.city}
                </span>{" "}
                <span className={muted}>
                  — {s.venue} · {showDateTimeLabel(s.show_date)}
                </span>
                {s.travel_from_previous ? (
                  <p className={`text-xs ${muted}`}>
                    {s.travel_from_previous}
                    {s.estimated_travel_miles != null && s.estimated_travel_miles > 0
                      ? ` · ~${s.estimated_travel_miles.toLocaleString("en-US")} mi`
                      : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          <p className={`mt-2 text-xs ${muted}`}>
            About {totalMiles(plan.stops).toLocaleString("en-US")} miles of travel in this order.
          </p>
          {plan.routing_notes ? (
            <p className={`mt-2 whitespace-pre-wrap text-sm ${muted}`}>{plan.routing_notes}</p>
          ) : null}
          <div className="mt-3 space-y-0.5">
            {budgetRows.map((row) => (
              <p key={row.label} className={`flex justify-between text-sm ${muted}`}>
                <span>{row.label}</span>
                <span>{formatMoney(row.value, plan.budget.currency)}</span>
              </p>
            ))}
            <p className={`flex justify-between border-t pt-1 text-sm font-bold ${strong} ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
              <span>Estimated total</span>
              <span>{formatMoney(plan.budget.total, plan.budget.currency)}</span>
            </p>
          </div>
          {plan.budget.notes.length > 0 ? (
            <ul className={`mt-2 list-disc space-y-0.5 pl-5 text-xs ${muted}`}>
              {plan.budget.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
