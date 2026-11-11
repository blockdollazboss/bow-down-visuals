/**
 * BusinessDesks (PressKitDesk, BioPageDesk, the Coach Money /
 * Promote desk) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 2). Every load family in the file
 * rides an explicit state machine:
 *
 * - PRESS KIT: loading/ready/failed — the kit records only from
 *   an ok response inside ready; a failed read lands on failed,
 *   never on the no-kit state.
 * - COACH MONEY LINE: a failed /api/money read sets the explicit
 *   "unread" line (bizCoachMoneyUnread) — a successful read whose
 *   snapshot is empty sets the DIFFERENT no-money line. Failure
 *   and emptiness are never the same sentence.
 * - THE PROMOTE DESK'S BIO READ: a ready/failed machine of its
 *   own; the analytics leg is a documented additive strip (a
 *   miss stays a miss, the page still lands ready).
 * - BIO PAGE DESK: loadFailed flag — a failed read sets it and
 *   the draft seeds only from a proven page (or the proven
 *   no-page answer, which opens the editor as "new").
 * - PROMO-CARD HISTORY: a status machine (ready/failed) over the
 *   card list; the delete removes a row ONLY on the server's
 *   confirmed ok — the seam's own rule, written on the code.
 * - GENERATION POLLS (logo / intro-outro): a definitive non-ok
 *   poll answer lands failed at once ("not found"); a transient
 *   network throw keeps polling (the 2D page's rule, noted in
 *   the code); done records only on a succeeded outcome.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desks = read("./BusinessDesks.tsx");

describe("the press kit rides loading/ready/failed", () => {
  it("the kit records only from an ok response; failure lands on failed", () => {
    expect(desks).toContain('const res = await fetch("/api/press-kit/mine", { headers: await authHeaders() });');
    expect(desks).toContain('if (!res.ok) throw new Error("mine");');
    expect(desks).toContain("setKit(parsePressKits(data)[0] ?? null);");
    expect(desks).toContain('setState("ready");');
    expect(desks).toContain('if (!cancelled) setState("failed");');
    expect(desks.indexOf('throw new Error("mine")')).toBeLessThan(desks.indexOf("setKit(parsePressKits(data)[0] ?? null);"));
  });
});

describe("the coach money line never calls a failure 'no money'", () => {
  it("failure sets the unread line; only a proven empty snapshot sets the no-money line", () => {
    expect(desks).toContain('if (!res.ok) throw new Error("money");');
    expect(desks).toContain('setCoachMoneyLine(t("worldCoachMoney.bizCoachMoneyUnread"));');
    expect(desks).toContain(': t("worldCoachMoney.bizCoachNoMoney")');
    expect(desks).toContain("setCoachSnapshot(snap);");
  });
});

describe("the promote desk's bio read: ready/failed, analytics additive", () => {
  it("a failed bio read lands the desk on failed, data null", () => {
    expect(desks).toContain('setBio({ status: "ready", data: null });');
    expect(desks).toContain('setBio({ status: "ready", data: { page, analytics } });');
    expect(desks).toContain('if (!cancelled) setBio({ status: "failed", data: null });');
  });

  it("analytics records only on ok and its miss is documented as a miss", () => {
    expect(desks).toContain("if (aRes.ok) analytics = parseBioAnalytics((await aRes.json()) as unknown);");
    expect(desks).toContain("/* analytics is a strip, not the desk — a miss stays a miss */");
  });
});

describe("the bio page desk seeds its draft only from a proven answer", () => {
  it("a non-ok read throws into loadFailed; success clears it and seeds", () => {
    const load = desks.slice(desks.indexOf("const load = useCallback(async () => {"), desks.indexOf("void load();"));
    expect(load).toContain('if (!res.ok) throw new Error("bio");');
    expect(load).toContain("setPage(full);");
    expect(load).toContain("setLoadFailed(false);");
    expect(load).toContain("setLoadFailed(true);");
  });
});

describe("promo-card history: status machine + confirmed delete", () => {
  it("the history records only from an ok response; failure flips the status only", () => {
    expect(desks).toContain('if (!res.ok) throw new Error("history");');
    expect(desks).toContain('setHistory({ status: "ready", cards: page.cards, hasMore: page.hasMore });');
    expect(desks).toContain('setHistory((h) => ({ ...h, status: "failed" }));');
  });

  it("a history card leaves the shelf only on the server's confirmed delete", () => {
    expect(desks).toContain('if (!res.ok) throw new Error("delete");');
    expect(desks).toContain("The row leaves the shelf ONLY on the server's confirmed");
    expect(desks).toContain("setHistory((h) => ({ ...h, cards: removePromoCard(h.cards, c.id) }));");
    expect(desks.indexOf('throw new Error("delete")')).toBeLessThan(desks.indexOf("removePromoCard(h.cards, c.id)"));
    expect(desks).toContain('setHistoryNote(t("worldCoachMoney.bizCardRemoveFailed"));');
  });
});

describe("the generation polls: a definitive answer fails, a transient throw retries", () => {
  it("a non-ok poll lands failed at once; done records only on a succeeded outcome", () => {
    expect(desks).toContain('setLogoJob("failed");');
    expect(desks).toContain('setLogoError(t("worldCoachMoney.bizLogoNotFound"));');
    expect(desks).toContain('if (outcome.kind === "succeeded") {');
    expect(desks).toContain("setLogoUrl(outcome.url);");
    expect(desks).toContain('setLogoJob("done");');
  });

  it("a transient network throw keeps polling — the page's rule, written on the code", () => {
    expect(desks).toContain("/* keep polling on transient network errors (the page's rule) */");
  });
});
