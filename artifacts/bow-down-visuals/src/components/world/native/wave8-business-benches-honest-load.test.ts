/**
 * Wave8BusinessBenches — honest load standard (deep-pins tranche 3,
 * batch 5). Two benches: MediaKitBench + CalendarAutofillBench.
 * Neither component has a list load of its own kind except the
 * calendar's week read; the pins cover each load-shaped surface.
 *
 * MediaKitBench: the vault options read is a documented progressive
 * enhancement (its comment: "a failed read just leaves the
 * auto-pick" — the select keeps its "no vault" option and the build
 * falls back server-side to profile basics; nothing is listed, so
 * nothing can dress up). The build itself is strict: a decline
 * returns to idle with nothing run; 402 names out-of-credits; 503
 * gets its own "isn't set up yet" line; non-ok or an unparseable kit
 * lands the server's words; the result card renders only from the
 * parsed kit, and the pre-run empty state renders only while there
 * is no kit AND no error.
 *
 * CalendarAutofillBench: the week read is a three-phase machine
 * (loading / ready / error) — a null response, a non-ok, or an
 * unparseable body all land in error with a retry wired to the real
 * loadWeek. The ONE judgment call is pinned as the page's own bar
 * (its code comment): a slots-less OBJECT body is an empty week,
 * while a non-object body throws "bad shape" — so an empty week
 * renders only from a real, object-shaped answer. The autofill run
 * mirrors MediaKit's honesty chain (decline / 402 / non-ok-or-
 * unparseable), and slots render only in the ready phase.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./Wave8BusinessBenches.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("MediaKitBench — options are an enhancement; the build is strict", () => {
  it("the vault read is the documented auto-pick fallback", () => {
    const effect = slice(src, "/* The page's free vault read", "async function build() {");
    expect(effect).toContain("a failed read just leaves the auto-pick");
    expect(effect).toContain("if (!res.ok) return;");
    expect(effect).toContain("setVaults(wave8VaultOptionsOf(data))");
    expect(effect).toContain("/* non-fatal — the server falls back to profile basics */");
  });

  it("build: decline runs nothing, 402 and 503 are named, a kit renders only from a parsed answer", () => {
    const body = slice(src, "async function build() {", "\n  return (\n    <BenchShell");
    expect(body).toContain("if (!res) { setPhase(\"idle\"); return; } // spend confirmation declined — nothing ran");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true)");
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain("const parsed = wave8MediaKitOf(data);");
    expect(body).toContain("if (!res.ok || !parsed) {");
    expect(body.indexOf("setKit(parsed)")).toBeGreaterThan(body.indexOf("if (!res.ok || !parsed)"));
    expect(body).toContain('setPhase("done")');
  });

  it("the pre-run empty renders only with no kit and no error", () => {
    expect(src).toContain("{!busy && !kit && !error && (");
    expect(src).toContain('data-testid="world-wave8-media-kit-result"');
  });
});

describe("CalendarAutofillBench — the week read is a three-phase machine", () => {
  it("loadWeek: null, non-ok and unparseable bodies are error; a slots-less object is an empty week", () => {
    const loader = slice(src, "async function loadWeek(ws: string) {", "useEffect(() => {");
    expect(loader).toContain('setLoadPhase("loading")');
    expect(loader).toContain('if (!res) { setLoadPhase("error"); return; }');
    expect(loader).toContain("if (!res.ok) throw new Error(`HTTP ${res.status}`);");
    expect(loader).toContain("const parsed = calendarSlotsOf(data);");
    expect(loader).toContain("setSlots([]); // the page's own bar: a slots-less answer is an empty week");
    expect(loader).toContain('throw new Error("bad shape");');
    expect(loader).toContain('setLoadPhase("ready")');
    expect(loader).toContain('setLoadPhase("error")');
  });

  it("render order is generating → loading → error (retry wired) → empty → slots", () => {
    const genAt = src.indexOf("{generating && <NativeLoadingState");
    const loadAt = src.indexOf('{loadPhase === "loading" && !generating && <NativeLoadingState');
    const errAt = src.indexOf('{loadPhase === "error" && (');
    const emptyAt = src.indexOf('{loadPhase === "ready" && slots.length === 0 && (');
    const slotsAt = src.indexOf('{loadPhase === "ready" && slots.length > 0 && (');
    expect(genAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(genAt);
    expect(errAt).toBeGreaterThan(loadAt);
    expect(emptyAt).toBeGreaterThan(errAt);
    expect(slotsAt).toBeGreaterThan(emptyAt);
    const errBlock = src.slice(errAt, emptyAt);
    expect(errBlock).toContain("onRetry={() => void loadWeek(weekStart)}");
  });

  it("autofill mirrors the honesty chain: decline, 402, non-ok-or-unparseable", () => {
    const body = slice(src, "async function autofill() {", "const navButtonCls =");
    expect(body).toContain("if (!res) { setGenerating(false); return; } // spend confirmation declined — nothing ran");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("const parsed = calendarSlotsOf(data);");
    expect(body).toContain("if (!res.ok || !parsed) {");
    expect(body.indexOf("setSlots(parsed)")).toBeGreaterThan(body.indexOf("if (!res.ok || !parsed)"));
  });
});
