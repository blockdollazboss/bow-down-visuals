import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BadgeDollarSign, CheckCircle2, Inbox, Loader2, Sparkles, Upload, Video, Wand2, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "@/components/world/native/NativeCard";
import { NativeErrorState, NativeLoadingState } from "@/components/world/native/NativeStates";
import { centsToDisplay } from "@/lib/shops";
import {
  SHOUTOUT_AI_MESSAGE_COST_VB,
  buildShoutoutAiMessageBody,
  buildShoutoutStatusBody,
  isPaidShoutout,
  normalizeShoutoutAiDraft,
  normalizeShoutoutRequest,
  normalizeShoutoutRequests,
  normalizeShoutoutRevenue,
  shoutoutActionsFor,
  shoutoutDeclineConsequence,
  shoutoutDeliveryFileReady,
  shoutoutRequestPath,
  shoutoutRequestsPath,
  shoutoutUploadRef,
  SHOUTOUT_AI_MESSAGE_PATH,
  SHOUTOUT_REVENUE_PATH,
  SHOUTOUT_UPLOAD_CLIP_PATH,
  SHOUTOUT_FILTER_STATUSES,
  type ShoutoutRevenue,
  type ShoutoutSellRequest,
} from "@/lib/world/shoutouts-sell-desk";

/* ─── ShoutoutsSellDesk — the creator's shoutout counter ──────────
   The sell-side half of Fan Shoutouts, native at the Marketplace
   square beside the buy-side desk, riding the shoutouts router's
   own rails — the same ones the website's Creator Dashboard tab
   calls (pages/shoutouts.tsx):
   - the incoming-requests inbox (GET /api/shoutouts/requests,
     with the rail's own status filter);
   - accept / start recording / deliver (PATCH …/requests/:id on
     the rail's transition map — the desk offers only the verbs
     the map allows from the request's current status, so no tap
     is born 409);
   - deliver by upload (POST /api/upload-clip, the page's rail,
     ≤ 80 MB) or by pasted video URL, exactly the page's two ways;
   - revenue (GET /api/shoutouts/revenue): counts and the gross /
     you-keep figures are the rail's own sums at its flat 5% fee —
     the desk computes no money of its own;
   - the message helper (POST /api/shoutouts/ai-message, 100
     Visual Bucs from the registry row, confirmed through
     useConfirmedApi): turns a fan's request into words that read
     well out loud, for the recording.
   DECLINE tells the money truth before the tap (the rail's settled
   behavior, owner ruling stack1400 #15): declining a PAID request
   refunds the fan in full automatically and lands the request in
   "refunded"; declining an unpaid one just declines. The decline
   is a two-tap arm naming the exact consequence; if the refund
   fails the rail refuses the decline (502) and its plain sentence
   is what the desk shows — the request stands, ready to retry.
   Reads settle independently per section, the page's own pattern:
   one source failing shows its own error with a retry, and a
   source that loaded once keeps its data on a later failed
   reload — a failed read never paints as an empty inbox.
   Guests get the page's own sign-in line: every sell rail is
   requireAuth. Copy discipline: rail words and the shoutouts
   catalog's labels ride verbatim; the desk's own new sentences
   are plain literals (the BooksDesk precedent). */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

const STATUS_PILL: Record<string, string> = {
  pending_payment: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  accepted: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  in_progress: "text-violet-300 border-violet-500/40 bg-violet-500/10",
  delivered: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  declined: "text-white/40 border-white/15 bg-white/5",
  refunded: "text-white/40 border-white/15 bg-white/5",
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  pending_payment: "shoutouts.statusAwaitingPayment",
  accepted: "shoutouts.statusAccepted",
  in_progress: "shoutouts.statusRecording",
  delivered: "shoutouts.statusDelivered",
  declined: "shoutouts.statusDeclined",
};

export function ShoutoutsSellDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();

  const [requests, setRequests] = useState<ShoutoutSellRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState(false);
  const requestsLoadedRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [revenue, setRevenue] = useState<ShoutoutRevenue | null>(null);
  const [revenueError, setRevenueError] = useState(false);
  const revenueLoadedRef = useRef(false);

  const [acting, setActing] = useState("");
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowNote, setRowNote] = useState<Record<string, string>>({});
  const [deliveryUrls, setDeliveryUrls] = useState<Record<string, string>>({});
  const [declineArmed, setDeclineArmed] = useState("");
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  /* The message helper, per request: the fan's own words are the
     notes; the draft comes back as words to read on camera. */
  const [aiOpen, setAiOpen] = useState("");
  const [aiNotes, setAiNotes] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState("");
  const [aiError, setAiError] = useState<Record<string, string>>({});
  const [aiOutOfCredits, setAiOutOfCredits] = useState<Record<string, string>>({});
  const [aiDraft, setAiDraft] = useState<Record<string, string>>({});

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const ink = isLight ? "text-[#2a1e07]" : "text-white";

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(shoutoutRequestsPath(statusFilter), {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("load failed");
      const parsed = normalizeShoutoutRequests(await res.json().catch(() => null));
      if (!parsed) throw new Error("load failed");
      setRequests(parsed);
      requestsLoadedRef.current = true;
      setRequestsError(false);
    } catch {
      if (!requestsLoadedRef.current) setRequestsError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const loadRevenue = useCallback(async () => {
    try {
      const res = await fetch(SHOUTOUT_REVENUE_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("load failed");
      const parsed = normalizeShoutoutRevenue(await res.json().catch(() => null));
      if (!parsed) throw new Error("load failed");
      setRevenue(parsed);
      revenueLoadedRef.current = true;
      setRevenueError(false);
    } catch {
      if (!revenueLoadedRef.current) setRevenueError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isGuest) return;
    void loadRequests();
  }, [isGuest, loadRequests]);

  useEffect(() => {
    if (isGuest) return;
    void loadRevenue();
  }, [isGuest, loadRevenue]);

  async function patchRequest(
    req: ShoutoutSellRequest,
    status: "accepted" | "in_progress" | "delivered" | "declined",
    deliveryUrl = "",
  ): Promise<void> {
    setActing(req.id + status);
    setRowError((e) => ({ ...e, [req.id]: "" }));
    try {
      const res = await fetch(shoutoutRequestPath(req.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildShoutoutStatusBody(status, deliveryUrl)),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        /* The rail's own plain sentence answers — on a paid decline
           whose refund failed, that sentence IS the truth: the
           decline didn't land. */
        throw new Error(apiErrorMessage(j, t("worldRemainder.shoUpdateFailed", { status: res.status })));
      }
      const updated = normalizeShoutoutRequest(j);
      if (status === "declined" && updated?.status === "refunded") {
        setRowNote((n) => ({
          ...n,
          [req.id]: t("worldRemainder.shoDeclinedRefunded", {
            fan: req.fanName,
            amount: centsToDisplay(req.priceCents),
          }),
        }));
      }
      setDeclineArmed("");
      await Promise.all([loadRequests(), loadRevenue()]);
    } catch (err) {
      setRowError((e) => ({ ...e, [req.id]: plainErrorText(err, t("worldRemainder.shoDidntGoThrough")) }));
    } finally {
      setActing("");
    }
  }

  /* Upload the finished video through the page's own rail, then
     deliver with the stored ref in the same step. */
  async function uploadDelivery(req: ShoutoutSellRequest, file: File) {
    if (!shoutoutDeliveryFileReady(file.size)) {
      setRowError((e) => ({
        ...e,
        [req.id]: t("worldRemainder.shoVideoTooBig"),
      }));
      return;
    }
    setUploading((u) => ({ ...u, [req.id]: true }));
    setRowError((e) => ({ ...e, [req.id]: "" }));
    try {
      const token = (await authHeaders())["Authorization"];
      if (!token) throw new Error(t("shoutouts.errorUploadSignIn"));
      const form = new FormData();
      form.append("clip", file, file.name);
      const upRes = await fetch(SHOUTOUT_UPLOAD_CLIP_PATH, {
        method: "POST",
        headers: { Authorization: token },
        body: form,
      });
      const upData = (await upRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!upRes.ok) throw new Error(apiErrorMessage(upData, t("worldRemainder.shoUploadFailed", { status: upRes.status })));
      const stored = shoutoutUploadRef(upData);
      if (!stored) throw new Error(t("shoutouts.errorUploadNoRef"));
      await patchRequest(req, "delivered", stored);
      setDeliveryUrls((d) => ({ ...d, [req.id]: "" }));
    } catch (err) {
      setRowError((e) => ({
        ...e,
        [req.id]: plainErrorText(err, t("shoutouts.errorUploadFailed")),
      }));
    } finally {
      setUploading((u) => ({ ...u, [req.id]: false }));
    }
  }

  async function polishWords(req: ShoutoutSellRequest) {
    setAiBusy(req.id);
    setAiError((e) => ({ ...e, [req.id]: "" }));
    setAiOutOfCredits((e) => ({ ...e, [req.id]: "" }));
    try {
      const res = await confirmedFetch(SHOUTOUT_AI_MESSAGE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildShoutoutAiMessageBody({
            occasion: req.occasion,
            notes: (aiNotes[req.id] ?? req.message).slice(0, 600),
          }),
        ),
      });
      if (!res) return; /* the walker declined the Bucs confirm */
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setAiOutOfCredits((e) => ({
          ...e,
          [req.id]: apiErrorMessage(j, t("worldRemainder.shoOutOfCredits")),
        }));
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(j, t("shoutouts.errorPolishFailed")));
      }
      const draft = normalizeShoutoutAiDraft(j);
      if (!draft) throw new Error(t("shoutouts.errorPolishFailed"));
      setAiDraft((d) => ({ ...d, [req.id]: draft.message }));
    } catch (err) {
      setAiError((e) => ({
        ...e,
        [req.id]: plainErrorText(err, t("shoutouts.errorPolishFailed")),
      }));
    } finally {
      setAiBusy("");
    }
  }

  if (isGuest) {
    return (
      <NativeCard isLight={isLight} title={t("worldRemainder.shoGuestTitle")}>
        <p data-testid="world-shoutouts-sell-signin" className={`text-sm ${muted}`}>
          {t("shoutouts.creatorSignInPrompt")}
        </p>
      </NativeCard>
    );
  }

  const btnCls =
    "px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 bdv-touch-target";

  return (
    <div data-testid="world-shoutouts-sell-desk" className="flex flex-col gap-3">
      <NativeCard isLight={isLight} title={t("shoutouts.revenueTitle")}>
        {revenueError ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldRemainder.shoRevenueLoadTitle")}
            message={t("worldRemainder.shoRevenueLoadMessage")}
            onRetry={() => void loadRevenue()}
          />
        ) : revenue === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldRemainder.shoRevenueLoading")} />
        ) : (
          <div data-testid="world-shoutouts-sell-revenue">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: t("shoutouts.statRequests"), value: String(revenue.total), icon: Inbox },
                { label: t("shoutouts.statDelivered"), value: String(revenue.delivered), icon: CheckCircle2 },
                { label: t("shoutouts.statGross"), value: centsToDisplay(revenue.grossCents), icon: BadgeDollarSign },
                { label: t("shoutouts.statYouKeep"), value: centsToDisplay(revenue.netCents), icon: Sparkles },
              ].map((st) => (
                <div
                  key={st.label}
                  className={`rounded-xl border p-3 ${
                    isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-white/10 bg-black/40"
                  }`}
                >
                  <st.icon className="mb-1 h-4 w-4 text-[#d4af37]" />
                  <p className={`text-xl font-black ${ink}`}>{st.value}</p>
                  <p className={`text-[11px] ${muted}`}>{st.label}</p>
                </div>
              ))}
            </div>
            <p className={`mt-3 text-[11px] ${muted}`}>
              {t("worldRemainder.shoFeeLine", { pct: revenue.platformFeePct })}
            </p>
          </div>
        )}
      </NativeCard>

      <NativeCard isLight={isLight} title={t("shoutouts.incomingRequests")}>
        <div className="mb-3 flex items-center justify-end">
          <select
            aria-label={t("worldRemainder.shoFilterAria")}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              isLight
                ? "border-[#C9A84C]/40 bg-white/70 text-[#2a1e07]"
                : "border-white/10 bg-black text-white/80"
            }`}
          >
            <option value="">{t("shoutouts.allStatuses")}</option>
            {SHOUTOUT_FILTER_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.labelKey)}
              </option>
            ))}
          </select>
        </div>
        {requestsError ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldRemainder.shoRequestsLoadTitle")}
            message={t("worldRemainder.shoRequestsLoadMessage")}
            onRetry={() => void loadRequests()}
          />
        ) : requests === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldRemainder.shoRequestsLoading")} />
        ) : requests.length === 0 ? (
          <p className={`py-4 text-center text-sm ${muted}`}>{t("shoutouts.noRequests")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((r) => {
              const actions = shoutoutActionsFor(r.status);
              const consequence = shoutoutDeclineConsequence(r);
              const armed = declineArmed === r.id;
              return (
                <div
                  key={r.id}
                  data-testid="world-shoutout-sell-row"
                  className={`rounded-xl border p-4 ${
                    isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-white/10 bg-black/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`font-semibold ${ink}`}>
                        {r.fanName}{" "}
                        <span className={`text-sm font-normal ${muted}`}>· {r.occasion}</span>
                      </p>
                      <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
                        {"“"}{r.message}{"”"}
                      </p>
                      <p className={`mt-1 text-[11px] ${muted}`}>
                        {centsToDisplay(r.priceCents)} ·{" "}
                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString(i18n.language) : ""}
                        {r.priceCents > 0
                          ? isPaidShoutout(r)
                            ? t("worldRemainder.shoPaidSuffix")
                            : t("worldRemainder.shoNotPaidSuffix")
                          : t("worldRemainder.shoFreeSuffix")}
                      </p>
                      {r.deliveryUrl && (
                        <a
                          href={r.deliveryUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-[#d4af37] underline"
                        >
                          {t("shoutouts.viewDeliveredVideo")}
                        </a>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        STATUS_PILL[r.status] ?? ""
                      }`}
                    >
                      {STATUS_LABEL_KEYS[r.status] ? t(STATUS_LABEL_KEYS[r.status]!) : t("worldRemainder.shoRefunded")}
                    </span>
                  </div>

                  {rowNote[r.id] && (
                    <p className="mt-2 text-xs font-semibold text-emerald-300">{rowNote[r.id]}</p>
                  )}
                  {rowError[r.id] && (
                    <p className="mt-2 text-xs text-red-400">{rowError[r.id]}</p>
                  )}

                  {actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {actions.includes("accept") && (
                        <button
                          type="button"
                          disabled={!!acting}
                          onClick={() => void patchRequest(r, "accepted")}
                          className={`${btnCls} border border-yellow-500/40 bg-[#C9A84C]/15 text-yellow-200 hover:bg-[#C9A84C]/25`}
                        >
                          {t("shoutouts.acceptButton")}
                        </button>
                      )}
                      {actions.includes("start") && (
                        <button
                          type="button"
                          disabled={!!acting}
                          onClick={() => void patchRequest(r, "in_progress")}
                          className={`${btnCls} border border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25`}
                        >
                          {t("shoutouts.startRecordingButton")}
                        </button>
                      )}
                      {actions.includes("deliver") && (
                        <>
                          <label
                            className={`${btnCls} cursor-pointer border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 ${
                              uploading[r.id] ? "pointer-events-none opacity-50" : ""
                            }`}
                          >
                            {uploading[r.id] ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" />
                            )}
                            {uploading[r.id]
                              ? t("shoutouts.uploadingLabel")
                              : t("shoutouts.uploadAndDeliverButton")}
                            <input
                              type="file"
                              accept="video/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void uploadDelivery(r, f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <input
                            aria-label={t("shoutouts.pasteUrlPlaceholder")}
                            value={deliveryUrls[r.id] ?? ""}
                            onChange={(e) =>
                              setDeliveryUrls((d) => ({ ...d, [r.id]: e.target.value }))
                            }
                            placeholder={t("shoutouts.pasteUrlPlaceholder")}
                            className={`min-w-[180px] flex-1 rounded-lg border px-3 py-1.5 text-xs ${
                              isLight
                                ? "border-[#C9A84C]/30 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
                                : "border-white/10 bg-black text-white placeholder:text-white/25"
                            }`}
                          />
                          <button
                            type="button"
                            disabled={!!acting}
                            onClick={() =>
                              void patchRequest(r, "delivered", deliveryUrls[r.id] ?? "")
                            }
                            className={`${btnCls} border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25`}
                          >
                            {t("shoutouts.markDeliveredButton")}
                          </button>
                        </>
                      )}
                      {(r.status === "accepted" || r.status === "in_progress") && (
                        <button
                          type="button"
                          aria-expanded={aiOpen === r.id}
                          onClick={() => {
                            setAiOpen(aiOpen === r.id ? "" : r.id);
                            setAiNotes((n) => ({ ...n, [r.id]: n[r.id] ?? r.message }));
                          }}
                          className={`${btnCls} border border-yellow-500/30 text-[#d4af37] hover:bg-[#C9A84C]/10`}
                        >
                          <Wand2 className="h-3 w-3" /> {t("shoutouts.aiPolishButton")}
                        </button>
                      )}
                      {actions.includes("decline") && !armed && (
                        <button
                          type="button"
                          disabled={!!acting}
                          onClick={() => setDeclineArmed(r.id)}
                          className={`${btnCls} border ${
                            isLight
                              ? "border-[#C9A84C]/40 text-[#6B5B36] hover:border-red-500/40 hover:text-red-600"
                              : "border-white/15 text-white/50 hover:border-red-500/40 hover:text-red-300"
                          }`}
                        >
                          <X className="h-3 w-3" /> {t("shoutouts.declineButton")}
                        </button>
                      )}
                    </div>
                  )}

                  {armed && (
                    <div
                      data-testid="world-shoutout-sell-decline-arm"
                      className="mt-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] px-3 py-2.5"
                    >
                      <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/70"}`}>
                        {consequence.kind === "refund"
                          ? t("worldRemainder.shoDeclineRefund", {
                              fan: r.fanName,
                              amount: centsToDisplay(consequence.amountCents),
                            })
                          : r.priceCents > 0
                            ? t("worldRemainder.shoDeclineUnpaid", { fan: r.fanName })
                            : t("worldRemainder.shoDeclineFree")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!!acting}
                          onClick={() => void patchRequest(r, "declined")}
                          className={`${btnCls} border border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25`}
                        >
                          {acting === r.id + "declined" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {consequence.kind === "refund"
                            ? t("worldRemainder.shoDeclineRefundButton", {
                                amount: centsToDisplay(consequence.amountCents),
                              })
                            : t("worldRemainder.shoDeclineButton")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeclineArmed("")}
                          className={`${btnCls} border ${
                            isLight
                              ? "border-[#C9A84C]/40 text-[#6B5B36]"
                              : "border-white/15 text-white/60"
                          }`}
                        >
                          {t("worldRemainder.shoKeepRequest")}
                        </button>
                      </div>
                    </div>
                  )}

                  {aiOpen === r.id && (
                    <div
                      data-testid="world-shoutout-sell-ai"
                      className={`mt-3 rounded-xl border px-3 py-2.5 ${
                        isLight ? "border-[#C9A84C]/30 bg-white/50" : "border-white/10 bg-white/5"
                      }`}
                    >
                      <p className={`inline-flex items-center gap-1.5 text-xs font-bold ${ink}`}>
                        <Video className="h-3.5 w-3.5 text-[#d4af37]" />
                        {t("worldRemainder.shoAiTitle", { cost: SHOUTOUT_AI_MESSAGE_COST_VB })}
                      </p>
                      <p className={`mt-1 text-[11px] ${muted}`}>
                        {t("worldRemainder.shoAiIntro")}
                      </p>
                      <textarea
                        aria-label={t("worldRemainder.shoAiNotesAria")}
                        value={aiNotes[r.id] ?? r.message}
                        onChange={(e) => setAiNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                        rows={3}
                        maxLength={600}
                        className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm ${
                          isLight
                            ? "border-[#C9A84C]/30 bg-white/70 text-[#2a1e07]"
                            : "border-white/10 bg-black text-white"
                        }`}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={aiBusy === r.id}
                          onClick={() => void polishWords(r)}
                          className={`${btnCls} border border-yellow-500/30 text-[#d4af37] hover:bg-[#C9A84C]/10`}
                        >
                          {aiBusy === r.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Wand2 className="h-3 w-3" />
                          )}
                          {t("shoutouts.aiPolishButton")}
                        </button>
                        {aiError[r.id] && <p className="text-xs text-red-400">{aiError[r.id]}</p>}
                        {aiOutOfCredits[r.id] && (
                          <p className="text-xs font-semibold text-amber-300">{aiOutOfCredits[r.id]}</p>
                        )}
                      </div>
                      {aiDraft[r.id] && (
                        <p
                          data-testid="world-shoutout-sell-ai-draft"
                          className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                            isLight
                              ? "border-emerald-500/30 bg-emerald-500/[0.06] text-[#2a1e07]"
                              : "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-100"
                          }`}
                        >
                          {"“"}{aiDraft[r.id]}{"”"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </NativeCard>
    </div>
  );
}
