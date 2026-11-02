import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Crown, Loader2, LogIn, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard } from "./NativeBoard";
import {
  buildCourtGatheringBody,
  courtGatheringError,
  normalizeMyGatherings,
  parseChamberGatherings,
  COURT_BOOK_PATH,
  COURT_DURATION_PRESETS_MIN,
  COURT_MINE_PATH,
  COURT_SLATE_PATH,
  courtCancelPath,
  parseCourtStartInput,
  courtStartInputValue,
  type ChamberGathering,
  type MyGathering,
} from "@/lib/world/court-gathering";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";

/* ─── Court gatherings (UPGRADE-PROGRAM 3.6, stack1300) ───────────
   The calling door for the palace events backbone's court kind.
   The backbone runs royal_court gatherings end to end on the
   server since migration 0313 — booking rules (the Royal Court
   Chamber; the HOUSE only, the drop precedent), the scheduler's
   palace-wide herald at the hour with the Front Row presented from
   the King's court seats — but NO client anywhere could call one:
   kind:"royal_court" was API-only, and the furnished Chamber had
   no occasions. This block is that door, standing in the Front
   Row Gallery's panel in the Chamber itself, above the portraits
   the gathering presents: the Chamber's slate (what's called,
   what's in session), and the calling form.
 *
 * The gate is the server's, and the form says so before it asks:
 * a member who isn't the house is refused by the rail with
 * ADMIN_REQUIRED, and the refusal lands here in plain words
 * (courtGatheringError → worldCourtGathering.errors.refusedHouse)
 * — never a silent failure, never a fake success. Guests get the
 * pitch, never the form (booking is an authed route, full stop).
 *
 * States stay separate, per the house law: a slate that fails to
 * load is an error with a working Retry, an empty slate is its own
 * honest sentence, and "mine" is a courtesy read whose failure
 * leaves the last list standing. Copy rides the
 * worldCourtGathering catalog in all 10 locales (the nine
 * non-English sets are agent-drafted and UNREVIEWED). */

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export function CourtGatheringBlock({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [startValue, setStartValue] = useState(() => courtStartInputValue(Date.now()));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [slate, setSlate] = useState<ChamberGathering[] | null>(null);
  const [slateFailed, setSlateFailed] = useState(false);
  const [mine, setMine] = useState<MyGathering[] | null>(null);
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

  const loadSlate = useCallback(async () => {
    try {
      const res = await fetch(COURT_SLATE_PATH);
      if (!res.ok) throw new Error("court slate");
      const parsed = parseChamberGatherings(await res.json(), Date.now());
      if (parsed === null) throw new Error("court slate shape");
      setSlate(parsed);
      setSlateFailed(false);
    } catch {
      setSlateFailed(true);
    }
  }, []);

  const refreshMine = useCallback(async () => {
    if (isGuest) return;
    try {
      const res = await fetch(COURT_MINE_PATH, { headers: await authHeaders() });
      if (!res.ok) return;
      setMine(normalizeMyGatherings(await res.json(), Date.now()));
    } catch {
      /* The list is a courtesy read — a failure leaves the last one. */
    }
  }, [authHeaders, isGuest]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadSlate();
      if (!cancelled) await refreshMine();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSlate, refreshMine]);

  if (isGuest) {
    return (
      <div data-testid="world-court-gathering">
        <NativeBoard isLight={isLight} title={t("worldCourtGathering.heading")}>
          <div className="space-y-3 px-1 py-1">
            <p className={`inline-flex flex-wrap items-center gap-2 text-sm ${muted}`}>
              {t("worldCourtGathering.guestPitch")}
              <Link
                href={GUEST_SIGN_IN_HREF}
                className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105"
              >
                <LogIn className="h-3 w-3" /> {t("worldCourtGathering.signInCta")}
              </Link>
            </p>
            <SlateSection
              slate={slate}
              failed={slateFailed}
              isLight={isLight}
              muted={muted}
              onRetry={() => void loadSlate()}
            />
          </div>
        </NativeBoard>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    setNotice(null);
    const startsAtMs = parseCourtStartInput(startValue);
    if (startsAtMs === null) {
      setError(t("worldCourtGathering.errors.startRequired"));
      return;
    }
    const built = buildCourtGatheringBody({ title, note, startsAtMs, durationMin }, Date.now());
    if (!built.ok) {
      setError(t(`worldCourtGathering.errors.${built.error}`));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(COURT_BOOK_PATH, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const resolved = courtGatheringError(res.status, data);
        setError(resolved.kind === "message" ? resolved.message : t(`worldCourtGathering.errors.${resolved.key}`));
        return;
      }
      setNotice(t("worldCourtGathering.booked", { when: fmtWhen(built.body.startsAt) }));
      setOpen(false);
      setTitle("");
      setNote("");
      await refreshMine();
      await loadSlate();
    } catch {
      setError(t("worldCourtGathering.errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (gathering: MyGathering) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(courtCancelPath(gathering.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setError(t("worldCourtGathering.cancelFailed"));
        return;
      }
      setNotice(t("worldCourtGathering.cancelled", { title: gathering.title }));
      await refreshMine();
      await loadSlate();
    } catch {
      setError(t("worldCourtGathering.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="world-court-gathering">
      <NativeBoard isLight={isLight} title={t("worldCourtGathering.heading")}>
        <div className="space-y-3 px-1 py-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className={`text-sm ${muted}`}>{t("worldCourtGathering.ruleLine")}</p>
            {!open && (
              <button
                type="button"
                data-testid="world-court-open"
                onClick={() => {
                  setOpen(true);
                  setError(null);
                  setNotice(null);
                }}
                className={`${chipBtn} ml-auto shrink-0`}
              >
                <Crown className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldCourtGathering.openForm")}
              </button>
            )}
          </div>

          {notice && (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{notice}</p>
          )}
          {error && !open && (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p>
          )}

          <SlateSection
            slate={slate}
            failed={slateFailed}
            isLight={isLight}
            muted={muted}
            onRetry={() => void loadSlate()}
          />

          {mine && mine.length > 0 && (
            <div className="space-y-1.5">
              {mine.map((gathering) => (
                <div
                  key={gathering.id}
                  data-testid="world-court-mine"
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                  }`}
                >
                  <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    {gathering.title}
                  </span>
                  <span className={`truncate text-xs ${muted}`}>
                    {gathering.status === "live" ? t("worldCourtGathering.liveNow") : fmtWhen(gathering.startsAt)}
                    {gathering.note ? ` · ${gathering.note}` : ""}
                  </span>
                  <button
                    type="button"
                    data-testid="world-court-cancel"
                    disabled={busy}
                    onClick={() => void cancel(gathering)}
                    className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
                      isLight
                        ? "border-red-800/30 text-red-900/80 hover:text-red-900"
                        : "border-red-400/40 text-red-300 hover:text-red-200"
                    }`}
                  >
                    <X className="h-3 w-3" /> {t("worldCourtGathering.cancel")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {open && (
            <div className="space-y-3">
              <div>
                <label className={`text-[11px] font-bold ${muted}`} htmlFor="court-title">
                  {t("worldCourtGathering.titleLabel")}
                </label>
                <input
                  id="court-title"
                  data-testid="world-court-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder={t("worldCourtGathering.titlePlaceholder")}
                  className={`${inputCls} mt-1`}
                />
              </div>

              <div>
                <label className={`text-[11px] font-bold ${muted}`} htmlFor="court-note">
                  {t("worldCourtGathering.noteLabel")}
                </label>
                <input
                  id="court-note"
                  data-testid="world-court-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={140}
                  placeholder={t("worldCourtGathering.notePlaceholder")}
                  className={`${inputCls} mt-1`}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="min-w-44 flex-1">
                  <label className={`text-[11px] font-bold ${muted}`} htmlFor="court-start">
                    {t("worldCourtGathering.startLabel")}
                  </label>
                  <input
                    id="court-start"
                    data-testid="world-court-start"
                    type="datetime-local"
                    value={startValue}
                    onChange={(e) => setStartValue(e.target.value)}
                    className={`${inputCls} mt-1`}
                  />
                </div>
                <div>
                  <p className={`text-[11px] font-bold ${muted}`}>{t("worldCourtGathering.lengthLabel")}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {COURT_DURATION_PRESETS_MIN.map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        data-testid={`world-court-length-${mins}`}
                        onClick={() => setDurationMin(mins)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                          durationMin === mins
                            ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]"
                            : isLight
                              ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                              : "border-white/15 text-white/75 hover:text-white"
                        }`}
                      >
                        {mins >= 60
                          ? t("worldCourtGathering.lengthHr", { count: mins / 60 })
                          : t("worldCourtGathering.lengthMin", { count: mins })}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="world-court-submit"
                  disabled={busy}
                  onClick={() => void submit()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-xs font-black text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
                  {t("worldCourtGathering.submit")}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={chipBtn}
                >
                  {t("worldCourtGathering.notNow")}
                </button>
              </div>
            </div>
          )}
        </div>
      </NativeBoard>
    </div>
  );
}

/** The Chamber's slate: what's called and what's in session.
 *  Loading, failed-with-Retry, and empty are three separate
 *  states — a failed read never paints as "nothing called". */
function SlateSection({
  slate,
  failed,
  isLight,
  muted,
  onRetry,
}: {
  slate: ChamberGathering[] | null;
  failed: boolean;
  isLight: boolean;
  muted: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (failed) {
    return (
      <div className="space-y-2">
        <p className={`text-sm ${muted}`}>{t("worldCourtGathering.slateFailed")}</p>
        <button
          type="button"
          data-testid="world-court-retry"
          onClick={onRetry}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          {t("worldCourtGathering.retry")}
        </button>
      </div>
    );
  }
  if (slate === null) {
    return (
      <p className={`inline-flex items-center gap-2 text-sm ${muted}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldCourtGathering.slateLoading")}
      </p>
    );
  }
  if (slate.length === 0) {
    return <p className={`text-sm ${muted}`}>{t("worldCourtGathering.slateEmpty")}</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className={`text-[11px] font-bold ${muted}`}>{t("worldCourtGathering.slateTitle")}</p>
      {slate.map((gathering) => (
        <div
          key={gathering.id}
          data-testid="world-court-slate-row"
          className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
            isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
          }`}
        >
          <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            {gathering.title}
          </span>
          {gathering.status === "live" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-black">
              {t("worldCourtGathering.liveNow")}
            </span>
          ) : (
            <span className={`text-xs ${muted}`}>{fmtWhen(gathering.startsAt)}</span>
          )}
          <span className={`w-full truncate text-xs ${muted}`}>
            {t("worldCourtGathering.calledBy", { name: gathering.hostName })}
            {gathering.note ? ` · ${gathering.note}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
