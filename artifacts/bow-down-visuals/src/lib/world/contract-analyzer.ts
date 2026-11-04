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

/* ─── display strings (i18n seam, stack100 locale unit 46) ────────
   The composed labels below take optional strings bundles whose
   defaults are the original English, byte-identical; the desk
   builds the bundles from the worldTeamLegal catalog keys so the
   words render in the walker's language. */

export interface ContractRiskStrings {
  low: string;
  moderate: string;
  high: string;
  severe: string;
  fallback: string;
}

export const CONTRACT_RISK_STRINGS_EN: ContractRiskStrings = {
  low: "Low risk",
  moderate: "Moderate risk",
  high: "High risk",
  severe: "Severe risk",
  fallback: "Risk reading",
};

/** Build the bundle from a translate function (the desk's `t`):
 *  every field reads its worldTeamLegal catalog key. */
export function contractRiskStrings(translate: (key: string) => string): ContractRiskStrings {
  return {
    low: translate("worldTeamLegal.contractRiskLow"),
    moderate: translate("worldTeamLegal.contractRiskModerate"),
    high: translate("worldTeamLegal.contractRiskHigh"),
    severe: translate("worldTeamLegal.contractRiskSevere"),
    fallback: translate("worldTeamLegal.contractRiskDefault"),
  };
}

export function riskLevelLabel(level: string, strings: ContractRiskStrings = CONTRACT_RISK_STRINGS_EN): string {
  switch (level) {
    case "low":
      return strings.low;
    case "moderate":
      return strings.moderate;
    case "high":
      return strings.high;
    case "severe":
      return strings.severe;
    default:
      return strings.fallback;
  }
}

export interface ContractSeverityStrings {
  critical: string;
  high: string;
  medium: string;
  low: string;
  fallback: string;
}

export const CONTRACT_SEVERITY_STRINGS_EN: ContractSeverityStrings = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  fallback: "Flag",
};

/** Build the bundle from a translate function (the desk's `t`):
 *  every field reads its worldTeamLegal catalog key. */
export function contractSeverityStrings(translate: (key: string) => string): ContractSeverityStrings {
  return {
    critical: translate("worldTeamLegal.contractSeverityCritical"),
    high: translate("worldTeamLegal.contractSeverityHigh"),
    medium: translate("worldTeamLegal.contractSeverityMedium"),
    low: translate("worldTeamLegal.contractSeverityLow"),
    fallback: translate("worldTeamLegal.contractSeverityDefault"),
  };
}

/** Severity words for the flag chips, title-cased from the rail's
 *  enum (low / medium / high / critical). */
export function severityLabel(severity: string, strings: ContractSeverityStrings = CONTRACT_SEVERITY_STRINGS_EN): string {
  switch (severity) {
    case "critical":
      return strings.critical;
    case "high":
      return strings.high;
    case "medium":
      return strings.medium;
    case "low":
      return strings.low;
    default:
      return strings.fallback;
  }
}
