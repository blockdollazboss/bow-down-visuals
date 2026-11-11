/**
 * PortraitCard — honest load standard (deep-pins tranche 4,
 * batch ACE-fix). The card's main load throws on non-ok into
 * the failed state, and the render shows that failed state
 * (with a tick retry) before the loading state, which is
 * before the card itself — a failed profile never paints as
 * an endless load or an empty card. The follow write sets
 * follow state only after its ok guard throws; the follow-
 * state READ is a courtesy read, pinned as written: on
 * failure the button simply stays in its loading dress. THE
 * FIX is the two summary rails (memberships + shop): each
 * fetch now throws on !r.ok, success sets the rows AND
 * clears the rail's failed flag, and the catch sets the
 * failed flag without ever writing [] over it — so a failed
 * rail renders its own failed branch (load-failed copy + a
 * Retry button) BEFORE the loading branch, which is before
 * the empty branch, instead of a failure reading as "this
 * creator has no memberships / nothing in the shop". Both
 * call sites pass failed + an onRetry that bumps
 * summaryTick, and the effect re-runs on summaryTick. The
 * creator-with-no-userId case still sets memberships []
 * directly — a proven no-rail state, not a failure.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PortraitCard.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("main load — non-ok throws into the failed state", () => {
  it("the profile fetch throws on non-ok and the catch sets failed", () => {
    const body = slice(src, "const res = await fetch(portraitProfilePath(member.slug));", "/* Follow state");
    expect(body).toContain('if (!res.ok) throw new Error("profile");');
    expect(body).toContain("if (!cancelled) setCard(portraitCardFromWire(member, wire));");
    expect(body).toContain("if (!cancelled) setFailed(true);");
    expect(body.indexOf('if (!res.ok) throw new Error("profile");')).toBeLessThan(
      body.indexOf("if (!cancelled) setCard(portraitCardFromWire(member, wire));"),
    );
    expect(src).toContain("}, [member, tick]);");
  });

  it("render order is failed (retry) → loading (card === null) → card", () => {
    const body = slice(src, "{failed ? (", "<TransferFooter");
    expect(body).toContain("<NativeErrorState");
    expect(body).toContain("onRetry={() => setTick((n) => n + 1)}");
    expect(body).toContain("<NativeLoadingState");
    expect(body).toContain("<NativeCard");
    expect(body.indexOf("{failed ? (")).toBeLessThan(body.indexOf(") : card === null ? ("));
    expect(body.indexOf(") : card === null ? (")).toBeLessThan(body.indexOf("<NativeCard"));
    expect(body.indexOf("<NativeErrorState")).toBeLessThan(body.indexOf("<NativeLoadingState"));
  });
});

describe("follow — the write is guarded, the read is a courtesy read", () => {
  it("toggleFollow sets follow state only after the ok guard throws", () => {
    const body = slice(src, "async function toggleFollow() {", "const websitePath");
    expect(body).toContain("if (!card || followBusy || following === null) return;");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(d, "follow"));');
    expect(body).toContain("setFollowing(next);");
    expect(body.indexOf('if (!res.ok) throw new Error(apiErrorMessage(d, "follow"));')).toBeLessThan(
      body.indexOf("setFollowing(next);"),
    );
    expect(body).toContain('setFollowNote(t("worldIdentityMisc.porFollowFailed"));');
  });

  it("the follow-state read failure leaves the button in its loading dress, as written", () => {
    const body = slice(src, "if (user) {", "if (card.userId) {");
    expect(body).toContain("if (!res.ok || cancelled) return;");
    expect(body).toContain("if (!cancelled) setFollowing(d[card.profileId] ?? false);");
    expect(body).toContain("} catch { /* button stays in its loading dress */ }");
    expect(body.indexOf("if (!res.ok || cancelled) return;")).toBeLessThan(
      body.indexOf("if (!cancelled) setFollowing(d[card.profileId] ?? false);"),
    );
    // the signed-out case is a proven not-following, set directly
    expect(body).toContain("setFollowing(false);");
  });
});

describe("THE FIX — the two summary rails fail honestly", () => {
  it("the memberships fetch throws on !r.ok; success clears its flag; the catch never writes []", () => {
    const body = slice(src, "if (card.userId) {", "fetch(portraitStoreCatalogPath(card.slug))");
    expect(body).toContain('if (!r.ok) throw new Error("memberships summary failed");');
    expect(body).toContain(".then((rows) => { if (!cancelled) { setMemberships(rows); setMembershipsFailed(false); } })");
    expect(body).toContain(".catch(() => { if (!cancelled) setMembershipsFailed(true); });");
    expect(body.indexOf('if (!r.ok) throw new Error("memberships summary failed");')).toBeLessThan(
      body.indexOf("setMemberships(rows); setMembershipsFailed(false);"),
    );
    // the catch sets ONLY the flag — no empty-rows write inside the rail chain
    const chain = slice(body, "fetch(portraitMembershipsPath(card.userId))", "} else {");
    expect(chain).not.toContain("setMemberships([])");
  });

  it("the no-userId case still sets memberships [] directly — a proven no-rail state", () => {
    const body = slice(src, "if (card.userId) {", "fetch(portraitStoreCatalogPath(card.slug))");
    expect(body).toContain("setMemberships([]);");
    expect(body.indexOf("} else {")).toBeLessThan(body.indexOf("setMemberships([]);"));
  });

  it("the shop fetch throws on !r.ok; success clears its flag; the catch never writes []", () => {
    const body = slice(src, "fetch(portraitStoreCatalogPath(card.slug))", "}, [card, user, summaryTick]);");
    expect(body).toContain('if (!r.ok) throw new Error("shop summary failed");');
    expect(body).toContain(".then((rows) => { if (!cancelled) { setShop(rows); setShopFailed(false); } })");
    expect(body).toContain(".catch(() => { if (!cancelled) setShopFailed(true); });");
    expect(body.indexOf('if (!r.ok) throw new Error("shop summary failed");')).toBeLessThan(
      body.indexOf("setShop(rows); setShopFailed(false);"),
    );
    expect(body).not.toContain("setShop([])");
  });

  it("SummaryRows renders failed (copy + Retry) BEFORE loading, BEFORE empty", () => {
    const body = slice(src, "function SummaryRows({", "export function PortraitCard({");
    expect(body).toContain('{t("worldIdentityMisc.porSummaryLoadFailed")}');
    expect(body).toContain("onClick={onRetry}");
    expect(body).toContain('{t("common.retry")}');
    expect(body).toContain('{t("worldIdentityMisc.checking")}');
    expect(body.indexOf("{failed ? (")).toBeLessThan(body.indexOf(") : rows === null ? ("));
    expect(body.indexOf(") : rows === null ? (")).toBeLessThan(body.indexOf(") : rows.length === 0 ? ("));
    expect(body.indexOf('{t("worldIdentityMisc.porSummaryLoadFailed")}')).toBeLessThan(
      body.indexOf('{t("worldIdentityMisc.checking")}'),
    );
  });

  it("both call sites pass failed + a summaryTick retry, and the effect re-runs on summaryTick", () => {
    expect(src).toContain("failed={membershipsFailed}");
    expect(src).toContain("failed={shopFailed}");
    expect(src).toContain("onRetry={() => setSummaryTick((n) => n + 1)}");
    expect(src.indexOf("failed={membershipsFailed}")).toBeLessThan(src.indexOf("failed={shopFailed}"));
    expect(src).toContain("}, [card, user, summaryTick]);");
  });
});
