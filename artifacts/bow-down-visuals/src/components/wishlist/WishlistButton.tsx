import { useEffect, useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchWishlisted,
  addToWishlist,
  removeFromWishlist,
  type WishlistItemKind,
} from "@/lib/wishlists";

/* ─── Wishlist heart (Wave 4 #38) ───────────────────────────────────────
   Save-for-later on a product. Saving records the product's current
   price server-side; if the price later drops, the fan gets one
   in-app notification per drop. Signed-out visitors are sent to
   sign-in — a wishlist belongs to an account. */
export default function WishlistButton({
  itemKind,
  itemId,
  variant = "icon",
  className = "",
}: {
  itemKind: WishlistItemKind;
  itemId: string;
  /** "icon" = round heart button; "labeled" = heart + Save/Saved text. */
  variant?: "icon" | "labeled";
  className?: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setSaved(false);
      return;
    }
    fetchWishlisted(getAccessToken, itemKind, itemId)
      .then((v) => { if (alive) setSaved(v); })
      .catch(() => { if (alive) setSaved(false); });
    return () => { alive = false; };
  }, [user, getAccessToken, itemKind, itemId]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      navigate("/login");
      return;
    }
    if (busy || saved === null) return;
    const next = !saved;
    setSaved(next);
    setBusy(true);
    try {
      const ok = next
        ? await addToWishlist(getAccessToken, itemKind, itemId)
        : await removeFromWishlist(getAccessToken, itemKind, itemId);
      if (!ok) setSaved(!next);
    } catch {
      setSaved(!next);
    } finally {
      setBusy(false);
    }
  };

  const label = saved
    ? t("wishlist.saved", { defaultValue: "Saved to your wishlist" })
    : t("wishlist.save", { defaultValue: "Save to wishlist" });

  if (variant === "labeled") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved === true}
        aria-label={label}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
          saved
            ? "border-[#c9a84c]/60 bg-[#c9a84c]/15 text-[#e8c86a]"
            : "border-white/15 bg-white/[0.04] text-white/70 hover:border-[#c9a84c]/40 hover:text-white"
        } ${className}`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Heart className={`h-4 w-4 ${saved ? "fill-[#e8c86a] text-[#e8c86a]" : ""}`} />
        )}
        {saved ? t("wishlist.savedShort", { defaultValue: "Saved" }) : t("wishlist.saveShort", { defaultValue: "Save for later" })}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved === true}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition ${
        saved
          ? "border-[#c9a84c]/60 bg-[#c9a84c]/15 text-[#e8c86a]"
          : "border-white/15 bg-black/40 text-white/70 hover:border-[#c9a84c]/40 hover:text-white"
      } ${className}`}
    >
      {busy ? (
        <Loader2 className="h-4.5 w-4.5 animate-spin" />
      ) : (
        <Heart className={`h-4.5 w-4.5 ${saved ? "fill-[#e8c86a] text-[#e8c86a]" : ""}`} />
      )}
    </button>
  );
}
