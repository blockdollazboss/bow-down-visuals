import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Crown, LogIn, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import { HALL_ROOM_ID, MUSIC_HALL_ID } from "@/lib/world/palace-layout";
import {
  buildContestBody,
  ContestApiError,
  contestDeadlineLine,
  contestPhaseLabel,
  contestStageName,
  enterContestWork,
  fetchContestDetail,
  fetchContests,
  fetchMyContestWorks,
  fetchWinnersCircle,
  hostContest,
  myContestEntry,
  nameContestWinners,
  placeLabel,
  type MyContestWork,
  type WinnersCircleHonor,
  type WorldContest,
  type WorldContestEntry,
} from "@/lib/world/contests";

/* ─── The Winners' Circle (UPGRADE-PROGRAM 2.24) ──────────────────
   The Royal Court Chamber's contest board: the palace's standing
   competitions and the honors they leave behind.

   - CONTESTS: every open, judging and decided contest on the two
     stages (Throne Hall, Music Hall), with its theme, host,
     deadline and entries. Opening one shows the entries.
   - ENTERING: a member enters ONE of their own published works
     (the picker reads the same my-works rail the server verifies
     against; unpublished works show disabled with the reason).
     Guests read everything and meet the pitch at the door —
     never a dead button.
   - JUDGING: when the window closes, the host names the podium
     from the entries, right here; the pick stands forever and
     lands below.
   - THE CIRCLE: every honor on record — winner, work, contest,
     date — public spectacle, guests included.
   - HOSTING: a member opens a contest from the form (the server
     applies the stage's rule: Throne Hall = Front Row + house,
     Music Hall = any member) and its refusal is shown in its own
     words.

   Honors are the prize in v1 — no Visual Bucs move for a win,
   and the panel says so rather than implying a purse. */

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white"
  }`;

const goldBtn =
  "rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100";
const ghostBtn = (isLight: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

function defaultDeadlineLocal(): string {
  const d = new Date(Date.now() + 48 * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WinnersCirclePanel({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { user, getAccessToken } = useAuth();
  const userId = user?.id ?? null;

  const [contests, setContests] = useState<WorldContest[] | null>(null);
  const [honors, setHonors] = useState<WinnersCircleHonor[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ contest: WorldContest; entries: WorldContestEntry[] } | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailTick, setDetailTick] = useState(0);

  const [works, setWorks] = useState<MyContestWork[] | null>(null);
  const [pickedWorkId, setPickedWorkId] = useState("");
  const [podium, setPodium] = useState<(string | null)[]>([null, null, null]);

  const [showHostForm, setShowHostForm] = useState(false);
  const [hostTitle, setHostTitle] = useState("");
  const [hostTheme, setHostTheme] = useState("");
  const [hostRoom, setHostRoom] = useState<string>(MUSIC_HALL_ID);
  const [hostDeadline, setHostDeadline] = useState(defaultDeadlineLocal());

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  /* The board + the Circle (public reads). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cs, hs] = await Promise.all([fetchContests(), fetchWinnersCircle()]);
        if (!cancelled) {
          setContests(cs);
          setHonors(hs);
          setLoadFailed(false);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  /* One contest's entries. */
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchContestDetail(selectedId);
        if (!cancelled) {
          setDetail(d);
          setDetailFailed(false);
          setPodium([null, null, null]);
          setPickedWorkId("");
        }
      } catch {
        if (!cancelled) setDetailFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailTick, tick]);

  /* The member's own works, for the picker (members only — a
   * guest never fires it). */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token) return;
        const mine = await fetchMyContestWorks(token);
        if (!cancelled) setWorks(mine);
      } catch {
        if (!cancelled) setWorks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  const myEntry = useMemo(
    () => (detail ? myContestEntry(detail.entries, userId) : null),
    [detail, userId],
  );
  const isHost = !!detail && !!userId && detail.contest.hostUserId === userId;
  const publishedWorks = useMemo(() => (works ?? []).filter((w) => w.isPublished), [works]);

  async function runAction(fn: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      const text = await fn();
      setNotice({ ok: true, text });
      refresh();
      setDetailTick((t) => t + 1);
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ContestApiError ? err.message : "The palace couldn't do that just now — try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onEnter() {
    if (!detail) return;
    const work = (works ?? []).find((w) => w.id === pickedWorkId);
    if (!work) {
      setNotice({ ok: false, text: "Pick one of your published works first." });
      return;
    }
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    await runAction(async () => {
      await enterContestWork(token, detail.contest.id, work);
      return `You're in — “${work.title}” stands entered in ${detail.contest.title}.`;
    });
  }

  async function onNameWinners() {
    if (!detail) return;
    if (!podium.some(Boolean)) {
      setNotice({ ok: false, text: "Name at least a first place before the podium stands." });
      return;
    }
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    await runAction(async () => {
      await nameContestWinners(token, detail.contest.id, podium);
      return "The winners stand in the Winners' Circle — the palace has heard it.";
    });
  }

  async function onHost() {
    const ends = new Date(hostDeadline);
    if (!hostTitle.trim() || !hostTheme.trim() || Number.isNaN(ends.getTime())) {
      setNotice({ ok: false, text: "A contest needs a title, a theme and a deadline." });
      return;
    }
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    await runAction(async () => {
      const created = await hostContest(
        token,
        buildContestBody({ title: hostTitle, theme: hostTheme, roomId: hostRoom, endsAtIso: ends.toISOString() }),
      );
      setShowHostForm(false);
      setHostTitle("");
      setHostTheme("");
      if (created) setSelectedId(created.id);
      return "Your contest is open — the palace can enter from this board.";
    });
  }

  const sub = isLight ? "text-[#6B5B36]" : "text-white/55";
  const faint = isLight ? "text-[#6B5B36]" : "text-white/40";

  return (
    <div className="space-y-5" data-testid="world-winners-circle-panel">
      {notice && (
        <p
          data-testid="world-contest-notice"
          className={`rounded-xl border px-3 py-2 text-sm ${
            notice.ok
              ? isLight
                ? "border-[#C9A84C]/50 bg-[#d4af37]/10 text-[#2a1e07]"
                : "border-[#d4af37]/40 bg-[#d4af37]/10 text-white"
              : isLight
                ? "border-red-700/30 bg-red-50 text-red-900"
                : "border-red-400/30 bg-red-500/10 text-red-100"
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* ── Contests ─────────────────────────────────────────── */}
      <NativeBoard isLight={isLight} title="Contests on the stages">
        {loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The contest board wouldn't open"
            message="The palace calendar didn't answer. Your contests and honors are unchanged."
            onRetry={refresh}
          />
        ) : contests === null ? (
          <NativeLoadingState isLight={isLight} message="Reading the contest board…" />
        ) : contests.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message="No contests stand right now."
            detail="When a creator hosts one — a theme, a stage, a deadline — it stands here for the whole palace to enter."
          />
        ) : (
          contests.map((c) => (
            <NativeBoardRow
              key={c.id}
              isLight={isLight}
              title={c.title}
              detail={`${c.theme ? `“${c.theme}” · ` : ""}${contestStageName(c.roomId)} · hosted by ${c.hostName} · ${contestDeadlineLine(c, Date.now())}`}
              meta={`${contestPhaseLabel(c.phase)} · ${c.entryCount} ${c.entryCount === 1 ? "entry" : "entries"}`}
              highlighted={selectedId === c.id}
              action={
                <button
                  type="button"
                  data-testid="world-contest-open"
                  onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                  className={ghostBtn(isLight)}
                >
                  {selectedId === c.id ? "Close" : "Open"}
                </button>
              }
            />
          ))
        )}
      </NativeBoard>

      {/* ── The opened contest ───────────────────────────────── */}
      {selectedId && (
        <div data-testid="world-contest-detail" className="space-y-3">
          {detailFailed ? (
            <NativeErrorState
              isLight={isLight}
              title="That contest wouldn't open"
              message="Its entries and honors are unchanged — try again."
              onRetry={() => setDetailTick((t) => t + 1)}
            />
          ) : !detail ? (
            <NativeLoadingState isLight={isLight} message="Opening the contest…" />
          ) : (
            <>
              <p className={`px-1 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {detail.contest.title}
                <span className={`ml-2 text-xs font-semibold ${faint}`}>
                  {contestPhaseLabel(detail.contest.phase)} · {contestStageName(detail.contest.roomId)}
                </span>
              </p>

              {detail.contest.winners.length > 0 && (
                <div className="space-y-1 px-1" data-testid="world-contest-podium">
                  {detail.contest.winners.map((w) => (
                    <p key={w.id} className={`inline-flex w-full items-center gap-2 text-sm ${sub}`}>
                      <Trophy className="h-4 w-4 shrink-0 text-[#d4af37]" />
                      <span>
                        <strong className={isLight ? "text-[#2a1e07]" : "text-white"}>{placeLabel(w.place)}:</strong>{" "}
                        {w.winnerName} — “{w.workTitle}”
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {detail.entries.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="No entries yet."
                  detail={
                    detail.contest.phase === "open"
                      ? "The first work entered stands alone at the top — for now."
                      : undefined
                  }
                />
              ) : (
                <div className="space-y-1.5">
                  {detail.entries.map((e) => (
                    <NativeBoardRow
                      key={e.id}
                      isLight={isLight}
                      title={e.workTitle}
                      detail={`${e.workKind === "video" ? "Video" : "Track"} · entered by ${e.entrantName}`}
                      highlighted={!!userId && e.userId === userId}
                    />
                  ))}
                </div>
              )}

              {/* Entering */}
              {detail.contest.phase === "open" &&
                (isGuest ? (
                  <p className={`inline-flex flex-wrap items-center gap-2 px-1 text-sm ${sub}`} data-testid="world-contest-guest-pitch">
                    Guests can watch every contest — entering takes a membership.
                    <Link href={GUEST_SIGN_IN_HREF} className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105">
                      <LogIn className="h-3 w-3" /> Sign in to enter
                    </Link>
                  </p>
                ) : myEntry ? (
                  <p className={`px-1 text-sm ${sub}`} data-testid="world-contest-my-entry">
                    You&rsquo;re in with “{myEntry.workTitle}” — one entry each, and yours stands.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-end gap-2 px-1">
                    <label className={`flex min-w-56 flex-1 flex-col gap-1 text-xs font-bold ${sub}`}>
                      Your work
                      <select
                        data-testid="world-contest-work-picker"
                        value={pickedWorkId}
                        onChange={(e) => setPickedWorkId(e.target.value)}
                        className={inputCls(isLight)}
                      >
                        <option value="">Pick one of your published works…</option>
                        {(works ?? []).map((w) => (
                          <option key={w.id} value={w.id} disabled={!w.isPublished}>
                            {w.title} ({w.workKind}){w.isPublished ? "" : " — not published yet"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" data-testid="world-contest-enter" disabled={busy} onClick={onEnter} className={goldBtn}>
                      Enter this work
                    </button>
                    {works !== null && publishedWorks.length === 0 && (
                      <p className={`w-full text-xs ${faint}`}>
                        You have no published work to enter yet — publish a track or a video first, then it can stand here.
                      </p>
                    )}
                  </div>
                ))}

              {/* Judging */}
              {detail.contest.phase === "judging" &&
                (isHost ? (
                  <div className="space-y-2 px-1" data-testid="world-contest-judging">
                    <p className={`text-sm ${sub}`}>
                      The window has closed. Name the podium from the entries — your pick is the
                      record, and it stands forever. Honors are the prize: no Visual Bucs move.
                    </p>
                    {[0, 1, 2].map((slot) => (
                      <label key={slot} className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                        {placeLabel(slot + 1)}
                        <select
                          data-testid={`world-contest-podium-${slot + 1}`}
                          value={podium[slot] ?? ""}
                          onChange={(e) =>
                            setPodium((p) => p.map((v, i) => (i === slot ? e.target.value || null : v)))
                          }
                          className={inputCls(isLight)}
                        >
                          <option value="">—</option>
                          {detail.entries.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.entrantName} — “{e.workTitle}”
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <button type="button" data-testid="world-contest-name-winners" disabled={busy} onClick={onNameWinners} className={goldBtn}>
                      Name the winners
                    </button>
                  </div>
                ) : (
                  <p className={`px-1 text-sm ${sub}`}>
                    The window has closed — {detail.contest.hostName} names the winners, and they
                    stand in the Circle below.
                  </p>
                ))}
            </>
          )}
        </div>
      )}

      {/* ── Hosting ──────────────────────────────────────────── */}
      {!isGuest && (
        <div className="px-1">
          {showHostForm ? (
            <div className="space-y-2" data-testid="world-contest-host-form">
              <p className={`inline-flex items-center gap-2 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                <Crown className="h-4 w-4 text-[#d4af37]" /> Host a contest
              </p>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                Title
                <input data-testid="world-contest-host-title" value={hostTitle} onChange={(e) => setHostTitle(e.target.value)} maxLength={120} className={inputCls(isLight)} placeholder="Best Hook in the Palace" />
              </label>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                Theme — the one line entrants create under
                <input data-testid="world-contest-host-theme" value={hostTheme} onChange={(e) => setHostTheme(e.target.value)} maxLength={140} className={inputCls(isLight)} placeholder="A hook that stops the scroll" />
              </label>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                Stage
                <select data-testid="world-contest-host-stage" value={hostRoom} onChange={(e) => setHostRoom(e.target.value)} className={inputCls(isLight)}>
                  <option value={MUSIC_HALL_ID}>Music Hall — any member may host</option>
                  <option value={HALL_ROOM_ID}>Throne Hall — Front Row members and the house host</option>
                </select>
              </label>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                Entry deadline
                <input data-testid="world-contest-host-deadline" type="datetime-local" value={hostDeadline} onChange={(e) => setHostDeadline(e.target.value)} className={inputCls(isLight)} />
              </label>
              <div className="flex gap-2">
                <button type="button" data-testid="world-contest-host-submit" disabled={busy} onClick={onHost} className={goldBtn}>
                  Open the contest
                </button>
                <button type="button" onClick={() => setShowHostForm(false)} className={ghostBtn(isLight)}>
                  Not now
                </button>
              </div>
            </div>
          ) : (
            <button type="button" data-testid="world-contest-host-open" onClick={() => setShowHostForm(true)} className={ghostBtn(isLight)}>
              Host a contest
            </button>
          )}
        </div>
      )}

      {/* ── The Winners' Circle ──────────────────────────────── */}
      <NativeBoard isLight={isLight} title="The Winners' Circle">
        {loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The Circle wouldn't open"
            message="The honors are recorded and unchanged — try again."
            onRetry={refresh}
          />
        ) : honors === null ? (
          <NativeLoadingState isLight={isLight} message="Reading the honors…" />
        ) : honors.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message="No honors yet."
            detail="The first decided contest writes the first line here — winner, work, and the contest it came from, kept for good."
          />
        ) : (
          honors.map((hon) => (
            <NativeBoardRow
              key={hon.id}
              isLight={isLight}
              title={`${placeLabel(hon.place)} — ${hon.winnerName}`}
              detail={`“${hon.workTitle}” (${hon.workKind}) · won ${hon.contestTitle} · ${contestStageName(hon.roomId)}`}
              meta={new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(hon.decidedAt))}
            />
          ))
        )}
      </NativeBoard>
    </div>
  );
}
