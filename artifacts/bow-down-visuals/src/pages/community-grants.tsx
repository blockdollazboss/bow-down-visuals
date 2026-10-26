import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Coins, HandCoins, Loader2, Megaphone, Trophy, Vote } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  formatVb,
  monthLabel,
  type GrantRoundSurface,
  type GrantsSurfaceData,
} from "@/lib/community-grants";

/* ─── Community Grants (Stack-200 N15) ────────────────────────────────
   A monthly Visual Bucs pool funds ONE creator project, chosen by
   community vote. This page is the public surface: the pool (whatever
   an admin recorded on the round — no amount is hardcoded here), the
   candidates in the creators' own words, live tallies counted from
   real vote rows, the result, and the funded project's report-back.

   It docks inside the app shell in the Social section, beside
   Contests and Pitch & Fix — never a standalone microsite. VB ONLY:
   the grant is Visual Bucs, never cash, and the copy says so.

   Honesty rules on this surface:
   - no round open ⇒ "No round is open right now", plainly;
   - no candidates ⇒ "No candidates yet", plainly;
   - a tie says a tie — no winner is invented;
   - a funded project whose report-back hasn't landed says so. */

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function CommunityGrantsPage() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  usePageTitle(t("communityGrants.title"));

  const [data, setData] = useState<GrantsSurfaceData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Submit-project door state
  const [pTitle, setPTitle] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [pBusy, setPBusy] = useState(false);

  // Report-back door state
  const [rbBody, setRbBody] = useState("");
  const [rbBusy, setRbBusy] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/community-grants", { headers: await authHeaders() });
      if (!res.ok) throw new Error("grants failed");
      setData((await res.json()) as GrantsSurfaceData);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const cardCls = isLight
    ? "rounded-2xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F7EDD2] shadow-sm"
    : "rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls = `w-full rounded-lg border px-3 py-2.5 text-sm font-medium outline-none focus:border-[#d4a017] ${isLight ? "border-[#C9A84C]/50 bg-white text-[#2A1E07]" : "border-white/15 bg-black/40 text-white"}`;
  const labelCls = `mb-1.5 block text-xs font-extrabold tracking-wide ${isLight ? "text-[#2A1E07]" : "text-white"}`;
  const subCls = isLight ? "text-sm leading-relaxed text-[#5c5138]" : "text-sm leading-relaxed text-white/55";
  const headCls = isLight ? "text-[#2A1E07]" : "text-white";

  async function castVote(roundId: string, candidateId: string) {
    if (!user) { setNote({ ok: false, text: t("communityGrants.signInToVote") }); return; }
    setBusyId(candidateId);
    try {
      const res = await fetch(`/api/community-grants/${roundId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ candidateId }),
      });
      if (!res.ok) throw new Error("vote failed");
      setNote({ ok: true, text: t("communityGrants.voteRecorded") });
      await load();
    } catch {
      setNote({ ok: false, text: t("communityGrants.voteError") });
    } finally { setBusyId(null); }
  }

  async function withdrawVote(roundId: string) {
    setBusyId("withdraw");
    try {
      const res = await fetch(`/api/community-grants/${roundId}/vote`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("withdraw failed");
      setNote({ ok: true, text: t("communityGrants.voteWithdrawn") });
      await load();
    } catch {
      setNote({ ok: false, text: t("communityGrants.voteError") });
    } finally { setBusyId(null); }
  }

  async function submitProject(e: React.FormEvent) {
    e.preventDefault();
    const current = data?.current;
    if (!current) return;
    if (!user) { setNote({ ok: false, text: t("communityGrants.signInToSubmit") }); return; }
    if (!pTitle.trim() || !pDesc.trim()) { setNote({ ok: false, text: t("communityGrants.projectRequired") }); return; }
    setPBusy(true);
    try {
      const res = await fetch(`/api/community-grants/${current.round.id}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ title: pTitle, description: pDesc }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? "submit failed");
      }
      setNote({ ok: true, text: t("communityGrants.projectSubmitted") });
      setPTitle(""); setPDesc("");
      await load();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error && err.message !== "submit failed" ? err.message : t("communityGrants.submitError") });
    } finally { setPBusy(false); }
  }

  async function submitReportBack(e: React.FormEvent) {
    e.preventDefault();
    const current = data?.current;
    if (!current || !rbBody.trim()) return;
    setRbBusy(true);
    try {
      const res = await fetch(`/api/community-grants/${current.round.id}/report-back`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ body: rbBody }),
      });
      if (!res.ok) throw new Error("report failed");
      setNote({ ok: true, text: t("communityGrants.reportPosted") });
      setRbBody("");
      await load();
    } catch {
      setNote({ ok: false, text: t("communityGrants.submitError") });
    } finally { setRbBusy(false); }
  }

  function RoundBlock({ surface, isCurrent }: { surface: GrantRoundSurface; isCurrent: boolean }) {
    const { round, phase, candidates } = surface;
    const winner = candidates.find((c) => c.isWinner);
    const myCandidate = user ? candidates.find((c) => c.creatorUserId === user.id) : undefined;
    const iAmWinner = !!winner && !!user && winner.creatorUserId === user.id;
    return (
      <section className={`${cardCls} p-5 md:p-6`} data-testid={isCurrent ? "grants-current-round" : "grants-past-round"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={`font-serif text-2xl font-bold ${headCls}`}>{monthLabel(round.monthKey)}</h2>
            <p className={subCls}>
              {t("communityGrants.submissionsWindow", { open: fmtDate(round.submissionsOpenAt), close: fmtDate(round.submissionsCloseAt) })}
              {" · "}
              {t("communityGrants.votingWindow", { open: fmtDate(round.votingOpenAt), close: fmtDate(round.votingCloseAt) })}
            </p>
          </div>
          <div className="text-right" data-testid="grants-pool">
            <div className="flex items-center gap-1.5 text-xl font-extrabold text-[#d4a017]">
              <Coins className="h-5 w-5" aria-hidden="true" /> {formatVb(round.poolVb)}
            </div>
            <p className={`text-xs ${subCls}`}>{t("communityGrants.poolCaption")}</p>
          </div>
        </div>

        {round.resultStatus === "winner" && winner && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4" data-testid="grants-result">
            <p className="flex items-center gap-2 font-extrabold text-emerald-500">
              <Trophy className="h-5 w-5" aria-hidden="true" /> {t("communityGrants.fundedProject")}
            </p>
            <p className={`mt-1 font-bold ${headCls}`}>{winner.title} — {winner.creatorName}</p>
            <p className={subCls}>{t("communityGrants.fundedLine", { votes: winner.votes, pool: formatVb(round.poolVb) })}</p>
            {winner.reportBack ? (
              <div className="mt-3" data-testid="grants-report-back">
                <p className="flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-emerald-500">
                  <Megaphone className="h-4 w-4" aria-hidden="true" /> {t("communityGrants.reportBackTitle")}
                </p>
                <p className={`mt-1 whitespace-pre-wrap text-sm ${isLight ? "text-[#3d3418]" : "text-white/85"}`}>{winner.reportBack}</p>
              </div>
            ) : (
              <p className={`mt-3 text-sm font-semibold ${subCls}`} data-testid="grants-report-owed">
                {t("communityGrants.reportOwed")}
              </p>
            )}
            {isCurrent && iAmWinner && !winner.reportBack && (
              <form onSubmit={submitReportBack} className="mt-3">
                <label className={labelCls} htmlFor="grants-report-back-input">{t("communityGrants.reportBackLabel")}</label>
                <textarea id="grants-report-back-input" className={inputCls} rows={4} maxLength={4000} value={rbBody} onChange={(e) => setRbBody(e.target.value)} placeholder={t("communityGrants.reportBackPlaceholder")} />
                <button type="submit" disabled={rbBusy || !rbBody.trim()} className="mt-2 rounded-lg bg-[#d4a017] px-4 py-2 text-sm font-extrabold text-black disabled:opacity-50">
                  {rbBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("communityGrants.reportBackSubmit")}
                </button>
              </form>
            )}
          </div>
        )}

        {round.resultStatus === "tie" && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" data-testid="grants-result-tie">
            <p className="font-extrabold text-amber-500">{t("communityGrants.tieTitle")}</p>
            <p className={subCls}>{t("communityGrants.tieBody")}</p>
          </div>
        )}
        {round.resultStatus === "no_candidates" && (
          <p className={`mt-4 text-sm font-semibold ${subCls}`} data-testid="grants-result-none">{t("communityGrants.noCandidatesResult")}</p>
        )}

        <div className="mt-5">
          <h3 className={`text-sm font-extrabold tracking-wide ${headCls}`}>
            {t("communityGrants.candidatesTitle")} · {t("communityGrants.totalVotes", { count: surface.totalVotes })}
          </h3>
          {candidates.length === 0 ? (
            <p className={`mt-2 ${subCls}`} data-testid="grants-no-candidates">{t("communityGrants.noCandidates")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {candidates.map((c) => {
                const mine = surface.myVoteCandidateId === c.id;
                return (
                  <li key={c.id} className={`rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/30 bg-white/60" : "border-white/10 bg-black/30"}`} data-testid="grants-candidate">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-bold ${headCls}`}>
                          {c.title}
                          {c.isWinner && <Trophy className="ml-2 inline h-4 w-4 text-[#d4a017]" aria-label={t("communityGrants.fundedBadge")} />}
                        </p>
                        <p className={`text-xs font-semibold ${subCls}`}>{t("communityGrants.byCreator", { name: c.creatorName })}</p>
                        <p className={`mt-2 whitespace-pre-wrap text-sm ${isLight ? "text-[#3d3418]" : "text-white/80"}`}>{c.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-extrabold text-[#d4a017]" data-testid="grants-votes">{c.votes}</p>
                        <p className={`text-xs ${subCls}`}>{t("communityGrants.votesLabel")}</p>
                        {isCurrent && phase === "voting" && (
                          mine ? (
                            <span className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[#d4a017]/60 px-3 py-1.5 text-xs font-extrabold text-[#d4a017]">
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {t("communityGrants.yourVote")}
                            </span>
                          ) : (
                            <button type="button" disabled={busyId === c.id} onClick={() => void castVote(round.id, c.id)} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#d4a017] px-3 py-1.5 text-xs font-extrabold text-black disabled:opacity-50">
                              {busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Vote className="h-4 w-4" aria-hidden="true" />}
                              {surface.myVoteCandidateId ? t("communityGrants.changeVote") : t("communityGrants.vote")}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {isCurrent && phase === "voting" && surface.myVoteCandidateId && (
            <button type="button" disabled={busyId === "withdraw"} onClick={() => void withdrawVote(round.id)} className={`mt-3 text-xs font-bold underline ${subCls}`}>
              {t("communityGrants.withdrawVote")}
            </button>
          )}
        </div>

        {isCurrent && phase === "submissions" && (
          <form onSubmit={submitProject} className="mt-6 border-t border-dashed border-[#C9A84C]/30 pt-5" data-testid="grants-submit-door">
            <h3 className={`flex items-center gap-2 text-sm font-extrabold tracking-wide ${headCls}`}>
              <HandCoins className="h-4 w-4 text-[#d4a017]" aria-hidden="true" /> {t("communityGrants.submitTitle")}
            </h3>
            {myCandidate ? (
              <p className={`mt-2 ${subCls}`}>{t("communityGrants.alreadySubmitted", { title: myCandidate.title })}</p>
            ) : user ? (
              <>
                <div className="mt-3">
                  <label className={labelCls} htmlFor="grants-project-title">{t("communityGrants.projectTitleLabel")}</label>
                  <input id="grants-project-title" className={inputCls} maxLength={120} value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder={t("communityGrants.projectTitlePlaceholder")} />
                </div>
                <div className="mt-3">
                  <label className={labelCls} htmlFor="grants-project-desc">{t("communityGrants.projectDescLabel")}</label>
                  <textarea id="grants-project-desc" className={inputCls} rows={4} maxLength={2000} value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder={t("communityGrants.projectDescPlaceholder")} />
                </div>
                <button type="submit" disabled={pBusy} className="mt-3 rounded-lg bg-[#d4a017] px-4 py-2 text-sm font-extrabold text-black disabled:opacity-50">
                  {pBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("communityGrants.submitButton")}
                </button>
              </>
            ) : (
              <p className={`mt-2 ${subCls}`}>{t("communityGrants.signInToSubmit")}</p>
            )}
          </form>
        )}
      </section>
    );
  }

  return (
    <div data-testid="community-grants-page">
      <header>
        <h1 className={`font-serif text-4xl font-bold md:text-5xl ${headCls}`}>
          {t("communityGrants.title")}
        </h1>
        <p className={`mt-2 max-w-2xl text-base ${subCls}`}>{t("communityGrants.subtitle")}</p>
        <p className="mt-2 text-sm font-extrabold tracking-wide text-[#d4a017]">{t("communityGrants.vbOnlyLine")}</p>
      </header>

      {note && (
        <p className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${note.ok ? "border-emerald-500/40 text-emerald-500" : "border-red-500/40 text-red-400"}`} role="status">
          {note.text}
        </p>
      )}

      <div className="mt-6 space-y-6">
        {loadError ? (
          <p className={subCls}>{t("communityGrants.loadError")}</p>
        ) : data === null ? (
          <p className={subCls}><Loader2 className="inline h-4 w-4 animate-spin" /> {t("communityGrants.loading")}</p>
        ) : data.current === null ? (
          <section className={`${cardCls} p-6`} data-testid="grants-no-round">
            <h2 className={`font-serif text-2xl font-bold ${headCls}`}>{t("communityGrants.noRoundTitle")}</h2>
            <p className={`mt-2 ${subCls}`}>{t("communityGrants.noRoundBody")}</p>
          </section>
        ) : (
          <RoundBlock surface={data.current} isCurrent={true} />
        )}

        {data && data.past.length > 0 && (
          <>
            <h2 className={`font-serif text-2xl font-bold ${headCls}`}>{t("communityGrants.pastTitle")}</h2>
            {data.past.map((s) => (
              <RoundBlock key={s.round.id} surface={s} isCurrent={false} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
