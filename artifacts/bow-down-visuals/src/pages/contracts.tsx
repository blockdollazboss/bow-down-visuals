import { useState } from "react";
import {
  FileText, Loader2, Sparkles, AlertTriangle, ShieldCheck, ShieldAlert,
  Scale, Lightbulb, CheckCircle2, XCircle, MinusCircle, Gavel, Copy, Download,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── Contract Analyzer ──────────────────────────────────────────────────
   AI contract review for creators: paste a record deal, brand deal, sync
   license, or management agreement → GPT-6 Sol returns risk score, red
   flags, key terms, negotiation tips, and missing protections.
   POST /api/contracts/analyze at 3 credits, charge-before-generate with
   auto-refund on failure. Always framed as AI reading, not legal advice. */

const CREDIT_COST = 3;

const CONTRACT_TYPES = [
  { key: "record-deal", label: "Record Deal" },
  { key: "brand-deal", label: "Brand / Sponsorship" },
  { key: "sync-license", label: "Sync License" },
  { key: "management", label: "Management" },
  { key: "publishing", label: "Publishing" },
  { key: "distribution", label: "Distribution" },
  { key: "other", label: "Other" },
] as const;
type ContractTypeKey = (typeof CONTRACT_TYPES)[number]["key"];

interface RedFlag {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
  clause: string;
}
interface KeyTerm {
  term: string;
  value: string;
  assessment: "good" | "neutral" | "concerning";
}
interface Analysis {
  riskScore: number;
  riskLevel: "low" | "moderate" | "high" | "severe";
  summary: string;
  redFlags: RedFlag[];
  keyTerms: KeyTerm[];
  negotiationTips: string[];
  missingProtections: string[];
  favorableTerms: string[];
}
interface AnalyzeResponse {
  analysis?: Analysis;
  disclaimer?: string;
  error?: string;
  message?: string;
}

function riskColor(level: string): string {
  switch (level) {
    case "low": return "text-emerald-400";
    case "moderate": return "text-amber-400";
    case "high": return "text-orange-400";
    default: return "text-red-400";
  }
}
function riskRing(level: string): string {
  switch (level) {
    case "low": return "border-emerald-400/40 bg-emerald-400/10";
    case "moderate": return "border-amber-400/40 bg-amber-400/10";
    case "high": return "border-orange-400/40 bg-orange-400/10";
    default: return "border-red-400/40 bg-red-400/10";
  }
}
function severityBadge(s: string): string {
  switch (s) {
    case "critical": return "bg-red-500/20 text-red-300 border-red-500/40";
    case "high": return "bg-orange-500/20 text-orange-300 border-orange-500/40";
    case "medium": return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    default: return "bg-white/10 text-white/60 border-white/20";
  }
}
function termIcon(a: string) {
  if (a === "good") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (a === "concerning") return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
  return <MinusCircle className="h-4 w-4 text-white/40 shrink-0" />;
}

export default function Contracts() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [contractText, setContractText] = useState("");
  const [contractType, setContractType] = useState<ContractTypeKey>("record-deal");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const [error, setError] = useState("");

  const charCount = contractText.length;
  const canAnalyze = contractText.trim().length >= 200 && !loading;

  async function analyze() {
    if (!canAnalyze) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await confirmedFetch("/api/contracts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: CREDIT_COST,
        overrideFeature: "Contract Analysis",
        body: JSON.stringify({
          contractText: contractText.trim(),
          contractType,
          context: context.trim(),
        }),
      });
      const data = (await res!.json()) as AnalyzeResponse;
      if (data.analysis) {
        setResult(data.analysis);
        setDisclaimer(data.disclaimer ?? "");
      } else {
        setError(data.message || "Analysis failed. Try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  const a = result;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-5xl mx-auto px-4 pt-28 pb-20">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300 text-xs font-bold uppercase tracking-widest mb-4">
            <Scale className="h-3.5 w-3.5" />{t("contracts.ai_contract_analyzer")}</div>
          <h1 className="text-4xl md:text-5xl font-black mb-3">{t("contracts.read_the_fine_print")}<span className="text-amber-400">{t("contracts.before")}</span>{t("contracts.you_sign_it")}</h1>
          <p className="text-white/50 max-w-2xl mx-auto">{t("contracts.paste_any_creator_contract_recor")}</p>
        </div>

        {!a ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
            {/* Contract type */}
            <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">{t("contracts.what_kind_of_contract_is_it")}</label>
            <div className="flex flex-wrap gap-2 mb-6">
              {CONTRACT_TYPES.map((ct) => (
                <button
                  key={ct.key}
                  type="button"
                  onClick={() => setContractType(ct.key)}
                  className={`px-4 py-2 rounded-full text-sm font-bold border transition-colors ${
                    contractType === ct.key
                      ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                      : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
                  }`}
                >
                  {t(`contracts.type.${ct.key}`)}
                </button>
              ))}
            </div>

            {/* Contract text */}
            <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">{t("contracts.paste_the_contract_text")}</label>
            <textarea
              value={contractText}
              onChange={(e) => setContractText(e.target.value)}
              placeholder={t("contracts.paste_the_full_contract_here_cop")}
              rows={12}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50 font-mono"
            />
            <div className="flex justify-between items-center mt-2 mb-6">
              <span className={`text-xs ${charCount < 200 ? "text-white/30" : "text-emerald-400/70"}`}>
                {charCount.toLocaleString()} characters {charCount < 200 ? "(need 200+)" : "✓"}
              </span>
              <span className="text-xs text-white/30">{t("contracts.pdf_upload_coming_soon")}</span>
            </div>

            {/* Context */}
            <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-3">{t("contracts.anything_we_should_know")}<span className="text-white/25 normal-case">{t("contracts.optional")}</span>
            </label>
            <input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t("contracts.e_g_they_re_offering_5k_advance")}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50 mb-6"
            />

            {error && (
              <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            <button
              type="button"
              onClick={analyze}
              disabled={!canAnalyze}
              className="w-full py-4 rounded-xl font-black text-black bg-gradient-to-r from-amber-300 to-yellow-500 hover:from-amber-200 hover:to-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 className="h-5 w-5 animate-spin" />{t("contracts.analyzing_contract")}</>
              ) : (
                <><Sparkles className="h-5 w-5" /> Analyze Contract — {CREDIT_COST} Visual Bucs</>
              )}
            </button>
            {!user && (
              <p className="text-center text-xs text-white/30 mt-3">{t("contracts.sign_in_to_analyze_contracts")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const lines = [
                    `CONTRACT ANALYSIS — Bow Down Visuals`,
                    `Risk: ${a.riskScore}/100 (${a.riskLevel})`, "",
                    "SUMMARY:", a.summary, "",
                    ...a.redFlags.flatMap((f) => [`RED FLAG [${f.severity}]: ${f.title}`, f.explanation, ...(f.clause ? [`Clause: "${f.clause}"`] : []), ""]),
                    ...a.keyTerms.map((k) => `TERM — ${k.term}: ${k.value} (${k.assessment})`),
                    "", "NEGOTIATION TIPS:", ...a.negotiationTips.map((tip) => `• ${tip}`),
                    "", "MISSING PROTECTIONS:", ...a.missingProtections.map((m) => `• ${m}`),
                    "", "FAVORABLE TERMS:", ...a.favorableTerms.map((f) => `• ${f}`),
                  ];
                  navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
              >
                <Copy className="h-4 w-4" />{t("contracts.copy_analysis", { defaultValue: "Copy analysis" })}
              </button>
              <button
                type="button"
                onClick={() => {
                  const lines = [
                    `CONTRACT ANALYSIS — Bow Down Visuals`,
                    `Risk: ${a.riskScore}/100 (${a.riskLevel})`, "",
                    "SUMMARY:", a.summary, "",
                    ...a.redFlags.flatMap((f) => [`RED FLAG [${f.severity}]: ${f.title}`, f.explanation, ...(f.clause ? [`Clause: "${f.clause}"`] : []), ""]),
                    ...a.keyTerms.map((k) => `TERM — ${k.term}: ${k.value} (${k.assessment})`),
                    "", "NEGOTIATION TIPS:", ...a.negotiationTips.map((tip) => `• ${tip}`),
                    "", "MISSING PROTECTIONS:", ...a.missingProtections.map((m) => `• ${m}`),
                    "", "FAVORABLE TERMS:", ...a.favorableTerms.map((f) => `• ${f}`),
                  ];
                  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
                  const el = document.createElement("a");
                  el.href = URL.createObjectURL(blob);
                  el.download = "contract-analysis.txt";
                  el.click();
                  setTimeout(() => URL.revokeObjectURL(el.href), 4000);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
              >
                <Download className="h-4 w-4" />{t("contracts.download_analysis", { defaultValue: "Download" })}
              </button>
            </div>
            {/* Risk score hero */}
            <div className={`rounded-2xl border p-6 md:p-8 ${riskRing(a.riskLevel)}`}>
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="text-center shrink-0">
                  <div className={`text-6xl font-black ${riskColor(a.riskLevel)}`}>{a.riskScore}</div>
                  <div className="text-xs uppercase tracking-widest text-white/40 mt-1">{t("contracts.risk_score")}</div>
                  <div className={`mt-2 inline-block px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${riskRing(a.riskLevel)} ${riskColor(a.riskLevel)}`}>
                    {a.riskLevel} risk
                  </div>
                </div>
                <div>
                  <h2 className="text-lg font-black mb-2 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-amber-400" />{t("contracts.the_bottom_line")}</h2>
                  <p className="text-white/70 leading-relaxed">{a.summary}</p>
                </div>
              </div>
            </div>

            {/* Red flags */}
            {a.redFlags?.length > 0 && (
              <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-6">
                <h2 className="text-lg font-black mb-4 flex items-center gap-2 text-red-300">
                  <ShieldAlert className="h-5 w-5" /> Red Flags ({a.redFlags.length})
                </h2>
                <div className="space-y-4">
                  {a.redFlags.map((f, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${severityBadge(f.severity)}`}>
                          {f.severity}
                        </span>
                        <span className="font-bold text-white/90">{f.title}</span>
                      </div>
                      <p className="text-sm text-white/60 mb-2">{f.explanation}</p>
                      {f.clause && (
                        <p className="text-xs text-white/35 italic border-l-2 border-red-500/30 pl-3">"{f.clause}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Key terms */}
            {a.keyTerms?.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <h2 className="text-lg font-black mb-4 flex items-center gap-2">
                  <Scale className="h-5 w-5 text-amber-400" />{t("contracts.key_terms")}</h2>
                <div className="grid md:grid-cols-2 gap-3">
                  {a.keyTerms.map((t, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/30 p-4 flex gap-3">
                      {termIcon(t.assessment)}
                      <div>
                        <div className="text-xs font-bold uppercase tracking-widest text-white/40">{t.term}</div>
                        <div className="text-sm text-white/80 mt-1">{t.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Negotiation tips */}
            {a.negotiationTips?.length > 0 && (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-6">
                <h2 className="text-lg font-black mb-4 flex items-center gap-2 text-amber-300">
                  <Lightbulb className="h-5 w-5" />{t("contracts.how_to_negotiate")}</h2>
                <ul className="space-y-3">
                  {a.negotiationTips.map((tip, i) => (
                    <li key={i} className="flex gap-3 text-sm text-white/70">
                      <span className="shrink-0 h-6 w-6 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-xs font-black flex items-center justify-center">{i + 1}</span>
                      <span className="pt-0.5">{tip}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Missing protections + favorable */}
            <div className="grid md:grid-cols-2 gap-6">
              {a.missingProtections?.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <h2 className="text-base font-black mb-3 flex items-center gap-2 text-white/80">
                    <ShieldCheck className="h-4 w-4 text-white/40" />{t("contracts.missing_protections")}</h2>
                  <ul className="space-y-2">
                    {a.missingProtections.map((m, i) => (
                      <li key={i} className="text-sm text-white/55 flex gap-2">
                        <span className="text-amber-400/60">•</span> {m}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {a.favorableTerms?.length > 0 && (
                <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-6">
                  <h2 className="text-base font-black mb-3 flex items-center gap-2 text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />{t("contracts.what_s_fair")}</h2>
                  <ul className="space-y-2">
                    {a.favorableTerms.map((f, i) => (
                      <li key={i} className="text-sm text-white/60 flex gap-2">
                        <span className="text-emerald-400/70">•</span> {f}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* Disclaimer */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex gap-3">
              <Gavel className="h-5 w-5 text-white/30 shrink-0 mt-0.5" />
              <p className="text-xs text-white/40 leading-relaxed">{disclaimer}</p>
            </div>

            <button
              type="button"
              onClick={() => { setResult(null); setContractText(""); setContext(""); }}
              className="w-full py-3 rounded-xl font-bold border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
            >{t("contracts.analyze_another_contract")}</button>
          </div>
        )}
      </main>

      <OutOfCredits />
    </div>
  );
}
