import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Loader2, Download, AlertTriangle, Trophy, Dices, Check, X, Plus,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Delete, RotateCcw, Sparkles,
  ShieldCheck, Ticket, Crown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { balanceComposition } from "@/lib/balance";
import { TemporaryBucsNote } from "@/components/BalanceBreakdown";
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
  failText?: (status: number) => string,
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string; message?: string;
  };
  if (!res.ok) throw new Error(apiErrorMessage(data, failText ? failText(res.status) : `Request failed (${res.status})`));
  return data as T;
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
const noteCls = (isLight: boolean) =>
  `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

/* Locale unit 52: the seam-owned label tables (pref defs, cursor
   names, entry methods, jackpot phases + directions) ride the
   worldRemainder catalog through these key maps — the libs keep
   the English of record; the desks render the catalog's words. */
const RETENTION_LABEL_KEY: Record<string, string> = {
  daily_drop_enabled: "worldRemainder.taiPrefDailyDrop",
  away_digest_enabled: "worldRemainder.taiPrefAwayDigest",
  creation_streaks_enabled: "worldRemainder.taiPrefCreationStreaks",
  quests_enabled: "worldRemainder.taiPrefQuests",
  login_streaks_enabled: "worldRemainder.taiPrefLoginStreaks",
  share_to_earn_enabled: "worldRemainder.taiPrefShareToEarn",
  contests_enabled: "worldRemainder.taiPrefContests",
  fomo_feed_enabled: "worldRemainder.taiPrefFomoFeed",
};
const RETENTION_BLURB_KEY: Record<string, string> = {
  daily_drop_enabled: "worldRemainder.taiPrefDailyDropNote",
  away_digest_enabled: "worldRemainder.taiPrefAwayDigestNote",
  creation_streaks_enabled: "worldRemainder.taiPrefCreationStreaksNote",
  quests_enabled: "worldRemainder.taiPrefQuestsNote",
  login_streaks_enabled: "worldRemainder.taiPrefLoginStreaksNote",
  share_to_earn_enabled: "worldRemainder.taiPrefShareToEarnNote",
  contests_enabled: "worldRemainder.taiPrefContestsNote",
  fomo_feed_enabled: "worldRemainder.taiPrefFomoFeedNote",
};
const DELIGHT_LABEL_KEY: Record<string, string> = {
  sharkDropsEnabled: "worldRemainder.taiDelightSharkDrops",
  levelCelebrationsEnabled: "worldRemainder.taiDelightLevelUps",
  leaderboardVisible: "worldRemainder.taiDelightLeaderboard",
};
const DELIGHT_BLURB_KEY: Record<string, string> = {
  sharkDropsEnabled: "worldRemainder.taiDelightSharkDropsNote",
  levelCelebrationsEnabled: "worldRemainder.taiDelightLevelUpsNote",
  leaderboardVisible: "worldRemainder.taiDelightLeaderboardNote",
};
const CURSOR_NAME_KEY: Record<string, string> = {
  "shark-fin": "worldRemainder.taiCursorSharkFin",
  crown: "worldRemainder.taiCursorCrown",
  "bucs-coin": "worldRemainder.taiCursorBucsCoin",
  "gold-trail": "worldRemainder.taiCursorGoldTrail",
  lightning: "worldRemainder.taiCursorLightning",
  "pixel-shark": "worldRemainder.taiCursorPixelShark",
  flame: "worldRemainder.taiCursorFlame",
  diamond: "worldRemainder.taiCursorDiamond",
  star: "worldRemainder.taiCursorStar",
  "money-bag": "worldRemainder.taiCursorMoneyBag",
  "gold-key": "worldRemainder.taiCursorGoldKey",
  trophy: "worldRemainder.taiCursorTrophy",
  rocket: "worldRemainder.taiCursorRocket",
  crosshair: "worldRemainder.taiCursorCrosshair",
  "music-note": "worldRemainder.taiCursorMusicNote",
  gamepad: "worldRemainder.taiCursorGamepad",
  camera: "worldRemainder.taiCursorCamera",
};
const METHOD_LABEL_KEY: Record<string, string> = {
  follow: "worldRemainder.taiMethodFollow",
  comment: "worldRemainder.taiMethodComment",
  share: "worldRemainder.taiMethodShare",
  purchase: "worldRemainder.taiMethodPurchase",
};
const PHASE_KEY: Record<string, string> = {
  claimed: "worldRemainder.taiPhaseClaimed",
  live: "worldRemainder.taiPhaseLive",
  ended: "worldRemainder.taiPhaseEnded",
  upcoming: "worldRemainder.taiPhaseUpcoming",
};
const DIR_LABEL_KEY: Record<string, string> = {
  up: "worldRemainder.taiDirUp",
  down: "worldRemainder.taiDirDown",
  left: "worldRemainder.taiDirLeft",
  right: "worldRemainder.taiDirRight",
};

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
              className={`bdv-touch-switch relative h-6 w-11 shrink-0 rounded-full transition ${
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
  const { t, i18n } = useTranslation();
  const failText = (status: number) => t("worldRemainder.taiRequestFailed", { status });
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
        const d = await apiJson<unknown>(authHeaders, RETENTION_PREFS_PATH, undefined, failText);
        if (!cancelled) setPrefs(normalizeRetentionPrefs(d));
      } catch {
        if (!cancelled) setPrefsFailed(true);
      }
      try {
        const d = await apiJson<unknown>(authHeaders, DELIGHT_PREFS_PATH, undefined, failText);
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
      }, failText);
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
      }, failText);
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
        t("worldRemainder.taiExportNote", {
          projects: s.counts.projects, drafts: s.counts.drafts,
          clips: s.counts.clips, songs: s.counts.songs,
        }),
      );
    } catch {
      setExportFailed(t("worldRemainder.taiExportFailed"));
    } finally {
      setExporting(false);
    }
  }

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(i18n.language, { year: "numeric", month: "short", day: "numeric" })
    : null;

  /* Lane V-bucs remainder (stack700): the Visual Bucs field keeps the
     single spendable total; while part of it is temporary, the split
     rides inside the same field — Permanent on its own line, the
     temporary part named with its expiry on the next. Same source as
     every shipped surface (lib/balance composition over the session
     profile — the one aggregate bonus pool with one expiry), same
     balance.* strings the Studio board already renders in-world. */
  const balanceComp = profile
    ? (profile.balance_composition ?? balanceComposition(profile))
    : null;

  return (
    <div className="space-y-3" data-testid="world-account-desk">
      <NativeCard isLight={isLight} title={t("worldRemainder.taiTitle")}>
        {/* Fields — the session profile's own facts. Display name /
            bio / socials editing lives on the creator-profile rails
            (My public page, above); these are the account's fields. */}
        <div className="grid gap-2 sm:grid-cols-2" data-testid="world-account-fields">
          {([
            { label: t("worldRemainder.taiFieldEmail"), value: user?.email ?? "—" },
            { label: t("worldRemainder.taiFieldDisplayName"), value: profile?.display_name ?? "—" },
            { label: t("worldRemainder.taiFieldPlan"), value: profile?.plan ?? "—" },
            {
              label: t("worldRemainder.taiFieldVisualBucs"),
              value: typeof profile?.credits === "number" ? profile.credits.toLocaleString(i18n.language) : "—",
              detail: balanceComp && balanceComp.temporaryCredits > 0 ? (
                <>
                  <span className={`block ${muted}`}>
                    {t("balance.permanent_amount", { amount: balanceComp.permanentCredits.toLocaleString(i18n.language) })}
                  </span>
                  <TemporaryBucsNote
                    composition={balanceComp}
                    mode="label"
                    className={`font-bold ${isLight ? "text-[#8a6d1f]" : "text-amber-300/90"}`}
                  />
                </>
              ) : null,
            },
            ...(memberSince ? [{ label: t("worldRemainder.taiFieldMemberSince"), value: memberSince }] : []),
          ] as { label: string; value: string; detail?: ReactNode }[]).map((f) => (
            <div key={f.label} className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{f.label}</p>
              <p className={`mt-0.5 truncate text-sm font-bold ${strong}`}>{f.value}</p>
              {f.detail ? (
                <div className="mt-1 space-y-0.5 text-[11px] leading-snug" data-testid="world-account-balance-split">
                  {f.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Cursor — the same store the website's Cursor Lab writes. */}
        <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("worldRemainder.taiCursorHeading")}
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
              {t(CURSOR_NAME_KEY[o.id] ?? "worldRemainder.taiCursorSharkFin")}
            </button>
          ))}
        </div>

        {/* Preferences — the settings page's two switch boards. */}
        <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("worldRemainder.taiPreferencesHeading")}
        </p>
        {prefsFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldRemainder.taiPrefsLoadTitle")}
            message={t("worldRemainder.taiPrefsLoadMessage")}
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : prefs === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldRemainder.taiPrefsLoading")} />
        ) : (
          <PrefSwitches
            isLight={isLight}
            defs={RETENTION_PREF_DEFS.map((d) => ({ ...d, label: t(RETENTION_LABEL_KEY[d.key]!), blurb: t(RETENTION_BLURB_KEY[d.key]!) }))}
            values={prefs}
            savingKey={savingKey}
            onToggle={(k, n) => void togglePref(k, n)}
            testidPrefix="world-account-pref"
          />
        )}
        <div className="mt-3">
          {delightFailed ? (
            <p className={noteCls(isLight)} data-testid="world-account-delight-failed">
              {t("worldRemainder.taiDelightFailed")}
            </p>
          ) : delight === null ? null : (
            <PrefSwitches
              isLight={isLight}
              defs={DELIGHT_PREF_DEFS.map((d) => ({ ...d, label: t(DELIGHT_LABEL_KEY[d.key]!), blurb: t(DELIGHT_BLURB_KEY[d.key]!) }))}
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
            <AlertTriangle className="h-4 w-4" /> {t("worldRemainder.taiDangerTitle")}
          </p>
          <p className={`mt-1 text-xs ${muted}`}>
            {t("worldRemainder.taiDangerBody")}
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
              {exporting ? t("worldRemainder.taiExportPreparing") : t("worldRemainder.taiExportButton")}
            </button>
            <Link
              href={ACCOUNT_DELETE_HANDOFF_PATH}
              className={`${chipBtn(isLight)} border-red-400/60 font-black text-red-400`}
              data-testid="world-account-delete-handoff"
            >
              {t("worldRemainder.taiDeleteHandoff")}
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
  const { t, i18n } = useTranslation();
  const failText = (status: number) => t("worldRemainder.taiRequestFailed", { status });
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
      const d = await apiJson<unknown>(authHeaders, GIVEAWAY_CONTESTS_PATH, undefined, failText);
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
      const d = await apiJson<unknown>(authHeaders, giveawayContestPath(id), undefined, failText);
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
      <NativeCard isLight={isLight} title={t("worldRemainder.taiGiveawayGuestTitle")}>
        <p className={`text-sm ${muted}`} data-testid="world-giveaway-guest">
          {t("worldRemainder.taiGiveawayGuestBody")}
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
      }, failText);
      const created = d.contest ? normalizeGiveawayContests({ contests: [d.contest] })[0] : undefined;
      setShowBuilder(false);
      setCTitle(""); setCPrize(""); setCDescription(""); setCRules("");
      setNote(t("worldRemainder.taiCreatedNote"));
      setTick((n) => n + 1);
      if (created) setOpenId(created.id);
    } catch (e) {
      setNote(plainErrorText(e, t("worldRemainder.taiCreateFailed")));
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
      }, failText);
      setEHandle(""); setEEmail("");
      await loadDetail(detail.contest.id);
    } catch (e) {
      setNote(plainErrorText(e, t("worldRemainder.taiEntryFailed")));
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
      }, failText);
      await loadDetail(detail.contest.id);
    } catch (e) {
      setNote(plainErrorText(e, t("worldRemainder.taiVerifyFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function draw() {
    if (!detail || busy) return;
    setBusy("draw");
    setNote(null);
    try {
      await apiJson(authHeaders, giveawayDrawPath(detail.contest.id), { method: "POST", body: {} }, failText);
      await loadDetail(detail.contest.id);
      setTick((n) => n + 1);
      setNote(t("worldRemainder.taiDrawDoneNote"));
    } catch (e) {
      setNote(plainErrorText(e, t("worldRemainder.taiDrawFailed")));
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
      await apiJson(authHeaders, giveawayAnnouncePath(detail.contest.id), { method: "POST", body: {} }, failText);
      setAnnounceArmed(false);
      await loadDetail(detail.contest.id);
      setNote(t("worldRemainder.taiAnnounceDoneNote"));
    } catch (e) {
      setAnnounceArmed(false);
      setNote(plainErrorText(e, t("worldRemainder.taiAnnounceFailed")));
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
      <NativeCard isLight={isLight} title={t("worldRemainder.taiGiveawayTitle")}>
        <p className={`text-xs ${muted}`}>
          {t("worldRemainder.taiGiveawayIntro", { cost: GIVEAWAY_ANNOUNCE_COST_VB })}
        </p>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowBuilder((v) => !v)}
            className={goldBtn}
            data-testid="world-giveaway-builder-toggle"
            aria-expanded={showBuilder}
          >
            <Plus className="h-3.5 w-3.5" /> {t("worldRemainder.taiNewGiveaway")}
          </button>
        </div>

        {showBuilder && (
          <div className="mt-3 space-y-2" data-testid="world-giveaway-builder">
            <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder={t("worldRemainder.taiContestTitle")} maxLength={120} className={inputCls(isLight)} data-testid="world-giveaway-title" aria-label={t("worldRemainder.taiContestTitle")} />
            <input value={cPrize} onChange={(e) => setCPrize(e.target.value)} placeholder={t("worldRemainder.taiPrizePlaceholder")} maxLength={200} className={inputCls(isLight)} data-testid="world-giveaway-prize" aria-label={t("worldRemainder.taiPrizePlaceholder")} />
            <textarea value={cDescription} onChange={(e) => setCDescription(e.target.value)} placeholder={t("worldRemainder.taiDescriptionPlaceholder")} maxLength={2000} rows={2} className={inputCls(isLight)} data-testid="world-giveaway-description" aria-label={t("worldRemainder.taiDescriptionAria")} />
            <textarea value={cRules} onChange={(e) => setCRules(e.target.value)} placeholder={t("worldRemainder.taiRulesPlaceholder")} maxLength={4000} rows={2} className={inputCls(isLight)} data-testid="world-giveaway-rules" aria-label={t("worldRemainder.taiRulesAria")} />
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
                  {t(METHOD_LABEL_KEY[m.key] ?? "worldRemainder.taiMethodFollow")}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`flex-1 text-xs ${muted}`}>
                {t("worldRemainder.taiStartsLabel")}
                <input type="datetime-local" value={cStarts} onChange={(e) => setCStarts(e.target.value)} className={inputCls(isLight)} data-testid="world-giveaway-starts" />
              </label>
              <label className={`flex-1 text-xs ${muted}`}>
                {t("worldRemainder.taiEndsLabel")}
                <input type="datetime-local" value={cEnds} onChange={(e) => setCEnds(e.target.value)} className={inputCls(isLight)} data-testid="world-giveaway-ends" />
              </label>
              <label className={`text-xs ${muted}`}>
                {t("worldRemainder.taiStatusLabel")}
                <select value={cStatus} onChange={(e) => setCStatus(e.target.value)} className={inputCls(isLight)} data-testid="world-giveaway-status">
                  <option value="draft">{t("worldRemainder.taiStatusDraft")}</option>
                  <option value="active">{t("worldRemainder.taiStatusActive")}</option>
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
              {t("worldRemainder.taiCreateButton")}
            </button>
          </div>
        )}

        <div className="mt-4">
          {listFailed ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldRemainder.taiListLoadTitle")}
              message={t("worldRemainder.taiListLoadMessage")}
              onRetry={() => setTick((n) => n + 1)}
            />
          ) : contests === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldRemainder.taiListLoading")} />
          ) : contests.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldRemainder.taiListEmpty")}
            />
          ) : (
            <div className="space-y-2">
              {contests.map((c) => (
                <div key={c.id} className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`} data-testid="world-giveaway-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`min-w-0 flex-1 truncate text-sm font-bold ${strong}`}>{c.title}</p>
                    <span className={`rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] font-black uppercase ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{c.status}</span>
                    <span className={`text-xs ${muted}`}>{t("worldRemainder.taiEntriesCount", { count: c.entryCount })}</span>
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === c.id ? null : c.id)}
                      className={chipBtn(isLight)}
                      data-testid={`world-giveaway-open-${c.id}`}
                      aria-expanded={openId === c.id}
                    >
                      {openId === c.id ? t("worldRemainder.taiCloseBook") : t("worldRemainder.taiOpenBook")}
                    </button>
                  </div>
                  <p className={`mt-0.5 text-xs ${muted}`}>{t("worldRemainder.taiPrizeLine", { prize: c.prize || "—" })}</p>

                  {openId === c.id && (
                    <div className="mt-3 space-y-3" data-testid="world-giveaway-detail">
                      {detailFailed ? (
                        <NativeErrorState isLight={isLight} title={t("worldRemainder.taiDetailLoadTitle")} message={t("worldRemainder.taiDetailLoadMessage")} onRetry={() => void loadDetail(c.id)} />
                      ) : !detail || detail.contest.id !== c.id ? (
                        <NativeLoadingState isLight={isLight} message={t("worldRemainder.taiDetailLoading")} />
                      ) : (
                        <>
                          <p className={`text-xs ${muted}`}>
                            {t("worldRemainder.taiStatsLine", { total: detail.stats.total, verified: detail.stats.verified })}
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
                                    {e.isVerified ? <><Check className="h-3 w-3" /> {t("worldRemainder.taiVerifiedBadge")}</> : t("worldRemainder.taiVerifyButton")}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {detail.contest.status !== "ended" && (
                            <div className="flex flex-wrap gap-2">
                              <input value={eHandle} onChange={(ev) => setEHandle(ev.target.value)} placeholder={t("worldRemainder.taiEntrantHandle")} maxLength={80} className={`${inputCls(isLight)} max-w-[180px]`} data-testid="world-giveaway-entry-handle" aria-label={t("worldRemainder.taiEntrantHandle")} />
                              <input value={eEmail} onChange={(ev) => setEEmail(ev.target.value)} placeholder={t("worldRemainder.taiEntrantEmail")} className={`${inputCls(isLight)} max-w-[180px]`} data-testid="world-giveaway-entry-email" aria-label={t("worldRemainder.taiEntrantEmailAria")} />
                              <select value={eMethod} onChange={(ev) => setEMethod(ev.target.value)} className={`${inputCls(isLight)} w-auto`} data-testid="world-giveaway-entry-method" aria-label={t("worldRemainder.taiEntryMethodAria")}>
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
                                {t("worldRemainder.taiAddEntryButton")}
                              </button>
                            </div>
                          )}
                          {winner ? (
                            <div data-testid="world-giveaway-winner">
                              <p className={`text-sm font-black ${strong}`}>
                                <Crown className="mr-1 inline h-4 w-4 text-[#d4af37]" />
                                {t("worldRemainder.taiWinnerLine", { handle: winner.handle })}
                              </p>
                              {detail.contest.drawAudit && (
                                <p className={`mt-0.5 text-xs ${muted}`} data-testid="world-giveaway-draw-audit">
                                  {t("worldRemainder.taiDrawAudit", { seed: shortSeed(detail.contest.drawAudit.seed), when: formatDrawnAt(detail.contest.drawAudit.drawnAt, i18n.language) })}
                                </p>
                              )}
                              {detail.contest.announcementImageUrl ? (
                                <img src={detail.contest.announcementImageUrl} alt={t("worldRemainder.taiAnnounceImgAlt")} className="mt-2 max-w-xs rounded-xl border border-[#d4af37]/40" data-testid="world-giveaway-announce-img" />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void announce()}
                                  disabled={busy === "announce"}
                                  className={announceArmed ? "inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white transition disabled:opacity-50 bdv-touch-target" : goldBtn}
                                  data-testid="world-giveaway-announce"
                                >
                                  {busy === "announce" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                  {announceArmed
                                    ? t("worldRemainder.taiAnnounceConfirm", { cost: GIVEAWAY_ANNOUNCE_COST_VB })
                                    : t("worldRemainder.taiAnnounceButton", { cost: GIVEAWAY_ANNOUNCE_COST_VB })}
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
                              {t("worldRemainder.taiDrawButton")}
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
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div>
      <div className="grid w-fit grid-cols-3 gap-1.5" data-testid={`${testidPrefix}-pad`}>
        <span />
        {(["up"] as JackpotDirection[]).map((d) => {
          const Icon = DIR_ICON[d];
          return (
            <button key={d} type="button" aria-label={t(DIR_LABEL_KEY[d]!)} disabled={sequence.length >= max} onClick={() => onPush(d)} data-testid={`${testidPrefix}-dir-${d}`} className={chipBtn(isLight)}>
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
        <span />
        {(["left", "down", "right"] as JackpotDirection[]).map((d) => {
          const Icon = DIR_ICON[d];
          return (
            <button key={d} type="button" aria-label={t(DIR_LABEL_KEY[d]!)} disabled={sequence.length >= max} onClick={() => onPush(d)} data-testid={`${testidPrefix}-dir-${d}`} className={chipBtn(isLight)}>
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      <p className={`mt-1.5 text-xs ${muted}`} data-testid={`${testidPrefix}-sequence`}>
        {sequence.length === 0
          ? t("worldRemainder.taiPadEmpty")
          : sequence.map((d) => d.toUpperCase()).join(" · ")}
        {t("worldRemainder.taiPadCountSuffix", { n: sequence.length, max })}
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" onClick={onUndo} disabled={sequence.length === 0} className={chipBtn(isLight)} data-testid={`${testidPrefix}-undo`}>
          <Delete className="h-3.5 w-3.5" /> {t("worldRemainder.taiPadUndo")}
        </button>
        <button type="button" onClick={onClear} disabled={sequence.length === 0} className={chipBtn(isLight)} data-testid={`${testidPrefix}-clear`}>
          <RotateCcw className="h-3.5 w-3.5" /> {t("worldRemainder.taiPadClear")}
        </button>
      </div>
    </div>
  );
}

export function JackpotDesk({ isLight, isGuest }: { isLight: boolean; isGuest?: boolean }) {
  const { t, i18n } = useTranslation();
  const failText = (status: number) => t("worldRemainder.taiRequestFailed", { status });
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
        const d = await apiJson<{ isAdmin?: unknown }>(authHeaders, JACKPOT_ADMIN_STATUS_PATH, undefined, failText);
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
      const d = await apiJson<unknown>(authHeaders, JACKPOT_ADMIN_EVENTS_PATH, undefined, failText);
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
        setOutcome(t("worldRemainder.taiOutcomeWin", { prize: o.prizeCredits?.toLocaleString(i18n.language) ?? "" }));
        setTick((n) => n + 1);
      } else if (!res.ok) {
        setOutcome(apiErrorMessage(o, t("worldRemainder.taiOutcomeFailed")));
      } else if (o.claimed) {
        setOutcome(apiErrorMessage(o, t("worldRemainder.taiOutcomeClaimed", { by: o.winnerDisplayName ? t("worldRemainder.taiClaimedBy", { name: o.winnerDisplayName }) : "" })));
        setTick((n) => n + 1);
      } else {
        setOutcome(t("worldRemainder.taiOutcomeMiss", { left: o.triesLeft !== null ? (o.triesLeft === 1 ? t("worldRemainder.taiTryLeftOne") : t("worldRemainder.taiTriesLeftMany", { count: o.triesLeft })) : "" }));
      }
      setSequence([]);
    } catch {
      setOutcome(t("worldRemainder.taiOutcomeUnreached"));
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
      }, failText);
      setASequence([]);
      setAdminNote(t("worldRemainder.taiAdminCreatedNote"));
      await loadEvents();
    } catch (e) {
      setAdminNote(plainErrorText(e, t("worldRemainder.taiAdminCreateFailed")));
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
      }, failText);
      await loadEvents();
      setTick((n) => n + 1);
    } catch (e) {
      setAdminNote(plainErrorText(e, t("worldRemainder.taiAdminActionFailed")));
    } finally {
      setAdminBusy(null);
    }
  }

  const prizeNum = parseInt(aPrize, 10);
  const createReady = aName.trim().length > 0 && jackpotSequenceReady(aSequence) && jackpotPrizeReady(prizeNum) && !!aEnds;
  const padMax = status?.phase === "live" && status.codeLength > 0 ? status.codeLength : 10;

  return (
    <div className="space-y-3" data-testid="world-jackpot-desk">
      <NativeCard isLight={isLight} title={t("worldRemainder.taiJackpotTitle")}>
        {statusFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldRemainder.taiJackpotLoadTitle")}
            message={t("worldRemainder.taiJackpotLoadMessage")}
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : status === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldRemainder.taiJackpotLoading")} />
        ) : status.phase === "none" ? (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldRemainder.taiJackpotEmpty")}
          />
        ) : (
          <div data-testid="world-jackpot-status">
            <p className={`text-sm font-black ${strong}`}>
              {t("worldRemainder.taiJackpotPrizeLine", { name: status.name ?? t("worldRemainder.taiJackpotTitle"), prize: status.prizeCredits.toLocaleString(i18n.language) })}
              <span className={`ml-2 rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] font-black uppercase ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {t(PHASE_KEY[status.phase] ?? "worldRemainder.taiPhaseUpcoming")}
              </span>
            </p>
            <p className={`mt-1 text-xs ${muted}`}>
              {status.phase === "live" && t("worldRemainder.taiPhaseLiveLine", { length: status.codeLength })}
              {status.phase === "claimed" && t("worldRemainder.taiPhaseClaimedLine", { by: status.winnerDisplayName ? t("worldRemainder.taiClaimedBy", { name: status.winnerDisplayName }) : "" })}
              {status.phase === "upcoming" && t("worldRemainder.taiPhaseUpcomingLine", { length: status.codeLength })}
              {status.phase === "ended" && t("worldRemainder.taiPhaseEndedLine")}
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
                  {t("worldRemainder.taiAttemptButton")}
                </button>
              </div>
            )}
            {status.phase === "live" && isGuest && (
              <p className={`mt-2 text-xs ${muted}`} data-testid="world-jackpot-guest">
                {t("worldRemainder.taiJackpotGuestLine")}
              </p>
            )}
            {outcome && <p className={`mt-2 ${noteCls(isLight)}`} data-testid="world-jackpot-outcome">{outcome}</p>}
          </div>
        )}

        {/* Admin creation surface — fail-closed, server re-checked. */}
        {isAdmin === true && (
          <div className="mt-4" data-testid="world-jackpot-admin">
            <p className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              <ShieldCheck className="h-3.5 w-3.5" /> {t("worldRemainder.taiAdminHeading")}
            </p>
            <div className="mt-2 space-y-2">
              <input value={aName} onChange={(e) => setAName(e.target.value)} placeholder={t("worldRemainder.taiAdminNamePlaceholder")} maxLength={120} className={inputCls(isLight)} data-testid="world-jackpot-admin-name" aria-label={t("worldRemainder.taiAdminNamePlaceholder")} />
              <div className="flex flex-wrap gap-2">
                <label className={`flex-1 text-xs ${muted}`}>
                  {t("worldRemainder.taiAdminPrizeLabel")}
                  <input value={aPrize} onChange={(e) => setAPrize(e.target.value)} inputMode="numeric" className={inputCls(isLight)} data-testid="world-jackpot-admin-prize" />
                </label>
                <label className={`flex-1 text-xs ${muted}`}>
                  {t("worldRemainder.taiStartsLabel")}
                  <input type="datetime-local" value={aStarts} onChange={(e) => setAStarts(e.target.value)} className={inputCls(isLight)} data-testid="world-jackpot-admin-starts" />
                </label>
                <label className={`flex-1 text-xs ${muted}`}>
                  {t("worldRemainder.taiEndsLabel")}
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
                {t("worldRemainder.taiAdminCreate")}
              </button>
              {adminNote && <p className={noteCls(isLight)} data-testid="world-jackpot-admin-note">{adminNote}</p>}
            </div>

            <div className="mt-3">
              {eventsFailed ? (
                <NativeErrorState isLight={isLight} title={t("worldRemainder.taiEventsLoadTitle")} message={t("worldRemainder.taiEventsLoadMessage")} onRetry={() => void loadEvents()} />
              ) : events === null ? (
                <NativeLoadingState isLight={isLight} message={t("worldRemainder.taiEventsLoading")} />
              ) : events.length === 0 ? (
                <p className={`text-xs ${muted}`}>{t("worldRemainder.taiEventsEmpty")}</p>
              ) : (
                <div className="space-y-1.5">
                  {events.map((ev) => (
                    <div key={ev.id} className="flex flex-wrap items-center gap-2" data-testid="world-jackpot-admin-event">
                      <span className={`min-w-0 flex-1 truncate text-sm ${strong}`}>
                        {ev.name} <span className={muted}>{t("worldRemainder.taiAdminEventMeta", { prize: ev.prizeCredits.toLocaleString(i18n.language), moves: ev.codeLength, phase: t(PHASE_KEY[jackpotEventPhase(ev)] ?? "worldRemainder.taiPhaseUpcoming") })}</span>
                      </span>
                      <button
                        type="button"
                        disabled={adminBusy === ev.id || !!ev.winnerUserId}
                        onClick={() => void toggleEvent(ev)}
                        className={chipBtn(isLight)}
                        data-testid={`world-jackpot-admin-toggle-${ev.id}`}
                      >
                        {adminBusy === ev.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {ev.isActive ? t("worldRemainder.taiDeactivate") : t("worldRemainder.taiActivate")}
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
