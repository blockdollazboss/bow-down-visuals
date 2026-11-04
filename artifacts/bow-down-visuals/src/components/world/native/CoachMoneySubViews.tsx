import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Disc3,
  DollarSign,
  FileDown,
  FileText,
  Flag,
  Link2,
  Loader2,
  Music2,
  Pencil,
  PiggyBank,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { roleLabel } from "@/lib/distribution";
import { fetchReleaseOptions } from "@/components/coach/SplitsOverview";
import {
  PUBLISHING_COPY,
  PUBLISHING_SPLITS_MINE_PATH,
  PUBLISHING_SPLITS_PATH,
  publishingActionPath,
  publishingSheetPath,
  publishingStateLabel,
  publishingViewerActions,
  writerSplitValidationError,
  writerStatusLabel,
  type PublishingRegistrationItem,
} from "@/lib/publishing-splits";
import {
  loadRoyaltySources,
  type Payout,
  type PlatformStatus,
  type SummaryData,
} from "@/lib/royalties-load";
import { fmtPlanMoney } from "@/lib/coach-tracker";
import {
  ROYALTY_INSIGHTS_COST_VISUAL_BUCS,
  SPLIT_SHEET_PDF_COST_VISUAL_BUCS,
  buildPublishingAmendPayload,
  buildPublishingDisputePayload,
  buildPublishingRegisterPayload,
  buildRoyaltyPayoutPayload,
  buildSplitLedgerPostBody,
  buildWave8SheetPayload,
  isOutOfCreditsResponse,
  ledgerTodayYmd,
  parseFinalizedSheet,
  parsePublishingMine,
  parseRoyaltyInsights,
  parseSplitsOverview,
  parseWave8Sheets,
  publishingWritersFromRows,
  royaltyBarPct,
  royaltyMoneyLabel,
  royaltyMonthlyBarHeight,
  splitCentsLargestRemainder,
  splitSheetSlug,
  validateRoyaltyPayoutDraft,
  validateWave8Draft,
  wave8DraftTotalPct,
  type FinalizedSplitSheet,
  type PublishingWriterDraft,
  type RoyaltyInsight,
  type RoyaltyPayoutDraft,
  type SplitsOverviewData,
  type Wave8DraftRow,
  type Wave8Sheet,
} from "@/lib/world/coach-panels";
import {
  InnerBlock,
  SubHead,
  chipBtn,
  goldBtn,
  inputCls,
  smallBtn,
  useCoachAuthHeaders,
} from "./CoachPanelBits";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";

/* ─── The Money Tracker's sub-views, finished in-world (Ring 4 #6) ──
   The /coach Money Tracker card carries four views; the ledger rode
   first (CoachPanels, parity P3) and these three finish the card on
   the page's own rails — no figure invented, none approximated:
     · CoachSplitsSection — GET /api/splits/overview (the server's
       split accounting over linked ledger income, disclaimer carried
       verbatim) + the publishing registry on /api/publishing-splits
       (the shared contract in lib/publishing-splits: register /
       amend / confirm / dispute / the text split sheet).
     · CoachSplitSheetsSection — /api/wave8/splits CRUD (free), the
       royalty post-to-ledger (free, cent-exact largest-remainder),
       and the PDF finalize (50 Visual Bucs, the registry's figure)
       rendered from the audited payload exactly as the page renders
       it, jspdf loaded on tap so the palace never carries it.
     · CoachRoyaltiesSection — the royalty dashboard through the
       page's own loader (lib/royalties-load: summary / platforms /
       payouts, each source failing on its own), CSV import, payout
       records, and the AI insights (100 Visual Bucs, the server's
       figure, charged server-side with a refund on failure).
   Failure is never painted as empty: every load carries its own
   error state with a working retry. */

/* ═══ 1a. SPLITS — the release overview ═════════════════════════════ */

function SplitsOverviewBlock({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const [data, setData] = useState<SplitsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/splits/overview", { skipConfirm: true });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subSplitsLoadError")));
      const parsed = parseSplitsOverview(json);
      if (!parsed) throw new Error(t("worldCoachMoney.subSplitsLoadError"));
      setData(parsed);
    } catch (err) {
      setError(plainErrorText(err, t("worldCoachMoney.subSplitsLoadError")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <NativeLoadingState isLight={isLight} message={t("worldCoachMoney.subComputingShares")} />;
  if (error) {
    return <NativeErrorState isLight={isLight} message={error} onRetry={() => void load()} />;
  }
  if (!data || data.releases.length === 0) {
    return (
      <NativeEmptyState
        isLight={isLight}
        message={t("worldCoachMoney.subNoSplitsYet")}
        detail={t("worldCoachMoney.subNoSplitsDetail")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${isLight ? "border-[#C9A84C]/30 bg-white/40 text-[#6B5B36]" : "border-white/10 bg-white/[0.03] text-white/55"}`}>
        {data.disclaimer}
      </p>

      {data.collaboratorTotals.length > 0 ? (
        <div>
          <SubHead isLight={isLight}><PiggyBank className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subEveryoneShare")}</SubHead>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {data.collaboratorTotals.map((c) => (
              <InnerBlock key={c.name.toLowerCase()} isLight={isLight}>
                <p className={`truncate text-sm font-bold ${strong}`}>{c.name}</p>
                <p className={`text-xs ${muted}`}>{roleLabel(c.role)}</p>
                <p className={`mt-1 text-xl font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{fmtPlanMoney(c.totalCents)}</p>
              </InnerBlock>
            ))}
          </div>
        </div>
      ) : null}

      {data.releases.map((r) => (
        <InnerBlock key={r.id} isLight={isLight}>
          <div data-testid="world-coach-splits-release">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={`flex items-center gap-2 text-base font-black ${strong}`}>
                  <Disc3 className="h-4 w-4 shrink-0 text-[#d4af37]" /> <span className="truncate">{r.title}</span>
                </p>
                <p className={`text-xs ${muted}`}>
                  {r.artistName} · {t("worldCoachMoney.subLinkedIncome", { amount: fmtPlanMoney(r.totalIncomeCents) })}
                </p>
              </div>
              <span className={`text-[11px] ${muted}`}>{t("worldCoachMoney.subAgreementsAtReleaseDesk")}</span>
            </div>

            {r.activeSplits.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {r.activeSplits.map((s) => (
                  <span key={s.name} className={chipBtn(isLight, false)}>
                    <b>{s.name}</b> <span className="font-medium normal-case">{roleLabel(s.role)}</span> {s.sharePct}%
                  </span>
                ))}
                <span className={`inline-flex items-center px-1.5 text-[11px] ${muted}`}>
                  {t("worldCoachMoney.subAgreementNote", { version: r.activeSplits[0]!.agreementVersion })}
                </span>
              </div>
            ) : null}

            {r.collaboratorTotals.length > 0 ? (
              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {r.collaboratorTotals.map((c) => (
                  <div key={c.name.toLowerCase()} className={`rounded-lg border px-2.5 py-2 ${isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-black/20"}`}>
                    <p className={`truncate text-xs font-bold ${strong}`}>{c.name}</p>
                    <p className={`text-sm font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{fmtPlanMoney(c.totalCents)}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {r.entries.length > 0 ? (
              <div className="mt-2.5 space-y-2.5">
                {r.entries.map((e) => (
                  <div key={e.id} className={`border-t pt-2.5 ${isLight ? "border-[#C9A84C]/20" : "border-white/[0.06]"}`}>
                    <p className="flex items-baseline justify-between gap-2">
                      <span className={`min-w-0 truncate text-sm font-semibold ${strong}`}>
                        {e.note || t("worldCoachMoney.subIncomeFallback")}
                        <span className={`ml-2 text-[11px] font-normal ${muted}`}>
                          {e.entryDate} · {t("worldCoachMoney.subEntryAgreement", { version: e.agreementVersion })}
                        </span>
                      </span>
                      <span className={`shrink-0 text-sm font-black ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
                        {fmtPlanMoney(e.amountCents)}
                      </span>
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {e.shares.map((s) => (
                        <span key={s.name} className={`text-xs ${muted}`}>
                          {s.name} <b className={strong}>{s.sharePct}%</b> →{" "}
                          <b className={isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}>{fmtPlanMoney(s.amountCents)}</b>
                        </span>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`mt-2.5 rounded-lg border border-dashed px-3 py-2.5 text-xs ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/15 text-white/45"}`}>
                {t("worldCoachMoney.subNoIncomeLinked")}
              </p>
            )}
          </div>
        </InnerBlock>
      ))}

      {data.unlinkedIncomeCount > 0 ? (
        <p className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${isLight ? "border-amber-600/30 bg-amber-500/[0.07] text-[#92600a]" : "border-amber-500/30 bg-amber-500/[0.06] text-amber-200/90"}`}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(data.unlinkedIncomeCount === 1 ? "worldCoachMoney.subUnlinkedOne" : "worldCoachMoney.subUnlinkedMany", {
              amount: fmtPlanMoney(data.unlinkedIncomeCents),
              count: data.unlinkedIncomeCount,
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/* ═══ 1b. SPLITS — the publishing (songwriter) registry ═════════════ */

const EMPTY_WRITER_ROW: PublishingWriterDraft = { name: "", profileId: "", sharePct: "" };

function PublishingRegistryBlock({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const [data, setData] = useState<ReturnType<typeof parsePublishingMine>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ code: string; text: string } | null>(null);
  const [disputeNote, setDisputeNote] = useState<Record<string, string>>({});

  const [showForm, setShowForm] = useState(false);
  const [amendId, setAmendId] = useState<string | null>(null);
  const [songKind, setSongKind] = useState<"release" | "song">("release");
  const [songId, setSongId] = useState("");
  const [releases, setReleases] = useState<{ id: string; title: string }[]>([]);
  const [songs, setSongs] = useState<{ id: string; title: string }[]>([]);
  const [rows, setRows] = useState<PublishingWriterDraft[]>([{ ...EMPTY_WRITER_ROW }, { ...EMPTY_WRITER_ROW }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch(PUBLISHING_SPLITS_MINE_PATH, { skipConfirm: true });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subRegistryLoadError")));
      const parsed = parsePublishingMine(json);
      if (!parsed) throw new Error(t("worldCoachMoney.subRegistryLoadError"));
      setData(parsed);
    } catch (err) {
      setError(plainErrorText(err, t("worldCoachMoney.subRegistryLoadError")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForm = async (item?: PublishingRegistrationItem) => {
    setFormError(null);
    setSheet(null);
    if (item) {
      setAmendId(item.id);
      setSongKind(item.song_kind);
      setSongId(item.song_id);
      setRows(
        item.writers.map((w) => ({
          name: w.name,
          profileId: w.profile_id ?? "",
          sharePct: String(w.share_pct),
        })),
      );
    } else {
      setAmendId(null);
      setSongId("");
      setRows([{ ...EMPTY_WRITER_ROW }, { ...EMPTY_WRITER_ROW }]);
      if (releases.length === 0) setReleases(await fetchReleaseOptions(confirmedFetch));
      if (songs.length === 0) {
        try {
          const res = await confirmedFetch("/api/songs", { skipConfirm: true });
          if (res && res.ok) {
            const json = (await res.json().catch(() => ({}))) as { songs?: { id: string; title: string }[] };
            setSongs((json.songs ?? []).map((s) => ({ id: s.id, title: s.title })));
          }
        } catch {
          /* the release list alone still lets the form work */
        }
      }
    }
    setShowForm(true);
  };

  const submitForm = async () => {
    const writers = publishingWritersFromRows(rows);
    const validation = writerSplitValidationError(
      writers.map((w) => ({ name: w.name, sharePct: w.share_pct })),
    );
    if (!amendId && !songId) {
      setFormError(t("worldCoachMoney.subPickSongFirst"));
      return;
    }
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const path = amendId ? publishingActionPath(amendId, "amend") : PUBLISHING_SPLITS_PATH;
      const body = amendId ? buildPublishingAmendPayload(writers) : buildPublishingRegisterPayload({ songKind, songId, writers });
      const res = await confirmedFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        skipConfirm: true,
      });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subSaveRegistrationError")));
      setShowForm(false);
      setAmendId(null);
      await load();
    } catch (err) {
      setFormError(plainErrorText(err, t("worldCoachMoney.subSaveRegistrationError")));
    } finally {
      setSaving(false);
    }
  };

  const act = async (item: PublishingRegistrationItem, action: "confirm" | "dispute") => {
    setBusyId(item.id);
    setActionError(null);
    try {
      const res = await confirmedFetch(publishingActionPath(item.id, action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "dispute" ? buildPublishingDisputePayload(disputeNote[item.id] ?? "") : {}),
        skipConfirm: true,
      });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t(action === "confirm" ? "worldCoachMoney.subPubConfirmFailed" : "worldCoachMoney.subPubDisputeFailed")));
      await load();
    } catch (err) {
      setActionError(plainErrorText(err, t(action === "confirm" ? "worldCoachMoney.subPubConfirmFailed" : "worldCoachMoney.subPubDisputeFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const openSheet = async (item: PublishingRegistrationItem) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      const res = await confirmedFetch(publishingSheetPath(item.id), { skipConfirm: true });
      if (!res) return;
      const json = (await res.json().catch(() => ({}))) as { sheet_code?: string; sheet_text?: string; error?: string };
      if (!res.ok || !json.sheet_text) throw new Error(apiErrorMessage(json, t("worldCoachMoney.subBuildSheetError")));
      setSheet({ code: json.sheet_code ?? "", text: json.sheet_text });
    } catch (err) {
      setActionError(plainErrorText(err, t("worldCoachMoney.subBuildSheetError")));
    } finally {
      setBusyId(null);
    }
  };

  const downloadSheet = () => {
    if (!sheet) return;
    const blob = new Blob([sheet.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.code || "split-sheet"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const songOptions = songKind === "release" ? releases : songs;

  return (
    <div data-testid="world-coach-publishing-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <SubHead isLight={isLight}><BookOpen className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subRegistryHeading")}</SubHead>
          <p className={`mt-1.5 text-xs leading-relaxed ${muted}`}>{t("worldCoachMoney.subRegistryIntro")}</p>
        </div>
        <button
          type="button"
          data-testid="world-coach-publishing-register"
          className={goldBtn}
          onClick={() => void openForm()}
        >
          <Plus className="h-4 w-4" /> {t("worldCoachMoney.subRegisterSong")}
        </button>
      </div>

      {/* The honesty banner — the registry collects nothing today. */}
      <p className={`mt-2.5 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${isLight ? "border-[#C9A84C]/30 bg-white/40 text-[#6B5B36]" : "border-white/10 bg-white/[0.03] text-white/55"}`}>
        {PUBLISHING_COPY.registryOnly} <b className={strong}>{t("worldCoachMoney.subStatusPrefix")} {PUBLISHING_COPY.collectionNotice}</b>
      </p>

      {data && !data.registryReady ? (
        <p className={`mt-2.5 rounded-xl border px-3 py-2.5 text-xs ${isLight ? "border-amber-600/30 bg-amber-500/[0.07] text-[#92600a]" : "border-amber-500/30 bg-amber-500/[0.06] text-amber-200/90"}`}>
          {t("worldCoachMoney.subRegistryWarming")}
        </p>
      ) : null}

      {actionError ? (
        <p className={`mt-2.5 rounded-xl border px-3 py-2.5 text-xs ${isLight ? "border-red-600/30 bg-red-500/[0.06] text-red-800" : "border-red-500/30 bg-red-500/[0.06] text-red-200"}`}>
          {actionError}
        </p>
      ) : null}

      {showForm ? (
        <InnerBlock isLight={isLight}>
          <div className="space-y-2.5" data-testid="world-coach-publishing-form">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-bold ${strong}`}>
                {amendId ? t("worldCoachMoney.subReviseTitle") : t("worldCoachMoney.subRegisterTitle")}
              </p>
              <button type="button" aria-label={t("worldCoachMoney.subCloseForm")} className={smallBtn(isLight)} onClick={() => { setShowForm(false); setAmendId(null); }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {amendId ? (
              <p className={`text-xs ${muted}`}>
                {t("worldCoachMoney.subAmendNote")} {PUBLISHING_COPY.disputeRule}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subSongFrom")}</span>
                  <select
                    data-testid="world-coach-publishing-kind"
                    className={inputCls(isLight)}
                    style={{ colorScheme: isLight ? "light" : "dark" }}
                    value={songKind}
                    onChange={(e) => { setSongKind(e.target.value as "release" | "song"); setSongId(""); }}
                  >
                    <option value="release">{t("worldCoachMoney.subKindReleases")}</option>
                    <option value="song">{t("worldCoachMoney.subKindSongs")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subSongLabel")}</span>
                  <select
                    data-testid="world-coach-publishing-song"
                    className={inputCls(isLight)}
                    style={{ colorScheme: isLight ? "light" : "dark" }}
                    value={songId}
                    onChange={(e) => setSongId(e.target.value)}
                  >
                    <option value="">{t("worldCoachMoney.subPickSong")}</option>
                    {songOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.title}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={t("worldCoachMoney.subWriterName")}
                    className={`${inputCls(isLight)} min-w-32 flex-1`}
                    value={row.name}
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    placeholder={t("worldCoachMoney.subWriterName")}
                  />
                  <input
                    aria-label={t("worldCoachMoney.subProfileIdAria")}
                    className={`${inputCls(isLight)} min-w-32 flex-1`}
                    value={row.profileId}
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, profileId: e.target.value } : r)))}
                    placeholder={t("worldCoachMoney.subProfileIdPlaceholder")}
                  />
                  <input
                    aria-label={t("worldCoachMoney.subSharePercentAria")}
                    className={`${inputCls(isLight)} w-20`}
                    value={row.sharePct}
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, sharePct: e.target.value } : r)))}
                    placeholder="%"
                    inputMode="decimal"
                  />
                  <button
                    type="button"
                    aria-label={t("worldCoachMoney.subRemoveWriter")}
                    className={smallBtn(isLight)}
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={smallBtn(isLight)} onClick={() => setRows([...rows, { ...EMPTY_WRITER_ROW }])}>
                <Plus className="h-3 w-3" /> {t("worldCoachMoney.subAddSongwriter")}
              </button>
              <span className={`text-xs ${muted}`}>{t("worldCoachMoney.subSharesNote")}</span>
            </div>
            {formError ? <p className={`text-sm font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>{formError}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" data-testid="world-coach-publishing-save" className={goldBtn} disabled={saving} onClick={() => void submitForm()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {amendId ? t("worldCoachMoney.subSaveRevised") : t("worldCoachMoney.subRegisterSplits")}
              </button>
              <span className={`text-[11px] ${muted}`}>{PUBLISHING_COPY.collectionNotice}</span>
            </div>
          </div>
        </InnerBlock>
      ) : null}

      {sheet ? (
        <InnerBlock isLight={isLight}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`flex items-center gap-1.5 text-sm font-bold ${strong}`}>
              <FileText className="h-4 w-4 text-[#d4af37]" /> {t("worldCoachMoney.subSplitSheetCode", { code: sheet.code })}
            </p>
            <span className="flex gap-1.5">
              <button type="button" className={smallBtn(isLight)} onClick={downloadSheet}>{t("worldCoachMoney.subDownloadTxt")}</button>
              <button type="button" aria-label={t("worldCoachMoney.subCloseSheet")} className={smallBtn(isLight)} onClick={() => setSheet(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <pre className={`mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-relaxed ${isLight ? "bg-black/[0.04] text-[#2a1e07]" : "bg-black/40 text-white/75"}`}>
            {sheet.text}
          </pre>
        </InnerBlock>
      ) : null}

      {loading ? (
        <NativeLoadingState isLight={isLight} message={t("worldCoachMoney.subLoadingRegistry")} />
      ) : error ? (
        <NativeErrorState isLight={isLight} message={error} onRetry={() => void load()} />
      ) : !data || data.registrations.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message={t("worldCoachMoney.subNoSongsRegistered")}
          detail={t("worldCoachMoney.subNoSongsDetail")}
        />
      ) : (
        <div className="space-y-2.5">
          {data.registrations.map((item) => {
            const actions = publishingViewerActions(item);
            return (
              <InnerBlock key={item.id} isLight={isLight}>
                <div data-testid="world-coach-publishing-item">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-sm font-bold ${strong}`}>{item.song_title || t("worldCoachMoney.subUntitledSong")}</p>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                        item.state === "disputed"
                          ? isLight ? "border-red-600/40 text-red-700" : "border-red-500/40 text-red-300"
                          : item.state === "confirmed"
                            ? isLight ? "border-emerald-600/40 text-emerald-700" : "border-emerald-500/40 text-emerald-300"
                            : isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/60"
                      }`}
                    >
                      {publishingStateLabel(item.state)}
                    </span>
                  </div>
                  <p className={`mt-1 text-[11px] ${muted}`}>
                    {item.is_owner ? t("worldCoachMoney.subRegisteredByYou") : t("worldCoachMoney.subYoureSongwriter")}
                    {item.my_share_pct !== null ? t("worldCoachMoney.subYourShareSuffix", { pct: item.my_share_pct }) : ""} · {item.collection_notice}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.writers.map((w, i) => (
                      <span key={`${w.name}-${i}`} className={chipBtn(isLight, false)}>
                        <b>{w.name}</b> {w.share_pct}% ·{" "}
                        <span className={w.confirmation_status === "disputed" ? (isLight ? "text-red-700" : "text-red-300") : undefined}>
                          {writerStatusLabel(w.confirmation_status)}
                        </span>
                      </span>
                    ))}
                  </div>
                  {item.writers.some((w) => w.confirmation_status === "disputed" && w.dispute_note) ? (
                    <div className="mt-2 space-y-1">
                      {item.writers
                        .filter((w) => w.confirmation_status === "disputed" && w.dispute_note)
                        .map((w, i) => (
                          <p key={i} className={`flex items-start gap-1.5 text-xs ${isLight ? "text-red-800" : "text-red-200/80"}`}>
                            <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {w.name}: {w.dispute_note}
                          </p>
                        ))}
                      <p className={`text-[11px] ${muted}`}>{PUBLISHING_COPY.disputeRule}</p>
                    </div>
                  ) : null}

                  {actions.includes("confirm") || actions.includes("dispute") ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {actions.includes("confirm") ? (
                        <button
                          type="button"
                          className={smallBtn(isLight)}
                          disabled={busyId === item.id}
                          onClick={() => void act(item, "confirm")}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("worldCoachMoney.subConfirmMy", { pct: item.my_share_pct })}
                        </button>
                      ) : null}
                      {actions.includes("dispute") ? (
                        <>
                          <input
                            aria-label={t("worldCoachMoney.subDisputePlaceholder")}
                            className={`${inputCls(isLight)} min-w-40 flex-1 py-1.5 text-xs`}
                            value={disputeNote[item.id] ?? ""}
                            onChange={(e) => setDisputeNote({ ...disputeNote, [item.id]: e.target.value })}
                            placeholder={t("worldCoachMoney.subDisputePlaceholder")}
                          />
                          <button
                            type="button"
                            className={smallBtn(isLight)}
                            disabled={busyId === item.id}
                            onClick={() => void act(item, "dispute")}
                          >
                            <Flag className="h-3.5 w-3.5" /> {t("worldCoachMoney.subDisputeMyShare")}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className={smallBtn(isLight)}
                      disabled={busyId === item.id}
                      onClick={() => void openSheet(item)}
                    >
                      <FileText className="h-3.5 w-3.5" /> {t("worldCoachMoney.subSplitSheetButton")}
                    </button>
                    {actions.includes("amend") ? (
                      <button type="button" className={smallBtn(isLight)} onClick={() => void openForm(item)}>
                        <Pencil className="h-3.5 w-3.5" /> {t("worldCoachMoney.subReviseSplits")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </InnerBlock>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CoachSplitsSection({ isLight }: { isLight: boolean }) {
  return (
    <div className="space-y-4" data-testid="world-coach-splits-panel">
      <SplitsOverviewBlock isLight={isLight} />
      <PublishingRegistryBlock isLight={isLight} />
    </div>
  );
}

/* ═══ 2. SPLIT SHEETS — the wave8 agreements ════════════════════════ */

/** The page's own PDF rule: gold on black, built locally from the
 * audited payload the server returned — nothing re-derived. jspdf is
 * loaded on tap so the World bundle never carries it. */
async function renderSplitSheetPdf(sheet: FinalizedSplitSheet, lang = "en-US") {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const BRAND = [212, 175, 55] as const;
  const FAINT = [105, 95, 72] as const;
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, 210, 297, "F");
  doc.setTextColor(...BRAND);
  doc.setFontSize(20);
  doc.text("Bow Down Visuals", 105, 32, { align: "center" });
  doc.setFontSize(12);
  doc.text("Royalty Split Sheet", 105, 42, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(sheet.songTitle, 105, 58, { align: "center" });
  doc.setFontSize(11);
  doc.text(`Finalized ${new Date(sheet.finalizedAt).toLocaleDateString(lang)}`, 105, 66, { align: "center" });
  let y = 86;
  doc.setTextColor(...BRAND);
  doc.setFontSize(12);
  doc.text("Collaborators", 20, y);
  y += 10;
  doc.setTextColor(255, 255, 255);
  for (const c of sheet.collaborators) {
    doc.setFontSize(11);
    doc.text(`${c.name} (${c.role})`, 24, y);
    doc.text(`${c.pct}%`, 186, y, { align: "right" });
    y += 8;
  }
  y += 6;
  doc.setTextColor(...BRAND);
  doc.text(`Total: ${sheet.totalPct}%`, 20, y);
  doc.setTextColor(...FAINT);
  doc.setFontSize(9);
  doc.text(
    "Generated by Bow Down Visuals. This document records the royalty split",
    105,
    270,
    { align: "center" },
  );
  doc.text("agreed by all parties at the time of finalization.", 105, 276, { align: "center" });
  doc.save(`${splitSheetSlug(sheet.songTitle)}-split-sheet.pdf`);
}

const NEW_ROW = (): Wave8DraftRow => ({ name: "", role: "Producer", pct: "" });

export function CoachSplitSheetsSection({
  isLight,
  onLedgerPosted,
}: {
  isLight: boolean;
  onLedgerPosted?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const [sheets, setSheets] = useState<Wave8Sheet[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<Wave8DraftRow[]>([NEW_ROW(), { ...NEW_ROW(), role: "Artist" }]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Wave8Sheet | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [postingId, setPostingId] = useState<string | null>(null);
  const [postedStatus, setPostedStatus] = useState<Record<string, { kind: "ok" | "error"; text: string }>>({});

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const draftTotal = wave8DraftTotalPct(rows);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/wave8/splits", { skipConfirm: true });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subSheetsLoadError")));
      const parsed = parseWave8Sheets(json);
      if (!parsed) throw new Error(t("worldCoachMoney.subSheetsLoadError"));
      setSheets(parsed);
    } catch (err) {
      setError(plainErrorText(err, t("worldCoachMoney.subSheetsLoadError")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setTitle("");
    setRows([NEW_ROW(), { ...NEW_ROW(), role: "Artist" }]);
    setEditingId(null);
    setFormError(null);
  };

  const save = async () => {
    const validation = validateWave8Draft(title, rows, {
      title: t("worldCoachMoney.subSheetNeedsTitle"),
      collaborator: t("worldCoachMoney.subSheetNeedsCollaborator"),
      name: t("worldCoachMoney.subSheetNeedsName"),
      shareRange: t("worldCoachMoney.subSheetShareRange"),
      total: t("worldCoachMoney.subSheetTotalExact"),
    });
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = buildWave8SheetPayload(title, rows);
      const res = await confirmedFetch(editingId ? `/api/wave8/splits/${editingId}` : "/api/wave8/splits", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        skipConfirm: true,
      });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subSheetSaveError")));
      resetForm();
      await load();
    } catch (err) {
      setFormError(plainErrorText(err, t("worldCoachMoney.subSheetSaveError")));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (sheet: Wave8Sheet) => {
    setEditingId(sheet.id);
    setTitle(sheet.songTitle);
    setRows(sheet.collaborators.map((c) => ({ name: c.name, role: c.role, pct: String(c.pct) })));
    setFormError(null);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      const res = await confirmedFetch(`/api/wave8/splits/${deleteTarget.id}`, { method: "DELETE", skipConfirm: true });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subSheetDeleteError")));
      if (editingId === deleteTarget.id) resetForm();
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setFormError(plainErrorText(err, t("worldCoachMoney.subSheetDeleteError")));
    } finally {
      setBusyId(null);
    }
  };

  const finalizePdf = async (sheet: Wave8Sheet) => {
    setFinalizingId(sheet.id);
    setPdfError(null);
    try {
      const res = await confirmedFetch("/api/wave8/splits/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitId: sheet.id }),
        overrideCost: SPLIT_SHEET_PDF_COST_VISUAL_BUCS,
        overrideFeature: t("worldCoachMoney.subPdfFeature"),
      });
      if (!res) return;
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          isOutOfCreditsResponse(res.status, json)
            ? t("worldCoachMoney.subPdfOutOfBucs", { cost: SPLIT_SHEET_PDF_COST_VISUAL_BUCS })
            : apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subBuildPdfError")),
        );
      }
      const finalized = parseFinalizedSheet(json);
      if (!finalized) throw new Error(t("worldCoachMoney.subBuildPdfError"));
      await renderSplitSheetPdf(finalized, i18n.language);
    } catch (err) {
      setPdfError(plainErrorText(err, t("worldCoachMoney.subBuildPdfError")));
    } finally {
      setFinalizingId(null);
    }
  };

  const postToLedger = async (sheet: Wave8Sheet) => {
    const amountDollars = Number(amounts[sheet.id] ?? "");
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
      setPostedStatus((prev) => ({
        ...prev,
        [sheet.id]: { kind: "error", text: t("worldCoachMoney.subEnterAmountFirst") },
      }));
      return;
    }
    if (sheet.collaborators.length === 0) {
      setPostedStatus((prev) => ({
        ...prev,
        [sheet.id]: { kind: "error", text: t("worldCoachMoney.subNoCollaborators") },
      }));
      return;
    }

    setPostingId(sheet.id);
    try {
      const totalCents = Math.round(amountDollars * 100);
      const shares = splitCentsLargestRemainder(totalCents, sheet.collaborators.map((c) => c.pct));
      const today = ledgerTodayYmd();
      for (let i = 0; i < sheet.collaborators.length; i += 1) {
        const c = sheet.collaborators[i]!;
        const res = await confirmedFetch("/api/money", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildSplitLedgerPostBody({
              sheetTitle: sheet.songTitle,
              collaborator: c,
              amountCents: shares[i]!,
              date: today,
            }),
          ),
          skipConfirm: true,
        });
        if (!res) {
          setPostedStatus((prev) => ({ ...prev, [sheet.id]: { kind: "error", text: t("worldCoachMoney.subPostingCancelled") } }));
          return;
        }
        if (!res.ok) {
          const json: unknown = await res.json().catch(() => ({}));
          throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subPostEntryError", { name: c.name })));
        }
      }
      setPostedStatus((prev) => ({
        ...prev,
        [sheet.id]: {
          kind: "ok",
          text: t("worldCoachMoney.subPostedOk", { count: sheet.collaborators.length }),
        },
      }));
      onLedgerPosted?.();
    } catch (err) {
      setPostedStatus((prev) => ({ ...prev, [sheet.id]: { kind: "error", text: plainErrorText(err, t("worldCoachMoney.subPostLedgerError")) } }));
    } finally {
      setPostingId(null);
    }
  };

  return (
    <div data-testid="world-coach-sheets-panel">
      <SubHead isLight={isLight}><FileText className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subSheetsHeading")}</SubHead>
      <p className={`mt-1.5 text-sm leading-relaxed ${muted}`}>{t("worldCoachMoney.subSheetsIntro")}</p>

      <InnerBlock isLight={isLight}>
        <div className="space-y-2.5">
          <p className={`text-sm font-bold ${strong}`}>{editingId ? t("worldCoachMoney.subEditAgreement") : t("worldCoachMoney.subNewAgreement")}</p>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subSongTitleLabel")}</span>
            <input
              data-testid="world-coach-sheets-title"
              className={inputCls(isLight)}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("worldCoachMoney.subSongTitlePlaceholder")}
            />
          </label>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={t("worldCoachMoney.subCollabNameAria")}
                  className={`${inputCls(isLight)} min-w-32 flex-1`}
                  value={row.name}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                  placeholder={t("worldCoachMoney.subNamePlaceholder")}
                />
                <input
                  aria-label={t("worldCoachMoney.subRoleAria")}
                  className={`${inputCls(isLight)} min-w-24 flex-1`}
                  value={row.role}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, role: e.target.value } : r)))}
                  placeholder={t("worldCoachMoney.subRolePlaceholder")}
                />
                <input
                  aria-label={t("worldCoachMoney.subPercentAria")}
                  className={`${inputCls(isLight)} w-20`}
                  value={row.pct}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, pct: e.target.value } : r)))}
                  placeholder="%"
                  inputMode="decimal"
                />
                <button
                  type="button"
                  aria-label={t("worldCoachMoney.subRemoveCollab")}
                  className={smallBtn(isLight)}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={smallBtn(isLight)} onClick={() => setRows([...rows, NEW_ROW()])}>
              <Plus className="h-3 w-3" /> {t("worldCoachMoney.subAddCollaborator")}
            </button>
            <span className={`text-xs font-bold ${draftTotal === 100 ? (isLight ? "text-emerald-700" : "text-emerald-300") : (isLight ? "text-amber-700" : "text-amber-300")}`}>
              {t("worldCoachMoney.subTotalLabel", { pct: draftTotal })}
            </span>
            <span className={`text-xs ${muted}`}>{t("worldCoachMoney.subPercentNote")}</span>
          </div>
          {formError ? <p className={`text-sm font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>{formError}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="world-coach-sheets-save" className={goldBtn} disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("worldCoachMoney.subSaveAgreement")}
            </button>
            {editingId ? (
              <button type="button" className={smallBtn(isLight)} onClick={resetForm}>{t("worldCoachMoney.subCancelEdit")}</button>
            ) : null}
          </div>
        </div>
      </InnerBlock>

      {loading ? (
        <NativeLoadingState isLight={isLight} message={t("worldCoachMoney.subLoadingSheets")} />
      ) : error ? (
        <NativeErrorState isLight={isLight} message={error} onRetry={() => void load()} />
      ) : !sheets || sheets.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message={t("worldCoachMoney.subNoSheetsYet")}
          detail={t("worldCoachMoney.subNoSheetsDetail")}
        />
      ) : (
        <div className="space-y-2.5">
          {sheets.map((sheet) => {
            const status = postedStatus[sheet.id];
            return (
              <InnerBlock key={sheet.id} isLight={isLight}>
                <div data-testid="world-coach-sheets-item">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-bold ${strong}`}>{sheet.songTitle}</p>
                      <p className={`text-[11px] ${muted}`}>
                        {t(sheet.collaborators.length === 1 ? "worldCoachMoney.subCollaboratorsOne" : "worldCoachMoney.subCollaboratorsMany", { count: sheet.collaborators.length })}
                      </p>
                    </div>
                    <span className="flex gap-1.5">
                      <button type="button" className={smallBtn(isLight)} onClick={() => startEdit(sheet)}>
                        <Pencil className="h-3 w-3" /> {t("worldCoachMoney.subEdit")}
                      </button>
                      <button
                        type="button"
                        className={smallBtn(isLight)}
                        disabled={busyId === sheet.id}
                        onClick={() => setDeleteTarget(sheet)}
                      >
                        <Trash2 className="h-3 w-3" /> {t("worldCoachMoney.subDelete")}
                      </button>
                    </span>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {sheet.collaborators.map((c, i) => {
                      const sheetTotal = sheet.collaborators.reduce((s, x) => s + x.pct, 0);
                      const pct = sheetTotal > 0 ? (c.pct / sheetTotal) * 100 : 0;
                      return (
                        <div key={`${c.name}-${i}`} className="flex items-center gap-2">
                          <span className={`w-32 truncate text-xs ${strong}`}>{c.name}</span>
                          <span className={`w-24 truncate text-[11px] ${muted}`}>{c.role}</span>
                          <span className={`h-2 flex-1 overflow-hidden rounded-full ${isLight ? "bg-black/[0.08]" : "bg-white/10"}`}>
                            <span className="block h-full rounded-full bg-[#d4af37]" style={{ width: `${Math.min(100, pct)}%` }} />
                          </span>
                          <span className={`w-10 text-right text-xs font-bold ${strong}`}>{c.pct}%</span>
                        </div>
                      );
                    })}
                  </div>

                  {deleteTarget?.id === sheet.id ? (
                    <div className={`mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${isLight ? "border-red-600/30 bg-red-500/[0.05]" : "border-red-500/30 bg-red-500/[0.05]"}`}>
                      <span className={`text-xs font-semibold ${strong}`}>{t("worldCoachMoney.subDeleteConfirmQ", { title: sheet.songTitle })}</span>
                      <button type="button" className={smallBtn(isLight)} disabled={busyId === sheet.id} onClick={() => void remove()}>
                        {t("worldCoachMoney.subDelete")}
                      </button>
                      <button type="button" className={smallBtn(isLight)} onClick={() => setDeleteTarget(null)}>{t("worldCoachMoney.subKeepIt")}</button>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="world-coach-sheets-pdf"
                      className={goldBtn}
                      disabled={finalizingId === sheet.id}
                      onClick={() => void finalizePdf(sheet)}
                    >
                      {finalizingId === sheet.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                      {t("worldCoachMoney.subPdfButton", { cost: SPLIT_SHEET_PDF_COST_VISUAL_BUCS })}
                    </button>
                  </div>

                  <div className={`mt-3 rounded-lg border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-black/20"}`}>
                    <p className={`flex items-center gap-1.5 text-xs font-bold ${strong}`}>
                      <DollarSign className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldCoachMoney.subPostRoyaltiesTitle")}
                    </p>
                    <p className={`mt-1 text-[11px] ${muted}`}>{t("worldCoachMoney.subPostRoyaltiesBody")}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        aria-label={t("worldCoachMoney.subTotalAmountAria")}
                        className={`${inputCls(isLight)} w-36 py-1.5 text-xs`}
                        value={amounts[sheet.id] ?? ""}
                        onChange={(e) => setAmounts({ ...amounts, [sheet.id]: e.target.value })}
                        placeholder={t("worldCoachMoney.subTotalPlaceholder")}
                        inputMode="decimal"
                      />
                      <button
                        type="button"
                        className={smallBtn(isLight)}
                        disabled={postingId === sheet.id}
                        onClick={() => void postToLedger(sheet)}
                      >
                        {postingId === sheet.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PiggyBank className="h-3.5 w-3.5" />}
                        {t("worldCoachMoney.subPostToLedger")}
                      </button>
                      {status ? (
                        <span className={`text-xs font-semibold ${status.kind === "ok" ? (isLight ? "text-emerald-700" : "text-emerald-300") : (isLight ? "text-red-700" : "text-red-300")}`}>
                          {status.text}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </InnerBlock>
            );
          })}
        </div>
      )}

      {pdfError ? (
        <p className={`rounded-xl border px-3 py-2.5 text-xs ${isLight ? "border-red-600/30 bg-red-500/[0.06] text-red-800" : "border-red-500/30 bg-red-500/[0.06] text-red-200"}`}>
          {pdfError}
        </p>
      ) : null}
    </div>
  );
}

/* ═══ 3. ROYALTIES — the dashboard ══════════════════════════════════ */

/** The page's payout status words (royalties.payouts.status.*) — catalog
 * keys per status; an unmapped status renders verbatim. */
const PAYOUT_STATUS_KEYS: Record<string, string> = {
  expected: "worldCoachMoney.subPayoutExpected",
  received: "worldCoachMoney.subPayoutReceived",
  partial: "worldCoachMoney.subPayoutPartial",
  overdue: "worldCoachMoney.subPayoutOverdue",
};
const PAYOUT_STATUS_OPTION_KEYS: Record<string, string> = {
  expected: "worldCoachMoney.subPayoutExpectedCap",
  received: "worldCoachMoney.subPayoutReceivedCap",
  partial: "worldCoachMoney.subPayoutPartialCap",
  overdue: "worldCoachMoney.subPayoutOverdueCap",
};

export function CoachRoyaltiesSection({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const payoutStatusLabel = (status: string): string => {
    const key = PAYOUT_STATUS_KEYS[status];
    return key ? t(key) : status;
  };
  const { user, refreshProfile } = useAuth();
  const authHeaders = useCoachAuthHeaders();

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [platformsError, setPlatformsError] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [platformBusy, setPlatformBusy] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);

  const [payoutDraft, setPayoutDraft] = useState<RoyaltyPayoutDraft>({
    distributor: "",
    periodStart: "",
    periodEnd: "",
    expected: "",
    received: "",
    status: "expected",
  });
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [insights, setInsights] = useState<RoyaltyInsight[] | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = `rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`;

  const load = async () => {
    setLoading(true);
    const headers = await authHeaders();
    const result = await loadRoyaltySources(async (path) => {
      const res = await fetch(path, { headers });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { res, data };
    });
    setSummary(result.summary);
    setSummaryError(result.summaryError);
    setPlatforms(result.platforms);
    setPlatformsError(result.platformsError);
    setPayouts(result.payouts);
    setPayoutsError(result.payoutsError);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasData = (summary?.entryCount ?? 0) > 0;
  const monthlyMax = summary ? Math.max(1, ...summary.monthly.map((m) => m.cents)) : 1;
  const topSongMax = summary ? Math.max(1, ...summary.perSong.map((s) => s.cents)) : 1;
  const platformMax = summary ? Math.max(1, ...summary.perPlatform.map((p) => p.cents)) : 1;

  const onCsvFile = async (file: File | null) => {
    if (!file) return;
    setCsvText(await file.text());
  };

  const doImport = async () => {
    const csv = csvText.trim();
    if (!csv) {
      setImportMsg({ kind: "error", text: t("worldCoachMoney.subImportFirst") });
      return;
    }
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/royalties/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ csv }),
      });
      const data = (await res.json().catch(() => ({}))) as { imported?: number; warnings?: unknown[]; error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCoachMoney.subImportFailed")));
      const imported = typeof data.imported === "number" ? data.imported : 0;
      const warnings = Array.isArray(data.warnings) ? data.warnings.length : 0;
      setImportMsg({
        kind: "ok",
        text: `${t("worldCoachMoney.subImportedLine", { count: imported })}${warnings > 0 ? t("worldCoachMoney.subImportWarningsSuffix", { count: warnings }) : ""}`,
      });
      setCsvText("");
      await load();
    } catch (err) {
      setImportMsg({ kind: "error", text: plainErrorText(err, t("worldCoachMoney.subImportFailed")) });
    } finally {
      setImporting(false);
    }
  };

  const connectPlatform = async (name: string) => {
    setPlatformBusy(name);
    setPlatformError(null);
    try {
      const res = await fetch("/api/royalties/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ platform: name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCoachMoney.subConnectPlatformError")));
      await load();
    } catch (err) {
      setPlatformError(plainErrorText(err, t("worldCoachMoney.subConnectPlatformError")));
    } finally {
      setPlatformBusy(null);
    }
  };

  const savePayout = async () => {
    const validation = validateRoyaltyPayoutDraft(payoutDraft, t("worldCoachMoney.subPayoutRequired"));
    if (validation) {
      setPayoutMsg({ kind: "error", text: validation });
      return;
    }
    setPayoutBusy(true);
    setPayoutMsg(null);
    try {
      const res = await fetch("/api/royalties/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildRoyaltyPayoutPayload(payoutDraft)),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCoachMoney.subPayoutSaveError")));
      setPayoutDraft({ distributor: "", periodStart: "", periodEnd: "", expected: "", received: "", status: "expected" });
      setPayoutMsg({ kind: "ok", text: t("worldCoachMoney.subPayoutSaved") });
      await load();
    } catch (err) {
      setPayoutMsg({ kind: "error", text: plainErrorText(err, t("worldCoachMoney.subPayoutSaveError")) });
    } finally {
      setPayoutBusy(false);
    }
  };

  const runInsights = async () => {
    setInsightsBusy(true);
    setInsightsError(null);
    try {
      const res = await fetch("/api/royalties/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({}),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          isOutOfCreditsResponse(res.status, data)
            ? t("worldCoachMoney.subInsightsOut", { cost: ROYALTY_INSIGHTS_COST_VISUAL_BUCS })
            : apiErrorMessage(data as { error?: string }, t("worldCoachMoney.subInsightsLoadError")),
        );
      }
      if (user) refreshProfile();
      const parsed = parseRoyaltyInsights(data);
      if (!parsed) throw new Error(t("worldCoachMoney.subInsightsLoadError"));
      setInsights(parsed);
    } catch (err) {
      setInsightsError(plainErrorText(err, t("worldCoachMoney.subInsightsLoadError")));
    } finally {
      setInsightsBusy(false);
    }
  };

  if (loading) return <NativeLoadingState isLight={isLight} message={t("worldCoachMoney.subLoadingRoyalties")} />;

  return (
    <div className="space-y-3" data-testid="world-coach-royalties-panel">
      <div>
        <SubHead isLight={isLight}><TrendingUp className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subRoyaltiesTitle")}</SubHead>
        <p className={`mt-1.5 text-sm leading-relaxed ${muted}`}>{t("worldCoachMoney.subRoyaltiesIntro")}</p>
      </div>

      {summaryError ? (
        <NativeErrorState isLight={isLight} message={summaryError} onRetry={() => void load()} />
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <div className={cardCls}>
              <p className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}><DollarSign className="h-3.5 w-3.5" />{t("worldCoachMoney.subTotalEarnings")}</p>
              <p className={`mt-1 text-xl font-black ${strong}`}>{royaltyMoneyLabel(summary.total, "USD", i18n.language)}</p>
              <p className={`mt-0.5 text-[11px] ${muted}`}>{t("worldCoachMoney.subEntriesTracked", { count: summary.entryCount })}</p>
            </div>
            <div className={cardCls}>
              <p className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}><TrendingUp className="h-3.5 w-3.5" />{t("worldCoachMoney.subTotalStreams")}</p>
              <p className={`mt-1 text-xl font-black ${strong}`}>{summary.totalStreams.toLocaleString(i18n.language)}</p>
              <p className={`mt-0.5 text-[11px] ${muted}`}>{t("worldCoachMoney.subAcrossPlatforms")}</p>
            </div>
            <div className={cardCls}>
              <p className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}><Music2 className="h-3.5 w-3.5" />{t("worldCoachMoney.subSongsEarning")}</p>
              <p className={`mt-1 text-xl font-black ${strong}`}>{summary.perSong.length}</p>
              <p className={`mt-0.5 text-[11px] ${muted}`}>{t("worldCoachMoney.subPlatformsReporting", { count: summary.perPlatform.length })}</p>
            </div>
          </div>

          {!hasData ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldCoachMoney.subNoRoyaltyData")}
              detail={t("worldCoachMoney.subNoRoyaltyDetail")}
            />
          ) : (
            <>
              {summary.monthly.length > 0 ? (
                <div className={cardCls}>
                  <SubHead isLight={isLight}>{t("worldCoachMoney.subMonthlyRoyalties")}</SubHead>
                  <div className="mt-2 flex items-end gap-1.5 overflow-x-auto pb-1">
                    {summary.monthly.map((m) => (
                      <div key={m.month} className="flex min-w-8 flex-col items-center gap-1">
                        <span className={`text-[10px] font-semibold ${muted}`}>${parseFloat(m.amount).toFixed(0)}</span>
                        <span
                          className="w-5 rounded-t bg-[#d4af37]"
                          style={{ height: `${royaltyMonthlyBarHeight(m.cents, monthlyMax)}px` }}
                          title={m.month}
                        />
                        <span className={`text-[10px] ${muted}`}>{m.month.slice(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2 lg:grid-cols-2">
                {summary.perSong.length > 0 ? (
                  <div className={cardCls}>
                    <SubHead isLight={isLight}>{t("worldCoachMoney.subTopSongs")}</SubHead>
                    <div className="mt-2 space-y-1.5">
                      {summary.perSong.slice(0, 8).map((s) => (
                        <div key={s.song} className="flex items-center gap-2">
                          <span className={`w-32 truncate text-xs ${strong}`}>{s.song}</span>
                          <span className={`h-2 flex-1 overflow-hidden rounded-full ${isLight ? "bg-black/[0.08]" : "bg-white/10"}`}>
                            <span className="block h-full rounded-full bg-[#d4af37]" style={{ width: `${royaltyBarPct(s.cents, topSongMax)}%` }} />
                          </span>
                          <span className={`text-[11px] ${muted}`}>{t("worldCoachMoney.subStreamsSuffix", { count: s.streams.toLocaleString(i18n.language) })}</span>
                          <span className={`w-16 text-right text-xs font-bold ${strong}`}>{royaltyMoneyLabel(s.amount, "USD", i18n.language)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {summary.perPlatform.length > 0 ? (
                  <div className={cardCls}>
                    <SubHead isLight={isLight}>{t("worldCoachMoney.subByPlatform")}</SubHead>
                    <div className="mt-2 space-y-1.5">
                      {summary.perPlatform.map((p) => (
                        <div key={p.platform} className="flex items-center gap-2">
                          <span className={`w-32 truncate text-xs ${strong}`}>{p.label}</span>
                          <span className={`h-2 flex-1 overflow-hidden rounded-full ${isLight ? "bg-black/[0.08]" : "bg-white/10"}`}>
                            <span className="block h-full rounded-full bg-[#d4af37]" style={{ width: `${royaltyBarPct(p.cents, platformMax)}%` }} />
                          </span>
                          <span className={`w-16 text-right text-xs font-bold ${strong}`}>{royaltyMoneyLabel(p.amount, "USD", i18n.language)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <InnerBlock isLight={isLight}>
                <SubHead isLight={isLight}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subInsightsTitle")}</SubHead>
                <p className={`mt-1.5 text-xs ${muted}`}>{t("worldCoachMoney.subInsightsIntro", { cost: ROYALTY_INSIGHTS_COST_VISUAL_BUCS })}</p>
                <button
                  type="button"
                  data-testid="world-coach-royalties-insights"
                  className={`${goldBtn} mt-2.5`}
                  disabled={insightsBusy}
                  onClick={() => void runInsights()}
                >
                  {insightsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {t("worldCoachMoney.subAnalyzeRoyalties")}
                </button>
                {insightsError ? <p className={`mt-2 text-sm font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>{insightsError}</p> : null}
                {insights && insights.length > 0 ? (
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    {insights.map((ins, i) => (
                      <div key={`${ins.title}-${i}`} className={`rounded-lg border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-black/20"}`}>
                        <p className={`text-sm font-bold ${strong}`}>{ins.title}</p>
                        <p className={`mt-1 text-xs leading-relaxed ${muted}`}>{ins.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </InnerBlock>
            </>
          )}
        </>
      ) : null}

      {/* Import — the same CSV rail, free. */}
      <InnerBlock isLight={isLight}>
        <SubHead isLight={isLight}><Upload className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subImportTitle")}</SubHead>
        <p className={`mt-1.5 text-xs leading-relaxed ${muted}`}>{t("worldCoachMoney.subImportBody")}</p>
        <label className={`mt-2.5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs font-bold ${isLight ? "border-[#7A5A12]/40 text-[#6B5B36]" : "border-white/25 text-white/70"}`}>
          <Upload className="h-4 w-4" /> {t("worldCoachMoney.subDropCsv")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label={t("worldCoachMoney.subUploadCsvAria")}
            onChange={(e) => void onCsvFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="mt-2.5 block">
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subOrPaste")}</span>
          <textarea
            data-testid="world-coach-royalties-csv"
            className={`${inputCls(isLight)} min-h-24 font-mono text-xs`}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"song_title,platform,streams,amount,date\nMidnight Run,Spotify,12000,48.20,2026-01-15"}
          />
        </label>
        <button
          type="button"
          data-testid="world-coach-royalties-import"
          className={`${goldBtn} mt-2.5`}
          disabled={importing || !csvText.trim()}
          onClick={() => void doImport()}
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {t("worldCoachMoney.subImportButton")}
        </button>
        {importMsg ? (
          <p className={`mt-2 text-sm font-semibold ${importMsg.kind === "ok" ? (isLight ? "text-emerald-700" : "text-emerald-300") : (isLight ? "text-red-700" : "text-red-300")}`}>
            {importMsg.text}
          </p>
        ) : null}
      </InnerBlock>

      {/* Platforms — manual connect today, auto-sync honest. */}
      <div className={cardCls}>
        <SubHead isLight={isLight}><Link2 className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subPlatformConnections")}</SubHead>
        <p className={`mt-1.5 text-xs leading-relaxed ${muted}`}>
          {t("worldCoachMoney.subPlatformsBodyA")} <b className={strong}>{t("worldCoachMoney.subComingSoon")}</b>{t("worldCoachMoney.subPlatformsBodyB")}
        </p>
        {platformsError ? (
          <NativeErrorState isLight={isLight} message={platformsError} onRetry={() => void load()} />
        ) : platforms.length === 0 ? (
          <p className={`mt-2 text-xs ${muted}`}>{t("worldCoachMoney.subNoPlatforms")}</p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {platforms.map((p: PlatformStatus) => (
              <div key={p.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-black/20"}`}>
                <span>
                  <span className={`block text-sm font-bold ${strong}`}>{p.label}</span>
                  <span className={`block text-[11px] ${muted}`}>
                    {p.connected
                      ? `${t("worldCoachMoney.subConnected")}${p.accountLabel ? ` · ${p.accountLabel}` : ""}`
                      : p.connectable
                        ? t("worldCoachMoney.subNotConnected")
                        : t("worldCoachMoney.subAutoSyncSoon")}
                  </span>
                </span>
                {p.connected ? (
                  <CheckCircle2 className={`h-5 w-5 ${isLight ? "text-emerald-600" : "text-emerald-400"}`} />
                ) : p.connectable ? (
                  <button
                    type="button"
                    className={smallBtn(isLight)}
                    disabled={platformBusy === p.key}
                    onClick={() => void connectPlatform(p.key)}
                  >
                    {platformBusy === p.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t("worldCoachMoney.subConnect")}
                  </button>
                ) : (
                  <Clock3 className={`h-5 w-5 ${muted}`} />
                )}
              </div>
            ))}
          </div>
        )}
        {platformError ? <p className={`mt-2 text-sm font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>{platformError}</p> : null}
      </div>

      {/* Payouts — the tracking rows + the record form. */}
      <div className={cardCls}>
        <SubHead isLight={isLight}><Wallet className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.subPayoutTracking")}</SubHead>
        {payoutsError ? (
          <NativeErrorState isLight={isLight} message={payoutsError} onRetry={() => void load()} />
        ) : payouts.length === 0 ? (
          <p className={`mt-2 text-xs leading-relaxed ${muted}`}>{t("worldCoachMoney.subNoPayouts")}</p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {payouts.map((p: Payout) => (
              <div key={p.id} className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2 ${isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-black/20"}`}>
                <span>
                  <span className={`block text-sm font-bold ${strong}`}>{p.distributor}</span>
                  <span className={`block text-[11px] ${muted}`}>{p.period_start} → {p.period_end}</span>
                  <span className={`mt-0.5 block text-xs ${muted}`}>
                    {t("worldCoachMoney.subExpectedLabel")} <b className={strong}>{royaltyMoneyLabel(p.expected_amount, p.currency, i18n.language)}</b>
                    {p.received_amount ? (
                      <> {t("worldCoachMoney.subReceivedPart")} <b className={isLight ? "text-emerald-700" : "text-emerald-300"}>{royaltyMoneyLabel(p.received_amount, p.currency, i18n.language)}</b></>
                    ) : null}
                  </span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    p.status === "received"
                      ? isLight ? "bg-emerald-600/15 text-emerald-700" : "bg-emerald-400/15 text-emerald-300"
                      : p.status === "overdue"
                        ? isLight ? "bg-red-600/15 text-red-700" : "bg-red-400/15 text-red-300"
                        : p.status === "partial"
                          ? isLight ? "bg-amber-600/15 text-amber-700" : "bg-amber-400/15 text-amber-300"
                          : isLight ? "bg-black/[0.06] text-[#6B5B36]" : "bg-white/10 text-white/60"
                  }`}
                >
                  {p.status === "overdue" ? <AlertTriangle className="h-3 w-3" /> : null}
                  {payoutStatusLabel(p.status)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subDistributor")}</span>
            <input
              data-testid="world-coach-royalties-payout-distributor"
              className={inputCls(isLight)}
              value={payoutDraft.distributor}
              onChange={(e) => setPayoutDraft({ ...payoutDraft, distributor: e.target.value })}
              placeholder={t("worldCoachMoney.subDistributorPlaceholder")}
            />
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subStatusLabel")}</span>
            <select
              className={inputCls(isLight)}
              style={{ colorScheme: isLight ? "light" : "dark" }}
              value={payoutDraft.status}
              onChange={(e) => setPayoutDraft({ ...payoutDraft, status: e.target.value })}
            >
              {Object.entries(PAYOUT_STATUS_OPTION_KEYS).map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subPeriodStart")}</span>
            <input
              type="date"
              className={inputCls(isLight)}
              style={{ colorScheme: isLight ? "light" : "dark" }}
              value={payoutDraft.periodStart}
              onChange={(e) => setPayoutDraft({ ...payoutDraft, periodStart: e.target.value })}
            />
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subPeriodEnd")}</span>
            <input
              type="date"
              className={inputCls(isLight)}
              style={{ colorScheme: isLight ? "light" : "dark" }}
              value={payoutDraft.periodEnd}
              onChange={(e) => setPayoutDraft({ ...payoutDraft, periodEnd: e.target.value })}
            />
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subExpectedAmount")}</span>
            <input
              className={inputCls(isLight)}
              value={payoutDraft.expected}
              onChange={(e) => setPayoutDraft({ ...payoutDraft, expected: e.target.value })}
              placeholder="250.00"
              inputMode="decimal"
            />
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.subReceivedAmount")}</span>
            <input
              className={inputCls(isLight)}
              value={payoutDraft.received}
              onChange={(e) => setPayoutDraft({ ...payoutDraft, received: e.target.value })}
              placeholder="250.00"
              inputMode="decimal"
            />
          </label>
        </div>
        <button
          type="button"
          data-testid="world-coach-royalties-payout-save"
          className={`${goldBtn} mt-2.5`}
          disabled={payoutBusy}
          onClick={() => void savePayout()}
        >
          {payoutBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t("worldCoachMoney.subSavePayout")}
        </button>
        {payoutMsg ? (
          <p className={`mt-2 text-sm font-semibold ${payoutMsg.kind === "ok" ? (isLight ? "text-emerald-700" : "text-emerald-300") : (isLight ? "text-red-700" : "text-red-300")}`}>
            {payoutMsg.text}
          </p>
        ) : null}
      </div>

      <p className={`flex items-start gap-2 text-[11px] leading-relaxed ${muted}`}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("worldCoachMoney.subRoyaltiesFootnote")}
      </p>
    </div>
  );
}
