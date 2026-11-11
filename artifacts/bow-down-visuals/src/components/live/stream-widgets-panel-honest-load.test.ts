/**
 * StreamWidgetsPanel — honest load standard (deep-pins
 * tranche 5). An explicit LoadState machine: idle (no
 * stream — "Widgets wake up when you go live"), loading,
 * ready, error. The load throws on !ok so a failure lands in
 * the error state, whose line says plainly that the widgets
 * stay hidden until the data is back — never an empty-looking
 * board dressed as real zeros. The honest empties ("No
 * followers yet" / "No tips yet" / "No goal set") exist only
 * inside the ready branch (data present). The 5s poll keeps
 * refreshing: a failed poll flips to error without wiping
 * the data already shown. Goal save claims success only on
 * status 200, then re-reads the widgets before painting.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StreamWidgetsPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the LoadState machine", () => {
  it("throws on !ok; data + ready land together; the catch sets error and never clears data", () => {
    expect(src).toContain('type LoadState = "idle" | "loading" | "ready" | "error";');
    const body = slice(src, "const loadOnce = async () => {", "async function saveGoal() {");
    expect(body).toContain('if (!res.ok) throw new Error("widgets failed");');
    expect(body).toContain("setData(json);");
    expect(body).toContain('setLoad("ready");');
    expect(body.indexOf('if (!res.ok) throw new Error("widgets failed");')).toBeLessThan(body.indexOf("setData(json);"));
    const catchPart = slice(body, "} catch {", "void loadOnce();");
    expect(catchPart).toContain('if (!cancelled) setLoad("error");');
    expect(catchPart).not.toContain("setData(null)");
    expect(body).toContain('setLoad("loading");');
    expect(body).toContain("timer = setInterval(() => void loadOnce(), 5000);");
  });

  it("no stream is the idle state, reset honestly — not a load at all", () => {
    const body = slice(src, "useEffect(() => {", "const loadOnce = async () => {");
    expect(body).toContain("if (!streamId) {");
    expect(body).toContain("setData(null);");
    expect(body).toContain('setLoad("idle");');
    expect(src).toContain('data-testid="widgets-idle"');
    expect(src).toContain("Widgets wake up when you go live.");
  });

  it("the error line names the failure and the consequence; empties live only under ready data", () => {
    expect(src).toContain('data-testid="widgets-error"');
    expect(src).toContain("Widget data couldn&rsquo;t load — the widgets stay hidden until it&rsquo;s back.");
    const ready = slice(src, "{streamId && data && (", "</section>");
    expect(ready).toContain('"No followers yet"');
    expect(ready).toContain('"No tips yet"');
    expect(ready).toContain('"No goal set"');
    // the error branch renders before the data branch in source order
    expect(src.indexOf('data-testid="widgets-error"')).toBeLessThan(src.indexOf("{streamId && data && ("));
  });
});

describe("the goal save — success claimed only on 200", () => {
  it("non-200 throws into the note; the success note precedes a checked re-read", () => {
    const body = slice(src, "async function saveGoal() {", "return (");
    expect(body).toContain('if (res.status !== 200) throw new Error(apiErrorMessage(json, "goal failed"));');
    expect(body).toContain("setNote(parsed ? `Goal set — the goal bar tracks tips toward ${formatBucs(parsed)}.` : \"Goal cleared.\");");
    expect(body.indexOf('if (res.status !== 200) throw new Error(')).toBeLessThan(
      body.indexOf("setNote(parsed ? `Goal set"),
    );
    expect(body).toContain("if (w.ok) {");
    const catchPart = slice(body, "} catch (err) {", "setSavingGoal(false);");
    expect(catchPart).toContain('setNote(plainErrorText(err, "That goal couldn\'t be saved. Try again."));');
    expect(catchPart).not.toContain("Goal set");
  });
});
