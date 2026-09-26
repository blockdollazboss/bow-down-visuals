import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Store, Search, Loader2, ArrowRight, Sparkles, BadgeCheck } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Storefronts hub — browse every creator shop on the platform ──────────
   Pure UI: browsing shops costs nothing. */

interface HubShop {
  id: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
  banner_color: string;
  accent_color: string;
  banner_image_url: string | null;
  custom_domain: string | null;
  domain_verified: boolean;
  product_count: number;
}

export default function Storefronts() {
  usePageTitle("Creator Storefronts");
  const [shops, setShops] = useState<HubShop[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(query: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/storefronts?q=${encodeURIComponent(query)}&limit=60`);
      const data = await res.json();
      if (res.ok) setShops(data.shops ?? []);
    } catch {
      /* hub stays empty rather than crashing */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">
            <Store className="h-3.5 w-3.5" /> The Creator Marketplace
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-5xl">
            Creator <span className="bg-gradient-to-b from-amber-200 to-amber-500 bg-clip-text text-transparent">Storefronts</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/55">
            Every creator gets their own shop on Bow Down Visuals — merch, music,
            and digital drops, all in one gold-standard storefront.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/storefronts/builder">
              <span className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-6 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110">
                <Sparkles className="h-4 w-4" /> Open your shop
              </span>
            </Link>
            <span className="text-xs text-white/40">Pro plan or higher · 10% platform fee on sales</span>
          </div>
        </div>

        <div className="relative mx-auto mt-10 max-w-xl">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search shops, creators, vibes…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/40"
          />
        </div>

        {loading ? (
          <div className="mt-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-amber-400" /></div>
        ) : shops.length === 0 ? (
          <div className="lux-card mx-auto mt-12 max-w-lg p-10 text-center">
            <Store className="mx-auto h-10 w-10 text-amber-400/60" />
            <h2 className="mt-4 text-xl font-bold">No shops yet{q ? ` for "${q}"` : ""}</h2>
            <p className="mt-2 text-sm text-white/50">
              Be the first creator with a storefront on the platform.
            </p>
            <Link href="/storefronts/builder">
              <span className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110">
                Start building <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shops.map((s) => (
              <Link key={s.id} href={`/shop/${s.handle}`}>
                <div
                  className="lux-card group cursor-pointer overflow-hidden transition duration-300 hover:-translate-y-1"
                  style={{ borderTop: `3px solid ${s.accent_color || "#d4af37"}` }}
                >
                  <div
                    className="flex h-28 items-end p-4"
                    style={{
                      background: s.banner_image_url
                        ? `url(${s.banner_image_url}) center/cover`
                        : `linear-gradient(135deg, ${s.banner_color || "#0a0a0a"}, #1a1a1a)`,
                    }}
                  >
                    <span className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold text-white/80 backdrop-blur">
                      {s.product_count} product{s.product_count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold group-hover:text-amber-300">{s.name}</h3>
                      {s.domain_verified && s.custom_domain && (
                        <span title={`Verified domain: ${s.custom_domain}`}>
                          <BadgeCheck className="h-4 w-4 text-amber-400" />
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-amber-300/70">/shop/{s.handle}</p>
                    {s.tagline && <p className="mt-2 line-clamp-2 text-sm text-white/55">{s.tagline}</p>}
                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-amber-300/90">
                      Visit shop <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
