import { useEffect, useState } from "react";
import { plainErrorText } from "../../../lib/api-error";
import { NativeEmptyState } from "@/components/world/native/NativeStates";
import { deskInputCls } from "@/components/world/native/CreateDeskLeaf";
import {
  BenchOutcome,
  BenchDenied,
  BenchSection,
  BenchStates,
  BusyLabel,
  StatusPill,
  adminCls,
  adminDenied,
  useAdminApi,
  useBench,
  useBenchAction,
} from "@/components/world/native/AdminBenchBits";
import {
  ADMIN_CHALLENGES_PATH,
  adminChallengePrizesPath,
  adminChallengeLifecyclePath,
  adminChallengeJudgePath,
  challengeDetailPath,
  parseAdminChallenges,
  parseChallengeDetail,
  parseJudgeResult,
  buildPrizesBody,
  buildLifecycleBody,
  buildJudgeByVotes,
  buildJudgeByPicks,
  localInputToIso,
  isoToLocalInput,
  challengeLifecycleTargets,
  prizeDraftError,
  prizeDraftTotal,
  CHALLENGE_PRIZE_POOL_CAP_VB,
  GRANTS_SURFACE_PATH,
  ADMIN_GRANT_ROUNDS_PATH,
  adminGrantRoundPath,
  adminGrantSettlePath,
  parseGrantsAdmin,
  parseGrantSettleOutcome,
  grantOpenReady,
  buildGrantRoundBody,
  buildGrantWindowsBody,
  grantSettleAvailable,
  grantWindowsEditable,
  ADMIN_REMIX_EVENTS_PATH,
  adminRemixEventPath,
  adminRemixStatusPath,
  adminRemixWinnerPath,
  adminRemixShortlistPath,
  adminRemixSplitPaymentsPath,
  parseRemixAdminEvents,
  buildRemixCreateBody,
  buildRemixPatchBody,
  buildRemixStatus,
  buildRemixShortlist,
  buildRemixWinner,
  remixPayReady,
  buildRemixSplitPayments,
  remixDraftFromEvent,
  remixStatusTargets,
  remixWinnerAvailable,
  remixShortlistAvailable,
  splitDraftError,
  splitDraftSum,
  REMIX_SPLIT_ROLES,
  DROP_BOOK_PATH,
  DROP_SLATE_PATH,
  dropCancelPath,
  buildDropBody,
  dropBookingError,
  parseUpcomingDrops,
  parseDropStartInput,
  dropStartInputValue,
  dropRooms,
  DROP_DURATION_PRESETS_MIN,
  DROP_MAX_AMOUNT_VB,
  DROP_MIN_AMOUNT_VB,
  DROP_MAX_CLAIMS,
  DROP_MIN_CLAIMS,
  DROP_WEEKLY_BUDGET_VB,
  type AdminChallengeRow,
  type ChallengeDetail,
  type JudgeResult,
  type PrizeDraft,
  type SplitDraft,
  type GrantWindows,
  type RemixEventDraft,
  type RemixEventRow,
} from "@/lib/world/admin-desk";

/* ─── The program benches (wave #5, census item 46) ────────────────
   Challenges, Community Grants, Remix King and the palace Drops,
   native in-World on the same rails the website benches ride. Every
   path, body and strict parse rides the admin-desk seam; failures
   read as failures through the shared plain-text error rail, and a
   rail 403 flips the bench to the not-authorized state.          */

/* ─── draft-rule keys → plain sentences ──────────────────────────── */

function prizeDraftSentence(key: string): string {
  switch (key) {
    case "empty":
      return "Add at least one prize row before saving.";
    case "placeRange":
      return "Places run from 1 to 10.";
    case "placeDuplicate":
      return "Each place can only appear once.";
    case "amountWhole":
      return "Prize amounts are whole Visual Bucs.";
    case "amountMultiple":
      return "Prize amounts are multiples of 100 Visual Bucs.";
    case "amountRange":
      return "Prize amounts run from 100 to 10,000,000 Visual Bucs.";
    case "overCap":
      return "The prize pool total is over the weekly cap.";
    default:
      return "This prize table isn't sendable yet.";
  }
}

function splitDraftSentence(key: string): string {
  switch (key) {
    case "empty":
      return "Add at least one split.";
    case "tooMany":
      return "Three splits at most.";
    case "roleUnknown":
      return "Pick a known role for every split.";
    case "roleDuplicate":
      return "Each role appears once.";
    case "nameMissing":
      return "Every split needs a name.";
    case "shareRange":
      return "Shares are whole numbers from 1 to 100.";
    case "winnerMissing":
      return "The winner's split has to be there.";
    case "sumNot100":
      return "The splits have to add up to exactly 100.";
    default:
      return "These splits aren't sendable yet.";
  }
}

function dropDraftSentence(key: string): string {
  switch (key) {
    case "titleRequired":
      return "Give the drop a title.";
    case "titleTooLong":
      return "That title is too long.";
    case "roomUnknown":
      return "Pick a room the drop can land in.";
    case "amountRange":
      return `Each claim runs ${DROP_MIN_AMOUNT_VB} to ${DROP_MAX_AMOUNT_VB} Visual Bucs.`;
    case "claimRange":
      return `Claims run ${DROP_MIN_CLAIMS} to ${DROP_MAX_CLAIMS}.`;
    case "durationTooShort":
    case "durationTooLong":
      return "Pick one of the offered lengths.";
    case "startRequired":
      return "Pick a start time.";
    case "startPast":
      return "That start time has already passed.";
    case "startTooFar":
      return "That start is too far ahead.";
    default:
      return "This drop isn't bookable yet.";
  }
}

function dropServerSentence(key: string): string {
  switch (key) {
    case "refusedAdmin":
      return "Booking drops is the house's own job — this session isn't the house's.";
    case "slotTaken":
      return "That slot is already taken — pick another time.";
    case "signIn":
      return "Sign in first.";
    default:
      return "The booking didn't go through — try again.";
  }
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/* ─── Challenges ─────────────────────────────────────────────────── */

export function ChallengesBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const bench = useBench(async (a) => parseAdminChallenges(await a.get(ADMIN_CHALLENGES_PATH)));
  const act = useBenchAction();

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [detailPhase, setDetailPhase] = useState<"idle" | "loading" | "denied" | "failed" | "ready">("idle");
  const [detailFail, setDetailFail] = useState("");
  const [lifeStatus, setLifeStatus] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [judgingEnds, setJudgingEnds] = useState("");
  const [prizes, setPrizes] = useState<PrizeDraft[]>([]);
  const [judgeMode, setJudgeMode] = useState<"votes" | "picks">("votes");
  const [judgePlaces, setJudgePlaces] = useState("3");
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [confirmJudge, setConfirmJudge] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);

  const loadDetail = async (slug: string) => {
    setDetailPhase("loading");
    try {
      const parsed = parseChallengeDetail(await api.get(challengeDetailPath(slug)));
      if (!parsed) throw new Error("shape");
      setDetail(parsed);
      setLifeStatus("");
      setStarts(isoToLocalInput(parsed.startsAt));
      setEnds(isoToLocalInput(parsed.endsAt));
      setJudgingEnds(isoToLocalInput(parsed.judgingEndsAt));
      setPrizes(
        parsed.prizes.map((p) => ({
          place: p.place,
          amount: String(p.prizeCredits),
          description: p.description,
        })),
      );
      setPicks({});
      setConfirmJudge(false);
      setDetailPhase("ready");
    } catch (e) {
      if (adminDenied(e)) setDetailPhase("denied");
      else {
        setDetailFail(plainErrorText(e, "This challenge wouldn't open."));
        setDetailPhase("failed");
      }
    }
  };

  const selectChallenge = (slug: string) => {
    setSelected(slug);
    setJudgeResult(null);
    void loadDetail(slug);
  };

  const reloadAll = async () => {
    bench.reload();
    if (selected) await loadDetail(selected);
  };

  const selectedRow: AdminChallengeRow | null =
    bench.data?.find((r) => r.slug === selected) ?? null;
  const prizeError = prizeDraftError(prizes);
  const prizeTotal = prizeDraftTotal(prizes);

  return (
    <BenchSection isLight={isLight} title="Challenges" blurb="Contest lifecycles, prize tables and judging — the website's challenge bench, native in the palace.">
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage="Opening the challenges bench…"
        >
          <div className="flex flex-col gap-3">
            {bench.data && bench.data.length === 0 ? (
              <NativeEmptyState isLight={isLight} message="No challenges yet." />
            ) : (
              bench.data?.map((row) => (
                <button
                  key={row.slug}
                  type="button"
                  onClick={() => selectChallenge(row.slug)}
                  className={`w-full text-left ${cls.rowCls} ${
                    selected === row.slug ? "outline outline-1 outline-[#C9A84C]/60" : ""
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-bold ${cls.titleCls}`}>{row.title}</span>
                    <StatusPill status={row.effectiveStatus} isLight={isLight} />
                    {row.winnersAnnounced ? (
                      <span className={`text-[11px] font-bold ${cls.subCls}`}>winners crowned</span>
                    ) : null}
                  </span>
                  <span className={`mt-1 block text-xs ${cls.subCls}`}>
                    {row.hashtag} · {row.entryCount} entries · pool {row.prizePoolCredits.toLocaleString()} VB ·{" "}
                    {row.startsAt ? `starts ${new Date(row.startsAt).toLocaleString()}` : "no start set"}
                  </span>
                </button>
              ))
            )}

            {selected ? (
              <div className={`rounded-xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                {detailPhase === "loading" ? (
                  <p className={`text-xs ${cls.subCls}`}>Opening this challenge…</p>
                ) : detailPhase === "denied" ? (
                  <BenchDenied isLight={isLight} />
                ) : detailPhase === "failed" ? (
                  <p className={`text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                    {detailFail}{" "}
                    <button type="button" className="underline" onClick={() => void loadDetail(selected)}>
                      Try again
                    </button>
                  </p>
                ) : detail ? (
                  <div className="flex flex-col gap-4">
                    <p className={`text-sm font-bold ${cls.titleCls}`}>
                      {detail.title} — {detail.entryCount} entries · pool {detail.prizePoolCredits.toLocaleString()} VB
                    </p>

                    {/* lifecycle */}
                    <div className="flex flex-col gap-2">
                      <span className={cls.labelCls}>Lifecycle</span>
                      {selectedRow && challengeLifecycleTargets(selectedRow).length > 0 ? (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <select
                              aria-label="Lifecycle status"
                              className={cls.selectCls}
                              value={lifeStatus}
                              onChange={(e) => setLifeStatus(e.target.value)}
                            >
                              <option value="">Leave status as is</option>
                              {challengeLifecycleTargets(selectedRow).map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="flex flex-col gap-1">
                              <span className={cls.labelCls}>Starts</span>
                              <input type="datetime-local" className={deskInputCls(isLight)} value={starts} onChange={(e) => setStarts(e.target.value)} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className={cls.labelCls}>Ends</span>
                              <input type="datetime-local" className={deskInputCls(isLight)} value={ends} onChange={(e) => setEnds(e.target.value)} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className={cls.labelCls}>Judging ends</span>
                              <input type="datetime-local" className={deskInputCls(isLight)} value={judgingEnds} onChange={(e) => setJudgingEnds(e.target.value)} />
                            </label>
                          </div>
                          <p className={`text-[11px] ${cls.subCls}`}>
                            A cleared date box clears that date on the challenge; the status only moves when you pick one.
                          </p>
                          <div>
                            <button
                              type="button"
                              className={cls.goldBtn}
                              disabled={act.busy !== null}
                              onClick={() =>
                                void act.run("lifecycle", async () => {
                                  await api.send(
                                    adminChallengeLifecyclePath(detail.slug),
                                    "POST",
                                    buildLifecycleBody({
                                      status: lifeStatus || undefined,
                                      startsAtIso: localInputToIso(starts),
                                      endsAtIso: localInputToIso(ends),
                                      judgingEndsAtIso: localInputToIso(judgingEnds),
                                    }),
                                  );
                                  await reloadAll();
                                  return "Lifecycle saved.";
                                })
                              }
                            >
                              <BusyLabel busy={act.busy === "lifecycle"}>Save lifecycle</BusyLabel>
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className={`text-xs ${cls.subCls}`}>
                          Winners are crowned — this challenge's lifecycle is closed.
                        </p>
                      )}
                    </div>

                    {/* prizes */}
                    <div className="flex flex-col gap-2">
                      <span className={cls.labelCls}>Prizes</span>
                      {prizes.map((row, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1">
                            <span className={cls.labelCls}>Place</span>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              className={`${deskInputCls(isLight)} w-20`}
                              value={row.place}
                              onChange={(e) =>
                                setPrizes((prev) => prev.map((p, j) => (j === i ? { ...p, place: Number(e.target.value) } : p)))
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={cls.labelCls}>Visual Bucs</span>
                            <input
                              type="number"
                              className={`${deskInputCls(isLight)} w-32`}
                              value={row.amount}
                              onChange={(e) =>
                                setPrizes((prev) => prev.map((p, j) => (j === i ? { ...p, amount: e.target.value } : p)))
                              }
                            />
                          </label>
                          <label className="flex flex-1 flex-col gap-1">
                            <span className={cls.labelCls}>Description</span>
                            <input
                              type="text"
                              className={deskInputCls(isLight)}
                              value={row.description}
                              onChange={(e) =>
                                setPrizes((prev) => prev.map((p, j) => (j === i ? { ...p, description: e.target.value } : p)))
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className={cls.smallBtn}
                            onClick={() => setPrizes((prev) => prev.filter((_, j) => j !== i))}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className={cls.smallBtn}
                          disabled={prizes.length >= 10}
                          onClick={() =>
                            setPrizes((prev) => [
                              ...prev,
                              { place: prev.length ? Math.max(...prev.map((p) => p.place)) + 1 : 1, amount: "", description: "" },
                            ])
                          }
                        >
                          Add a prize
                        </button>
                        <span className={`text-xs ${cls.subCls}`}>
                          Pool total {prizeTotal.toLocaleString()} of {CHALLENGE_PRIZE_POOL_CAP_VB.toLocaleString()} VB weekly cap
                        </span>
                      </div>
                      {prizeError ? (
                        <p className={`text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                          {prizeDraftSentence(prizeError)}
                        </p>
                      ) : null}
                      <div>
                        <button
                          type="button"
                          className={cls.goldBtn}
                          disabled={act.busy !== null || prizeError !== null}
                          onClick={() =>
                            void act.run("prizes", async () => {
                              await api.send(adminChallengePrizesPath(detail.slug), "POST", buildPrizesBody(prizes));
                              await reloadAll();
                              return "Prizes saved.";
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === "prizes"}>Save prizes</BusyLabel>
                        </button>
                      </div>
                    </div>

                    {/* judging */}
                    <div className="flex flex-col gap-2">
                      <span className={cls.labelCls}>Judging</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={judgeMode === "votes" ? cls.goldBtn : cls.ghostBtn}
                          onClick={() => setJudgeMode("votes")}
                        >
                          Crown by votes
                        </button>
                        <button
                          type="button"
                          className={judgeMode === "picks" ? cls.goldBtn : cls.ghostBtn}
                          onClick={() => setJudgeMode("picks")}
                        >
                          Pick by hand
                        </button>
                      </div>
                      {judgeMode === "votes" ? (
                        <label className="flex flex-col gap-1">
                          <span className={cls.labelCls}>Places to crown (1–10)</span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            className={`${deskInputCls(isLight)} w-24`}
                            value={judgePlaces}
                            onChange={(e) => setJudgePlaces(e.target.value)}
                          />
                        </label>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {[1, 2, 3].map((place) => (
                            <label key={place} className="flex flex-col gap-1">
                              <span className={cls.labelCls}>Place {place}</span>
                              <select
                                className={cls.selectCls}
                                value={picks[place] ?? ""}
                                onChange={(e) => setPicks((prev) => ({ ...prev, [place]: e.target.value }))}
                              >
                                <option value="">No pick</option>
                                {detail.entries.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.title} — {entry.creatorName} ({entry.voteCount} votes)
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      )}
                      {confirmJudge ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-semibold ${cls.titleCls}`}>
                            Crowning pays the prizes out. Tap again to judge for real.
                          </span>
                          <button
                            type="button"
                            className={cls.goldBtn}
                            disabled={act.busy !== null}
                            onClick={() =>
                              void act.run("judge", async () => {
                                const body =
                                  judgeMode === "votes"
                                    ? buildJudgeByVotes(Number(judgePlaces))
                                    : buildJudgeByPicks(picks);
                                const raw = await api.send(adminChallengeJudgePath(detail.slug), "POST", body);
                                const parsed = parseJudgeResult(raw);
                                if (!parsed) {
                                  throw new Error("The judging answer came back unreadable — reload before trusting it.");
                                }
                                setJudgeResult(parsed);
                                setConfirmJudge(false);
                                await reloadAll();
                                return "Judging is done.";
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === "judge"}>Judge now</BusyLabel>
                          </button>
                          <button type="button" className={cls.ghostBtn} onClick={() => setConfirmJudge(false)}>
                            Not yet
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button type="button" className={cls.goldBtn} onClick={() => setConfirmJudge(true)}>
                            Judge this challenge
                          </button>
                        </div>
                      )}
                      {judgeResult ? (
                        <div className={cls.rowCls}>
                          <p className={`text-xs font-bold ${cls.titleCls}`}>
                            Paid {judgeResult.paid} · already paid {judgeResult.alreadyPaid} ·{" "}
                            {judgeResult.weeklyPaidVb.toLocaleString()} of {judgeResult.weeklyCapVb.toLocaleString()} VB paid this week
                          </p>
                          {judgeResult.winners.map((w) => (
                            <p key={w.place} className={`mt-1 text-xs ${cls.subCls}`}>
                              Place {w.place} — {w.prizeCredits.toLocaleString()} VB
                              {w.paidAt ? ` · paid ${new Date(w.paidAt).toLocaleString()}` : " · not paid yet"}
                            </p>
                          ))}
                          {judgeResult.budgetCapped.length > 0 ? (
                            <p className={`mt-1 text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                              Held by the weekly cap: {judgeResult.budgetCapped.join(", ")}
                            </p>
                          ) : null}
                          {judgeResult.payoutErrors.length > 0 ? (
                            <p className={`mt-1 text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                              Payout problems: {judgeResult.payoutErrors.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
          </div>
        </BenchStates>
      )}
    </BenchSection>
  );
}

/* ─── Community Grants ───────────────────────────────────────────── */

export function GrantsBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const bench = useBench(async (a) => parseGrantsAdmin(await a.get(GRANTS_SURFACE_PATH)));
  const act = useBenchAction();

  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [pool, setPool] = useState("");
  const [windows, setWindows] = useState<GrantWindows>({
    submissionsOpenAt: "",
    submissionsCloseAt: "",
    votingOpenAt: "",
    votingCloseAt: "",
  });
  const [editWindows, setEditWindows] = useState<GrantWindows | null>(null);
  const [seededRound, setSeededRound] = useState<string | null>(null);
  const [confirmSettle, setConfirmSettle] = useState(false);

  const current = bench.data?.current ?? null;

  useEffect(() => {
    if (current && seededRound !== current.round.id) {
      setEditWindows({
        submissionsOpenAt: isoToLocalInput(current.round.submissionsOpenAt),
        submissionsCloseAt: isoToLocalInput(current.round.submissionsCloseAt),
        votingOpenAt: isoToLocalInput(current.round.votingOpenAt),
        votingCloseAt: isoToLocalInput(current.round.votingCloseAt),
      });
      setSeededRound(current.round.id);
      setConfirmSettle(false);
    }
  }, [current, seededRound]);

  const openRound = () => {
    if (!grantOpenReady(monthKey, pool)) {
      act.setError("A round needs a YYYY-MM month key and a whole, positive Visual Buc pool.");
      return;
    }
    const converted = [
      windows.submissionsOpenAt,
      windows.submissionsCloseAt,
      windows.votingOpenAt,
      windows.votingCloseAt,
    ].map(localInputToIso);
    if (converted.some((v) => v === null)) {
      act.setError("Set all four windows — submissions open and close, voting open and close — before opening the round.");
      return;
    }
    void act.run("open", async () => {
      await api.send(
        ADMIN_GRANT_ROUNDS_PATH,
        "POST",
        buildGrantRoundBody({ monthKey, poolVb: Number(pool), windows }),
      );
      bench.reload();
      return `Round opened for ${monthKey}.`;
    });
  };

  const windowFields = (
    value: GrantWindows,
    onChange: (next: GrantWindows) => void,
  ) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {(
        [
          ["submissionsOpenAt", "Submissions open"],
          ["submissionsCloseAt", "Submissions close"],
          ["votingOpenAt", "Voting opens"],
          ["votingCloseAt", "Voting closes"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex flex-col gap-1">
          <span className={cls.labelCls}>{label}</span>
          <input
            type="datetime-local"
            className={deskInputCls(isLight)}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );

  return (
    <BenchSection isLight={isLight} title="Community Grants" blurb="Monthly grant rounds — open a round, keep its windows honest, settle the winner.">
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage="Opening the grants bench…"
        >
          <div className="flex flex-col gap-4">
            {current ? (
              <div className={cls.rowCls}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-bold ${cls.titleCls}`}>{current.round.monthKey} round</span>
                  <StatusPill status={current.phase} isLight={isLight} />
                  <StatusPill status={current.round.resultStatus} isLight={isLight} />
                </div>
                <p className={`mt-1 text-xs ${cls.subCls}`}>
                  Pool {current.round.poolVb.toLocaleString()} VB · {current.candidates.length} candidates ·{" "}
                  {current.totalVotes.toLocaleString()} votes
                </p>
                {current.candidates.map((c) => (
                  <div key={c.id} className="mt-2">
                    <p className={`text-xs font-bold ${cls.titleCls}`}>
                      {c.creatorName} — {c.title}
                      {c.isWinner ? " · Winner" : ""} · {c.votes.toLocaleString()} votes
                    </p>
                    {c.reportBack ? (
                      <p className={`text-xs ${cls.subCls}`}>Report-back: {c.reportBack}</p>
                    ) : c.reportBackOwed ? (
                      <p className={`text-xs ${cls.subCls}`}>Report-back still owed.</p>
                    ) : null}
                  </div>
                ))}

                {editWindows ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <span className={cls.labelCls}>Round windows</span>
                    {windowFields(editWindows, setEditWindows)}
                    {grantWindowsEditable(current.round) ? (
                      <div>
                        <button
                          type="button"
                          className={cls.goldBtn}
                          disabled={act.busy !== null}
                          onClick={() =>
                            void act.run("windows", async () => {
                              await api.send(
                                adminGrantRoundPath(current.round.id),
                                "PATCH",
                                buildGrantWindowsBody(editWindows),
                              );
                              bench.reload();
                              return "Windows saved.";
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === "windows"}>Save windows</BusyLabel>
                        </button>
                      </div>
                    ) : (
                      <p className={`text-xs ${cls.subCls}`}>This round is paid — its windows are locked.</p>
                    )}
                  </div>
                ) : null}

                {grantSettleAvailable(current) ? (
                  <div className="mt-3">
                    {confirmSettle ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs font-semibold ${cls.titleCls}`}>
                          Settling pays the winner out of the pool. Tap again to settle for real.
                        </span>
                        <button
                          type="button"
                          className={cls.goldBtn}
                          disabled={act.busy !== null}
                          onClick={() =>
                            void act.run("settle", async () => {
                              const raw = await api.send(adminGrantSettlePath(current.round.id), "POST");
                              const outcome = parseGrantSettleOutcome(raw);
                              if (!outcome) {
                                throw new Error("The settle answer came back unreadable — reload before trusting it.");
                              }
                              setConfirmSettle(false);
                              bench.reload();
                              return outcome.amountVb !== null
                                ? `Round settled — ${outcome.amountVb.toLocaleString()} Visual Bucs paid to the winner.`
                                : `Round settled (${outcome.outcome}).`;
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === "settle"}>Settle now</BusyLabel>
                        </button>
                        <button type="button" className={cls.ghostBtn} onClick={() => setConfirmSettle(false)}>
                          Not yet
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={cls.goldBtn} onClick={() => setConfirmSettle(true)}>
                        Settle this round
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <NativeEmptyState isLight={isLight} message="No grant round is running. Open one below." />
            )}

            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>Open a round</span>
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>Month (YYYY-MM)</span>
                  <input
                    type="text"
                    className={`${deskInputCls(isLight)} w-36`}
                    value={monthKey}
                    onChange={(e) => setMonthKey(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>Pool (Visual Bucs)</span>
                  <input
                    type="number"
                    className={`${deskInputCls(isLight)} w-36`}
                    value={pool}
                    onChange={(e) => setPool(e.target.value)}
                  />
                </label>
              </div>
              {windowFields(windows, setWindows)}
              <div>
                <button type="button" className={cls.goldBtn} disabled={act.busy !== null} onClick={openRound}>
                  <BusyLabel busy={act.busy === "open"}>Open the round</BusyLabel>
                </button>
              </div>
            </div>

            {bench.data && bench.data.past.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className={cls.labelCls}>Past rounds</span>
                {bench.data.past.map((past) => {
                  const winner = past.candidates.find((c) => c.isWinner);
                  return (
                    <div key={past.round.id} className={cls.rowCls}>
                      <p className={`text-xs font-bold ${cls.titleCls}`}>
                        {past.round.monthKey} — pool {past.round.poolVb.toLocaleString()} VB · {past.phase}
                        {winner ? ` · won by ${winner.creatorName}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
          </div>
        </BenchStates>
      )}
    </BenchSection>
  );
}

/* ─── Remix King ─────────────────────────────────────────────────── */

function SplitsEditor({
  isLight,
  splits,
  onChange,
}: {
  isLight: boolean;
  splits: SplitDraft[];
  onChange: (next: SplitDraft[]) => void;
}) {
  const cls = adminCls(isLight);
  const err = splitDraftError(splits);
  return (
    <div className="flex flex-col gap-2">
      <span className={cls.labelCls}>Splits</span>
      {splits.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={cls.labelCls}>Role</span>
            <select
              className={cls.selectCls}
              value={row.role}
              onChange={(e) => onChange(splits.map((s, j) => (j === i ? { ...s, role: e.target.value } : s)))}
            >
              {REMIX_SPLIT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={cls.labelCls}>Payee name</span>
            <input
              type="text"
              className={`${deskInputCls(isLight)} w-40`}
              value={row.payeeName}
              onChange={(e) => onChange(splits.map((s, j) => (j === i ? { ...s, payeeName: e.target.value } : s)))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={cls.labelCls}>Payee account (optional)</span>
            <input
              type="text"
              className={`${deskInputCls(isLight)} w-40`}
              value={row.payeeUserId}
              onChange={(e) => onChange(splits.map((s, j) => (j === i ? { ...s, payeeUserId: e.target.value } : s)))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={cls.labelCls}>Share %</span>
            <input
              type="number"
              className={`${deskInputCls(isLight)} w-24`}
              value={row.sharePct}
              onChange={(e) => onChange(splits.map((s, j) => (j === i ? { ...s, sharePct: e.target.value } : s)))}
            />
          </label>
          <button type="button" className={cls.smallBtn} onClick={() => onChange(splits.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cls.smallBtn}
          disabled={splits.length >= 3}
          onClick={() =>
            onChange([...splits, { role: "king", payeeName: "", payeeUserId: "", sharePct: "" }])
          }
        >
          Add a split
        </button>
        <span className={`text-xs ${cls.subCls}`}>Splits total {splitDraftSum(splits)} of 100</span>
      </div>
      {err ? (
        <p className={`text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
          {splitDraftSentence(err)}
        </p>
      ) : null}
    </div>
  );
}

function RemixEventFields({
  isLight,
  draft,
  onChange,
}: {
  isLight: boolean;
  draft: RemixEventDraft;
  onChange: (next: RemixEventDraft) => void;
}) {
  const cls = adminCls(isLight);
  const set = (patch: Partial<RemixEventDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>Event title</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>King track title</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.kingTrackTitle} onChange={(e) => set({ kingTrackTitle: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>King track audio link</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.kingTrackAudioUrl} onChange={(e) => set({ kingTrackAudioUrl: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>King track stems link</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.kingTrackStemsUrl} onChange={(e) => set({ kingTrackStemsUrl: e.target.value })} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={cls.labelCls}>Description</span>
        <textarea className={deskInputCls(isLight)} rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>Entries open</span>
          <input type="datetime-local" className={deskInputCls(isLight)} value={draft.entriesOpenAt} onChange={(e) => set({ entriesOpenAt: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>Entries close</span>
          <input type="datetime-local" className={deskInputCls(isLight)} value={draft.entriesCloseAt} onChange={(e) => set({ entriesCloseAt: e.target.value })} />
        </label>
      </div>
      <SplitsEditor isLight={isLight} splits={draft.splits} onChange={(splits) => set({ splits })} />
    </div>
  );
}

const EMPTY_REMIX_DRAFT: RemixEventDraft = {
  title: "",
  kingTrackTitle: "",
  kingTrackAudioUrl: "",
  kingTrackStemsUrl: "",
  description: "",
  entriesOpenAt: "",
  entriesCloseAt: "",
  splits: [{ role: "winner", payeeName: "", payeeUserId: "", sharePct: "" }],
};

export function RemixBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const bench = useBench(async (a) => parseRemixAdminEvents(await a.get(ADMIN_REMIX_EVENTS_PATH)));
  const act = useBenchAction();

  const [createMonth, setCreateMonth] = useState(currentMonthKey);
  const [createDraft, setCreateDraft] = useState<RemixEventDraft>(EMPTY_REMIX_DRAFT);
  const [editors, setEditors] = useState<Record<string, RemixEventDraft>>({});
  const [payForms, setPayForms] = useState<Record<string, { period: string; total: string }>>({});
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const createErr = splitDraftError(createDraft.splits);
  const createMonthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(createMonth);
  const canCreate = createErr === null && createMonthOk && createDraft.title.trim() !== "";

  const draftFor = (event: RemixEventRow): RemixEventDraft => editors[event.id] ?? remixDraftFromEvent(event);

  return (
    <BenchSection isLight={isLight} title="Remix King" blurb="The monthly remix contest — events, entries, the crown and split payments.">
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage="Opening the Remix King bench…"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>New event</span>
              <label className="flex flex-col gap-1">
                <span className={cls.labelCls}>Month (YYYY-MM)</span>
                <input
                  type="text"
                  className={`${deskInputCls(isLight)} w-36`}
                  value={createMonth}
                  onChange={(e) => setCreateMonth(e.target.value)}
                />
              </label>
              <RemixEventFields isLight={isLight} draft={createDraft} onChange={setCreateDraft} />
              <div>
                <button
                  type="button"
                  className={cls.goldBtn}
                  disabled={act.busy !== null || !canCreate}
                  onClick={() =>
                    void act.run("create", async () => {
                      await api.send(
                        ADMIN_REMIX_EVENTS_PATH,
                        "POST",
                        buildRemixCreateBody({ monthKey: createMonth, draft: createDraft }),
                      );
                      setCreateDraft(EMPTY_REMIX_DRAFT);
                      bench.reload();
                      return `Remix King event drafted for ${createMonth}.`;
                    })
                  }
                >
                  <BusyLabel busy={act.busy === "create"}>Create the event</BusyLabel>
                </button>
              </div>
            </div>

            {bench.data && bench.data.length === 0 ? (
              <NativeEmptyState isLight={isLight} message="No Remix King events yet." />
            ) : (
              bench.data?.map((bundle) => {
                const event = bundle.event;
                const draft = draftFor(event);
                const draftErr = splitDraftError(draft.splits);
                const pay = payForms[bundle.release?.id ?? ""] ?? { period: event.monthKey, total: "" };
                return (
                  <div key={event.id} className={cls.rowCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-bold ${cls.titleCls}`}>{event.title}</span>
                      <StatusPill status={event.status} isLight={isLight} />
                    </div>
                    <p className={`mt-1 text-xs ${cls.subCls}`}>
                      {event.monthKey} · King track: {event.kingTrackTitle} · entries{" "}
                      {event.entriesOpenAt ? new Date(event.entriesOpenAt).toLocaleString() : "not set"} →{" "}
                      {event.entriesCloseAt ? new Date(event.entriesCloseAt).toLocaleString() : "not set"}
                      {event.winnerEntryId ? " · winner crowned" : ""}
                    </p>

                    {remixStatusTargets(event.status).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {remixStatusTargets(event.status).map((target) =>
                          target === "cancelled" ? (
                            confirmKey === `cancel:${event.id}` ? (
                              <span key={target} className="inline-flex flex-wrap items-center gap-2">
                                <span className={`text-xs font-semibold ${cls.titleCls}`}>Tap again to cancel the event.</span>
                                <button
                                  type="button"
                                  className={cls.smallBtn}
                                  disabled={act.busy !== null}
                                  onClick={() =>
                                    void act.run(`status:${event.id}`, async () => {
                                      await api.send(adminRemixStatusPath(event.id), "POST", buildRemixStatus("cancelled"));
                                      setConfirmKey(null);
                                      bench.reload();
                                      return "Event cancelled.";
                                    })
                                  }
                                >
                                  <BusyLabel busy={act.busy === `status:${event.id}`}>Cancel for real</BusyLabel>
                                </button>
                                <button type="button" className={cls.smallBtn} onClick={() => setConfirmKey(null)}>
                                  Keep it
                                </button>
                              </span>
                            ) : (
                              <button
                                key={target}
                                type="button"
                                className={cls.smallBtn}
                                onClick={() => setConfirmKey(`cancel:${event.id}`)}
                              >
                                Cancel event
                              </button>
                            )
                          ) : (
                            <button
                              key={target}
                              type="button"
                              className={cls.smallBtn}
                              disabled={act.busy !== null}
                              onClick={() =>
                                void act.run(`status:${event.id}`, async () => {
                                  await api.send(adminRemixStatusPath(event.id), "POST", buildRemixStatus(target));
                                  bench.reload();
                                  return `Event moved to ${target}.`;
                                })
                              }
                            >
                              Move to {target}
                            </button>
                          ),
                        )}
                      </div>
                    ) : null}

                    {event.status === "draft" ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <span className={cls.labelCls}>Edit the draft — splits freeze once the event goes live</span>
                        <RemixEventFields
                          isLight={isLight}
                          draft={draft}
                          onChange={(next) => setEditors((prev) => ({ ...prev, [event.id]: next }))}
                        />
                        <div>
                          <button
                            type="button"
                            className={cls.goldBtn}
                            disabled={act.busy !== null || draftErr !== null}
                            onClick={() =>
                              void act.run(`patch:${event.id}`, async () => {
                                await api.send(adminRemixEventPath(event.id), "PATCH", buildRemixPatchBody(draft));
                                bench.reload();
                                return "Draft saved.";
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `patch:${event.id}`}>Save the draft</BusyLabel>
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {bundle.entries.length > 0 ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <span className={cls.labelCls}>Entries</span>
                        {bundle.entries.map((entry) => (
                          <div key={entry.id} className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs font-bold ${cls.titleCls}`}>
                              {entry.remixTitle} — {entry.entrantName}
                            </span>
                            <StatusPill status={entry.status} isLight={isLight} />
                            <span className={`text-xs ${cls.subCls}`}>{entry.voteCount.toLocaleString()} votes</span>
                            {remixShortlistAvailable(entry) ? (
                              <button
                                type="button"
                                className={cls.smallBtn}
                                disabled={act.busy !== null}
                                onClick={() =>
                                  void act.run(`shortlist:${entry.id}`, async () => {
                                    const next = entry.status !== "shortlisted";
                                    await api.send(
                                      adminRemixShortlistPath(entry.id),
                                      "POST",
                                      buildRemixShortlist(next),
                                    );
                                    bench.reload();
                                    return next ? "Entry shortlisted." : "Entry taken off the shortlist.";
                                  })
                                }
                              >
                                <BusyLabel busy={act.busy === `shortlist:${entry.id}`}>
                                  {entry.status === "shortlisted" ? "Unshortlist" : "Shortlist"}
                                </BusyLabel>
                              </button>
                            ) : null}
                            {remixWinnerAvailable(event) ? (
                              confirmKey === `crown:${entry.id}` ? (
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  <span className={`text-xs font-semibold ${cls.titleCls}`}>Tap again to crown this entry.</span>
                                  <button
                                    type="button"
                                    className={cls.smallBtn}
                                    disabled={act.busy !== null}
                                    onClick={() =>
                                      void act.run(`crown:${entry.id}`, async () => {
                                        await api.send(
                                          adminRemixWinnerPath(event.id),
                                          "POST",
                                          buildRemixWinner(entry.id),
                                        );
                                        setConfirmKey(null);
                                        bench.reload();
                                        return "Winner crowned.";
                                      })
                                    }
                                  >
                                    <BusyLabel busy={act.busy === `crown:${entry.id}`}>Crown for real</BusyLabel>
                                  </button>
                                  <button type="button" className={cls.smallBtn} onClick={() => setConfirmKey(null)}>
                                    Not yet
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={cls.smallBtn}
                                  onClick={() => setConfirmKey(`crown:${entry.id}`)}
                                >
                                  Crown winner
                                </button>
                              )
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {bundle.release ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <span className={cls.labelCls}>Release</span>
                        <p className={`text-xs font-bold ${cls.titleCls}`}>
                          {bundle.release.releaseTitle} — {bundle.release.winnerName}{" "}
                          <StatusPill status={bundle.release.status} isLight={isLight} />
                        </p>
                        {bundle.release.splits.map((s, i) => (
                          <p key={i} className={`text-xs ${cls.subCls}`}>
                            {s.role}: {s.payeeName} — {s.sharePct}%
                          </p>
                        ))}
                        {bundle.payments.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            <span className={cls.labelCls}>Split payments</span>
                            {bundle.payments.map((p) => (
                              <p key={p.id} className={`text-xs ${cls.subCls}`}>
                                {p.payeeName} · {p.role} · {p.amountVb.toLocaleString()} VB · {p.period} · {p.status}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1">
                            <span className={cls.labelCls}>Period (YYYY-MM)</span>
                            <input
                              type="text"
                              className={`${deskInputCls(isLight)} w-32`}
                              value={pay.period}
                              onChange={(e) =>
                                setPayForms((prev) => ({
                                  ...prev,
                                  [bundle.release!.id]: { ...pay, period: e.target.value },
                                }))
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={cls.labelCls}>Total (Visual Bucs)</span>
                            <input
                              type="number"
                              className={`${deskInputCls(isLight)} w-32`}
                              value={pay.total}
                              onChange={(e) =>
                                setPayForms((prev) => ({
                                  ...prev,
                                  [bundle.release!.id]: { ...pay, total: e.target.value },
                                }))
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className={cls.goldBtn}
                            disabled={act.busy !== null || !remixPayReady(pay.period, pay.total)}
                            onClick={() =>
                              void act.run(`pay:${bundle.release!.id}`, async () => {
                                await api.send(
                                  adminRemixSplitPaymentsPath(bundle.release!.id),
                                  "POST",
                                  buildRemixSplitPayments(pay.period, Number(pay.total)),
                                );
                                bench.reload();
                                return `Split payments recorded for ${pay.period}.`;
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pay:${bundle.release.id}`}>Send split payments</BusyLabel>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
            <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
          </div>
        </BenchStates>
      )}
    </BenchSection>
  );
}

/* ─── Palace Drops ───────────────────────────────────────────────── */

export function DropsBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const bench = useBench(async (a) => parseUpcomingDrops(await a.get(DROP_SLATE_PATH), Date.now()));
  const act = useBenchAction();

  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState(() => dropRooms()[0]?.id ?? "");
  const [start, setStart] = useState(() => dropStartInputValue(Date.now()));
  const [duration, setDuration] = useState<number>(
    DROP_DURATION_PRESETS_MIN[1] ?? DROP_DURATION_PRESETS_MIN[0] ?? 60,
  );
  const [amount, setAmount] = useState("100");
  const [claims, setClaims] = useState("10");
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const roomName = (id: string) => dropRooms().find((r) => r.id === id)?.name ?? id;

  const book = () => {
    const built = buildDropBody(
      {
        title,
        roomId,
        startsAtMs: parseDropStartInput(start) ?? NaN,
        durationMin: duration,
        amountVb: Number(amount),
        claimCap: Number(claims),
      },
      Date.now(),
    );
    if (!built.ok) {
      act.setError(dropDraftSentence(built.error));
      return;
    }
    void act.run("book", async () => {
      const { status, data } = await api.call(DROP_BOOK_PATH, "POST", built.body);
      if (status >= 200 && status < 300) {
        setTitle("");
        bench.reload();
        return "Drop booked.";
      }
      const classified = dropBookingError(status, data);
      if (classified.kind === "message") throw new Error(classified.message);
      const key = status === 403 && classified.key === "failed" ? "refusedAdmin" : classified.key;
      throw new Error(dropServerSentence(key));
    });
  };

  return (
    <BenchSection isLight={isLight} title="Palace Drops" blurb="Book Visual Buc drops into palace rooms against the weekly spectacle budget.">
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage="Opening the drops bench…"
        >
          <div className="flex flex-col gap-4">
            <p className={`text-xs ${cls.subCls}`}>
              Drops ride the palace's weekly spectacle budget: {DROP_WEEKLY_BUDGET_VB.toLocaleString()} Visual Bucs a
              week across every drop, {DROP_MIN_AMOUNT_VB}–{DROP_MAX_AMOUNT_VB} Bucs a claim, {DROP_MIN_CLAIMS}–
              {DROP_MAX_CLAIMS} claims a drop. Booking is the house's own job — the rail refuses anyone else.
            </p>

            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>Book a drop</span>
              <label className="flex flex-col gap-1">
                <span className={cls.labelCls}>Title</span>
                <input type="text" className={deskInputCls(isLight)} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>Room</span>
                  <select className={cls.selectCls} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    {dropRooms().map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>Starts</span>
                  <input type="datetime-local" className={deskInputCls(isLight)} value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>Length</span>
                  <select className={cls.selectCls} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    {DROP_DURATION_PRESETS_MIN.map((min) => (
                      <option key={min} value={min}>
                        {min} minutes
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>Visual Bucs per claim</span>
                  <input type="number" className={deskInputCls(isLight)} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>Claims</span>
                  <input type="number" className={deskInputCls(isLight)} value={claims} onChange={(e) => setClaims(e.target.value)} />
                </label>
              </div>
              <div>
                <button type="button" className={cls.goldBtn} disabled={act.busy !== null} onClick={book}>
                  <BusyLabel busy={act.busy === "book"}>Book the drop</BusyLabel>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>On the slate</span>
              {bench.data && bench.data.length === 0 ? (
                <NativeEmptyState isLight={isLight} message="No drops on the slate." />
              ) : (
                bench.data?.map((drop) => (
                  <div key={drop.id} className={cls.rowCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-bold ${cls.titleCls}`}>{drop.title}</span>
                      <StatusPill status={drop.status} isLight={isLight} />
                    </div>
                    <p className={`mt-1 text-xs ${cls.subCls}`}>
                      {roomName(drop.roomId)} · hosted by {drop.hostName} · {new Date(drop.startsAt).toLocaleString()} →{" "}
                      {new Date(drop.endsAt).toLocaleString()} · {drop.amountVb.toLocaleString()} VB × {drop.claimCap} claims
                    </p>
                    <div className="mt-2">
                      {confirmCancel === drop.id ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-semibold ${cls.titleCls}`}>Tap again to cancel this drop.</span>
                          <button
                            type="button"
                            className={cls.smallBtn}
                            disabled={act.busy !== null}
                            onClick={() =>
                              void act.run(`cancel:${drop.id}`, async () => {
                                await api.send(dropCancelPath(drop.id), "DELETE");
                                setConfirmCancel(null);
                                bench.reload();
                                return "Drop cancelled.";
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `cancel:${drop.id}`}>Cancel for real</BusyLabel>
                          </button>
                          <button type="button" className={cls.smallBtn} onClick={() => setConfirmCancel(null)}>
                            Keep it
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={cls.smallBtn} onClick={() => setConfirmCancel(drop.id)}>
                          Cancel drop
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
          </div>
        </BenchStates>
      )}
    </BenchSection>
  );
}
