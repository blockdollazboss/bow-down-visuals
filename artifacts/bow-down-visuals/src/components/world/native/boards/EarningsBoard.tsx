import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeBoard,
  NativeBoardRow,
  NativeCard,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native";
import {
  earningsSourceRows,
  normalizeClaims,
  normalizeEarningsResponse,
  normalizeLedger,
  normalizePermanence,
  statementPdfPath,
  statementYears,
  usd,
  type EarningsResponse,
  type LedgerEntry,
} from "@/lib/world/earnings-board";

/* ─── EarningsBoard — the Get Paid Room as a palace board ────────────
   NATIVE-PLAN §3.1: headline balance + per-source totals from
   GET /api/earnings (the payload runs through the house guard,
   lib/earnings-data — a source that failed shows its own error
   line, never a fake zero), recent money movement as rows, and
   the old /credit-history folded in as the Ledger tab
   (GET /api/credits/history + GET /api/payments/history).
   Distribution permanence and content-ID claims appear as
   READ-ONLY status rows — changing an election or working a claim
   is management, and management is what the transfer footer is
   for (this board never writes to either rail). The statement
   button downloads a PDF file (plan §3.9: a download is not a
   pull-up) using the documents panel's own blob pattern. */

type EarningsTab = "earnings" | "ledger";

const LEDGER_CAP = 30;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function EarningsBoard({ isLight }: { isLight: boolean }) {
  const { getAccessToken } = useAuth();
  const [tab, setTab] = useState<EarningsTab>("earnings");
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null);
  const [earningsFailed, setEarningsFailed] = useState(false);
  const [permanenceNote, setPermanenceNote] = useState<string[] | null>(null);
  const [claimsNote, setClaimsNote] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [year, setYear] = useState(() => statementYears()[0]!);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  /* The headline + sources. A payload the guard can't normalize is
     a failed load — the honest error state, never $NaN rows. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/earnings", { headers: await authHeaders() });
        if (!res.ok) throw new Error("earnings");
        const normalized = normalizeEarningsResponse(await res.json());
        if (!normalized) throw new Error("earnings payload");
        if (!cancelled) {
          setEarnings(normalized);
          setEarningsFailed(false);
        }
      } catch {
        if (!cancelled) setEarningsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The read-only status rows: secondary rails — each degrades to
     its own quiet line, never taking the board down with it. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/distribution/permanence", { headers: await authHeaders() });
        if (!res.ok) throw new Error("permanence");
        const status = normalizePermanence(await res.json());
        if (cancelled) return;
        if (!status) {
          setPermanenceNote(["No permanence election recorded — your catalog rides the standard terms."]);
        } else {
          const lines: string[] = [];
          if (status.catalogElection) lines.push(`Catalog: ${status.catalogElection}`);
          for (const r of status.releases.slice(0, 3)) lines.push(`${r.title}: ${r.election}`);
          if (status.releases.length > 3) lines.push(`+${status.releases.length - 3} more releases`);
          setPermanenceNote(lines);
        }
      } catch {
        if (!cancelled) setPermanenceNote(["Permanence status didn't answer — your elections are unchanged."]);
      }
      try {
        const res = await fetch("/api/content-id/claims", { headers: await authHeaders() });
        if (!res.ok) throw new Error("claims");
        const claims = normalizeClaims(await res.json());
        if (cancelled) return;
        if (claims.length === 0) {
          setClaimsNote("No matches or claims recorded — your catalog is clear.");
        } else {
          const open = claims.filter((c) => c.status !== "resolved").length;
          setClaimsNote(
            `${claims.length} ${claims.length === 1 ? "match" : "matches"} on record · ${open} open · latest: ${claims[0]!.label} — ${claims[0]!.status}`,
          );
        }
      } catch {
        if (!cancelled) setClaimsNote("Claim status didn't answer — nothing about your claims changed.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The Ledger tab's two rails — both required, like the page's:
     a half-ledger would misread as the whole story. */
  useEffect(() => {
    if (tab !== "ledger" || ledger !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [creditsRes, paymentsRes] = await Promise.all([
          fetch("/api/credits/history", { headers }),
          fetch("/api/payments/history", { headers }),
        ]);
        if (!creditsRes.ok || !paymentsRes.ok) throw new Error("ledger");
        const entries = normalizeLedger(await creditsRes.json(), await paymentsRes.json());
        if (!cancelled) {
          setLedger(entries);
          setLedgerFailed(false);
        }
      } catch {
        if (!cancelled) setLedgerFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tick]);

  /* The statement PDF: fetch the file with the member's token and
     hand it to the browser's save dialog — the documents panel's
     own pattern. A download, not a page (plan §3.9). */
  const downloadStatement = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfNote(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch(statementPdfPath(year), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("pdf");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `earnings-statement-${year}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPdfNote(`Your ${year} statement is downloading.`);
    } catch {
      setPdfNote("That statement wouldn't download — try again in a moment.");
    } finally {
      setPdfBusy(false);
    }
  };

  const tabBtn = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
      active
        ? "bg-[#d4af37] text-black"
        : isLight
          ? "border border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border border-white/15 text-white/75 hover:text-white"
    }`;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Earnings">
        <button type="button" role="tab" aria-selected={tab === "earnings"} data-testid="world-earnings-tab-earnings" onClick={() => setTab("earnings")} className={tabBtn(tab === "earnings")}>
          Earnings
        </button>
        <button type="button" role="tab" aria-selected={tab === "ledger"} data-testid="world-earnings-tab-ledger" onClick={() => setTab("ledger")} className={tabBtn(tab === "ledger")}>
          Ledger
        </button>
      </div>

      {tab === "earnings" ? (
        earningsFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The money ledger wouldn't open"
            message="Your earnings are safe on the real rails — this board just couldn't read them. Try again."
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : earnings === null ? (
          <NativeLoadingState isLight={isLight} message="Counting your earnings…" />
        ) : (
          <>
            <NativeBoard
              isLight={isLight}
              title="Your earnings"
              headline={
                <NativeCard isLight={isLight}>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span>
                      <span className={`block text-[11px] font-bold uppercase tracking-wide ${muted}`}>Total earned (USD)</span>
                      <span className={`text-2xl font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{usd(earnings.totalCents)}</span>
                    </span>
                    <span className={`text-xs font-semibold ${muted}`}>
                      Stream tips:{" "}
                      {earnings.totalTipsVb === null
                        ? "couldn't load"
                        : `${earnings.totalTipsVb.toLocaleString("en-US")} Visual Bucs`}
                    </span>
                    {earnings.partial && (
                      <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                        Some sources couldn&rsquo;t load — this total covers the ones that did.
                      </span>
                    )}
                  </div>
                </NativeCard>
              }
            >
              {earningsSourceRows(earnings).map((row) => (
                <NativeBoardRow key={row.title} isLight={isLight} title={row.title} detail={row.detail} meta={row.meta} />
              ))}
              <NativeBoardRow
                isLight={isLight}
                title="Distribution permanence"
                detail={permanenceNote ? permanenceNote.join(" · ") : "Reading your elections…"}
                meta="Read-only"
              />
              <NativeBoardRow
                isLight={isLight}
                title="Content-ID matches & claims"
                detail={claimsNote ?? "Reading your claims…"}
                meta="Read-only"
              />
            </NativeBoard>

            <NativeCard isLight={isLight} title="Earnings statement">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Statement year"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                    isLight ? "border-[#7A5A12]/30 bg-white/60 text-[#2a1e07]" : "border-white/15 bg-white/5 text-white"
                  }`}
                >
                  {statementYears().map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="world-earnings-statement-pdf"
                  onClick={() => void downloadStatement()}
                  disabled={pdfBusy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {pdfBusy ? "Preparing…" : "Download statement (PDF)"}
                </button>
                <span className={`text-[11px] ${muted}`}>
                  A statement of platform-recorded earnings — it saves as a file; you stay in the room.
                </span>
              </div>
              {pdfNote && (
                <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{pdfNote}</p>
              )}
            </NativeCard>
          </>
        )
      ) : ledgerFailed ? (
        <NativeErrorState
          isLight={isLight}
          title="The ledger wouldn't open"
          message="Your Visual Buc history is safe — the ledger just didn't answer. Try again."
          onRetry={() => {
            setLedger(null);
            setTick((n) => n + 1);
          }}
        />
      ) : ledger === null ? (
        <NativeLoadingState isLight={isLight} message="Opening the ledger…" />
      ) : ledger.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message="No ledger entries yet."
          detail="Purchases and Visual Buc activity land here the moment they happen."
        />
      ) : (
        <NativeBoard isLight={isLight} title="Visual Buc ledger">
          {ledger.slice(0, LEDGER_CAP).map((entry) => (
            <NativeBoardRow
              key={entry.id}
              isLight={isLight}
              title={entry.title}
              detail={[entry.detail, fmtDate(entry.dateIso)].filter(Boolean).join(" · ") || undefined}
              meta={entry.unit === "VB" ? `${entry.amount} VB` : entry.amount}
            />
          ))}
          {ledger.length > LEDGER_CAP && (
            <p className={`px-1 pt-1 text-[11px] ${muted}`}>
              Showing the latest {LEDGER_CAP} of {ledger.length} entries — the full history waits on the website, one tap below.
            </p>
          )}
        </NativeBoard>
      )}
    </div>
  );
}
