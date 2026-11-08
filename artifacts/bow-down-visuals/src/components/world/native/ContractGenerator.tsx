import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, FileSearch, Loader2, PenLine } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  CONTRACTS_GENERATE_PATH,
  CONTRACTS_GENERATE_STATUS_PATH,
  CONTRACT_GENERATE_FEATURE,
  CONTRACT_GENERATE_FALLBACK_COST_VB,
  CONTRACT_TYPE_OPTIONS,
  EMPTY_GENERATE_FIELDS,
  buildGenerateBody,
  generateReady,
  parseContractGeneration,
  parseGenerateStatus,
  type ContractGenerateFields,
  type ContractGenerationResult,
} from "@/lib/world/contract-analyzer";

/* The 2D page's own catalog keys (contracts.type.*, locales) —
   byte-identical to the seam's option labels; the seam table
   stays as the fallback behind this key-map. */
const CONTRACT_TYPE_LABEL_KEYS: Record<string, string> = {
  "record-deal": "contracts.type.record-deal",
  "brand-deal": "contracts.type.brand-deal",
  "sync-license": "contracts.type.sync-license",
  management: "contracts.type.management",
  publishing: "contracts.type.publishing",
  distribution: "contracts.type.distribution",
  other: "contracts.type.other",
};

/* ─── Contract Generator, in-world (Stack 300, crew 29) ──────────
   The drafting twin of the Contract Analyzer above it at the
   Promote Desk: pick one of the family's 7 types, name both
   parties, drop in the deal points, and GPT-6 Sol drafts a
   complete starting contract (POST /api/contracts/generate,
   charge-before-generate with the rail's auto-refund on failure).
   The price is NOT owner-ruled yet, so the desk never hardcodes
   it: the displayed price is the rail's own /generate/status
   value, fetched on mount — the owner's ruling will set the
   number with no rebuild. The framing law stands exactly as the
   analyzer states it: the rail's disclaimer (the analyzer's line,
   verbatim) prints with every draft, and no desk copy implies
   attorney drafting. "Analyze my draft" hands the draft to the
   2D page's analyzer through the page's handoff stash. Members
   only; the desk around it pitches guests. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const ghostBtn =
  "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition disabled:opacity-50 bdv-touch-target";

export function ContractGenerator({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const ghostCls = isLight
    ? "border-[#C9A84C]/50 text-[#7A5A12] hover:bg-[#C9A84C]/10"
    : "border-white/15 text-white/70 hover:bg-white/5";

  const [fields, setFields] = useState<ContractGenerateFields>({ ...EMPTY_GENERATE_FIELDS });
  const [contractType, setContractType] = useState<string>("brand-deal");
  const [cost, setCost] = useState(CONTRACT_GENERATE_FALLBACK_COST_VB);
  const [railDisclaimer, setRailDisclaimer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<ContractGenerationResult | null>(null);
  const [copied, setCopied] = useState(false);
  /* One idempotency key per draft INTENT (the persona pattern, same
     as the 2D page): kept across retries of the same ask so it can
     never charge twice; cleared after a refunded failure (the rail
     voided it) and when the deal is edited after a success. */
  const genKeyRef = useRef("");

  /* The displayed price is the rail's live status value. */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(CONTRACTS_GENERATE_STATUS_PATH, {
          headers: { ...(await authHeaders()) },
        });
        if (!res.ok) return;
        const status = parseGenerateStatus(await res.json().catch(() => null));
        if (live && status) {
          setCost(status.creditCost);
          if (status.disclaimer) setRailDisclaimer(status.disclaimer);
        }
      } catch {
        /* status unreachable — the fallback price stands */
      }
    })();
    return () => {
      live = false;
    };
    // authHeaders is a fresh closure per render (CreateDeskLeaf);
    // the status read is a mount-only fetch by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(key: keyof ContractGenerateFields, value: string) {
    /* Editing the deal after a draft landed starts a NEW intent. */
    if (result) genKeyRef.current = "";
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function generate() {
    if (!generateReady(fields, contractType) || busy) return;
    setBusy(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    setCopied(false);
    if (!genKeyRef.current) {
      genKeyRef.current = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    try {
      const res = await confirmedFetch(CONTRACTS_GENERATE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        overrideCost: cost,
        overrideFeature: CONTRACT_GENERATE_FEATURE,
        body: JSON.stringify(buildGenerateBody(fields, contractType, genKeyRef.current)),
      });
      if (!res) return; // declined the confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        /* The rail refunded this attempt and voided its key — the
           retry is a new intent and mints a fresh key. */
        genKeyRef.current = "";
        setError(apiErrorMessage(data, t("worldTeamLegal.genErrorStatus")));
        return;
      }
      const parsed = parseContractGeneration(data);
      if (!parsed) {
        setError(t("worldTeamLegal.genErrorShape"));
        return;
      }
      setResult(parsed);
      if (parsed.disclaimer) setRailDisclaimer(parsed.disclaimer);
    } catch (err) {
      setError(plainErrorText(err, t("worldTeamLegal.genError")));
    } finally {
      setBusy(false);
    }
  }

  /* One-tap handoff: stash the draft for the 2D page's analyzer
     intake and open the page — the draft lands in the analyzer,
     in its own type family, ready to read. */
  function analyzeDraft() {
    if (!result) return;
    try {
      sessionStorage.setItem(
        "bdv-contract-draft",
        JSON.stringify({ draft: result.draft, contractType }),
      );
    } catch {
      /* storage unavailable — the page still opens */
    }
    window.location.assign("/contracts");
  }

  function copyDraft() {
    if (!result) return;
    navigator.clipboard
      .writeText(result.draft)
      .then(() => setCopied(true))
      .catch(() => {});
  }

  function downloadDraft() {
    if (!result) return;
    const blob = new Blob([result.draft], { type: "text/plain;charset=utf-8" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = "contract-draft.txt";
    el.click();
    setTimeout(() => URL.revokeObjectURL(el.href), 4000);
  }

  const dealPoints: Array<{
    field: keyof ContractGenerateFields;
    labelKey: string;
    placeholderKey: string;
    rows?: number;
  }> = [
    { field: "paymentTerms", labelKey: "worldTeamLegal.genPaymentLabel", placeholderKey: "worldTeamLegal.genPaymentPlaceholder", rows: 2 },
    { field: "term", labelKey: "worldTeamLegal.genTermLabel", placeholderKey: "worldTeamLegal.genTermPlaceholder" },
    { field: "territory", labelKey: "worldTeamLegal.genTerritoryLabel", placeholderKey: "worldTeamLegal.genTerritoryPlaceholder" },
    { field: "exclusivity", labelKey: "worldTeamLegal.genExclusivityLabel", placeholderKey: "worldTeamLegal.genExclusivityPlaceholder" },
    { field: "rightsGranted", labelKey: "worldTeamLegal.genRightsLabel", placeholderKey: "worldTeamLegal.genRightsPlaceholder", rows: 2 },
    { field: "termination", labelKey: "worldTeamLegal.genTerminationLabel", placeholderKey: "worldTeamLegal.genTerminationPlaceholder", rows: 2 },
    { field: "context", labelKey: "worldTeamLegal.genContextLabel", placeholderKey: "worldTeamLegal.genContextPlaceholder" },
  ];

  return (
    <div data-testid="world-contract-generator" className="space-y-3">
      <p className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        <PenLine className="h-4 w-4" /> {t("worldTeamLegal.genTitle")}
      </p>
      <p className={`text-sm ${muted}`}>
        {t("worldTeamLegal.genIntro", { cost })}
      </p>

      <select
        className={deskInputCls(isLight)}
        value={contractType}
        onChange={(e) => {
          if (result) genKeyRef.current = "";
          setContractType(e.target.value);
        }}
        aria-label={t("worldTeamLegal.contractTypeAria")}
      >
        {CONTRACT_TYPE_OPTIONS.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {t(CONTRACT_TYPE_LABEL_KEYS[opt.key] ?? "contracts.type.other")}
          </option>
        ))}
      </select>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className={`mb-1 block text-xs font-bold ${strong}`}>
            {t("worldTeamLegal.genCreatorLabel")}
          </label>
          <input
            className={deskInputCls(isLight)}
            value={fields.creatorName}
            onChange={(e) => setField("creatorName", e.target.value)}
            aria-label={t("worldTeamLegal.genCreatorLabel")}
          />
        </div>
        <div>
          <label className={`mb-1 block text-xs font-bold ${strong}`}>
            {t("worldTeamLegal.genCounterpartyLabel")}
          </label>
          <input
            className={deskInputCls(isLight)}
            value={fields.counterpartyName}
            onChange={(e) => setField("counterpartyName", e.target.value)}
            aria-label={t("worldTeamLegal.genCounterpartyLabel")}
          />
        </div>
      </div>

      {dealPoints.map(({ field, labelKey, placeholderKey, rows }) => (
        <div key={field}>
          <label className={`mb-1 block text-xs font-bold ${strong}`}>{t(labelKey)}</label>
          {rows ? (
            <textarea
              className={deskInputCls(isLight)}
              placeholder={t(placeholderKey)}
              rows={rows}
              value={fields[field]}
              onChange={(e) => setField(field, e.target.value)}
              aria-label={t(labelKey)}
            />
          ) : (
            <input
              className={deskInputCls(isLight)}
              placeholder={t(placeholderKey)}
              value={fields[field]}
              onChange={(e) => setField(field, e.target.value)}
              aria-label={t(labelKey)}
            />
          )}
        </div>
      ))}

      {outOfCredits ? (
        <p className={`text-xs font-semibold ${strong}`}>
          {t("worldTeamLegal.genOutOfCredits", { cost })}
        </p>
      ) : null}
      {error ? (
        <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{error}</p>
      ) : null}

      <button
        type="button"
        data-testid="world-contract-generate"
        className={goldBtn}
        disabled={!generateReady(fields, contractType) || busy}
        onClick={() => void generate()}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
        {t("worldTeamLegal.genButton", { cost })}
      </button>

      {result ? (
        <div
          data-testid="world-contract-draft"
          className={`space-y-2 rounded-xl border p-3 ${
            isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
          }`}
        >
          <p className={`text-base font-black ${strong}`}>{result.title}</p>
          {result.summary ? (
            <div className="space-y-1">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                {t("worldTeamLegal.genSummaryLabel")}
              </p>
              <p className={`text-sm ${strong}`}>{result.summary}</p>
            </div>
          ) : null}
          <pre
            className={`max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border p-2.5 font-mono text-xs leading-relaxed ${
              isLight ? "border-[#C9A84C]/30 text-[#2a1e07]" : "border-white/10 text-white/80"
            }`}
          >
            {result.draft}
          </pre>

          {result.disclaimer || railDisclaimer ? (
            <p className={`text-xs italic ${muted}`}>{result.disclaimer || railDisclaimer}</p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={`${ghostBtn} ${ghostCls}`} onClick={copyDraft}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("worldTeamLegal.genCopied") : t("worldTeamLegal.genCopyDraft")}
            </button>
            <button type="button" className={`${ghostBtn} ${ghostCls}`} onClick={downloadDraft}>
              <Download className="h-3.5 w-3.5" />
              {t("worldTeamLegal.genDownloadDraft")}
            </button>
            <button
              type="button"
              data-testid="world-contract-analyze-draft"
              className={goldBtn}
              onClick={analyzeDraft}
            >
              <FileSearch className="h-3.5 w-3.5" />
              {t("worldTeamLegal.genAnalyzeDraft")}
            </button>
            <button
              type="button"
              className={`${ghostBtn} ${ghostCls}`}
              onClick={() => {
                genKeyRef.current = "";
                setResult(null);
                setCopied(false);
              }}
            >
              {t("worldTeamLegal.genDraftAnother")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
