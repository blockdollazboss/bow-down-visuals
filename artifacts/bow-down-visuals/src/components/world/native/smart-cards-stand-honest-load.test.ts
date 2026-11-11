/**
 * SmartCardsStand — honest load standard (deep-pins tranche 3,
 * batch 9). The "mine" load is a two-leg read (profiles + orders)
 * with a boolean verdict: any missing response, non-ok leg or
 * unparsed body returns false and BOTH collections stay unset — the
 * stand's state machine decides loading vs failed from the verdict
 * (read in the effect: ok → ready). Guests fire no load. The order
 * write: a missing response throws; a non-ok or unparsed result
 * lands the SERVER's error string in the form error (its own
 * fallback after); the result card, a fresh idempotency key and the
 * mine reload happen only from a parsed result. The edit save
 * throws on missing/non-ok/unparsed before the card updates.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SmartCardsStand.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the mine load — a boolean verdict, both legs or nothing", () => {
  it("any broken leg returns false and neither collection is set", () => {
    const body = slice(src, "const loadMine = async (): Promise<boolean> => {", "useEffect(() => {");
    expect(body).toContain('if (!pRes || !oRes) throw new Error("load");');
    expect(body).toContain('if (!pRes.ok || !oRes.ok || !parsedProfiles || !parsedOrders) throw new Error("load");');
    expect(body.indexOf("setProfiles(parsedProfiles);")).toBeGreaterThan(body.indexOf("throw new Error(\"load\")"));
    expect(body).toContain("return false;");
    expect(src).toContain("if (isGuest) return;");
  });
});

describe("order + edit — parsed results only", () => {
  it("order surfaces the server's error; the result card only from a parsed result", () => {
    const body = slice(src, "const placeOrder = async () => {", "const saveEdit = async () => {");
    expect(body).toContain('if (!res) throw new Error("order");');
    expect(body).toContain("if (!res.ok || !result) {");
    expect(body).toContain('((json as { error?: string } | null)?.error) ?? t("worldCommerceStands.cardsOrderFailed")');
    expect(body.indexOf("setOrderResult(result);")).toBeGreaterThan(body.indexOf("if (!res.ok || !result) {"));
  });

  it("the edit save throws before the card updates", () => {
    const body = src.slice(src.indexOf("const saveEdit = async () => {"));
    expect(body).toContain('if (!res) throw new Error("save");');
    expect(body).toContain('if (!res.ok || !updated) throw new Error("save");');
  });
});
