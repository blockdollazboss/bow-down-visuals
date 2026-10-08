import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Users, Loader2, AlertTriangle, FileText, CalendarDays } from "lucide-react";
import { roleLabel } from "@/lib/distribution";

/* ─── Public split agreement page (/splits/:slug) ────────────────────────────
   No auth required — this page is shared with collaborators so everyone can
   see the agreed royalty split for a release. It reads
   GET /api/distribution/splits/:slug (public) which only exposes names,
   roles, and shares — never emails or account info.
   ?ref=CODE is captured globally by App.tsx for the referral flow. */

interface AgreementSplit {
  name: string;
  role: string | null;
  share: number;
}

interface AgreementData {
  title: string;
  artistName: string;
  splits: AgreementSplit[];
  agreementVersion: number;
  effectiveFrom: string | null;
  disclaimer: string;
}

export default function SplitsAgreement() {
  const [, params] = useRoute("/splits/:slug");
  const slug = params?.slug ?? "";

  const [data, setData] = useState<AgreementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/distribution/splits/${encodeURIComponent(slug)}`);
        const json = (await res.json().catch(() => ({}))) as {
          error?: string; message?: string;
        } & Partial<AgreementData>;
        if (!res.ok || !json.title) {
          throw new Error(json.message || json.error || "Split agreement not found.");
        }
        if (!cancelled) setData(json as AgreementData);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the split agreement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="relative mx-auto max-w-xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[240px] w-[480px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {loading ? (
          <p className="relative py-20 text-center text-sm text-white/40">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
            Loading the split agreement…
          </p>
        ) : error || !data ? (
          <div className="relative py-20 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
            <p className="text-sm text-white/60">{error ?? "Split agreement not found."}</p>
          </div>
        ) : (
          <div className="relative">
            <div className="mb-8 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                <FileText className="h-3.5 w-3.5" /> Royalty split agreement
              </span>
              <h1 className="mt-4 font-display text-3xl font-black md:text-4xl">{data.title}</h1>
              <p className="mt-1 text-sm text-white/55">{data.artistName}</p>
              {data.agreementVersion > 0 && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/40">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Agreement v{data.agreementVersion}
                  {data.effectiveFrom ? ` · effective ${data.effectiveFrom.slice(0, 10)}` : ""}
                </p>
              )}
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
                <Users className="h-4 w-4 text-primary" />
                <p className="text-sm font-bold">Agreed shares</p>
              </div>
              <ul className="divide-y divide-white/5">
                {data.splits.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="flex items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <p className="font-bold">{s.name}</p>
                      <p className="text-xs text-white/45">{roleLabel(s.role)}</p>
                    </div>
                    <p className="font-display text-xl font-black text-primary">{s.share}%</p>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-6 text-center text-xs leading-relaxed text-white/40">{data.disclaimer}</p>
            <p className="mt-4 text-center text-xs text-white/30">
              Made with <span className="font-bold text-primary/70">Bow Down Visuals</span> — the Content Creation Cheat Code
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
