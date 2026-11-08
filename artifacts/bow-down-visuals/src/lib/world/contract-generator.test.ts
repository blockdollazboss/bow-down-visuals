import { describe, expect, it } from "vitest";
import {
  CONTRACTS_GENERATE_PATH,
  CONTRACTS_GENERATE_STATUS_PATH,
  CONTRACT_GENERATE_FEATURE,
  CONTRACT_GENERATE_FALLBACK_COST_VB,
  EMPTY_GENERATE_FIELDS,
  buildGenerateBody,
  generateReady,
  parseContractGeneration,
  parseGenerateStatus,
  type ContractGenerateFields,
} from "./contract-analyzer";

/* ─── Contract generator seam (Stack 300, crew 29) ───────────────
   The drafting twin of the analyzer, docked beside it on the 2D
   /contracts page (Generate mode) and in the World (the
   ContractGenerator desk under the analyzer desk). These tests
   pin the seam's contract with the rail:

   - the price is NEVER a surface constant: surfaces fetch the
     rail's /generate/status and display THAT number; the only
     literal here is the pre-status fallback (the registry's
     recorded default), pinned so it can't drift quietly;
   - the readiness gate mirrors the rail's required fields (both
     parties named, a real type from the family's seven);
   - the body goes field-for-field, trimmed;
   - the result parse refuses a draftless answer — a charged
     generation that can't be read is a failed attempt, and the
     rail's disclaimer rides through untouched. */

const FIELDS: ContractGenerateFields = {
  ...EMPTY_GENERATE_FIELDS,
  creatorName: "  Thy Cheat Code ",
  counterpartyName: " Example Brand LLC ",
  paymentTerms: " $5,000 flat ",
  term: " 6 months ",
};

describe("contract generator — price comes from the rail, never the surface", () => {
  it("pins the paths, the feature name, and the fallback default", () => {
    expect(CONTRACTS_GENERATE_PATH).toBe("/api/contracts/generate");
    expect(CONTRACTS_GENERATE_STATUS_PATH).toBe("/api/contracts/generate/status");
    expect(CONTRACT_GENERATE_FEATURE).toBe("Contract Generation");
    expect(CONTRACT_GENERATE_FALLBACK_COST_VB).toBe(300);
  });

  it("parses a well-formed status answer", () => {
    expect(
      parseGenerateStatus({ creditCost: 500, disclaimer: "This is an AI reading, not legal advice." }),
    ).toEqual({ creditCost: 500, disclaimer: "This is an AI reading, not legal advice." });
  });

  it("refuses off-shape status answers — the fallback stands, nothing is invented", () => {
    expect(parseGenerateStatus(null)).toBeNull();
    expect(parseGenerateStatus("500")).toBeNull();
    expect(parseGenerateStatus({})).toBeNull();
    expect(parseGenerateStatus({ creditCost: 0 })).toBeNull();
    expect(parseGenerateStatus({ creditCost: -300 })).toBeNull();
    expect(parseGenerateStatus({ creditCost: Number.NaN })).toBeNull();
    expect(parseGenerateStatus({ creditCost: "300" })).toBeNull();
  });
});

describe("contract generator — readiness + body", () => {
  it("is ready only with both parties named and a real type", () => {
    expect(generateReady(FIELDS, "brand-deal")).toBe(true);
    expect(generateReady({ ...FIELDS, creatorName: "   " }, "brand-deal")).toBe(false);
    expect(generateReady({ ...FIELDS, counterpartyName: "" }, "brand-deal")).toBe(false);
    expect(generateReady(FIELDS, "not-a-type")).toBe(false);
    // The optional deal points never gate readiness — left out,
    // they become bracketed blanks in the draft.
    expect(
      generateReady(
        { ...EMPTY_GENERATE_FIELDS, creatorName: "A", counterpartyName: "B" },
        "other",
      ),
    ).toBe(true);
  });

  it("builds the rail body field-for-field, trimmed", () => {
    expect(buildGenerateBody(FIELDS, "brand-deal")).toEqual({
      contractType: "brand-deal",
      creatorName: "Thy Cheat Code",
      counterpartyName: "Example Brand LLC",
      paymentTerms: "$5,000 flat",
      term: "6 months",
      territory: "",
      exclusivity: "",
      rightsGranted: "",
      termination: "",
      context: "",
    });
  });

  it("rides the caller's per-intent idempotency key when it holds one", () => {
    expect(buildGenerateBody(FIELDS, "brand-deal", "gen-intent-abc12345")).toEqual({
      contractType: "brand-deal",
      creatorName: "Thy Cheat Code",
      counterpartyName: "Example Brand LLC",
      paymentTerms: "$5,000 flat",
      term: "6 months",
      territory: "",
      exclusivity: "",
      rightsGranted: "",
      termination: "",
      context: "",
      idempotencyKey: "gen-intent-abc12345",
    });
  });
});

describe("contract generator — result parse", () => {
  it("carries title, summary, draft, and the rail's disclaimer through untouched", () => {
    const parsed = parseContractGeneration({
      generation: {
        title: "Brand Sponsorship Agreement",
        draft: "This is an AI reading, not legal advice. …",
        summary: "Drafted from your deal points.",
      },
      disclaimer: "This is an AI reading, not legal advice. Have an entertainment lawyer review before signing anything.",
    });
    expect(parsed).toEqual({
      title: "Brand Sponsorship Agreement",
      summary: "Drafted from your deal points.",
      draft: "This is an AI reading, not legal advice. …",
      disclaimer:
        "This is an AI reading, not legal advice. Have an entertainment lawyer review before signing anything.",
    });
  });

  it("refuses a draftless or shapeless answer", () => {
    expect(parseContractGeneration(null)).toBeNull();
    expect(parseContractGeneration({})).toBeNull();
    expect(parseContractGeneration({ generation: { draft: "" } })).toBeNull();
    expect(parseContractGeneration({ generation: "nope" })).toBeNull();
  });
});
