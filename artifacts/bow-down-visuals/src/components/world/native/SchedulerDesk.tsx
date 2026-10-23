import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Pencil, Sparkles, Trash2, X } from "lucide-react";
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
  sortSchedulerDeskPosts,
  validateSchedulerCompose,
  type BestTimeSlot,
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
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";

const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
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
            ? "Out of Visual Bucs — top up and the scheduler is ready again."
            : (d.message ?? d.error ?? "The scheduler didn't take that — try again."),
        );
        return;
      }
      const post = parseSchedulerPostResponse(data);
      refreshProfile();
      setSavedLine(
        post?.status === "scheduled" && post.scheduledAt
          ? `Scheduled — ${prettyDateTime(post.scheduledAt)}. It's on your calendar below, and you can edit or cancel it right here.`
          : willSchedule
            ? "Scheduled — it's on your calendar below, and you can edit or cancel it right here."
            : "Saved as a draft — free. Give it a time whenever you're ready and it joins the calendar.",
      );
      props.onSaved(post, editing ? "updated" : "created");
      if (!editing) setDraft(emptySchedulerCompose());
    } catch {
      setError("The scheduler didn't answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const askBestTime = async () => {
    if (btBusy) return;
    if (draft.platforms.length === 0) {
      setBtError("Pick a platform above first — best times are per platform.");
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
            ? "Out of Visual Bucs — top up and best-time is ready again."
            : (d.message ?? "Best-time didn't answer — a failed ask is refunded. Try again."),
        );
        return;
      }
      const { slots, note } = parseBestTimeResult(data);
      if (slots.length === 0) {
        setBtError("Best-time came back without usable slots — a failed ask is refunded. Try again.");
        return;
      }
      setBtSlots(slots);
      setBtNote(note);
      refreshProfile();
    } catch {
      setBtError("Best-time didn't answer — a failed ask is refunded. Try again.");
    } finally {
      setBtBusy(false);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const noteCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const saveLabel = editing
    ? willSchedule
      ? editing.status === "scheduled"
        ? "Save changes"
        : `Schedule it — ${SCHEDULER_POST_COST_VISUAL_BUCS} Visual Bucs`
      : editing.status === "scheduled"
        ? "Save as a draft (unschedule)"
        : "Save changes"
    : willSchedule
      ? `Schedule it — ${SCHEDULER_POST_COST_VISUAL_BUCS} Visual Bucs`
      : "Save draft — free";

  return (
    <div className="space-y-2" data-testid="world-scheduler-compose">
      {editing ? (
        <p className={`flex items-center gap-2 text-xs font-bold ${muted}`}>
          <Pencil className="h-3.5 w-3.5 text-[#d4af37]" /> Editing your {editing.status} post
          {props.onCancelEdit ? (
            <button type="button" data-testid="world-scheduler-edit-cancel" onClick={props.onCancelEdit} className="ml-auto inline-flex items-center gap-1 underline underline-offset-2">
              <X className="h-3.5 w-3.5" /> Stop editing
            </button>
          ) : null}
        </p>
      ) : null}

      <input
        aria-label="Post media link"
        data-testid="world-scheduler-media"
        className={inputCls(isLight)}
        placeholder="Video or image link for this post"
        value={draft.mediaUrl}
        onChange={(e) => set({ mediaUrl: e.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Media kind"
          data-testid="world-scheduler-media-type"
          className={inputCls(isLight)}
          style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }}
          value={draft.mediaType}
          onChange={(e) => set({ mediaType: e.target.value === "image" ? "image" : "video" })}
        >
          <option value="video">Video</option>
          <option value="image">Image</option>
        </select>
        <input
          aria-label="When to post"
          data-testid="world-scheduler-when"
          type="datetime-local"
          className={inputCls(isLight)}
          style={{ colorScheme: isLight ? "light" : "dark", width: "auto", flex: "1 1 200px" }}
          value={draft.whenLocal}
          onChange={(e) => set({ whenLocal: e.target.value })}
        />
      </div>
      <textarea
        aria-label="Caption"
        data-testid="world-scheduler-caption"
        className={inputCls(isLight)}
        rows={3}
        placeholder="Write your caption…"
        value={draft.caption}
        onChange={(e) => set({ caption: e.target.value })}
      />
      <input
        aria-label="Hashtags"
        data-testid="world-scheduler-hashtags"
        className={inputCls(isLight)}
        placeholder="Hashtags (e.g. #newmusic #bdv)"
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
              {label} account
            </span>
            {options.length === 0 ? (
              <span className={`text-xs ${muted}`} data-testid={`world-scheduler-no-account-${platform}`}>
                No {label} account connected yet — connect one on the website's Scheduler page and it will post from here.
              </span>
            ) : (
              <select
                aria-label={`${label} account`}
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
                    {a.expired ? " — expired, reconnect it" : ""}
                  </option>
                ))}
              </select>
            )}
          </label>
        );
      })}
      {props.accountsFailed ? (
        <p className={noteCls}>Your connected accounts wouldn't load — posting needs one per platform, so reconnect checks may read empty this time.</p>
      ) : null}

      <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-scheduler-best-time">
        <p className={`text-xs font-bold ${muted}`}>
          Not sure when? Ask for the best times — {SCHEDULER_BEST_TIME_COST_VISUAL_BUCS} Visual Bucs, refunded if the AI fails.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Your niche for best time"
            className={inputCls(isLight)}
            style={{ flex: "1 1 140px", width: "auto" }}
            placeholder="Your niche (e.g. Music)"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
          />
          <select
            aria-label="Posts per week"
            className={inputCls(isLight)}
            style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }}
            value={postsPerWeek}
            onChange={(e) => setPostsPerWeek(Number(e.target.value) || 3)}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n} post{n === 1 ? "" : "s"} / week
              </option>
            ))}
          </select>
          <button type="button" data-testid="world-scheduler-best-time-ask" onClick={askBestTime} disabled={btBusy} className={goldBtn}>
            <Sparkles className="h-4 w-4" /> {btBusy ? "Asking…" : "Ask best time"}
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
                  Use this time
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
          <CalendarClock className="h-4 w-4" /> {busy ? "Saving…" : saveLabel}
        </button>
        <span className={`text-xs ${muted}`}>
          {willSchedule
            ? `Scheduling reserves ${SCHEDULER_POST_COST_VISUAL_BUCS} Visual Bucs per post — refunded automatically if you cancel.`
            : "Drafts are free — scheduling a post reserves 100 Visual Bucs, refunded on cancel."}
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
  const authHeaders = useSchedulerAuthHeaders();
  const { refreshProfile } = useAuth();
  const [posts, setPosts] = useState<SchedulerDeskPost[] | null>(null);
  const [postsFailed, setPostsFailed] = useState(false);
  const [accounts, setAccounts] = useState<SchedulerAccount[]>([]);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [editing, setEditing] = useState<SchedulerDeskPost | null>(null);
  const [initialDraft, setInitialDraft] = useState<SchedulerComposeDraft>(() => emptySchedulerCompose(prefill));
  const [listNote, setListNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

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
        setAccounts(parseSchedulerAccounts(await accountsRes.json().catch(() => null)));
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
        ? "Cancel this scheduled post? Its Visual Buc reservation is refunded automatically."
        : "Delete this post?",
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
        setListNote(d.message ?? "That post couldn't be removed — try again.");
        return;
      }
      const result = parseSchedulerDeleteResult(data);
      setListNote(
        result.canceled
          ? `Canceled${result.refunded > 0 ? ` — ${result.refunded} Visual Bucs refunded` : ""}.`
          : "Deleted.",
      );
      if (editing?.id === post.id) {
        setEditing(null);
        setInitialDraft(emptySchedulerCompose());
      }
      refreshProfile();
      setTick((n) => n + 1);
    } catch {
      setListNote("That post couldn't be removed — try again.");
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const sorted = posts ? sortSchedulerDeskPosts(posts) : [];

  return (
    <NativeCard isLight={isLight} title="Scheduler — your calendar">
      <div className="space-y-3" data-testid="world-scheduler-desk">
        {postsFailed ? (
          <NativeErrorState
            isLight={isLight}
            message="Your upcoming posts wouldn't open — the schedule itself is untouched."
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : posts === null ? (
          <NativeLoadingState isLight={isLight} message="Checking what's coming up…" />
        ) : sorted.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message="Nothing on the calendar yet."
            detail="Compose your first post below — draft it free, or schedule it and it posts from here."
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
                  <p className={`truncate text-sm font-bold ${strong}`}>{p.caption || "Scheduled post"}</p>
                  <p className={`text-xs ${muted}`}>
                    {p.status === "scheduled" && p.scheduledAt
                      ? `${prettyDateTime(p.scheduledAt)} · ${countdownLabel(p.scheduledAt)}`
                      : p.status === "draft"
                        ? "Draft — no time set yet"
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
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      data-testid="world-scheduler-post-delete"
                      onClick={() => void remove(p)}
                      className={chipBtn(isLight, false)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {p.status === "scheduled" ? "Cancel" : "Delete"}
                    </button>
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
        Schedule this post
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
