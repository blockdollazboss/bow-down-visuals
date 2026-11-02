import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  buildDropBody,
  dropBookingError,
  dropCancelPath,
  dropRooms,
  parseDropStartInput,
  dropStartInputValue,
  parseUpcomingDrops,
  DROP_BOOK_PATH,
  DROP_DURATION_PRESETS_MIN,
  DROP_SLATE_PATH,
  type UpcomingDrop,
} from "@/lib/world/drop-booking";

/* ─── Admin: World Drop Spectacles — the spectacle booking bench ────
   The drop backbone (world_events kind "drop", migration 0145) has
   run since Ring 3: at the hour a spectacle lands in its room,
   heralded palace-wide, claimed first-come by the members standing
   there, paid through the shared ≤1,000 VB/week drop envelope. But
   booking one was API-only — POST /api/world/events is admin-only
   (ADMIN_REQUIRED) and no surface anywhere sent it. This bench is
   that door, docked with the other admin event surfaces: book a
   spectacle into any palace room, read the upcoming slate off the
   same public rail, cancel from the same list.
 *
 * The bench never widens the rail: the form mirrors the server's
 * sanitize + window rules through lib/world/drop-booking (amount
 * 100–1,000 Visual Bucs per claim, 1–30 claims, 5 minutes – 4
 * hours, ≤30 days out), and the money words are the rail's own —
 * the budget and per-claim lines state the figures exactly as the
 * rails state them. Load failure and an empty slate are separate
 * states (the strict parser returns null on a malformed answer —
 * a failed read, never a painted-empty list). */

const inputCls =
  "rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30";
const labelCls = "block text-[11px] font-semibold uppercase tracking-wider text-white/40";

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

export function WorldDropAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const rooms = dropRooms();

  const [drops, setDrops] = useState<UpcomingDrop[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState(
    () => rooms.find((r) => r.id === "world:courtyard")?.id ?? rooms[0]?.id ?? "world:courtyard",
  );
  const [startValue, setStartValue] = useState(() => dropStartInputValue(Date.now()));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [amountVb, setAmountVb] = useState("250");
  const [claimCap, setClaimCap] = useState("10");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(DROP_SLATE_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("slate");
      const parsed = parseUpcomingDrops(await res.json(), Date.now());
      if (parsed === null) throw new Error("slate payload");
      setDrops(parsed);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load, retryNonce]);

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;

  const submit = async () => {
    setFormError(null);
    setNotice(null);
    const startsAtMs = parseDropStartInput(startValue);
    if (startsAtMs === null) {
      setFormError(t("admin.worldDrops.errors.startRequired"));
      return;
    }
    const built = buildDropBody(
      {
        title,
        roomId,
        startsAtMs,
        durationMin,
        amountVb: Number(amountVb),
        claimCap: Number(claimCap),
      },
      Date.now(),
    );
    if (!built.ok) {
      setFormError(t(`admin.worldDrops.errors.${built.error}`));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(DROP_BOOK_PATH, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const resolved = dropBookingError(res.status, data);
        setFormError(resolved.kind === "message" ? resolved.message : t(`admin.worldDrops.errors.${resolved.key}`));
        return;
      }
      setNotice(
        t("admin.worldDrops.booked", {
          title: built.body.title,
          room: roomName(built.body.roomId),
          when: fmtWhen(built.body.startsAt),
        }),
      );
      setTitle("");
      await load();
    } catch {
      setFormError(t("admin.worldDrops.errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (drop: UpcomingDrop) => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(dropCancelPath(drop.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setFormError(t("admin.worldDrops.cancelFailed"));
        return;
      }
      setNotice(t("admin.worldDrops.cancelled", { title: drop.title }));
      await load();
    } catch {
      setFormError(t("admin.worldDrops.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="world-drop-admin-bench"
    >
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.worldDrops.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-1">{t("admin.worldDrops.description")}</p>
      <p className="text-xs text-white/40 mb-4">{t("admin.worldDrops.budgetLine")}</p>

      {/* ── The booking form ── */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="drop-title">{t("admin.worldDrops.titleLabel")}</label>
          <input
            id="drop-title"
            data-testid="world-drop-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={t("admin.worldDrops.titlePlaceholder")}
            className={`${inputCls} mt-1 w-full`}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="drop-room">{t("admin.worldDrops.roomLabel")}</label>
          <select
            id="drop-room"
            data-testid="world-drop-room"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className={`${inputCls} mt-1 w-full`}
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="drop-start">{t("admin.worldDrops.startLabel")}</label>
          <input
            id="drop-start"
            data-testid="world-drop-start"
            type="datetime-local"
            value={startValue}
            onChange={(e) => setStartValue(e.target.value)}
            className={`${inputCls} mt-1 w-full [color-scheme:dark]`}
          />
        </div>
        <div>
          <span className={labelCls}>{t("admin.worldDrops.lengthLabel")}</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {DROP_DURATION_PRESETS_MIN.map((min) => (
              <button
                key={min}
                type="button"
                data-testid="world-drop-duration"
                onClick={() => setDurationMin(min)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  durationMin === min
                    ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]"
                    : "border-white/15 text-white/70 hover:text-white"
                }`}
              >
                {min >= 60 ? `${min / 60} hr` : `${min} min`}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="drop-amount">{t("admin.worldDrops.amountLabel")}</label>
          <input
            id="drop-amount"
            data-testid="world-drop-amount"
            type="number"
            min={100}
            max={1000}
            step={50}
            value={amountVb}
            onChange={(e) => setAmountVb(e.target.value)}
            className={`${inputCls} mt-1 w-full`}
          />
          <p className="mt-1 text-[11px] text-white/35">{t("admin.worldDrops.rangeLine")}</p>
        </div>
        <div>
          <label className={labelCls} htmlFor="drop-claims">{t("admin.worldDrops.claimsLabel")}</label>
          <input
            id="drop-claims"
            data-testid="world-drop-claims"
            type="number"
            min={1}
            max={30}
            step={1}
            value={claimCap}
            onChange={(e) => setClaimCap(e.target.value)}
            className={`${inputCls} mt-1 w-full`}
          />
        </div>
      </div>

      {formError && (
        <p className="mt-3 text-xs font-semibold text-amber-300" data-testid="world-drop-form-error">{formError}</p>
      )}
      {notice && (
        <p className="mt-3 text-xs font-semibold text-emerald-300" data-testid="world-drop-notice">{notice}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          data-testid="world-drop-submit"
          disabled={busy}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37]/20 px-4 py-2 text-xs font-black text-[#d4af37] transition hover:bg-[#d4af37]/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
          {t("admin.worldDrops.submit")}
        </button>
      </div>

      {/* ── The upcoming slate ── */}
      <p className="mt-6 mb-2 text-xs text-white/40 uppercase tracking-wider font-semibold">
        {t("admin.worldDrops.upcomingTitle")}
      </p>
      {loading ? (
        <p className="text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin inline" /> {t("admin.worldDrops.loading")}
        </p>
      ) : loadError ? (
        <div
          className={`rounded-2xl border p-6 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}
          data-testid="world-drop-load-error"
        >
          <AlertTriangle className="mx-auto h-8 w-8 text-primary" />
          <p className={`mt-2 text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("admin.worldDrops.loadFailed")}
          </p>
          <button
            type="button"
            data-testid="world-drop-retry"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37]/20 px-4 py-2 text-xs font-black text-[#d4af37] transition hover:bg-[#d4af37]/30"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("admin.worldDrops.retry")}
          </button>
        </div>
      ) : drops && drops.length === 0 ? (
        <p className="text-sm text-white/50" data-testid="world-drop-empty">{t("admin.worldDrops.empty")}</p>
      ) : (
        <div className="space-y-1.5">
          {(drops ?? []).map((drop) => (
            <div
              key={drop.id}
              data-testid="world-drop-row"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm font-bold text-white">{drop.title}</span>
              <span className="truncate text-xs text-white/50">
                {roomName(drop.roomId)} · {drop.status === "live" ? t("admin.worldDrops.liveNow") : fmtWhen(drop.startsAt)} ·{" "}
                {t("admin.worldDrops.claimsLine", { amount: drop.amountVb, count: drop.claimCap })}
              </span>
              <button
                type="button"
                data-testid="world-drop-cancel"
                disabled={busy}
                onClick={() => void cancel(drop)}
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-red-400/40 px-2.5 py-1 text-[11px] font-bold text-red-300 transition hover:text-red-200"
              >
                <X className="h-3 w-3" /> {t("admin.worldDrops.cancel")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
