import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot, Clapperboard, ClipboardCheck, GraduationCap, Loader2, Plus, Radio,
  Scissors, ShieldAlert, Sparkles, Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeLoadingState } from "@/components/world/native";
import {
  COPILOT_PREP_PATH, COPILOT_CLIP_PLAN_PATH,
  COPILOT_PREP_COST, COPILOT_PREP_FEATURE,
  COPILOT_CLIP_PLAN_COST, COPILOT_CLIP_PLAN_FEATURE,
  COPILOT_PLATFORMS,
  copilotPrepReady, copilotClipPlanReady,
  buildCopilotPrepBody, buildCopilotClipPlanBody,
  normalizeCopilotPrep, normalizeCopilotMoments,
  type CopilotPrepView, type CopilotClipMoment,
  LIVE_PREFS_PATH, MY_STREAMS_PATH,
  STAGE_MANAGER_PATH, STAGE_MANAGER_MUTE_PATH, STAGE_MANAGER_UNPIN_PATH,
  HIGHLIGHTS_PATH, HIGHLIGHT_APPROVE_PATH, HIGHLIGHT_DISMISS_PATH, HIGHLIGHT_REFRESH_PATH,
  CLASS_ROSTER_PATH,
  HIGHLIGHT_CUT_COST_VB, HIGHLIGHT_CUT_FEATURE,
  normalizeLivePrefs, buildLivePrefsPatch,
  linkRuleReady, buildLinkRule, LINK_RULES_UI_MAX,
  type LivePrefsView, type LiveLinkRule,
  normalizeMyStreams, initialStageStreamId,
  normalizeStageState, normalizeHighlightProposals, normalizeClassRoster,
  highlightClock,
  type StageStreamRow, type StageStateView, type HighlightProposalView, type ClassRosterRow,
} from "@/lib/world/live-desk";

/* ─── Live Wave IV — Stream Copilot + Live Stage automation ──────
   The /go-live Live hub's other half, docked in the hall's Screen
   panel under the wave I–III desks, on the panels' own rails:
   - LiveCopilotDesk: StreamCopilotSection's pre-stream prep and
     post-stream clip plan — 100 VB each from the credit-costs
     registry, through the confirmed-spend door, with the rail's
     charge-then-refund-on-failure honesty mirrored (a 402 reads
     as an honest not-enough-Bucs line; the balance refreshes after
     a settled call). Prep and post-stream only — never live
     assistance, exactly as the rail's own scope states.
   - LiveStageSection: LiveStageDesk's automation — the /api/live-
     prefs Stage Manager switches + link rules, the per-stream
     co-host state (mute, pin, trouble flags), Auto-Highlights
     proposals (approve rides the 200 VB confirm override; nothing
     posts without the creator's yes) and the class roster. The
     co-host never acts on a person — flags are for the creator's
     call, and this desk says so, like the 2D desk does.
   The file stands apart from LiveDesk.tsx on purpose: waves I–III
   there are free rails pinned as charging nothing; this desk is
   the panel's first charged live surface and carries its own pins
   (live-desk-copilot.test.ts). */

function DeskCard({ isLight, testId, children }: { isLight: boolean; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
      {children}
    </div>
  );
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
const selectCls = (isLight: boolean) =>
  `rounded-lg border px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none bdv-touch-target ${
    isLight ? "border-[#C9A84C]/40 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black text-white"
  }`;

function Toggle({ on, onClick, label, disabled, strong }: { on: boolean; onClick: () => void; label: string; disabled?: boolean; strong: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
      <span className={strong}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors bdv-touch-switch ${on ? "bg-[#d4af37]" : "bg-white/15"} ${disabled ? "opacity-50" : ""}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/* ═══ Stream Copilot ══════════════════════════════════════════════ */

function CopilotSection({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [mode, setMode] = useState<"prep" | "clips">("prep");
  const [streamTitle, setStreamTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<string>(COPILOT_PLATFORMS[0]);
  const [recap, setRecap] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [prep, setPrep] = useState<CopilotPrepView | null>(null);
  const [moments, setMoments] = useState<CopilotClipMoment[]>([]);

  /* StreamCopilotSection's post, verbatim in shape: the confirmed
     door (which attaches the session token itself; the explicit
     header rides along exactly like the page sends it), null on a
     declined confirmation, 402 / out_of_credits → the honest
     not-enough-Bucs state, balance refreshed after a settled call. */
  async function post(url: string, body: object, cost: number, feature: string): Promise<Record<string, unknown> | null> {
    const token = await getAccessToken();
    const res = await confirmedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      overrideCost: cost,
      overrideFeature: feature,
      body: JSON.stringify(body),
    });
    if (!res) return null;
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      void refreshProfile();
      return null;
    }
    if (!res.ok) throw new Error(apiErrorMessage(data, t("worldDeskRemainder.copRequestFailed")));
    void refreshProfile();
    return data;
  }

  async function generatePrep() {
    if (!copilotPrepReady(streamTitle, topic) || loading) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await post(COPILOT_PREP_PATH, buildCopilotPrepBody({ streamTitle, topic, platform }), COPILOT_PREP_COST, COPILOT_PREP_FEATURE);
      if (data) setPrep(normalizeCopilotPrep(data));
    } catch (e) {
      setError(plainErrorText(e, t("worldDeskRemainder.copPrepFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function generateClipPlan() {
    if (!copilotClipPlanReady(recap) || loading) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await post(COPILOT_CLIP_PLAN_PATH, buildCopilotClipPlanBody({ recap, topic }), COPILOT_CLIP_PLAN_COST, COPILOT_CLIP_PLAN_FEATURE);
      if (data) setMoments(normalizeCopilotMoments(data));
    } catch (e) {
      setError(plainErrorText(e, t("worldDeskRemainder.copClipPlanFailed")));
    } finally {
      setLoading(false);
    }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <DeskCard isLight={isLight} testId="world-live-copilot">
      <div className="space-y-4">
        <div>
          <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
            <Radio className="h-4 w-4 text-[#d4af37]" /> {t("worldDeskRemainder.copTitle")}
          </p>
          <p className={`mt-1 text-sm ${muted}`}>
            {t("worldDeskRemainder.copIntro")}
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-[#d4af37]/25 p-1" role="tablist" aria-label={t("worldDeskRemainder.copModeAria")}>
          {([
            { key: "prep", label: t("worldDeskRemainder.copTabPrep"), icon: ClipboardCheck },
            { key: "clips", label: t("worldDeskRemainder.copTabClips"), icon: Scissors },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              data-testid={`world-live-copilot-tab-${key}`}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${mode === key ? "bg-[#d4af37] text-black" : `${muted} hover:text-current`}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {mode === "prep" ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("worldDeskRemainder.copStreamTitleLabel")}</label>
                <input aria-label={t("worldDeskRemainder.copStreamTitleLabel")} value={streamTitle} onChange={(e) => setStreamTitle(e.target.value)} className={`${inputCls(isLight)} mt-1.5`} maxLength={200} data-testid="world-live-copilot-title" />
              </div>
              <div>
                <label className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("worldDeskRemainder.copTopicLabel")}</label>
                <input aria-label={t("worldDeskRemainder.copTopicLabel")} value={topic} onChange={(e) => setTopic(e.target.value)} className={`${inputCls(isLight)} mt-1.5`} maxLength={300} data-testid="world-live-copilot-topic" />
              </div>
            </div>
            <div>
              <label className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("worldDeskRemainder.copPlatformLabel")}</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {COPILOT_PLATFORMS.map((p) => (
                  <button key={p} type="button" onClick={() => setPlatform(p)} data-testid={`world-live-copilot-platform-${p}`}
                    className={platform === p ? goldBtn : chipBtn(isLight)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => void generatePrep()} disabled={loading || !copilotPrepReady(streamTitle, topic)}
              className={goldBtn} data-testid="world-live-copilot-prep-go">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t("worldDeskRemainder.copBuildPrep", { cost: COPILOT_PREP_COST })}
            </button>

            {prep && (
              <div className="grid gap-3 md:grid-cols-3 pt-1" data-testid="world-live-copilot-prep-result">
                {([
                  [t("worldDeskRemainder.copChecklist"), prep.checklist],
                  [t("worldDeskRemainder.copTalkingPoints"), prep.talkingPoints],
                  [t("worldDeskRemainder.copWatchFors"), prep.clipWatchFors],
                ] as [string, string[]][]).map(([label, items]) => (
                  <div key={label} className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{label}</p>
                    <ul className={`space-y-1.5 text-sm ${strong}`}>
                      {items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-[#d4af37]">•</span>{it}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("worldDeskRemainder.copRecapLabel")}</label>
              <textarea aria-label={t("worldDeskRemainder.copRecapLabel")} value={recap} onChange={(e) => setRecap(e.target.value)}
                placeholder={t("worldDeskRemainder.copRecapPlaceholder")}
                className={`${inputCls(isLight)} mt-1.5 min-h-[110px] resize-y`} maxLength={3000} data-testid="world-live-copilot-recap" />
            </div>
            <button type="button" onClick={() => void generateClipPlan()} disabled={loading || !copilotClipPlanReady(recap)}
              className={goldBtn} data-testid="world-live-copilot-clips-go">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t("worldDeskRemainder.copSpotClips", { cost: COPILOT_CLIP_PLAN_COST })}
            </button>

            {moments.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 pt-1" data-testid="world-live-copilot-clips-result">
                {moments.map((m, i) => (
                  <div key={i} className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{m.timestampHint}</p>
                    <p className={`mt-1 text-sm font-black ${strong}`}>{m.title}</p>
                    <p className={`mt-1.5 text-sm ${muted}`}>{m.description}</p>
                    <p className={`mt-1.5 text-xs italic ${muted}`}>{m.whyItWorks}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className={`text-sm ${isLight ? "text-red-700" : "text-red-400"}`} data-testid="world-live-copilot-error">{error}</p>}
        {outOfCredits && (
          <p className={`text-sm font-semibold ${strong}`} data-testid="world-live-copilot-ooc">
            {t("worldDeskRemainder.copOutOfCredits")}
          </p>
        )}
      </div>
    </DeskCard>
  );
}

/* ═══ Live Stage automation ═══════════════════════════════════════ */

function RuleAdder({ isLight, onAdd }: { isLight: boolean; onAdd: (rule: LiveLinkRule) => void }) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const ready = linkRuleReady(keyword, label, url);
  return (
    <div className="grid gap-2 pt-1 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
      <input aria-label={t("worldDeskRemainder.copKeyword")} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t("worldDeskRemainder.copKeyword")} className={inputCls(isLight)} maxLength={40} data-testid="world-live-stage-rule-keyword" />
      <input aria-label={t("worldDeskRemainder.copLabel")} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("worldDeskRemainder.copLabel")} className={inputCls(isLight)} maxLength={60} data-testid="world-live-stage-rule-label" />
      <input aria-label={t("worldDeskRemainder.copUrlAria")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputCls(isLight)} maxLength={500} data-testid="world-live-stage-rule-url" />
      <button type="button" disabled={!ready} data-testid="world-live-stage-rule-add"
        onClick={() => { onAdd(buildLinkRule(keyword, label, url)); setKeyword(""); setLabel(""); setUrl(""); }}
        className={chipBtn(isLight)}>
        <Plus className="h-3.5 w-3.5" /> {t("worldDeskRemainder.copAdd")}
      </button>
    </div>
  );
}

function StageSection({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [prefs, setPrefs] = useState<LivePrefsView | null>(null);
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [streams, setStreams] = useState<StageStreamRow[]>([]);
  const [streamsError, setStreamsError] = useState(false);
  const [streamId, setStreamId] = useState<string>("");
  const [stage, setStage] = useState<StageStateView | null>(null);
  const [proposals, setProposals] = useState<HighlightProposalView[]>([]);
  const [roster, setRoster] = useState<ClassRosterRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authed = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch(LIVE_PREFS_PATH, { headers: await authed() });
      if (!res.ok) throw new Error("prefs");
      setPrefs(normalizeLivePrefs(await res.json()));
      setPrefsFailed(false);
    } catch {
      /* A failed load is NOT default switches — the desk shows its
         error + retry instead of a made-up settings state. */
      setPrefsFailed(true);
    }
  }, [authed]);

  const loadStreams = useCallback(async () => {
    try {
      const res = await fetch(MY_STREAMS_PATH, { headers: await authed() });
      if (!res.ok) throw new Error("streams");
      const rows = normalizeMyStreams(await res.json());
      setStreams(rows);
      setStreamsError(false);
      setStreamId((prev) => prev || initialStageStreamId(rows));
    } catch {
      /* A failed load is NOT an empty stream list — the picker
         shows its error option + retry instead of "No streams yet." */
      setStreamsError(true);
    }
  }, [authed]);

  const stream = streams.find((s) => s.id === streamId) ?? null;

  const loadDesk = useCallback(async () => {
    if (!streamId) return;
    const headers = await authed();
    const [stageRes, hlRes] = await Promise.all([
      fetch(STAGE_MANAGER_PATH(streamId), { headers }),
      fetch(HIGHLIGHTS_PATH(streamId), { headers }),
    ]);
    if (stageRes.ok) setStage(normalizeStageState(await stageRes.json()));
    if (hlRes.ok) setProposals(normalizeHighlightProposals(await hlRes.json()));
    const current = streams.find((s) => s.id === streamId);
    if (current?.isClass) {
      const rosterRes = await fetch(CLASS_ROSTER_PATH(streamId), { headers });
      if (rosterRes.ok) setRoster(normalizeClassRoster(await rosterRes.json()));
    } else {
      setRoster(null);
    }
  }, [authed, streamId, streams]);

  useEffect(() => { void loadPrefs(); void loadStreams(); }, [loadPrefs, loadStreams]);
  useEffect(() => { void loadDesk(); }, [loadDesk]);

  /* While a cut is rendering, poll its settlement every few seconds. */
  const anyCutting = proposals.some((p) => p.status === "approved");
  useEffect(() => {
    if (!anyCutting || !streamId) return;
    pollRef.current = setInterval(() => {
      void (async () => {
        const headers = await authed();
        for (const p of proposals.filter((x) => x.status === "approved")) {
          await fetch(HIGHLIGHT_REFRESH_PATH(streamId, p.id), { method: "POST", headers });
        }
        const res = await fetch(HIGHLIGHTS_PATH(streamId), { headers });
        if (res.ok) setProposals(normalizeHighlightProposals(await res.json()));
      })();
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [anyCutting, streamId, proposals, authed]);

  async function savePrefs() {
    if (!prefs || savingPrefs) return;
    setSavingPrefs(true); setNote(null);
    try {
      const res = await fetch(LIVE_PREFS_PATH, {
        method: "PATCH",
        headers: { ...(await authed()), "Content-Type": "application/json" },
        body: JSON.stringify(buildLivePrefsPatch(prefs)),
      });
      if (res.ok) { setPrefs(normalizeLivePrefs(await res.json())); setPrefsDirty(false); setNote(t("worldDeskRemainder.copSettingsSaved")); }
      else setNote(t("worldDeskRemainder.copSettingsSaveFailed"));
    } finally { setSavingPrefs(false); }
  }

  async function toggleMute() {
    if (!streamId || !stage) return;
    const res = await fetch(STAGE_MANAGER_MUTE_PATH(streamId), {
      method: "POST",
      headers: { ...(await authed()), "Content-Type": "application/json" },
      body: JSON.stringify({ muted: !stage.muted }),
    });
    if (res.ok) setStage({ ...stage, muted: !stage.muted });
  }

  async function clearPin() {
    if (!streamId) return;
    const res = await fetch(STAGE_MANAGER_UNPIN_PATH(streamId), {
      method: "POST", headers: await authed(),
    });
    if (res.ok) setStage((s) => (s ? { ...s, stagePinned: null } : s));
  }

  async function decide(p: HighlightProposalView, action: "approve" | "dismiss") {
    if (!streamId || busyId) return;
    setBusyId(p.id); setNote(null);
    try {
      const headers = await authed();
      if (action === "approve") {
        const res = await confirmedFetch(HIGHLIGHT_APPROVE_PATH(streamId, p.id), {
          method: "POST", headers, overrideCost: HIGHLIGHT_CUT_COST_VB, overrideFeature: HIGHLIGHT_CUT_FEATURE,
        });
        if (!res) { setNote(t("worldDeskRemainder.copCutCancelled")); return; }
        if (res.status === 402) { setNote(t("worldDeskRemainder.copCutNotEnough")); return; }
        if (!res.ok) { setNote(t("worldDeskRemainder.copCutDidntStart")); return; }
      } else {
        const res = await fetch(HIGHLIGHT_DISMISS_PATH(streamId, p.id), { method: "POST", headers });
        if (!res.ok) { setNote(t("worldDeskRemainder.copDismissFailed")); return; }
      }
      const res = await fetch(HIGHLIGHTS_PATH(streamId), { headers });
      if (res.ok) setProposals(normalizeHighlightProposals(await res.json()));
    } finally { setBusyId(null); }
  }

  function patchPrefs(patch: Partial<LivePrefsView>) {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setPrefsDirty(true);
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <DeskCard isLight={isLight} testId="world-live-stage">
      <div>
        <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Bot className="h-4 w-4 text-[#d4af37]" /> {t("worldDeskRemainder.copStageTitle")}
        </p>
        <p className={`mt-1 text-sm ${muted}`}>
          {t("worldDeskRemainder.copStageIntro")}
        </p>
      </div>

      {prefsFailed && !prefs ? (
        <p className={`mt-4 text-sm ${muted}`} data-testid="world-live-stage-prefs-error">
          {t("worldDeskRemainder.copPrefsLoadFailed")} <button type="button" className="font-bold underline" onClick={() => void loadPrefs()}>{t("worldDeskRemainder.copTryAgain")}</button>
        </p>
      ) : prefs === null ? (
        <div className="mt-4"><NativeLoadingState isLight={isLight} message={t("worldDeskRemainder.copPrefsLoading")} /></div>
      ) : prefs && (
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{t("worldDeskRemainder.copStageManager")}</p>
            <Toggle strong={strong} label={t("worldDeskRemainder.copToggleOnDuty")} on={prefs.stage_manager_enabled} onClick={() => patchPrefs({ stage_manager_enabled: !prefs.stage_manager_enabled })} />
            <Toggle strong={strong} label={t("worldDeskRemainder.copToggleLinks")} on={prefs.stage_manager_links_enabled} onClick={() => patchPrefs({ stage_manager_links_enabled: !prefs.stage_manager_links_enabled })} />
            <Toggle strong={strong} label={t("worldDeskRemainder.copTogglePin")} on={prefs.stage_manager_pin_enabled} onClick={() => patchPrefs({ stage_manager_pin_enabled: !prefs.stage_manager_pin_enabled })} />
            <Toggle strong={strong} label={t("worldDeskRemainder.copToggleSting")} on={prefs.stage_manager_sting_enabled} onClick={() => patchPrefs({ stage_manager_sting_enabled: !prefs.stage_manager_sting_enabled })} />
            <Toggle strong={strong} label={t("worldDeskRemainder.copToggleFlags")} on={prefs.stage_manager_flags_enabled} onClick={() => patchPrefs({ stage_manager_flags_enabled: !prefs.stage_manager_flags_enabled })} />
            <div className={`mt-3 border-t pt-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
              <Toggle strong={strong} label={t("worldDeskRemainder.copToggleHighlights")} on={prefs.auto_highlights_enabled} onClick={() => patchPrefs({ auto_highlights_enabled: !prefs.auto_highlights_enabled })} />
              <p className={`text-xs ${muted}`}>{t("worldDeskRemainder.copHighlightsNote")}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{t("worldDeskRemainder.copLinkRules")}</p>
            <div className="space-y-2">
              {prefs.stage_manager_link_rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={`rounded-md px-2 py-1 font-bold ${isLight ? "bg-[#C9A84C]/15 text-[#6B5B36]" : "bg-white/[0.06] text-white/80"}`}>“{rule.keyword}”</span>
                  <span className={`min-w-0 flex-1 truncate ${muted}`}>{rule.label} — {rule.url}</span>
                  <button type="button" aria-label={t("worldDeskRemainder.copRemoveRuleAria", { keyword: rule.keyword })} onClick={() => patchPrefs({ stage_manager_link_rules: prefs.stage_manager_link_rules.filter((_, j) => j !== i) })}
                    className={`${muted} transition hover:text-red-400`}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {prefs.stage_manager_link_rules.length < LINK_RULES_UI_MAX && (
                <RuleAdder isLight={isLight} onAdd={(rule) => patchPrefs({ stage_manager_link_rules: [...prefs.stage_manager_link_rules, rule] })} />
              )}
            </div>
          </div>
        </div>
      )}
      {prefsDirty && (
        <button type="button" onClick={() => void savePrefs()} disabled={savingPrefs}
          className={`${goldBtn} mt-4`} data-testid="world-live-stage-save-prefs">
          {savingPrefs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("worldDeskRemainder.copSavePrefs")}
        </button>
      )}

      <div className={`mt-6 border-t pt-5 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{t("worldDeskRemainder.copStreamDesk")}</p>
          <select aria-label={t("worldDeskRemainder.copStreamAria")} value={streamId} onChange={(e) => setStreamId(e.target.value)} className={selectCls(isLight)} data-testid="world-live-stage-stream">
            {streams.length === 0 && <option value="">{streamsError ? t("worldDeskRemainder.copStreamsLoadFailed") : t("worldDeskRemainder.copNoStreams")}</option>}
            {streams.map((s) => (
              <option key={s.id} value={s.id}>{s.title} · {s.status}{s.isClass ? t("worldDeskRemainder.copClassSuffix") : ""}</option>
            ))}
          </select>
          {streamsError && streams.length === 0 && (
            <button type="button" onClick={() => void loadStreams()} className="text-xs font-semibold text-[#d4af37] hover:underline" data-testid="world-live-stage-retry-streams">
              {t("worldDeskRemainder.copTryAgain")}
            </button>
          )}
          {stream && <span className={`text-xs ${muted}`}>{stream.hasVod ? t("worldDeskRemainder.copRecordingSaved") : t("worldDeskRemainder.copNoRecording")}</span>}
        </div>

        {stage && stream && (
          <div className="mb-5 flex flex-wrap items-center gap-4">
            <Toggle strong={strong} label={stage.muted ? t("worldDeskRemainder.copMuteMuted") : t("worldDeskRemainder.copMuteAction")} on={stage.muted} onClick={() => void toggleMute()} />
            {stage.stagePinned && (
              <span className={`inline-flex items-center gap-2 text-sm ${muted}`}>
                {t("worldDeskRemainder.copPinUp", { body: stage.stagePinned.body.slice(0, 60) })}
                <button type="button" onClick={() => void clearPin()} className="font-bold text-[#d4af37] hover:underline">{t("worldDeskRemainder.copClearIt")}</button>
              </span>
            )}
          </div>
        )}

        {stage && stage.flags.length > 0 && (
          <div className="mb-5 rounded-2xl border border-red-400/25 bg-red-400/[0.06] p-4" data-testid="world-live-stage-flags">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-red-300"><ShieldAlert className="h-4 w-4" /> {t("worldDeskRemainder.copFlagsTitle")}</p>
            <ul className={`space-y-1 text-sm ${strong}`}>
              {stage.flags.map((f, i) => <li key={i}>{new Date(f.at).toLocaleTimeString()} — {f.reason}</li>)}
            </ul>
          </div>
        )}

        <div className="mb-2 flex items-center gap-1.5">
          <Clapperboard className="h-4 w-4 text-[#d4af37]" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{t("worldDeskRemainder.copProposalsTitle")}</p>
        </div>
        {proposals.length === 0 ? (
          <p className={`text-sm ${muted}`}>{t("worldDeskRemainder.copProposalsEmpty")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3" data-testid="world-live-stage-proposals">
            {proposals.map((p) => (
              <div key={p.id} className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{highlightClock(p.startSec)} – {highlightClock(p.endSec)}</p>
                <p className={`mt-1 text-sm font-black ${strong}`}>{p.title}</p>
                <p className={`mt-1 text-xs ${muted}`}>{p.reason}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.status === "proposed" && (
                    <>
                      <button type="button" disabled={busyId === p.id} onClick={() => void decide(p, "approve")} className={goldBtn} data-testid="world-live-stage-approve">
                        {busyId === p.id ? t("worldDeskRemainder.copStarting") : t("worldDeskRemainder.copCutIt", { cost: HIGHLIGHT_CUT_COST_VB })}
                      </button>
                      <button type="button" disabled={busyId === p.id} onClick={() => void decide(p, "dismiss")} className={chipBtn(isLight)} data-testid="world-live-stage-dismiss">{t("worldDeskRemainder.copDismiss")}</button>
                    </>
                  )}
                  {p.status === "approved" && <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("worldDeskRemainder.copCutting")}</span>}
                  {p.status === "dismissed" && <span className={`text-xs ${muted}`}>{t("worldDeskRemainder.copDismissed")}</span>}
                  {p.status === "posted" && (p.outputUrl
                    ? <a href={p.outputUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#d4af37] hover:underline">{t("worldDeskRemainder.copWatchClip")}</a>
                    : <span className={`text-xs ${muted}`}>{t("worldDeskRemainder.copClipReady")}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}

        {stream?.isClass && (
          <div className="mt-6" data-testid="world-live-stage-roster">
            <div className="mb-2 flex items-center gap-1.5">
              <GraduationCap className="h-4 w-4 text-[#d4af37]" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">{t("worldDeskRemainder.copRosterTitle")}</p>
            </div>
            {roster && roster.length > 0 ? (
              <ul className={`space-y-1 text-sm ${strong}`}>
                {roster.map((r) => (
                  <li key={r.ticketId} className="flex justify-between gap-3">
                    <span>{r.displayName}</span>
                    <span className={muted}>{t("worldDeskRemainder.copRosterRow", { priceVb: r.priceVb, date: new Date(r.purchasedAt).toLocaleDateString() })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`text-sm ${muted}`}>{t("worldDeskRemainder.copRosterEmpty")}</p>
            )}
            <p className={`mt-2 text-xs ${muted}`}>
              {stream.classCourseProductId
                ? t("worldDeskRemainder.copReplayListed")
                : t("worldDeskRemainder.copReplayWillList")}
            </p>
          </div>
        )}
        {note && <p className={`mt-4 text-sm ${isLight ? "text-[#92600a]" : "text-amber-200"}`} data-testid="world-live-stage-note">{note}</p>}
      </div>
    </DeskCard>
  );
}

/* ═══ The docked desk ═════════════════════════════════════════════ */

export function LiveCopilotDesk({ isLight }: { isLight: boolean }) {
  return (
    <div className="space-y-5">
      <CopilotSection isLight={isLight} />
      <StageSection isLight={isLight} />
    </div>
  );
}
