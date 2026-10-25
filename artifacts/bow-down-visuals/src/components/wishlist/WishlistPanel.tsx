import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Heart, Loader2, Trash2, TrendingDown, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchWishlist,
  removeFromWishlist,
  wishlistMoney,
  type WishlistEntry,
} from "@/lib/wishlists";

/* ─── Wishlist panel — the fan's save-for-later list (Wave 4 #38) ───────
   Docked as a tab inside Thy Library (no standalone page). Each entry
   shows the price when saved against the price NOW: a drop is called
   out plainly, because the drop is the whole point — the fan also
   gets one in-app notification per drop the moment the seller cuts
   the price. Removing an entry stops its future alerts. */
export default function WishlistPanel({
  onCountChange,
}: {
  onCountChange?: (count: number) => void;
}) {
  const { getAccessToken } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<WishlistEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchWishlist(getAccessToken)
      .then((list) => {
        if (!alive) return;
        setItems(list);
        onCountChange?.(list.length);
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  const remove = async (entry: WishlistEntry) => {
    if (removingId) return;
    setRemovingId(entry.id);
    try {
      const ok = await removeFromWishlist(getAccessToken, entry.itemKind, entry.itemId);
      if (ok) {
        setItems((prev) => {
          const next = (prev ?? []).filter((i) => i.id !== entry.id);
          onCountChange?.(next.length);
          return next;
        });
      }
    } finally {
      setRemovingId(null);
    }
  };

  if (error) {
    return (
      <p className="py-16 text-center text-sm text-white/50">
        {t("wishlist.loadError", { defaultValue: "Your wishlist couldn't load — check your connection and try again." })}
      </p>
    );
  }
  if (items === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[#c9a84c]" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <Heart className="mx-auto h-10 w-10 text-white/20" />
        <p className="mt-4 font-bold text-white/70">
          {t("wishlist.emptyTitle", { defaultValue: "Nothing saved yet" })}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/40">
          {t("wishlist.emptyBody", {
            defaultValue: "Tap the heart on any product in a creator's store or shop to save it here. If its price drops, we'll tell you.",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((entry) => {
        const dropped =
          entry.currentPriceCents !== null && entry.currentPriceCents < entry.priceAtAddCents;
        return (
          <div
            key={entry.id}
            className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-bold text-white">
                  {entry.title || t("wishlist.goneTitle", { defaultValue: "A saved product" })}
                </div>
                <div className="mt-0.5 text-xs uppercase tracking-widest text-white/30">
                  {entry.itemKind === "store_product"
                    ? t("wishlist.kindStore", { defaultValue: "Store" })
                    : t("wishlist.kindShop", { defaultValue: "Shop" })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(entry)}
                disabled={removingId === entry.id}
                aria-label={t("wishlist.remove", { defaultValue: "Remove from wishlist" })}
                className="shrink-0 rounded-lg border border-white/10 p-2 text-white/40 transition hover:border-red-400/40 hover:text-red-300"
              >
                {removingId === entry.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between text-white/50">
                <span>{t("wishlist.savedAt", { defaultValue: "Saved at" })}</span>
                <span>{wishlistMoney(entry.priceAtAddCents)}</span>
              </div>
              <div className="flex justify-between font-bold text-white">
                <span>{t("wishlist.now", { defaultValue: "Now" })}</span>
                <span>
                  {entry.currentPriceCents === null
                    ? t("wishlist.gone", { defaultValue: "No longer listed" })
                    : wishlistMoney(entry.currentPriceCents)}
                </span>
              </div>
            </div>

            {dropped && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">
                <TrendingDown className="h-3.5 w-3.5" />
                {t("wishlist.droppedBy", {
                  defaultValue: "Down {{amount}} since you saved it",
                  amount: wishlistMoney(entry.priceAtAddCents - (entry.currentPriceCents ?? 0)),
                })}
              </p>
            )}
            {!entry.available && entry.currentPriceCents !== null && (
              <p className="mt-3 text-xs text-white/40">
                {t("wishlist.unavailable", { defaultValue: "Not on sale right now — we'll keep it here in case it returns." })}
              </p>
            )}

            {entry.link && entry.available && (
              <Link
                href={entry.link}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-[#e8c86a] hover:text-[#f4dc8f]"
              >
                {t("wishlist.view", { defaultValue: "View product" })}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
