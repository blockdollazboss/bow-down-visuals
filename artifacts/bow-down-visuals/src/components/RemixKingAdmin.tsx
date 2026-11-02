import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Crown, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  parseRemixAdminEvents,
  remixShortlistAvailable,
  remixStatusTargets,
  remixWinnerAvailable,
  splitDraftError,
  splitDraftSum,
  type RemixEventBundle,
  type SplitDraft,
} from "@/lib/admin-benches";

/* ─── Admin: Remix the King — the event bench ────────────────────────
   The remix-king admin verbs (POST/PATCH /admin/remix-king/events,
   …/status, /entries/:id/shortlist, …/events/:id/winner,
   /releases/:id/split-payments) had NO frontend consumer: the
   monthly event could only be run by hand-rolled API calls. This
   bench docks onto those exact verbs. The list rides
   GET /admin/remix-king/events (added with this bench — every public
   read hides drafts, so the team's own events were invisible).
   The bench never offers a move the rail would refuse: status
   buttons are the rail's own transition table, the splits editor
   mirrors the published-splits contract (unique roles, winner
   required, sum exactly 100), edits exist only on drafts (terms
   freeze once live), the crown is offered only while judging, and
   cancelling — the one irreversible move — goes through a confirm. */

const STATUS_CLS: Record<string, string> = {
  draft: "border-white/20 bg-white/5 text-white/60",
  open: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  judging: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  decided: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  released: "border-primary/50 bg-primary/10 text-[#e8c86a]",
  cancelled: "border-red-400/40 bg-red-400/10 text-red-300",
};

const STATUS_KEY: Record<string, string> = {
  draft: "admin.remixKing.status.draft",
  open: "admin.remixKing.status.open",
  judging: "admin.remixKing.status.judging",
  decided: "admin.remixKing.status.decided",
  released: "admin.remixKing.status.released",
  cancelled: "admin.remixKing.status.cancelled",
};

const ENTRY_STATUS_KEY: Record<string, string> = {
  submitted: "admin.remixKing.entryStatus.submitted",
  shortlisted: "admin.remixKing.entryStatus.shortlisted",
  winner: "admin.remixKing.entryStatus.winner",
  not_selected: "admin.remixKing.entryStatus.notSelected",
};

const ROLE_KEY: Record<string, string> = {
  winner: "admin.remixKing.splitRole.winner",
  king: "admin.remixKing.splitRole.king",
  house: "admin.remixKing.splitRole.house",
};

const SPLIT_ERROR_KEY: Record<string, string> = {
  empty: "admin.remixKing.splitError.empty",
  tooMany: "admin.remixKing.splitError.tooMany",
  roleUnknown: "admin.remixKing.splitError.roleUnknown",
  roleDuplicate: "admin.remixKing.splitError.roleDuplicate",
  nameMissing: "admin.remixKing.splitError.nameMissing",
  shareRange: "admin.remixKing.splitError.shareRange",
  winnerMissing: "admin.remixKing.splitError.winnerMissing",
  sumNot100: "admin.remixKing.splitError.sumNot100",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function railMessage(res: Response): Promise<string | null> {
  try {
    const j = (await res.json()) as { error?: unknown };
    return typeof j.error === "string" ? j.error : null;
  } catch {
    return null;
  }
}

const inputCls =
  "rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30";
const labelCls = "block text-[11px] font-semibold uppercase tracking-wider text-white/40";

function defaultSplits(): SplitDraft[] {
  return [
    { role: "winner", payeeName: "Winning Remixer", payeeUserId: "", sharePct: "50" },
    { role: "king", payeeName: "Thy Cheat Code", payeeUserId: "", sharePct: "30" },
    { role: "house", payeeName: "Bow Down Visuals", payeeUserId: "", sharePct: "20" },
  ];
}

function SplitsEditor({
  draft,
  setDraft,
  disabled,
}: {
  draft: SplitDraft[];
  setDraft: (d: SplitDraft[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const error = splitDraftError(draft);
  return (
    <div>
      <div className="space-y-2">
        {draft.map((s, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className={labelCls}>
              {t("admin.remixKing.splitRoleLabel")}
              <select
                value={s.role}
                disabled={disabled}
                onChange={(e) => setDraft(draft.map((x, xi) => (xi === i ? { ...x, role: e.target.value } : x)))}
                className={`${inputCls} mt-1 block`}
              >
                {["winner", "king", "house"].map((role) => (
                  <option key={role} value={role}>
                    {t(ROLE_KEY[role] ?? "", { defaultValue: role })}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${labelCls} flex-1 min-w-[9rem]`}>
              {t("admin.remixKing.payeeNameLabel")}
              <input
                type="text"
                maxLength={80}
                value={s.payeeName}
                disabled={disabled}
                onChange={(e) => setDraft(draft.map((x, xi) => (xi === i ? { ...x, payeeName: e.target.value } : x)))}
                className={`${inputCls} mt-1 block w-full`}
              />
            </label>
            <label className={labelCls}>
              {t("admin.remixKing.payeeUserLabel")}
              <input
                type="text"
                maxLength={64}
                value={s.payeeUserId}
                disabled={disabled}
                onChange={(e) => setDraft(draft.map((x, xi) => (xi === i ? { ...x, payeeUserId: e.target.value } : x)))}
                className={`${inputCls} mt-1 block w-32`}
              />
            </label>
            <label className={labelCls}>
              {t("admin.remixKing.shareLabel")}
              <input
                type="number"
                min={1}
                max={100}
                value={s.sharePct}
                disabled={disabled}
                onChange={(e) => setDraft(draft.map((x, xi) => (xi === i ? { ...x, sharePct: e.target.value } : x)))}
                className={`${inputCls} mt-1 block w-20`}
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDraft(draft.filter((_, xi) => xi !== i))}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("admin.remixKing.removeSplit")}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || draft.length >= 3}
          onClick={() => setDraft([...draft, { role: "house", payeeName: "", payeeUserId: "", sharePct: "10" }])}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> {t("admin.remixKing.addSplit")}
        </button>
        <span className="text-xs text-white/50">{t("admin.remixKing.splitsSum", { sum: splitDraftSum(draft) })}</span>
        {error && (
          <span className="text-xs font-semibold text-red-300">
            {t(SPLIT_ERROR_KEY[error] ?? "admin.remixKing.actionError")}
          </span>
        )}
      </div>
    </div>
  );
}

interface EventDraft {
  title: string;
  kingTrackTitle: string;
  kingTrackAudioUrl: string;
  kingTrackStemsUrl: string;
  description: string;
  entriesOpenAt: string;
  entriesCloseAt: string;
  splits: SplitDraft[];
}

function seedDraft(bundle: RemixEventBundle): EventDraft {
  const e = bundle.event;
  return {
    title: e.title,
    kingTrackTitle: e.kingTrackTitle,
    kingTrackAudioUrl: e.kingTrackAudioUrl ?? "",
    kingTrackStemsUrl: e.kingTrackStemsUrl ?? "",
    description: e.description,
    entriesOpenAt: toLocalInput(e.entriesOpenAt),
    entriesCloseAt: toLocalInput(e.entriesCloseAt),
    splits: e.splits.map((s) => ({
      role: s.role,
      payeeName: s.payeeName,
      payeeUserId: s.payeeUserId ?? "",
      sharePct: String(s.sharePct),
    })),
  };
}

export function RemixKingAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [bundles, setBundles] = useState<RemixEventBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  /* Create form. */
  const now = new Date();
  const [monthKey, setMonthKey] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [createDraft, setCreateDraft] = useState<EventDraft>({
    title: "",
    kingTrackTitle: "",
    kingTrackAudioUrl: "",
    kingTrackStemsUrl: "",
    description: "",
    entriesOpenAt: "",
    entriesCloseAt: "",
    splits: defaultSplits(),
  });
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, EventDraft>>({});
  const [eventMsg, setEventMsg] = useState<Record<string, string>>({});
  const [crownConfirmFor, setCrownConfirmFor] = useState<string | null>(null);
  const [cancelConfirmFor, setCancelConfirmFor] = useState<string | null>(null);
  const [payDraft, setPayDraft] = useState<Record<string, { period: string; totalVb: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/remix-king/events", { headers: await authHeaders() });
      const parsed = res.ok ? parseRemixAdminEvents(await res.json()) : null;
      if (parsed) {
        setBundles(parsed);
        setDrafts(Object.fromEntries(parsed.map((b) => [b.event.id, seedDraft(b)])));
        setPayDraft(
          Object.fromEntries(
            parsed
              .filter((b) => b.release)
              .map((b) => [b.event.id, { period: b.event.monthKey, totalVb: "" }]),
          ),
        );
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  const splitsBody = (draft: SplitDraft[]) =>
    draft.map((s) => ({
      role: s.role,
      payeeName: s.payeeName.trim(),
      payeeUserId: s.payeeUserId.trim() ? s.payeeUserId.trim() : null,
      sharePct: Number(s.sharePct),
    }));

  const createEvent = async () => {
    if (splitDraftError(createDraft.splits)) {
      setActionError(t("admin.remixKing.createInvalid"));
      return;
    }
    setBusy("create");
    setActionError(null);
    setCreateMsg(null);
    try {
      const res = await fetch("/api/admin/remix-king/events", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          month_key: monthKey,
          title: createDraft.title,
          king_track_title: createDraft.kingTrackTitle,
          king_track_audio_url: createDraft.kingTrackAudioUrl.trim() || null,
          king_track_stems_url: createDraft.kingTrackStemsUrl.trim() || null,
          description: createDraft.description,
          splits: splitsBody(createDraft.splits),
          entries_open_at: fromLocalInput(createDraft.entriesOpenAt),
          entries_close_at: fromLocalInput(createDraft.entriesCloseAt),
        }),
      });
      if (res.ok) {
        setCreateMsg(t("admin.remixKing.createdMsg", { month: monthKey }));
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));
      }
    } catch {
      setActionError(t("admin.remixKing.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async (bundle: RemixEventBundle) => {
    const draft = drafts[bundle.event.id];
    if (!draft) return;
    if (splitDraftError(draft.splits)) {
      setActionError(t("admin.remixKing.createInvalid"));
      return;
    }
    setBusy(`draft:${bundle.event.id}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/remix-king/events/${bundle.event.id}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          king_track_title: draft.kingTrackTitle,
          king_track_audio_url: draft.kingTrackAudioUrl.trim() || null,
          king_track_stems_url: draft.kingTrackStemsUrl.trim() || null,
          description: draft.description,
          splits: splitsBody(draft.splits),
          entries_open_at: fromLocalInput(draft.entriesOpenAt),
          entries_close_at: fromLocalInput(draft.entriesCloseAt),
        }),
      });
      if (res.ok) {
        setEventMsg((m) => ({ ...m, [bundle.event.id]: t("admin.remixKing.draftSaved") }));
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));
      }
    } catch {
      setActionError(t("admin.remixKing.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const moveStatus = async (bundle: RemixEventBundle, status: string) => {
    setBusy(`status:${bundle.event.id}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/remix-king/events/${bundle.event.id}/status`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setCancelConfirmFor(null);
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));
        setCancelConfirmFor(null);
      }
    } catch {
      setActionError(t("admin.remixKing.actionError"));
      setCancelConfirmFor(null);
    } finally {
      setBusy(null);
    }
  };

  const toggleShortlist = async (bundle: RemixEventBundle, entryId: string, shortlisted: boolean) => {
    setBusy(`shortlist:${entryId}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/remix-king/entries/${entryId}/shortlist`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ shortlisted }),
      });
      if (res.ok) await load();
      else setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));
    } catch {
      setActionError(t("admin.remixKing.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const crown = async (bundle: RemixEventBundle, entryId: string) => {
    setBusy(`crown:${bundle.event.id}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/remix-king/events/${bundle.event.id}/winner`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId }),
      });
      if (res.ok) {
        setEventMsg((m) => ({ ...m, [bundle.event.id]: t("admin.remixKing.crownedMsg") }));
        setCrownConfirmFor(null);
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));
        setCrownConfirmFor(null);
      }
    } catch {
      setActionError(t("admin.remixKing.actionError"));
      setCrownConfirmFor(null);
    } finally {
      setBusy(null);
    }
  };

  const paySplits = async (bundle: RemixEventBundle) => {
    if (!bundle.release) return;
    const draft = payDraft[bundle.event.id] ?? { period: bundle.event.monthKey, totalVb: "" };
    const total = Number(draft.totalVb);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.period) || !Number.isInteger(total) || total < 0) {
      setActionError(t("admin.remixKing.payInvalid"));
      return;
    }
    setBusy(`pay:${bundle.event.id}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/remix-king/releases/${bundle.release.id}/split-payments`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ period: draft.period, total_vb: total }),
      });
      if (res.ok) {
        setEventMsg((m) => ({
          ...m,
          [bundle.event.id]: t("admin.remixKing.payDone", { period: draft.period }),
        }));
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));
      }
    } catch {
      setActionError(t("admin.remixKing.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const eventFields = (
    draft: EventDraft,
    setDraft: (d: EventDraft) => void,
    disabled: boolean,
  ) => (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className={`${labelCls} flex-1 min-w-[12rem]`}>
          {t("admin.remixKing.titleLabel")}
          <input type="text" maxLength={120} value={draft.title} disabled={disabled} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${inputCls} mt-1 block w-full`} />
        </label>
        <label className={`${labelCls} flex-1 min-w-[12rem]`}>
          {t("admin.remixKing.trackTitleLabel")}
          <input type="text" maxLength={160} value={draft.kingTrackTitle} disabled={disabled} onChange={(e) => setDraft({ ...draft, kingTrackTitle: e.target.value })} className={`${inputCls} mt-1 block w-full`} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={`${labelCls} flex-1 min-w-[12rem]`}>
          {t("admin.remixKing.trackAudioLabel")}
          <input type="text" maxLength={1000} value={draft.kingTrackAudioUrl} disabled={disabled} onChange={(e) => setDraft({ ...draft, kingTrackAudioUrl: e.target.value })} className={`${inputCls} mt-1 block w-full`} />
        </label>
        <label className={`${labelCls} flex-1 min-w-[12rem]`}>
          {t("admin.remixKing.stemsLabel")}
          <input type="text" maxLength={1000} value={draft.kingTrackStemsUrl} disabled={disabled} onChange={(e) => setDraft({ ...draft, kingTrackStemsUrl: e.target.value })} className={`${inputCls} mt-1 block w-full`} />
        </label>
      </div>
      <label className={labelCls}>
        {t("admin.remixKing.descriptionLabel")}
        <textarea rows={2} maxLength={2000} value={draft.description} disabled={disabled} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${inputCls} mt-1 block w-full`} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className={labelCls}>
          {t("admin.remixKing.entriesOpenLabel")}
          <input type="datetime-local" value={draft.entriesOpenAt} disabled={disabled} onChange={(e) => setDraft({ ...draft, entriesOpenAt: e.target.value })} className={`${inputCls} mt-1 block`} />
        </label>
        <label className={labelCls}>
          {t("admin.remixKing.entriesCloseLabel")}
          <input type="datetime-local" value={draft.entriesCloseAt} disabled={disabled} onChange={(e) => setDraft({ ...draft, entriesCloseAt: e.target.value })} className={`${inputCls} mt-1 block`} />
        </label>
      </div>
      <div>
        <p className="mb-2 text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.remixKing.splitsTitle")}
        </p>
        <SplitsEditor
          draft={draft.splits}
          setDraft={(splits) => setDraft({ ...draft, splits })}
          disabled={disabled}
        />
      </div>
    </div>
  );

  return (
    <div
      className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="remix-king-admin-bench"
    >
      <div className="flex items-center gap-2 mb-1">
        <Crown className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.remixKing.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">{t("admin.remixKing.description")}</p>

      {actionError && <p className="mb-3 text-sm font-bold text-red-400">{actionError}</p>}

      {/* ── Create an event ──────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.remixKing.createTitle")}
        </p>
        <label className={`${labelCls} mt-3`}>
          {t("admin.remixKing.monthLabel")}
          <input type="text" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} placeholder="2026-12" className={`${inputCls} mt-1 block w-32`} />
        </label>
        <div className="mt-3">{eventFields(createDraft, setCreateDraft, busy !== null)}</div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void createEvent()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
        >
          {busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("admin.remixKing.createButton")}
        </button>
        {createMsg && <p className="mt-2 text-xs font-semibold text-emerald-300">{createMsg}</p>}
      </div>

      {/* ── Events ───────────────────────────────────────────────── */}
      {loading ? (
        <p className="mt-4 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`mt-4 rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("admin.remixKing.loadErrorTitle")}
          </p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("admin.remixKing.loadErrorBody")}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : bundles.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">{t("admin.remixKing.empty")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {bundles.map((bundle) => {
            const ev = bundle.event;
            const draft = drafts[ev.id] ?? seedDraft(bundle);
            const targets = remixStatusTargets(ev.status);
            const pay = payDraft[ev.id] ?? { period: ev.monthKey, totalVb: "" };
            return (
              <div key={ev.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <p className="text-sm font-semibold text-white">
                    {ev.title} <span className="ml-1 text-xs font-normal text-white/40">{ev.monthKey}</span>
                  </p>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[ev.status] ?? STATUS_CLS.draft}`}>
                    {t(STATUS_KEY[ev.status] ?? "", { defaultValue: ev.status })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/50">
                  {t("admin.remixKing.trackLine", { title: ev.kingTrackTitle, count: bundle.entries.length })}
                </p>
                {eventMsg[ev.id] && (
                  <p className="mt-2 text-xs font-semibold text-emerald-300">{eventMsg[ev.id]}</p>
                )}

                {/* status moves */}
                {targets.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {targets.map((target) =>
                      target === "cancelled" && cancelConfirmFor !== ev.id ? (
                        <button
                          key={target}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setCancelConfirmFor(ev.id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-400/20 disabled:opacity-50"
                        >
                          {t("admin.remixKing.moveTo", { status: t(STATUS_KEY[target] ?? "", { defaultValue: target }) })}
                        </button>
                      ) : target === "cancelled" ? (
                        <span key={target} className="inline-flex flex-wrap items-center gap-2" data-testid="remix-cancel-confirm">
                          <span className={`text-xs font-semibold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                            {t("admin.remixKing.cancelConfirmBody")}
                          </span>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void moveStatus(bundle, "cancelled")}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                          >
                            {busy === `status:${ev.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            {t("admin.remixKing.cancelConfirmButton")}
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setCancelConfirmFor(null)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-50"
                          >
                            {t("admin.remixKing.keepButton")}
                          </button>
                        </span>
                      ) : (
                        <button
                          key={target}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void moveStatus(bundle, target)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
                        >
                          {busy === `status:${ev.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {t("admin.remixKing.moveTo", { status: t(STATUS_KEY[target] ?? "", { defaultValue: target }) })}
                        </button>
                      ),
                    )}
                  </div>
                )}

                {/* draft edit / frozen note */}
                {ev.status === "draft" ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs text-white/40 uppercase tracking-wider font-semibold">
                      {t("admin.remixKing.editTitle")}
                    </p>
                    {eventFields(draft, (d) => setDrafts((m) => ({ ...m, [ev.id]: d })), busy !== null)}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void saveDraft(bundle)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                    >
                      {busy === `draft:${ev.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      {t("admin.remixKing.saveDraft")}
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-white/40">{t("admin.remixKing.frozenNote")}</p>
                )}

                {/* entries */}
                <p className="mt-4 text-xs text-white/40 uppercase tracking-wider font-semibold">
                  {t("admin.remixKing.entriesTitle", { count: bundle.entries.length })}
                </p>
                {bundle.entries.length === 0 ? (
                  <p className="mt-1 text-sm text-white/40">{t("admin.remixKing.noEntries")}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {bundle.entries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{entry.remixTitle}</p>
                          <span className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] font-semibold text-white/60">
                            {t(ENTRY_STATUS_KEY[entry.status] ?? "", { defaultValue: entry.status })}
                          </span>
                          <span className="ml-auto text-xs text-white/50">
                            {t("admin.remixKing.votesLabel", { count: entry.voteCount })}
                          </span>
                        </div>
                        <p className="text-xs text-white/40">
                          {t("admin.remixKing.byEntrant", { name: entry.entrantName })}
                        </p>
                        {crownConfirmFor === entry.id ? (
                          <div
                            className={`mt-2 rounded-lg border p-3 ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/30 bg-black/40"}`}
                            data-testid="remix-crown-confirm"
                          >
                            <p className={`text-sm font-semibold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                              {t("admin.remixKing.crownConfirmBody", { title: entry.remixTitle })}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => void crown(bundle, entry.id)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                              >
                                {busy === `crown:${ev.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
                                {t("admin.remixKing.crownConfirmButton")}
                              </button>
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => setCrownConfirmFor(null)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-50"
                              >
                                {t("admin.remixKing.keepButton")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {remixShortlistAvailable(entry) && (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => void toggleShortlist(bundle, entry.id, entry.status !== "shortlisted")}
                                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
                              >
                                {entry.status === "shortlisted"
                                  ? t("admin.remixKing.unshortlist")
                                  : t("admin.remixKing.shortlist")}
                              </button>
                            )}
                            {remixWinnerAvailable(ev) && entry.status !== "winner" && (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => setCrownConfirmFor(entry.id)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-[#C9A84C]/50 bg-[#C9A84C]/10 px-3 py-1.5 text-xs font-semibold text-[#e8c86a] hover:bg-[#C9A84C]/20 disabled:opacity-50"
                              >
                                <Crown className="h-3.5 w-3.5" /> {t("admin.remixKing.crownButton")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* release + split payments */}
                {bundle.release && (
                  <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3">
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                      {t("admin.remixKing.releaseTitle")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">{bundle.release.releaseTitle}</p>
                    <p className="text-xs text-white/50">
                      {t("admin.remixKing.releaseLine", {
                        name: bundle.release.winnerName,
                        status: bundle.release.status,
                      })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {bundle.release.splits.map((s) => (
                        <span key={s.role} className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                          {t(ROLE_KEY[s.role] ?? "", { defaultValue: s.role })} · {s.payeeName} · {s.sharePct}%
                        </span>
                      ))}
                    </div>

                    <p className="mt-4 text-xs text-white/40 uppercase tracking-wider font-semibold">
                      {t("admin.remixKing.paymentsTitle")}
                    </p>
                    {bundle.payments.length === 0 ? (
                      <p className="mt-1 text-sm text-white/40">{t("admin.remixKing.noPayments")}</p>
                    ) : (
                      <div className="mt-2 space-y-1.5">
                        {bundle.payments.map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                            <span className="font-semibold text-white/85">{p.payeeName}</span>
                            <span>{t(ROLE_KEY[p.role] ?? "", { defaultValue: p.role })}</span>
                            <span>{p.sharePct}%</span>
                            <span className="text-white/90 font-semibold">{p.amountVb.toLocaleString()} VB</span>
                            <span>{p.period}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${p.status === "paid" ? "border-emerald-400/30 text-emerald-300" : "border-[#C9A84C]/50 text-[#e8c86a]"}`}>
                              {t(p.status === "paid" ? "admin.remixKing.paymentStatus.paid" : "admin.remixKing.paymentStatus.pending")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <label className={labelCls}>
                        {t("admin.remixKing.payPeriodLabel")}
                        <input
                          type="text"
                          value={pay.period}
                          onChange={(e) => setPayDraft((m) => ({ ...m, [ev.id]: { ...pay, period: e.target.value } }))}
                          className={`${inputCls} mt-1 block w-28`}
                        />
                      </label>
                      <label className={labelCls}>
                        {t("admin.remixKing.payTotalLabel")}
                        <input
                          type="number"
                          min={0}
                          value={pay.totalVb}
                          onChange={(e) => setPayDraft((m) => ({ ...m, [ev.id]: { ...pay, totalVb: e.target.value } }))}
                          className={`${inputCls} mt-1 block w-32`}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void paySplits(bundle)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                      >
                        {busy === `pay:${ev.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {t("admin.remixKing.payButton")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-white/30">{t("admin.remixKing.footerNote")}</p>
    </div>
  );
}
