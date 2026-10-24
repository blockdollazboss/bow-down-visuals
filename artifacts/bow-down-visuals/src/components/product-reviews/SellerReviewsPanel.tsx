import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Flag, Loader2, MessageSquare, RotateCcw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  FLAG_REASONS, flagReasonLabel,
  type ProductReview, type ProductReviewProductType,
} from "@/lib/product-reviews";
import { Stars } from "./ProductReviews";

/* ─── Seller reviews panel (Stack-100 #3, #14) ───────────────────────────
   Docked inside the seller's own dashboards (Store Dashboard for the
   storefront rail, My Shop for the marketplace rail) — never a
   standalone page. The moderation contract, in the open:
     - Respond to any review (and withdraw your own response).
     - Flag an abusive review for platform moderation — a recorded
       reason from the abusive-content list is required, and hiding
       while it is reviewed is a separate, explicit choice.
     - There is NO delete. Nothing here can make a review stop
       existing, and a hidden review stays visible right here and to
       its author, counted in the public summary. */

interface SellerQueue {
  reviews: ProductReview[];
  counts: { total: number; visible: number; hiddenPendingReview: number; flagged: number };
}

export default function SellerReviewsPanel({
  productType,
  heading = "Product reviews",
}: {
  productType?: ProductReviewProductType;
  heading?: string;
}) {
  const { getAccessToken } = useAuth();
  const [queue, setQueue] = useState<SellerQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /* per-review drafts */
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [flagReasons, setFlagReasons] = useState<Record<string, string>>({});
  const [flagNotes, setFlagNotes] = useState<Record<string, string>>({});
  const [flagHide, setFlagHide] = useState<Record<string, boolean>>({});

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const qs = productType ? `?productType=${productType}` : "";
      const res = await authed(`/api/product-reviews/seller${qs}`);
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as SellerQueue;
      setQueue(data);
      setResponses((prev) => {
        const next = { ...prev };
        for (const r of data.reviews) {
          if (next[r.id] === undefined) next[r.id] = r.sellerResponse ?? "";
        }
        return next;
      });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authed, productType]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, path: string, init?: RequestInit) {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await authed(path, init);
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message || data.error || "That didn't go through.");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section data-testid="seller-reviews-panel" className="mt-6">
      <h2 className="flex items-center gap-2 text-xl font-black text-white">
        <MessageSquare className="h-5 w-5 text-amber-400" /> {heading}
        {queue && queue.counts.total > 0 && (
          <span className="text-sm font-bold text-white/40">
            {queue.counts.total} total · {queue.counts.visible} live
            {queue.counts.hiddenPendingReview > 0 ? ` · ${queue.counts.hiddenPendingReview} hidden pending review` : ""}
          </span>
        )}
      </h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/45">
        Every review here is from a verified buyer. You can respond to any review, and flag abusive
        ones for platform moderation — flagging records your reason, and hiding a review while it is
        reviewed is disclosed on the product page. Reviews can't be deleted, by anyone, from here.
      </p>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div>
      ) : loadError ? (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5 text-sm text-white/70">
          Your reviews couldn't load just now — they're safe, this panel just hiccuped.{" "}
          <button className="font-bold text-amber-300 underline" onClick={() => { setLoading(true); void load(); }}>
            Try again
          </button>
        </div>
      ) : !queue || queue.reviews.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/50">
          No reviews yet. When a verified buyer reviews one of your products, it lands here — ready for your response.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {actionError && <p className="text-sm font-bold text-red-300">{actionError}</p>}
          {queue.reviews.map((r) => {
            const hidden = r.moderation.status === "hidden_pending_review";
            const flagged = r.moderation.flagged;
            return (
              <article
                key={r.id}
                data-testid="seller-review-item"
                className={`rounded-2xl border p-5 ${hidden ? "border-red-400/30 bg-red-400/[0.04]" : "border-white/10 bg-white/[0.03]"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-white">{r.productTitle || "Product"}</span>
                  <Stars value={r.rating} size={14} />
                  <span className="text-sm text-white/60">{r.buyer.displayName}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                    <BadgeCheck className="h-3 w-3" /> Verified purchase
                  </span>
                  {hidden ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-bold text-red-300">
                      <ShieldAlert className="h-3 w-3" /> Hidden pending moderation
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-white/50">Live</span>
                  )}
                  {flagged && !hidden && (
                    <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                      Flagged: {flagReasonLabel(r.moderation.flagReason)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-white/35">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                {r.title && <div className="mt-2 font-bold text-white">{r.title}</div>}
                <p className="mt-1 whitespace-pre-line text-sm text-white/70">{r.body}</p>
                {hidden && r.moderation.flagReason && (
                  <p className="mt-2 text-xs text-red-200/70">
                    Your flag: {flagReasonLabel(r.moderation.flagReason)}
                    {r.moderation.flagNote ? ` — “${r.moderation.flagNote}”` : ""}. This review is not deleted:
                    its author can still see it, and the product page counts it as hidden pending review.
                  </p>
                )}

                {/* respond */}
                <div className="mt-4 border-t border-white/10 pt-3">
                  <label className="text-xs font-black uppercase tracking-wider text-white/45">
                    Your response {r.sellerResponse ? "(live on the product page)" : ""}
                  </label>
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    <textarea
                      value={responses[r.id] ?? ""}
                      onChange={(e) => setResponses((p) => ({ ...p, [r.id]: e.target.value }))}
                      maxLength={2000}
                      rows={2}
                      placeholder="Thank the buyer, answer the point, say what's changing…"
                      aria-label={`Your response to the review of ${r.productTitle}`}
                      className="min-w-64 flex-1 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
                    />
                    <button
                      disabled={busyId === r.id}
                      onClick={() => act(r.id, `/api/product-reviews/${r.id}/respond`, {
                        method: "POST",
                        body: JSON.stringify({ response: (responses[r.id] ?? "").trim() || null }),
                      })}
                      className="rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : r.sellerResponse ? "Update response" : "Post response"}
                    </button>
                  </div>
                </div>

                {/* flag / unflag */}
                <div className="mt-3 border-t border-white/10 pt-3">
                  {flagged ? (
                    <button
                      disabled={busyId === r.id}
                      onClick={() => act(r.id, `/api/product-reviews/${r.id}/unflag`, { method: "POST", body: "{}" })}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white/70 transition hover:text-white disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" /> Undo flag{hidden ? " and restore the review" : ""}
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Flag className="h-4 w-4 text-white/40" />
                      <select
                        value={flagReasons[r.id] ?? ""}
                        onChange={(e) => setFlagReasons((p) => ({ ...p, [r.id]: e.target.value }))}
                        aria-label="Flag reason"
                        className="rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/60"
                      >
                        <option value="">Flag for moderation — pick a reason…</option>
                        {FLAG_REASONS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      <input
                        value={flagNotes[r.id] ?? ""}
                        onChange={(e) => setFlagNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                        maxLength={500}
                        placeholder="Note for the moderation team (optional)"
                        aria-label="Flag note"
                        className="min-w-52 flex-1 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
                      />
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-white/60">
                        <input
                          type="checkbox"
                          checked={flagHide[r.id] === true}
                          onChange={(e) => setFlagHide((p) => ({ ...p, [r.id]: e.target.checked }))}
                          className="h-4 w-4 accent-amber-500"
                        />
                        Hide while it's reviewed
                      </label>
                      <button
                        disabled={busyId === r.id || !flagReasons[r.id]}
                        onClick={() => act(r.id, `/api/product-reviews/${r.id}/flag`, {
                          method: "POST",
                          body: JSON.stringify({
                            reason: flagReasons[r.id],
                            ...(flagNotes[r.id]?.trim() ? { note: flagNotes[r.id].trim() } : {}),
                            hide: flagHide[r.id] === true,
                          }),
                        })}
                        className="rounded-full border border-red-400/40 px-4 py-2 text-sm font-bold text-red-300 transition hover:bg-red-400/10 disabled:opacity-40"
                      >
                        {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Flag review"}
                      </button>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                    A low rating is never a flag reason — honest negative reviews stay up. Flagging is for abusive content only, and the reason stays on record.
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
