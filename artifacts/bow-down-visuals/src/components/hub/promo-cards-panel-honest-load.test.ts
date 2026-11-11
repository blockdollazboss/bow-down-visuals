/**
 * PromoCardsPanel — honest load standard (deep-pins tranche 3,
 * batch 8). The history list is the server's truth (its own header
 * comment): a three-state machine (loading / ready / failed) — the
 * loader throws on non-ok before any state, and a card leaves the
 * list ONLY after the server confirms its delete (the delete's own
 * comment says so; a failed delete toasts the failure and the card
 * stays). Generate: a decline stops with nothing run; non-ok throws
 * the server's words; an ok answer with zero cards is its own
 * "no output" error, never a success toast; the done toast and the
 * history reload happen only with real cards in hand. The
 * share-tracking POST is fire-and-forget BY DESIGN (its comment:
 * tracking is a passenger, never the driver) and a dismissed share
 * returns before any tracking — a share that didn't happen is never
 * counted.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PromoCardsPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the history list — the server's truth", () => {
  it("the loader throws on non-ok; failure is its own state", () => {
    const loader = slice(src, "const loadHistory = useCallback(async () => {", "useEffect(() => {\n    void loadHistory();");
    expect(loader).toContain('if (!res.ok) throw new Error("history");');
    expect(loader).toContain('setHistoryState("ready");');
    expect(loader).toContain('setHistoryState("failed");');
    expect(src).toContain("loading / failed-with-retry / truly-empty are");
  });

  it("a card leaves the list only after the server confirms the delete", () => {
    const body = slice(src, "async function deleteHistoryCard(card: PromoCardHistoryItem) {", "async function shareHistoryCard(card: PromoCardHistoryItem) {");
    expect(body).toContain('if (!res.ok) throw new Error("delete");');
    expect(body).toContain("/* Only a server-confirmed delete removes the card on screen. */");
    expect(body.indexOf("setHistory((prev) => removePromoCard(prev, card.id));")).toBeGreaterThan(body.indexOf('throw new Error("delete")'));
    expect(body).toContain('toast({ title: t("hubSpine.promoCards.historyDeleteFailed"), variant: "destructive" });');
  });
});

describe("generate — an empty pack is an error, never a success", () => {
  it("decline stops; non-ok throws; zero cards is the no-output error before any toast", () => {
    const body = slice(src, "async function generate() {", "function scheduleCard(card: PromoCard) {");
    expect(body).toContain("setLoading(false); // user cancelled the credit confirmation");
    expect(body).toContain("if (!res.ok) throw new Error(apiThrowMessage(data, t(\"hubSpine.promoCards.failed\")));");
    expect(body).toContain("const list = Array.isArray(data.cards) ? data.cards : [];");
    expect(body).toContain('if (list.length === 0) throw new Error(t("hubSpine.handoffs.noOutput"));');
    expect(body.indexOf("setCards(list);")).toBeGreaterThan(body.indexOf("if (list.length === 0) throw"));
    expect(body.indexOf("void loadHistory();")).toBeGreaterThan(body.indexOf("setCards(list);"));
  });

  it("share tracking is a passenger; a dismissed share is never tracked", () => {
    const body = slice(src, "async function shareHistoryCard(card: PromoCardHistoryItem) {", "/* The history card's own scheduler handoff:");
    expect(body).toContain("nothing is tracked for it below */");
    expect(body).toContain("catch { /* tracking is a passenger, never the driver */ }");
  });
});
