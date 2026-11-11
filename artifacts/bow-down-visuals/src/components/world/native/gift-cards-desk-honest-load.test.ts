/**
 * GiftCardsDesk — honest load standard (deep-pins tranche 4,
 * batch E). The desk runs two collection loads plus a balance
 * check and a money-move refund. Mine and sold each land the
 * standard here: a 503 is its own named unavailable line (not an
 * error, not an empty list), sold's 404 is the rail's no-profile
 * fact, any other non-ok and any unparseable answer throw into
 * the failed state with a working retry, and the loaded list is
 * set only from the parsed answer — so loading, failed,
 * honestly-empty and loaded render in that order and a failure
 * never paints as "no cards". The check sets a balance only from
 * a parsed ok answer. The refund is two-tap: the first tap only
 * arms the exact refundable figure (a fully-held card skips the
 * arm so the rail's CARD_IN_USE words answer), the note lands
 * only from a parsed ok refund, and both lists then reload from
 * the rails rather than being edited locally.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GiftCardsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("mine and sold — 503 / 404 are named states, the rest throw to failed", () => {
  it("loadMine: 503 returns as unavailable; non-ok and unparseable throw before setMine", () => {
    const body = slice(src, "const loadMine = useCallback(async () => {", "const loadSold = useCallback(async () => {");
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"worldRemainder.gcdLoadMineFailed\")));");
    expect(body).toContain("if (!parsed) throw new Error(t(\"worldRemainder.gcdLoadMineFailed\"));");
    expect(body.indexOf("setMine(parsed);")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(body).toContain("setMineFailed(true);");
  });

  it("loadSold: 503 unavailable, then 404 no-profile, then non-ok / unparseable throw", () => {
    const body = slice(src, "const loadSold = useCallback(async () => {", "useEffect(() => {\n    void loadMine();");
    expect(body.indexOf("if (res.status === 503) {")).toBeLessThan(body.indexOf("if (res.status === 404) {"));
    expect(body.indexOf("if (res.status === 404) {")).toBeLessThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain("setSoldNoProfile(apiErrorMessage(data, t(\"worldRemainder.gcdNoProfile\")));");
    expect(body).toContain("if (!parsed) throw new Error(t(\"worldRemainder.gcdLoadSoldFailed\"));");
    expect(body.indexOf("setSold(parsed);")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(body).toContain("setSoldFailed(true);");
  });

  it("mine renders guest → unavailable → failed+retry → loading → empty → loaded, in that order", () => {
    const body = slice(src, "{isGuest ? (", "{!isGuest && (");
    expect(body.indexOf(") : unavailable ? (")).toBeLessThan(body.indexOf(") : mineFailed ? ("));
    expect(body.indexOf(") : mineFailed ? (")).toBeLessThan(body.indexOf(") : mine === null ? ("));
    expect(body.indexOf(") : mine === null ? (")).toBeLessThan(
      body.indexOf("mine.bought.length === 0 && mine.received.length === 0"),
    );
    expect(body).toContain("void loadMine();");
  });

  it("sold renders unavailable → no-profile → failed+retry → loading → empty → totals, in that order", () => {
    const body = slice(src, "{soldUnavailable ? (", "</NativeCard>");
    expect(body.indexOf("soldUnavailable ? (")).toBeLessThan(body.indexOf(") : soldNoProfile ? ("));
    expect(body.indexOf(") : soldNoProfile ? (")).toBeLessThan(body.indexOf(") : soldFailed ? ("));
    expect(body.indexOf(") : soldFailed ? (")).toBeLessThan(body.indexOf(") : sold === null ? ("));
    expect(body.indexOf(") : sold === null ? (")).toBeLessThan(
      body.indexOf("sold.liability.cardCount === 0 && sold.cards.length === 0"),
    );
    expect(body).toContain('data-testid="world-gift-card-sold-retry"');
  });
});

describe("the check and the refund — results land only from parsed ok answers", () => {
  it("check refuses an empty code, throws on non-ok / unparseable, and sets the balance only after", () => {
    const body = slice(src, "const check = async () => {", "/* The two-tap refund:");
    expect(body).toContain("if (!trimmed || checking) return;");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"worldRemainder.gcdCheckFailed\")));");
    expect(body).toContain("if (!parsed) throw new Error(t(\"worldRemainder.gcdCheckFailed\"));");
    expect(body.indexOf("setBalance(parsed);")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(body).toContain("setCheckError(plainErrorText(e, t(\"worldRemainder.gcdCheckFailed\")));");
  });

  it("the refund arms first (unless fully held), and its note lands only from a parsed ok refund before both lists reload", () => {
    const body = slice(src, "const tapRefund = async (card: GiftCardView) => {", "const refundAction = (card: GiftCardView): ReactNode => {");
    expect(body).toContain("if (armedRefundId !== card.id && card.availableCents > 0) {");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"worldGiftCardsDesk.refundFailed\")));");
    expect(body).toContain("if (!parsed) throw new Error(t(\"worldGiftCardsDesk.refundFailed\"));");
    expect(body.indexOf("parsed.note ||")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(body.indexOf("await Promise.all([loadMine(), loadSold()]);")).toBeGreaterThan(body.indexOf("parsed.note ||"));
    expect(body).toContain("setRefundError(plainErrorText(e, t(\"worldGiftCardsDesk.refundFailed\")));");
  });
});
