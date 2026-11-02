import { useState } from "react";
import { AlertTriangle, FileSearch, Loader2, ShieldCheck } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  CONTRACTS_ANALYZE_PATH,
  CONTRACT_ANALYSIS_COST_VB,
  CONTRACT_ANALYSIS_FEATURE,
  CONTRACT_TYPE_OPTIONS,
  MIN_CONTRACT_CHARS,
  analyzeReady,
  buildAnalyzeBody,
  parseContractAnalysis,
  riskLevelLabel,
  severityLabel,
  type ContractAnalysisResult,
} from "@/lib/world/contract-analyzer";

/* ─── Contract Analyzer, in-world (stack1100 world parity) ─────────
   The deal-check from pages/contracts.tsx, docked at the Promote
   Desk where deals are chased: paste a record deal, brand deal,
   sync license or management agreement and get the risk score,
   red flags, key terms, negotiation tips and missing protections
   — on the page's own rail and terms (POST /api/contracts/
   analyze, 300 Bucs through the credit confirmation, charge-
   before-generate with the rail's auto-refund on failure).
   The framing law stands exactly as the page states it: this is
   an AI reading, not legal advice — the rail's disclaimer prints
   with every result. Members only; the desk around it pitches
   guests. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";

export function ContractAnalyzer({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [contractText, setContractText] = useState("");
  const [contractType, setContractType] = useState<string>("record-deal");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<ContractAnalysisResult | null>(null);

  const chars = contractText.trim().length;

  async function analyze() {
    if (!analyzeReady(contractText, contractType) || busy) return;
    setBusy(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const res = await confirmedFetch(CONTRACTS_ANALYZE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        overrideCost: CONTRACT_ANALYSIS_COST_VB,
        overrideFeature: CONTRACT_ANALYSIS_FEATURE,
        body: JSON.stringify(buildAnalyzeBody(contractText, contractType, context)),
      });
      if (!res) return; // declined the confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        setError(apiErrorMessage(data, "Analysis failed. Try again."));
        return;
      }
      const parsed = parseContractAnalysis(data);
      if (!parsed) {
        setError("The reading answered in a shape the desk can't use — the rail refunds failed generations, so a charge for this attempt comes back on its own.");
        return;
      }
      setResult(parsed);
    } catch (err) {
      setError(plainErrorText(err, "Analysis failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="world-contract-analyzer" className="space-y-3">
      <p className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        <FileSearch className="h-4 w-4" /> Contract check
      </p>
      <p className={`text-sm ${muted}`}>
        Paste a deal before you sign it — risk score, red flags, key terms and what to push back on.{" "}
        {CONTRACT_ANALYSIS_COST_VB} Visual Bucs a reading, named before you confirm. An AI reading,
        not legal advice.
      </p>

      <select
        className={deskInputCls(isLight)}
        value={contractType}
        onChange={(e) => setContractType(e.target.value)}
        aria-label="Contract type"
      >
        {CONTRACT_TYPE_OPTIONS.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
      <textarea
        className={deskInputCls(isLight)}
        placeholder="Paste the contract text here…"
        rows={6}
        value={contractText}
        onChange={(e) => setContractText(e.target.value)}
        aria-label="Contract text"
      />
      <p className={`text-xs ${muted}`}>
        {chars.toLocaleString()} characters
        {chars < MIN_CONTRACT_CHARS
          ? ` — a real contract runs longer; at least ${MIN_CONTRACT_CHARS} to read it.`
          : " — ready when you are."}
      </p>
      <input
        className={deskInputCls(isLight)}
        placeholder="Anything the reader should know? (your leverage, your worries — optional)"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        aria-label="Context for the reader"
      />

      {outOfCredits ? (
        <p className={`text-xs font-semibold ${strong}`}>
          Not enough Visual Bucs for a reading — it costs {CONTRACT_ANALYSIS_COST_VB}. Top up at the
          Treasury; nothing was charged.
        </p>
      ) : null}
      {error ? (
        <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{error}</p>
      ) : null}

      <button
        type="button"
        data-testid="world-contract-analyze"
        className={goldBtn}
        disabled={!analyzeReady(contractText, contractType) || busy}
        onClick={() => void analyze()}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
        Read this contract — {CONTRACT_ANALYSIS_COST_VB} Bucs
      </button>

      {result ? (
        <div
          data-testid="world-contract-result"
          className={`space-y-2 rounded-xl border p-3 ${
            isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
          }`}
        >
          <p className={`inline-flex items-center gap-2 text-base font-black ${strong}`}>
            <ShieldCheck className="h-4 w-4 text-[#d4af37]" />
            Risk {result.analysis.riskScore}/100 — {riskLevelLabel(result.analysis.riskLevel)}
          </p>
          <p className={`text-sm ${strong}`}>{result.analysis.summary}</p>

          {result.analysis.redFlags.length > 0 ? (
            <div className="space-y-1.5">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Red flags</p>
              {result.analysis.redFlags.map((f, i) => (
                <div key={i} className={`rounded-lg border px-2.5 py-2 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                  <p className={`inline-flex items-center gap-1.5 text-xs font-bold ${strong}`}>
                    <AlertTriangle className="h-3.5 w-3.5 text-[#d4af37]" />
                    {f.title} · {severityLabel(f.severity)}
                  </p>
                  <p className={`mt-0.5 text-xs ${muted}`}>{f.explanation}</p>
                  {f.clause ? <p className={`mt-0.5 text-xs italic ${muted}`}>“{f.clause}”</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {result.analysis.keyTerms.length > 0 ? (
            <div className="space-y-1">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Key terms</p>
              {result.analysis.keyTerms.map((t, i) => (
                <p key={i} className={`text-xs ${muted}`}>
                  <span className={`font-bold ${strong}`}>{t.term}:</span> {t.value} ({t.assessment})
                </p>
              ))}
            </div>
          ) : null}

          {result.analysis.negotiationTips.length > 0 ? (
            <div className="space-y-1">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Push back on</p>
              {result.analysis.negotiationTips.map((tip, i) => (
                <p key={i} className={`text-xs ${muted}`}>
                  · {tip}
                </p>
              ))}
            </div>
          ) : null}

          {result.analysis.missingProtections.length > 0 ? (
            <div className="space-y-1">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Missing protections</p>
              {result.analysis.missingProtections.map((m, i) => (
                <p key={i} className={`text-xs ${muted}`}>
                  · {m}
                </p>
              ))}
            </div>
          ) : null}

          {result.analysis.favorableTerms.length > 0 ? (
            <div className="space-y-1">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>In your favour</p>
              {result.analysis.favorableTerms.map((f, i) => (
                <p key={i} className={`text-xs ${muted}`}>
                  · {f}
                </p>
              ))}
            </div>
          ) : null}

          {result.disclaimer ? <p className={`text-xs italic ${muted}`}>{result.disclaimer}</p> : null}
          <p className={`text-xs ${muted}`}>
            This is an AI reading, not legal advice — for a signing decision, a lawyer is the last step.
          </p>
        </div>
      ) : null}
    </div>
  );
}
