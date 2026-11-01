import { apiErrorMessage } from "../lib/api-error";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Ban, Loader2, Package, PackageCheck, RotateCcw, Truck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  filterGearOrders,
  formatUsdCents,
  gearFulfillmentActions,
  gearNeedsTeam,
  gearProofSendAvailable,
  gearShipBlock,
  parseGearAdminOrders,
  GEAR_FILTERS,
  shortId,
  type GearAdminOrder,
  type GearFilter,
  type GearFulfillmentStatus,
} from "@/lib/admin-benches";
import { gearOption, gearProductById } from "@/lib/studio-gear";

/* ─── Admin: Studio Gear — the partner relay queue ─────────────────────
   The bench for GET /api/admin/studio-gear/orders (W6 finding F1: the
   rail had no frontend consumer, so the team's relay queue was
   invisible). The team relays two things, in the rail's own shapes:
     POST /admin/studio-gear/orders/:id/proof/send { proofUrl, proofNote }
     POST /admin/studio-gear/orders/:id/status     { status }
   Action availability mirrors the rail's state machines exactly —
   proof sends only from pending / revision-requested, fulfillment
   only along the order transitions, and Ship stays disabled with the
   reason shown while the order is unpaid or its proof unsettled (the
   route refuses those too, as defense in depth). This is the ONLY
   gear surface that shows the buyer's shipping contact — the partner
   ships direct, so the team needs it to hand the order over. */

const STATUS_CLS: Record<string, string> = {
  received: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  proof_pending: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  proof_sent: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  in_production: "border-violet-400/40 bg-violet-400/10 text-violet-300",
  shipped: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  delivered: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  canceled: "border-red-400/40 bg-red-400/10 text-red-300",
};

const STATUS_KEY: Record<string, string> = {
  received: "admin.gearQueue.status.received",
  proof_pending: "admin.gearQueue.status.proofPending",
  proof_sent: "admin.gearQueue.status.proofSent",
  in_production: "admin.gearQueue.status.inProduction",
  shipped: "admin.gearQueue.status.shipped",
  delivered: "admin.gearQueue.status.delivered",
  canceled: "admin.gearQueue.status.canceled",
};

const PROOF_KEY: Record<string, string> = {
  not_required: "admin.gearQueue.proofStatus.notRequired",
  pending: "admin.gearQueue.proofStatus.pending",
  sent: "admin.gearQueue.proofStatus.sent",
  approved: "admin.gearQueue.proofStatus.approved",
  revision_requested: "admin.gearQueue.proofStatus.revisionRequested",
};

const FILTER_KEY: Record<GearFilter, string> = {
  all: "admin.gearQueue.filterAll",
  received: STATUS_KEY.received!,
  proof_pending: STATUS_KEY.proof_pending!,
  proof_sent: STATUS_KEY.proof_sent!,
  in_production: STATUS_KEY.in_production!,
  shipped: STATUS_KEY.shipped!,
  delivered: STATUS_KEY.delivered!,
  canceled: STATUS_KEY.canceled!,
};

function productLabel(productId: string): string {
  try {
    return gearProductById(productId as Parameters<typeof gearProductById>[0]).label;
  } catch {
    return productId;
  }
}

function optionLabel(productId: string, optionKey: string): string {
  try {
    const product = gearProductById(productId as Parameters<typeof gearProductById>[0]);
    return gearOption(product, optionKey).label;
  } catch {
    return optionKey;
  }
}

export function StudioGearQueueAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [orders, setOrders] = useState<GearAdminOrder[]>([]);
  const [filter, setFilter] = useState<GearFilter>("all");
  const [loading, setLoading] = useState(true);
  /* Load failures are NOT "no orders" — own error state + retry. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofForms, setProofForms] = useState<Record<string, { url: string; note: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/studio-gear/orders", { headers: await authHeaders() });
      const parsed = res.ok ? parseGearAdminOrders(await res.json()) : null;
      if (parsed) setOrders(parsed.orders);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  async function sendProof(order: GearAdminOrder) {
    const form = proofForms[order.id] ?? { url: "", note: "" };
    const proofUrl = form.url.trim();
    if (!proofUrl) {
      setError(t("admin.gearQueue.proofUrlRequired"));
      return;
    }
    setBusyId(order.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/studio-gear/orders/${order.id}/proof/send`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ proofUrl, proofNote: form.note.trim() || undefined }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(apiErrorMessage(data, t("admin.gearQueue.actionError")));
      const body = (data ?? {}) as { proofStatus?: string; status?: string };
      setOrders((list) =>
        list.map((o) =>
          o.id === order.id
            ? {
                ...o,
                proofStatus: body.proofStatus ?? "sent",
                status: body.status ?? o.status,
                proofUrl,
                proofNote: form.note.trim() || null,
              }
            : o,
        ),
      );
      setProofForms((forms) => ({ ...forms, [order.id]: { url: "", note: "" } }));
    } catch {
      /* Error-truth guard: a caught message never reaches the render —
         the fixed translated copy stands for every failure shape (the
         PaymentReversalsAdmin pattern). */
      setError(t("admin.gearQueue.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(order: GearAdminOrder, status: GearFulfillmentStatus) {
    setBusyId(order.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/studio-gear/orders/${order.id}/status`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(apiErrorMessage(data, t("admin.gearQueue.actionError")));
      const body = (data ?? {}) as { status?: string };
      setOrders((list) =>
        list.map((o) => (o.id === order.id ? { ...o, status: body.status ?? status } : o)),
      );
    } catch {
      /* Error-truth guard: a caught message never reaches the render —
         the fixed translated copy stands for every failure shape (the
         PaymentReversalsAdmin pattern). */
      setError(t("admin.gearQueue.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  const visible = filterGearOrders(orders, filter);
  const waiting = orders.filter(gearNeedsTeam).length;

  return (
    <div
      className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="studio-gear-queue"
    >
      <div className="flex items-center gap-2 mb-1">
        <Package className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.gearQueue.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">{t("admin.gearQueue.description")}</p>

      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("admin.gearQueue.loadErrorTitle")}
          </p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("admin.gearQueue.loadErrorBody")}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-white/40">{t("admin.gearQueue.empty")}</p>
      ) : (
        <>
          {waiting > 0 && (
            <p className="mb-4 text-sm text-white/60">
              {t("admin.gearQueue.waitingCount", { count: waiting })}
            </p>
          )}
          <div className="mb-4 flex flex-wrap gap-2">
            {GEAR_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  filter === f
                    ? "border-primary/60 bg-primary/15 text-[#e8c86a]"
                    : "border-white/10 bg-black/30 text-white/50 hover:text-white"
                }`}
              >
                {t(FILTER_KEY[f])}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-white/40">{t("admin.gearQueue.emptyFilter")}</p>
          ) : (
            <div className="space-y-3">
              {visible.map((o) => {
                const shipBlock = gearShipBlock(o);
                const form = proofForms[o.id] ?? { url: "", note: "" };
                return (
                  <div key={o.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <p className="text-sm font-semibold text-white">
                        {shortId(o.id)}
                        <span className="ml-2 text-xs font-normal text-white/30">
                          {new Date(o.createdAt).toLocaleString()}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {gearNeedsTeam(o) && (
                          <span className="rounded-full border border-[#C9A84C]/50 bg-[#C9A84C]/10 px-2 py-0.5 text-[11px] font-semibold text-[#e8c86a]">
                            {t("admin.gearQueue.needsTeam")}
                          </span>
                        )}
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[o.status] ?? STATUS_CLS.received}`}>
                          {t(STATUS_KEY[o.status] ?? "", { defaultValue: o.status })}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-white/70">
                          {t("admin.gearQueue.proof")}: {t(PROOF_KEY[o.proofStatus] ?? "", { defaultValue: o.proofStatus })}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${o.paid ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-white/15 bg-white/5 text-white/70"}`}>
                          {o.paid ? t("admin.gearQueue.paid") : t("admin.gearQueue.unpaid")}
                        </span>
                        {o.testMode && (
                          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-white/70">
                            {t("admin.gearQueue.testMode")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {o.items.map((item, i) => (
                        <div key={i} className="text-sm text-white/70">
                          <span className="font-semibold text-white">{productLabel(item.product)}</span>
                          {" — "}
                          {optionLabel(item.product, item.option)}
                          {" · "}
                          {item.variant === "custom" ? t("admin.gearQueue.variantCustom") : t("admin.gearQueue.variantHouse")}
                          {" · ×"}
                          {item.qty}
                          {" · "}
                          {formatUsdCents(item.unitPriceCents * item.qty)}
                          {(item.customText || item.specNotes || item.artworkUrl) && (
                            <div className="mt-1 space-y-0.5 text-xs text-white/50">
                              {item.customText && (
                                <p>{t("admin.gearQueue.customText")}: {item.customText}</p>
                              )}
                              {item.specNotes && (
                                <p>{t("admin.gearQueue.specNotes")}: {item.specNotes}</p>
                              )}
                              {item.artworkUrl && (
                                <p>
                                  {t("admin.gearQueue.artwork")}:{" "}
                                  <a href={item.artworkUrl} target="_blank" rel="noreferrer" className="text-[#e8c86a] underline hover:text-white">
                                    {item.artworkUrl}
                                  </a>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      <p className="text-sm text-white/60">
                        {t("admin.gearQueue.total")}{" "}
                        <span className="font-semibold text-white/90">{formatUsdCents(o.totalCents)}</span>
                      </p>
                    </div>

                    <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-white/60">
                      <p className="font-semibold text-white/80">
                        {t("admin.gearQueue.buyer")}: {o.buyer.name} · {o.buyer.email}
                      </p>
                      <p className="mt-0.5">
                        {o.buyer.address}, {o.buyer.city}, {o.buyer.state} {o.buyer.zip}
                      </p>
                    </div>

                    {(o.proofUrl || o.proofNote) && (
                      <div className="mt-3 text-xs text-white/60">
                        {o.proofUrl && (
                          <p>
                            <a href={o.proofUrl} target="_blank" rel="noreferrer" className="text-[#e8c86a] underline hover:text-white">
                              {t("admin.gearQueue.viewProof")}
                            </a>
                          </p>
                        )}
                        {o.proofNote && (
                          <p className="mt-1">
                            <span className="font-semibold text-white/80">
                              {o.proofStatus === "revision_requested"
                                ? t("admin.gearQueue.buyerRevisionLabel")
                                : t("admin.gearQueue.proofNoteLabel")}
                              :{" "}
                            </span>
                            {o.proofNote}
                          </p>
                        )}
                      </div>
                    )}

                    {gearProofSendAvailable(o) && (
                      <div className="mt-3 space-y-2">
                        <input
                          aria-label={t("admin.gearQueue.proofUrlPlaceholder")}
                          type="url"
                          placeholder={t("admin.gearQueue.proofUrlPlaceholder")}
                          value={form.url}
                          onChange={(e) =>
                            setProofForms((forms) => ({ ...forms, [o.id]: { ...form, url: e.target.value } }))
                          }
                          disabled={busyId === o.id}
                          className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                        />
                        <input
                          aria-label={t("admin.gearQueue.proofNotePlaceholder")}
                          type="text"
                          placeholder={t("admin.gearQueue.proofNotePlaceholder")}
                          value={form.note}
                          onChange={(e) =>
                            setProofForms((forms) => ({ ...forms, [o.id]: { ...form, note: e.target.value } }))
                          }
                          disabled={busyId === o.id}
                          className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                        />
                        <button
                          type="button"
                          onClick={() => { void sendProof(o); }}
                          disabled={busyId === o.id}
                          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
                        >
                          {busyId === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {t("admin.gearQueue.sendProofButton")}
                        </button>
                      </div>
                    )}

                    {gearFulfillmentActions(o).length > 0 && (
                      <div className="mt-3">
                        <div className="flex flex-wrap gap-2">
                          {gearFulfillmentActions(o).map((next) => (
                            <button
                              key={next}
                              type="button"
                              disabled={busyId === o.id || (next === "shipped" && shipBlock !== null)}
                              title={
                                next === "shipped" && shipBlock === "unpaid"
                                  ? t("admin.gearQueue.shipNeedsPaid")
                                  : next === "shipped" && shipBlock === "proof_open"
                                    ? t("admin.gearQueue.shipNeedsProof")
                                    : undefined
                              }
                              onClick={() => { void setStatus(o, next); }}
                              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/80 hover:text-white disabled:opacity-40"
                            >
                              {busyId === o.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : next === "shipped" ? (
                                <Truck className="h-3.5 w-3.5" />
                              ) : next === "delivered" ? (
                                <PackageCheck className="h-3.5 w-3.5" />
                              ) : (
                                <Ban className="h-3.5 w-3.5" />
                              )}
                              {next === "shipped"
                                ? t("admin.gearQueue.markShipped")
                                : next === "delivered"
                                  ? t("admin.gearQueue.markDelivered")
                                  : t("admin.gearQueue.cancelOrder")}
                            </button>
                          ))}
                        </div>
                        {shipBlock === "unpaid" && (
                          <p className="mt-1.5 text-xs text-white/40">{t("admin.gearQueue.shipNeedsPaid")}</p>
                        )}
                        {shipBlock === "proof_open" && (
                          <p className="mt-1.5 text-xs text-white/40">{t("admin.gearQueue.shipNeedsProof")}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-[11px] text-white/30">{t("admin.gearQueue.footerNote")}</p>
    </div>
  );
}
