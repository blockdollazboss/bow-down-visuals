import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Users, Loader2, AlertTriangle, Disc3, PiggyBank, Link2, CheckCircle2,
} from "lucide-react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { roleLabel } from "@/lib/distribution";

type ConfirmedFetch = ReturnType<typeof useConfirmedApi>["confirmedFetch"];

/* ─── Splits view inside the Money Tracker (/coach?tab=money) ──────────────
   Applies each release's agreed royalty splits to the income entries linked
   to that release (GET /api/splits/overview). Each entry is split with the
   agreement version that was effective on the entry's date — edits apply to
   future earnings only, like DistroKid.
   HONESTY: this is split ACCOUNTING on logged income. Automatic store
   payouts need a distribution partner; the panel says so plainly. */

interface EntryShare {
  name: string;
  role: string | null;
  sharePct: number;
  amountCents: number;
}

interface OverviewEntry {
  id: string;
  entryDate: string;
  note: string;
  amountCents: number;
  agreementVersion: number;
  shares: EntryShare[];
}

interface CollaboratorTotal {
  name: string;
  role: string | null;
  sharePct?: number;
  totalCents: number;
}

interface OverviewRelease {
  id: string;
  title: string;
  artistName: string;
  totalIncomeCents: number;
  collaboratorTotals: CollaboratorTotal[];
  entries: OverviewEntry[];
  activeSplits: Array<{ name: string; role: string | null; sharePct: number; agreementVersion: number }>;
}

interface OverviewData {
  releases: OverviewRelease[];
  collaboratorTotals: CollaboratorTotal[];
  unlinkedIncomeCents: number;
  unlinkedIncomeCount: number;
  disclaimer: string;
}

interface ReleaseOption {
  id: string;
  title: string;
}

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SplitsOverview() {
  const { confirmedFetch } = useConfirmedApi();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/splits/overview", { skipConfirm: true });
      if (!res) return;
      const json = (await res.json().catch(() => ({}))) as OverviewData & { error?: string };
      if (!res.ok) throw new Error(json.error || "Couldn't load the splits overview.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the splits overview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="mt-6 flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-sm text-white/50">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        Computing everyone's shares…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 rounded-3xl border border-red-500/30 bg-red-500/[0.06] p-8 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" aria-hidden="true" />
        <p className="mt-3 text-sm text-white/70">{error}</p>
        <button
          onClick={load}
          className="mt-4 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/20"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data || data.releases.length === 0) {
    return (
      <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
        <Users className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
        <p className="mt-4 text-sm font-bold text-white">No split agreements yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
          Set up royalty splits on a release, then link income entries to it — this view
          will show exactly what each collaborator earns.
        </p>
        <Link
          href="/distribute"
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-6 py-3 text-sm font-black text-black transition hover:scale-[1.03]"
        >
          <Disc3 className="h-4 w-4" aria-hidden="true" /> Set up splits in Distribute
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <p className="rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-xs leading-relaxed text-white/60">
        {data.disclaimer}
      </p>

      {/* ── who gets what, across all releases ── */}
      {data.collaboratorTotals.length > 0 && (
        <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-black p-5 md:p-6">
          <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
            <PiggyBank className="h-3.5 w-3.5" aria-hidden="true" /> Everyone's share of logged income
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.collaboratorTotals.map((c) => (
              <div key={c.name.toLowerCase()} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <p className="truncate font-bold text-white">{c.name}</p>
                <p className="text-xs text-white/45">{roleLabel(c.role)}</p>
                <p className="mt-2 font-display text-2xl font-black text-primary">{fmtMoney(c.totalCents)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── per-release breakdown ── */}
      {data.releases.map((r) => (
        <div key={r.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 font-display text-lg font-black text-white">
                <Disc3 className="h-4 w-4 text-primary" aria-hidden="true" /> {r.title}
              </p>
              <p className="text-xs text-white/45">
                {r.artistName} · {fmtMoney(r.totalIncomeCents)} linked income
              </p>
            </div>
            <Link
              href="/distribute"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-white"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Edit splits
            </Link>
          </div>

          {/* active agreement */}
          {r.activeSplits.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {r.activeSplits.map((s) => (
                <span
                  key={s.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white/70"
                >
                  <b className="text-white">{s.name}</b>
                  <span className="text-white/45">{roleLabel(s.role)}</span>
                  <span className="font-black text-primary">{s.sharePct}%</span>
                </span>
              ))}
              <span className="inline-flex items-center rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/35">
                v{r.activeSplits[0]!.agreementVersion} · edits apply to future earnings only
              </span>
            </div>
          )}

          {/* collaborator totals for this release */}
          {r.collaboratorTotals.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {r.collaboratorTotals.map((c) => (
                <div key={c.name.toLowerCase()} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                  <p className="truncate text-xs font-bold text-white">{c.name}</p>
                  <p className="font-display text-base font-black text-primary">{fmtMoney(c.totalCents)}</p>
                </div>
              ))}
            </div>
          )}

          {/* per-entry application */}
          {r.entries.length > 0 ? (
            <ul className="mt-4 divide-y divide-white/[0.06]">
              {r.entries.map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <p className="min-w-0 truncate font-semibold text-white">
                      {e.note || "Income"}
                      <span className="ml-2 text-[11px] font-normal text-white/40">
                        {e.entryDate} · agreement v{e.agreementVersion}
                      </span>
                    </p>
                    <p className="shrink-0 font-display font-black text-emerald-300">{fmtMoney(e.amountCents)}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    {e.shares.map((s) => (
                      <span key={s.name} className="text-xs text-white/55">
                        {s.name} <b className="text-white/85">{s.sharePct}%</b>
                        {" → "}
                        <b className="text-primary">{fmtMoney(s.amountCents)}</b>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-white/15 px-4 py-3 text-xs text-white/45">
              No income linked to this release yet. Link income entries from the ledger and
              the splits apply here automatically.
            </p>
          )}
        </div>
      ))}

      {/* ── unlinked income nudge ── */}
      {data.unlinkedIncomeCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
          <p className="flex items-center gap-2 text-sm text-amber-200/90">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {fmtMoney(data.unlinkedIncomeCents)} across {data.unlinkedIncomeCount} income{" "}
            {data.unlinkedIncomeCount === 1 ? "entry" : "entries"} isn't linked to a release.
          </p>
          <p className="text-xs text-white/45">Link entries from the ledger to apply splits to them.</p>
        </div>
      )}
    </div>
  );
}

/** Fetches the creator's releases for the income-entry release picker. */
export async function fetchReleaseOptions(
  confirmedFetch: ConfirmedFetch,
): Promise<ReleaseOption[]> {
  try {
    const res = await confirmedFetch("/api/distribution/releases", { skipConfirm: true });
    if (!res || !res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as { releases?: Array<{ id: string; title: string }> };
    return (data.releases ?? []).map((r) => ({ id: r.id, title: r.title }));
  } catch {
    return [];
  }
}
