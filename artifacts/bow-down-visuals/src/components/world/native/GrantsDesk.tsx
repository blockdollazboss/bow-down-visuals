/**
 * GrantsDesk — the Community Hall's native Community Grants
 * desk (stack1500 world parity wave #3, census item 41).
 *
 * The monthly community grant, in the room: read the current
 * round and its projects, submit your own project while
 * submissions are open, vote while voting is open (and take
 * the vote back), follow past rounds to their results and
 * report-backs — and when the funded creator is you, post
 * the report-back the community is owed, from the desk.
 *
 * The pool is Visual Bucs only — no cash path exists on this
 * rail. Guests read everything; the write rails need an
 * account, so the actions gate on sign-in. Everything is
 * free; state re-reads after every action. Admin rounds and
 * settling stay on the website's admin benches — not here.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { apiErrorMessage } from "../../../lib/api-error";
import { formatVb, monthLabel } from "@/lib/community-grants";
import {
  GRANTS_PATH,
  GRANT_PHASE_LABELS,
  GRANT_RESULT_LABELS,
  buildGrantProjectPayload,
  buildGrantReportBackPayload,
  grantsProjectsPath,
  grantsReportBackPath,
  grantsSurfaceOf,
  grantsVotePath,
  myOwedReportBack,
  type GrantRound,
  type GrantsSurface,
} from "@/lib/world/grants-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

export function GrantsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const deskHeaders = useDeskAuthHeaders();
  const { user } = useAuth();
  const [surface, setSurface] = useState<GrantsSurface | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reportBack, setReportBack] = useState("");

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const load = useCallback(async () => {
    try {
      const headers = isGuest ? undefined : await deskHeaders().catch(() => undefined);
      const res = await fetch(GRANTS_PATH, { headers });
      if (!res.ok) throw new Error("load failed");
      const parsed = grantsSurfaceOf(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("load failed");
      setSurface(parsed);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [deskHeaders, isGuest]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<void>, okNotice?: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      if (okNotice) setNotice(okNotice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't land. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  async function send(method: string, path: string, body?: unknown): Promise<void> {
    const headers = await deskHeaders();
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(data, "That didn't land. Try again in a moment."));
  }

  const current = surface?.current ?? null;

  const submit = () => {
    if (!current) return;
    const payload = buildGrantProjectPayload(title, description);
    if (!payload) {
      setError("Your project needs a title (up to 120 characters) and a description in your own words (up to 2,000).");
      return;
    }
    void run(
      "submit",
      async () => {
        await send("POST", grantsProjectsPath(current.round.id), payload);
        setTitle("");
        setDescription("");
      },
      "Project in — the community can read it below.",
    );
  };

  const vote = (round: GrantRound, candidateId: string) =>
    void run(`vote-${candidateId}`, () =>
      send("POST", grantsVotePath(round.round.id), { candidateId }),
    );

  const withdraw = (round: GrantRound) =>
    void run("withdraw", () => send("DELETE", grantsVotePath(round.round.id)), "Vote withdrawn.");

  const postReportBack = (round: GrantRound) => {
    const payload = buildGrantReportBackPayload(reportBack);
    if (!payload) {
      setError("Write your report-back in your own words first (up to 4,000 characters).");
      return;
    }
    void run(
      "report-back",
      async () => {
        await send("POST", grantsReportBackPath(round.round.id), payload);
        setReportBack("");
      },
      "Report-back posted — thank you.",
    );
  };

  function RoundBlock({ surface: s, isCurrent }: { surface: GrantRound; isCurrent: boolean }) {
    const owed = myOwedReportBack(s, user?.id ?? null);
    const resultLabel = GRANT_RESULT_LABELS[s.round.resultStatus] ?? "";
    return (
      <section className={`rounded-xl border p-3 ${cardCls}`}>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-black ${strong}`}>{monthLabel(s.round.monthKey)}</p>
          <span className={chipCls(isCurrent)}>{GRANT_PHASE_LABELS[s.phase]}</span>
          {resultLabel ? <span className={chipCls(s.round.resultStatus === "winner")}>{resultLabel}</span> : null}
          <span className={`ml-auto text-xs ${muted}`}>
            Pool {formatVb(s.round.poolVb)} · {s.totalVotes} votes
            {s.round.grantStatus === "paid" ? " · grant paid" : ""}
          </span>
        </div>
        {s.candidates.length === 0 ? (
          <p className={`mt-2 text-sm ${muted}`}>No projects yet this round.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {s.candidates.map((c) => (
              <li key={c.id} className={`rounded-lg border px-3 py-2 ${cardCls}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-bold ${strong}`}>
                    {c.title}
                    {c.isWinner ? " 🏆" : ""}
                  </span>
                  <span className={`text-xs ${muted}`}>
                    by {c.creatorName}
                    {user && c.creatorUserId === user.id ? " (you)" : ""} · {c.votes} votes
                  </span>
                  {isCurrent && s.phase === "voting" && !isGuest ? (
                    s.myVoteCandidateId === c.id ? (
                      <span className={`ml-auto ${chipCls(true)}`}>Your vote ✓</span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`world-grants-desk-vote-${c.id}`}
                        className={`ml-auto ${chipCls(false)}`}
                        disabled={busy !== null}
                        onClick={() => vote(s, c.id)}
                      >
                        Vote
                      </button>
                    )
                  ) : null}
                </div>
                <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`}>{c.description}</p>
                {c.reportBack ? (
                  <p className={`mt-2 text-sm ${muted}`} data-testid={`world-grants-desk-reportback-${c.id}`}>
                    <span className={`font-bold ${strong}`}>Report-back:</span> {c.reportBack}
                  </p>
                ) : c.reportBackOwed ? (
                  <p className={`mt-2 text-xs ${muted}`}>Report-back still owed to the community.</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {isCurrent && s.phase === "voting" && !isGuest && s.myVoteCandidateId ? (
          <button
            type="button"
            data-testid="world-grants-desk-withdraw"
            className={`mt-2 ${chipCls(false)}`}
            disabled={busy !== null}
            onClick={() => withdraw(s)}
          >
            Withdraw my vote
          </button>
        ) : null}
        {owed && !isGuest ? (
          <div className="mt-3" data-testid="world-grants-desk-reportback-form">
            <p className={`text-sm font-bold ${strong}`}>Your report-back is owed</p>
            <p className={`text-xs ${muted}`}>
              The community funded “{owed.title}” — tell them what the grant built, in your own
              words.
            </p>
            <textarea
              className={`${inputCls} mt-2`}
              rows={4}
              maxLength={4000}
              value={reportBack}
              onChange={(e) => setReportBack(e.target.value)}
            />
            <button
              type="button"
              data-testid="world-grants-desk-reportback-post"
              className={`mt-2 ${goldBtn}`}
              disabled={busy !== null}
              onClick={() => postReportBack(s)}
            >
              {busy === "report-back" ? "Posting…" : "Post the report-back"}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  if (loadFailed) {
    return (
      <div className="space-y-3" data-testid="world-grants-desk">
        <p className={`text-base font-black ${strong}`}>Community Grants</p>
        <p className={errCls} data-testid="world-grants-desk-failed">
          The grants board wouldn&rsquo;t load. Give it another shot.
        </p>
        <button type="button" className={chipCls(false)} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="world-grants-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Community Grants</p>
        <p className={`text-xs ${muted}`}>
          One project a month, funded by the community pool — in Visual Bucs, always. Creators
          pitch, the community votes, the funded creator reports back.
        </p>
      </div>
      {notice ? (
        <p className={`text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{notice}</p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {surface === null ? (
        <p className={`text-sm ${muted}`}>Reading the grants board…</p>
      ) : (
        <>
          {current ? (
            <RoundBlock surface={current} isCurrent />
          ) : (
            <p className={`text-sm ${muted}`} data-testid="world-grants-desk-noround">
              No round is open right now — when the next one opens, its projects land here.
            </p>
          )}

          {current && current.phase === "submissions" ? (
            isGuest ? (
              <p className={`text-sm ${muted}`}>
                Submissions are open —{" "}
                <Link href="/login" data-testid="world-grants-desk-signin" className="font-bold underline">
                  sign in
                </Link>{" "}
                to put your project in.
              </p>
            ) : (
              <section className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-grants-desk-submit">
                <p className={`text-sm font-bold ${strong}`}>Put your project in</p>
                <label className={`mt-2 block text-xs ${muted}`}>
                  Project title
                  <input
                    className={`${inputCls} mt-1`}
                    data-testid="world-grants-desk-title"
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className={`mt-2 block text-xs ${muted}`}>
                  What the grant would build, in your own words
                  <textarea
                    className={`${inputCls} mt-1`}
                    data-testid="world-grants-desk-description"
                    rows={4}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  data-testid="world-grants-desk-submit-btn"
                  className={`mt-2 ${goldBtn}`}
                  disabled={busy !== null}
                  onClick={submit}
                >
                  {busy === "submit" ? "Submitting…" : "Submit my project"}
                </button>
              </section>
            )
          ) : null}

          {surface.past.length > 0 ? (
            <div className="space-y-3">
              <p className={`text-sm font-bold ${strong}`}>Past rounds</p>
              {surface.past.map((s) => (
                <RoundBlock key={s.round.id} surface={s} isCurrent={false} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
