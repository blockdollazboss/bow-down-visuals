import { useEffect, useState } from "react";
import { Download, Loader2, ShoppingBag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Purchases — the buyer's downloads home (stack400 lane 2) ─────────
   Every digital product this account bought from a creator shop, with
   its download/access link and order id — served by
   GET /api/shops/my-purchases (one shop_deliveries row per PAID sale
   line, written by the paid flip). Until this tab existed the endpoint
   had NO frontend surface: buyers paid, the delivery row was written,
   and there was nowhere in the site to find it (payments gate, Oct 26
   + Oct 28). Docked in the Library like every buyer surface — never a
   standalone page. */

export interface ShopPurchase {
  /* The API's field name (GET /api/shops/my-purchases sends
     saleId: sale_event_id, the name the whole shops module uses).
     This interface once declared the id under a different name, so
     every row keyed by it was undefined. */
  saleId: string;
  orderId: string;
  productId: string | null;
  productName: string | null;
  downloadUrl: string;
  fileName: string | null;
  deliveredAt: string;
}

export default function PurchasesPanel({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [purchases, setPurchases] = useState<ShopPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setPurchases([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/shops/my-purchases", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json().catch(() => ({}))) as { purchases?: ShopPurchase[] };
        if (!alive) return;
        const rows = Array.isArray(data.purchases) ? data.purchases : [];
        setPurchases(rows);
        onCountChange?.(rows.length);
      } catch {
        if (alive) setError(t("library.purchasesError", { defaultValue: "Your purchases couldn't load just now — try again in a moment." }));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, getAccessToken]);

  if (!user) {
    return (
      <div className="py-16 text-center">
        <ShoppingBag className="mx-auto h-10 w-10 text-white/25" />
        <p className="mt-4 text-sm text-white/50">
          {t("library.purchasesSignIn", { defaultValue: "Sign in to see the digital products you've bought — downloads live here." })}
        </p>
      </div>
    );
  }
  if (error) {
    return <p className="py-16 text-center text-sm text-red-300" role="alert">{error}</p>;
  }
  if (purchases === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }
  if (purchases.length === 0) {
    return (
      <div className="py-16 text-center">
        <ShoppingBag className="mx-auto h-10 w-10 text-white/25" />
        <p className="mt-4 text-sm text-white/50">
          {t("library.purchasesEmpty", { defaultValue: "Nothing here yet — digital products you buy from creator shops land here with their downloads." })}
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-3" data-testid="library-purchases">
      {purchases.map((p) => (
        <div
          key={p.saleId}
          className={`flex items-center gap-3 rounded-2xl border p-4 ${
            isLight ? "border-[#C9A84C]/40 bg-[#FCF7EA]" : "border-white/10 bg-black/40"
          }`}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#c9a84c]/15">
            <ShoppingBag className="h-5 w-5 text-[#e8c86a]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{p.productName || p.fileName || t("library.purchasesDigitalProduct", { defaultValue: "Digital product" })}</div>
            <div className={`mt-0.5 truncate text-[11px] ${isLight ? "text-black/50" : "text-white/40"}`}>
              {p.fileName ? <span className="mr-2">{p.fileName}</span> : null}
              <span>{new Date(p.deliveredAt).toLocaleDateString()}</span>
              <span className="ml-2 font-mono">{t("library.purchasesOrder", { defaultValue: "Order" })} {p.orderId.slice(0, 8)}</span>
            </div>
          </div>
          <a
            href={p.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-200 to-amber-500 px-4 py-2 text-xs font-black text-black transition hover:brightness-110"
          >
            <Download className="h-3.5 w-3.5" />
            {t("library.purchasesDownload", { defaultValue: "Download" })}
          </a>
        </div>
      ))}
    </div>
  );
}
