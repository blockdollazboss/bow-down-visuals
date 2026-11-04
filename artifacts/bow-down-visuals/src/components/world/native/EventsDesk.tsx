import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { CalendarPlus, Check, ExternalLink, Loader2, Ticket, Users } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import {
  EVENTS_PATH,
  EVENT_KIND_OPTIONS,
  buildEventCreateBody,
  eventCreateReady,
  eventRsvpPath,
  eventUnrsvpPath,
  eventWhenLabel,
  normalizeWorldEvents,
  rsvpLanded,
  type EventCreateForm,
  type WorldEvent,
} from "@/lib/world/events-desk";

/* ─── Events, in-world (stack1100 world parity) ────────────────────
   The Community Hall's events section, on the community router's
   own rails — the same /api/events endpoints pages/events.tsx
   calls. The Hall's slate has always promised "Groups, events and
   the whole kingdom's conversation"; this desk is the events third
   of that promise, complete in the room: browse the public list,
   RSVP / cancel, and host a new event (creators — the rail answers
   its own honest 403 when the caller has no creator profile, and
   the desk surfaces that line verbatim).

   RSVP truth: the list rail carries no per-viewer RSVP flag, so a
   row learns the caller's state from the rail itself — a tap that
   lands 201 (new) or 409 (already on the list) both mean the
   server holds the caller's RSVP, and the row dresses accordingly.
   Guests read the public list and get the sign-in pitch for the
   member verbs, the house pattern. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

const EMPTY_FORM: EventCreateForm = {
  title: "",
  description: "",
  startsAtLocal: "",
  kind: "stream",
  destinationUrl: "",
  ticketUrl: "",
};

/* The kind vocabulary is the seam's (events-desk EVENT_KIND_OPTIONS);
   the words render from the catalog, keyed by the kind token, with
   the seam's own fallback ("Event") for kinds the desk doesn't know. */
const EVENT_KIND_KEYS: Record<string, string> = {
  stream: "worldSocialDesk.eventsKindStream",
  drop: "worldSocialDesk.eventsKindDrop",
  premiere: "worldSocialDesk.eventsKindPremiere",
  other: "worldSocialDesk.eventsKindOther",
};

export function EventsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const kindLabel = (kind: string) =>
    t(EVENT_KIND_KEYS[kind] ?? "worldSocialDesk.eventsKindFallback");
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [events, setEvents] = useState<WorldEvent[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [onList, setOnList] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<EventCreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const res = await fetch(EVENTS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`events ${res.status}`);
        const parsed = normalizeWorldEvents(await res.json());
        if (!parsed) throw new Error("events shape");
        if (!cancelled) setEvents(parsed);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function rsvp(ev: WorldEvent) {
    setBusyId(ev.id);
    setRowError(null);
    try {
      const res = await fetch(eventRsvpPath(ev.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (rsvpLanded(res.status)) {
        setOnList((m) => ({ ...m, [ev.id]: true }));
        if (res.status === 201) {
          setEvents((list) =>
            list?.map((e) => (e.id === ev.id ? { ...e, rsvpCount: e.rsvpCount + 1 } : e)) ?? list,
          );
          setNotice(t("worldSocialDesk.eventsRsvpNotice", { title: ev.title }));
        } else {
          setNotice(t("worldSocialDesk.eventsRsvpAlreadyNotice", { title: ev.title }));
        }
      } else {
        throw new Error(apiErrorMessage(data, t("worldSocialDesk.eventsRsvpFailedStatus", { status: res.status })));
      }
    } catch (err) {
      setRowError(plainErrorText(err, t("worldSocialDesk.eventsRsvpError")));
    } finally {
      setBusyId(null);
    }
  }

  async function unrsvp(ev: WorldEvent) {
    setBusyId(ev.id);
    setRowError(null);
    try {
      const res = await fetch(eventUnrsvpPath(ev.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSocialDesk.eventsCancelFailedStatus", { status: res.status })));
      setOnList((m) => ({ ...m, [ev.id]: false }));
      setEvents((list) =>
        list?.map((e) =>
          e.id === ev.id ? { ...e, rsvpCount: Math.max(0, e.rsvpCount - 1) } : e,
        ) ?? list,
      );
      setNotice(t("worldSocialDesk.eventsUnrsvpNotice", { title: ev.title }));
    } catch (err) {
      setRowError(plainErrorText(err, t("worldSocialDesk.eventsUnrsvpError")));
    } finally {
      setBusyId(null);
    }
  }

  async function create() {
    if (!eventCreateReady(form)) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(EVENTS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildEventCreateBody(form)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSocialDesk.eventsCreateFailedStatus", { status: res.status })));
      setForm(EMPTY_FORM);
      setShowCreate(false);
      setNotice(t("worldSocialDesk.eventsCreatedNotice"));
      setTick((n) => n + 1);
    } catch (err) {
      setCreateError(plainErrorText(err, t("worldSocialDesk.eventsCreateError")));
    } finally {
      setCreating(false);
    }
  }

  return (
    <NativeCard isLight={isLight} title={t("nav.events")}>
      <div data-testid="world-events-desk" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm ${muted}`}>{t("worldSocialDesk.eventsIntro")}</p>
          {!isGuest ? (
            <button type="button" className={goldBtn} onClick={() => setShowCreate((s) => !s)} aria-expanded={showCreate}>
              <CalendarPlus className="h-3.5 w-3.5" /> {t("worldSocialDesk.eventsHostButton")}
            </button>
          ) : null}
        </div>

        {isGuest ? (
          <p className={`text-xs ${muted}`}>
            {t("worldSocialDesk.eventsGuestLead")}
            <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline">
              {t("worldSocialDesk.eventsSignIn")}
            </Link>
            {t("worldSocialDesk.eventsGuestTail")}
          </p>
        ) : null}

        {showCreate && !isGuest ? (
          <div
            data-testid="world-events-create"
            className={`space-y-2 rounded-xl border p-3 ${
              isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
            }`}
          >
            <input
              className={deskInputCls(isLight)}
              placeholder={t("worldSocialDesk.eventsTitleField")}
              maxLength={120}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              aria-label={t("worldSocialDesk.eventsTitleField")}
            />
            <div className="flex flex-wrap gap-2">
              <select
                className={deskInputCls(isLight)}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                aria-label={t("worldSocialDesk.eventsKindAria")}
              >
                {EVENT_KIND_OPTIONS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {kindLabel(k.key)}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                className={deskInputCls(isLight)}
                value={form.startsAtLocal}
                onChange={(e) => setForm({ ...form, startsAtLocal: e.target.value })}
                aria-label={t("worldSocialDesk.eventsStartsAria")}
              />
            </div>
            <textarea
              className={deskInputCls(isLight)}
              placeholder={t("worldSocialDesk.eventsDescPlaceholder")}
              rows={2}
              maxLength={5000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              aria-label={t("worldSocialDesk.eventsDescAria")}
            />
            <input
              className={deskInputCls(isLight)}
              placeholder={t("worldSocialDesk.eventsDestPlaceholder")}
              value={form.destinationUrl}
              onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })}
              aria-label={t("worldSocialDesk.eventsDestAria")}
            />
            <input
              className={deskInputCls(isLight)}
              placeholder={t("worldSocialDesk.eventsTicketPlaceholder")}
              value={form.ticketUrl}
              onChange={(e) => setForm({ ...form, ticketUrl: e.target.value })}
              aria-label={t("worldSocialDesk.eventsTicketAria")}
            />
            {createError ? (
              <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{createError}</p>
            ) : null}
            <button
              type="button"
              className={goldBtn}
              disabled={!eventCreateReady(form) || creating}
              onClick={() => void create()}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("worldSocialDesk.eventsCreateButton")}
            </button>
          </div>
        ) : null}

        {notice ? <p className={`text-xs font-semibold ${strong}`}>{notice}</p> : null}
        {rowError ? (
          <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{rowError}</p>
        ) : null}

        {loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldSocialDesk.eventsLoadErrorTitle")}
            message={t("worldSocialDesk.eventsLoadErrorMessage")}
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : events === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.eventsLoading")} />
        ) : events.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldSocialDesk.eventsEmptyMessage")}
            detail={t("worldSocialDesk.eventsEmptyDetail")}
          />
        ) : (
          <div className="space-y-2">
            {events.map((ev) => {
              const mine = onList[ev.id] === true;
              return (
                <div
                  key={ev.id}
                  data-testid="world-event-row"
                  className={`rounded-xl border px-3 py-2.5 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                        isLight ? "bg-[#d4af37]/20 text-[#7A5A12]" : "bg-[#d4af37]/15 text-[#e8c86a]"
                      }`}
                    >
                      {kindLabel(ev.kind)}
                    </span>
                    <span className={`text-xs font-semibold ${muted}`}>{eventWhenLabel(ev.startsAt, i18n.language)}</span>
                    <span className={`inline-flex items-center gap-1 text-xs ${muted}`}>
                      <Users className="h-3.5 w-3.5" /> {t("worldSocialDesk.eventsGoing", { count: ev.rsvpCount })}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm font-bold ${strong}`}>{ev.title}</p>
                  {ev.hostName ? (
                    <p className={`text-xs ${muted}`}>{t("worldSocialDesk.eventsHostedBy", { name: ev.hostName })}</p>
                  ) : null}
                  {ev.description ? (
                    <p className={`mt-1 line-clamp-2 text-xs ${muted}`}>{ev.description}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!isGuest ? (
                      mine ? (
                        <>
                          <span className={`inline-flex items-center gap-1 text-xs font-bold ${strong}`}>
                            <Check className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldSocialDesk.eventsOnList")}
                          </span>
                          <button
                            type="button"
                            className={chipBtn(isLight)}
                            disabled={busyId === ev.id}
                            onClick={() => void unrsvp(ev)}
                          >
                            {t("worldSocialDesk.eventsCancelRsvp")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={goldBtn}
                          disabled={busyId === ev.id}
                          onClick={() => void rsvp(ev)}
                        >
                          {busyId === ev.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {t("worldSocialDesk.eventsRsvpFree")}
                        </button>
                      )
                    ) : null}
                    {ev.ticketUrl ? (
                      <a
                        href={ev.ticketUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={chipBtn(isLight)}
                      >
                        <Ticket className="h-3.5 w-3.5" /> {t("worldSocialDesk.eventsTickets")}
                      </a>
                    ) : null}
                    {ev.destinationUrl ? (
                      <a
                        href={ev.destinationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={chipBtn(isLight)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> {t("worldSocialDesk.eventsWhere")}
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </NativeCard>
  );
}
