import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
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

function prizeDraftSentence(t: TFunction, key: string): string {
  switch (key) {
    case "empty":
      return t("worldAdminDesk.prizeErrEmpty");
    case "placeRange":
      return t("worldAdminDesk.prizeErrPlaceRange");
    case "placeDuplicate":
      return t("worldAdminDesk.prizeErrPlaceDuplicate");
    case "amountWhole":
      return t("worldAdminDesk.prizeErrAmountWhole");
    case "amountMultiple":
      return t("worldAdminDesk.prizeErrAmountMultiple");
    case "amountRange":
      return t("worldAdminDesk.prizeErrAmountRange");
    case "overCap":
      return t("worldAdminDesk.prizeErrOverCap");
    default:
      return t("worldAdminDesk.prizeErrDefault");
  }
}

function splitDraftSentence(t: TFunction, key: string): string {
  switch (key) {
    case "empty":
      return t("worldAdminDesk.splitErrEmpty");
    case "tooMany":
      return t("worldAdminDesk.splitErrTooMany");
    case "roleUnknown":
      return t("worldAdminDesk.splitErrRoleUnknown");
    case "roleDuplicate":
      return t("worldAdminDesk.splitErrRoleDuplicate");
    case "nameMissing":
      return t("worldAdminDesk.splitErrNameMissing");
    case "shareRange":
      return t("worldAdminDesk.splitErrShareRange");
    case "winnerMissing":
      return t("worldAdminDesk.splitErrWinnerMissing");
    case "sumNot100":
      return t("worldAdminDesk.splitErrSum");
    default:
      return t("worldAdminDesk.splitErrDefault");
  }
}

function dropDraftSentence(t: TFunction, key: string): string {
  switch (key) {
    case "titleRequired":
      return t("worldAdminDesk.dropErrTitleRequired");
    case "titleTooLong":
      return t("worldAdminDesk.dropErrTitleTooLong");
    case "roomUnknown":
      return t("worldAdminDesk.dropErrRoomUnknown");
    case "amountRange":
      return t("worldAdminDesk.dropErrAmountRange", {
        min: DROP_MIN_AMOUNT_VB,
        max: DROP_MAX_AMOUNT_VB,
      });
    case "claimRange":
      return t("worldAdminDesk.dropErrClaimRange", { min: DROP_MIN_CLAIMS, max: DROP_MAX_CLAIMS });
    case "durationTooShort":
    case "durationTooLong":
      return t("worldAdminDesk.dropErrDuration");
    case "startRequired":
      return t("worldAdminDesk.dropErrStartRequired");
    case "startPast":
      return t("worldAdminDesk.dropErrStartPast");
    case "startTooFar":
      return t("worldAdminDesk.dropErrStartTooFar");
    default:
      return t("worldAdminDesk.dropErrDefault");
  }
}

function dropServerSentence(t: TFunction, key: string): string {
  switch (key) {
    case "refusedAdmin":
      return t("worldAdminDesk.dropSrvRefused");
    case "slotTaken":
      return t("worldAdminDesk.dropSrvSlotTaken");
    case "signIn":
      return t("worldAdminDesk.dropSrvSignIn");
    default:
      return t("worldAdminDesk.dropSrvFailed");
  }
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/* ─── Challenges ─────────────────────────────────────────────────── */

export function ChallengesBench({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
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
        setDetailFail(plainErrorText(e, t("worldAdminDesk.challengesOpenFailed")));
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
    <BenchSection isLight={isLight} title={t("worldAdminDesk.challengesTitle")} blurb={t("worldAdminDesk.challengesBlurb")}>
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage={t("worldAdminDesk.challengesLoading")}
        >
          <div className="flex flex-col gap-3">
            {bench.data && bench.data.length === 0 ? (
              <NativeEmptyState isLight={isLight} message={t("worldAdminDesk.challengesEmpty")} />
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
                      <span className={`text-[11px] font-bold ${cls.subCls}`}>{t("worldAdminDesk.challengesCrowned")}</span>
                    ) : null}
                  </span>
                  <span className={`mt-1 block text-xs ${cls.subCls}`}>
                    {t("worldAdminDesk.challengesRowLine", {
                      hashtag: row.hashtag,
                      entries: row.entryCount,
                      pool: row.prizePoolCredits.toLocaleString(i18n.language),
                      start: row.startsAt
                        ? t("worldAdminDesk.challengesStartsWhen", {
                            date: new Date(row.startsAt).toLocaleString(i18n.language),
                          })
                        : t("worldAdminDesk.challengesNoStart"),
                    })}
                  </span>
                </button>
              ))
            )}

            {selected ? (
              <div className={`rounded-xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                {detailPhase === "loading" ? (
                  <p className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.challengesOpening")}</p>
                ) : detailPhase === "denied" ? (
                  <BenchDenied isLight={isLight} />
                ) : detailPhase === "failed" ? (
                  <p className={`text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                    {detailFail}{" "}
                    <button type="button" className="underline" onClick={() => void loadDetail(selected)}>
                      {t("worldAdminDesk.tryAgain")}
                    </button>
                  </p>
                ) : detail ? (
                  <div className="flex flex-col gap-4">
                    <p className={`text-sm font-bold ${cls.titleCls}`}>
                      {t("worldAdminDesk.challengesDetailLine", {
                        title: detail.title,
                        entries: detail.entryCount,
                        pool: detail.prizePoolCredits.toLocaleString(i18n.language),
                      })}
                    </p>

                    {/* lifecycle */}
                    <div className="flex flex-col gap-2">
                      <span className={cls.labelCls}>{t("worldAdminDesk.challengesLifecycle")}</span>
                      {selectedRow && challengeLifecycleTargets(selectedRow).length > 0 ? (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <select
                              aria-label={t("worldAdminDesk.challengesStatusAria")}
                              className={cls.selectCls}
                              value={lifeStatus}
                              onChange={(e) => setLifeStatus(e.target.value)}
                            >
                              <option value="">{t("worldAdminDesk.challengesLeaveStatus")}</option>
                              {challengeLifecycleTargets(selectedRow).map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="flex flex-col gap-1">
                              <span className={cls.labelCls}>{t("worldAdminDesk.challengesStartsLabel")}</span>
                              <input type="datetime-local" className={deskInputCls(isLight)} value={starts} onChange={(e) => setStarts(e.target.value)} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className={cls.labelCls}>{t("worldAdminDesk.challengesEndsLabel")}</span>
                              <input type="datetime-local" className={deskInputCls(isLight)} value={ends} onChange={(e) => setEnds(e.target.value)} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className={cls.labelCls}>{t("worldAdminDesk.challengesJudgingEndsLabel")}</span>
                              <input type="datetime-local" className={deskInputCls(isLight)} value={judgingEnds} onChange={(e) => setJudgingEnds(e.target.value)} />
                            </label>
                          </div>
                          <p className={`text-[11px] ${cls.subCls}`}>
                            {t("worldAdminDesk.challengesDateNote")}
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
                                  return t("worldAdminDesk.challengesLifecycleSaved");
                                })
                              }
                            >
                              <BusyLabel busy={act.busy === "lifecycle"}>{t("worldAdminDesk.challengesSaveLifecycle")}</BusyLabel>
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className={`text-xs ${cls.subCls}`}>
                          {t("worldAdminDesk.challengesLifecycleClosed")}
                        </p>
                      )}
                    </div>

                    {/* prizes */}
                    <div className="flex flex-col gap-2">
                      <span className={cls.labelCls}>{t("worldAdminDesk.challengesPrizes")}</span>
                      {prizes.map((row, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1">
                            <span className={cls.labelCls}>{t("worldAdminDesk.challengesPlace")}</span>
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
                            <span className={cls.labelCls}>{t("worldAdminDesk.challengesVisualBucs")}</span>
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
                            <span className={cls.labelCls}>{t("worldAdminDesk.challengesDescription")}</span>
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
                            {t("worldAdminDesk.removeButton")}
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
                          {t("worldAdminDesk.challengesAddPrize")}
                        </button>
                        <span className={`text-xs ${cls.subCls}`}>
                          {t("worldAdminDesk.challengesPoolTotal", {
                            total: prizeTotal.toLocaleString(i18n.language),
                            cap: CHALLENGE_PRIZE_POOL_CAP_VB.toLocaleString(i18n.language),
                          })}
                        </span>
                      </div>
                      {prizeError ? (
                        <p className={`text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                          {prizeDraftSentence(t, prizeError)}
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
                              return t("worldAdminDesk.challengesPrizesSaved");
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === "prizes"}>{t("worldAdminDesk.challengesSavePrizes")}</BusyLabel>
                        </button>
                      </div>
                    </div>

                    {/* judging */}
                    <div className="flex flex-col gap-2">
                      <span className={cls.labelCls}>{t("worldAdminDesk.challengesJudging")}</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={judgeMode === "votes" ? cls.goldBtn : cls.ghostBtn}
                          onClick={() => setJudgeMode("votes")}
                        >
                          {t("worldAdminDesk.challengesCrownVotes")}
                        </button>
                        <button
                          type="button"
                          className={judgeMode === "picks" ? cls.goldBtn : cls.ghostBtn}
                          onClick={() => setJudgeMode("picks")}
                        >
                          {t("worldAdminDesk.challengesPickHand")}
                        </button>
                      </div>
                      {judgeMode === "votes" ? (
                        <label className="flex flex-col gap-1">
                          <span className={cls.labelCls}>{t("worldAdminDesk.challengesPlacesLabel")}</span>
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
                              <span className={cls.labelCls}>{t("worldAdminDesk.challengesPlaceN", { place })}</span>
                              <select
                                className={cls.selectCls}
                                value={picks[place] ?? ""}
                                onChange={(e) => setPicks((prev) => ({ ...prev, [place]: e.target.value }))}
                              >
                                <option value="">{t("worldAdminDesk.challengesNoPick")}</option>
                                {detail.entries.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {t("worldAdminDesk.challengesEntryOption", {
                                      title: entry.title,
                                      creator: entry.creatorName,
                                      votes: entry.voteCount,
                                    })}
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
                            {t("worldAdminDesk.challengesJudgeConfirm")}
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
                                  throw new Error(t("worldAdminDesk.challengesJudgeUnreadable"));
                                }
                                setJudgeResult(parsed);
                                setConfirmJudge(false);
                                await reloadAll();
                                return t("worldAdminDesk.challengesJudged");
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === "judge"}>{t("worldAdminDesk.challengesJudgeNow")}</BusyLabel>
                          </button>
                          <button type="button" className={cls.ghostBtn} onClick={() => setConfirmJudge(false)}>
                            {t("worldAdminDesk.notYet")}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button type="button" className={cls.goldBtn} onClick={() => setConfirmJudge(true)}>
                            {t("worldAdminDesk.challengesJudgeButton")}
                          </button>
                        </div>
                      )}
                      {judgeResult ? (
                        <div className={cls.rowCls}>
                          <p className={`text-xs font-bold ${cls.titleCls}`}>
                            {t("worldAdminDesk.challengesPaidLine", {
                              paid: judgeResult.paid,
                              alreadyPaid: judgeResult.alreadyPaid,
                              weeklyPaid: judgeResult.weeklyPaidVb.toLocaleString(i18n.language),
                              weeklyCap: judgeResult.weeklyCapVb.toLocaleString(i18n.language),
                            })}
                          </p>
                          {judgeResult.winners.map((w) => (
                            <p key={w.place} className={`mt-1 text-xs ${cls.subCls}`}>
                              {t("worldAdminDesk.challengesWinnerLine", {
                                place: w.place,
                                credits: w.prizeCredits.toLocaleString(i18n.language),
                              })}
                              {w.paidAt
                                ? t("worldAdminDesk.challengesPaidAt", {
                                    date: new Date(w.paidAt).toLocaleString(i18n.language),
                                  })
                                : t("worldAdminDesk.challengesNotPaid")}
                            </p>
                          ))}
                          {judgeResult.budgetCapped.length > 0 ? (
                            <p className={`mt-1 text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                              {t("worldAdminDesk.challengesCapped", { list: judgeResult.budgetCapped.join(", ") })}
                            </p>
                          ) : null}
                          {judgeResult.payoutErrors.length > 0 ? (
                            <p className={`mt-1 text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
                              {t("worldAdminDesk.challengesPayoutProblems", { list: judgeResult.payoutErrors.join(" · ") })}
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
  const { t, i18n } = useTranslation();
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
      act.setError(t("worldAdminDesk.grantsOpenErrMonth"));
      return;
    }
    const converted = [
      windows.submissionsOpenAt,
      windows.submissionsCloseAt,
      windows.votingOpenAt,
      windows.votingCloseAt,
    ].map(localInputToIso);
    if (converted.some((v) => v === null)) {
      act.setError(t("worldAdminDesk.grantsOpenErrWindows"));
      return;
    }
    void act.run("open", async () => {
      await api.send(
        ADMIN_GRANT_ROUNDS_PATH,
        "POST",
        buildGrantRoundBody({ monthKey, poolVb: Number(pool), windows }),
      );
      bench.reload();
      return t("worldAdminDesk.grantsOpened", { month: monthKey });
    });
  };

  const windowFields = (
    value: GrantWindows,
    onChange: (next: GrantWindows) => void,
  ) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {(
        [
          ["submissionsOpenAt", t("worldAdminDesk.grantsWinSubOpen")],
          ["submissionsCloseAt", t("worldAdminDesk.grantsWinSubClose")],
          ["votingOpenAt", t("worldAdminDesk.grantsWinVoteOpen")],
          ["votingCloseAt", t("worldAdminDesk.grantsWinVoteClose")],
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
    <BenchSection isLight={isLight} title={t("worldAdminDesk.grantsTitle")} blurb={t("worldAdminDesk.grantsBlurb")}>
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage={t("worldAdminDesk.grantsLoading")}
        >
          <div className="flex flex-col gap-4">
            {current ? (
              <div className={cls.rowCls}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-bold ${cls.titleCls}`}>{t("worldAdminDesk.grantsRoundTitle", { month: current.round.monthKey })}</span>
                  <StatusPill status={current.phase} isLight={isLight} />
                  <StatusPill status={current.round.resultStatus} isLight={isLight} />
                </div>
                <p className={`mt-1 text-xs ${cls.subCls}`}>
                  {t("worldAdminDesk.grantsPoolLine", {
                    pool: current.round.poolVb.toLocaleString(i18n.language),
                    candidates: current.candidates.length,
                    votes: current.totalVotes.toLocaleString(i18n.language),
                  })}
                </p>
                {current.candidates.map((c) => (
                  <div key={c.id} className="mt-2">
                    <p className={`text-xs font-bold ${cls.titleCls}`}>
                      {t("worldAdminDesk.grantsCandidateLine", {
                        name: c.creatorName,
                        title: c.title,
                        winner: c.isWinner ? t("worldAdminDesk.grantsWinnerChip") : "",
                        votes: c.votes.toLocaleString(i18n.language),
                      })}
                    </p>
                    {c.reportBack ? (
                      <p className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.grantsReportBack", { text: c.reportBack })}</p>
                    ) : c.reportBackOwed ? (
                      <p className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.grantsReportOwed")}</p>
                    ) : null}
                  </div>
                ))}

                {editWindows ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <span className={cls.labelCls}>{t("worldAdminDesk.grantsWindows")}</span>
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
                              return t("worldAdminDesk.grantsWindowsSaved");
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === "windows"}>{t("worldAdminDesk.grantsSaveWindows")}</BusyLabel>
                        </button>
                      </div>
                    ) : (
                      <p className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.grantsWindowsLocked")}</p>
                    )}
                  </div>
                ) : null}

                {grantSettleAvailable(current) ? (
                  <div className="mt-3">
                    {confirmSettle ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs font-semibold ${cls.titleCls}`}>
                          {t("worldAdminDesk.grantsSettleConfirm")}
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
                                throw new Error(t("worldAdminDesk.grantsSettleUnreadable"));
                              }
                              setConfirmSettle(false);
                              bench.reload();
                              return outcome.amountVb !== null
                                ? t("worldAdminDesk.grantsSettledPaid", {
                                    amount: outcome.amountVb.toLocaleString(i18n.language),
                                  })
                                : t("worldAdminDesk.grantsSettledOutcome", { outcome: outcome.outcome });
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === "settle"}>{t("worldAdminDesk.grantsSettleNow")}</BusyLabel>
                        </button>
                        <button type="button" className={cls.ghostBtn} onClick={() => setConfirmSettle(false)}>
                          {t("worldAdminDesk.notYet")}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={cls.goldBtn} onClick={() => setConfirmSettle(true)}>
                        {t("worldAdminDesk.grantsSettleButton")}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <NativeEmptyState isLight={isLight} message={t("worldAdminDesk.grantsEmpty")} />
            )}

            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>{t("worldAdminDesk.grantsOpenTitle")}</span>
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>{t("worldAdminDesk.monthLabel")}</span>
                  <input
                    type="text"
                    className={`${deskInputCls(isLight)} w-36`}
                    value={monthKey}
                    onChange={(e) => setMonthKey(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>{t("worldAdminDesk.grantsPoolLabel")}</span>
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
                  <BusyLabel busy={act.busy === "open"}>{t("worldAdminDesk.grantsOpenButton")}</BusyLabel>
                </button>
              </div>
            </div>

            {bench.data && bench.data.past.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className={cls.labelCls}>{t("worldAdminDesk.grantsPastTitle")}</span>
                {bench.data.past.map((past) => {
                  const winner = past.candidates.find((c) => c.isWinner);
                  return (
                    <div key={past.round.id} className={cls.rowCls}>
                      <p className={`text-xs font-bold ${cls.titleCls}`}>
                        {t("worldAdminDesk.grantsPastLine", {
                          month: past.round.monthKey,
                          pool: past.round.poolVb.toLocaleString(i18n.language),
                          phase: past.phase,
                        })}
                        {winner ? t("worldAdminDesk.grantsWonBy", { name: winner.creatorName }) : ""}
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
  const { t } = useTranslation();
  const cls = adminCls(isLight);
  const err = splitDraftError(splits);
  return (
    <div className="flex flex-col gap-2">
      <span className={cls.labelCls}>{t("worldAdminDesk.remixSplits")}</span>
      {splits.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={cls.labelCls}>{t("worldAdminDesk.remixRole")}</span>
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
            <span className={cls.labelCls}>{t("worldAdminDesk.remixPayeeName")}</span>
            <input
              type="text"
              className={`${deskInputCls(isLight)} w-40`}
              value={row.payeeName}
              onChange={(e) => onChange(splits.map((s, j) => (j === i ? { ...s, payeeName: e.target.value } : s)))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={cls.labelCls}>{t("worldAdminDesk.remixPayeeAccount")}</span>
            <input
              type="text"
              className={`${deskInputCls(isLight)} w-40`}
              value={row.payeeUserId}
              onChange={(e) => onChange(splits.map((s, j) => (j === i ? { ...s, payeeUserId: e.target.value } : s)))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={cls.labelCls}>{t("worldAdminDesk.remixShare")}</span>
            <input
              type="number"
              className={`${deskInputCls(isLight)} w-24`}
              value={row.sharePct}
              onChange={(e) => onChange(splits.map((s, j) => (j === i ? { ...s, sharePct: e.target.value } : s)))}
            />
          </label>
          <button type="button" className={cls.smallBtn} onClick={() => onChange(splits.filter((_, j) => j !== i))}>
            {t("worldAdminDesk.removeButton")}
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
          {t("worldAdminDesk.remixAddSplit")}
        </button>
        <span className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.remixSplitsTotal", { sum: splitDraftSum(splits) })}</span>
      </div>
      {err ? (
        <p className={`text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
          {splitDraftSentence(t, err)}
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
  const { t } = useTranslation();
  const cls = adminCls(isLight);
  const set = (patch: Partial<RemixEventDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>{t("worldAdminDesk.remixEventTitle")}</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>{t("worldAdminDesk.remixKingTrack")}</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.kingTrackTitle} onChange={(e) => set({ kingTrackTitle: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>{t("worldAdminDesk.remixKingAudio")}</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.kingTrackAudioUrl} onChange={(e) => set({ kingTrackAudioUrl: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>{t("worldAdminDesk.remixKingStems")}</span>
          <input type="text" className={deskInputCls(isLight)} value={draft.kingTrackStemsUrl} onChange={(e) => set({ kingTrackStemsUrl: e.target.value })} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={cls.labelCls}>{t("worldAdminDesk.remixDescription")}</span>
        <textarea className={deskInputCls(isLight)} rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>{t("worldAdminDesk.remixEntriesOpen")}</span>
          <input type="datetime-local" className={deskInputCls(isLight)} value={draft.entriesOpenAt} onChange={(e) => set({ entriesOpenAt: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cls.labelCls}>{t("worldAdminDesk.remixEntriesClose")}</span>
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
  const { t, i18n } = useTranslation();
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
    <BenchSection isLight={isLight} title={t("worldAdminDesk.remixTitle")} blurb={t("worldAdminDesk.remixBlurb")}>
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage={t("worldAdminDesk.remixLoading")}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>{t("worldAdminDesk.remixNewEvent")}</span>
              <label className="flex flex-col gap-1">
                <span className={cls.labelCls}>{t("worldAdminDesk.monthLabel")}</span>
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
                      return t("worldAdminDesk.remixCreated", { month: createMonth });
                    })
                  }
                >
                  <BusyLabel busy={act.busy === "create"}>{t("worldAdminDesk.remixCreateButton")}</BusyLabel>
                </button>
              </div>
            </div>

            {bench.data && bench.data.length === 0 ? (
              <NativeEmptyState isLight={isLight} message={t("worldAdminDesk.remixEmpty")} />
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
                      {t("worldAdminDesk.remixEventMeta", {
                        month: event.monthKey,
                        track: event.kingTrackTitle,
                        open: event.entriesOpenAt
                          ? new Date(event.entriesOpenAt).toLocaleString(i18n.language)
                          : t("worldAdminDesk.remixNotSet"),
                        close: event.entriesCloseAt
                          ? new Date(event.entriesCloseAt).toLocaleString(i18n.language)
                          : t("worldAdminDesk.remixNotSet"),
                      })}
                      {event.winnerEntryId ? t("worldAdminDesk.remixWinnerCrowned") : ""}
                    </p>

                    {remixStatusTargets(event.status).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {remixStatusTargets(event.status).map((target) =>
                          target === "cancelled" ? (
                            confirmKey === `cancel:${event.id}` ? (
                              <span key={target} className="inline-flex flex-wrap items-center gap-2">
                                <span className={`text-xs font-semibold ${cls.titleCls}`}>{t("worldAdminDesk.remixCancelConfirm")}</span>
                                <button
                                  type="button"
                                  className={cls.smallBtn}
                                  disabled={act.busy !== null}
                                  onClick={() =>
                                    void act.run(`status:${event.id}`, async () => {
                                      await api.send(adminRemixStatusPath(event.id), "POST", buildRemixStatus("cancelled"));
                                      setConfirmKey(null);
                                      bench.reload();
                                      return t("worldAdminDesk.remixCancelled");
                                    })
                                  }
                                >
                                  <BusyLabel busy={act.busy === `status:${event.id}`}>{t("worldAdminDesk.cancelForReal")}</BusyLabel>
                                </button>
                                <button type="button" className={cls.smallBtn} onClick={() => setConfirmKey(null)}>
                                  {t("worldAdminDesk.keepIt")}
                                </button>
                              </span>
                            ) : (
                              <button
                                key={target}
                                type="button"
                                className={cls.smallBtn}
                                onClick={() => setConfirmKey(`cancel:${event.id}`)}
                              >
                                {t("worldAdminDesk.remixCancelEvent")}
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
                                  return t("worldAdminDesk.remixMovedTo", { status: target });
                                })
                              }
                            >
                              {t("worldAdminDesk.remixMoveTo", { status: target })}
                            </button>
                          ),
                        )}
                      </div>
                    ) : null}

                    {event.status === "draft" ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <span className={cls.labelCls}>{t("worldAdminDesk.remixEditNote")}</span>
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
                                return t("worldAdminDesk.remixDraftSaved");
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `patch:${event.id}`}>{t("worldAdminDesk.remixSaveDraft")}</BusyLabel>
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {bundle.entries.length > 0 ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <span className={cls.labelCls}>{t("worldAdminDesk.remixEntries")}</span>
                        {bundle.entries.map((entry) => (
                          <div key={entry.id} className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs font-bold ${cls.titleCls}`}>
                              {entry.remixTitle} — {entry.entrantName}
                            </span>
                            <StatusPill status={entry.status} isLight={isLight} />
                            <span className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.remixVotes", { count: entry.voteCount.toLocaleString(i18n.language) })}</span>
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
                                    return next
                                      ? t("worldAdminDesk.remixShortlisted")
                                      : t("worldAdminDesk.remixUnshortlisted");
                                  })
                                }
                              >
                                <BusyLabel busy={act.busy === `shortlist:${entry.id}`}>
                                  {entry.status === "shortlisted"
                                    ? t("worldAdminDesk.remixUnshortlist")
                                    : t("worldAdminDesk.remixShortlist")}
                                </BusyLabel>
                              </button>
                            ) : null}
                            {remixWinnerAvailable(event) ? (
                              confirmKey === `crown:${entry.id}` ? (
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  <span className={`text-xs font-semibold ${cls.titleCls}`}>{t("worldAdminDesk.remixCrownConfirm")}</span>
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
                                        return t("worldAdminDesk.remixCrowned");
                                      })
                                    }
                                  >
                                    <BusyLabel busy={act.busy === `crown:${entry.id}`}>{t("worldAdminDesk.remixCrownReal")}</BusyLabel>
                                  </button>
                                  <button type="button" className={cls.smallBtn} onClick={() => setConfirmKey(null)}>
                                    {t("worldAdminDesk.notYet")}
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={cls.smallBtn}
                                  onClick={() => setConfirmKey(`crown:${entry.id}`)}
                                >
                                  {t("worldAdminDesk.remixCrown")}
                                </button>
                              )
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {bundle.release ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <span className={cls.labelCls}>{t("worldAdminDesk.remixRelease")}</span>
                        <p className={`text-xs font-bold ${cls.titleCls}`}>
                          {bundle.release.releaseTitle} — {bundle.release.winnerName}{" "}
                          <StatusPill status={bundle.release.status} isLight={isLight} />
                        </p>
                        {bundle.release.splits.map((s, i) => (
                          <p key={i} className={`text-xs ${cls.subCls}`}>
                            {t("worldAdminDesk.remixSplitLine", { role: s.role, name: s.payeeName, share: s.sharePct })}
                          </p>
                        ))}
                        {bundle.payments.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            <span className={cls.labelCls}>{t("worldAdminDesk.remixSplitPayments")}</span>
                            {bundle.payments.map((p) => (
                              <p key={p.id} className={`text-xs ${cls.subCls}`}>
                                {t("worldAdminDesk.remixPaymentLine", {
                                  name: p.payeeName,
                                  role: p.role,
                                  amount: p.amountVb.toLocaleString(i18n.language),
                                  period: p.period,
                                  status: p.status,
                                })}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1">
                            <span className={cls.labelCls}>{t("worldAdminDesk.remixPeriodLabel")}</span>
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
                            <span className={cls.labelCls}>{t("worldAdminDesk.remixTotalLabel")}</span>
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
                                return t("worldAdminDesk.remixSplitRecorded", { period: pay.period });
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pay:${bundle.release.id}`}>{t("worldAdminDesk.remixSendSplit")}</BusyLabel>
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
  const { t, i18n } = useTranslation();
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
      act.setError(dropDraftSentence(t, built.error));
      return;
    }
    void act.run("book", async () => {
      const { status, data } = await api.call(DROP_BOOK_PATH, "POST", built.body);
      if (status >= 200 && status < 300) {
        setTitle("");
        bench.reload();
        return t("worldAdminDesk.dropsBooked");
      }
      const classified = dropBookingError(status, data);
      if (classified.kind === "message") throw new Error(apiErrorMessage(data, dropServerSentence(t, "failed")));
      const key = status === 403 && classified.key === "failed" ? "refusedAdmin" : classified.key;
      throw new Error(dropServerSentence(t, key));
    });
  };

  return (
    <BenchSection isLight={isLight} title={t("worldAdminDesk.dropsTitle")} blurb={t("worldAdminDesk.dropsBlurb")}>
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates
          isLight={isLight}
          phase={bench.phase}
          failMessage={bench.failMessage}
          onRetry={bench.reload}
          loadingMessage={t("worldAdminDesk.dropsLoading")}
        >
          <div className="flex flex-col gap-4">
            <p className={`text-xs ${cls.subCls}`}>
              {t("worldAdminDesk.dropsBudgetLine", {
                budget: DROP_WEEKLY_BUDGET_VB.toLocaleString(i18n.language),
                minAmount: DROP_MIN_AMOUNT_VB,
                maxAmount: DROP_MAX_AMOUNT_VB,
                minClaims: DROP_MIN_CLAIMS,
                maxClaims: DROP_MAX_CLAIMS,
              })}
            </p>

            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>{t("worldAdminDesk.dropsBookTitle")}</span>
              <label className="flex flex-col gap-1">
                <span className={cls.labelCls}>{t("worldAdminDesk.dropsTitleLabel")}</span>
                <input type="text" className={deskInputCls(isLight)} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>{t("worldAdminDesk.dropsRoom")}</span>
                  <select className={cls.selectCls} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    {dropRooms().map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>{t("worldAdminDesk.dropsStarts")}</span>
                  <input type="datetime-local" className={deskInputCls(isLight)} value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>{t("worldAdminDesk.dropsLength")}</span>
                  <select className={cls.selectCls} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    {DROP_DURATION_PRESETS_MIN.map((min) => (
                      <option key={min} value={min}>
                        {t("worldAdminDesk.dropsMinutes", { count: min })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>{t("worldAdminDesk.dropsPerClaim")}</span>
                  <input type="number" className={deskInputCls(isLight)} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={cls.labelCls}>{t("worldAdminDesk.dropsClaims")}</span>
                  <input type="number" className={deskInputCls(isLight)} value={claims} onChange={(e) => setClaims(e.target.value)} />
                </label>
              </div>
              <div>
                <button type="button" className={cls.goldBtn} disabled={act.busy !== null} onClick={book}>
                  <BusyLabel busy={act.busy === "book"}>{t("worldAdminDesk.dropsBookButton")}</BusyLabel>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={cls.labelCls}>{t("worldAdminDesk.dropsSlate")}</span>
              {bench.data && bench.data.length === 0 ? (
                <NativeEmptyState isLight={isLight} message={t("worldAdminDesk.dropsEmpty")} />
              ) : (
                bench.data?.map((drop) => (
                  <div key={drop.id} className={cls.rowCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-bold ${cls.titleCls}`}>{drop.title}</span>
                      <StatusPill status={drop.status} isLight={isLight} />
                    </div>
                    <p className={`mt-1 text-xs ${cls.subCls}`}>
                      {t("worldAdminDesk.dropsMeta", {
                        room: roomName(drop.roomId),
                        host: drop.hostName,
                        start: new Date(drop.startsAt).toLocaleString(i18n.language),
                        end: new Date(drop.endsAt).toLocaleString(i18n.language),
                        amount: drop.amountVb.toLocaleString(i18n.language),
                        claims: drop.claimCap,
                      })}
                    </p>
                    <div className="mt-2">
                      {confirmCancel === drop.id ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-semibold ${cls.titleCls}`}>{t("worldAdminDesk.dropsCancelConfirm")}</span>
                          <button
                            type="button"
                            className={cls.smallBtn}
                            disabled={act.busy !== null}
                            onClick={() =>
                              void act.run(`cancel:${drop.id}`, async () => {
                                await api.send(dropCancelPath(drop.id), "DELETE");
                                setConfirmCancel(null);
                                bench.reload();
                                return t("worldAdminDesk.dropsCancelled");
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `cancel:${drop.id}`}>{t("worldAdminDesk.cancelForReal")}</BusyLabel>
                          </button>
                          <button type="button" className={cls.smallBtn} onClick={() => setConfirmCancel(null)}>
                            {t("worldAdminDesk.keepIt")}
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={cls.smallBtn} onClick={() => setConfirmCancel(drop.id)}>
                          {t("worldAdminDesk.dropsCancel")}
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
