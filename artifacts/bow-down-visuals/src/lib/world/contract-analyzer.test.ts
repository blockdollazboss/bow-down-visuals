import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONTRACTS_ANALYZE_PATH,
  CONTRACT_ANALYSIS_COST_VB,
  CONTRACT_ANALYSIS_FEATURE,
  MIN_CONTRACT_CHARS,
  analyzeReady,
  buildAnalyzeBody,
  contractTypeLabel,
  parseContractAnalysis,
  riskLevelLabel,
  severityLabel,
} from "./contract-analyzer";

/* ─── Contract analyzer (stack1100 world parity) ───────────────────
   The deal-check from pages/contracts.tsx, docked at the Promote
   Desk. These tests pin the seam to the page's own call: the
   300-Buc price and feature name it confirms with, the 200-char
   readiness gate, the body field-for-field, and the result parse
   that refuses a scoreless answer. The framing law (an AI reading,
   not legal advice) is pinned in the component. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const LONG = "x".repeat(240);

const RESULT = {
  analysis: {
    riskScore: 72,
    riskLevel: "high",
    summary: "The term is long and the reversion clause is missing.",
    redFlags: [
      { title: "Perpetuity clause", severity: "critical", explanation: "Rights never revert.", clause: "in perpetuity" },
    ],
    keyTerms: [{ term: "Advance", value: "$25,000", assessment: "neutral" }],
    negotiationTips: ["Cap the term at 3 years"],
    missingProtections: ["No reversion clause"],
    favorableTerms: ["Quarterly accounting"],
  },
  disclaimer: "AI reading only — not legal advice.",
};

describe("the call — the page's own terms", () => {
  it("path, price and feature match pages/contracts.tsx exactly", () => {
    expect(CONTRACTS_ANALYZE_PATH).toBe("/api/contracts/analyze");
    expect(CONTRACT_ANALYSIS_COST_VB).toBe(300);
    expect(CONTRACT_ANALYSIS_FEATURE).toBe("Contract Analysis");
    const page = read("../../pages/contracts.tsx");
    expect(page).toContain('const CREDIT_COST = getCreditCost("/api/contracts/analyze")?.cost ?? 300;');
    expect(page).toContain('overrideFeature: "Contract Analysis"');
  });

  it("readiness is the page's gate: a real contract (≥200 chars) + a known type", () => {
    expect(MIN_CONTRACT_CHARS).toBe(200);
    expect(analyzeReady(LONG, "record-deal")).toBe(true);
    expect(analyzeReady("too short", "record-deal")).toBe(false);
    expect(analyzeReady(LONG, "handshake")).toBe(false);
    expect(contractTypeLabel("sync-license")).toBe("Sync License");
  });

  it("the body is the page's field-for-field", () => {
    expect(buildAnalyzeBody(`  ${LONG} `, "brand-deal", "  first deal ")).toEqual({
      contractText: LONG,
      contractType: "brand-deal",
      context: "first deal",
    });
  });
});

describe("the result parse", () => {
  it("reads the full analysis + the rail's disclaimer", () => {
    const parsed = parseContractAnalysis(RESULT);
    expect(parsed?.analysis.riskScore).toBe(72);
    expect(parsed?.analysis.redFlags[0]?.severity).toBe("critical");
    expect(parsed?.analysis.keyTerms[0]?.term).toBe("Advance");
    expect(parsed?.disclaimer).toContain("not legal advice");
  });

  it("a scoreless or summary-less answer is a failed read — never a blank verdict", () => {
    expect(parseContractAnalysis({ analysis: { summary: "x" } })).toBeNull();
    expect(parseContractAnalysis({ analysis: { riskScore: 10 } })).toBeNull();
    expect(parseContractAnalysis({})).toBeNull();
  });

  it("risk + severity words speak plainly", () => {
    expect(riskLevelLabel("high")).toBe("High risk");
    expect(riskLevelLabel("severe")).toBe("Severe risk");
    expect(riskLevelLabel("")).toBe("Risk reading");
    expect(severityLabel("critical")).toBe("Critical");
    expect(severityLabel("medium")).toBe("Medium");
  });
});

describe("the analyzer is docked in the Promote Desk, framing intact", () => {
  const analyzerSrc = read("../../components/world/native/ContractAnalyzer.tsx");
  const desksSrc = read("../../components/world/native/BusinessDesks.tsx");

  it("the mount sits inside PromoteDesk (the file's last desk)", () => {
    const deskAt = desksSrc.indexOf("export function PromoteDesk");
    const mountAt = desksSrc.indexOf("<ContractAnalyzer");
    expect(deskAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(deskAt);
    expect(desksSrc).toContain('import { ContractAnalyzer } from "./ContractAnalyzer"');
  });

  it("rides confirmedFetch with the pinned cost, and the not-legal-advice framing prints with the form AND the result", () => {
    expect(analyzerSrc).toContain('data-testid="world-contract-analyzer"');
    expect(analyzerSrc).toContain("confirmedFetch(CONTRACTS_ANALYZE_PATH");
    expect(analyzerSrc).toContain("overrideCost: CONTRACT_ANALYSIS_COST_VB");
    expect(analyzerSrc).toContain("if (!res) return");
    // The framing line is catalog copy now (worldTeamLegal.contractIntro,
    // en verbatim in every catalog — its "An AI reading, not legal advice"
    // words are pinned against the catalog by team-legal-i18n.test).
    expect(analyzerSrc).toContain('t("worldTeamLegal.contractIntro"');
    expect(analyzerSrc).toContain("result.disclaimer");
  });
});
