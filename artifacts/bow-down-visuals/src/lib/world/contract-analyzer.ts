/* ─── Contract analyzer seam (stack1100 world parity) ──────────────
   The Contract Analyzer (pages/contracts.tsx), native at the
   Promote Desk — on its own rail:

     POST /api/contracts/analyze → { analysis, disclaimer }
                                   300 Visual Bucs, charge-before-
                                   generate with auto-refund on
                                   failure (the rail's design).

   The desk rides the page's exact call: confirmedFetch with the
   page's overrideCost / overrideFeature, the body field-for-field
   ({ contractText, contractType, context }), and the page's own
   readiness gate (a real contract — at least 200 characters).
   The framing law rides with it, in the page's own words: always
   an AI reading, not legal advice — the rail's disclaimer renders
   with every result. */

export const CONTRACTS_ANALYZE_PATH = "/api/contracts/analyze";

/** The page's pinned cost (pages/contracts.tsx CREDIT_COST; the
 *  rail charges its matching constant). */
export const CONTRACT_ANALYSIS_COST_VB = 300;
export const CONTRACT_ANALYSIS_FEATURE = "Contract Analysis";

/** The page's canAnalyze gate: a contract, not a sentence. */
export const MIN_CONTRACT_CHARS = 200;

export const CONTRACT_TYPE_OPTIONS = [
  { key: "record-deal", label: "Record Deal" },
  { key: "brand-deal", label: "Brand / Sponsorship" },
  { key: "sync-license", label: "Sync License" },
  { key: "management", label: "Management" },
  { key: "publishing", label: "Publishing" },
  { key: "distribution", label: "Distribution" },
  { key: "other", label: "Other" },
] as const;

export function contractTypeLabel(key: string): string {
  return CONTRACT_TYPE_OPTIONS.find((t) => t.key === key)?.label ?? "Other";
}

export function analyzeReady(contractText: string, contractType: string): boolean {
  return (
    contractText.trim().length >= MIN_CONTRACT_CHARS &&
    CONTRACT_TYPE_OPTIONS.some((t) => t.key === contractType)
  );
}

export function buildAnalyzeBody(
  contractText: string,
  contractType: string,
  context: string,
): Record<string, unknown> {
  return {
    contractText: contractText.trim(),
    contractType,
    context: context.trim(),
  };
}

interface ContractRedFlag {
  title: string;
  severity: string;
  explanation: string;
  clause: string;
}

interface ContractKeyTerm {
  term: string;
  value: string;
  assessment: string;
}

interface ContractAnalysis {
  riskScore: number;
  riskLevel: string;
  summary: string;
  redFlags: ContractRedFlag[];
  keyTerms: ContractKeyTerm[];
  negotiationTips: string[];
  missingProtections: string[];
  favorableTerms: string[];
}

export interface ContractAnalysisResult {
  analysis: ContractAnalysis;
  disclaimer: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Parse the rail's answer. A charged analysis that can't be read
 *  is a failed attempt (null) — never a blank verdict over a paid
 *  result; the desk's error line names the refund path. */
export function parseContractAnalysis(payload: unknown): ContractAnalysisResult | null {
  const root = asRecord(payload);
  const a = root ? asRecord(root["analysis"]) : null;
  if (!root || !a) return null;
  const riskScore = a["riskScore"];
  if (typeof riskScore !== "number" || !Number.isFinite(riskScore)) return null;
  const summary = str(a["summary"]);
  if (!summary) return null;
  const redFlags: ContractRedFlag[] = [];
  if (Array.isArray(a["redFlags"])) {
    for (const raw of a["redFlags"]) {
      const f = asRecord(raw);
      if (!f) continue;
      redFlags.push({
        title: str(f["title"]),
        severity: str(f["severity"]),
        explanation: str(f["explanation"]),
        clause: str(f["clause"]),
      });
    }
  }
  const keyTerms: ContractKeyTerm[] = [];
  if (Array.isArray(a["keyTerms"])) {
    for (const raw of a["keyTerms"]) {
      const t = asRecord(raw);
      if (!t) continue;
      keyTerms.push({ term: str(t["term"]), value: str(t["value"]), assessment: str(t["assessment"]) });
    }
  }
  return {
    analysis: {
      riskScore,
      riskLevel: str(a["riskLevel"]),
      summary,
      redFlags,
      keyTerms,
      negotiationTips: strList(a["negotiationTips"]),
      missingProtections: strList(a["missingProtections"]),
      favorableTerms: strList(a["favorableTerms"]),
    },
    disclaimer: str(root["disclaimer"]),
  };
}

export function riskLevelLabel(level: string): string {
  switch (level) {
    case "low":
      return "Low risk";
    case "moderate":
      return "Moderate risk";
    case "high":
      return "High risk";
    case "severe":
      return "Severe risk";
    default:
      return "Risk reading";
  }
}

/** Severity words for the flag chips, title-cased from the rail's
 *  enum (low / medium / high / critical). */
export function severityLabel(severity: string): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "Flag";
  }
}
