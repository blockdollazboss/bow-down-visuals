import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Disc3, Loader2, AlertTriangle, CalendarDays, Image as ImageIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { platformLabel } from "@/lib/distribution";

/* ─── Public pre-save landing page (/presave/:slug) ─────────────────────────
   No auth required — this page is meant to be shared with fans. It reads
   GET /api/distribution/presave/:slug (public) and renders a simple
   landing card for the release. */

interface PresaveRelease {
  title: string;
  artistName: string;
  artworkUrl: string | null;
  releaseDate: string | null;
  platforms: string[];
  releaseType: string;
}

export default function PresaveLanding() {
  const [, params] = useRoute("/presave/:slug");
  const slug = params?.slug ?? "";

  const [data, setData] = useState<PresaveRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/distribution/presave/${encodeURIComponent(slug)}`);
        const json = (await res.json().catch(() => ({}))) as {
          error?: string; message?: string;
        } & Partial<PresaveRelease>;
        if (!res.ok || !json.title) {
          throw new Error(json.message || json.error || "This pre-save link doesn't exist.");
        }
        if (!cancelled) setData(json as PresaveRelease);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this release.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="relative mx-auto max-w-xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[240px] w-[480px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {loading ? (
          <p className="relative py-20 text-center text-sm text-white/40">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
            Loading release…
          </p>
        ) : error || !data ? (
          <div className="relative mx-auto mt-10 rounded-3xl border border-red-500/30 bg-red-500/10 p-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-red-300" />
            <p className="mt-4 text-sm text-red-200">{error ?? "This pre-save link doesn't exist."}</p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-8 text-center md:p-12">
            <p className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              <Disc3 className="h-3 w-3" aria-hidden="true" /> Pre-save
            </p>
            {data.artworkUrl ? (
              <img
                src={data.artworkUrl}
                alt={`${data.title} artwork`}
                className="mx-auto h-56 w-56 rounded-3xl border border-white/10 object-cover shadow-2xl shadow-primary/20"
              />
            ) : (
              <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03]">
                <ImageIcon className="h-16 w-16 text-white/20" />
              </div>
            )}
            <h1 className="mt-6 font-display text-3xl font-black">{data.title}</h1>
            <p className="mt-1 text-white/55">{data.artistName}</p>
            {data.releaseDate && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm text-white/60">
                <CalendarDays className="h-4 w-4 text-primary" /> Drops {data.releaseDate}
              </p>
            )}
            {data.platforms.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  Available everywhere on release day
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {data.platforms.map((p) => (
                    <span key={p} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
                      {platformLabel(p)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-8 text-xs text-white/30">
              Released with Thy Cheat Code — the content creator cheat code.
            </p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
