/**
 * ThemePacksDesk — honest load standard (deep-pins tranche 5).
 * The entitlement feed is the load that matters: until it
 * RESOLVES, ownership is unknown — not empty — so premium
 * cards render the disabled "Checking your packs…" state
 * before any buy button exists (QC fix #12: a reload once
 * offered an already-owned pack for sale). A failed feed
 * retries twice (1.5s / 4s), then falls back to
 * ready-with-what-we-have (per-user cache merged in) — and
 * the purchase rail itself refuses a second charge for an
 * owned pack, so the fallback can never double-charge.
 * Readings only ever ADD owned ids. Buys: 402 is the
 * insufficient-funds line, any other non-ok throws into the
 * per-pack error line, and owned is applied only after ok +
 * json.owned. Device downloads: every leg throws on !ok and
 * the done tick is set only after the blob download fires.
 * (CreatorPacksSection further down was pinned in tranche 1.)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ThemePacksDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the entitlement feed — pending is a state, never an empty list", () => {
  it("starts unresolved; guests resolve immediately (no feed); a signed-in seat resets then hydrates from cache", () => {
    expect(src).toContain("const [entitlementsReady, setEntitlementsReady] = useState(false);");
    const body = slice(src, "useEffect(() => {\n    if (!user?.id) {", "// eslint-disable-next-line react-hooks/exhaustive-deps");
    expect(body).toContain("setEntitlementsReady(true);");
    expect(body).toContain("ownedIdsRef.current = [];");
    expect(body).toContain("setEntitlementsReady(false);");
    expect(body).toContain("applyOwnedIds(readCachedOwnedPackIds(user.id));");
    expect(body).toContain("void refreshEntitlements();");
    expect(body.indexOf("setEntitlementsReady(false);")).toBeLessThan(
      body.indexOf("applyOwnedIds(readCachedOwnedPackIds(user.id));"),
    );
  });

  it("throws on !ok; success applies owned + elite and only then marks ready", () => {
    const body = slice(src, "const refreshEntitlements = async", "useEffect(() => {\n    if (!user?.id) {");
    expect(body).toContain("if (!token) return;");
    expect(body).toContain('const res = await fetch("/api/theme-packs/state", {');
    expect(body).toContain("if (!res.ok) throw new Error(`state failed (${res.status})`);");
    expect(body).toContain("applyOwnedIds(json.owned ?? []);");
    expect(body).toContain("setElite(json.elite === true);");
    expect(body).toContain("setEntitlementsReady(true);");
    expect(body.indexOf("if (!res.ok) throw new Error(`state failed (${res.status})`);")).toBeLessThan(
      body.indexOf("applyOwnedIds(json.owned ?? []);"),
    );
    expect(body.indexOf("applyOwnedIds(json.owned ?? []);")).toBeLessThan(
      body.indexOf("setEntitlementsReady(true);"),
    );
  });

  it("a failed read stays pending through two retries, then falls back to ready-with-cache — never paints not-owned", () => {
    const body = slice(src, "} catch {", "useEffect(() => {\n    if (!user?.id) {");
    expect(body).toContain("if (attempt < 2) {");
    expect(body).toContain("() => void refreshEntitlements(attempt + 1),");
    expect(body).toContain("attempt === 0 ? 1500 : 4000,");
    expect(body).toContain("setEntitlementsReady(true);");
    // the failure path never writes an empty owned list and never marks a pack un-owned
    expect(body).not.toContain("setOwnedIds([])");
    expect(body).not.toContain("applyOwnedIds([])");
  });

  it("readings only ever ADD: applyOwnedIds merges through the ref and caches the merge", () => {
    const body = slice(src, "const applyOwnedIds = (incoming: readonly string[]) => {", "const refreshEntitlements = async");
    expect(body).toContain("const merged = mergeOwnedPackIds(ownedIdsRef.current, incoming);");
    expect(body).toContain("ownedIdsRef.current = merged;");
    expect(body).toContain("setOwnedIds(merged);");
    expect(body).toContain("cacheOwnedPackIds(user?.id, merged);");
  });

  it("render: the pending branch (disabled checking button) stands before the buy button", () => {
    expect(src).toContain("entitlementsPending={Boolean(user) && !entitlementsReady}");
    const card = slice(src, "entitlementsPending,", "const [look] = useState");
    expect(card).toContain(") : entitlementsPending ? (");
    expect(card).toContain('data-testid={`theme-pack-checking-${pack.id}`}');
    expect(card).toContain('t("settings.themePacksChecking", { defaultValue: "Checking your packs…" })');
    expect(card).toContain('data-testid={`theme-pack-buy-${pack.id}`}');
    expect(card.indexOf(") : entitlementsPending ? (")).toBeLessThan(
      card.indexOf('data-testid={`theme-pack-buy-${pack.id}`}'),
    );
  });
});

describe("the buy + device rails — success is claimed only after a checked ok", () => {
  it("buy: 402 is the insufficient line and returns; non-ok throws; owned applies only on ok + json.owned", () => {
    const body = slice(src, "const buyPack = async (pack: ThemePack) => {", "useEffect(() => {\n    const sync = () => {");
    expect(body).toContain('if (!token) throw new Error("signin");');
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain('t("settings.themePacksInsufficient", {');
    expect(body).toContain("if (!res.ok) throw new Error(`purchase failed (${res.status})`);");
    expect(body).toContain("if (json?.owned) {");
    expect(body).toContain("applyOwnedIds([pack.id]);");
    expect(body).toContain('t("settings.themePacksBuyError", {');
    expect(body.indexOf("if (res.status === 402) {")).toBeLessThan(
      body.indexOf("if (!res.ok) throw new Error(`purchase failed (${res.status})`);"),
    );
    expect(body.indexOf("if (!res.ok) throw new Error(`purchase failed (${res.status})`);")).toBeLessThan(
      body.indexOf("applyOwnedIds([pack.id]);"),
    );
    // the 402 branch returns before the owned-apply can run
    const s402 = slice(body, "if (res.status === 402) {", "if (!res.ok) throw new Error(`purchase failed (${res.status})`);");
    expect(s402).toContain("return;");
    expect(s402).not.toContain("applyOwnedIds");
  });

  it("device renders throw on !ok and on a missing url; the done tick lands only after the download fires", () => {
    const render = slice(src, "const renderPiece = async", "const downloadSet = async");
    expect(render).toContain("if (!res.ok) {");
    expect(render).toContain("throw new Error(apiErrorMessage(json, \"That render didn't finish — try again in a moment.\"));");
    expect(render).toContain('if (!json.url) throw new Error("render returned no url");');
    const set = slice(src, "const downloadSet = async", "const downloadOne = async");
    expect(set).toContain("if (!zipRes.ok) {");
    expect(set).toContain("const blob = await zipRes.blob();");
    expect(set).toContain("a.click();");
    expect(set).toContain("setDone(kind);");
    expect(set.indexOf("a.click();")).toBeLessThan(set.indexOf("setDone(kind);"));
    const catchPart = slice(set, "} catch (err) {", "} finally {");
    expect(catchPart).toContain("fail(err);");
    expect(catchPart).not.toContain("setDone");
  });
});
