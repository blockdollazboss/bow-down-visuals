import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Affiliate program section of the money desk (/earnings) — #16.
 *
 * Two chairs, one ledger (GET /api/affiliates/desk):
 *  - As a CREATOR: who is reselling your products, how many attributed
 *    sales, and how much commission you owe / has been paid. You set the
 *    % per product in the product settings (store dashboard / my shop).
 *  - As an AFFILIATE (fan): the products you're reselling, your share
 *    links, and the commission owed / paid to you.
 *
 * Honesty rules: commission comes out of the SELLER's cut — the platform
 * fee stays 5% and buyers never pay extra. "Owed" is recorded at sale
 * time; "paid" appears only when the existing payout rails settle it.
 * This section loads and fails on its own — it never takes the rest of
 * the earnings page down with it.
 */

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface DeskTotals { salesCount: number; owedCents: number; paidCents: number }
interface Desk {
  asSeller: { affiliates: Array<{ affiliateUserId: string; code: string; salesCount: number; grossCents: number; owedCents: number; paidCents: number }>; totals: DeskTotals };
  asAffiliate: { products: Array<{ surface: string; productId: string | null; productTitle: string; salesCount: number; owedCents: number; paidCents: number }>; totals: DeskTotals };
  recentSales: Array<{ id: string; productTitle: string; commissionCents: number; commissionPct: string; status: string; mine: string; createdAt: string }>;
  note: string;
}
interface MyCode {
  id: string; code: string; surface: string; productTitle: string;
  shareLink: string; isActive: boolean; salesCount: number; owedCents: number; paidCents: number;
}
interface Offer {
  surface: string; productId: string; title: string; price: string;
  sellerName: string; commissionPct: string; productPath: string;
}

export default function AffiliateDeskSection() {
  const { getAccessToken } = useAuth();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [codes, setCodes] = useState<MyCode[] | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    const token = await getAccessToken().catch(() => null);
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const [d, c, o] = await Promise.all([
      fetch("/api/affiliates/desk", { headers }),
      fetch("/api/affiliates/codes/mine", { headers }),
      fetch("/api/affiliates/offers", { headers }),
    ]);
    if (!d.ok) throw new Error("desk failed");
    setDesk((await d.json()) as Desk);
    if (c.ok) setCodes(((await c.json()) as { codes: MyCode[] }).codes);
    if (o.ok) setOffers(((await o.json()) as { offers: Offer[] }).offers);
  }, [getAccessToken]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    load().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [load, reloadKey]);

  async function claim(offer: Offer) {
    setClaiming(offer.productId);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/affiliates/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ surface: offer.surface, productId: offer.productId }),
      });
      if (!res.ok) throw new Error("claim failed");
      setReloadKey((k) => k + 1);
    } catch {
      setFailed(true);
    } finally {
      setClaiming(null);
    }
  }

  function copyLink(code: MyCode) {
    const url = `${window.location.origin}${code.shareLink}`;
    void navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(code.id);
    setTimeout(() => setCopied((c) => (c === code.id ? null : c)), 2000);
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5" data-testid="affiliate-desk">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold">Affiliate program</h2>
        <span className="text-xs text-muted-foreground">Fans resell your products · you set the %</span>
      </div>

      {failed ? (
        <div className="mt-3">
          <p className="text-sm text-destructive">Couldn&apos;t load your affiliate picture — the rest of your earnings are unaffected.</p>
          <button
            type="button"
            className="mt-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Try again
          </button>
        </div>
      ) : !desk ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading your affiliate picture…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 p-4">
              <div className="text-sm font-semibold">You owe affiliates</div>
              <div className="mt-1 text-2xl font-bold">{usd(desk.asSeller.totals.owedCents)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {desk.asSeller.totals.salesCount} attributed {desk.asSeller.totals.salesCount === 1 ? "sale" : "sales"} · {usd(desk.asSeller.totals.paidCents)} already paid
              </div>
              {desk.asSeller.affiliates.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Nobody is reselling your products yet. Turn affiliates on for a product in your store or shop settings, set the commission you&apos;ll pay, and fans can grab a link here.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {desk.asSeller.affiliates.map((a) => (
                    <li key={a.code} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.code}</span>
                        <span className="block text-xs text-muted-foreground">{a.salesCount} sales · {usd(a.grossCents)} sold</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold">{usd(a.owedCents)} owed</span>
                        <span className="block text-xs text-muted-foreground">{usd(a.paidCents)} paid</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border/60 p-4">
              <div className="text-sm font-semibold">You&apos;ve earned reselling</div>
              <div className="mt-1 text-2xl font-bold">{usd(desk.asAffiliate.totals.owedCents + desk.asAffiliate.totals.paidCents)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {usd(desk.asAffiliate.totals.owedCents)} owed to you · {usd(desk.asAffiliate.totals.paidCents)} paid · {desk.asAffiliate.totals.salesCount} sales through your links
              </div>
              {codes && codes.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {codes.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.productTitle || c.code}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.shareLink} · {c.salesCount} sales · {usd(c.owedCents)} owed</span>
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold"
                        onClick={() => copyLink(c)}
                      >
                        {copied === c.id ? "Copied!" : "Copy link"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No share links yet — grab one from the offers below and earn the commission the creator set on every sale through it.</p>
              )}
            </div>
          </div>

          {offers && offers.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-semibold">Open to affiliates</div>
              <ul className="mt-2 divide-y divide-border/60">
                {offers.map((o) => (
                    <li key={`${o.surface}:${o.productId}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{o.title}</span>
                        <span className="block text-xs text-muted-foreground">by {o.sellerName} · {o.price} · you earn {o.commissionPct} of the creator&apos;s cut</span>
                      </span>
                      <button
                        type="button"
                        disabled={claiming === o.productId}
                        className="shrink-0 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                        onClick={() => claim(o)}
                      >
                        {claiming === o.productId ? "Getting link…" : "Get my link"}
                      </button>
                    </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">{desk.note}</p>
        </>
      )}
    </div>
  );
}
