import { useCallback, useEffect, useState } from "react";
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
      setFailMessage(plainErrorText(e, "Couldn't check this account."));
      setPhase("failed");
    }
  }, [api]);

  useEffect(() => {
    void probe();
  }, [probe]);

  if (phase === "loading") {
    return (
      <NativeCard isLight={isLight} title="Admin Benches">
        <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          Checking this account with the site…
        </p>
      </NativeCard>
    );
  }

  if (phase === "denied") {
    return (
      <NativeCard isLight={isLight} title="Admin Benches">
        <BenchDenied isLight={isLight} />
      </NativeCard>
    );
  }

  if (phase === "failed") {
    return (
      <NativeCard isLight={isLight} title="Admin Benches">
        <NativeErrorState
          isLight={isLight}
          title="The admin benches wouldn't open in the palace"
          message={failMessage}
          onRetry={() => void probe()}
        />
      </NativeCard>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="world-admin-desk">
      <NativeCard isLight={isLight} title="Admin Benches">
        <p className={`inline-flex items-start gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
          The house benches, native in the palace — the same queues and verbs as the
          website&apos;s admin page, on the same rails. Open a bench to load it; every
          action is the server&apos;s, checked against this account on every call.
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
    </div>
  );
}

/* ═── Content reports ════════════════════════════════════════════ */

function ReportsBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parseContentReports(await a.get(ADMIN_REPORTS_PATH)),
  );
  const act = useBenchAction();

  return (
    <BenchSection
      isLight={isLight}
      title="Content Reports"
      blurb="Members' reports on posts and comments — work the queue, set each report's state."
      defaultOpen
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {rows && rows.length > 0 ? (
            <p className={`mb-2 text-xs ${cls.subCls}`}>
              {openReports(rows)} still open · {rows.length} on the bench
            </p>
          ) : null}
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No reports on the bench."
              detail="When a member reports a post or comment, it lands here."
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
                    <span className={`text-xs ${cls.subCls}`}>reason: {row.reason}</span>
                  </div>
                  <p className={`mt-1 text-sm font-semibold ${cls.titleCls}`}>
                    {row.targetSummary || row.targetId}
                  </p>
                  {row.note ? <p className={`mt-1 text-xs ${cls.subCls}`}>{row.note}</p> : null}
                  <p className={`mt-1 text-xs ${cls.subCls}`}>
                    Reported by {shortId(row.reporterUserId) ?? "—"}
                    {row.createdAt ? ` · ${new Date(row.createdAt).toLocaleString()}` : ""}
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
                            return `Report marked ${status}.`;
                          })
                        }
                      >
                        <BusyLabel busy={act.busy === `report:${row.id}:${status}`}>
                          Mark {status}
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
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parseDmcaReports(await a.get(ADMIN_DMCA_PATH)),
  );
  const act = useBenchAction();

  return (
    <BenchSection
      isLight={isLight}
      title="Takedown Requests"
      blurb="Copyright (DMCA) reports — review the claimed links and set each report's state."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {rows && rows.length > 0 ? (
            <p className={`mb-2 text-xs ${cls.subCls}`}>
              {openReports(rows)} still open · {rows.length} on the bench
            </p>
          ) : null}
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No takedown requests on the bench."
              detail="Copyright reports land here when a rights holder files one."
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
                      Claimed: {row.infringingUrls.join(" · ")}
                    </p>
                  ) : null}
                  {row.originalUrls.length > 0 ? (
                    <p className={`mt-1 break-all text-xs ${cls.subCls}`}>
                      Original: {row.originalUrls.join(" · ")}
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
                            return `Takedown request marked ${status}.`;
                          })
                        }
                      >
                        <BusyLabel busy={act.busy === `dmca:${row.id}:${status}`}>
                          Mark {status}
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
      act.setError("Paste a post or comment ID, or a link to the post.");
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
      return "Content restored — it is visible again.";
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
      return "Content removed. The removal and its reason are on the record.";
    });
  }

  return (
    <BenchSection
      isLight={isLight}
      title="Content Removal"
      blurb="Take a post or comment down (reversibly, reason on record) or restore one."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          <div className="flex flex-col gap-2">
            <label className={cls.labelCls} htmlFor="admin-content-lookup">
              Look up a post or comment
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="admin-content-lookup"
                className={`${deskInputCls(isLight)} min-w-52 flex-1`}
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder="Post ID, comment ID, or a /post/… link"
              />
              <button
                type="button"
                className={cls.goldBtn}
                disabled={act.busy !== null}
                onClick={() => void doLookup()}
              >
                <BusyLabel busy={act.busy === "lookup"}>Look up</BusyLabel>
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
                  <span className={`text-xs ${cls.subCls}`}>by {found.author.displayName}</span>
                ) : null}
              </div>
              <p className={`mt-1 whitespace-pre-wrap text-sm ${cls.titleCls}`}>{found.body}</p>
              {found.removed ? (
                <p className={`mt-1 text-xs ${cls.subCls}`}>
                  Removed
                  {found.removalReason ? ` for ${found.removalReason}` : ""}
                  {found.removedByEmail ? ` by ${found.removedByEmail}` : ""}
                  {found.removalNote ? ` — ${found.removalNote}` : ""}
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
                    <BusyLabel busy={act.busy === `restore:${found.id}`}>Restore</BusyLabel>
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Removal reason"
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
                      aria-label="Removal note (optional)"
                      className={`${deskInputCls(isLight)} min-w-40 flex-1`}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Note (optional)"
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
                          Confirm removal
                        </BusyLabel>
                      </button>
                      <button
                        type="button"
                        className={cls.ghostBtn}
                        onClick={() => setConfirmRemove(false)}
                      >
                        Keep it up
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        className={cls.smallBtn}
                        onClick={() => setConfirmRemove(true)}
                      >
                        Remove this content
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <p className={`mb-2 mt-4 text-xs font-bold uppercase tracking-wider ${cls.subCls}`}>
            Currently removed
          </p>
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="Nothing is removed right now."
              detail="Removed posts and comments collect here, ready to restore."
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
                      <span className={`text-xs ${cls.subCls}`}>by {row.author.displayName}</span>
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
                      <BusyLabel busy={act.busy === `restore:${row.id}`}>Restore</BusyLabel>
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
      title="Pitch & Fix Inbox"
      blurb="Pitches, fix reports and feedback — moderate, walk the status ladder, pay the reward queue."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {pool ? (
            <div className={`mb-3 ${cls.rowCls}`}>
              <p className={`text-sm font-semibold ${cls.titleCls}`}>
                Reward pool — {pool.spentVb.toLocaleString()} of {pool.capVb.toLocaleString()} VB
                spent this week · {pool.remainingVb.toLocaleString()} left ·{" "}
                {pool.queuedIds.length} queued
              </p>
              <p className={`mt-1 text-xs ${cls.subCls}`}>
                Opening this bench already runs the queue once; the button runs it again on
                demand. Rewards pay only from a status move to shipped / fixed, exactly like
                the website bench.
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
                      return "Reward queue processed — the pool line above is current.";
                    })
                  }
                >
                  <BusyLabel busy={act.busy === "pf:process"}>Process rewards</BusyLabel>
                </button>
              </div>
            </div>
          ) : null}

          {queue && queue.submissions.length > 0 ? (
            <p className={`mb-2 text-xs ${cls.subCls}`}>
              {pitchFixPending(queue.submissions)} awaiting moderation ·{" "}
              {queue.submissions.length} in the inbox
            </p>
          ) : null}
          {queue && queue.submissions.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="The inbox is empty."
              detail="Pitches, fix reports and feedback land here as members send them."
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
                      <StatusPill status={`moderation: ${row.moderationStatus}`} isLight={isLight} />
                      {row.rewardStatus !== "none" ? (
                        <span className={`text-xs font-semibold ${cls.subCls}`}>
                          Reward: {row.rewardAmount != null ? `${row.rewardAmount} VB · ` : ""}
                          {row.rewardStatus}
                        </span>
                      ) : null}
                    </div>
                    <p className={`mt-1 text-sm font-semibold ${cls.titleCls}`}>
                      {row.title || row.body.slice(0, 90)}
                    </p>
                    <p className={`mt-1 whitespace-pre-wrap text-xs ${cls.subCls}`}>{row.body}</p>
                    <p className={`mt-1 text-xs ${cls.subCls}`}>
                      {row.submitterName} · {new Date(row.createdAt).toLocaleString()}
                      {row.page ? ` · page: ${row.page}` : ""}
                      {row.category ? ` · ${row.category}` : ""}
                      {row.severity ? ` · severity: ${row.severity}` : ""}
                      {row.rating != null ? ` · rated ${row.rating}/5` : ""}
                      {row.upvoteCount > 0 ? ` · ${row.upvoteCount} upvotes` : ""}
                    </p>
                    {row.why ? <p className={`mt-1 text-xs ${cls.subCls}`}>Why: {row.why}</p> : null}
                    {row.duplicateOfId ? (
                      <p className={`mt-1 text-xs ${cls.subCls}`}>
                        Marked duplicate of {shortId(row.duplicateOfId)}
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
                                return "Approved — it can now walk the ladder.";
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pf:mod:${row.id}:approved`}>
                              Approve
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
                                return "Rejected.";
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pf:mod:${row.id}:rejected`}>
                              Reject
                            </BusyLabel>
                          </button>
                        </>
                      ) : null}
                      {ladder.length > 0 ? (
                        <>
                          <select
                            aria-label={`Status for ${row.title || row.id}`}
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
                                return `Status set to ${picked} — any reward it earned is queued and processed.`;
                              })
                            }
                          >
                            <BusyLabel busy={act.busy === `pf:status:${row.id}`}>
                              Set status
                            </BusyLabel>
                          </button>
                        </>
                      ) : null}
                    </div>
                    {!row.duplicateOfId ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input
                          aria-label="Original submission ID"
                          className={`${deskInputCls(isLight)} min-w-40 flex-1`}
                          value={dupPick[row.id] ?? ""}
                          onChange={(e) => setDupPick((m) => ({ ...m, [row.id]: e.target.value }))}
                          placeholder="Original submission's ID (for duplicates)"
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
                              return "Marked as a duplicate.";
                            })
                          }
                        >
                          <BusyLabel busy={act.busy === `pf:dup:${row.id}`}>
                            Mark duplicate
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
