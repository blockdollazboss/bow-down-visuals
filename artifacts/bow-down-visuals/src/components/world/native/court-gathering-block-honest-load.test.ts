/**
 * CourtGatheringBlock — honest load standard (deep-pins tranche
 * 4, batch E). The Chamber slate is the collection load: non-ok
 * and unparseable answers throw into the failed state, and
 * SlateSection keeps failed-with-Retry, loading and
 * honestly-empty as three separate states in that order — a
 * failed read never paints as "nothing called". The "mine" list
 * is the one deliberate exception, pinned as written: it is a
 * documented courtesy read whose non-ok / thrown failure leaves
 * the last list standing (its own comment says so) and it never
 * dresses that as a fresh empty list. Booking validates the
 * start and the built body before any call; a non-ok answer is
 * resolved through courtGatheringError into the rail's plain
 * words and returns — the booked notice lands only after an ok
 * answer. Cancel likewise errors and returns on non-ok before
 * its cancelled notice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CourtGatheringBlock.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the slate — failed, loading and empty are three separate states", () => {
  it("loadSlate throws on non-ok and on a null parse before the slate is set", () => {
    const body = slice(src, "const loadSlate = useCallback(async () => {", "const refreshMine = useCallback(async () => {");
    expect(body).toContain("if (!res.ok) throw new Error(\"court slate\");");
    expect(body).toContain("if (parsed === null) throw new Error(\"court slate shape\");");
    expect(body.indexOf("setSlate(parsed);")).toBeGreaterThan(body.indexOf("if (parsed === null) throw"));
    expect(body).toContain("setSlateFailed(true);");
  });

  it("SlateSection renders failed+retry → loading → empty → rows, in that order", () => {
    const body = slice(src, "function SlateSection({", "  const { t, i18n } = useTranslation();\n  if (failed) {");
    expect(body).toBeDefined();
    const section = src.slice(src.indexOf("function SlateSection({"));
    expect(section.indexOf("if (failed) {")).toBeLessThan(section.indexOf("if (slate === null) {"));
    expect(section.indexOf("if (slate === null) {")).toBeLessThan(section.indexOf("if (slate.length === 0) {"));
    expect(section).toContain('data-testid="world-court-retry"');
    expect(section).toContain('t("worldCourtGathering.slateEmpty")');
  });

  it("the mine read is a documented courtesy read — a failure leaves the last list standing", () => {
    const body = slice(src, "const refreshMine = useCallback(async () => {", "useEffect(() => {\n    let cancelled = false;");
    expect(body).toContain("if (isGuest) return;");
    expect(body).toContain("if (!res.ok) return;");
    expect(body).toContain("/* The list is a courtesy read — a failure leaves the last one. */");
  });
});

describe("book and cancel — notices land only after an ok answer", () => {
  it("submit validates start and body before the call; a non-ok answer resolves to the rail's words and returns", () => {
    const body = slice(src, "const submit = async () => {", "const cancel = async (gathering: MyGathering) => {");
    expect(body).toContain("if (startsAtMs === null) {");
    expect(body.indexOf("if (startsAtMs === null) {")).toBeLessThan(body.indexOf("const res = await fetch(COURT_BOOK_PATH, {"));
    expect(body).toContain("if (!built.ok) {");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("const resolved = courtGatheringError(res.status, data);");
    expect(body.indexOf("setNotice(t(\"worldCourtGathering.booked\"")).toBeGreaterThan(body.indexOf("const resolved = courtGatheringError(res.status, data);"));
    expect(body).toContain("setError(t(\"worldCourtGathering.errors.failed\"));");
  });

  it("cancel sets the failure line and returns on non-ok before its cancelled notice", () => {
    const body = slice(src, "const cancel = async (gathering: MyGathering) => {", "return (\n    <div data-testid=\"world-court-gathering\">");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("setError(t(\"worldCourtGathering.cancelFailed\"));");
    expect(body.indexOf("setNotice(t(\"worldCourtGathering.cancelled\"")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
  });
});
