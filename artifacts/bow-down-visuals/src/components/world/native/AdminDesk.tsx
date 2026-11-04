import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
} from "@/components/world/native/NativeStates";
import { deskInputCls } from "@/components/world/native/CreateDeskLeaf";
import {
  BenchDenied,
  BenchOutcome,
  BenchSection,
  BenchStates,
  BusyLabel,
  StatusPill,
  adminCls,
  useAdminApi,
  useBench,
  useBenchAction,
} from "@/components/world/native/AdminBenchBits";
import {
  ChallengesBench,
  DropsBench,
  GrantsBench,
  RemixBench,
} from "@/components/world/native/AdminProgramDesk";
import {
  BowBench,
  ContactBench,
  DiscordBench,
  GearBench,
  OperatorBench,
  OrdersBench,
  ReversalsBench,
  SpotlightBench,
  UsersBench,
} from "@/components/world/native/AdminOpsDesk";
import {
  ADMIN_DMCA_PATH,
  ADMIN_PITCH_FIX_PROCESS_PATH,
  ADMIN_PITCH_FIX_QUEUE_PATH,
  ADMIN_REMOVED_CONTENT_PATH,
  ADMIN_REPORTS_PATH,
  ADMIN_STATUS_PATH,
  REMOVAL_REASONS,
  adminContentPath,
  adminDmcaPath,
  adminPitchFixPath,
  adminReportPath,
  buildContentRemovalPatch,
  buildPitchFixDuplicate,
  buildPitchFixModeration,
  buildPitchFixStatus,
  buildStatusPatch,
  openReports,
  parseAdminStatus,
  parseContentAnswer,
  parseContentId,
  parseContentReports,
  parseDmcaReports,
  parsePitchFixQueue,
  parseRemovedContent,
  pitchFixPending,
  pitchFixStatusesFor,
  shortId,
  DMCA_STATUSES,
  REPORT_STATUSES,
  type AdminContentState,
  type ContentReportRow,
  type DmcaReportRow,
  type PitchFixRow,
} from "@/lib/world/admin-desk";

/* ─── The Admin Benches, in-world (stack1500 world parity, wave
   #5 item 46) ─────────────────────────────────────────────────────
   Census feature `admin`: the in-World admin CONTROLS existed
   (operator command authority); the /admin BENCHES did not. This
   desk family is the benches' native form, stacked at the My
   Studio board — every bench riding the website page's own
   /api/admin rails in the page's own shapes, through the seam in
   lib/world/admin-desk.ts (which re-exports the shared strict
   parsers of lib/admin-benches.ts for the benches that have them).

   THE GATE: the desk opens with the one probe pages/admin.tsx
   itself uses — GET /api/admin/status, answered server-side from
   the ADMIN_EMAILS allowlist (fail-closed). The benches render
   only on an exact `true`. A signed-in non-admin gets the
   not-authorized state in the rail's own words and NO bench rail
   is ever called; a bench rail that answers 403 mid-session
   flips that bench to the same state. The desk never reads an
   email, never mirrors the allowlist, never widens the gate —
   enforcement stays exactly where the rails keep it.

   Each bench loads lazily when its section first opens and fails
   on its own: one bad bench never takes the desk down. Errors
   travel only the shared plain-text rail. No bench charges: the
   registry has no /api/admin rows and the desk invents none —
   the money on screen is the rails' own (grants, pools, payouts),
   rendered from rail data. ────────────────────────────────────── */

type GatePhase = "loading" | "denied" | "failed" | "ready";

export function AdminDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [phase, setPhase] = useState<GatePhase>("loading");
  const [failMessage, setFailMessage] = useState("");

  const probe = useCallback(async () => {
    setPhase("loading");
    try {
      const { status, data } = await api.call(ADMIN_STATUS_PATH);
      if (status < 200 || status >= 300) {
        throw new Error(apiErrorMessage(data, `Request failed (${status})`));
      }
      const isAdmin = parseAdminStatus(data);
      if (isAdmin === null) throw new Error("status shape");
      setPhase(isAdmin ? "ready" : "denied");
    } catch (e) {
      setFailMessage(plainErrorText(e, t("worldAdminDesk.deskCheckFailed")));
      setPhase("failed");
    }
  }, [api]);

  useEffect(() => {
    void probe();
  }, [probe]);

  if (phase === "loading") {
    return (
      <NativeCard isLight={isLight} title={t("worldAdminDesk.deskTitle")}>
        <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {t("worldAdminDesk.deskChecking")}
        </p>
      </NativeCard>
    );
  }

  if (phase === "denied") {
    return (
      <NativeCard isLight={isLight} title={t("worldAdminDesk.deskTitle")}>
        <BenchDenied isLight={isLight} />
      </NativeCard>
    );
  }

  if (phase === "failed") {
    return (
      <NativeCard isLight={isLight} title={t("worldAdminDesk.deskTitle")}>
        <NativeErrorState
          isLight={isLight}
          title={t("worldAdminDesk.deskFailedTitle")}
          message={failMessage}
          onRetry={() => void probe()}
        />
      </NativeCard>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="world-admin-desk">
      <NativeCard isLight={isLight} title={t("worldAdminDesk.deskTitle")}>
        <p className={`inline-flex items-start gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
          {t("worldAdminDesk.deskIntro")}
        </p>
      </NativeCard>
      <ReportsBench isLight={isLight} />
      <DmcaBench isLight={isLight} />
      <ContentRemovalBench isLight={isLight} />
      <PitchFixBench isLight={isLight} />
      <ReversalsBench isLight={isLight} />
      <OperatorBench isLight={isLight} />
      <GearBench isLight={isLight} />
      <ChallengesBench isLight={isLight} />
      <GrantsBench isLight={isLight} />
      <RemixBench isLight={isLight} />
      <BowBench isLight={isLight} />
      <DropsBench isLight={isLight} />
      <SpotlightBench isLight={isLight} />
      <ContactBench isLight={isLight} />
      <UsersBench isLight={isLight} />
      <OrdersBench isLight={isLight} />
      <DiscordBench isLight={isLight} />
    </div>
  );
}

/* ═── Content reports ════════════════════════════════════════════ */

function ReportsBench({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parseContentReports(await a.get(ADMIN_REPORTS_PATH)),
  );
  const act = useBenchAction();

  return (
    <BenchSection
      isLight={isLight}
      title={t("worldAdminDesk.reportsTitle")}
      blurb={t("worldAdminDesk.reportsBlurb")}
      defaultOpen
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {rows && rows.length > 0 ? (
            <p className={`mb-2 text-xs ${cls.subCls}`}>
              {t("worldAdminDesk.reportsOpenLine", { open: openReports(rows), total: rows.length })}
            </p>
          ) : null}
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldAdminDesk.reportsEmpty")}
              detail={t("worldAdminDesk.reportsEmptyDetail")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {rows?.map((row: ContentReportRow) => (
                <div key={row.id} className={cls.rowCls}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={row.status} isLight={isLight} />
                    <span className={`text-xs font-bold uppercase tracking-wide ${cls.subCls}`}>
                      {row.targetType}
                    </span>
                    <span className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.reportsReason", { reason: row.reason })}</span>
                  </div>
                  <p className={`mt-1 text-sm font-semibold ${cls.titleCls}`}>
                    {row.targetSummary || row.targetId}
                  </p>
                  {row.note ? <p className={`mt-1 text-xs ${cls.subCls}`}>{row.note}</p> : null}
                  <p className={`mt-1 text-xs ${cls.subCls}`}>
                    {t("worldAdminDesk.reportsBy", { id: shortId(row.reporterUserId) ?? "—" })}
                    {row.createdAt
                      ? t("worldAdminDesk.dateSuffix", {
                          date: new Date(row.createdAt).toLocaleString(i18n.language),
                        })
                      : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {REPORT_STATUSES.filter((s) => s !== row.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={cls.smallBtn}
                        disabled={act.busy !== null}
                        onClick={() =>
                          void act.run(`report:${row.id}:${status}`, async () => {
                            await api.send(adminReportPath(row.id), "PATCH", buildStatusPatch(status));
                            reload();
                            return t("worldAdminDesk.reportsMarked", { status });
                          })
                        }
                      >
                        <BusyLabel busy={act.busy === `report:${row.id}:${status}`}>
                          {t("worldAdminDesk.markStatus", { status })}
                        </BusyLabel>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
        </BenchStates>
      )}
    </BenchSection>
  );
}

/* ═── DMCA reports ═══════════════════════════════════════════════ */

function DmcaBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parseDmcaReports(await a.get(ADMIN_DMCA_PATH)),
  );
  const act = useBenchAction();

  return (
    <BenchSection
      isLight={isLight}
      title={t("worldAdminDesk.dmcaTitle")}
      blurb={t("worldAdminDesk.dmcaBlurb")}
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {rows && rows.length > 0 ? (
            <p className={`mb-2 text-xs ${cls.subCls}`}>
              {t("worldAdminDesk.reportsOpenLine", { open: openReports(rows), total: rows.length })}
            </p>
          ) : null}
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldAdminDesk.dmcaEmpty")}
              detail={t("worldAdminDesk.dmcaEmptyDetail")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {rows?.map((row: DmcaReportRow) => (
                <div key={row.id} className={cls.rowCls}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={row.status} isLight={isLight} />
                    <span className={`text-sm font-semibold ${cls.titleCls}`}>
                      {row.reporterName}
                      {row.reporterOrg ? ` · ${row.reporterOrg}` : ""}
                    </span>
                  </div>
                  <p className={`mt-1 text-xs ${cls.subCls}`}>{row.reporterEmail}</p>
                  {row.description ? (
                    <p className={`mt-1 text-xs ${cls.subCls}`}>{row.description}</p>
                  ) : null}
                  {row.infringingUrls.length > 0 ? (
                    <p className={`mt-1 break-all text-xs ${cls.subCls}`}>
                      {t("worldAdminDesk.dmcaClaimed", { urls: row.infringingUrls.join(" · ") })}
                    </p>
                  ) : null}
                  {row.originalUrls.length > 0 ? (
                    <p className={`mt-1 break-all text-xs ${cls.subCls}`}>
                      {t("worldAdminDesk.dmcaOriginal", { urls: row.originalUrls.join(" · ") })}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DMCA_STATUSES.filter((s) => s !== row.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={cls.smallBtn}
                        disabled={act.busy !== null}
                        onClick={() =>
                          void act.run(`dmca:${row.id}:${status}`, async () => {
                            await api.send(adminDmcaPath(row.id), "PATCH", buildStatusPatch(status));
                            reload();
                            return t("worldAdminDesk.dmcaMarked", { status });
                          })
                        }
                      >
                        <BusyLabel busy={act.busy === `dmca:${row.id}:${status}`}>
                          {t("worldAdminDesk.markStatus", { status })}
                        </BusyLabel>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
        </BenchStates>
      )}
    </BenchSection>
  );
}

/* ═── Content removal ════════════════════════════════════════════ */

function ContentRemovalBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parseRemovedContent(await a.get(ADMIN_REMOVED_CONTENT_PATH)),
  );
  const act = useBenchAction();
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<AdminContentState | null>(null);
  const [reason, setReason] = useState<string>(REMOVAL_REASONS[0]);
  const [note, setNote] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function doLookup() {
    const id = parseContentId(lookup);
    if (!id) {
      act.setError(t("worldAdminDesk.removalLookupError"));
      return;
    }
    await act.run("lookup", async () => {
      const parsed = parseContentAnswer(await api.get(adminContentPath(id)));
      if (!parsed) throw new Error("content shape");
      setFound(parsed);
      setConfirmRemove(false);
      return undefined;
    });
  }

  async function restore(state: AdminContentState) {
    await act.run(`restore:${state.id}`, async () => {
      const parsed = parseContentAnswer(
        await api.send(adminContentPath(state.id), "PATCH", buildContentRemovalPatch({ removed: false })),
      );
      if (parsed && found?.id === state.id) setFound(parsed);
      reload();
      return t("worldAdminDesk.removalRestored");
    });
  }

  async function remove(state: AdminContentState) {
    await act.run(`remove:${state.id}`, async () => {
      const parsed = parseContentAnswer(
        await api.send(
          adminContentPath(state.id),
          "PATCH",
          buildContentRemovalPatch({ removed: true, reason, note }),
        ),
      );
      if (parsed) setFound(parsed);
      setConfirmRemove(false);
      reload();
      return t("worldAdminDesk.removalRemovedOutcome");
    });
  }

  return (
    <BenchSection
      isLight={isLight}
      title={t("worldAdminDesk.removalTitle")}
      blurb={t("worldAdminDesk.removalBlurb")}
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          <div className="flex flex-col gap-2">
            <label className={cls.labelCls} htmlFor="admin-content-lookup">
              {t("worldAdminDesk.removalLookupLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="admin-content-lookup"
                className={`${deskInputCls(isLight)} min-w-52 flex-1`}
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder={t("worldAdminDesk.removalLookupPlaceholder")}
              />
              <button
                type="button"
                className={cls.goldBtn}
                disabled={act.busy !== null}
                onClick={() => void doLookup()}
              >
                <BusyLabel busy={act.busy === "lookup"}>{t("worldAdminDesk.lookupButton")}</BusyLabel>
              </button>
            </div>
          </div>

          {found ? (
            <div className={`mt-3 ${cls.rowCls}`}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={found.removed ? "removed" : "visible"} isLight={isLight} />
                <span className={`text-xs font-bold uppercase tracking-wide ${cls.subCls}`}>
                  {found.kind}
                  {found.postKind ? ` · ${found.postKind}` : ""}
                </span>
                {found.author ? (
                  <span className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.byName", { name: found.author.displayName })}</span>
                ) : null}
              </div>
              <p className={`mt-1 whitespace-pre-wrap text-sm ${cls.titleCls}`}>{found.body}</p>
              {found.removed ? (
                <p className={`mt-1 text-xs ${cls.subCls}`}>
                  {t("worldAdminDesk.removalRemovedPrefix")}
                  {found.removalReason ? t("worldAdminDesk.removalForReason", { reason: found.removalReason }) : ""}
                  {found.removedByEmail ? t("worldAdminDesk.removalByEmail", { email: found.removedByEmail }) : ""}
                  {found.removalNote ? t("worldAdminDesk.removalNoteSuffix", { note: found.removalNote }) : ""}
                </p>
              ) : null}
              {found.removed ? (
                <div className="mt-2">
                  <button
                    type="button"
                    className={cls.smallBtn}
                    disabled={act.busy !== null}
                    onClick={() => void restore(found)}
                  >
                    <BusyLabel busy={act.busy === `restore:${found.id}`}>{t("worldAdminDesk.removalRestore")}</BusyLabel>
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label={t("worldAdminDesk.removalReasonAria")}
                      className={cls.selectCls}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    >
                      {REMOVAL_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={t("worldAdminDesk.removalNoteAria")}
                      className={`${deskInputCls(isLight)} min-w-40 flex-1`}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t("worldAdminDesk.noteOptionalPlaceholder")}
                    />
                  </div>
                  {confirmRemove ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={cls.goldBtn}
                        disabled={act.busy !== null}
                        onClick={() => void remove(found)}
                      >
                        <BusyLabel busy={act.busy === `remove:${found.id}`}>
                          {t("worldAdminDesk.removalConfirm")}
                        </BusyLabel>
                      </button>
                      <button
                        type="button"
                        className={cls.ghostBtn}
                        onClick={() => setConfirmRemove(false)}
                      >
                        {t("worldAdminDesk.removalKeepUp")}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        className={cls.smallBtn}
                        onClick={() => setConfirmRemove(true)}
                      >
                        {t("worldAdminDesk.removalRemoveButton")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <p className={`mb-2 mt-4 text-xs font-bold uppercase tracking-wider ${cls.subCls}`}>
            {t("worldAdminDesk.removalCurrently")}
          </p>
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldAdminDesk.removalEmpty")}
              detail={t("worldAdminDesk.removalEmptyDetail")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {rows?.map((row) => (
                <div key={row.id} className={cls.rowCls}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-bold uppercase tracking-wide ${cls.subCls}`}>
                      {row.kind}
                    </span>
                    {row.removalReason ? (
                      <StatusPill status={row.removalReason} isLight={isLight} />
                    ) : null}
                    {row.author ? (
                      <span className={`text-xs ${cls.subCls}`}>{t("worldAdminDesk.byName", { name: row.author.displayName })}</span>
                    ) : null}
                  </div>
                  <p className={`mt-1 line-clamp-2 text-sm ${cls.titleCls}`}>{row.body}</p>
                  <div className="mt-2">
                    <button
                      type="button"
                      className={cls.smallBtn}
                      disabled={act.busy !== null}
                      onClick={() => void restore(row)}
                    >
                      <BusyLabel busy={act.busy === `restore:${row.id}`}>{t("worldAdminDesk.removalRestore")}</BusyLabel>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
        </BenchStates>
      )}
    </BenchSection>
  );
}

/* ═── Pitch & Fix inbox ══════════════════════════════════════════ */

function PitchFixBench({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: queue, failMessage, reload } = useBench(
    async (a) => parsePitchFixQueue(await a.get(ADMIN_PITCH_FIX_QUEUE_PATH)),
  );
  const act = useBenchAction();
  const [statusPick, setStatusPick] = useState<Record<string, string>>({});
  const [dupPick, setDupPick] = useState<Record<string, string>>({});

  const pool = queue?.rewardPool ?? null;

  return (
    <BenchSection
      isLight={isLight}
      title={t("worldAdminDesk.pitchFixTitle")}
      blurb={t("worldAdminDesk.pitchFixBlurb")}
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {pool ? (
            <div className={`mb-3 ${cls.rowCls}`}>
              <p className={`text-sm font-semibold ${cls.titleCls}`}>
                {t("worldAdminDesk.pitchFixPoolLine", {
                  spent: pool.spentVb.toLocaleString(i18n.language),
                  cap: pool.capVb.toLocaleString(i18n.language),
                  remaining: pool.remainingVb.toLocaleString(i18n.language),
                  queued: pool.queuedIds.length,
                })}
              </p>
              <p className={`mt-1 text-xs ${cls.subCls}`}>
                {t("worldAdminDesk.pitchFixPoolNote")}
              </p>
              <div className="mt-2">
                <button
                  type="button"
                  className={cls.smallBtn}
                  disabled={act.busy !== null}
                  onClick={() =>
                    void act.run("pf:process", async () => {
                      await api.send(ADMIN_PITCH_FIX_PROCESS_PATH, "POST", {});
                      reload();
                      return t("worldAdminDesk.pitchFixProcessed");
                    })
                  }
                >
                  <BusyLabel busy={act.busy === "pf:process"}>{t("worldAdminDesk.pitchFixProcess")}</BusyLabel>
                </button>
              </div>
            </div>
          ) : null}

          {queue && queue.submissions.length > 0 ? (
            <p className={`mb-2 text-xs ${cls.subCls}`}>
              {t("worldAdminDesk.pitchFixAwaiting", {
                pending: pitchFixPending(queue.submissions),
                total: queue.submissions.length,
              })}
            </p>
          ) : null}
          {queue && queue.submissions.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldAdminDesk.pitchFixEmpty")}
              detail={t("worldAdminDesk.pitchFixEmptyDetail")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {queue?.submissions.map((row: PitchFixRow) => {
                const ladder = pitchFixStatusesFor(row.kind).filter((s) => s !== row.status);
                const picked = statusPick[row.id] ?? ladder[0] ?? "";
                return (
                  <div key={row.id} className={cls.rowCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={row.kind} isLight={isLight} />
                      <StatusPill status={row.status} isLight={isLight} />
                      <StatusPill status={t("worldAdminDesk.pitchFixModeration", { status: row.moderationStatus })} isLight={isLight} />
                      {row.rewardStatus !== "none" ? (
                        <span className={`text-xs font-semibold ${cls.subCls}`}>
                          {row.rewardAmount != null
                            ? t("worldAdminDesk.pitchFixRewardAmt", {
                                amount: row.rewardAmount,
                                status: row.rewardStatus,
                              })
                            : t("worldAdminDesk.pitchFixReward", { status: row.rewardStatus })}
                        </span>
                      ) : null}
                    </div>
                    <p className={`mt-1 text-sm font-semibold ${cls.titleCls}`}>
                      {row.title || row.body.slice(0, 90)}
                    </p>
                    <p className={`mt-1 whitespace-pre-wrap text-xs ${cls.subCls}`}>{row.body}</p>
                    <p className={`mt-1 text-xs ${cls.subCls}`}>
                      {t("worldAdminDesk.pitchFixMeta", {
                        name: row.submitterName,
                        date: new Date(row.createdAt).toLocaleString(i18n.language),
                      })}
                      {row.page ? t("worldAdminDesk.pitchFixPage", { page: row.page }) : ""}
                      {row.category ? t("worldAdminDesk.pitchFixCategory", { category: row.category }) : ""}
                      {row.severity ? t("worldAdminDesk.pitchFixSeverity", { severity: row.severity }) : ""}
                      {row.rating != null ? t("worldAdminDesk.pitchFixRated", { rating: row.rating }) : ""}
                      {row.upvoteCount > 0 ? t("worldAdminDesk.pitchFixUpvotes", { count: row.upvoteCount }) : ""}
                    </p>
                    {row.why ? <p className={`mt-1 text-xs ${cls.subCls}`}>{t("worldAdminDesk.pitchFixWhy", { why: row.why })}</p> : null}
                    {row.duplicateOfId ? (
                      <p className={`mt-1 text-xs ${cls.subCls}`}>
                        {t("worldAdminDesk.pitchFixDupOf", { id: shortId(row.duplicateOfId) })}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {row.moderationStatus === "pending" ? (
                        <>
                          <button
                            type="button"
                            className={cls.smallBtn}
                            disabled={act.busy !== null}
                            onClick={() =>
                              void act.run(`pf:mod:${row.id}:approved`, async () => {
                                await api.send(
                                  adminPitchFixPath(row.id),
                                  "PATCH",
                                  buildPitchFixModeration("approved"),
                                );
                                reload();
                                return t("worldAdminDesk.pitchFixApproved");
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pf:mod:${row.id}:approved`}>
                              {t("worldAdminDesk.pitchFixApprove")}
                            </BusyLabel>
                          </button>
                          <button
                            type="button"
                            className={cls.smallBtn}
                            disabled={act.busy !== null}
                            onClick={() =>
                              void act.run(`pf:mod:${row.id}:rejected`, async () => {
                                await api.send(
                                  adminPitchFixPath(row.id),
                                  "PATCH",
                                  buildPitchFixModeration("rejected"),
                                );
                                reload();
                                return t("worldAdminDesk.pitchFixRejected");
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pf:mod:${row.id}:rejected`}>
                              {t("worldAdminDesk.pitchFixReject")}
                            </BusyLabel>
                          </button>
                        </>
                      ) : null}
                      {ladder.length > 0 ? (
                        <>
                          <select
                            aria-label={t("worldAdminDesk.pitchFixStatusAria", { title: row.title || row.id })}
                            className={cls.selectCls}
                            value={picked}
                            onChange={(e) =>
                              setStatusPick((m) => ({ ...m, [row.id]: e.target.value }))
                            }
                          >
                            {ladder.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className={cls.smallBtn}
                            disabled={act.busy !== null || !picked}
                            onClick={() =>
                              void act.run(`pf:status:${row.id}`, async () => {
                                await api.send(
                                  adminPitchFixPath(row.id),
                                  "PATCH",
                                  buildPitchFixStatus(picked),
                                );
                                reload();
                                return t("worldAdminDesk.pitchFixStatusSet", { status: picked });
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pf:status:${row.id}`}>
                              {t("worldAdminDesk.pitchFixSetStatus")}
                            </BusyLabel>
                          </button>
                        </>
                      ) : null}
                    </div>
                    {!row.duplicateOfId ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input
                          aria-label={t("worldAdminDesk.pitchFixDupAria")}
                          className={`${deskInputCls(isLight)} min-w-40 flex-1`}
                          value={dupPick[row.id] ?? ""}
                          onChange={(e) => setDupPick((m) => ({ ...m, [row.id]: e.target.value }))}
                          placeholder={t("worldAdminDesk.pitchFixDupPlaceholder")}
                        />
                        <button
                          type="button"
                          className={cls.smallBtn}
                          disabled={act.busy !== null || !(dupPick[row.id] ?? "").trim()}
                          onClick={() =>
                            void act.run(`pf:dup:${row.id}`, async () => {
                              await api.send(
                                adminPitchFixPath(row.id),
                                "PATCH",
                                buildPitchFixDuplicate((dupPick[row.id] ?? "").trim()),
                              );
                              reload();
                              return t("worldAdminDesk.pitchFixMarkedDup");
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === `pf:dup:${row.id}`}>
                            {t("worldAdminDesk.pitchFixMarkDup")}
                          </BusyLabel>
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
        </BenchStates>
      )}
    </BenchSection>
  );
}
