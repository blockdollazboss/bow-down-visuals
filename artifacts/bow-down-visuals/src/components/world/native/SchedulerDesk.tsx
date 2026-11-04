import { apiErrorMessage } from "../../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, ChevronLeft, ChevronRight, Link2, Link2Off, MoveRight, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { prettyDateTime, countdownLabel } from "@/lib/scheduler";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  SCHEDULER_BEST_TIME_COST_VISUAL_BUCS,
  SCHEDULER_PLATFORMS,
  SCHEDULER_POST_COST_VISUAL_BUCS,
  accountsForPlatform,
  bestTimeSlotWhen,
  buildBestTimePayload,
  buildSchedulerCreatePayload,
  buildSchedulerUpdatePayload,
  composeFromPost,
  editableSchedulerPost,
  emptySchedulerCompose,
  parseBestTimeResult,
  parseSchedulerAccounts,
  parseSchedulerDeleteResult,
  parseSchedulerDeskPosts,
  parseSchedulerPostResponse,
  resolveAccountId,
  schedulerSavedReceipt,
  sortSchedulerDeskPosts,
  validateSchedulerCompose,
  SOCIAL_CONNECT_PLATFORMS,
  buildReschedulePayload,
  calendarMonthCells,
  calendarMonthLabel,
  calendarPostsByDay,
  calendarToday,
  composeWhenForDay,
  parseSchedulerAccountStates,
  parseSocialAuthUrl,
  planDeskReschedule,
  type BestTimeSlot,
  type PostingAccountState,
  type SchedulerAccount,
  type SchedulerComposeDraft,
  type SchedulerDeskPost,
  type SchedulerPlatformKey,
  type SchedulerPrefill,
} from "@/lib/world/scheduler-desk";

/* ─── The in-world Scheduler (Stack-100 #45/#46) ────────────────────
   The Promote Room's folded read-only calendar, finished: compose,
   schedule, edit and cancel/delete all complete HERE on the 2D
   scheduler page's own rails (/api/scheduler/posts +
   /api/scheduler/best-time + /api/social/accounts). Prices are the
   rails' own and are shown before anything runs: scheduling a post
   reserves 100 Visual Bucs (refunded automatically on cancel),
   drafts are free, a best-time ask is 100 Visual Bucs (refunded if
   the AI fails). Charged calls ride the site's credit confirmation
   (useConfirmedApi) exactly like the other desks' paid actions.
   The same compose form is what every "Schedule it" chip in the
   Create Wing opens (SchedulerComposeStandalone below). */

function useSchedulerAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

interface ComposeFormProps {
  isLight: boolean;
  accounts: SchedulerAccount[];
  accountsFailed: boolean;
  /** The post being edited, or null for a fresh compose. */
  editing: SchedulerDeskPost | null;
  initialDraft: SchedulerComposeDraft;
  onSaved: (post: SchedulerDeskPost | null, mode: "created" | "updated") => void;
  onCancelEdit?: () => void;
}

function SchedulerComposeForm(props: ComposeFormProps) {
  const { t, i18n } = useTranslation();
  const { isLight, accounts, editing } = props;
  const authHeaders = useSchedulerAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [draft, setDraft] = useState<SchedulerComposeDraft>(props.initialDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLine, setSavedLine] = useState<string | null>(null);

  /* Best time (POST /api/scheduler/best-time). */
  const [niche, setNiche] = useState("Music");
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [btBusy, setBtBusy] = useState(false);
  const [btSlots, setBtSlots] = useState<BestTimeSlot[]>([]);
  const [btNote, setBtNote] = useState<string | null>(null);
  const [btError, setBtError] = useState<string | null>(null);

  /* A new initial draft (a chip's prefill, an Edit tap) reseeds the
     form wholesale — the form never half-remembers the last post.
     Keyed on the draft's CONTENT, not its object identity: a parent
     re-render (accounts finishing loading, a desk re-render) hands
     down an equal-but-new prefill object and must never wipe what
     the member has already typed. */
  const seedKey = JSON.stringify(props.initialDraft);
  useEffect(() => {
    setDraft(props.initialDraft);
    setError(null);
    setSavedLine(null);
    setBtSlots([]);
    setBtNote(null);
    setBtError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const set = (patch: Partial<SchedulerComposeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const togglePlatform = (key: SchedulerPlatformKey) => {
    setDraft((d) => {
      const has = d.platforms.includes(key);
      const platforms = has ? d.platforms.filter((p) => p !== key) : [...d.platforms, key];
      const accountIds = { ...d.accountIds };
      if (!has) {
        const resolved = resolveAccountId(accounts, key, accountIds[key]);
        if (resolved) accountIds[key] = resolved;
      }
      return { ...d, platforms, accountIds };
    });
  };

  const willSchedule = draft.whenLocal.trim().length > 0;
  const chargesNow =
    willSchedule && (editing === null || editing.status === "draft");

  const save = async () => {
    if (busy) return;
    const problem = validateSchedulerCompose(draft, accounts, {
      forSchedule: willSchedule,
      nowMs: Date.now(),
      strings: {
        needMedia: t("worldScheduleRelease.schedValNeedMedia"),
        needPlatform: t("worldScheduleRelease.schedValNeedPlatform"),
        needAccount: t("worldScheduleRelease.schedValNeedAccount"),
        needFutureTime: t("worldScheduleRelease.schedValNeedFutureTime"),
      },
    });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setSavedLine(null);
    try {
      const payload = editing
        ? buildSchedulerUpdatePayload(draft, accounts, willSchedule)
        : buildSchedulerCreatePayload(draft, accounts, willSchedule);
      const url = editing ? `/api/scheduler/posts/${editing.id}` : "/api/scheduler/posts";
      const init: RequestInit = {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      };
      const res = chargesNow
        ? await confirmedFetch(url, init)
        : await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(await authHeaders()) } });
      if (!res) return; // credit confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { message?: string; error?: string };
        setError(
          res.status === 402
            ? t("worldScheduleRelease.schedOutOfBucsSchedule")
            : apiErrorMessage(d, t("worldScheduleRelease.schedSaveFailed")),
        );
        return;
      }
      const post = parseSchedulerPostResponse(data);
      refreshProfile();
      /* Item 71: the receipt names the post (title), its time and
         its channels — built by the desk lib so the words are the
         server's post when it parsed, the just-saved draft when
         it didn't. */
      setSavedLine(schedulerSavedReceipt(post, draft, willSchedule, {
        yourPost: t("worldScheduleRelease.schedReceiptYourPost"),
        draftReceipt: t("worldScheduleRelease.schedReceiptDraft"),
        scheduledPrefix: t("worldScheduleRelease.schedReceiptScheduled"),
        whenPart: t("worldScheduleRelease.schedReceiptFor"),
        channelsPart: t("worldScheduleRelease.schedReceiptOn"),
        channelsAnd: t("worldScheduleRelease.schedReceiptAnd"),
        receiptTail: t("worldScheduleRelease.schedReceiptTail"),
      }));
      props.onSaved(post, editing ? "updated" : "created");
      if (!editing) setDraft(emptySchedulerCompose());
    } catch {
      setError(t("worldScheduleRelease.schedNoAnswer"));
    } finally {
      setBusy(false);
    }
  };

  const askBestTime = async () => {
    if (btBusy) return;
    if (draft.platforms.length === 0) {
      setBtError(t("worldScheduleRelease.schedBestTimeNeedPlatform"));
      return;
    }
    setBtBusy(true);
    setBtError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
      const res = await confirmedFetch("/api/scheduler/best-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildBestTimePayload({ niche: niche.trim() || "Music", platforms: draft.platforms, postsPerWeek, timezone }),
        ),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { message?: string };
        setBtError(
          res.status === 402
            ? t("worldScheduleRelease.schedOutOfBucsBestTime")
            : apiErrorMessage(d, t("worldScheduleRelease.schedBestTimeFailedRefund")),
        );
        return;
      }
      const { slots, note } = parseBestTimeResult(data);
      if (slots.length === 0) {
        setBtError(t("worldScheduleRelease.schedBestTimeNoSlots"));
        return;
      }
      setBtSlots(slots);
      setBtNote(note);
      refreshProfile();
    } catch {
      setBtError(t("worldScheduleRelease.schedBestTimeFailedRefund"));
    } finally {
      setBtBusy(false);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const noteCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const saveLabel = editing
    ? willSchedule
      ? editing.status === "scheduled"
        ? t("scheduler.composer.saveChanges")
        : t("worldScheduleRelease.schedScheduleButtonMoney", { cost: SCHEDULER_POST_COST_VISUAL_BUCS })
      : editing.status === "scheduled"
        ? t("worldScheduleRelease.schedSaveAsDraftUnschedule")
        : t("scheduler.composer.saveChanges")
    : willSchedule
      ? t("worldScheduleRelease.schedScheduleButtonMoney", { cost: SCHEDULER_POST_COST_VISUAL_BUCS })
      : t("worldScheduleRelease.schedSaveDraftFree");

  return (
    <div className="space-y-2" data-testid="world-scheduler-compose">
      {editing ? (
        <p className={`flex items-center gap-2 text-xs font-bold ${muted}`}>
          <Pencil className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldScheduleRelease.schedEditingLine", { status: editing.status })}
          {props.onCancelEdit ? (
            <button type="button" data-testid="world-scheduler-edit-cancel" onClick={props.onCancelEdit} className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 bdv-touch-target">
              <X className="h-3.5 w-3.5" /> {t("worldScheduleRelease.schedStopEditing")}
            </button>
          ) : null}
        </p>
      ) : null}

      <input
        aria-label={t("worldScheduleRelease.schedMediaAria")}
        data-testid="world-scheduler-media"
        className={inputCls(isLight)}
        placeholder={t("worldScheduleRelease.schedMediaPlaceholder")}
        value={draft.mediaUrl}
        onChange={(e) => set({ mediaUrl: e.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={t("worldScheduleRelease.schedMediaKindAria")}
          data-testid="world-scheduler-media-type"
          className={inputCls(isLight)}
          style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }}
          value={draft.mediaType}
          onChange={(e) => set({ mediaType: e.target.value === "image" ? "image" : "video" })}
        >
          <option value="video">{t("worldScheduleRelease.schedMediaVideo")}</option>
          <option value="image">{t("worldScheduleRelease.schedMediaImage")}</option>
        </select>
        <input
          aria-label={t("worldScheduleRelease.schedWhenAria")}
          data-testid="world-scheduler-when"
          type="datetime-local"
          className={inputCls(isLight)}
          style={{ colorScheme: isLight ? "light" : "dark", width: "auto", flex: "1 1 200px" }}
          value={draft.whenLocal}
          onChange={(e) => set({ whenLocal: e.target.value })}
        />
      </div>
      <textarea
        aria-label={t("scheduler.composer.caption")}
        data-testid="world-scheduler-caption"
        className={inputCls(isLight)}
        rows={3}
        placeholder={t("worldScheduleRelease.schedCaptionPlaceholder")}
        value={draft.caption}
        onChange={(e) => set({ caption: e.target.value })}
      />
      <input
        aria-label={t("scheduler.composer.hashtags")}
        data-testid="world-scheduler-hashtags"
        className={inputCls(isLight)}
        placeholder={t("worldScheduleRelease.schedHashtagsPlaceholder")}
        value={draft.hashtags}
        onChange={(e) => set({ hashtags: e.target.value })}
      />

      <div className="flex flex-wrap items-center gap-1.5" data-testid="world-scheduler-platforms">
        {SCHEDULER_PLATFORMS.map((p) => (
          <button
            key={p.key}
            type="button"
            data-testid={`world-scheduler-platform-${p.key}`}
            aria-pressed={draft.platforms.includes(p.key)}
            onClick={() => togglePlatform(p.key)}
            className={chipBtn(isLight, draft.platforms.includes(p.key))}
          >
            {p.label}
          </button>
        ))}
      </div>
      {draft.platforms.map((platform) => {
        const options = accountsForPlatform(accounts, platform);
        const label = SCHEDULER_PLATFORMS.find((p) => p.key === platform)?.label ?? platform;
        return (
          <label key={platform} className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("worldScheduleRelease.schedAccountLabel", { label })}
            </span>
            {options.length === 0 ? (
              <span className={`text-xs ${muted}`} data-testid={`world-scheduler-no-account-${platform}`}>
                {t("worldScheduleRelease.schedNoAccount", { label })}
              </span>
            ) : (
              <select
                aria-label={t("worldScheduleRelease.schedAccountLabel", { label })}
                data-testid={`world-scheduler-account-${platform}`}
                className={inputCls(isLight)}
                style={{ colorScheme: isLight ? "light" : "dark" }}
                value={resolveAccountId(accounts, platform, draft.accountIds[platform]) ?? ""}
                onChange={(e) =>
                  set({ accountIds: { ...draft.accountIds, [platform]: e.target.value } })
                }
              >
                {options.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.expired}>
                    {a.label}
                    {a.expired ? t("worldScheduleRelease.schedAccountExpiredSuffix") : ""}
                  </option>
                ))}
              </select>
            )}
          </label>
        );
      })}
      {props.accountsFailed ? (
        <p className={noteCls}>{t("worldScheduleRelease.schedAccountsFailedNote")}</p>
      ) : null}

      <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-scheduler-best-time">
        <p className={`text-xs font-bold ${muted}`}>
          {t("worldScheduleRelease.schedBestTimeIntro", { cost: SCHEDULER_BEST_TIME_COST_VISUAL_BUCS })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label={t("worldScheduleRelease.schedNicheAria")}
            className={inputCls(isLight)}
            style={{ flex: "1 1 140px", width: "auto" }}
            placeholder={t("worldScheduleRelease.schedNichePlaceholder")}
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
          />
          <select
            aria-label={t("worldScheduleRelease.schedPostsPerWeekAria")}
            className={inputCls(isLight)}
            style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }}
            value={postsPerWeek}
            onChange={(e) => setPostsPerWeek(Number(e.target.value) || 3)}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {t(n === 1 ? "worldScheduleRelease.schedPostsPerWeekOne" : "worldScheduleRelease.schedPostsPerWeekMany", { count: n })}
              </option>
            ))}
          </select>
          <button type="button" data-testid="world-scheduler-best-time-ask" onClick={askBestTime} disabled={btBusy} className={goldBtn}>
            <Sparkles className="h-4 w-4" /> {btBusy ? t("worldScheduleRelease.schedAsking") : t("worldScheduleRelease.schedAskBestTime")}
          </button>
        </div>
        {btError ? <p className={`mt-2 ${noteCls}`}>{btError}</p> : null}
        {btSlots.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {btSlots.map((slot, i) => (
              <div key={`${slot.date}-${slot.time}-${slot.platform}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className={`text-xs ${muted}`}>
                  {slot.date} · {slot.time} · {slot.platform}
                  {slot.reason ? ` — ${slot.reason}` : ""}
                </span>
                <button
                  type="button"
                  data-testid="world-scheduler-best-time-use"
                  onClick={() => {
                    set({ whenLocal: bestTimeSlotWhen(slot) });
                    if (!draft.platforms.includes(slot.platform)) togglePlatform(slot.platform);
                  }}
                  className={chipBtn(isLight, false)}
                >
                  {t("worldScheduleRelease.schedUseThisTime")}
                </button>
              </div>
            ))}
            {btNote ? <p className={`text-xs ${muted}`}>{btNote}</p> : null}
          </div>
        ) : null}
      </div>

      {error ? <p className={noteCls} data-testid="world-scheduler-error">{error}</p> : null}
      {savedLine ? <p className={`text-xs font-semibold ${isLight ? "text-emerald-800" : "text-emerald-300"}`} data-testid="world-scheduler-saved">{savedLine}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid="world-scheduler-save" onClick={save} disabled={busy} className={goldBtn}>
          <CalendarClock className="h-4 w-4" /> {busy ? t("worldScheduleRelease.schedSaving") : saveLabel}
        </button>
        <span className={`text-xs ${muted}`}>
          {willSchedule
            ? t("worldScheduleRelease.schedCostNoteSchedule", { cost: SCHEDULER_POST_COST_VISUAL_BUCS })
            : t("worldScheduleRelease.schedCostNoteDraft")}
        </span>
      </div>
    </div>
  );
}

/* ─── The full desk section (Promote Room) ────────────────────────── */

export function SchedulerDeskSection({
  isLight,
  prefill,
  prefillNonce,
}: {
  isLight: boolean;
  /** A creation handed to the composer (a promo card's Schedule tap). */
  prefill?: SchedulerPrefill | null;
  prefillNonce?: number;
}) {
  const { t, i18n } = useTranslation();
  const authHeaders = useSchedulerAuthHeaders();
  const { refreshProfile } = useAuth();
  const [posts, setPosts] = useState<SchedulerDeskPost[] | null>(null);
  const [postsFailed, setPostsFailed] = useState(false);
  const [accounts, setAccounts] = useState<SchedulerAccount[]>([]);
  const [accountStates, setAccountStates] = useState<PostingAccountState[]>([]);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [editing, setEditing] = useState<SchedulerDeskPost | null>(null);
  const [initialDraft, setInitialDraft] = useState<SchedulerComposeDraft>(() => emptySchedulerCompose(prefill));
  const [listNote, setListNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /* Full surface (#57): the month calendar + drag/move reschedule. */
  const [monthCursor, setMonthCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [dragPostId, setDragPostId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [postsRes, accountsRes] = await Promise.all([
        fetch("/api/scheduler/posts", { headers }),
        fetch("/api/social/accounts", { headers }),
      ]);
      if (!postsRes.ok) throw new Error("posts");
      setPosts(parseSchedulerDeskPosts(await postsRes.json().catch(() => null)));
      setPostsFailed(false);
      if (accountsRes.ok) {
        const raw: unknown = await accountsRes.json().catch(() => null);
        setAccounts(parseSchedulerAccounts(raw));
        setAccountStates(parseSchedulerAccountStates(raw));
        setAccountsFailed(false);
      } else {
        setAccountsFailed(true);
      }
    } catch {
      setPostsFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    void load();
  }, [load]);

  /* A fresh prefill (promo card Schedule) reseeds a NEW compose. */
  useEffect(() => {
    if (!prefill) return;
    setEditing(null);
    setInitialDraft(emptySchedulerCompose(prefill));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  const remove = async (post: SchedulerDeskPost) => {
    if (typeof window !== "undefined" && !window.confirm(
      post.status === "scheduled"
        ? t("worldScheduleRelease.schedCancelConfirm")
        : t("worldScheduleRelease.schedDeleteConfirm"),
    )) return;
    setListNote(null);
    try {
      const res = await fetch(`/api/scheduler/posts/${post.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { message?: string };
        setListNote(apiErrorMessage(d, t("worldScheduleRelease.schedRemoveFailed")));
        return;
      }
      const result = parseSchedulerDeleteResult(data);
      setListNote(
        result.canceled
          ? result.refunded > 0
            ? t("worldScheduleRelease.schedCanceledRefunded", { amount: result.refunded })
            : t("worldScheduleRelease.schedCanceled")
          : t("worldScheduleRelease.schedDeleted"),
      );
      if (editing?.id === post.id) {
        setEditing(null);
        setInitialDraft(emptySchedulerCompose());
      }
      refreshProfile();
      setTick((n) => n + 1);
    } catch {
      setListNote(t("worldScheduleRelease.schedRemoveFailed"));
    }
  };

  /* ── Reschedule (#57): drag a calendar chip onto a day, or use a
     row's explicit Move control — both plan through the 2D
     calendar's planReschedule and write through the same PATCH
     rail. The move is optimistic with rollback, exactly like the
     website calendar: the grid never shows a time the server
     doesn't hold. ── */
  const reschedule = async (post: SchedulerDeskPost, targetDate: string) => {
    const plan = planDeskReschedule(post, targetDate, Date.now());
    if (plan.kind === "noop") {
      setListNote(t("worldScheduleRelease.schedMoveNoop"));
      return;
    }
    if (plan.kind === "past") {
      setListNote(t("worldScheduleRelease.schedMovePast"));
      return;
    }
    if (plan.kind === "invalid" || !post.scheduledAt) {
      setListNote(t("worldScheduleRelease.schedMoveNoTime"));
      return;
    }
    const original = post.scheduledAt;
    setListNote(null);
    setPosts((prev) => (prev ?? []).map((p) => (p.id === post.id ? { ...p, scheduledAt: plan.scheduledAt } : p)));
    try {
      const res = await fetch(`/api/scheduler/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildReschedulePayload(plan.scheduledAt)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("patch");
      const saved = parseSchedulerPostResponse(data);
      if (saved) {
        setPosts((prev) => (prev ?? []).map((p) => (p.id === post.id ? saved : p)));
      }
      setListNote(t("worldScheduleRelease.schedMoved", { when: prettyDateTime(plan.scheduledAt) }));
    } catch {
      setPosts((prev) => (prev ?? []).map((p) => (p.id === post.id ? { ...p, scheduledAt: original } : p)));
      setListNote(t("worldScheduleRelease.schedMoveFailed"));
    }
  };

  /* ── Connect / disconnect posting accounts (#57): the website's
     own rails — GET the platform's auth-url, then the provider's
     full-page OAuth redirect (its requirement, same as Settings);
     disconnect is DELETE /api/social/accounts/:id. ── */
  const connect = async (authPath: string, label: string) => {
    if (connecting) return;
    setConnecting(label);
    setListNote(null);
    try {
      const res = await fetch(authPath, { headers: await authHeaders() });
      const data: unknown = await res.json().catch(() => ({}));
      const url = parseSocialAuthUrl(data);
      if (!res.ok || !url) {
        const d = data as { message?: string };
        setListNote(apiErrorMessage(d, t("worldScheduleRelease.schedConnectNotConfigured", { label })));
        setConnecting(null);
        return;
      }
      window.location.href = url;
    } catch {
      setListNote(t("worldScheduleRelease.schedConnectStartFailed", { label }));
      setConnecting(null);
    }
  };

  const disconnect = async (account: SchedulerAccount) => {
    if (typeof window !== "undefined" && !window.confirm(t("worldScheduleRelease.schedDisconnectConfirm", { label: account.label }))) return;
    setListNote(null);
    try {
      const res = await fetch(`/api/social/accounts/${account.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("disconnect");
      setListNote(t("worldScheduleRelease.schedDisconnectedNote", { label: account.label }));
      setTick((n) => n + 1);
    } catch {
      setListNote(t("worldScheduleRelease.schedDisconnectFailed"));
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const sorted = posts ? sortSchedulerDeskPosts(posts) : [];
  const byDay = posts ? calendarPostsByDay(posts) : new Map<string, SchedulerDeskPost[]>();
  const todayStr = calendarToday(Date.now());

  return (
    <NativeCard isLight={isLight} title={t("worldScheduleRelease.schedCardTitle")}>
      <div className="space-y-3" data-testid="world-scheduler-desk">
        {/* Posting accounts (#57) — connect/disconnect on the
            website's own rails, states read from the same account
            list the composer picks from. */}
        <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-scheduler-accounts">
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("scheduler.accounts.title")}
          </p>
          {accountsFailed ? (
            <p className={`mt-1.5 text-xs ${muted}`}>{t("worldScheduleRelease.schedAccountsLoadFailed")}</p>
          ) : (
            <div className="mt-2 space-y-2">
              {SOCIAL_CONNECT_PLATFORMS.map((cfg) => {
                const state = accountStates.find((s) => s.platform === cfg.key);
                const mine = accountsForPlatform(accounts, cfg.key);
                return (
                  <div key={cfg.key} className="flex flex-wrap items-center gap-2" data-testid={`world-scheduler-account-state-${cfg.key}`}>
                    <span className={`text-xs font-bold ${strong}`}>{cfg.label}</span>
                    <span className={`text-xs ${muted}`}>
                      {state?.state === "connected"
                        ? `${t("scheduler.accounts.connected")}${state.accountLabel ? ` — ${state.accountLabel}` : ""}`
                        : state?.state === "expired"
                          ? `${t("scheduler.accounts.expired")}${state.accountLabel ? ` — ${state.accountLabel}` : ""}`
                          : t("scheduler.accounts.notConnected")}
                    </span>
                    {state?.state !== "connected" ? (
                      <button
                        type="button"
                        data-testid={`world-scheduler-connect-${cfg.key}`}
                        disabled={connecting !== null}
                        onClick={() => void connect(cfg.authPath, cfg.label)}
                        className={chipBtn(isLight, false)}
                      >
                        <Link2 className="h-3.5 w-3.5" /> {connecting === cfg.label ? t("worldScheduleRelease.schedConnectOpening") : state?.state === "expired" ? t("worldScheduleRelease.schedReconnect") : t("worldScheduleRelease.schedConnect")}
                      </button>
                    ) : null}
                    {mine.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        data-testid={`world-scheduler-disconnect-${cfg.key}`}
                        onClick={() => void disconnect(a)}
                        className={chipBtn(isLight, false)}
                      >
                        <Link2Off className="h-3.5 w-3.5" /> {t("worldScheduleRelease.schedDisconnect", { label: a.label })}
                      </button>
                    ))}
                    {state?.state === "none" ? (
                      <span className={`text-[11px] ${muted}`}>
                        {cfg.key === "instagram"
                          ? t("worldScheduleRelease.schedBlurbInstagram")
                          : cfg.key === "tiktok"
                            ? t("worldScheduleRelease.schedBlurbTiktok")
                            : cfg.key === "facebook"
                              ? t("worldScheduleRelease.schedBlurbFacebook")
                              : cfg.key === "x"
                                ? t("worldScheduleRelease.schedBlurbX")
                                : cfg.blurb}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className={`mt-2 text-[11px] ${muted}`}>
            {t("worldScheduleRelease.schedConnectNote")}
          </p>
        </div>

        {/* Month calendar (#57) — drag a post chip onto a new day,
            or tap a day to start a post there. */}
        <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-scheduler-calendar">
          <div className="mb-2 flex items-center justify-between">
            <p className={`text-sm font-black ${strong}`}>{calendarMonthLabel(monthCursor.y, monthCursor.m, i18n.language)}</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                aria-label={t("scheduler.calendar.prevMonth")}
                data-testid="world-scheduler-cal-prev"
                onClick={() => {
                  const d = new Date(monthCursor.y, monthCursor.m - 1, 1);
                  setMonthCursor({ y: d.getFullYear(), m: d.getMonth() });
                }}
                className={chipBtn(isLight, false)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                data-testid="world-scheduler-cal-today"
                onClick={() => {
                  const n = new Date();
                  setMonthCursor({ y: n.getFullYear(), m: n.getMonth() });
                }}
                className={chipBtn(isLight, false)}
              >
                {t("scheduler.calendar.today")}
              </button>
              <button
                type="button"
                aria-label={t("scheduler.calendar.nextMonth")}
                data-testid="world-scheduler-cal-next"
                onClick={() => {
                  const d = new Date(monthCursor.y, monthCursor.m + 1, 1);
                  setMonthCursor({ y: d.getFullYear(), m: d.getMonth() });
                }}
                className={chipBtn(isLight, false)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {[t("scheduler.days.sun"), t("scheduler.days.mon"), t("scheduler.days.tue"), t("scheduler.days.wed"), t("scheduler.days.thu"), t("scheduler.days.fri"), t("scheduler.days.sat")].map((d) => (
              <div key={d} className={`pb-0.5 text-center text-[10px] font-bold uppercase tracking-widest ${muted}`}>{d}</div>
            ))}
            {calendarMonthCells(monthCursor.y, monthCursor.m).map((cell, i) => {
              if (!cell.date) return <div key={`blank-${i}`} className="min-h-[52px]" />;
              const dayPosts = byDay.get(cell.date) ?? [];
              const isPast = cell.date < todayStr;
              const isToday = cell.date === todayStr;
              const isOver = dragOverDay === cell.date;
              return (
                <div
                  key={cell.date}
                  data-testid="world-scheduler-cal-day"
                  onClick={() => {
                    if (isPast) return;
                    setEditing(null);
                    setInitialDraft({ ...emptySchedulerCompose(), whenLocal: composeWhenForDay(cell.date!) });
                  }}
                  role={isPast ? undefined : "button"}
                  tabIndex={isPast ? undefined : 0}
                  aria-label={
                    isPast
                      ? undefined
                      : t("worldScheduleRelease.schedCalStartAria", {
                          date: new Date(`${cell.date}T12:00:00`).toLocaleDateString(i18n.language, {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          }),
                        })
                  }
                  onKeyDown={(e) => {
                    if (isPast) return;
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setEditing(null);
                      setInitialDraft({ ...emptySchedulerCompose(), whenLocal: composeWhenForDay(cell.date!) });
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverDay(cell.date);
                  }}
                  onDragLeave={() => setDragOverDay(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverDay(null);
                    const post = (posts ?? []).find((p) => p.id === dragPostId);
                    setDragPostId(null);
                    if (post && !isPast) void reschedule(post, cell.date!);
                  }}
                  className={`min-h-[52px] rounded-lg border p-1 transition ${
                    isOver
                      ? "border-[#d4af37] bg-[#d4af37]/15"
                      : isToday
                        ? isLight
                          ? "border-[#C9A84C] bg-white/50"
                          : "border-[#d4af37]/60 bg-white/5"
                        : isLight
                          ? "border-[#C9A84C]/25"
                          : "border-white/10"
                  } ${isPast ? "opacity-50" : "cursor-pointer"}`}
                >
                  <div className={`text-[10px] font-bold ${isToday ? "text-[#d4af37]" : muted}`}>{Number(cell.date.slice(8))}</div>
                  <div className="mt-0.5 space-y-0.5">
                    {dayPosts.slice(0, 2).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        draggable
                        data-testid="world-scheduler-cal-chip"
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDragPostId(p.id);
                        }}
                        onDragEnd={() => setDragPostId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(p);
                          setInitialDraft(composeFromPost(p));
                        }}
                        className={`block w-full truncate rounded px-1 py-0.5 text-left text-[9px] font-bold ${isLight ? "bg-[#d4af37]/25 text-[#2a1e07]" : "bg-[#d4af37]/20 text-[#e8c86a]"} ${dragPostId === p.id ? "opacity-40" : ""}`}
                        title={p.scheduledAt ? prettyDateTime(p.scheduledAt) : p.caption}
                      >
                        {p.scheduledAt
                          ? new Date(p.scheduledAt).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" })
                          : ""}{" "}
                        {p.caption || t("worldScheduleRelease.schedPostFallback")}
                      </button>
                    ))}
                    {dayPosts.length > 2 ? <div className={`px-1 text-[9px] ${muted}`}>{t("worldScheduleRelease.schedCalMore", { count: dayPosts.length - 2 })}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className={`mt-2 text-[11px] ${muted}`}>
            {t("worldScheduleRelease.schedCalHint")}
          </p>
        </div>

        {postsFailed ? (
          <NativeErrorState
            isLight={isLight}
            message={t("worldScheduleRelease.schedPostsLoadFailed")}
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : posts === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldScheduleRelease.schedLoadingPosts")} />
        ) : sorted.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldScheduleRelease.schedEmptyTitle")}
            detail={t("worldScheduleRelease.schedEmptyDetail")}
          />
        ) : (
          <div className="space-y-1.5" data-testid="world-scheduler-list">
            {sorted.map((p) => (
              <div
                key={p.id}
                data-testid="world-scheduler-post-row"
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-bold ${strong}`}>{p.caption || t("worldScheduleRelease.schedRowFallbackTitle")}</p>
                  <p className={`text-xs ${muted}`}>
                    {p.status === "scheduled" && p.scheduledAt
                      ? `${prettyDateTime(p.scheduledAt)} · ${countdownLabel(p.scheduledAt)}`
                      : p.status === "draft"
                        ? t("worldScheduleRelease.schedRowDraft")
                        : p.status}
                    {p.platforms.length > 0 ? ` · ${p.platforms.join(", ")}` : ""}
                  </p>
                </div>
                {editableSchedulerPost(p) ? (
                  <>
                    <button
                      type="button"
                      data-testid="world-scheduler-post-edit"
                      onClick={() => {
                        setEditing(p);
                        setInitialDraft(composeFromPost(p));
                      }}
                      className={chipBtn(isLight, false)}
                    >
                      <Pencil className="h-3.5 w-3.5" /> {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      data-testid="world-scheduler-post-delete"
                      onClick={() => void remove(p)}
                      className={chipBtn(isLight, false)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {p.status === "scheduled" ? t("common.cancel") : t("common.delete")}
                    </button>
                    {p.status === "scheduled" ? (
                      <span className="inline-flex items-center gap-1.5" data-testid="world-scheduler-post-move">
                        <input
                          type="date"
                          aria-label={t("worldScheduleRelease.schedMoveAria")}
                          data-testid="world-scheduler-move-date"
                          className={inputCls(isLight)}
                          style={{ colorScheme: isLight ? "light" : "dark", width: "auto", padding: "4px 8px" }}
                          value={moveDate[p.id] ?? ""}
                          onChange={(e) => setMoveDate((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        />
                        <button
                          type="button"
                          data-testid="world-scheduler-move-go"
                          disabled={!moveDate[p.id]}
                          onClick={() => moveDate[p.id] && void reschedule(p, moveDate[p.id]!)}
                          className={chipBtn(isLight, false)}
                        >
                          <MoveRight className="h-3.5 w-3.5" /> {t("worldScheduleRelease.schedMove")}
                        </button>
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {listNote ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{listNote}</p> : null}
        <div className={`border-t border-dashed pt-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          <SchedulerComposeForm
            isLight={isLight}
            accounts={accounts}
            accountsFailed={accountsFailed}
            editing={editing}
            initialDraft={initialDraft}
            onSaved={() => setTick((n) => n + 1)}
            onCancelEdit={() => {
              setEditing(null);
              setInitialDraft(emptySchedulerCompose());
            }}
          />
        </div>
      </div>
    </NativeCard>
  );
}

/* ─── The chips' standalone compose (#46) ───────────────────────────
   A finished creation's "Schedule it" chip opens THIS — the same
   compose form, prefilled with the creation — right where the member
   stands. No new tab, no website handoff: the post completes
   in-world and lands on the Scheduler desk's calendar. */

export function SchedulerComposeStandalone({
  isLight,
  prefill,
}: {
  isLight: boolean;
  prefill: SchedulerPrefill;
}) {
  const { t } = useTranslation();
  const authHeaders = useSchedulerAuthHeaders();
  const [accounts, setAccounts] = useState<SchedulerAccount[]>([]);
  const [accountsFailed, setAccountsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/social/accounts", { headers: await authHeaders() });
        if (!res.ok) throw new Error("accounts");
        if (!cancelled) setAccounts(parseSchedulerAccounts(await res.json().catch(() => null)));
      } catch {
        if (!cancelled) setAccountsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`mt-3 rounded-2xl border p-3 ${isLight ? "border-[#C9A84C]/50 bg-white/40" : "border-[#d4af37]/30 bg-white/5"}`}
      data-testid="world-scheduler-chip-compose"
    >
      <p className={`mb-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t("scheduler.communityPosts.scheduleThis")}
      </p>
      <SchedulerComposeForm
        isLight={isLight}
        accounts={accounts}
        accountsFailed={accountsFailed}
        editing={null}
        initialDraft={emptySchedulerCompose(prefill)}
        onSaved={() => undefined}
      />
    </div>
  );
}
