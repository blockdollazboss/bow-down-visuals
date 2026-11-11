/**
 * LoopExchangePanel — honest load standard (deep-pins
 * tranche 5). PINNED POST-FIX. THE FIX (this tranche):
 * reload() used to ignore a non-ok or unparseable open-loops
 * answer and swallow throws whole, so a failed first load
 * rendered the loopExchange.noLoops empty copy. The loops
 * leg now owns a loadFailed flag: render order is loading →
 * loadFailed line + Retry (only when nothing is on screen) →
 * honest empty → grid; a failed REFRESH with loops already
 * listed keeps the list (stale beats a lie) and the flag
 * clears on the next good read. The "mine" leg stays
 * best-effort — it drives counts/badges, never the board's
 * only copy. Writes were already honest: claim / post /
 * rate each gate on res.ok before any reload or success
 * state.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LoopExchangePanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — the open-loops leg fails honestly", () => {
  it("non-ok, unparseable and thrown reads set loadFailed; only a parsed list clears it", () => {
    expect(src).toContain("const [loadFailed, setLoadFailed] = useState(false);");
    const body = slice(src, "const reload = useCallback(async () => {", "useEffect(() => { void reload(); }, [reload]);");
    expect(body).toContain("let loopsFailed = true;");
    expect(body).toContain("if (loopsRes.ok) {");
    expect(body).toContain("const parsed = parseLoopsResponse(await loopsRes.json().catch(() => null));");
    expect(body).toContain("setLoops(parsed);");
    expect(body).toContain("loopsFailed = false;");
    expect(body).toContain("setLoadFailed(loopsFailed);");
    expect(body.indexOf("setLoops(parsed);")).toBeLessThan(body.indexOf("setLoadFailed(loopsFailed);"));
    const catchPart = slice(body, "} catch {", "finally { setLoading(false); }");
    expect(catchPart).toContain("setLoadFailed(true);");
    expect(catchPart).not.toContain("setLoops");
  });

  it("render order: loading → loadFailed + Retry (nothing on screen) → honest empty → grid", () => {
    const body = slice(src, "{loading ? (", "{notice && (");
    expect(body).toContain(") : loadFailed && loops.length === 0 ? (");
    expect(body).toContain('t("loopExchange.listFailed", { defaultValue: "The open loops couldn\'t load just now." })');
    expect(body).toContain("onClick={() => void reload()}");
    expect(body).toContain('{t("common.retry")}');
    expect(body).toContain(") : loops.length === 0 ? (");
    expect(body).toContain('t("loopExchange.noLoops", { defaultValue: "No loops are posted yet — post the first one and set your terms." })');
    expect(body.indexOf("{loading ? (")).toBeLessThan(body.indexOf(") : loadFailed && loops.length === 0 ? ("));
    expect(body.indexOf(") : loadFailed && loops.length === 0 ? (")).toBeLessThan(
      body.indexOf(") : loops.length === 0 ? ("),
    );
  });

  it("the mine leg stays best-effort: parsed only on ok, never writes the board", () => {
    const body = slice(src, "const reload = useCallback(async () => {", "useEffect(() => { void reload(); }, [reload]);");
    expect(body).toContain("if (mineRes && mineRes.ok) {");
    expect(body).toContain("if (parsed) setMine(parsed);");
    const minePart = slice(body, "if (mineRes && mineRes.ok) {", "} catch {");
    expect(minePart).not.toContain("setLoadFailed");
    expect(minePart).not.toContain("setLoops");
  });
});
