import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ArrowBigUp, Check, Loader2, Wrench } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { NativeBoard, NativeBoardRow } from "@/components/world/native/NativeBoard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import { sortPitches, type PitchFixSubmission, type PitchSort } from "@/lib/pitch-fix";
import {
  FIX_PAGE_LABELS,
  FIX_SEVERITY_LABELS,
  PITCH_FIX_BOARD_PATH,
  PITCH_FIX_FIXES_PATH,
  PITCH_FIX_MINE_PATH,
  PITCH_FIX_PITCHES_PATH,
  buildFixBody,
  buildPitchBody,
  fixFormReady,
  fixPageLabel,
  fixSeverityLabel,
  normalizeMySubmissions,
  normalizePitchFixBoard,
  parseVoteResult,
  pitchCategoryLabel,
  pitchFormReady,
  pitchVotePath,
  submissionRewardLine,
  submissionStatusLine,
  type FixForm,
  type PitchFixBoardData,
  type PitchForm,
} from "@/lib/world/pitch-fix-board";

/* ─── Pitch & Fix, native at the Kingdom Board (stack1100 parity) ──
   The kingdom's suggestion board, on the pitch-fix router's own
   rails — the same endpoints pages/pitch-fix.tsx calls. The board
   is public reading (the rail serves approved rows only — the
   moderation gate is the server's, never re-done here); voting,
   filing a pitch and reporting a fix are member verbs. A filing
   goes to the team first and shows on the board only once approved
   — the desk says exactly that, and the Mine strip carries the
   caller's own filings in every state, with the reward lines the
   rail reports (shipped pitch 500 VB, shipped fix 100–250 VB —
   the page's own rewards line). The board stands in the Kingdom
   Board blocks, so it is one tap from the spawn hall slate and
   every district's board. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

export function PitchFixBoard({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  /* `tr`, not `t` — this file's tick callbacks take a local `t`. */
  const { t: tr } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  /* The seam's label tables, key-mapped through the catalog: page
     and severity words are the pitchFix page's own keys (same
     surface, byte-identical); categories likewise, except "world",
     whose board word is "The World" (pitchFix.category.world is
     "World" — a near-miss, not reused). */
  const categoryLabels: Record<string, string> = {
    create: tr("pitchFix.category.create"),
    world: tr("worldBoards.pfCategoryWorld"),
    money: tr("pitchFix.category.money"),
    social: tr("pitchFix.category.social"),
    other: tr("pitchFix.category.other"),
  };
  const pageLabels: Record<string, string> = Object.fromEntries(
    Object.keys(FIX_PAGE_LABELS).map((k) => [k, tr(`pitchFix.page.${k}`)]),
  );
  const severityLabels: Record<string, string> = Object.fromEntries(
    Object.keys(FIX_SEVERITY_LABELS).map((k) => [k, tr(`pitchFix.severity.${k}`)]),
  );
  const seamStrings = {
    statusWithTeam: tr("worldBoards.pfStatusWithTeam"),
    statusNotTakenUp: tr("worldBoards.pfStatusNotTakenUp"),
    statusShipped: tr("worldBoards.pfStatusShipped"),
    statusBuilding: tr("worldBoards.pfStatusBuilding"),
    statusOnBoard: tr("worldBoards.pfStatusOnBoard"),
    rewardPaid: (amount: number) => tr("worldBoards.pfRewardPaid", { amount }),
    rewardQueued: tr("worldBoards.pfRewardQueued"),
    submitterFallback: tr("worldBoards.pfSubmitterFallback"),
  };
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [board, setBoard] = useState<PitchFixBoardData | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [sort, setSort] = useState<PitchSort>("top");
  const [votedIds, setVotedIds] = useState<ReadonlySet<string>>(new Set());
  const [voteBusyId, setVoteBusyId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const [mine, setMine] = useState<PitchFixSubmission[] | null>(null);
  const [mineFailed, setMineFailed] = useState(false);

  const [mode, setMode] = useState<"none" | "pitch" | "fix">("none");
  const [pitchForm, setPitchForm] = useState<PitchForm>({ title: "", body: "", why: "", category: "create" });
  const [fixForm, setFixForm] = useState<FixForm>({ title: "", body: "", page: "the_world", severity: "annoying" });
  const [filing, setFiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filedNote, setFiledNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBoardFailed(false);
    (async () => {
      try {
        const res = await fetch(PITCH_FIX_BOARD_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`board ${res.status}`);
        const parsed = normalizePitchFixBoard(await res.json(), seamStrings);
        if (!parsed) throw new Error("board shape");
        if (!cancelled) {
          setBoard(parsed);
          setVotedIds(new Set(parsed.viewerVotedIds));
        }
      } catch {
        if (!cancelled) setBoardFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setMineFailed(false);
    (async () => {
      try {
        const res = await fetch(PITCH_FIX_MINE_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`mine ${res.status}`);
        const parsed = normalizeMySubmissions(await res.json(), seamStrings);
        if (!parsed) throw new Error("mine shape");
        if (!cancelled) setMine(parsed);
      } catch {
        if (!cancelled) setMineFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, isGuest]);

  const pitches = useMemo(
    () => (board ? sortPitches(board.pitches, sort) : []),
    [board, sort],
  );

  async function vote(pitch: PitchFixSubmission) {
    setVoteBusyId(pitch.id);
    setVoteError(null);
    try {
      const res = await fetch(pitchVotePath(pitch.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, tr("worldBoards.pfVoteFailedStatus", { status: res.status })));
      const result = parseVoteResult(data);
      if (!result) throw new Error(tr("worldBoards.pfVoteBadShape"));
      setVotedIds((prev) => {
        const next = new Set(prev);
        if (result.voted) next.add(pitch.id);
        else next.delete(pitch.id);
        return next;
      });
      setBoard((b) =>
        b
          ? {
              ...b,
              pitches: b.pitches.map((p) =>
                p.id === pitch.id ? { ...p, upvoteCount: result.upvoteCount } : p,
              ),
            }
          : b,
      );
    } catch (err) {
      setVoteError(plainErrorText(err, tr("worldBoards.pfVoteFailed")));
    } finally {
      setVoteBusyId(null);
    }
  }

  async function file(kind: "pitch" | "fix") {
    setFiling(true);
    setFileError(null);
    try {
      const res = await fetch(kind === "pitch" ? PITCH_FIX_PITCHES_PATH : PITCH_FIX_FIXES_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(kind === "pitch" ? buildPitchBody(pitchForm) : buildFixBody(fixForm)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, tr("worldBoards.pfFileFailedStatus", { status: res.status })));
      if (kind === "pitch") setPitchForm({ title: "", body: "", why: "", category: "create" });
      else setFixForm({ title: "", body: "", page: "the_world", severity: "annoying" });
      setMode("none");
      setFiledNote(tr("worldBoards.pfFiledNote"));
      setTick((t) => t + 1);
    } catch (err) {
      setFileError(plainErrorText(err, tr("worldBoards.pfFileFailed")));
    } finally {
      setFiling(false);
    }
  }

  return (
    <div data-testid="world-pitch-fix-board">
      <NativeBoard
        isLight={isLight}
        title={tr("worldBoards.pfBoardTitle")}
        headline={
          <p className={`px-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {tr("pitchFix.rewardsLine")}
          </p>
        }
      >
        {boardFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={tr("worldBoards.pfLoadTitle")}
            message={tr("worldBoards.pfLoadMessage")}
            onRetry={() => setTick((t) => t + 1)}
          />
        ) : board === null ? (
          <NativeLoadingState isLight={isLight} message={tr("worldBoards.pfLoading")} />
        ) : (
          <div className="space-y-4 px-1">
            {/* ── Pitches ── */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>{tr("worldBoards.pfPitchesHeading")}</p>
                <div className="flex gap-1.5">
                  {(["top", "newest"] as PitchSort[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSort(s)}
                      className={sort === s ? goldBtn : chipBtn(isLight)}
                    >
                      {s === "top" ? tr("worldBoards.pfSortTop") : tr("pitchFix.sortNewest")}
                    </button>
                  ))}
                </div>
              </div>
              {pitches.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message={tr("worldBoards.pfPitchesEmpty")}
                  detail={tr("worldBoards.pfPitchesEmptyDetail")}
                />
              ) : (
                pitches.map((p) => {
                  const voted = votedIds.has(p.id);
                  return (
                    <NativeBoardRow
                      key={p.id}
                      isLight={isLight}
                      title={p.title}
                      detail={tr("worldBoards.pfPitchDetail", {
                        body: p.body,
                        whyPart: p.why ? tr("worldBoards.pfWhyPart", { why: p.why }) : "",
                        name: p.submitterName,
                        category: pitchCategoryLabel(p.category, categoryLabels),
                      })}
                      highlighted={voted}
                      action={
                        isGuest ? undefined : (
                          <button
                            type="button"
                            data-testid="world-pitch-vote"
                            disabled={voteBusyId === p.id}
                            onClick={() => void vote(p)}
                            className={voted ? goldBtn : chipBtn(isLight)}
                            aria-pressed={voted}
                          >
                            {voteBusyId === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ArrowBigUp className="h-3.5 w-3.5" />
                            )}
                            {p.upvoteCount}
                          </button>
                        )
                      }
                    />
                  );
                })
              )}
              {voteError ? (
                <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{voteError}</p>
              ) : null}
            </div>

            {/* ── Fixes & feedback ── */}
            <div className="space-y-1.5">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>{tr("worldBoards.pfFixesHeading")}</p>
              {board.fixes.length === 0 ? (
                <NativeEmptyState isLight={isLight} message={tr("worldBoards.pfFixesEmpty")} />
              ) : (
                board.fixes.slice(0, 8).map((f) => (
                  <NativeBoardRow
                    key={f.id}
                    isLight={isLight}
                    title={f.title}
                    detail={
                      f.kind === "feedback"
                        ? tr("worldBoards.pfFeedbackDetail", { name: f.submitterName })
                        : tr("worldBoards.pfFixDetail", {
                            page: fixPageLabel(f.page, pageLabels),
                            severity: fixSeverityLabel(f.severity, severityLabels),
                            name: f.submitterName,
                          })
                    }
                    meta={f.status === "fixed" ? tr("pitchFix.fixStatus.fixed") : undefined}
                  />
                ))
              )}
            </div>

            {/* ── Shipped lately ── */}
            {board.shipped.length > 0 ? (
              <div className="space-y-1.5">
                <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>{tr("worldBoards.pfShippedHeading")}</p>
                {board.shipped.slice(0, 5).map((s) => (
                  <NativeBoardRow
                    key={s.id}
                    isLight={isLight}
                    title={s.title}
                    detail={tr("worldBoards.pfByLine", { name: s.submitterName })}
                    meta={tr("worldBoards.pfShippedMeta")}
                  />
                ))}
              </div>
            ) : null}

            {/* ── File yours ── */}
            {isGuest ? (
              <p className={`text-xs ${muted}`}>
                {tr("worldBoards.pfGuestRead")}{" "}
                <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline">
                  {tr("worldBoards.pfSignIn")}
                </Link>{" "}
                {tr("worldBoards.pfGuestRest")}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={mode === "pitch" ? goldBtn : chipBtn(isLight)}
                    onClick={() => setMode(mode === "pitch" ? "none" : "pitch")}
                    aria-expanded={mode === "pitch"}
                  >
                    {tr("worldBoards.pfPitchCta")}
                  </button>
                  <button
                    type="button"
                    className={mode === "fix" ? goldBtn : chipBtn(isLight)}
                    onClick={() => setMode(mode === "fix" ? "none" : "fix")}
                    aria-expanded={mode === "fix"}
                  >
                    <Wrench className="h-3.5 w-3.5" /> {tr("worldBoards.pfReportFixCta")}
                  </button>
                </div>

                {mode === "pitch" ? (
                  <div data-testid="world-pitch-form" className="space-y-2">
                    <input
                      className={deskInputCls(isLight)}
                      placeholder={tr("worldBoards.pfPitchTitlePlaceholder")}
                      maxLength={90}
                      value={pitchForm.title}
                      onChange={(e) => setPitchForm({ ...pitchForm, title: e.target.value })}
                      aria-label={tr("worldBoards.pfPitchTitleAria")}
                    />
                    <textarea
                      className={deskInputCls(isLight)}
                      placeholder={tr("worldBoards.pfPitchBodyPlaceholder")}
                      rows={2}
                      maxLength={400}
                      value={pitchForm.body}
                      onChange={(e) => setPitchForm({ ...pitchForm, body: e.target.value })}
                      aria-label={tr("worldBoards.pfPitchBodyAria")}
                    />
                    <textarea
                      className={deskInputCls(isLight)}
                      placeholder={tr("worldBoards.pfPitchWhyPlaceholder")}
                      rows={2}
                      maxLength={400}
                      value={pitchForm.why}
                      onChange={(e) => setPitchForm({ ...pitchForm, why: e.target.value })}
                      aria-label={tr("worldBoards.pfPitchWhyAria")}
                    />
                    <select
                      className={deskInputCls(isLight)}
                      value={pitchForm.category}
                      onChange={(e) => setPitchForm({ ...pitchForm, category: e.target.value })}
                      aria-label={tr("worldBoards.pfPitchCategoryAria")}
                    >
                      {Object.entries(categoryLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={goldBtn}
                      disabled={!pitchFormReady(pitchForm) || filing}
                      onClick={() => void file("pitch")}
                    >
                      {filing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {tr("worldBoards.pfFilePitch")}
                    </button>
                  </div>
                ) : null}

                {mode === "fix" ? (
                  <div data-testid="world-fix-form" className="space-y-2">
                    <input
                      className={deskInputCls(isLight)}
                      placeholder={tr("worldBoards.pfFixTitlePlaceholder")}
                      maxLength={90}
                      value={fixForm.title}
                      onChange={(e) => setFixForm({ ...fixForm, title: e.target.value })}
                      aria-label={tr("worldBoards.pfFixTitleAria")}
                    />
                    <textarea
                      className={deskInputCls(isLight)}
                      placeholder={tr("worldBoards.pfFixBodyPlaceholder")}
                      rows={2}
                      maxLength={400}
                      value={fixForm.body}
                      onChange={(e) => setFixForm({ ...fixForm, body: e.target.value })}
                      aria-label={tr("worldBoards.pfFixDetailAria")}
                    />
                    <div className="flex flex-wrap gap-2">
                      <select
                        className={deskInputCls(isLight)}
                        value={fixForm.page}
                        onChange={(e) => setFixForm({ ...fixForm, page: e.target.value })}
                        aria-label={tr("worldBoards.pfFixPageAria")}
                      >
                        {Object.entries(pageLabels).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={deskInputCls(isLight)}
                        value={fixForm.severity}
                        onChange={(e) => setFixForm({ ...fixForm, severity: e.target.value })}
                        aria-label={tr("worldBoards.pfFixSeverityAria")}
                      >
                        {Object.entries(severityLabels).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className={goldBtn}
                      disabled={!fixFormReady(fixForm) || filing}
                      onClick={() => void file("fix")}
                    >
                      {filing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {tr("worldBoards.pfFileFix")}
                    </button>
                  </div>
                ) : null}

                {fileError ? (
                  <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{fileError}</p>
                ) : null}
                {filedNote ? (
                  <p className={`inline-flex items-center gap-1.5 text-xs font-semibold ${strong}`}>
                    <Check className="h-3.5 w-3.5 text-[#d4af37]" /> {filedNote}
                  </p>
                ) : null}

                {/* ── Your filings ── */}
                <div className="space-y-1.5 pt-1">
                  <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>{tr("worldBoards.pfMineHeading")}</p>
                  {mineFailed ? (
                    <p className={`text-xs ${muted}`}>
                      {tr("worldBoards.pfMineFailed")}{" "}
                      <button type="button" className="font-bold underline" onClick={() => setTick((t) => t + 1)}>
                        {tr("worldBoards.pfTryAgain")}
                      </button>
                    </p>
                  ) : mine === null ? (
                    <NativeLoadingState isLight={isLight} message={tr("worldBoards.pfMineLoading")} />
                  ) : mine.length === 0 ? (
                    <NativeEmptyState
                      isLight={isLight}
                      message={tr("worldBoards.pfMineEmpty")}
                      detail={tr("worldBoards.pfMineEmptyDetail")}
                    />
                  ) : (
                    mine.slice(0, 8).map((s) => {
                      const reward = submissionRewardLine(s, seamStrings);
                      return (
                        <NativeBoardRow
                          key={s.id}
                          isLight={isLight}
                          title={s.title}
                          detail={tr("worldBoards.pfMineDetail", {
                            kind:
                              s.kind === "pitch"
                                ? tr("worldBoards.pfKindPitch")
                                : s.kind === "fix"
                                  ? tr("worldBoards.pfKindFix")
                                  : tr("worldBoards.pfKindFeedback"),
                            status: submissionStatusLine(s, seamStrings),
                            rewardPart: reward ? tr("worldBoards.pfRewardSuffix", { reward }) : "",
                          })}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </NativeBoard>
    </div>
  );
}
