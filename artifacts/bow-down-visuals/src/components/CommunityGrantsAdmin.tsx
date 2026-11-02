import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, HandCoins, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  grantSettleAvailable,
  grantWindowsEditable,
  parseGrantSettleOutcome,
  parseGrantsAdmin,
  type GrantRoundSurfaceRow,
  type GrantsAdminRead,
} from "@/lib/admin-benches";
import { formatVb, monthLabel } from "@/lib/community-grants";

/* ─── Admin: Community Grants — the rounds bench ─────────────────────
   The round admin verbs (POST/PATCH /admin/community-grants/rounds,
   POST …/rounds/:id/settle) had NO frontend consumer: a round could
   only be opened, adjusted or settled by hand-rolled API calls, so
   the monthly grant simply never ran. This bench docks onto those
   exact verbs. The list rides the PUBLIC surface read
   (GET /community-grants — current + past rounds with candidates and
   tallies), so no new read was needed. Settle is offered exactly
   when the rail would take it (voting closed, round undecided) and
   goes through a confirm that says the truth about ties: a tie pays
   nobody and the pool holds. A paid round's windows are final — the
   bench locks them the way the rail refuses them. */

const PHASE_KEY: Record<string, string> = {
  upcoming: "admin.grants.phase.upcoming",
  submissions: "admin.grants.phase.submissions",
  between: "admin.grants.phase.between",
  voting: "admin.grants.phase.voting",
  closed: "admin.grants.phase.closed",
};

const RESULT_KEY: Record<string, string> = {
  pending: "admin.grants.result.pending",
  winner: "admin.grants.result.winner",
  tie: "admin.grants.result.tie",
  no_candidates: "admin.grants.result.noCandidates",
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

function localInputFromDate(d: Date): string {
  return toLocalInput(d.toISOString());
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

interface WindowDraft {
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  votingOpenAt: string;
  votingCloseAt: string;
}

function seedWindows(s: GrantRoundSurfaceRow): WindowDraft {
  return {
    submissionsOpenAt: toLocalInput(s.round.submissionsOpenAt),
    submissionsCloseAt: toLocalInput(s.round.submissionsCloseAt),
    votingOpenAt: toLocalInput(s.round.votingOpenAt),
    votingCloseAt: toLocalInput(s.round.votingCloseAt),
  };
}

export function CommunityGrantsAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [read, setRead] = useState<GrantsAdminRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  /* Open-round form. */
  const now = new Date();
  const [monthKey, setMonthKey] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [poolVb, setPoolVb] = useState("");
  const [openWindows, setOpenWindows] = useState<WindowDraft>(() => {
    const day = 24 * 60 * 60 * 1000;
    const base = Date.now();
    return {
      submissionsOpenAt: localInputFromDate(new Date(base)),
      submissionsCloseAt: localInputFromDate(new Date(base + 10 * day)),
      votingOpenAt: localInputFromDate(new Date(base + 11 * day)),
      votingCloseAt: localInputFromDate(new Date(base + 20 * day)),
    };
  });
  const [openMsg, setOpenMsg] = useState<string | null>(null);

  const [windowsDrafts, setWindowsDrafts] = useState<Record<string, WindowDraft>>({});
  const [roundMsg, setRoundMsg] = useState<Record<string, string>>({});
  const [settleConfirmFor, setSettleConfirmFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/community-grants", { headers: await authHeaders() });
      const parsed = res.ok ? parseGrantsAdmin(await res.json()) : null;
      if (parsed) {
        setRead(parsed);
        const surfaces = [parsed.current, ...parsed.past].filter(
          (s): s is GrantRoundSurfaceRow => s !== null,
        );
        setWindowsDrafts(Object.fromEntries(surfaces.map((s) => [s.round.id, seedWindows(s)])));
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

  const surfaces: GrantRoundSurfaceRow[] = read
    ? [read.current, ...read.past].filter((s): s is GrantRoundSurfaceRow => s !== null)
    : [];

  const openRound = async () => {
    const pool = Number(poolVb);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) || !Number.isInteger(pool) || pool <= 0) {
      setActionError(t("admin.grants.openInvalid"));
      return;
    }
    const windows = {
      submissionsOpenAt: fromLocalInput(openWindows.submissionsOpenAt),
      submissionsCloseAt: fromLocalInput(openWindows.submissionsCloseAt),
      votingOpenAt: fromLocalInput(openWindows.votingOpenAt),
      votingCloseAt: fromLocalInput(openWindows.votingCloseAt),
    };
    if (Object.values(windows).some((v) => v === null)) {
      setActionError(t("admin.grants.openInvalid"));
      return;
    }
    setBusy("open");
    setActionError(null);
    setOpenMsg(null);
    try {
      const res = await fetch("/api/admin/community-grants/rounds", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey, poolVb: pool, ...windows }),
      });
      if (res.ok) {
        setOpenMsg(t("admin.grants.openedMsg", { month: monthLabel(monthKey), pool: formatVb(pool) }));
        setPoolVb("");
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.grants.actionError"));
      }
    } catch {
      setActionError(t("admin.grants.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const saveWindows = async (surface: GrantRoundSurfaceRow) => {
    const draft = windowsDrafts[surface.round.id];
    if (!draft) return;
    const patch = {
      submissionsOpenAt: fromLocalInput(draft.submissionsOpenAt),
      submissionsCloseAt: fromLocalInput(draft.submissionsCloseAt),
      votingOpenAt: fromLocalInput(draft.votingOpenAt),
      votingCloseAt: fromLocalInput(draft.votingCloseAt),
    };
    setBusy(`windows:${surface.round.id}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/community-grants/rounds/${surface.round.id}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setRoundMsg((m) => ({ ...m, [surface.round.id]: t("admin.grants.windowsSaved") }));
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.grants.actionError"));
      }
    } catch {
      setActionError(t("admin.grants.actionError"));
    } finally {
      setBusy(null);
    }
  };

  const settle = async (surface: GrantRoundSurfaceRow) => {
    setBusy(`settle:${surface.round.id}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/community-grants/rounds/${surface.round.id}/settle`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      });
      if (res.ok) {
        const outcome = parseGrantSettleOutcome(await res.json());
        let msg: string;
        if (outcome?.outcome === "paid") {
          const winner = surface.candidates.find((c) => c.id === outcome.winnerCandidateId);
          msg = t("admin.grants.settlePaid", {
            name: winner?.creatorName ?? "",
            amount: formatVb(outcome.amountVb ?? surface.round.poolVb),
          });
        } else if (outcome?.outcome === "tie") {
          msg = t("admin.grants.settleTie");
        } else if (outcome?.outcome === "no_candidates") {
          msg = t("admin.grants.settleNoCandidates");
        } else if (outcome?.outcome === "already_settled") {
          msg = t("admin.grants.settleAlready");
        } else if (outcome?.outcome === "failed_released") {
          msg = t("admin.grants.settleFailed");
        } else {
          msg = t("admin.grants.settleDone");
        }
        setRoundMsg((m) => ({ ...m, [surface.round.id]: msg }));
        setSettleConfirmFor(null);
        await load();
      } else {
        setActionError((await railMessage(res)) ?? t("admin.grants.actionError"));
        setSettleConfirmFor(null);
      }
    } catch {
      setActionError(t("admin.grants.actionError"));
      setSettleConfirmFor(null);
    } finally {
      setBusy(null);
    }
  };

  const windowFields = (
    draft: WindowDraft,
    setDraft: (d: WindowDraft) => void,
    disabled: boolean,
  ) => (
    <div className="flex flex-wrap gap-3">
      {(
        [
          ["submissionsOpenAt", "admin.grants.submissionsOpenLabel"],
          ["submissionsCloseAt", "admin.grants.submissionsCloseLabel"],
          ["votingOpenAt", "admin.grants.votingOpenLabel"],
          ["votingCloseAt", "admin.grants.votingCloseLabel"],
        ] as Array<[keyof WindowDraft, string]>
      ).map(([field, key]) => (
        <label key={field} className={labelCls}>
          {t(key)}
          <input
            type="datetime-local"
            value={draft[field]}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            className={`${inputCls} mt-1 block disabled:opacity-50`}
          />
        </label>
      ))}
    </div>
  );

  return (
    <div
      className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="community-grants-admin-bench"
    >
      <div className="flex items-center gap-2 mb-1">
        <HandCoins className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.grants.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">{t("admin.grants.description")}</p>

      {actionError && <p className="mb-3 text-sm font-bold text-red-400">{actionError}</p>}

      {/* ── Open a round ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.grants.openTitle")}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className={labelCls}>
            {t("admin.grants.monthLabel")}
            <input
              type="text"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              placeholder="2026-12"
              className={`${inputCls} mt-1 block w-32`}
            />
          </label>
          <label className={labelCls}>
            {t("admin.grants.poolLabel")}
            <input
              type="number"
              min={1}
              step={1}
              value={poolVb}
              onChange={(e) => setPoolVb(e.target.value)}
              className={`${inputCls} mt-1 block w-36`}
            />
          </label>
        </div>
        <div className="mt-3">{windowFields(openWindows, setOpenWindows, busy !== null)}</div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void openRound()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
        >
          {busy === "open" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("admin.grants.openButton")}
        </button>
        {openMsg && <p className="mt-2 text-xs font-semibold text-emerald-300">{openMsg}</p>}
      </div>

      {/* ── Rounds ───────────────────────────────────────────────── */}
      {loading ? (
        <p className="mt-4 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`mt-4 rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("admin.grants.loadErrorTitle")}
          </p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("admin.grants.loadErrorBody")}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : surfaces.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">{t("admin.grants.empty")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {surfaces.map((surface) => {
            const round = surface.round;
            const draft = windowsDrafts[round.id] ?? seedWindows(surface);
            const editable = grantWindowsEditable(round);
            const winner = surface.candidates.find((c) => c.id === round.winnerCandidateId);
            return (
              <div key={round.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <p className="text-sm font-semibold text-white">{monthLabel(round.monthKey)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-sky-400/30 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
                      {t(PHASE_KEY[surface.phase] ?? "", { defaultValue: surface.phase })}
                    </span>
                    <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-[11px] font-semibold text-white/60">
                      {t(RESULT_KEY[round.resultStatus] ?? "", { defaultValue: round.resultStatus })}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
                  <span>
                    {t("admin.grants.poolLabel")}{" "}
                    <span className="text-white/90 font-semibold">{formatVb(round.poolVb)}</span>
                  </span>
                  <span>
                    {t("admin.grants.totalVotesLabel")}{" "}
                    <span className="text-white/90 font-semibold">{surface.totalVotes.toLocaleString()}</span>
                  </span>
                  {round.grantStatus === "paid" && (
                    <span className="text-emerald-300">
                      {t("admin.grants.paidLine", {
                        amount: formatVb(round.poolVb),
                        name: winner?.creatorName ?? "",
                        date: round.grantPaidAt ? new Date(round.grantPaidAt).toLocaleString() : "",
                      })}
                    </span>
                  )}
                </div>

                {/* candidates */}
                <p className="mt-4 text-xs text-white/40 uppercase tracking-wider font-semibold">
                  {t("admin.grants.candidatesTitle", { count: surface.candidates.length })}
                </p>
                {surface.candidates.length === 0 ? (
                  <p className="mt-1 text-sm text-white/40">{t("admin.grants.noCandidates")}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {surface.candidates.map((c) => (
                      <div key={c.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{c.title}</p>
                          {c.isWinner && (
                            <span className="rounded-full border border-emerald-400/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                              {t("admin.grants.winnerChip")}
                            </span>
                          )}
                          {c.reportBackOwed && (
                            <span className="rounded-full border border-[#C9A84C]/50 px-2 py-0.5 text-[11px] font-semibold text-[#e8c86a]">
                              {t("admin.grants.reportOwed")}
                            </span>
                          )}
                          <span className="ml-auto text-xs text-white/50">
                            {t("admin.grants.votesLabel", { count: c.votes })}
                          </span>
                        </div>
                        <p className="text-xs text-white/40">
                          {t("admin.grants.byCreator", { name: c.creatorName })}
                        </p>
                        {c.reportBack && (
                          <p className="mt-1 text-xs text-white/60">
                            <span className="font-semibold text-white/80">{t("admin.grants.reportBackLabel")}: </span>
                            {c.reportBack}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* windows */}
                <p className="mt-4 text-xs text-white/40 uppercase tracking-wider font-semibold">
                  {t("admin.grants.windowsTitle")}
                </p>
                <div className="mt-2">
                  {windowFields(
                    draft,
                    (d) => setWindowsDrafts((m) => ({ ...m, [round.id]: d })),
                    !editable || busy !== null,
                  )}
                </div>
                {editable ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void saveWindows(surface)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
                  >
                    {busy === `windows:${round.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {t("admin.grants.saveWindows")}
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-white/40">{t("admin.grants.windowsFinal")}</p>
                )}
                {roundMsg[round.id] && (
                  <p className="mt-2 text-xs font-semibold text-emerald-300">{roundMsg[round.id]}</p>
                )}

                {/* settle */}
                {grantSettleAvailable(surface) &&
                  (settleConfirmFor === round.id ? (
                    <div
                      className={`mt-3 rounded-lg border p-3 ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/30 bg-black/40"}`}
                      data-testid="grant-settle-confirm"
                    >
                      <p className={`text-sm font-semibold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                        {t("admin.grants.settleConfirmBody", {
                          month: monthLabel(round.monthKey),
                          pool: formatVb(round.poolVb),
                        })}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void settle(surface)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
                        >
                          {busy === `settle:${round.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {t("admin.grants.settleConfirmButton")}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setSettleConfirmFor(null)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-50"
                        >
                          {t("admin.grants.cancelButton")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setSettleConfirmFor(round.id)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
                    >
                      <HandCoins className="h-3.5 w-3.5" /> {t("admin.grants.settleButton")}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-white/30">{t("admin.grants.footerNote")}</p>
    </div>
  );
}
