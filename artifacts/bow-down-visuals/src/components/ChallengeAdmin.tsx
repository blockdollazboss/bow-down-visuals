import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, RotateCcw, Trash2, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  challengeLifecycleTargets,
  parseAdminChallenges,
  parseChallengeDetail,
  parseJudgeResult,
  prizeDraftError,
  prizeDraftTotal,
  type AdminChallengeRow,
  type ChallengeDetail,
  type JudgeResult,
  type PrizeDraft,
} from "@/lib/admin-benches";

/* ─── Admin: Challenges — the challenge engine's missing bench ───────
   The rail (POST /admin/challenges/:slug/prizes · /lifecycle · /judge)
   had NO frontend consumer: prize pools, lifecycle moves and the
   crowning itself could only be driven by hand-rolled API calls.
   This bench docks onto those exact verbs. The list rides
   GET /admin/challenges (every challenge, any state — the public
   lists only show upcoming/live); the detail rides the public
   GET /challenges/:slug. The bench never offers a move the rail
   would refuse: the pool editor mirrors the rail's rules and locks
   once winners are announced, 'winners' is not a lifecycle target
   (only /judge crowns — that's what pays), and judging goes through
   a confirm that says the prizes pay immediately. */

const STATUS_CLS: Record<string, string> = {
  upcoming: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  live: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  judging: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  winners: "border-white/20 bg-white/5 text-white/60",
};

const STATUS_KEY: Record<string, string> = {
  upcoming: "admin.challenges.status.upcoming",
  live: "admin.challenges.status.live",
  judging: "admin.challenges.status.judging",
  winners: "admin.challenges.status.winners",
};

const PRIZE_ERROR_KEY: Record<string, string> = {
  empty: "admin.challenges.prizeError.empty",
  placeRange: "admin.challenges.prizeError.placeRange",
  placeDuplicate: "admin.challenges.prizeError.placeDuplicate",
  amountWhole: "admin.challenges.prizeError.amountWhole",
  amountMultiple: "admin.challenges.prizeError.amountMultiple",
  amountRange: "admin.challenges.prizeError.amountRange",
  overCap: "admin.challenges.prizeError.overCap",
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

export function ChallengeAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [rows, setRows] = useState<AdminChallengeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  /* Prize editor draft — seeded from the loaded detail's real pool. */
  const [prizeDraft, setPrizeDraft] = useState<PrizeDraft[]>([]);
  const [prizeMsg, setPrizeMsg] = useState<string | null>(null);
  /* Lifecycle draft. */
  const [lifeStatus, setLifeStatus] = useState("");
  const [lifeStarts, setLifeStarts] = useState("");
  const [lifeEnds, setLifeEnds] = useState("");
  const [lifeJudgingEnds, setLifeJudgingEnds] = useState("");
  const [lifeMsg, setLifeMsg] = useState<string | null>(null);
  /* Judge: by votes (places) or by hand (podium picks). */
  const [judgeMode, setJudgeMode] = useState<"votes" | "pick">("votes");
  const [judgePlaces, setJudgePlaces] = useState("3");
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [judgeConfirm, setJudgeConfirm] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<AdminChallengeRow[] | null> => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/challenges", { headers: await authHeaders() });
      const parsed = res.ok ? parseAdminChallenges(await res.json()) : null;
      if (parsed) {
        setRows(parsed);
        return parsed;
      }
      setLoadError(true);
      return null;
    } catch {
      setLoadError(true);
      return null;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  const loadDetail = useCallback(
    async (slug: string, freshRows?: AdminChallengeRow[]) => {
      setDetailLoading(true);
      setDetailError(false);
      setDetail(null);
      setJudgeResult(null);
      setJudgeConfirm(false);
      setPrizeMsg(null);
      setLifeMsg(null);
      setActionError(null);
      try {
        const res = await fetch(`/api/challenges/${encodeURIComponent(slug)}`);
        const parsed = res.ok ? parseChallengeDetail(await res.json()) : null;
        if (!parsed) {
          setDetailError(true);
          return;
        }
        setDetail(parsed);
        setPrizeDraft(
          parsed.prizes.map((p) => ({
            place: p.place,
            amount: String(p.prizeCredits),
            description: p.description,
          })),
        );
        setLifeStarts(toLocalInput(parsed.startsAt));
        setLifeEnds(toLocalInput(parsed.endsAt));
        setLifeJudgingEnds(toLocalInput(parsed.judgingEndsAt));
        const row = (freshRows ?? rows).find((r) => r.slug === slug);
        setLifeStatus(row?.status ?? parsed.status);
        setPicks({});
      } catch {
        setDetailError(true);
      } finally {
        setDetailLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authHeaders, rows],
  );

  const selected = rows.find((r) => r.slug === selectedSlug) ?? null;

  const select = (slug: string) => {
    setSelectedSlug(slug);
    void loadDetail(slug);
  };

  const refresh = async (slug: string) => {
    const fresh = await load();
    await loadDetail(slug, fresh ?? undefined);
  };

  const savePrizes = async () => {
    if (!selected) return;
    const invalid = prizeDraftError(prizeDraft);
    if (invalid) {
      setActionError(t(PRIZE_ERROR_KEY[invalid] ?? "admin.challenges.actionError"));
      return;
    }
    setBusy("prizes");
    setActionError(null);
    setPrizeMsg(null);
    try {
      const res = await fetch(`/api/admin/challenges/${encodeURIComponent(selected.slug)}/prizes`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          prizes: prizeDraft.map((p) => ({
            place: p.place,
            prize_credits: Number(p.amount),
            description: p.description,
          })),
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { total_credits?: number };
        setPrizeMsg(
          t("admin.challenges.prizesSaved", {
            total: (j.total_credits ?? prizeDraftTotal(prizeDraft)).toLocaleString(),
            count: prizeDraft.length,
          }),
        );
        await refresh(selected.slug);
      } else {
        setActionError((await railMessage(res)) ?? t("admin.challenges.actionError"));
      }
    } catch {
      setActionError(t("admin.challenges.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const saveLifecycle = async () => {
    if (!selected) return;
    setBusy("lifecycle");
    setActionError(null);
    setLifeMsg(null);
    try {
      const res = await fetch(`/api/admin/challenges/${encodeURIComponent(selected.slug)}/lifecycle`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          status: lifeStatus || undefined,
          starts_at: fromLocalInput(lifeStarts),
          ends_at: fromLocalInput(lifeEnds),
          judging_ends_at: fromLocalInput(lifeJudgingEnds),
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { effective_status?: string };
        setLifeMsg(
          t("admin.challenges.lifecycleSaved", {
            status: t(STATUS_KEY[j.effective_status ?? ""] ?? "", { defaultValue: j.effective_status ?? "" }),
          }),
        );
        await refresh(selected.slug);
      } else {
        setActionError((await railMessage(res)) ?? t("admin.challenges.actionError"));
      }
    } catch {
      setActionError(t("admin.challenges.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const submitJudge = async () => {
    if (!selected) return;
    let body: Record<string, unknown>;
    if (judgeMode === "votes") {
      const places = Number(judgePlaces);
      body = { places: Number.isInteger(places) && places >= 1 && places <= 10 ? places : 3 };
    } else {
      const winners = [1, 2, 3]
        .filter((place) => picks[place])
        .map((place) => ({ place, video_id: picks[place]! }));
      if (winners.length === 0) {
        setActionError(t("admin.challenges.pickRequired"));
        return;
      }
      body = { winners };
    }
    setBusy("judge");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/challenges/${encodeURIComponent(selected.slug)}/judge`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const parsed = parseJudgeResult(await res.json());
        if (parsed) setJudgeResult(parsed);
        setJudgeConfirm(false);
        await refresh(selected.slug);
        /* refresh() reloads the detail, which clears judgeResult —
           restore it so the outcome stays on screen. */
        if (parsed) setJudgeResult(parsed);
      } else {
        setActionError((await railMessage(res)) ?? t("admin.challenges.actionError"));
        setJudgeConfirm(false);
      }
    } catch {
      setActionError(t("admin.challenges.actionError"));
      setJudgeConfirm(false);
    } finally {
      setBusy(null);
    }
  };

  const draftError = prizeDraft.length > 0 ? prizeDraftError(prizeDraft) : null;
  const lifeTargets = selected ? challengeLifecycleTargets(selected) : [];

  return (
    <div
      className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="challenge-admin-bench"
    >
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.challenges.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">{t("admin.challenges.description")}</p>

      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("admin.challenges.loadErrorTitle")}
          </p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("admin.challenges.loadErrorBody")}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-white/40">{t("admin.challenges.empty")}</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {rows.map((r) => (
              <button
                key={r.slug}
                type="button"
                onClick={() => select(r.slug)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  selectedSlug === r.slug
                    ? "border-primary/60 bg-primary/15 text-[#e8c86a]"
                    : "border-white/10 bg-black/30 text-white/50 hover:text-white"
                }`}
              >
                {r.title || r.slug}
                <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] ${STATUS_CLS[r.effectiveStatus] ?? STATUS_CLS.upcoming}`}>
                  {t(STATUS_KEY[r.effectiveStatus] ?? "", { defaultValue: r.effectiveStatus })}
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
                <span>
                  {t("admin.challenges.entriesLabel")}{" "}
                  <span className="text-white/90 font-semibold">{selected.entryCount.toLocaleString()}</span>
                </span>
                <span>
                  {t("admin.challenges.poolLabel")}{" "}
                  <span className="text-white/90 font-semibold">{selected.prizePoolCredits.toLocaleString()} VB</span>
                </span>
                {selected.endsAt && (
                  <span>
                    {t("admin.challenges.endsLabel")}{" "}
                    <span className="text-white/90 font-semibold">{new Date(selected.endsAt).toLocaleString()}</span>
                  </span>
                )}
              </div>

              {detailLoading ? (
                <p className="mt-4 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /> {t("admin.challenges.detailLoading")}</p>
              ) : detailError ? (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4">
                  <p className={`font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{t("admin.challenges.detailErrorTitle")}</p>
                  <p className="text-sm text-red-200/80">{t("admin.challenges.detailErrorBody")}</p>
                  <button
                    type="button"
                    onClick={() => void loadDetail(selected.slug)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> {t("admin.challenges.retry")}
                  </button>
                </div>
              ) : detail ? (
                <>
                  {actionError && <p className="mt-3 text-sm font-bold text-red-400">{actionError}</p>}

                  {/* ── Prize pool ─────────────────────────────── */}
                  <div className="mt-5">
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                      {t("admin.challenges.prizesTitle")}
                    </p>
                    {detail.winnersAnnounced ? (
                      <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
                        {t("admin.challenges.prizesLocked")}
                      </p>
                    ) : (
                      <>
                        <div className="mt-3 space-y-2">
                          {prizeDraft.map((p, i) => (
                            <div key={i} className="flex flex-wrap items-end gap-2">
                              <label className={labelCls}>
                                {t("admin.challenges.placeLabel")}
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={p.place}
                                  onChange={(e) =>
                                    setPrizeDraft((d) => d.map((x, xi) => (xi === i ? { ...x, place: Number(e.target.value) } : x)))
                                  }
                                  className={`${inputCls} mt-1 block w-20`}
                                />
                              </label>
                              <label className={labelCls}>
                                {t("admin.challenges.amountLabel")}
                                <input
                                  type="number"
                                  min={0}
                                  step={100}
                                  value={p.amount}
                                  onChange={(e) =>
                                    setPrizeDraft((d) => d.map((x, xi) => (xi === i ? { ...x, amount: e.target.value } : x)))
                                  }
                                  className={`${inputCls} mt-1 block w-28`}
                                />
                              </label>
                              <label className={`${labelCls} flex-1 min-w-[10rem]`}>
                                {t("admin.challenges.prizeDescriptionLabel")}
                                <input
                                  type="text"
                                  maxLength={200}
                                  value={p.description}
                                  onChange={(e) =>
                                    setPrizeDraft((d) => d.map((x, xi) => (xi === i ? { ...x, description: e.target.value } : x)))
                                  }
                                  className={`${inputCls} mt-1 block w-full`}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => setPrizeDraft((d) => d.filter((_, xi) => xi !== i))}
                                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-semibold text-white/60 hover:text-white"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> {t("admin.challenges.removePrize")}
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={prizeDraft.length >= 10}
                            onClick={() =>
                              setPrizeDraft((d) => [
                                ...d,
                                { place: d.length + 1, amount: "100", description: "" },
                              ])
                            }
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-40"
                          >
                            <Plus className="h-3.5 w-3.5" /> {t("admin.challenges.addPrize")}
                          </button>
                          <span className="text-xs text-white/50">
                            {t("admin.challenges.poolTotal", { total: prizeDraftTotal(prizeDraft).toLocaleString() })}
                          </span>
                          {draftError && (
                            <span className="text-xs font-semibold text-red-300">
                              {t(PRIZE_ERROR_KEY[draftError] ?? "admin.challenges.actionError")}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={busy !== null || draftError !== null}
                          onClick={() => void savePrizes()}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                        >
                          {busy === "prizes" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {t("admin.challenges.savePrizes")}
                        </button>
                        {prizeMsg && <p className="mt-2 text-xs font-semibold text-emerald-300">{prizeMsg}</p>}
                      </>
                    )}
                  </div>

                  {/* ── Lifecycle ──────────────────────────────── */}
                  <div className="mt-6">
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                      {t("admin.challenges.lifecycleTitle")}
                    </p>
                    {selected.status === "winners" ? (
                      <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
                        {t("admin.challenges.winnersLocked")}
                      </p>
                    ) : (
                      <>
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <label className={labelCls}>
                            {t("admin.challenges.statusLabel")}
                            <select
                              value={lifeStatus}
                              onChange={(e) => setLifeStatus(e.target.value)}
                              className={`${inputCls} mt-1 block`}
                            >
                              <option value={selected.status}>
                                {t(STATUS_KEY[selected.status] ?? "", { defaultValue: selected.status })}
                              </option>
                              {lifeTargets.map((s) => (
                                <option key={s} value={s}>
                                  {t(STATUS_KEY[s] ?? "", { defaultValue: s })}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={labelCls}>
                            {t("admin.challenges.startsLabel")}
                            <input type="datetime-local" value={lifeStarts} onChange={(e) => setLifeStarts(e.target.value)} className={`${inputCls} mt-1 block`} />
                          </label>
                          <label className={labelCls}>
                            {t("admin.challenges.endsLabel")}
                            <input type="datetime-local" value={lifeEnds} onChange={(e) => setLifeEnds(e.target.value)} className={`${inputCls} mt-1 block`} />
                          </label>
                          <label className={labelCls}>
                            {t("admin.challenges.judgingEndsLabel")}
                            <input type="datetime-local" value={lifeJudgingEnds} onChange={(e) => setLifeJudgingEnds(e.target.value)} className={`${inputCls} mt-1 block`} />
                          </label>
                        </div>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void saveLifecycle()}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                        >
                          {busy === "lifecycle" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {t("admin.challenges.saveLifecycle")}
                        </button>
                        {lifeMsg && <p className="mt-2 text-xs font-semibold text-emerald-300">{lifeMsg}</p>}
                      </>
                    )}
                  </div>

                  {/* ── Judge ──────────────────────────────────── */}
                  <div className="mt-6">
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                      {t("admin.challenges.judgeTitle")}
                    </p>
                    <p className="mt-1 text-xs text-white/50">{t("admin.challenges.judgeBlurb")}</p>

                    {judgeResult && (
                      <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200" data-testid="challenge-judge-result">
                        <p className="font-semibold">
                          {t("admin.challenges.judgeDone", { paid: judgeResult.paid, already: judgeResult.alreadyPaid })}
                        </p>
                        {judgeResult.budgetCapped.length > 0 && (
                          <p className="mt-1 text-[#e8c86a]">
                            {t("admin.challenges.judgeBudgetCapped", { list: judgeResult.budgetCapped.join("; ") })}
                          </p>
                        )}
                        {judgeResult.payoutErrors.length > 0 && (
                          <p className="mt-1 text-red-300">
                            {t("admin.challenges.judgeErrors", { list: judgeResult.payoutErrors.join("; ") })}
                          </p>
                        )}
                      </div>
                    )}

                    {!judgeConfirm ? (
                      <>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setJudgeMode("votes")}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${judgeMode === "votes" ? "border-primary/60 bg-primary/15 text-[#e8c86a]" : "border-white/10 bg-black/30 text-white/50 hover:text-white"}`}
                          >
                            {t("admin.challenges.judgeByVotes")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setJudgeMode("pick")}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${judgeMode === "pick" ? "border-primary/60 bg-primary/15 text-[#e8c86a]" : "border-white/10 bg-black/30 text-white/50 hover:text-white"}`}
                          >
                            {t("admin.challenges.judgeByPick")}
                          </button>
                        </div>
                        {judgeMode === "votes" ? (
                          <label className={`${labelCls} mt-3`}>
                            {t("admin.challenges.placesLabel")}
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={judgePlaces}
                              onChange={(e) => setJudgePlaces(e.target.value)}
                              className={`${inputCls} mt-1 block w-20`}
                            />
                          </label>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {[1, 2, 3].map((place) => (
                              <label key={place} className={labelCls}>
                                {t("admin.challenges.pickPlaceLabel", { place })}
                                <select
                                  value={picks[place] ?? ""}
                                  onChange={(e) => setPicks((p) => ({ ...p, [place]: e.target.value }))}
                                  className={`${inputCls} mt-1 block w-full max-w-md`}
                                >
                                  <option value="">{t("admin.challenges.pickNone")}</option>
                                  {detail.entries
                                    .filter((e) => !Object.entries(picks).some(([pl, id]) => Number(pl) !== place && id === e.id))
                                    .map((e) => (
                                      <option key={e.id} value={e.id}>
                                        {e.title || e.id} — {e.creatorName} · {e.voteCount} votes
                                      </option>
                                    ))}
                                </select>
                              </label>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={busy !== null || detail.entries.length === 0}
                          onClick={() => setJudgeConfirm(true)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-400/10 px-4 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-400/20 disabled:opacity-50"
                        >
                          <Trophy className="h-3.5 w-3.5" /> {t("admin.challenges.judgeButton")}
                        </button>
                        {detail.entries.length === 0 && (
                          <p className="mt-2 text-xs text-white/40">{t("admin.challenges.noEntries")}</p>
                        )}
                      </>
                    ) : (
                      <div
                        className={`mt-3 rounded-lg border p-3 ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/30 bg-black/40"}`}
                        data-testid="challenge-judge-confirm"
                      >
                        <p className={`text-sm font-semibold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                          {t("admin.challenges.judgeConfirmBody", { title: selected.title || selected.slug })}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void submitJudge()}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                          >
                            {busy === "judge" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            {t("admin.challenges.judgeConfirmButton")}
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setJudgeConfirm(false)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-50"
                          >
                            {t("admin.challenges.cancelButton")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-[11px] text-white/30">{t("admin.challenges.footerNote")}</p>
    </div>
  );
}
