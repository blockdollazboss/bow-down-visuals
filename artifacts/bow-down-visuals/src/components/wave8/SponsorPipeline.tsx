import { useEffect, useState } from "react";
import {
  Plus, X, Loader2, AlertTriangle, Handshake, Sparkles, Copy, Check,
  ChevronLeft, ChevronRight, Pencil, BadgeCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── Sponsor Deal Pipeline (Wave 8) ──────────────────────────────────────
   Docked on the Sponsorship Outreach page (/outreach), after the invoice
   generator. Deal CRUD is free (/api/wave8/sponsors/deals); the AI
   follow-up draft costs 50 Visual Bucs (/api/wave8/sponsors/followup).
   "Mark Paid" moves a closed deal to Paid and logs the deal value to the
   income ledger via the free /api/money route. */

type Stage = "pitched" | "negotiating" | "closed" | "paid";

interface Deal {
  id: string;
  sponsorName: string;
  stage: Stage;
  dealValueCents: number;
  contact: string;
  notes: string;
  lastFollowupAt: string | null;
  createdAt: string;
}

interface Draft {
  subject: string;
  body: string;
}

const STAGES: Stage[] = ["pitched", "negotiating", "closed", "paid"];
const FOLLOWUP_CREDITS = 50;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass = "mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40";

const sectionTitle =
  "mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80";

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SponsorPipeline() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [fName, setFName] = useState("");
  const [fValue, setFValue] = useState("");
  const [fContact, setFContact] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [movingId, setMovingId] = useState<string | null>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [cardMsg, setCardMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  function clearCardMsg(id: string) {
    setCardMsg((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /* inline edit (value / contact / notes) */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eValue, setEValue] = useState("");
  const [eContact, setEContact] = useState("");
  const [eNotes, setENotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  function stageLabel(s: Stage): string {
    return t(`wave8.sponsors.stage${s[0]!.toUpperCase()}${s.slice(1)}`);
  }

  async function loadDeals() {
    if (!user) {
      setLoading(false);
      setDeals([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/wave8/sponsors/deals", { skipConfirm: true });
      if (!res) {
        setLoading(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { deals?: Deal[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("wave8.sponsors.errorLoad"));
      setDeals(Array.isArray(data.deals) ? data.deals : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave8.sponsors.errorLoad"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function patchDeal(id: string, body: Record<string, unknown>): Promise<Deal | null> {
    const res = await confirmedFetch(`/api/wave8/sponsors/deals/${id}`, {
      skipConfirm: true,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res) return null;
    const data = (await res.json().catch(() => ({}))) as { deal?: Deal; error?: string; message?: string };
    if (!res.ok || !data.deal) throw new Error(data.message || data.error || t("wave8.sponsors.errorUpdate"));
    return data.deal;
  }

  async function handleSave() {
    if (saving || !fName.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const dollars = parseFloat(fValue);
      const valueCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
      const res = await confirmedFetch("/api/wave8/sponsors/deals", {
        skipConfirm: true,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sponsorName: fName.trim(),
          dealValueCents: valueCents,
          contact: fContact.trim(),
          notes: fNotes.trim(),
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as { deal?: Deal; error?: string };
      if (!res.ok || !data.deal) throw new Error(data.error || t("wave8.sponsors.errorSave"));
      setDeals((prev) => [data.deal!, ...prev]);
      setShowForm(false);
      setFName("");
      setFValue("");
      setFContact("");
      setFNotes("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("wave8.sponsors.errorSave"));
    } finally {
      setSaving(false);
    }
  }

  async function moveStage(deal: Deal, dir: -1 | 1) {
    if (movingId) return;
    const idx = STAGES.indexOf(deal.stage);
    const next = STAGES[idx + dir];
    if (!next) return;
    setMovingId(deal.id);
    try {
      const updated = await patchDeal(deal.id, { stage: next });
      if (updated) setDeals((prev) => prev.map((d) => (d.id === deal.id ? updated : d)));
    } catch (err) {
      setCardMsg((prev) => ({
        ...prev,
        [deal.id]: { ok: false, text: err instanceof Error ? err.message : t("wave8.sponsors.errorUpdate") },
      }));
    } finally {
      setMovingId(null);
    }
  }

  /* Paid: AI follow-up draft (50 VB) → modal with copy button. */
  async function handleDraftFollowup(deal: Deal) {
    if (draftingId) return;
    setDraftingId(deal.id);
    clearCardMsg(deal.id);
    try {
      const res = await confirmedFetch("/api/wave8/sponsors/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id }),
        overrideCost: FOLLOWUP_CREDITS,
        overrideFeature: t("wave8.sponsors.followupFeature"),
      });
      if (!res) return; // user cancelled the credit confirm
      const data = (await res.json().catch(() => ({}))) as {
        subject?: string;
        body?: string;
        lastFollowupAt?: string;
        error?: string;
        message?: string;
      };
      if (res.status === 402) throw new Error(t("wave8.sponsors.outOfCredits"));
      if (!res.ok || !data.subject) throw new Error(data.message || data.error || t("wave8.sponsors.errorDraft"));
      setDrafts((prev) => ({ ...prev, [deal.id]: { subject: data.subject!, body: data.body ?? "" } }));
      setDeals((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, lastFollowupAt: data.lastFollowupAt ?? new Date().toISOString() } : d)),
      );
      setCopied(false);
      setOpenDraftId(deal.id);
    } catch (err) {
      setCardMsg((prev) => ({
        ...prev,
        [deal.id]: { ok: false, text: err instanceof Error ? err.message : t("wave8.sponsors.errorDraft") },
      }));
    } finally {
      setDraftingId(null);
    }
  }

  /* Free: closed → paid, and the deal value lands in the income ledger —
     via one TRANSACTIONAL server call. If the ledger write fails the deal
     keeps its prior stage and the error is retryable. */
  async function handleMarkPaid(deal: Deal) {
    if (payingId) return;
    setPayingId(deal.id);
    clearCardMsg(deal.id);
    try {
      const res = await confirmedFetch(`/api/wave8/sponsors/deals/${deal.id}/mark-paid`, {
        skipConfirm: true,
        method: "POST",
      });
      const data = (await res!.json().catch(() => ({}))) as {
        deal?: Deal;
        posted?: boolean;
        error?: string;
        message?: string;
      };
      if (!res || !res.ok || !data.deal) {
        throw new Error(data.message || data.error || t("wave8.sponsors.errorPaid"));
      }
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? data.deal! : d)));
      if (data.posted) {
        setCardMsg((prev) => ({
          ...prev,
          [deal.id]: { ok: true, text: t("wave8.sponsors.paidPosted", { amount: fmtMoney(data.deal!.dealValueCents) }) },
        }));
      } else {
        setCardMsg((prev) => ({
          ...prev,
          [deal.id]: { ok: true, text: t("wave8.sponsors.paidNoValue") },
        }));
      }
    } catch (err) {
      setCardMsg((prev) => ({
        ...prev,
        [deal.id]: { ok: false, text: err instanceof Error ? err.message : t("wave8.sponsors.errorPaid") },
      }));
    } finally {
      setPayingId(null);
    }
  }

  function startEdit(deal: Deal) {
    setEditingId(deal.id);
    setEValue((deal.dealValueCents / 100).toFixed(2).replace(/\.?0+$/, ""));
    setEContact(deal.contact);
    setENotes(deal.notes);
  }

  async function saveEdit(deal: Deal) {
    if (editSaving) return;
    setEditSaving(true);
    try {
      const dollars = parseFloat(eValue);
      const valueCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
      const updated = await patchDeal(deal.id, {
        dealValueCents: valueCents,
        contact: eContact.trim(),
        notes: eNotes.trim(),
      });
      if (updated) setDeals((prev) => prev.map((d) => (d.id === deal.id ? updated : d)));
      setEditingId(null);
    } catch (err) {
      setCardMsg((prev) => ({
        ...prev,
        [deal.id]: { ok: false, text: err instanceof Error ? err.message : t("wave8.sponsors.errorUpdate") },
      }));
    } finally {
      setEditSaving(false);
    }
  }

  async function copyDraft(dealId: string) {
    const draft = drafts[dealId];
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the text is still selectable in the modal */
    }
  }

  function followupLabel(deal: Deal): string {
    if (!deal.lastFollowupAt) return t("wave8.sponsors.neverFollowedUp");
    const days = Math.max(0, Math.floor((Date.now() - new Date(deal.lastFollowupAt).getTime()) / 86_400_000));
    const when = days === 0 ? t("wave8.sponsors.today") : t("wave8.sponsors.daysAgo", { n: days });
    return t("wave8.sponsors.lastFollowup", { when });
  }

  if (!user) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
        <Handshake className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
        <p className="mt-4 text-sm text-white/60">{t("wave8.sponsors.signInPrompt")}</p>
      </div>
    );
  }

  const openDraft = openDraftId ? drafts[openDraftId] : null;
  const openDraftDeal = openDraftId ? deals.find((d) => d.id === openDraftId) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary">
            <Handshake className="h-4 w-4" aria-hidden="true" /> {t("wave8.sponsors.title")}
          </h2>
          <p className="mt-1 text-sm text-white/50">{t("wave8.sponsors.subtitle")}</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setFormError(null); }}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95"
        >
          {showForm ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {showForm ? t("wave8.sponsors.closeForm") : t("wave8.sponsors.addDeal")}
        </button>
      </div>

      {showForm && (
        <div className="mt-5 rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6">
          <p className={sectionTitle}>{t("wave8.sponsors.addDeal")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>{t("wave8.sponsors.sponsorName")}</label>
              <input
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                maxLength={120}
                placeholder={t("wave8.sponsors.sponsorNamePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("wave8.sponsors.dealValue")}</label>
              <input
                value={fValue}
                onChange={(e) => setFValue(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("wave8.sponsors.contact")}</label>
              <input
                value={fContact}
                onChange={(e) => setFContact(e.target.value)}
                maxLength={160}
                placeholder={t("wave8.sponsors.contactPlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("wave8.sponsors.notes")}</label>
              <input
                value={fNotes}
                onChange={(e) => setFNotes(e.target.value)}
                maxLength={1000}
                placeholder={t("wave8.sponsors.notesPlaceholder")}
                className={inputClass}
              />
            </div>
          </div>
          {formError && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {formError}
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !fName.trim()}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {saving ? t("wave8.sponsors.saving") : t("wave8.sponsors.saveDeal")}
          </button>
        </div>
      )}

      {/* ── kanban ─────────────────────────────────────────────────── */}
      <div className="mt-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-sm text-white/50">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-8 text-center">
            <p className="text-sm text-white/70">{error}</p>
            <button
              onClick={loadDeals}
              className="mt-4 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/20"
            >
              {t("wave8.sponsors.retry")}
            </button>
          </div>
        ) : deals.length === 0 && !showForm ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-white/40">
            {t("wave8.sponsors.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {STAGES.map((stage) => {
              const col = deals.filter((d) => d.stage === stage);
              return (
                <div key={stage} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="flex items-center justify-between px-1 pb-3 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    {stageLabel(stage)}
                    <span className="rounded-full border border-white/10 bg-black/50 px-2 py-0.5 text-[10px] text-white/50">
                      {col.length}
                    </span>
                  </p>
                  <div className="space-y-2">
                    {col.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-white/30">
                        {t("wave8.sponsors.emptyColumn")}
                      </p>
                    ) : (
                      col.map((deal) => {
                        const idx = STAGES.indexOf(deal.stage);
                        const drafting = draftingId === deal.id;
                        const paying = payingId === deal.id;
                        const moving = movingId === deal.id;
                        const editing = editingId === deal.id;
                        const msg = cardMsg[deal.id];
                        return (
                          <div key={deal.id} className="rounded-xl border border-white/10 bg-black/50 p-4">
                            <p className="truncate text-sm font-black text-white">{deal.sponsorName}</p>
                            {deal.dealValueCents > 0 && (
                              <p className="mt-0.5 font-display text-base font-black text-primary">
                                {fmtMoney(deal.dealValueCents)}
                              </p>
                            )}
                            {editing ? (
                              <div className="mt-3 space-y-2">
                                <input
                                  value={eValue}
                                  onChange={(e) => setEValue(e.target.value.replace(/[^0-9.]/g, ""))}
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  aria-label={t("wave8.sponsors.dealValue")}
                                  className={`${inputClass} py-2 text-xs`}
                                />
                                <input
                                  value={eContact}
                                  onChange={(e) => setEContact(e.target.value)}
                                  maxLength={160}
                                  placeholder={t("wave8.sponsors.contactPlaceholder")}
                                  aria-label={t("wave8.sponsors.contact")}
                                  className={`${inputClass} py-2 text-xs`}
                                />
                                <input
                                  value={eNotes}
                                  onChange={(e) => setENotes(e.target.value)}
                                  maxLength={1000}
                                  placeholder={t("wave8.sponsors.notesPlaceholder")}
                                  aria-label={t("wave8.sponsors.notes")}
                                  className={`${inputClass} py-2 text-xs`}
                                />
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() => saveEdit(deal)}
                                    disabled={editSaving}
                                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                                  >
                                    {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : t("wave8.sponsors.save")}
                                  </button>
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 transition hover:text-white"
                                  >
                                    {t("wave8.sponsors.cancel")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {(deal.contact || deal.notes) && (
                                  <p className="mt-1.5 line-clamp-3 text-xs text-white/45">
                                    {deal.contact && <span className="text-white/60">{deal.contact}</span>}
                                    {deal.contact && deal.notes && " · "}
                                    {deal.notes}
                                  </p>
                                )}
                                <p className="mt-1.5 text-[11px] text-white/35">{followupLabel(deal)}</p>
                              </>
                            )}

                            {/* stage moves */}
                            <div className="mt-3 flex items-center gap-1.5">
                              <button
                                onClick={() => moveStage(deal, -1)}
                                disabled={idx === 0 || moving}
                                aria-label={t("wave8.sponsors.moveBack")}
                                className="rounded-lg border border-white/10 p-1.5 text-white/50 transition hover:border-primary/40 hover:text-white disabled:opacity-30"
                              >
                                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                onClick={() => moveStage(deal, 1)}
                                disabled={idx === STAGES.length - 1 || moving}
                                aria-label={t("wave8.sponsors.moveForward")}
                                className="rounded-lg border border-white/10 p-1.5 text-white/50 transition hover:border-primary/40 hover:text-white disabled:opacity-30"
                              >
                                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                              </button>
                              {!editing && (
                                <button
                                  onClick={() => startEdit(deal)}
                                  aria-label={t("wave8.sponsors.edit")}
                                  className="rounded-lg border border-white/10 p-1.5 text-white/50 transition hover:border-primary/40 hover:text-white"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>

                            {/* actions */}
                            <div className="mt-3 space-y-2 border-t border-white/[0.07] pt-3">
                              <button
                                onClick={() => handleDraftFollowup(deal)}
                                disabled={drafting}
                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                              >
                                {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                                {drafting ? t("wave8.sponsors.drafting") : t("wave8.sponsors.draftFollowup")}
                              </button>
                              {deal.stage === "closed" && (
                                <button
                                  onClick={() => handleMarkPaid(deal)}
                                  disabled={paying}
                                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-3 py-2 text-xs font-black text-black transition hover:scale-[1.02] disabled:opacity-50"
                                >
                                  {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                                  {paying ? t("wave8.sponsors.markingPaid") : t("wave8.sponsors.markPaid")}
                                </button>
                              )}
                            </div>

                            {msg && (
                              <p className={`mt-2 text-xs font-semibold ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
                                {msg.text}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── follow-up draft modal ────────────────────────────────────── */}
      {openDraft && openDraftDeal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpenDraftId(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t("wave8.sponsors.followupTitle")}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-primary/25 bg-[#14100a] p-6 md:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {t("wave8.sponsors.followupTitle")} — {openDraftDeal.sponsorName}
              </h3>
              <button
                onClick={() => setOpenDraftId(null)}
                aria-label={t("wave8.sponsors.close")}
                className="rounded-lg border border-white/10 p-1.5 text-white/50 transition hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 text-sm font-bold text-white">
              <span className="text-white/40">Subject: </span>{openDraft.subject}
            </p>
            <p className="mt-3 max-h-72 overflow-y-auto whitespace-pre-line rounded-xl border border-white/10 bg-black/50 p-4 text-sm leading-relaxed text-white/75">
              {openDraft.body}
            </p>
            <p className="mt-3 text-xs text-white/40">{t("wave8.sponsors.followupLogged")}</p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => openDraftId && copyDraft(openDraftId)}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-6 py-2.5 text-sm font-black text-black transition hover:scale-[1.03]"
              >
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? t("wave8.sponsors.copied") : t("wave8.sponsors.copy")}
              </button>
              <button
                onClick={() => setOpenDraftId(null)}
                className="rounded-2xl border border-white/15 px-6 py-2.5 text-sm font-bold text-white/70 transition hover:text-white"
              >
                {t("wave8.sponsors.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
