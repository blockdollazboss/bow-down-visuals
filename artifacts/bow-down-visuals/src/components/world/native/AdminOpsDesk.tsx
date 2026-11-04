import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { apiErrorMessage } from "../../../lib/api-error";
import { NativeEmptyState } from "@/components/world/native/NativeStates";
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
  ADMIN_BOW_CHALLENGE_PATH,
  ADMIN_CONTACT_PATH,
  ADMIN_CREDITS_GRANT_PATH,
  ADMIN_GEAR_ORDERS_PATH,
  ADMIN_JEWELRY_ORDERS_PATH,
  ADMIN_NFC_ORDERS_PATH,
  ADMIN_OPERATOR_ACTIONS_PATH,
  ADMIN_PLAN_SET_PATH,
  ADMIN_REVERSALS_PATH,
  ADMIN_SPOTLIGHT_PATH,
  DISCORD_BOT_CONFIG_PATH,
  DISCORD_BOT_INSTALL_URL_PATH,
  DISCORD_BOT_LIVE_PATH,
  GEAR_FILTERS,
  OPERATOR_RESULT_FILTERS,
  PLAN_TIERS,
  REVERSAL_FILTERS,
  SPOTLIGHT_STATUSES,
  adminContactPath,
  adminGearProofPath,
  adminReversalResolvePath,
  adminGearStatusPath,
  adminSpotlightPath,
  adminUserBanPath,
  adminUserLookupPath,
  adminUserUnbanPath,
  bowConfigReady,
  buildBowConfigBody,
  buildDiscordBotConfigBody,
  buildGearProof,
  buildGearStatus,
  buildGrantBody,
  buildPlanBody,
  buildReadPatch,
  buildReversalResolve,
  buildStatusPatch,
  countNeedsManualReview,
  discordBotDraftFrom,
  discordBotUnconfigured,
  discordInstallBlocked,
  emailReady,
  filterGearOrders,
  filterOperatorActions,
  filterReversals,
  formatUsdCents,
  gearFulfillmentActions,
  gearProofSendAvailable,
  gearShipBlock,
  grantAmountReady,
  parseBowChallenge,
  parseContactMessages,
  parseDiscordBotConfig,
  parseDiscordBotLive,
  parseDiscordInstallUrl,
  parseGearAdminOrders,
  parseJewelryOrders,
  parseNfcOrders,
  parseOperatorActions,
  parsePaymentReversals,
  parseSpotlightInquiries,
  parseUserLookup,
  reversalResolvable,
  reversalResolveReady,
  shortId,
  unreadMessages,
  type AdminUserLookup,
  type DiscordBotDraft,
  type GearAdminOrder,
  type PaymentReversalRow,
  type ReversalDecision,
  type ReversalFilter,
  type OperatorResultFilter,
  type GearFilter,
} from "@/lib/world/admin-desk";

/* ─── The ops benches of the Admin desk family (wave #5) ─────────
   Payment reversals, the operator's action trail, the studio gear
   relay queue, the Bow Challenge race config, the spotlight and
   contact inboxes, user management with the grant + plan rails,
   and the card/jewelry order lists, plus the Discord Bot wiring
   bench (stack100 wave 3). Same contract as the rest of
   the family: the page benches' own rails and shapes through
   lib/world/admin-desk.ts, lazy per-section loads, failures that
   read as failures, and the gate's 403 flipping a bench to the
   not-authorized state. The operator bench is READ-ONLY, like the
   page's — an audit trail, never a control surface.            */

/* ═── Payment reversals ══════════════════════════════════════════ */

export function ReversalsBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parsePaymentReversals(await a.get(ADMIN_REVERSALS_PATH)),
  );
  const act = useBenchAction();
  const [filter, setFilter] = useState<ReversalFilter>("all");
  const [decision, setDecision] = useState<Record<string, ReversalDecision>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [confirmFor, setConfirmFor] = useState<string | null>(null);

  const shown = rows ? filterReversals(rows, filter) : [];

  async function resolve(row: PaymentReversalRow) {
    const d = decision[row.id] ?? "complete";
    const n = note[row.id] ?? "";
    await act.run(`rev:${row.id}`, async () => {
      const { status, data } = await api.call(
        adminReversalResolvePath(row.id),
        "POST",
        buildReversalResolve(d, n),
      );
      if (status === 409) {
        reload();
        throw new Error("Someone settled this row first — the recorded decision is on it now.");
      }
      if (status < 200 || status >= 300) {
        throw new Error(apiErrorMessage(data, `Request failed (${status})`));
      }
      setConfirmFor(null);
      reload();
      return d === "complete"
        ? "Resolved — the reversal completed and the decision is recorded."
        : "Dismissed — no money moved, and the decision is recorded.";
    });
  }

  return (
    <BenchSection
      isLight={isLight}
      title="Payment Reversals"
      blurb="Refunds and disputes the engine parked for a human — complete or dismiss each, on the record."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {rows && rows.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`text-xs ${cls.subCls}`}>
                {countNeedsManualReview(rows)} need a decision · {rows.length} rows
              </span>
              <select
                aria-label="Filter reversals"
                className={cls.selectCls}
                value={filter}
                onChange={(e) => setFilter(e.target.value as ReversalFilter)}
              >
                {REVERSAL_FILTERS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No reversals on record."
              detail="When a refund or dispute reverses a payment, its row lands here."
            />
          ) : shown.length === 0 ? (
            <NativeEmptyState isLight={isLight} message="Nothing under this filter." />
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((row) => {
                const d = decision[row.id] ?? "complete";
                const n = note[row.id] ?? "";
                return (
                  <div key={row.id} className={cls.rowCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={row.status} isLight={isLight} />
                      <span className={`text-xs font-bold uppercase tracking-wide ${cls.subCls}`}>
                        {row.trigger} · {row.rail}
                      </span>
                    </div>
                    <p className={`mt-1 text-sm font-semibold ${cls.titleCls}`}>
                      {formatUsdCents(row.chargeAmountCents)} charge · {row.grantedCredits} VB
                      granted · {row.creditsClawed} clawed back
                      {row.shortfallCredits > 0 ? ` · ${row.shortfallCredits} VB shortfall` : ""}
                    </p>
                    <p className={`mt-1 text-xs ${cls.subCls}`}>
                      {new Date(row.createdAt).toLocaleString()}
                      {row.disputeLost ? " · dispute lost" : ""}
                      {row.entitlementRevoked ? " · entitlement revoked" : ""}
                      {row.sellerReversed ? " · seller reversed" : ""}
                    </p>
                    {row.manualReason ? (
                      <p className={`mt-1 text-xs ${cls.subCls}`}>Parked: {row.manualReason}</p>
                    ) : null}
                    {row.resolution ? (
                      <p className={`mt-1 text-xs ${cls.subCls}`}>
                        Resolved: {row.resolution.decision}
                        {row.resolution.adminEmail ? ` by ${row.resolution.adminEmail}` : ""}
                        {row.resolution.note ? ` — ${row.resolution.note}` : ""}
                      </p>
                    ) : null}
                    {reversalResolvable(row) ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                          <select
                            aria-label="Resolution"
                            className={cls.selectCls}
                            value={d}
                            onChange={(e) =>
                              setDecision((m) => ({
                                ...m,
                                [row.id]: e.target.value as ReversalDecision,
                              }))
                            }
                          >
                            <option value="complete">complete the reversal</option>
                            <option value="dismiss">dismiss (no money moves)</option>
                          </select>
                          <input
                            aria-label="Resolution note"
                            className={`${deskInputCls(isLight)} min-w-40 flex-1`}
                            value={n}
                            onChange={(e) => setNote((m) => ({ ...m, [row.id]: e.target.value }))}
                            placeholder={d === "dismiss" ? "Note (required to dismiss)" : "Note (optional)"}
                          />
                        </div>
                        {confirmFor === row.id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs font-semibold ${cls.titleCls}`}>
                              {d === "complete"
                                ? `Complete the reversal on a ${formatUsdCents(row.chargeAmountCents)} charge (${row.grantedCredits} VB granted)?`
                                : `Dismiss this row? No money moves.`}
                            </span>
                            <button
                              type="button"
                              className={cls.goldBtn}
                              disabled={act.busy !== null || !reversalResolveReady(d, n)}
                              onClick={() => void resolve(row)}
                            >
                              <BusyLabel busy={act.busy === `rev:${row.id}`}>Confirm</BusyLabel>
                            </button>
                            <button
                              type="button"
                              className={cls.ghostBtn}
                              onClick={() => setConfirmFor(null)}
                            >
                              Not yet
                            </button>
                          </div>
                        ) : (
                          <div>
                            <button
                              type="button"
                              className={cls.smallBtn}
                              disabled={act.busy !== null || !reversalResolveReady(d, n)}
                              onClick={() => setConfirmFor(row.id)}
                            >
                              Resolve…
                            </button>
                          </div>
                        )}
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

/* ═── Operator actions (read-only) ═══════════════════════════════ */

export function OperatorBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const { phase, data, failMessage, reload } = useBench(
    async (a) => parseOperatorActions(await a.get(ADMIN_OPERATOR_ACTIONS_PATH)),
  );
  const [filter, setFilter] = useState<OperatorResultFilter>("all");
  const shown = data ? filterOperatorActions(data.actions, filter) : [];

  return (
    <BenchSection
      isLight={isLight}
      title="Operator Actions"
      blurb="Thy Cheat Code's action trail — what the operator ran or refused. Read-only, like the website bench."
    >
      <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
        {data ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`text-xs ${cls.subCls}`}>
              Hands {data.handsEnabled ? "on" : "off"} · charged cap {data.dailyChargedCap} VB/day
              · {data.actions.length} actions
            </span>
            <select
              aria-label="Filter operator actions"
              className={cls.selectCls}
              value={filter}
              onChange={(e) => setFilter(e.target.value as OperatorResultFilter)}
            >
              {OPERATOR_RESULT_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {data && shown.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message="No operator actions to show."
            detail="Charged or refused operator actions collect here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map((row) => (
              <div key={row.id} className={cls.rowCls}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={row.result} isLight={isLight} />
                  <span className={`text-sm font-semibold ${cls.titleCls}`}>{row.toolId}</span>
                  {row.tier ? (
                    <span className={`text-xs ${cls.subCls}`}>{row.tier}</span>
                  ) : null}
                </div>
                <p className={`mt-1 text-xs ${cls.subCls}`}>{row.summary}</p>
                <p className={`mt-1 text-xs ${cls.subCls}`}>
                  {new Date(row.createdAt).toLocaleString()}
                  {row.adminEmail ? ` · for ${row.adminEmail}` : ""}
                  {row.target ? ` · target ${row.target}` : ""}
                  {row.priceCharged != null
                    ? ` · charged ${row.priceCharged} VB`
                    : row.priceQuoted != null
                      ? ` · quoted ${row.priceQuoted} VB`
                      : ""}
                </p>
                {row.resultReason ? (
                  <p className={`mt-1 text-xs ${cls.subCls}`}>{row.resultReason}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </BenchStates>
    </BenchSection>
  );
}

/* ═── Studio gear queue ══════════════════════════════════════════ */

export function GearBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data, failMessage, reload } = useBench(
    async (a) => parseGearAdminOrders(await a.get(ADMIN_GEAR_ORDERS_PATH)),
  );
  const act = useBenchAction();
  const [filter, setFilter] = useState<GearFilter>("all");
  const [proof, setProof] = useState<Record<string, { url: string; note: string }>>({});

  const shown = data ? filterGearOrders(data.orders, filter) : [];

  async function sendProof(order: GearAdminOrder) {
    const form = proof[order.id] ?? { url: "", note: "" };
    await act.run(`gear:proof:${order.id}`, async () => {
      await api.send(adminGearProofPath(order.id), "POST", buildGearProof({ proofUrl: form.url, proofNote: form.note }));
      setProof((m) => ({ ...m, [order.id]: { url: "", note: "" } }));
      reload();
      return "Proof sent to the buyer.";
    });
  }

  async function moveStatus(order: GearAdminOrder, status: string) {
    await act.run(`gear:status:${order.id}:${status}`, async () => {
      await api.send(adminGearStatusPath(order.id), "POST", buildGearStatus(status));
      reload();
      return `Order marked ${status}.`;
    });
  }

  return (
    <BenchSection
      isLight={isLight}
      title="Studio Gear Queue"
      blurb="Custom gear orders — relay the design proof, then walk fulfillment. Shipping keeps the rail's gate: paid, proof settled."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {data && data.orders.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`text-xs ${cls.subCls}`}>
                {data.orders.length} orders{data.testMode ? " · test mode" : ""}
              </span>
              <select
                aria-label="Filter gear orders"
                className={cls.selectCls}
                value={filter}
                onChange={(e) => setFilter(e.target.value as GearFilter)}
              >
                {GEAR_FILTERS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {data && shown.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No gear orders under this filter."
              detail="Custom gear orders land here as buyers place them."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((order) => {
                const form = proof[order.id] ?? { url: "", note: "" };
                const shipBlock = gearShipBlock(order);
                return (
                  <div key={order.id} className={cls.rowCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={order.status} isLight={isLight} />
                      <StatusPill status={`proof: ${order.proofStatus}`} isLight={isLight} />
                      <span className={`text-sm font-semibold ${cls.titleCls}`}>
                        {formatUsdCents(order.totalCents)}
                      </span>
                      <span className={`text-xs ${cls.subCls}`}>
                        {order.paid ? "paid" : "unpaid"}
                        {order.testMode ? " · test" : ""}
                      </span>
                    </div>
                    {order.items.map((item, i) => (
                      <p key={i} className={`mt-1 text-xs ${cls.subCls}`}>
                        {item.product}
                        {item.variant ? ` · ${item.variant}` : ""}
                        {item.option ? ` · ${item.option}` : ""} × {item.qty}
                        {item.customText ? ` · “${item.customText}”` : ""}
                      </p>
                    ))}
                    <p className={`mt-1 text-xs ${cls.subCls}`}>
                      {order.buyer.name} · {order.buyer.email} · {order.buyer.city},{" "}
                      {order.buyer.state} {order.buyer.zip} ·{" "}
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                    {gearProofSendAvailable(order) ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                          <input
                            aria-label="Proof link"
                            className={`${deskInputCls(isLight)} min-w-52 flex-1`}
                            value={form.url}
                            onChange={(e) =>
                              setProof((m) => ({ ...m, [order.id]: { ...form, url: e.target.value } }))
                            }
                            placeholder="Proof link (the design preview URL)"
                          />
                          <input
                            aria-label="Proof note"
                            className={`${deskInputCls(isLight)} min-w-32 flex-1`}
                            value={form.note}
                            onChange={(e) =>
                              setProof((m) => ({ ...m, [order.id]: { ...form, note: e.target.value } }))
                            }
                            placeholder="Note (optional)"
                          />
                        </div>
                        <div>
                          <button
                            type="button"
                            className={cls.smallBtn}
                            disabled={act.busy !== null || !form.url.trim()}
                            onClick={() => void sendProof(order)}
                          >
                            <BusyLabel busy={act.busy === `gear:proof:${order.id}`}>
                              Send proof
                            </BusyLabel>
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {gearFulfillmentActions(order).map((status) => (
                        <button
                          key={status}
                          type="button"
                          className={cls.smallBtn}
                          disabled={
                            act.busy !== null || (status === "shipped" && shipBlock !== null)
                          }
                          onClick={() => void moveStatus(order, status)}
                        >
                          <BusyLabel busy={act.busy === `gear:status:${order.id}:${status}`}>
                            Mark {status}
                          </BusyLabel>
                        </button>
                      ))}
                      {gearFulfillmentActions(order).includes("shipped") && shipBlock === "unpaid" ? (
                        <span className={`text-xs ${cls.subCls}`}>Shipping waits: unpaid.</span>
                      ) : null}
                      {gearFulfillmentActions(order).includes("shipped") && shipBlock === "proof_open" ? (
                        <span className={`text-xs ${cls.subCls}`}>
                          Shipping waits: the proof isn&apos;t settled.
                        </span>
                      ) : null}
                    </div>
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

/* ═── Bow Challenge (the jackpot race) ═══════════════════════════ */

export function BowBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data, failMessage, reload } = useBench(
    async (a) => parseBowChallenge(await a.get(ADMIN_BOW_CHALLENGE_PATH)),
  );
  const act = useBenchAction();
  const [reward, setReward] = useState("");
  const [target, setTarget] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (data && !seeded) {
      setReward(String(data.rewardCredits));
      setTarget(data.targetOverride != null ? String(data.targetOverride) : "");
      setEnabled(data.enabled);
      setSeeded(true);
    }
  }, [data, seeded]);

  async function save() {
    await act.run("bow:save", async () => {
      await api.send(ADMIN_BOW_CHALLENGE_PATH, "PUT", buildBowConfigBody({
        rewardCredits: Number(reward),
        enabled,
        targetOverride: target.trim() === "" ? null : Number(target),
      }));
      reload();
      return "Race settings saved.";
    });
  }

  return (
    <BenchSection
      isLight={isLight}
      title="Bow Challenge"
      blurb="The monthly jackpot race — its reward, its target, and whether it's running. Secret everywhere else."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {data ? (
            <div className="flex flex-col gap-3">
              {data.race ? (
                <div className={cls.rowCls}>
                  <p className={`text-sm font-semibold ${cls.titleCls}`}>
                    {data.race.period} — {data.race.totalBows.toLocaleString()} bows toward{" "}
                    {data.race.target.toLocaleString()}
                  </p>
                  <p className={`mt-1 text-xs ${cls.subCls}`}>
                    {data.race.raceOver
                      ? `Won by ${data.race.winnerEmail ?? "—"}${data.race.wonAt ? ` · ${new Date(data.race.wonAt).toLocaleString()}` : ""}`
                      : "No winner yet — the race is live."}
                  </p>
                </div>
              ) : (
                <NativeEmptyState
                  isLight={isLight}
                  message="No race has started for this period yet."
                  detail="The first bow of the month opens it."
                />
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={cls.labelCls} htmlFor="bow-reward">
                    Reward (Visual Bucs)
                  </label>
                  <input
                    id="bow-reward"
                    className={deskInputCls(isLight)}
                    value={reward}
                    onChange={(e) => setReward(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className={cls.labelCls} htmlFor="bow-target">
                    Target override (blank = drawn)
                  </label>
                  <input
                    id="bow-target"
                    className={deskInputCls(isLight)}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    inputMode="numeric"
                    placeholder="1,000–5,000"
                  />
                </div>
                <label className={`flex items-center gap-2 text-sm ${cls.titleCls}`}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  Race enabled
                </label>
                <button
                  type="button"
                  className={cls.goldBtn}
                  disabled={act.busy !== null || !bowConfigReady(reward, target)}
                  onClick={() => void save()}
                >
                  <BusyLabel busy={act.busy === "bow:save"}>Save race settings</BusyLabel>
                </button>
              </div>
              {data.history.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className={`text-xs font-bold uppercase tracking-wider ${cls.subCls}`}>
                    Win history
                  </p>
                  {data.history.map((h) => (
                    <p key={h.period} className={`text-xs ${cls.subCls}`}>
                      {h.period} — target {h.target.toLocaleString()} · {h.totalBows.toLocaleString()}{" "}
                      bows · won by {h.winnerEmail ?? "—"}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
        </BenchStates>
      )}
    </BenchSection>
  );
}

/* ═── Spotlight inbox ════════════════════════════════════════════ */

export function SpotlightBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parseSpotlightInquiries(await a.get(ADMIN_SPOTLIGHT_PATH)),
  );
  const act = useBenchAction();

  return (
    <BenchSection
      isLight={isLight}
      title="Spotlight Inquiries"
      blurb="Creators asking for the spotlight — walk each inquiry to a decision."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No spotlight inquiries."
              detail="When a creator asks for the spotlight, the inquiry lands here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {rows?.map((row) => (
                <div key={row.id} className={cls.rowCls}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={row.status} isLight={isLight} />
                    <span className={`text-sm font-semibold ${cls.titleCls}`}>{row.name}</span>
                    <span className={`text-xs ${cls.subCls}`}>{row.email}</span>
                  </div>
                  {row.videoUrl ? (
                    <p className={`mt-1 break-all text-xs ${cls.subCls}`}>Video: {row.videoUrl}</p>
                  ) : null}
                  {row.targetUrl ? (
                    <p className={`mt-1 break-all text-xs ${cls.subCls}`}>Target: {row.targetUrl}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SPOTLIGHT_STATUSES.filter((s) => s !== row.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={cls.smallBtn}
                        disabled={act.busy !== null}
                        onClick={() =>
                          void act.run(`spot:${row.id}:${status}`, async () => {
                            await api.send(adminSpotlightPath(row.id), "PATCH", buildStatusPatch(status));
                            reload();
                            return `Inquiry marked ${status}.`;
                          })
                        }
                      >
                        <BusyLabel busy={act.busy === `spot:${row.id}:${status}`}>
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

/* ═── Contact inbox ══════════════════════════════════════════════ */

export function ContactBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const { phase, data: rows, failMessage, reload } = useBench(
    async (a) => parseContactMessages(await a.get(ADMIN_CONTACT_PATH)),
  );
  const act = useBenchAction();

  return (
    <BenchSection
      isLight={isLight}
      title="Contact Inbox"
      blurb="Messages from the contact form — read them here, mark them done."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={phase} failMessage={failMessage} onRetry={reload}>
          {rows && rows.length > 0 ? (
            <p className={`mb-2 text-xs ${cls.subCls}`}>{unreadMessages(rows)} unread</p>
          ) : null}
          {rows && rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="The inbox is empty."
              detail="Contact-form messages land here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {rows?.map((row) => (
                <div key={row.id} className={cls.rowCls}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={row.read ? "read" : "new"} isLight={isLight} />
                    <span className={`text-sm font-semibold ${cls.titleCls}`}>{row.name}</span>
                    <span className={`text-xs ${cls.subCls}`}>{row.email}</span>
                  </div>
                  <p className={`mt-1 whitespace-pre-wrap text-sm ${cls.titleCls}`}>{row.message}</p>
                  <div className="mt-2">
                    <button
                      type="button"
                      className={cls.smallBtn}
                      disabled={act.busy !== null}
                      onClick={() =>
                        void act.run(`contact:${row.id}`, async () => {
                          await api.send(adminContactPath(row.id), "PATCH", buildReadPatch(!row.read));
                          reload();
                          return row.read ? "Marked unread." : "Marked read.";
                        })
                      }
                    >
                      <BusyLabel busy={act.busy === `contact:${row.id}`}>
                        {row.read ? "Mark unread" : "Mark read"}
                      </BusyLabel>
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

/* ═── Users, grants, plan ════════════════════════════════════════ */

export function UsersBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const act = useBenchAction();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<AdminUserLookup | null>(null);
  const [missed, setMissed] = useState(false);
  const [amount, setAmount] = useState("");
  const [selfAmount, setSelfAmount] = useState("");
  const [tier, setTier] = useState(6);
  const [confirmBan, setConfirmBan] = useState(false);

  async function lookup(addr: string) {
    await act.run("user:lookup", async () => {
      const parsed = parseUserLookup(await api.get(adminUserLookupPath(addr.trim())));
      if (!parsed) throw new Error("lookup shape");
      setFound(parsed.user);
      setMissed(parsed.user === null);
      setConfirmBan(false);
      return undefined;
    });
  }

  async function banToggle(user: AdminUserLookup) {
    await act.run(`user:${user.banned ? "unban" : "ban"}`, async () => {
      await api.send(user.banned ? adminUserUnbanPath(user.id) : adminUserBanPath(user.id), "POST", {});
      setConfirmBan(false);
      await lookup(user.email);
      return user.banned ? "Account unbanned." : "Account banned.";
    });
  }

  async function grantTo(user: AdminUserLookup) {
    await act.run("user:grant", async () => {
      await api.send(ADMIN_CREDITS_GRANT_PATH, "POST", buildGrantBody({ amount: Number(amount), userId: user.id }));
      await lookup(user.email);
      return `${amount} Visual Bucs granted to ${user.email}.`;
    });
  }

  async function grantSelf() {
    await act.run("user:grant-self", async () => {
      await api.send(ADMIN_CREDITS_GRANT_PATH, "POST", buildGrantBody({ amount: Number(selfAmount) }));
      return `${selfAmount} Visual Bucs granted to your account.`;
    });
  }

  async function setPlan(user: AdminUserLookup | null) {
    await act.run("user:plan", async () => {
      await api.send(
        ADMIN_PLAN_SET_PATH,
        "POST",
        buildPlanBody(user ? { tier, userId: user.id } : { tier, email: email.trim() }),
      );
      if (user) await lookup(user.email);
      return `Plan tier set to ${tier}. A plan record, not a rank — Creator Level stars never move.`;
    });
  }

  return (
    <BenchSection
      isLight={isLight}
      title="Users, Grants & Plans"
      blurb="Look a member up, grant Visual Bucs, set a plan tier, or ban an account. Grants are the admin mint — the rail's own bounds (1–100,000)."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <div>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Member email"
              className={`${deskInputCls(isLight)} min-w-52 flex-1`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Member's email"
            />
            <button
              type="button"
              className={cls.goldBtn}
              disabled={act.busy !== null || !emailReady(email)}
              onClick={() => void lookup(email)}
            >
              <BusyLabel busy={act.busy === "user:lookup"}>Look up</BusyLabel>
            </button>
          </div>
          {missed ? (
            <p className={`mt-2 text-xs ${cls.subCls}`}>No account carries that email.</p>
          ) : null}

          {found ? (
            <div className={`mt-3 ${cls.rowCls}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-semibold ${cls.titleCls}`}>
                  {found.displayName ?? found.email}
                </span>
                {found.banned ? <StatusPill status="banned" isLight={isLight} /> : null}
                <span className={`text-xs ${cls.subCls}`}>
                  {found.credits.toLocaleString()} VB · plan {found.plan ?? "—"} · id{" "}
                  {shortId(found.id)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className={cls.labelCls} htmlFor="user-grant-amount">
                    Grant (VB)
                  </label>
                  <input
                    id="user-grant-amount"
                    className={deskInputCls(isLight)}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="numeric"
                    placeholder="1–100,000"
                  />
                </div>
                <button
                  type="button"
                  className={cls.smallBtn}
                  disabled={act.busy !== null || !grantAmountReady(amount)}
                  onClick={() => void grantTo(found)}
                >
                  <BusyLabel busy={act.busy === "user:grant"}>Grant to this member</BusyLabel>
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className={cls.labelCls} htmlFor="user-plan-tier">
                    Plan tier
                  </label>
                  <select
                    id="user-plan-tier"
                    className={cls.selectCls}
                    value={tier}
                    onChange={(e) => setTier(Number(e.target.value))}
                  >
                    {PLAN_TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                        {t <= 3 ? " — free" : t <= 5 ? " — pro" : " — elite"}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={cls.smallBtn}
                  disabled={act.busy !== null}
                  onClick={() => void setPlan(found)}
                >
                  <BusyLabel busy={act.busy === "user:plan"}>Set tier</BusyLabel>
                </button>
              </div>
              <div className="mt-3">
                {found.banned ? (
                  <button
                    type="button"
                    className={cls.smallBtn}
                    disabled={act.busy !== null}
                    onClick={() => void banToggle(found)}
                  >
                    <BusyLabel busy={act.busy === "user:unban"}>Unban this account</BusyLabel>
                  </button>
                ) : confirmBan ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-semibold ${cls.titleCls}`}>
                      Ban {found.email}? They lose access until unbanned.
                    </span>
                    <button
                      type="button"
                      className={cls.goldBtn}
                      disabled={act.busy !== null}
                      onClick={() => void banToggle(found)}
                    >
                      <BusyLabel busy={act.busy === "user:ban"}>Confirm ban</BusyLabel>
                    </button>
                    <button
                      type="button"
                      className={cls.ghostBtn}
                      onClick={() => setConfirmBan(false)}
                    >
                      Keep the account
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className={cls.smallBtn}
                    onClick={() => setConfirmBan(true)}
                  >
                    Ban this account…
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className={`mt-3 ${cls.rowCls}`}>
              <p className={`text-sm font-semibold ${cls.titleCls}`}>Set a plan by email</p>
              <p className={`mt-1 text-xs ${cls.subCls}`}>
                With no member looked up, the tier rides the email in the box above.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <select
                  aria-label="Plan tier"
                  className={cls.selectCls}
                  value={tier}
                  onChange={(e) => setTier(Number(e.target.value))}
                >
                  {PLAN_TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                      {t <= 3 ? " — free" : t <= 5 ? " — pro" : " — elite"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={cls.smallBtn}
                  disabled={act.busy !== null || !emailReady(email)}
                  onClick={() => void setPlan(null)}
                >
                  <BusyLabel busy={act.busy === "user:plan"}>Set tier</BusyLabel>
                </button>
              </div>
            </div>
          )}

          <div className={`mt-3 ${cls.rowCls}`}>
            <p className={`text-sm font-semibold ${cls.titleCls}`}>Grant to your own account</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <input
                aria-label="Grant amount for your account"
                className={deskInputCls(isLight)}
                value={selfAmount}
                onChange={(e) => setSelfAmount(e.target.value)}
                inputMode="numeric"
                placeholder="1–100,000"
              />
              <button
                type="button"
                className={cls.smallBtn}
                disabled={act.busy !== null || !grantAmountReady(selfAmount)}
                onClick={() => void grantSelf()}
              >
                <BusyLabel busy={act.busy === "user:grant-self"}>Grant to me</BusyLabel>
              </button>
            </div>
          </div>
          <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
        </div>
      )}
    </BenchSection>
  );
}

/* ═── Card + jewelry orders (read-only) ══════════════════════════ */

export function OrdersBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const nfc = useBench(async (a) => parseNfcOrders(await a.get(ADMIN_NFC_ORDERS_PATH)));
  const jewelry = useBench(async (a) => parseJewelryOrders(await a.get(ADMIN_JEWELRY_ORDERS_PATH)));

  return (
    <BenchSection
      isLight={isLight}
      title="Card & Jewelry Orders"
      blurb="Smart-card and jewelry orders, read-only. The makers' CSV export stays on the website bench — a file download leaves the palace."
    >
      <p className={`mb-1 text-xs font-bold uppercase tracking-wider ${cls.subCls}`}>Smart cards</p>
      <BenchStates isLight={isLight} phase={nfc.phase} failMessage={nfc.failMessage} onRetry={nfc.reload}>
        {nfc.data && nfc.data.length === 0 ? (
          <NativeEmptyState isLight={isLight} message="No card orders yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {nfc.data?.map((row) => (
              <div key={row.id} className={cls.rowCls}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={row.status} isLight={isLight} />
                  <span className={`text-sm font-semibold ${cls.titleCls}`}>
                    {row.itemLabel} × {row.quantity}
                  </span>
                  <span className={`text-xs ${cls.subCls}`}>{formatUsdCents(row.totalCents)}</span>
                </div>
                <p className={`mt-1 text-xs ${cls.subCls}`}>
                  {row.fullName} · {row.email}
                  {row.detail ? ` · ${row.detail}` : ""} ·{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </BenchStates>
      <p className={`mb-1 mt-4 text-xs font-bold uppercase tracking-wider ${cls.subCls}`}>Jewelry</p>
      <BenchStates isLight={isLight} phase={jewelry.phase} failMessage={jewelry.failMessage} onRetry={jewelry.reload}>
        {jewelry.data && jewelry.data.length === 0 ? (
          <NativeEmptyState isLight={isLight} message="No jewelry orders yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {jewelry.data?.map((row) => (
              <div key={row.id} className={cls.rowCls}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={row.status} isLight={isLight} />
                  <span className={`text-sm font-semibold ${cls.titleCls}`}>
                    {row.itemLabel} × {row.quantity}
                  </span>
                  <span className={`text-xs ${cls.subCls}`}>{formatUsdCents(row.totalCents)}</span>
                </div>
                <p className={`mt-1 text-xs ${cls.subCls}`}>
                  {row.fullName} · {row.email}
                  {row.detail ? ` · ${row.detail}` : ""} ·{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </BenchStates>
    </BenchSection>
  );
}

/* ═── Discord Bot (the Live Companion wiring) ════════════════════
   The /discord-bot setup page's admin side, native in the palace:
   the server-key presence, the install link, the announcement
   wiring, and the live line — on the page's own rails through the
   seam. PRESENCE ONLY: the bench renders which of the server's
   DISCORD_* keys EXIST (the seam's booleans) — a key's value never
   crosses the rail and nothing here could hold one. THE HONESTY
   (the website desk's, fix queue #8): an unset key reads amber
   "not set up" — a setup step, never a failure; while any core key
   is unset the bot is not connected, so the wiring form is locked
   as one fieldset with the reason shown, and the install link
   stays off while the client ID is unset (the rail refuses to
   build it). The install link is handed over as copyable text —
   following it is a browser act, and the palace does not pretend
   otherwise. */

function DiscordEnvBadge({
  ok,
  label,
  isLight,
}: {
  ok: boolean;
  label: string;
  isLight: boolean;
}) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
        ok
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-500"
          : "border-amber-400/40 bg-amber-400/10 text-amber-500"
      }`}
      data-testid={ok ? "world-discord-key-set" : "world-discord-key-unset"}
    >
      {label}: {ok ? "set" : "not set up"}
    </span>
  );
}

export function DiscordBench({ isLight }: { isLight: boolean }) {
  const cls = adminCls(isLight);
  const api = useAdminApi();
  const cfg = useBench(async (a) => parseDiscordBotConfig(await a.get(DISCORD_BOT_CONFIG_PATH)));
  const live = useBench(async (a) => parseDiscordBotLive(await a.get(DISCORD_BOT_LIVE_PATH)));
  const act = useBenchAction();
  const [draft, setDraft] = useState<DiscordBotDraft | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const read = cfg.data;
  const unconfigured = read ? discordBotUnconfigured(read) : false;
  const installBlocked = read ? discordInstallBlocked(read) : true;

  /* Seed the form from the saved row when the read lands. */
  useEffect(() => {
    if (read && draft === null) setDraft(discordBotDraftFrom(read));
  }, [read, draft]);

  function set<K extends keyof DiscordBotDraft>(key: K, value: DiscordBotDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function loadInstallUrl() {
    if (installBlocked) return;
    await act.run("discord:install", async () => {
      const url = parseDiscordInstallUrl(await api.get(DISCORD_BOT_INSTALL_URL_PATH));
      if (!url) throw new Error("install shape");
      setInstallUrl(url);
      setCopied(false);
      return undefined;
    });
  }

  async function save() {
    if (!draft || unconfigured) return;
    await act.run("discord:save", async () => {
      await api.send(DISCORD_BOT_CONFIG_PATH, "POST", buildDiscordBotConfigBody(draft));
      cfg.reload();
      return "Wiring saved — the bot announces from the next Go Live.";
    });
  }

  return (
    <BenchSection
      isLight={isLight}
      title="Discord Bot"
      blurb="The Live Companion bot's wiring — which server keys are in, the install link, and where go-live announcements land."
    >
      {act.denied ? (
        <BenchDenied isLight={isLight} />
      ) : (
        <BenchStates isLight={isLight} phase={cfg.phase} failMessage={cfg.failMessage} onRetry={cfg.reload}>
          {read ? (
            <div>
              {/* Server status — presence only, never a value. */}
              <div className="flex flex-wrap gap-2">
                <DiscordEnvBadge ok={read.env.clientIdSet} label="Discord client ID" isLight={isLight} />
                <DiscordEnvBadge ok={read.env.botTokenSet} label="Bot token" isLight={isLight} />
                <DiscordEnvBadge ok={read.env.sharedSecretSet} label="Shared secret" isLight={isLight} />
              </div>
              {unconfigured ? (
                <p className={`mt-2 text-xs ${cls.subCls}`} data-testid="world-discord-setup-note">
                  The bot isn&apos;t connected yet — nothing is broken. Until the server can
                  see all three keys, the wiring below stays locked: saved wiring would
                  announce nothing.
                </p>
              ) : null}

              {/* The live line — the same state the site's LIVE badge reads. */}
              <div className={`mt-3 ${cls.rowCls}`}>
                {live.phase === "ready" && live.data ? (
                  live.data.isLive ? (
                    <p className={`text-sm font-semibold ${cls.titleCls}`}>
                      Live now on Discord
                      {live.data.streamTitle ? ` — ${live.data.streamTitle}` : ""}
                      {live.data.channelName ? (
                        <span className={`block text-xs font-normal ${cls.subCls}`}>
                          in {live.data.channelName}
                          {live.data.startedAt
                            ? ` · since ${new Date(live.data.startedAt).toLocaleString()}`
                            : ""}
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <p className={`text-sm ${cls.subCls}`}>
                      {live.data.configured
                        ? "Not live on Discord right now."
                        : "The bot isn't wired to a server yet, so nothing reports live."}
                    </p>
                  )
                ) : live.phase === "failed" ? (
                  <p className={`text-sm ${cls.subCls}`}>The live state couldn&apos;t be read.</p>
                ) : (
                  <p className={`text-sm ${cls.subCls}`}>Checking the live state…</p>
                )}
              </div>

              {/* Install — the link, handed over as copyable text. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={cls.goldBtn}
                  disabled={installBlocked || act.busy !== null}
                  onClick={() => void loadInstallUrl()}
                >
                  <BusyLabel busy={act.busy === "discord:install"}>Get the install link</BusyLabel>
                </button>
                {installBlocked ? (
                  <span className={`text-xs ${cls.subCls}`}>
                    DISCORD_CLIENT_ID isn&apos;t set on the server yet — the install link
                    can&apos;t be built until it is.
                  </span>
                ) : null}
              </div>
              {installUrl ? (
                <div className={`mt-2 ${cls.rowCls}`}>
                  <p className={`break-all text-xs ${cls.titleCls}`}>{installUrl}</p>
                  <button
                    type="button"
                    className={`mt-2 inline-flex items-center gap-1.5 text-xs font-semibold ${
                      isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
                    }`}
                    onClick={() => {
                      void navigator.clipboard.writeText(installUrl).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy the install link"}
                  </button>
                </div>
              ) : null}

              {/* Wiring — one fieldset, locked whole while unconfigured. */}
              {unconfigured ? (
                <p className={`mb-2 mt-4 text-xs ${cls.subCls}`}>
                  Locked until the bot is connected — the reason is above.
                </p>
              ) : null}
              <form
                className="mt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={unconfigured} className="m-0 min-w-0 border-0 p-0">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={cls.labelCls} htmlFor="discord-guild-id">
                        Server (guild) ID
                      </label>
                      <input
                        id="discord-guild-id"
                        className={`${deskInputCls(isLight)} w-full`}
                        value={draft?.guildId ?? ""}
                        onChange={(e) => set("guildId", e.target.value)}
                        placeholder="123456789012345678"
                      />
                    </div>
                    <div>
                      <label className={cls.labelCls} htmlFor="discord-announce-channel-id">
                        Announcements channel ID
                      </label>
                      <input
                        id="discord-announce-channel-id"
                        className={`${deskInputCls(isLight)} w-full`}
                        value={draft?.announceChannelId ?? ""}
                        onChange={(e) => set("announceChannelId", e.target.value)}
                        placeholder="123456789012345678"
                      />
                    </div>
                    <div>
                      <label className={cls.labelCls} htmlFor="discord-announce-role-id">
                        Role ID to ping (optional)
                      </label>
                      <input
                        id="discord-announce-role-id"
                        className={`${deskInputCls(isLight)} w-full`}
                        value={draft?.announceRoleId ?? ""}
                        onChange={(e) => set("announceRoleId", e.target.value)}
                        placeholder="Role for live notifications"
                      />
                    </div>
                    <div>
                      <label className={cls.labelCls} htmlFor="discord-streamer-user-id">
                        Your Discord user ID (the streamer)
                      </label>
                      <input
                        id="discord-streamer-user-id"
                        className={`${deskInputCls(isLight)} w-full`}
                        value={draft?.streamerDiscordUserId ?? ""}
                        onChange={(e) => set("streamerDiscordUserId", e.target.value)}
                        placeholder="Your user ID"
                      />
                    </div>
                  </div>
                  {read.wiring?.streamerDiscordUsername ? (
                    <p className={`mt-2 text-xs ${cls.subCls}`}>
                      Streamer on record: {read.wiring.streamerDiscordUsername} — the bot
                      keeps this current from its own sightings.
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-col gap-2">
                    <label className={`flex items-center gap-2 text-sm ${cls.titleCls}`}>
                      <input
                        type="checkbox"
                        checked={draft?.mentionEveryone ?? false}
                        onChange={(e) => set("mentionEveryone", e.target.checked)}
                        className="h-4 w-4 accent-[#d4af37]"
                      />
                      Ping @everyone on go-live instead of a role
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${cls.titleCls}`}>
                      <input
                        type="checkbox"
                        checked={draft?.enabled ?? true}
                        onChange={(e) => set("enabled", e.target.checked)}
                        className="h-4 w-4 accent-[#d4af37]"
                      />
                      Bot announcements enabled
                    </label>
                  </div>
                  <div className="mt-3">
                    <button
                      type="submit"
                      className={cls.goldBtn}
                      disabled={act.busy !== null || unconfigured}
                    >
                      <BusyLabel busy={act.busy === "discord:save"}>Save configuration</BusyLabel>
                    </button>
                  </div>
                </fieldset>
              </form>
              <BenchOutcome note={act.note} error={act.error} isLight={isLight} />
            </div>
          ) : null}
        </BenchStates>
      )}
    </BenchSection>
  );
}
