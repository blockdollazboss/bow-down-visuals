import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, Download, AlertTriangle, Trophy, Dices, Check, X, Plus,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Delete, RotateCcw, Sparkles,
  ShieldCheck, Ticket, Crown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeCard, NativeLoadingState, NativeEmptyState, NativeErrorState,
} from "@/components/world/native";
import { CURSOR_OPTIONS, getCursorChoice, setCursorChoice, type CursorId } from "@/lib/cursor-settings";
import { ENTRY_METHOD_CATALOG, shortSeed, formatDrawnAt } from "@/lib/contests";
import {
  ACCOUNT_EXPORT_PATH, ACCOUNT_EXPORT_FILENAME, ACCOUNT_DELETE_HANDOFF_PATH,
  RETENTION_PREFS_PATH, DELIGHT_PREFS_PATH, RETENTION_PREF_DEFS, DELIGHT_PREF_DEFS,
  normalizeRetentionPrefs, normalizeDelightPrefs, exportSummary,
  GIVEAWAY_CONTESTS_PATH, giveawayContestPath, giveawayEntriesPath, giveawayEntryPath,
  giveawayDrawPath, giveawayAnnouncePath, GIVEAWAY_ANNOUNCE_COST_VB,
  normalizeGiveawayContests, normalizeGiveawayDetail, giveawayCreateReady, giveawayCreateBody,
  type GiveawayContest, type GiveawayDetail,
  JACKPOT_STATUS_PATH, JACKPOT_ATTEMPT_PATH, JACKPOT_ADMIN_EVENTS_PATH, JACKPOT_ADMIN_STATUS_PATH,
  jackpotAdminEventActionPath, jackpotSequenceReady, jackpotPrizeReady,
  normalizeJackpotStatus, normalizeJackpotAttempt, normalizeJackpotAdminEvents, jackpotEventPhase,
  jackpotCreateBody, JACKPOT_DIRECTIONS, type JackpotDirection, type JackpotStatus, type JackpotAdminEvent,
} from "@/lib/world/tail-desks";

/* ─── Stage D tail desks (stack-100 #94, #95, #96) ───────────────────
   Three instruments docked where their families already live:
   - AccountDesk (#94) under My Studio, beside My Profile: the
     settings page's account rails — fields (read from the session
     profile), the cursor choice (the cursor store itself), the
     retention + delight preference switches on their PATCH rails,
     and the danger zone: data export completable right here;
     account deletion stays behind the 2D settings type-DELETE
     confirmation BY DESIGN and this desk says so + hands off.
   - GiveawayContestsDesk (#95) at the Winners' Circle: the 2D fan
     contests (/api/contests) — a separate system from World
     Contests — browsed, created, entered, verified, drawn and
     announced in-world on the page's own rails. Owner-scoped like
     the page: these are YOUR contests and their entry books.
   - JackpotDesk (#96) beside it: the cheat-code jackpot — status,
     the direction-pad attempt on the real rail (3 tries a day,
     server-kept), and the admin creation surface (fail-closed:
     renders only on a confirmed admin status; the server re-checks
     every verb regardless). Prizes are Visual Bucs, always.
   All fetches ride the member token, like every native desk. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

async function apiJson<T>(
  authHeaders: () => Promise<Record<string, string>>,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string; message?: string;
  };
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data as T;
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
const noteCls = (isLight: boolean) =>
  `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

/* ═══ #94 Account settings ═══════════════════════════════════════════ */

function PrefSwitches({
  isLight, defs, values, savingKey, onToggle, testidPrefix,
}: {
  isLight: boolean;
  defs: { key: string; label: string; blurb: string }[];
  values: Record<string, boolean>;
  savingKey: string | null;
  onToggle: (key: string, next: boolean) => void;
  testidPrefix: string;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  return (
    <div className="space-y-2">
      {defs.map((def) => {
        const on = values[def.key] !== false;
        return (
          <div key={def.key} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold ${strong}`}>{def.label}</p>
              <p className={`text-xs ${muted}`}>{def.blurb}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={def.label}
              disabled={savingKey === def.key}
              onClick={() => onToggle(def.key, !on)}
              data-testid={`${testidPrefix}-${def.key}`}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                on ? "bg-[#d4af37]" : isLight ? "bg-[#C9A84C]/30" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
              />
              {savingKey === def.key && (
                <Loader2 className="absolute -right-5 top-1 h-4 w-4 animate-spin text-[#d4af37]" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AccountDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const { user, profile } = useAuth();
  const [cursor, setCursor] = useState<CursorId>(() => getCursorChoice());
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [delight, setDelight] = useState<Record<string, boolean> | null>(null);
  const [delightFailed, setDelightFailed] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportFailed, setExportFailed] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  useEffect(() => {
    let cancelled = false;
    setPrefsFailed(false);
    setDelightFailed(false);
    (async () => {
      try {
        const d = await apiJson<unknown>(authHeaders, RETENTION_PREFS_PATH);
        if (!cancelled) setPrefs(normalizeRetentionPrefs(d));
      } catch {
        if (!cancelled) setPrefsFailed(true);
      }
      try {
        const d = await apiJson<unknown>(authHeaders, DELIGHT_PREFS_PATH);
        if (!cancelled) setDelight(normalizeDelightPrefs(d));
      } catch {
        if (!cancelled) setDelightFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function togglePref(key: string, next: boolean) {
    if (!prefs || savingKey) return;
    const prev = prefs[key];
    setPrefs({ ...prefs, [key]: next });
    setSavingKey(key);
    try {
      const d = await apiJson<unknown>(authHeaders, RETENTION_PREFS_PATH, {
        method: "PATCH", body: { [key]: next },
      });
      setPrefs(normalizeRetentionPrefs(d));
    } catch {
      setPrefs({ ...prefs, [key]: prev }); // revert on failure — the page's own rule
    } finally {
      setSavingKey(null);
    }
  }

  async function toggleDelight(key: string, next: boolean) {
    if (!delight || savingKey) return;
    const prev = delight[key];
    setDelight({ ...delight, [key]: next });
    setSavingKey(key);
    try {
      const d = await apiJson<unknown>(authHeaders, DELIGHT_PREFS_PATH, {
        method: "PATCH", body: { [key]: next },
      });
      setDelight(normalizeDelightPrefs(d));
    } catch {
      setDelight({ ...delight, [key]: prev });
    } finally {
      setSavingKey(null);
    }
  }

  async function exportData() {
    if (exporting) return;
    setExporting(true);
    setExportNote(null);
    setExportFailed(null);
    try {
      const res = await fetch(ACCOUNT_EXPORT_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error(`export ${res.status}`);
      const payload: unknown = await res.json();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ACCOUNT_EXPORT_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const s = exportSummary(payload);
      setExportNote(
        `Your export is downloading — ${s.counts.projects} projects, ${s.counts.drafts} drafts, ${s.counts.clips} clips, ${s.counts.songs} songs, plus your profile.`,
      );
    } catch {
      setExportFailed("The export didn't come through — nothing was changed. Try again.");
    } finally {
      setExporting(false);
    }
  }

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="space-y-3" data-testid="world-account-desk">
      <NativeCard isLight={isLight} title="Account settings">
        {/* Fields — the session profile's own facts. Display name /
            bio / socials editing lives on the creator-profile rails
            (My public page, above); these are the account's fields. */}
        <div className="grid gap-2 sm:grid-cols-2" data-testid="world-account-fields">
          {[
            { label: "Email", value: user?.email ?? "—" },
            { label: "Display name", value: profile?.display_name ?? "—" },
            { label: "Plan", value: profile?.plan ?? "—" },
            { label: "Visual Bucs", value: typeof profile?.credits === "number" ? profile.credits.toLocaleString("en-US") : "—" },
            ...(memberSince ? [{ label: "Member since", value: memberSince }] : []),
          ].map((f) => (
            <div key={f.label} className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{f.label}</p>
              <p className={`mt-0.5 truncate text-sm font-bold ${strong}`}>{f.value}</p>
            </div>
          ))}
        </div>

        {/* Cursor — the same store the website's Cursor Lab writes. */}
        <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          Cursor
        </p>
        <div className="flex flex-wrap gap-1.5" data-testid="world-account-cursor">
          {CURSOR_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={cursor === o.id}
              onClick={() => { setCursor(o.id); setCursorChoice(o.id); }}
              data-testid={`world-account-cursor-${o.id}`}
              className={`${chipBtn(isLight)} ${cursor === o.id ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
            >
              {o.name}
            </button>
          ))}
        </div>

        {/* Preferences — the settings page's two switch boards. */}
        <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          Preferences
        </p>
        {prefsFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="Your preferences wouldn't load"
            message="A failed load is not a setting — nothing was changed."
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : prefs === null ? (
          <NativeLoadingState isLight={isLight} message="Reading your preferences…" />
        ) : (
          <PrefSwitches
            isLight={isLight}
            defs={RETENTION_PREF_DEFS}
            values={prefs}
            savingKey={savingKey}
            onToggle={(k, n) => void togglePref(k, n)}
            testidPrefix="world-account-pref"
          />
        )}
        <div className="mt-3">
          {delightFailed ? (
            <p className={noteCls(isLight)} data-testid="world-account-delight-failed">
              The delight switches wouldn&rsquo;t load — they keep their saved state.
            </p>
          ) : delight === null ? null : (
            <PrefSwitches
              isLight={isLight}
              defs={DELIGHT_PREF_DEFS}
              values={delight}
              savingKey={savingKey}
              onToggle={(k, n) => void toggleDelight(k, n)}
              testidPrefix="world-account-delight"
            />
          )}
        </div>

        {/* Danger zone — export completes here; deletion hands off. */}
        <div className={`mt-4 rounded-xl border px-3 py-3 ${isLight ? "border-red-500/40 bg-red-500/5" : "border-red-500/30 bg-red-950/20"}`} data-testid="world-account-danger">
          <p className="flex items-center gap-1.5 text-sm font-black text-red-400">
            <AlertTriangle className="h-4 w-4" /> Danger zone
          </p>
          <p className={`mt-1 text-xs ${muted}`}>
            Take everything with you, right here. Deleting the account itself stays on the
            website&rsquo;s settings page, behind its type-DELETE confirmation — by design,
            so no walk through the palace can ever end an account by accident.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportData()}
              disabled={exporting}
              className={goldBtn}
              data-testid="world-account-export"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {exporting ? "Preparing…" : "Export my data"}
            </button>
            <Link
              href={ACCOUNT_DELETE_HANDOFF_PATH}
              className={`${chipBtn(isLight)} border-red-400/60 font-black text-red-400`}
              data-testid="world-account-delete-handoff"
            >
              Delete account — on the website settings
            </Link>
          </div>
          {exportNote && <p className={`mt-2 ${noteCls(isLight)}`} data-testid="world-account-export-note">{exportNote}</p>}
          {exportFailed && <p className="mt-2 text-xs font-semibold text-red-400" data-testid="world-account-export-failed">{exportFailed}</p>}
        </div>
      </NativeCard>
    </div>
  );
}

/* ═══ #95 Giveaway contests (/api/contests) ══════════════════════════ */

export function GiveawayContestsDesk({ isLight, isGuest }: { isLight: boolean; isGuest?: boolean }) {
  const authHeaders = useAuthHeaders();
  const [contests, setContests] = useState<GiveawayContest[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GiveawayDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* create form */
  const [showBuilder, setShowBuilder] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cPrize, setCPrize] = useState("");
  const [cDescription, setCDescription] = useState("");
  const [cRules, setCRules] = useState("");
  const [cMethods, setCMethods] = useState<string[]>(["follow", "comment"]);
  const [cStarts, setCStarts] = useState("");
  const [cEnds, setCEnds] = useState("");
  const [cStatus, setCStatus] = useState("draft");
  /* entry form */
  const [eHandle, setEHandle] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eMethod, setEMethod] = useState("follow");
  /* charged announce: two-tap arm */
  const [announceArmed, setAnnounceArmed] = useState(false);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const loadList = useCallback(async () => {
    setListFailed(false);
    try {
      const d = await apiJson<unknown>(authHeaders, GIVEAWAY_CONTESTS_PATH);
      setContests(normalizeGiveawayContests(d));
    } catch {
      setListFailed(true);
      setContests(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isGuest) return;
    void loadList();
  }, [isGuest, tick, loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailFailed(false);
    setDetail(null);
    try {
      const d = await apiJson<unknown>(authHeaders, giveawayContestPath(id));
      setDetail(normalizeGiveawayDetail(d));
    } catch {
      setDetailFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openId) { setDetail(null); setAnnounceArmed(false); return; }
    void loadDetail(openId);
  }, [openId, loadDetail]);

  if (isGuest) {
    return (
      <NativeCard isLight={isLight} title="Giveaway contests">
        <p className={`text-sm ${muted}`} data-testid="world-giveaway-guest">
          Giveaways are a member&rsquo;s own book — sign in and your contests, their entries
          and the provably-fair draw all work right here.
        </p>
      </NativeCard>
    );
  }

  async function createContest() {
    if (busy) return;
    setBusy("create");
    setNote(null);
    try {
      const d = await apiJson<{ contest?: unknown }>(authHeaders, GIVEAWAY_CONTESTS_PATH, {
        method: "POST",
        body: giveawayCreateBody({
          title: cTitle, prize: cPrize, description: cDescription, rules: cRules,
          entryMethods: cMethods, startsAt: cStarts || undefined, endsAt: cEnds || undefined,
          status: cStatus,
        }),
      });
      const created = d.contest ? normalizeGiveawayContests({ contests: [d.contest] })[0] : undefined;
      setShowBuilder(false);
      setCTitle(""); setCPrize(""); setCDescription(""); setCRules("");
      setNote("Your giveaway is on the book — open it to add entries and run the draw.");
      setTick((n) => n + 1);
      if (created) setOpenId(created.id);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That contest didn't save.");
    } finally {
      setBusy(null);
    }
  }

  async function addEntry() {
    if (!detail || busy) return;
    setBusy("entry");
    setNote(null);
    try {
      await apiJson(authHeaders, giveawayEntriesPath(detail.contest.id), {
        method: "POST",
        body: { handle: eHandle.trim(), email: eEmail.trim() ? eEmail.trim() : null, entryMethod: eMethod },
      });
      setEHandle(""); setEEmail("");
      await loadDetail(detail.contest.id);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That entry didn't land.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleVerify(entryId: string, isVerified: boolean) {
    if (!detail || busy) return;
    setBusy(entryId);
    try {
      await apiJson(authHeaders, giveawayEntryPath(detail.contest.id, entryId), {
        method: "PATCH", body: { isVerified: !isVerified },
      });
      await loadDetail(detail.contest.id);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That verification didn't land.");
    } finally {
      setBusy(null);
    }
  }

  async function draw() {
    if (!detail || busy) return;
    setBusy("draw");
    setNote(null);
    try {
      await apiJson(authHeaders, giveawayDrawPath(detail.contest.id), { method: "POST", body: {} });
      await loadDetail(detail.contest.id);
      setTick((n) => n + 1);
      setNote("The draw is done — the winner and its audit seed are on the book, verifiable by anyone.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The draw didn't run.");
    } finally {
      setBusy(null);
    }
  }

  async function announce() {
    if (!detail || busy) return;
    if (!announceArmed) { setAnnounceArmed(true); return; }
    setBusy("announce");
    setNote(null);
    try {
      await apiJson(authHeaders, giveawayAnnouncePath(detail.contest.id), { method: "POST", body: {} });
      setAnnounceArmed(false);
      await loadDetail(detail.contest.id);
      setNote("The winner announcement graphic is made — it's on the contest, ready to share.");
    } catch (e) {
      setAnnounceArmed(false);
      setNote(e instanceof Error ? e.message : "The announcement didn't generate — you weren't charged for a failure.");
    } finally {
      setBusy(null);
    }
  }

  const createReady = giveawayCreateReady({
    title: cTitle, prize: cPrize, entryMethods: cMethods,
    startsAt: cStarts || undefined, endsAt: cEnds || undefined,
  });
  const winner = detail?.entries.find((e) => e.id === detail.contest.winnerEntryId) ?? null;

  return (
    <div className="space-y-3" data-testid="world-giveaway-desk">
      <NativeCard isLight={isLight} title="Giveaway contests — your book">
        <p className={`text-xs ${muted}`}>
          The website&rsquo;s fan giveaways, in-world: your contests, their entry books, entry
          verification and the provably-fair draw. Running one is free; only the AI winner
          announcement charges ({GIVEAWAY_ANNOUNCE_COST_VB} Visual Bucs, and only when it succeeds).
          World Contests on the stage are a different game — this is the giveaway book.
        </p>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowBuilder((v) => !v)}
            className={goldBtn}
            data-testid="world-giveaway-builder-toggle"
          >
            <Plus className="h-3.5 w-3.5" /> New giveaway
          </button>
        </div>

        {showBuilder && (
          <div className="mt-3 space-y-2" data-testid="world-giveaway-builder">
            <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="Contest title" maxLength={120} className={inputCls(isLight)} data-testid="world-giveaway-title" />
            <input value={cPrize} onChange={(e) => setCPrize(e.target.value)} placeholder="Prize — what the winner takes" maxLength={200} className={inputCls(isLight)} data-testid="world-giveaway-prize" />
            <textarea value={cDescription} onChange={(e) => setCDescription(e.target.value)} placeholder="Description" maxLength={2000} rows={2} className={inputCls(isLight)} data-testid="world-giveaway-description" />
            <textarea value={cRules} onChange={(e) => setCRules(e.target.value)} placeholder="Rules" maxLength={4000} rows={2} className={inputCls(isLight)} data-testid="world-giveaway-rules" />
            <div className="flex flex-wrap gap-1.5">
              {ENTRY_METHOD_CATALOG.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={cMethods.includes(m.key)}
                  onClick={() => setCMethods((prev) => (prev.includes(m.key) ? prev.filter((x) => x !== m.key) : [...prev, m.key]))}
                  data-testid={`world-giveaway-method-${m.key}`}
                  className={`${chipBtn(isLight)} ${cMethods.includes(m.key) ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`flex-1 text-xs ${muted}`}>
                Starts
                <input type="datetime-local" value={cStarts} onChange={(e) => setCStarts(e.target.value)} className={inputCls(isLight)} data-testid="world-giveaway-starts" />
              </label>
              <label className={`flex-1 text-xs ${muted}`}>
                Ends
                <input type="datetime-local" value={cEnds} onChange={(e) => setCEnds(e.target.value)} className={inputCls(isLight)} data-testid="world-giveaway-ends" />
              </label>
              <label className={`text-xs ${muted}`}>
                Status
                <select value={cStatus} onChange={(e) => setCStatus(e.target.value)} className={inputCls(isLight)} data-testid="world-giveaway-status">
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={() => void createContest()}
              disabled={!createReady || busy === "create"}
              className={goldBtn}
              data-testid="world-giveaway-create"
            >
              {busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trophy className="h-3.5 w-3.5" />}
              Create the giveaway — free
            </button>
          </div>
        )}

        <div className="mt-4">
          {listFailed ? (
            <NativeErrorState
              isLight={isLight}
              title="Your giveaways wouldn't load"
              message="A failed load is not an empty book — your contests are safe."
              onRetry={() => setTick((n) => n + 1)}
            />
          ) : contests === null ? (
            <NativeLoadingState isLight={isLight} message="Opening the giveaway book…" />
          ) : contests.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No giveaways yet — start one above; entries, verification and the fair draw all run from here."
            />
          ) : (
            <div className="space-y-2">
              {contests.map((c) => (
                <div key={c.id} className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`} data-testid="world-giveaway-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`min-w-0 flex-1 truncate text-sm font-bold ${strong}`}>{c.title}</p>
                    <span className={`rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] font-black uppercase ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{c.status}</span>
                    <span className={`text-xs ${muted}`}>{c.entryCount} entries</span>
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === c.id ? null : c.id)}
                      className={chipBtn(isLight)}
                      data-testid={`world-giveaway-open-${c.id}`}
                    >
                      {openId === c.id ? "Close" : "Open the book"}
                    </button>
                  </div>
                  <p className={`mt-0.5 text-xs ${muted}`}>Prize: {c.prize || "—"}</p>

                  {openId === c.id && (
                    <div className="mt-3 space-y-3" data-testid="world-giveaway-detail">
                      {detailFailed ? (
                        <NativeErrorState isLight={isLight} title="The book wouldn't open" message="The contest is fine — the fetch slipped." onRetry={() => void loadDetail(c.id)} />
                      ) : !detail || detail.contest.id !== c.id ? (
                        <NativeLoadingState isLight={isLight} message="Opening the book…" />
                      ) : (
                        <>
                          <p className={`text-xs ${muted}`}>
                            {detail.stats.total} entries · {detail.stats.verified} verified — only verified entries can win the draw.
                          </p>
                          {detail.entries.length > 0 && (
                            <div className="space-y-1.5">
                              {detail.entries.map((e) => (
                                <div key={e.id} className="flex flex-wrap items-center gap-2" data-testid="world-giveaway-entry">
                                  <span className={`min-w-0 flex-1 truncate text-sm ${strong}`}>
                                    {e.handle} <span className={muted}>· {e.entryMethod}</span>
                                  </span>
                                  <button
                                    type="button"
                                    disabled={busy === e.id}
                                    onClick={() => void toggleVerify(e.id, e.isVerified)}
                                    data-testid={`world-giveaway-verify-${e.id}`}
                                    className={`${chipBtn(isLight)} ${e.isVerified ? "border-emerald-400/60 text-emerald-400" : ""}`}
                                  >
                                    {e.isVerified ? <><Check className="h-3 w-3" /> Verified</> : "Verify"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {detail.contest.status !== "ended" && (
                            <div className="flex flex-wrap gap-2">
                              <input value={eHandle} onChange={(ev) => setEHandle(ev.target.value)} placeholder="Entrant handle" maxLength={80} className={`${inputCls(isLight)} max-w-[180px]`} data-testid="world-giveaway-entry-handle" />
                              <input value={eEmail} onChange={(ev) => setEEmail(ev.target.value)} placeholder="Email (optional)" className={`${inputCls(isLight)} max-w-[180px]`} data-testid="world-giveaway-entry-email" />
                              <select value={eMethod} onChange={(ev) => setEMethod(ev.target.value)} className={`${inputCls(isLight)} w-auto`} data-testid="world-giveaway-entry-method" aria-label="Entry method">
                                {(detail.contest.entryMethods.length ? detail.contest.entryMethods : ["follow"]).map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => void addEntry()}
                                disabled={!eHandle.trim() || busy === "entry"}
                                className={goldBtn}
                                data-testid="world-giveaway-entry-add"
                              >
                                {busy === "entry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />}
                                Add entry — free
                              </button>
                            </div>
                          )}
                          {winner ? (
                            <div data-testid="world-giveaway-winner">
                              <p className={`text-sm font-black ${strong}`}>
                                <Crown className="mr-1 inline h-4 w-4 text-[#d4af37]" />
                                Winner: {winner.handle}
                              </p>
                              {detail.contest.drawAudit && (
                                <p className={`mt-0.5 text-xs ${muted}`} data-testid="world-giveaway-draw-audit">
                                  Provably fair — seed {shortSeed(detail.contest.drawAudit.seed)} · drawn {formatDrawnAt(detail.contest.drawAudit.drawnAt)} · anyone can re-run the draw from the audit.
                                </p>
                              )}
                              {detail.contest.announcementImageUrl ? (
                                <img src={detail.contest.announcementImageUrl} alt="Winner announcement graphic" className="mt-2 max-w-xs rounded-xl border border-[#d4af37]/40" data-testid="world-giveaway-announce-img" />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void announce()}
                                  disabled={busy === "announce"}
                                  className={announceArmed ? "inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white transition disabled:opacity-50" : goldBtn}
                                  data-testid="world-giveaway-announce"
                                >
                                  {busy === "announce" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                  {announceArmed
                                    ? `Confirm — ${GIVEAWAY_ANNOUNCE_COST_VB} Visual Bucs for the graphic`
                                    : `Make the winner announcement — ${GIVEAWAY_ANNOUNCE_COST_VB} VB`}
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void draw()}
                              disabled={busy === "draw" || detail.stats.verified === 0}
                              className={goldBtn}
                              data-testid="world-giveaway-draw"
                            >
                              {busy === "draw" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Dices className="h-3.5 w-3.5" />}
                              Draw the winner — free
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {note && <p className={`mt-2 ${noteCls(isLight)}`} data-testid="world-giveaway-note">{note}</p>}
      </NativeCard>
    </div>
  );
}

/* ═══ #96 The cheat-code jackpot ═════════════════════════════════════ */

const DIR_ICON: Record<JackpotDirection, typeof ArrowUp> = {
  up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight,
};

function DirectionPad({
  isLight, sequence, onPush, onClear, onUndo, max, testidPrefix,
}: {
  isLight: boolean;
  sequence: JackpotDirection[];
  onPush: (d: JackpotDirection) => void;
  onClear: () => void;
  onUndo: () => void;
  max: number;
  testidPrefix: string;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div>
      <div className="grid w-fit grid-cols-3 gap-1.5" data-testid={`${testidPrefix}-pad`}>
        <span />
        {(["up"] as JackpotDirection[]).map((d) => {
          const Icon = DIR_ICON[d];
          return (
            <button key={d} type="button" aria-label={d} disabled={sequence.length >= max} onClick={() => onPush(d)} data-testid={`${testidPrefix}-dir-${d}`} className={chipBtn(isLight)}>
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
        <span />
        {(["left", "down", "right"] as JackpotDirection[]).map((d) => {
          const Icon = DIR_ICON[d];
          return (
            <button key={d} type="button" aria-label={d} disabled={sequence.length >= max} onClick={() => onPush(d)} data-testid={`${testidPrefix}-dir-${d}`} className={chipBtn(isLight)}>
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      <p className={`mt-1.5 text-xs ${muted}`} data-testid={`${testidPrefix}-sequence`}>
        {sequence.length === 0
          ? "No moves yet — tap the pad to build the code."
          : sequence.map((d) => d.toUpperCase()).join(" · ")}
        {` (${sequence.length}/${max})`}
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" onClick={onUndo} disabled={sequence.length === 0} className={chipBtn(isLight)} data-testid={`${testidPrefix}-undo`}>
          <Delete className="h-3.5 w-3.5" /> Undo
        </button>
        <button type="button" onClick={onClear} disabled={sequence.length === 0} className={chipBtn(isLight)} data-testid={`${testidPrefix}-clear`}>
          <RotateCcw className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
    </div>
  );
}

export function JackpotDesk({ isLight, isGuest }: { isLight: boolean; isGuest?: boolean }) {
  const authHeaders = useAuthHeaders();
  const [status, setStatus] = useState<JackpotStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [sequence, setSequence] = useState<JackpotDirection[]>([]);
  const [attempting, setAttempting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  /* admin */
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [events, setEvents] = useState<JackpotAdminEvent[] | null>(null);
  const [eventsFailed, setEventsFailed] = useState(false);
  const [adminBusy, setAdminBusy] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState<string | null>(null);
  const [aName, setAName] = useState("Thy Cheat Code Jackpot");
  const [aPrize, setAPrize] = useState("10000");
  const [aStarts, setAStarts] = useState("");
  const [aEnds, setAEnds] = useState("");
  const [aSequence, setASequence] = useState<JackpotDirection[]>([]);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  useEffect(() => {
    let cancelled = false;
    setStatusFailed(false);
    (async () => {
      try {
        const res = await fetch(JACKPOT_STATUS_PATH);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const d: unknown = await res.json();
        if (!cancelled) setStatus(normalizeJackpotStatus(d));
      } catch {
        if (!cancelled) setStatusFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  /* The admin gate — fail-closed like the moderation bench: only a
     confirmed isAdmin === true opens the creation surface, and the
     server re-checks every admin verb regardless. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<{ isAdmin?: unknown }>(authHeaders, JACKPOT_ADMIN_STATUS_PATH);
        if (!cancelled) setIsAdmin(d.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsFailed(false);
    try {
      const d = await apiJson<unknown>(authHeaders, JACKPOT_ADMIN_EVENTS_PATH);
      setEvents(normalizeJackpotAdminEvents(d));
    } catch {
      setEventsFailed(true);
      setEvents(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAdmin === true) void loadEvents();
  }, [isAdmin, loadEvents]);

  async function attempt() {
    if (attempting || !jackpotSequenceReady(sequence)) return;
    setAttempting(true);
    setOutcome(null);
    try {
      const res = await fetch(JACKPOT_ATTEMPT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ sequence }),
      });
      const d: unknown = await res.json().catch(() => ({}));
      const o = normalizeJackpotAttempt(d);
      if (o.correct) {
        setOutcome(`You cracked it — ${o.prizeCredits?.toLocaleString("en-US") ?? ""} Visual Bucs are yours. The palace herald has it from here.`);
        setTick((n) => n + 1);
      } else if (!res.ok) {
        setOutcome(o.message ?? "That try didn't count — try again in a bit.");
      } else if (o.claimed) {
        setOutcome(o.message ?? `Already claimed${o.winnerDisplayName ? ` by ${o.winnerDisplayName}` : ""} — the next code is coming.`);
        setTick((n) => n + 1);
      } else {
        setOutcome(`Not the code${o.triesLeft !== null ? ` — ${o.triesLeft} ${o.triesLeft === 1 ? "try" : "tries"} left today` : ""}.`);
      }
      setSequence([]);
    } catch {
      setOutcome("That try didn't reach the palace — nothing was spent, try again.");
    } finally {
      setAttempting(false);
    }
  }

  async function createEvent() {
    if (adminBusy) return;
    const prize = parseInt(aPrize, 10);
    setAdminBusy("create");
    setAdminNote(null);
    try {
      await apiJson(authHeaders, JACKPOT_ADMIN_EVENTS_PATH, {
        method: "POST",
        body: jackpotCreateBody({
          name: aName, codeSequence: aSequence, prizeCredits: prize,
          startsAt: aStarts || undefined, endsAt: aEnds || undefined,
        }),
      });
      setASequence([]);
      setAdminNote("The event is created — activate it below when its window opens.");
      await loadEvents();
    } catch (e) {
      setAdminNote(e instanceof Error ? e.message : "That event didn't save.");
    } finally {
      setAdminBusy(null);
    }
  }

  async function toggleEvent(ev: JackpotAdminEvent) {
    if (adminBusy) return;
    setAdminBusy(ev.id);
    setAdminNote(null);
    try {
      await apiJson(authHeaders, jackpotAdminEventActionPath(ev.id, ev.isActive ? "deactivate" : "activate"), {
        method: "POST", body: {},
      });
      await loadEvents();
      setTick((n) => n + 1);
    } catch (e) {
      setAdminNote(e instanceof Error ? e.message : "That action didn't land.");
    } finally {
      setAdminBusy(null);
    }
  }

  const prizeNum = parseInt(aPrize, 10);
  const createReady = aName.trim().length > 0 && jackpotSequenceReady(aSequence) && jackpotPrizeReady(prizeNum) && !!aEnds;
  const padMax = status?.phase === "live" && status.codeLength > 0 ? status.codeLength : 10;

  return (
    <div className="space-y-3" data-testid="world-jackpot-desk">
      <NativeCard isLight={isLight} title="Thy Cheat Code Jackpot">
        {statusFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The jackpot board wouldn't load"
            message="A failed load is not an empty board — the event is safe."
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : status === null ? (
          <NativeLoadingState isLight={isLight} message="Reading the jackpot board…" />
        ) : status.phase === "none" ? (
          <NativeEmptyState
            isLight={isLight}
            message="No jackpot event on the board — when the King sets a secret code, it lands here; crack it and the Visual Bucs are yours."
          />
        ) : (
          <div data-testid="world-jackpot-status">
            <p className={`text-sm font-black ${strong}`}>
              {status.name ?? "Thy Cheat Code Jackpot"} — {status.prizeCredits.toLocaleString("en-US")} Visual Bucs
              <span className={`ml-2 rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] font-black uppercase ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {status.phase}
              </span>
            </p>
            <p className={`mt-1 text-xs ${muted}`}>
              {status.phase === "live" && `A secret ${status.codeLength}-move code. Three tries a day, spread out — the pad below is the real attempt rail, and the prize lands in your Visual Bucs balance.`}
              {status.phase === "claimed" && `Claimed${status.winnerDisplayName ? ` by ${status.winnerDisplayName}` : ""} — a new code comes with the next event.`}
              {status.phase === "upcoming" && `The window opens soon — the code length is ${status.codeLength} moves.`}
              {status.phase === "ended" && "This event's window has closed — the next code is on its way."}
            </p>
            {status.phase === "live" && !isGuest && (
              <div className="mt-3" data-testid="world-jackpot-play">
                <DirectionPad
                  isLight={isLight}
                  sequence={sequence}
                  max={padMax}
                  testidPrefix="world-jackpot"
                  onPush={(d) => setSequence((s) => (s.length >= padMax ? s : [...s, d]))}
                  onClear={() => setSequence([])}
                  onUndo={() => setSequence((s) => s.slice(0, -1))}
                />
                <button
                  type="button"
                  onClick={() => void attempt()}
                  disabled={attempting || !jackpotSequenceReady(sequence) || sequence.length !== padMax}
                  className={`${goldBtn} mt-2`}
                  data-testid="world-jackpot-attempt"
                >
                  {attempting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trophy className="h-3.5 w-3.5" />}
                  Try the code — free
                </button>
              </div>
            )}
            {status.phase === "live" && isGuest && (
              <p className={`mt-2 text-xs ${muted}`} data-testid="world-jackpot-guest">
                Members take their three tries a day right here — sign in to play the pad.
              </p>
            )}
            {outcome && <p className={`mt-2 ${noteCls(isLight)}`} data-testid="world-jackpot-outcome">{outcome}</p>}
          </div>
        )}

        {/* Admin creation surface — fail-closed, server re-checked. */}
        {isAdmin === true && (
          <div className="mt-4" data-testid="world-jackpot-admin">
            <p className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              <ShieldCheck className="h-3.5 w-3.5" /> Set the next code — admin only
            </p>
            <div className="mt-2 space-y-2">
              <input value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Event name" maxLength={120} className={inputCls(isLight)} data-testid="world-jackpot-admin-name" />
              <div className="flex flex-wrap gap-2">
                <label className={`flex-1 text-xs ${muted}`}>
                  Prize (Visual Bucs, 100–1,000,000)
                  <input value={aPrize} onChange={(e) => setAPrize(e.target.value)} inputMode="numeric" className={inputCls(isLight)} data-testid="world-jackpot-admin-prize" />
                </label>
                <label className={`flex-1 text-xs ${muted}`}>
                  Starts
                  <input type="datetime-local" value={aStarts} onChange={(e) => setAStarts(e.target.value)} className={inputCls(isLight)} data-testid="world-jackpot-admin-starts" />
                </label>
                <label className={`flex-1 text-xs ${muted}`}>
                  Ends
                  <input type="datetime-local" value={aEnds} onChange={(e) => setAEnds(e.target.value)} className={inputCls(isLight)} data-testid="world-jackpot-admin-ends" />
                </label>
              </div>
              <DirectionPad
                isLight={isLight}
                sequence={aSequence}
                max={10}
                testidPrefix="world-jackpot-admin"
                onPush={(d) => setASequence((s) => (s.length >= 10 ? s : [...s, d]))}
                onClear={() => setASequence([])}
                onUndo={() => setASequence((s) => s.slice(0, -1))}
              />
              <button
                type="button"
                onClick={() => void createEvent()}
                disabled={!createReady || adminBusy === "create"}
                className={goldBtn}
                data-testid="world-jackpot-admin-create"
              >
                {adminBusy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Create the event
              </button>
              {adminNote && <p className={noteCls(isLight)} data-testid="world-jackpot-admin-note">{adminNote}</p>}
            </div>

            <div className="mt-3">
              {eventsFailed ? (
                <NativeErrorState isLight={isLight} title="The event list wouldn't load" message="A failed load is not an empty list." onRetry={() => void loadEvents()} />
              ) : events === null ? (
                <NativeLoadingState isLight={isLight} message="Reading the events…" />
              ) : events.length === 0 ? (
                <p className={`text-xs ${muted}`}>No events yet — create the first one above.</p>
              ) : (
                <div className="space-y-1.5">
                  {events.map((ev) => (
                    <div key={ev.id} className="flex flex-wrap items-center gap-2" data-testid="world-jackpot-admin-event">
                      <span className={`min-w-0 flex-1 truncate text-sm ${strong}`}>
                        {ev.name} <span className={muted}>· {ev.prizeCredits.toLocaleString("en-US")} VB · {ev.codeLength} moves · {jackpotEventPhase(ev)}</span>
                      </span>
                      <button
                        type="button"
                        disabled={adminBusy === ev.id || !!ev.winnerUserId}
                        onClick={() => void toggleEvent(ev)}
                        className={chipBtn(isLight)}
                        data-testid={`world-jackpot-admin-toggle-${ev.id}`}
                      >
                        {adminBusy === ev.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {ev.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </NativeCard>
    </div>
  );
}
