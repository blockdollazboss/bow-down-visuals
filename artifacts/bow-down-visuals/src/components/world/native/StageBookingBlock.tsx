import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarDays, Loader2, LogIn, Radio, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard } from "./NativeBoard";
import { NativeErrorState } from "./NativeStates";
import {
  buildStageShowBody,
  normalizeMyShows,
  parseScreenCatalog,
  stageBookingError,
  STAGE_BOOK_PATH,
  STAGE_DURATION_PRESETS_MIN,
  STAGE_MINE_PATH,
  STAGE_SCREEN_CATALOG_PATH,
  stageCancelPath,
  parseStageStartInput,
  stageStartInputValue,
  type MyShow,
  type StageContentChoice,
  type StageContentItem,
} from "@/lib/world/stage-booking";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";

/* ─── Book the stage (UPGRADE-PROGRAM 3.1, stack1300) ──────────────
   The booking door for the palace events backbone's headline verb.
   The backbone has run stage shows end to end on the server since
   migration 0145 — booking rules (Throne Hall; Front Row members of
   the King's court + the house), the scheduler's screen hand-off
   (a catalog video plays as a synced watch party, or "live" opens
   the stage for the host), the directory slate — but NO client
   anywhere could book one: kind:"stage_show" was API-only. This
   block is that door, standing on the Kingdom Board beside the
   slate it feeds: a member picks the hour, the length, and what
   plays (their live stage, or a published video/replay from the
   screen catalog), and the form posts the booking to the rail.
 *
 * The gate is the server's, and the form says so before it asks:
 * a member who holds no Front Row seat is refused by the rail with
 * FRONT_ROW_REQUIRED, and the refusal lands here in plain words
 * (stageBookingError → worldStageBooking.errors.refusedFrontRow) —
 * never a silent failure, never a fake success. Guests get the
 * pitch, never the form (booking is an authed route, full stop).
 *
 * States stay separate, per the house law: a catalog that fails to
 * load is an error with a working Retry (the live-stage choice
 * still books — the copy says so), an empty catalog is its own
 * honest sentence, and "mine" is a courtesy read whose failure
 * leaves the last list standing. Copy rides the worldStageBooking
 * catalog in all 10 locales (the nine non-English sets are
 * agent-drafted and UNREVIEWED). */

function fmtShowWhen(iso: string, language?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(language, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function StageBookingBlock({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const { getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startValue, setStartValue] = useState(() => stageStartInputValue(Date.now()));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [choice, setChoice] = useState<StageContentChoice>({ type: "live" });
  const [catalog, setCatalog] = useState<{ mine: StageContentItem[]; pub: StageContentItem[] } | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [mine, setMine] = useState<MyShow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white [color-scheme:dark]"
  }`;

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch(STAGE_SCREEN_CATALOG_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("screen catalog");
      setCatalog(parseScreenCatalog(await res.json()));
      setCatalogFailed(false);
    } catch {
      setCatalogFailed(true);
    }
  }, [authHeaders]);

  const refreshMine = useCallback(async () => {
    try {
      const res = await fetch(STAGE_MINE_PATH, { headers: await authHeaders() });
      if (!res.ok) return;
      setMine(normalizeMyShows(await res.json(), Date.now()));
    } catch {
      /* The list is a courtesy read — a failure leaves the last one. */
    }
  }, [authHeaders]);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    void (async () => {
      await loadCatalog();
      if (!cancelled) await refreshMine();
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest, loadCatalog, refreshMine]);

  if (isGuest) {
    return (
      <div data-testid="world-stage-booking">
        <NativeBoard isLight={isLight} title={t("worldStageBooking.heading")}>
          <p className={`inline-flex flex-wrap items-center gap-2 px-1 py-1 text-sm ${muted}`}>
            {t("worldStageBooking.guestPitch")}
            <Link
              href={GUEST_SIGN_IN_HREF}
              className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105"
            >
              <LogIn className="h-3 w-3" /> {t("worldStageBooking.signInCta")}
            </Link>
          </p>
        </NativeBoard>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    setNotice(null);
    const startsAtMs = parseStageStartInput(startValue);
    if (startsAtMs === null) {
      setError(t("worldStageBooking.errors.startRequired"));
      return;
    }
    const built = buildStageShowBody({ title, startsAtMs, durationMin, content: choice }, Date.now());
    if (!built.ok) {
      setError(t(`worldStageBooking.errors.${built.error}`));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(STAGE_BOOK_PATH, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const resolved = stageBookingError(res.status, data);
        setError(resolved.kind === "message" ? resolved.message : t(`worldStageBooking.errors.${resolved.key}`));
        return;
      }
      setNotice(t("worldStageBooking.booked", { when: fmtShowWhen(built.body.startsAt, i18n.language) }));
      setOpen(false);
      setTitle("");
      await refreshMine();
    } catch {
      setError(t("worldStageBooking.errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (show: MyShow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(stageCancelPath(show.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setError(t("worldStageBooking.cancelFailed"));
        return;
      }
      setNotice(t("worldStageBooking.cancelled", { title: show.title }));
      await refreshMine();
    } catch {
      setError(t("worldStageBooking.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  const pickBtn = (item: StageContentItem) => {
    const picked = choice.type === "catalog" && choice.item.id === item.id;
    return (
      <button
        key={item.id}
        type="button"
        data-testid="world-stage-pick"
        onClick={() => setChoice({ type: "catalog", item })}
        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
          picked
            ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]"
            : isLight
              ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
              : "border-white/15 text-white/75 hover:text-white"
        }`}
      >
        <span className="truncate">{item.title}</span>
        {item.creatorName ? <span className="opacity-60">· {item.creatorName}</span> : null}
        {item.durationSec > 0 ? <span className="opacity-50">{fmtClock(item.durationSec)}</span> : null}
      </button>
    );
  };

  const pickSection = (label: string, items: StageContentItem[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <p className={`text-[11px] font-bold ${muted}`}>{label}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">{items.map(pickBtn)}</div>
      </div>
    );

  return (
    <div data-testid="world-stage-booking">
      <NativeBoard isLight={isLight} title={t("worldStageBooking.heading")}>
        <div className="space-y-3 px-1 py-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className={`text-sm ${muted}`}>{t("worldStageBooking.ruleLine")}</p>
            {!open && (
              <button
                type="button"
                data-testid="world-stage-open"
                onClick={() => {
                  setOpen(true);
                  setError(null);
                  setNotice(null);
                }}
                className={`${chipBtn} ml-auto shrink-0`}
              >
                <CalendarDays className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldStageBooking.openForm")}
              </button>
            )}
          </div>

          {notice && (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{notice}</p>
          )}
          {error && !open && (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p>
          )}

          {mine && mine.length > 0 && (
            <div className="space-y-1.5">
              {mine.map((show) => (
                <div
                  key={show.id}
                  data-testid="world-stage-mine"
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                  }`}
                >
                  <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    {show.title}
                  </span>
                  <span className={`truncate text-xs ${muted}`}>
                    {show.status === "live" ? t("worldStageBooking.liveNow") : fmtShowWhen(show.startsAt, i18n.language)} ·{" "}
                    {show.contentRef === "live"
                      ? t("worldStageBooking.mineLiveContent")
                      : (catalog?.mine.find((i) => i.id === show.contentRef)?.title ??
                        catalog?.pub.find((i) => i.id === show.contentRef)?.title ??
                        show.contentRef)}
                  </span>
                  <button
                    type="button"
                    data-testid="world-stage-cancel"
                    disabled={busy}
                    onClick={() => void cancel(show)}
                    className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
                      isLight
                        ? "border-red-800/30 text-red-900/80 hover:text-red-900"
                        : "border-red-400/40 text-red-300 hover:text-red-200"
                    }`}
                  >
                    <X className="h-3 w-3" /> {t("worldStageBooking.cancel")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {open && (
            <div className="space-y-3">
              <div>
                <label className={`text-[11px] font-bold ${muted}`} htmlFor="stage-title">
                  {t("worldStageBooking.titleLabel")}
                </label>
                <input
                  id="stage-title"
                  data-testid="world-stage-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder={t("worldStageBooking.titlePlaceholder")}
                  className={`${inputCls} mt-1`}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="min-w-44 flex-1">
                  <label className={`text-[11px] font-bold ${muted}`} htmlFor="stage-start">
                    {t("worldStageBooking.startLabel")}
                  </label>
                  <input
                    id="stage-start"
                    data-testid="world-stage-start"
                    type="datetime-local"
                    value={startValue}
                    onChange={(e) => setStartValue(e.target.value)}
                    className={`${inputCls} mt-1`}
                  />
                </div>
                <div>
                  <p className={`text-[11px] font-bold ${muted}`}>{t("worldStageBooking.lengthLabel")}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {STAGE_DURATION_PRESETS_MIN.map((min) => (
                      <button
                        key={min}
                        type="button"
                        data-testid="world-stage-duration"
                        onClick={() => setDurationMin(min)}
                        className={`${chipBtn} ${durationMin === min ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]" : ""}`}
                      >
                        {min >= 60
                          ? t("worldStageBooking.lengthHr", { count: min / 60 })
                          : t("worldStageBooking.lengthMin", { count: min })}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <p className={`text-[11px] font-bold ${muted}`}>{t("worldStageBooking.contentLabel")}</p>
                <div className="mt-1 space-y-2">
                  <button
                    type="button"
                    data-testid="world-stage-live"
                    onClick={() => setChoice({ type: "live" })}
                    className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                      choice.type === "live"
                        ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]"
                        : isLight
                          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                          : "border-white/15 text-white/75 hover:text-white"
                    }`}
                  >
                    <Radio className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                    <span className="truncate">{t("worldStageBooking.contentLive")}</span>
                  </button>
                  {catalogFailed ? (
                    <NativeErrorState
                      isLight={isLight}
                      title={t("worldStageBooking.catalogFailedTitle")}
                      message={t("worldStageBooking.catalogFailed")}
                      onRetry={() => void loadCatalog()}
                    />
                  ) : catalog === null ? (
                    <p className={`inline-flex items-center gap-2 text-sm ${muted}`}>
                      <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldStageBooking.catalogLoading")}
                    </p>
                  ) : catalog.mine.length + catalog.pub.length === 0 ? (
                    <p className={`text-sm ${muted}`}>{t("worldStageBooking.catalogEmpty")}</p>
                  ) : (
                    <>
                      {pickSection(t("worldStageBooking.pickYours"), catalog.mine)}
                      {pickSection(t("worldStageBooking.pickPalace"), catalog.pub)}
                    </>
                  )}
                </div>
              </div>

              {error && (
                <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-testid="world-stage-submit"
                  disabled={busy}
                  onClick={() => void submit()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37]/20 px-4 py-2 text-xs font-black text-[#d4af37] transition hover:bg-[#d4af37]/30 disabled:opacity-50 bdv-touch-target"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
                  {t("worldStageBooking.submit")}
                </button>
                <button type="button" onClick={() => setOpen(false)} className={chipBtn}>
                  {t("worldStageBooking.notNow")}
                </button>
              </div>
            </div>
          )}
        </div>
      </NativeBoard>
    </div>
  );
}
