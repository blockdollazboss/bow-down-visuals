import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Loader2, Star } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  averageLabel, distributionPct, starsFor,
  type ProductReview, type ProductReviewProductType, type ProductReviewSummary, EMPTY_SUMMARY,
} from "@/lib/product-reviews";

/* ─── Product reviews & ratings (Stack-100 #3, #14) ──────────────────────
   The public review surface for ONE product, docked into the product's
   own page/modal — never a standalone page. Every review shown here is
   a verified purchase (the API gates creation on a completed order /
   sale), and the summary discloses how many reviews are currently
   hidden pending platform moderation, so a seller flag can never make
   the rating quietly prettier. */

export function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value == null ? "No rating yet" : `${value} out of 5 stars`}>
      {starsFor(value).map((slot, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={
            slot === "full"
              ? "fill-amber-400 text-amber-400"
              : slot === "half"
                ? "fill-amber-400/40 text-amber-400"
                : "text-amber-200/25"
          }
        />
      ))}
    </span>
  );
}

interface Eligibility {
  eligible: boolean;
  reason: string | null;
  message: string | null;
  review: ProductReview | null;
}

export default function ProductReviews({
  productType,
  productId,
}: {
  productType: ProductReviewProductType;
  productId: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [summary, setSummary] = useState<ProductReviewSummary>(EMPTY_SUMMARY);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);

  /* write/edit form */
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  const loadReviews = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/product-reviews?productType=${productType}&productId=${encodeURIComponent(productId)}`,
      );
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { summary: ProductReviewSummary; reviews: ProductReview[] };
      setSummary(data.summary);
      setReviews(data.reviews ?? []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [productType, productId]);

  const loadEligibility = useCallback(async () => {
    if (!user) {
      setEligibility(null);
      return;
    }
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `/api/product-reviews/eligibility?productType=${productType}&productId=${encodeURIComponent(productId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) return;
      const data = (await res.json()) as Eligibility;
      setEligibility(data);
      if (data.review) {
        setRating(data.review.rating);
        setTitle(data.review.title ?? "");
        setBody(data.review.body);
      }
    } catch { /* eligibility is an enhancement — the list below still stands */ }
  }, [user, getAccessToken, productType, productId]);

  useEffect(() => { void loadReviews(); }, [loadReviews]);
  useEffect(() => { void loadEligibility(); }, [loadEligibility]);

  const editing = !!eligibility?.review;
  const canWrite = !!user && (eligibility?.eligible === true || editing);

  async function submit() {
    setSaving(true);
    setFormError(null);
    try {
      const token = await getAccessToken();
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const res = editing
        ? await fetch(`/api/product-reviews/${eligibility!.review!.id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ rating, title: title.trim() || null, body: body.trim() }),
          })
        : await fetch("/api/product-reviews", {
            method: "POST",
            headers,
            body: JSON.stringify({
              productType, productId, rating,
              ...(title.trim() ? { title: title.trim() } : {}),
              body: body.trim(),
            }),
          });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message || data.error || "Your review couldn't be saved.");
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 3000);
      await Promise.all([loadReviews(), loadEligibility()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Your review couldn't be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section data-testid="product-reviews" className="mt-8">
      <h2 className="flex items-center gap-2 text-xl font-black">
        Reviews
        {summary.count > 0 && (
          <span className="text-base font-bold text-amber-300" data-testid="product-reviews-average">
            {averageLabel(summary)} ★
          </span>
        )}
      </h2>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div>
      ) : loadError ? (
        <p className="mt-3 text-sm text-white/50">
          Reviews couldn't load just now.{" "}
          <button className="font-bold text-amber-300 underline" onClick={() => { setLoading(true); void loadReviews(); }}>
            Try again
          </button>
        </p>
      ) : (
        <>
          {/* ── Summary ── */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-5" data-testid="product-reviews-summary">
            {summary.count === 0 ? (
              <p className="text-sm text-white/60">
                No reviews yet — every review here comes from a verified buyer, so this fills in as buyers share their take.
              </p>
            ) : (
              <div className="flex flex-wrap items-start gap-6">
                <div>
                  <div className="text-4xl font-black">{averageLabel(summary)}</div>
                  <div className="mt-1"><Stars value={summary.average} /></div>
                  <div className="mt-1 text-xs text-white/50">
                    {summary.count} verified {summary.count === 1 ? "review" : "reviews"}
                  </div>
                </div>
                <div className="min-w-48 flex-1 space-y-1">
                  {([5, 4, 3, 2, 1] as const).map((star) => (
                    <div key={star} className="flex items-center gap-2 text-xs text-white/50">
                      <span className="w-6 shrink-0">{star}★</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${distributionPct(summary, star)}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right">{distributionPct(summary, star)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {summary.hiddenPendingCount > 0 && (
              <p className="mt-3 border-t border-white/10 pt-3 text-xs text-white/45" data-testid="product-reviews-hidden-note">
                {summary.hiddenPendingCount} {summary.hiddenPendingCount === 1 ? "review is" : "reviews are"} hidden
                pending platform moderation review — hidden reviews are counted here, never silently removed.
              </p>
            )}
          </div>

          {/* ── Write / edit ── */}
          {user && eligibility && !canWrite && eligibility.reason !== "already_reviewed" && (
            <p className="mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/55">
              {eligibility.message}
            </p>
          )}
          {canWrite && (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-black/30 p-5" data-testid="product-review-form">
              <div className="text-sm font-black">{editing ? "Your review" : "Review this product"}</div>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-300/90">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified purchase — you bought this product.
              </p>
              <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="Your rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    onClick={() => setRating(n)}
                    className="p-0.5"
                  >
                    <Star className={`h-7 w-7 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-amber-200/30"}`} />
                  </button>
                ))}
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Headline (optional)"
                aria-label="Review headline"
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-amber-400/60"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="What did you think? Quality, delivery, the whole experience…"
                aria-label="Your review"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-amber-400/60"
              />
              {formError && <p className="mt-2 text-sm font-bold text-red-300">{formError}</p>}
              <button
                onClick={submit}
                disabled={saving || body.trim().length === 0}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {savedTick ? "Saved ✓" : editing ? "Update your review" : "Post your review"}
              </button>
            </div>
          )}
          {!user && (
            <p className="mt-4 text-sm text-white/45">Bought this product? Sign in to leave a verified review.</p>
          )}

          {/* ── The reviews ── */}
          <div className="mt-5 space-y-3">
            {reviews.map((r) => (
              <article key={r.id} className="rounded-2xl border border-white/10 bg-black/20 p-5" data-testid="product-review-item">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={r.rating} size={14} />
                  <span className="text-sm font-bold">{r.buyer.displayName}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                    <BadgeCheck className="h-3 w-3" /> Verified purchase
                  </span>
                  <span className="ml-auto text-xs text-white/35">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.title && <div className="mt-2 font-bold">{r.title}</div>}
                <p className="mt-1 whitespace-pre-line text-sm text-white/70">{r.body}</p>
                {r.sellerResponse && (
                  <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
                    <div className="text-xs font-black uppercase tracking-wider text-amber-300/80">Seller response</div>
                    <p className="mt-1 whitespace-pre-line text-sm text-white/75">{r.sellerResponse}</p>
                  </div>
                )}
              </article>
            ))}
            {reviews.length === 0 && summary.count > 0 && (
              <p className="text-sm text-white/50">The reviews for this product couldn't be shown.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
