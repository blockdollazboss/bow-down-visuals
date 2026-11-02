import { useEffect, useMemo, useState } from "react";
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
  PITCH_CATEGORY_LABELS,
  PITCH_FIX_BOARD_PATH,
  PITCH_FIX_FIXES_PATH,
  PITCH_FIX_MINE_PATH,
  PITCH_FIX_PITCHES_PATH,
  PITCH_FIX_REWARDS_LINE,
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
  const authHeaders = useDeskAuthHeaders();
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
        const parsed = normalizePitchFixBoard(await res.json());
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
        const parsed = normalizeMySubmissions(await res.json());
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
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't vote (${res.status})`));
      const result = parseVoteResult(data);
      if (!result) throw new Error("The vote answered in a shape the board can't read.");
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
      setVoteError(plainErrorText(err, "Couldn't vote — try again."));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't file it (${res.status})`));
      if (kind === "pitch") setPitchForm({ title: "", body: "", why: "", category: "create" });
      else setFixForm({ title: "", body: "", page: "the_world", severity: "annoying" });
      setMode("none");
      setFiledNote(
        "Filed — thank you. Every voice is read by the team before it shows on the board; watch yours under “Your filings” below.",
      );
      setTick((t) => t + 1);
    } catch (err) {
      setFileError(plainErrorText(err, "Couldn't file it — try again."));
    } finally {
      setFiling(false);
    }
  }

  return (
    <div data-testid="world-pitch-fix-board">
      <NativeBoard
        isLight={isLight}
        title="Pitch & Fix — the kingdom's board"
        headline={
          <p className={`px-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {PITCH_FIX_REWARDS_LINE}
          </p>
        }
      >
        {boardFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The board wouldn't open"
            message="The kingdom's pitches are safe on the real rails — the board just didn't answer. Try again."
            onRetry={() => setTick((t) => t + 1)}
          />
        ) : board === null ? (
          <NativeLoadingState isLight={isLight} message="Reading the board…" />
        ) : (
          <div className="space-y-4 px-1">
            {/* ── Pitches ── */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Pitches</p>
                <div className="flex gap-1.5">
                  {(["top", "newest"] as PitchSort[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSort(s)}
                      className={sort === s ? goldBtn : chipBtn(isLight)}
                    >
                      {s === "top" ? "Top" : "Newest"}
                    </button>
                  ))}
                </div>
              </div>
              {pitches.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="No pitches on the board yet."
                  detail="The first approved idea takes the floor — file yours below."
                />
              ) : (
                pitches.map((p) => {
                  const voted = votedIds.has(p.id);
                  return (
                    <NativeBoardRow
                      key={p.id}
                      isLight={isLight}
                      title={p.title}
                      detail={`${p.body}${p.why ? ` — ${p.why}` : ""} · by ${p.submitterName} · ${pitchCategoryLabel(p.category)}`}
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
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Fixes the kingdom reported</p>
              {board.fixes.length === 0 ? (
                <NativeEmptyState isLight={isLight} message="Nothing broken on the board — the palace is holding." />
              ) : (
                board.fixes.slice(0, 8).map((f) => (
                  <NativeBoardRow
                    key={f.id}
                    isLight={isLight}
                    title={f.title}
                    detail={
                      f.kind === "feedback"
                        ? `Feedback · by ${f.submitterName}`
                        : `${fixPageLabel(f.page)} · ${fixSeverityLabel(f.severity)} · by ${f.submitterName}`
                    }
                    meta={f.status === "fixed" ? "Fixed" : undefined}
                  />
                ))
              )}
            </div>

            {/* ── Shipped lately ── */}
            {board.shipped.length > 0 ? (
              <div className="space-y-1.5">
                <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Shipped from this board</p>
                {board.shipped.slice(0, 5).map((s) => (
                  <NativeBoardRow
                    key={s.id}
                    isLight={isLight}
                    title={s.title}
                    detail={`by ${s.submitterName}`}
                    meta="Shipped ✓"
                  />
                ))}
              </div>
            ) : null}

            {/* ── File yours ── */}
            {isGuest ? (
              <p className={`text-xs ${muted}`}>
                Reading the board is open to everyone.{" "}
                <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline">
                  Sign in
                </Link>{" "}
                to vote, pitch an idea, or report a fix — shipped voices earn Bucs.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={mode === "pitch" ? goldBtn : chipBtn(isLight)}
                    onClick={() => setMode(mode === "pitch" ? "none" : "pitch")}
                  >
                    Pitch an idea
                  </button>
                  <button
                    type="button"
                    className={mode === "fix" ? goldBtn : chipBtn(isLight)}
                    onClick={() => setMode(mode === "fix" ? "none" : "fix")}
                  >
                    <Wrench className="h-3.5 w-3.5" /> Report a fix
                  </button>
                </div>

                {mode === "pitch" ? (
                  <div data-testid="world-pitch-form" className="space-y-2">
                    <input
                      className={deskInputCls(isLight)}
                      placeholder="Your idea, in one line"
                      maxLength={90}
                      value={pitchForm.title}
                      onChange={(e) => setPitchForm({ ...pitchForm, title: e.target.value })}
                      aria-label="Pitch title"
                    />
                    <textarea
                      className={deskInputCls(isLight)}
                      placeholder="What is it?"
                      rows={2}
                      maxLength={400}
                      value={pitchForm.body}
                      onChange={(e) => setPitchForm({ ...pitchForm, body: e.target.value })}
                      aria-label="Pitch body"
                    />
                    <textarea
                      className={deskInputCls(isLight)}
                      placeholder="Why it matters (optional)"
                      rows={2}
                      maxLength={400}
                      value={pitchForm.why}
                      onChange={(e) => setPitchForm({ ...pitchForm, why: e.target.value })}
                      aria-label="Why it matters"
                    />
                    <select
                      className={deskInputCls(isLight)}
                      value={pitchForm.category}
                      onChange={(e) => setPitchForm({ ...pitchForm, category: e.target.value })}
                      aria-label="Pitch category"
                    >
                      {Object.entries(PITCH_CATEGORY_LABELS).map(([key, label]) => (
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
                      File the pitch
                    </button>
                  </div>
                ) : null}

                {mode === "fix" ? (
                  <div data-testid="world-fix-form" className="space-y-2">
                    <input
                      className={deskInputCls(isLight)}
                      placeholder="What's broken, in one line"
                      maxLength={90}
                      value={fixForm.title}
                      onChange={(e) => setFixForm({ ...fixForm, title: e.target.value })}
                      aria-label="Fix title"
                    />
                    <textarea
                      className={deskInputCls(isLight)}
                      placeholder="What happens, and what you expected (optional)"
                      rows={2}
                      maxLength={400}
                      value={fixForm.body}
                      onChange={(e) => setFixForm({ ...fixForm, body: e.target.value })}
                      aria-label="Fix detail"
                    />
                    <div className="flex flex-wrap gap-2">
                      <select
                        className={deskInputCls(isLight)}
                        value={fixForm.page}
                        onChange={(e) => setFixForm({ ...fixForm, page: e.target.value })}
                        aria-label="Where it is"
                      >
                        {Object.entries(FIX_PAGE_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={deskInputCls(isLight)}
                        value={fixForm.severity}
                        onChange={(e) => setFixForm({ ...fixForm, severity: e.target.value })}
                        aria-label="How bad it is"
                      >
                        {Object.entries(FIX_SEVERITY_LABELS).map(([key, label]) => (
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
                      File the fix
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
                  <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Your filings</p>
                  {mineFailed ? (
                    <p className={`text-xs ${muted}`}>
                      Your filings didn&rsquo;t answer just now.{" "}
                      <button type="button" className="font-bold underline" onClick={() => setTick((t) => t + 1)}>
                        Try again
                      </button>
                    </p>
                  ) : mine === null ? (
                    <NativeLoadingState isLight={isLight} message="Finding your filings…" />
                  ) : mine.length === 0 ? (
                    <NativeEmptyState
                      isLight={isLight}
                      message="Nothing filed yet."
                      detail="Your pitches and fixes will stand here with their standing."
                    />
                  ) : (
                    mine.slice(0, 8).map((s) => {
                      const reward = submissionRewardLine(s);
                      return (
                        <NativeBoardRow
                          key={s.id}
                          isLight={isLight}
                          title={s.title}
                          detail={`${s.kind === "pitch" ? "Pitch" : s.kind === "fix" ? "Fix" : "Feedback"} · ${submissionStatusLine(s)}${reward ? ` · ${reward}` : ""}`}
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
