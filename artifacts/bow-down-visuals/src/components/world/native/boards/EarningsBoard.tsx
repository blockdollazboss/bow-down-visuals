import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Download, Eye, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeBoard,
  NativeBoardRow,
  NativeCard,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native";
import { loadEarnings, EarningsLoadCancelled } from "@/lib/earnings-data";
import { PayoutDesk } from "@/components/world/native/PayoutDesk";
import { MoneyActionsDesk } from "@/components/world/native/MoneyActionsDesk";
import { CatalogExportDesk } from "@/components/world/native/CatalogExportDesk";
import { SuccessionDesk } from "@/components/world/native/SuccessionDesk";
import { ReferralsDesk } from "@/components/world/native/ReferralsDesk";
import { PlansDesk } from "@/components/world/native/PlansDesk";
import HostingDesk from "@/components/world/native/HostingDesk";
import { TipJarDesk } from "@/components/world/native/TipJarDesk";
import { ledgerPage } from "@/lib/world/money-desks-2";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import {
  earningsSourceRows,
  fetchBoardJson,
  loadBoardLedger,
  loadBoardStatement,
  normalizeClaims,
  normalizePermanence,
  statementIsEmpty,
  statementLineRows,
  statementLineText,
  statementMoney,
  statementPdfPath,
  statementStringsFrom,
  statementTotalLabel,
  statementYears,
  usd,
  type EarningsBoardStrings,
  type EarningsResponse,
  type EarningsStatement,
  type LedgerEntry,
} from "@/lib/world/earnings-board";

/* ─── EarningsBoard — the Get Paid Room as a palace board ────────────
   NATIVE-PLAN §3.1: headline balance + per-source totals from
   GET /api/earnings (the payload runs through the house guard,
   lib/earnings-data — a source that failed shows its own error
   line, never a fake zero), recent money movement as rows, and
   the old /credit-history folded in as the Ledger tab
   (GET /api/credits/history + GET /api/payments/history).
   Distribution permanence and content-ID claims appear as status
   rows here, and — Stack-100 #67 — the MoneyActionsDesk under
   this board works them on the same rails the 2D money pages use
   (permanence PUTs, claim PATCHes); #66 adds the TipJarDesk
   (your tip page + settings), #69 the PlansDesk (site plan
   subscriptions on the creator-tiers rails) and #70 turns the
   Ledger tab into the full paginated history. World Parity
   P3-F adds the tail desks: the CatalogExportDesk (the
   catalog-export builder on its routes/trust.ts rail — one
   kind, picked fields, the file downloads in the room) and
   the SuccessionDesk (legacy designation, inbox answers and
   legacy contact on the /api/legacy/* rails) — the two Get
   Paid surfaces that had no in-world form. The statement
   card views the year's statement ON the board and downloads it
   as a PDF file (plan §3.9: a download is not a pull-up) using
   the documents panel's own blob pattern. The view and the PDF
   are the same statement — one server builder feeds the JSON
   route and the PDF route — rendered with the shared line list
   (lib/earnings-statement), so the room never shows numbers the
   PDF doesn't carry.
   Every load rides the earnings page's patience discipline
   (lib/earnings-data): the headline IS the page's loadEarnings,
   the other rails ride the same loop in lib/world/earnings-board —
   several attempts, growing backoff, a per-attempt timeout, a
   fresh token per attempt — so a waking box or a token hiccup
   reads as "still trying", never as a dead board. Guests hold no
   hand: earnings are member data, so a guest gets the sign-in
   pitch and no fetch ever fires for them. */

type EarningsTab = "earnings" | "ledger";

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

export function EarningsBoard({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  /* Statement labels ride the shared earnings.stmt* bundle
     (Stack-200 D6) — the same words the Earnings page prints. */
  const stmtStrings = statementStringsFrom(t);
  /* The seam's string bundle, key-mapped through the catalogs —
     the seam's own defaults keep un-wired callers in English. */
  const boardStrings: EarningsBoardStrings = {
    couldntLoad: t("worldBoards.ebCouldntLoad"),
    sourceDidntAnswer: t("worldBoards.ebSourceDidntAnswer"),
    paymentOne: t("worldBoards.ebPaymentOne"),
    paymentOther: t("worldBoards.ebPaymentOther"),
    storeSales: t("worldBoards.ebStoreSales"),
    memberships: t("worldBoards.ebMemberships"),
    brandDeals: t("worldBoards.ebBrandDeals"),
    streamTips: t("worldBoards.ebStreamTips"),
    stageTips: t("worldBoards.ebStageTips"),
    storeBreakdown: t("worldBoards.ebStoreBreakdown"),
    tipsMetaVb: t("worldBoards.ebTipsMetaVb"),
    streamTipsDetail: t("worldBoards.ebStreamTipsDetail"),
    stageTipsDetail: t("worldBoards.ebStageTipsDetail"),
    grant: t("worldBoards.ebLedgerGrant"),
    refund: t("worldBoards.ebLedgerRefund"),
    visualBucBack: t("worldBoards.ebVisualBucBack"),
    free: t("worldBoards.ebLedgerFree"),
    charge: t("worldBoards.ebLedgerCharge"),
    visualBucActivity: t("worldBoards.ebVisualBucActivity"),
    visualBucPack: t("worldBoards.ebVisualBucPack"),
    visualBucPurchase: t("worldBoards.ebVisualBucPurchase"),
    paymentDetailVb: t("worldBoards.ebPaymentDetailVb"),
    releaseFallback: t("worldBoards.ebReleaseFallback"),
    uploadFallback: t("worldBoards.ebUploadFallback"),
    claimStatusUnknown: t("worldBoards.ebClaimStatusUnknown"),
    claimYouAreThe: t("worldBoards.ebClaimYouAreThe"),
    claimConfidence: t("worldBoards.ebClaimConfidence"),
    claimLandmarksMatched: t("worldBoards.ebClaimLandmarksMatched"),
  };
  const { getAccessToken } = useAuth();
  const [tab, setTab] = useState<EarningsTab>("earnings");
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null);
  const [earningsFailed, setEarningsFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [permanenceNote, setPermanenceNote] = useState<string[] | null>(null);
  const [claimsNote, setClaimsNote] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);
  /* Stack-100 #70: the Ledger tab is the FULL history, paged —
     the page index lives here; ledgerPage clamps it into range. */
  const [ledgerPg, setLedgerPg] = useState(0);
  const [tick, setTick] = useState(0);
  const [year, setYear] = useState(() => statementYears()[0]!);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const [stmt, setStmt] = useState<EarningsStatement | null>(null);
  const [stmtBusy, setStmtBusy] = useState(false);
  const [stmtFailed, setStmtFailed] = useState(false);
  /* A view load is sequence-guarded: picking another year (or
     re-tapping View) retires the in-flight load, so a slow answer
     for one year can never land under another year's label. */
  const stmtSeq = useRef(0);

  /* The headline + sources — the page's own loadEarnings, verbatim:
     a payload the guard can't normalize is a failed ATTEMPT (it
     retries, never renders), and only exhaustion lands on the
     honest error state below, never $NaN rows. */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setRetrying(false);
    (async () => {
      try {
        const normalized = await loadEarnings({
          getToken: () => getAccessToken(),
          isCancelled: () => cancelled,
          onRetry: () => {
            if (!cancelled) setRetrying(true);
          },
        });
        if (!cancelled) {
          setEarnings(normalized);
          setEarningsFailed(false);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof EarningsLoadCancelled)) setEarningsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, isGuest]);

  /* The read-only status rows: secondary rails — each rides the
     same patient loop (a sleeping box shouldn't paint a false
     "didn't answer"), then degrades to its own quiet line on
     exhaustion, never taking the board down with it. */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    const deps = { getToken: () => getAccessToken(), isCancelled: () => cancelled };
    (async () => {
      try {
        const status = normalizePermanence(await fetchBoardJson(deps, "/api/distribution/permanence"), boardStrings);
        if (cancelled) return;
        if (!status) {
          setPermanenceNote([t("worldBoards.ebNoPermanence")]);
        } else {
          const lines: string[] = [];
          if (status.catalogElection) lines.push(t("worldBoards.ebCatalogLine", { election: status.catalogElection }));
          for (const r of status.releases.slice(0, 3)) lines.push(t("worldBoards.ebReleaseLine", { title: r.title, election: r.election }));
          if (status.releases.length > 3) lines.push(t("worldBoards.ebMoreReleases", { count: status.releases.length - 3 }));
          setPermanenceNote(lines);
        }
      } catch {
        if (!cancelled) setPermanenceNote([t("worldBoards.ebPermanenceDidntAnswer")]);
      }
      try {
        const claims = normalizeClaims(await fetchBoardJson(deps, "/api/content-id/claims"), boardStrings);
        if (cancelled) return;
        if (claims.length === 0) {
          setClaimsNote(t("worldBoards.ebNoClaims"));
        } else {
          const open = claims.filter((c) => c.status !== "resolved").length;
          setClaimsNote(
            t(claims.length === 1 ? "worldBoards.ebClaimsSummaryOne" : "worldBoards.ebClaimsSummaryMany", {
              count: claims.length,
              open,
              label: claims[0]!.label,
              status: claims[0]!.status,
            }),
          );
        }
      } catch {
        if (!cancelled) setClaimsNote(t("worldBoards.ebClaimsDidntAnswer"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, isGuest]);

  /* The Ledger tab's two rails — both required, like the page's:
     a half-ledger would misread as the whole story. The pair rides
     as one retryable unit (loadBoardLedger): fresh token per
     attempt, one timeout per attempt, exhaustion → the error
     state below with its working Try again. */
  useEffect(() => {
    if (isGuest || tab !== "ledger" || ledger !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const entries = await loadBoardLedger(
          {
            getToken: () => getAccessToken(),
            isCancelled: () => cancelled,
          },
          {},
          boardStrings,
          i18n.language,
        );
        if (!cancelled) {
          setLedger(entries);
          setLedgerFailed(false);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof EarningsLoadCancelled)) setLedgerFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tick, isGuest]);

  /* Changing the year retires whatever the card was showing for
     the old one: the viewed statement clears and the PDF note
     clears with it, so the lines on the board always belong to
     the year in the picker — the view and the download can never
     silently point at different years. */
  const pickYear = (y: number) => {
    stmtSeq.current++;
    setYear(y);
    setStmt(null);
    setStmtFailed(false);
    setStmtBusy(false);
    setPdfNote(null);
  };

  /* The statement view: the JSON route's statement — the same
     builder object the PDF renders — ridden patiently by
     loadBoardStatement. Exhaustion lands on the card's honest
     failure line; the stale statement (if one was open) clears
     rather than posing as the fresh answer. */
  const viewStatement = async () => {
    if (stmtBusy) return;
    const seq = ++stmtSeq.current;
    setStmtBusy(true);
    setStmtFailed(false);
    try {
      const s = await loadBoardStatement(
        { getToken: () => getAccessToken(), isCancelled: () => stmtSeq.current !== seq },
        year,
      );
      if (stmtSeq.current !== seq) return;
      setStmt(s);
    } catch (err) {
      if (stmtSeq.current !== seq || err instanceof EarningsLoadCancelled) return;
      setStmt(null);
      setStmtFailed(true);
    } finally {
      if (stmtSeq.current === seq) setStmtBusy(false);
    }
  };

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
      setPdfNote(t("worldBoards.ebPdfDownloading", { year }));
    } catch {
      setPdfNote(t("worldBoards.ebPdfWouldntDownload"));
    } finally {
      setPdfBusy(false);
    }
  };

  const tabBtn = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "bg-[#d4af37] text-black"
        : isLight
          ? "border border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border border-white/15 text-white/75 hover:text-white"
    }`;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  /* Guests hold no hand: every number on this board is the member's
     own money, so a guest sees the pitch, never a board that fires
     doomed fetches and lands on an error card whose Try again can
     never succeed (the Kingdom Board standings' own treatment). */
  if (isGuest) {
    return (
      <NativeBoard isLight={isLight} title={t("worldBoards.ebBoardTitle")}>
        <p className={`inline-flex flex-wrap items-center gap-2 px-1 py-1 text-sm ${muted}`}>
          {t("worldBoards.ebGuestBody")}
          <Link
            href={GUEST_SIGN_IN_HREF}
            className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105"
          >
            <LogIn className="h-3 w-3" /> {t("worldBoards.ebSignInToSee")}
          </Link>
        </p>
      </NativeBoard>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldBoards.ebTabEarnings")}>
        <button type="button" role="tab" aria-selected={tab === "earnings"} data-testid="world-earnings-tab-earnings" onClick={() => setTab("earnings")} className={tabBtn(tab === "earnings")}>
          {t("worldBoards.ebTabEarnings")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "ledger"} data-testid="world-earnings-tab-ledger" onClick={() => setTab("ledger")} className={tabBtn(tab === "ledger")}>
          {t("worldBoards.ebTabLedger")}
        </button>
      </div>

      {tab === "earnings" ? (
        earningsFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldBoards.ebMoneyLedgerWontOpen")}
            message={t("worldBoards.ebEarningsSafeRetry")}
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : earnings === null ? (
          <NativeLoadingState
            isLight={isLight}
            message={retrying ? t("worldBoards.ebStillCounting") : t("worldBoards.ebCountingEarnings")}
          />
        ) : (
          <>
            <NativeBoard
              isLight={isLight}
              title={t("worldBoards.ebBoardTitle")}
              headline={
                <NativeCard isLight={isLight}>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span>
                      <span className={`block text-[11px] font-bold uppercase tracking-wide ${muted}`}>{t("worldBoards.ebTotalEarnedUsd")}</span>
                      <span className={`text-2xl font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{usd(earnings.totalCents, i18n.language)}</span>
                    </span>
                    <span className={`text-xs font-semibold ${muted}`}>
                      {t("worldBoards.ebStreamTipsColon")}{" "}
                      {earnings.sources.tips.status === "error"
                        ? t("worldBoards.ebCouldntLoadInline")
                        : `${(earnings.sources.tips.streamTipsVb ?? 0).toLocaleString(i18n.language)} Visual Bucs`}
                    </span>
                    <span className={`text-xs font-semibold ${muted}`}>
                      {t("worldBoards.ebStageTipsColon")}{" "}
                      {earnings.sources.tips.status === "error"
                        ? t("worldBoards.ebCouldntLoadInline")
                        : `${(earnings.sources.tips.stageTipsVb ?? 0).toLocaleString(i18n.language)} Visual Bucs`}
                    </span>
                    {earnings.partial && (
                      <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                        {t("worldBoards.ebSomeSourcesCouldntLoad")}
                      </span>
                    )}
                  </div>
                </NativeCard>
              }
            >
              {earningsSourceRows(earnings, boardStrings, i18n.language).map((row) => (
                <NativeBoardRow key={row.title} isLight={isLight} title={row.title} detail={row.detail} meta={row.meta} />
              ))}
              <NativeBoardRow
                isLight={isLight}
                title={t("worldBoards.ebPermRowTitle")}
                detail={permanenceNote ? permanenceNote.join(" · ") : t("worldBoards.ebReadingElections")}
                meta={t("worldBoards.ebManageBelow")}
              />
              <NativeBoardRow
                isLight={isLight}
                title={t("worldBoards.ebContentIdRowTitle")}
                detail={claimsNote ?? t("worldBoards.ebReadingClaims")}
                meta={t("worldBoards.ebWorkThemBelow")}
              />
            </NativeBoard>

            <NativeCard isLight={isLight} title={t("worldBoards.ebStatementTitle")}>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={t("worldBoards.ebStatementYearAria")}
                  value={year}
                  onChange={(e) => pickYear(Number(e.target.value))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${
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
                  data-testid="world-earnings-statement-view"
                  onClick={() => void viewStatement()}
                  disabled={stmtBusy}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-bold transition hover:scale-105 disabled:opacity-50 bdv-touch-target ${
                    isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  {stmtBusy ? t("worldBoards.ebLoading") : t("worldBoards.ebViewStatement")}
                </button>
                <button
                  type="button"
                  data-testid="world-earnings-statement-pdf"
                  onClick={() => void downloadStatement()}
                  disabled={pdfBusy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                >
                  <Download className="h-3.5 w-3.5" />
                  {pdfBusy ? t("worldBoards.ebPreparing") : t("worldBoards.ebDownloadStatementPdf")}
                </button>
                <span className={`text-[11px] ${muted}`}>
                  {t("worldBoards.ebStatementBlurb")}
                </span>
              </div>
              {pdfNote && (
                <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{pdfNote}</p>
              )}
              {stmtFailed && (
                <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  {t("worldBoards.ebStatementCouldntLoad")}
                </p>
              )}
              {stmt && (
                <div className="mt-3" data-testid="world-earnings-statement-lines">
                  {statementLineRows(stmt, stmtStrings).map((row) => (
                    <div
                      key={row.key}
                      className={`flex items-baseline justify-between gap-3 border-b py-1.5 text-xs ${
                        isLight ? "border-[#7A5A12]/15" : "border-white/10"
                      }`}
                    >
                      <span className={muted}>{row.label}</span>
                      <span className={`font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{statementLineText(row, stmtStrings)}</span>
                    </div>
                  ))}
                  <div className={`flex items-baseline justify-between gap-3 py-2 text-xs font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    <span>{statementTotalLabel(stmt.partial, stmtStrings)}</span>
                    <span>{statementMoney(stmt.totalCents, stmtStrings.couldntLoad)}</span>
                  </div>
                  {statementIsEmpty(stmt) && (
                    <p className={`text-[11px] ${muted}`}>{t("worldBoards.ebStatementEmpty", { year })}</p>
                  )}
                  <p className={`mt-1 text-[11px] ${muted}`}>
                    {t("worldBoards.ebStatementNotTaxForm")}
                  </p>
                </div>
              )}
            </NativeCard>

            {/* Stack-100 #62: the payout desk — Stripe Connect status
                and cash-out on the real /api/connect rails, under the
                earnings it pays out. Bank onboarding is the hosted
                flow (sanctioned exit, same as the website). */}
            <PayoutDesk isLight={isLight} />

            {/* Stack-100 #67: the management desk — permanence
                elections and Content-ID claim actions on the 2D
                money pages' own rails, under the status rows above
                that summarise them. */}
            <MoneyActionsDesk isLight={isLight} />

            {/* Stack-100 #66: your tip page — settings, totals and
                the recent feed on the Tip Jar page's rails. */}
            <TipJarDesk isLight={isLight} />

            {/* Stack-100 #69: your site plan — the creator-tiers
                catalog read from its rail, checkout/portal hosted
                in a new tab, exactly as the pricing page rides it. */}
            <PlansDesk isLight={isLight} />

            {/* Stack 300 #90 (A5): Profile Hosting — the hosting
                door's World sibling on the /api/creator-hosting
                rails: status native, embedded checkout in the desk,
                the billing portal in a new tab at the money moment
                only, exactly as the pricing-page card rides it. */}
            <HostingDesk isLight={isLight} />

            {/* World Parity P3-F: the catalog-export builder —
                one kind, the fields you pick, built on the
                routes/trust.ts rail and downloaded as a file
                in the room, exactly as Settings builds it. */}
            <CatalogExportDesk isLight={isLight} />

            {/* World Parity P3-F: legacy & succession — the
                designation, the inbox answers and the legacy
                contact on the /api/legacy/* rails, the Settings
                panels' own forms promoted in-world. */}
            <SuccessionDesk isLight={isLight} />

            {/* Referrals (stack1100 parity): your code, your people,
                your promoter climb and the monthly contest, on the
                /api/referrals rails — the growth engine sits with
                the money it earns. */}
            <ReferralsDesk isLight={isLight} />
          </>
        )
      ) : ledgerFailed ? (
        <NativeErrorState
          isLight={isLight}
          title={t("worldBoards.ebLedgerWontOpen")}
          message={t("worldBoards.ebLedgerSafeRetry")}
          onRetry={() => {
            setLedger(null);
            setTick((n) => n + 1);
          }}
        />
      ) : ledger === null ? (
        <NativeLoadingState isLight={isLight} message={t("worldBoards.ebOpeningLedger")} />
      ) : ledger.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message={t("worldBoards.ebNoLedgerEntries")}
          detail={t("worldBoards.ebLedgerEmptyDetail")}
        />
      ) : (
        /* Stack-100 #70: the FULL history, paged in place — every
           entry the two history rails returned, twenty to a page,
           newest first. Nothing is capped to "recent rows" and no
           one is sent to the website to read their own ledger. */
        (() => {
          const page = ledgerPage(ledger, ledgerPg);
          return (
            <div data-testid="world-ledger-full">
              <NativeBoard isLight={isLight} title={t("worldBoards.ebLedgerFullTitle")}>
                {page.rows.map((entry) => (
                  <NativeBoardRow
                    key={entry.id}
                    isLight={isLight}
                    title={entry.title}
                    detail={[entry.detail, fmtDate(entry.dateIso, i18n.language)].filter(Boolean).join(" · ") || undefined}
                    meta={entry.unit === "VB" ? `${entry.amount} VB` : entry.amount}
                  />
                ))}
              </NativeBoard>
              <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                <button
                  type="button"
                  data-testid="world-ledger-prev"
                  disabled={page.page === 0}
                  onClick={() => setLedgerPg(page.page - 1)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 bdv-touch-target ${
                    isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"
                  }`}
                >
                  {t("worldBoards.ebNewer")}
                </button>
                <span className={`text-[11px] font-semibold ${muted}`}>
                  {t(page.total === 1 ? "worldBoards.ebPageOfOne" : "worldBoards.ebPageOfMany", {
                    page: page.page + 1,
                    pageCount: page.pageCount,
                    total: page.total,
                  })}
                </span>
                <button
                  type="button"
                  data-testid="world-ledger-next"
                  disabled={page.page >= page.pageCount - 1}
                  onClick={() => setLedgerPg(page.page + 1)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 bdv-touch-target ${
                    isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"
                  }`}
                >
                  {t("worldBoards.ebOlder")}
                </button>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
