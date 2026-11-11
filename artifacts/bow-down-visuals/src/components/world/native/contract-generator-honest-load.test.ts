/**
 * ContractGenerator (World native) — honest load standard
 * (deep-pins tranche 5). The mount read is a price/status
 * probe: its failure leaves the fallback price standing and
 * says so in its own comment (the displayed price is an
 * enhancement; the charge is confirmed against the real
 * cost at generate time). The generate itself is strict:
 * the result is set only from a parsed body past the ok
 * gate; a drifted body is its own shape error
 * (genErrorShape), distinct from the status error; on a
 * refused attempt the idempotency key is VOIDED — the rail
 * refunded the attempt, so a retry mints a fresh key and
 * can never replay the charged one; editing the deal after
 * a success also starts a new intent.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ContractGenerator.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the status probe — an enhancement with an honest fallback", () => {
  it("!ok returns silently and a throw leaves the fallback price; a parsed status is the only writer", () => {
    const body = slice(src, "const res = await fetch(CONTRACTS_GENERATE_STATUS_PATH, {", "function setField(");
    expect(body).toContain("if (!res.ok) return;");
    expect(body).toContain("const status = parseGenerateStatus(await res.json().catch(() => null));");
    expect(body).toContain("if (live && status) {");
    expect(body).toContain("setCost(status.creditCost);");
    expect(body).toContain("/* status unreachable — the fallback price stands */");
    const catchPart = slice(body, "} catch {", "})();");
    expect(catchPart).not.toContain("setCost");
    expect(catchPart).not.toContain("setResult");
  });
});

describe("generate — parsed or it didn't happen", () => {
  it("declined silent; 402 out; !ok voids the key and errors; a drifted body is the shape error; result only parsed", () => {
    const body = slice(src, "async function generate() {", "  }\n\n");
    expect(body).toContain("setResult(null);");
    expect(body).toContain("if (!res) return; // declined the confirmation — nothing charged");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain('genKeyRef.current = "";');
    expect(body).toContain('setError(apiErrorMessage(data, t("worldTeamLegal.genErrorStatus")));');
    expect(body).toContain("const parsed = parseContractGeneration(data);");
    expect(body).toContain('setError(t("worldTeamLegal.genErrorShape"));');
    expect(body).toContain("setResult(parsed);");
    expect(body.indexOf("const parsed = parseContractGeneration(data);")).toBeLessThan(body.indexOf("setResult(parsed);"));
    const shape = slice(body, "const parsed = parseContractGeneration(data);", "setResult(parsed);");
    expect(shape).toContain("if (!parsed) {");
    expect(shape).toContain("return;");
  });

  it("editing the deal after a success voids the intent key", () => {
    const body = slice(src, "function setField(key: keyof ContractGenerateFields, value: string) {", "async function generate() {");
    expect(body).toContain('if (result) genKeyRef.current = "";');
  });
});
