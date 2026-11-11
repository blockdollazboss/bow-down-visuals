/**
 * StageBookingBlock — honest load standard (deep-pins
 * tranche 4, batch D). The block carries two reads of
 * different weight, and the standard lands differently on
 * each — the file's own header says so:
 *
 * - THE SCREEN CATALOG is a real load: non-ok or a thrown
 *   read lands catalogFailed, whose render branch (error
 *   state + working Retry) stands BEFORE the loading line,
 *   which stands before the honestly-empty sentence — a dead
 *   catalog never reads as "no videos exist," and the copy
 *   says the live-stage choice still books without it.
 * - "MINE" IS A COURTESY READ: a non-ok answer returns
 *   silently and a thrown read is swallowed under its own
 *   comment — a failure leaves the last list standing, never
 *   wipes it to an empty slate. The section renders only
 *   when the list is non-empty, so it claims nothing it
 *   doesn't hold.
 *
 * The writes are free rails: submit validates the start time
 * and the built body before any call; a non-ok booking lands
 * the rail's resolved refusal (stageBookingError — including
 * the Front Row gate in plain words) and RETURNS, so the
 * booked notice is set only after the ok; cancel follows the
 * same shape. Guests never reach any of it — the guest branch
 * renders the pitch and the sign-in door, never the form.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StageBookingBlock.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the catalog: failed, loading, empty — in that order", () => {
  it("a non-ok read throws into catalogFailed; success records and clears it", () => {
    const load = slice(src, "const loadCatalog = useCallback", "const refreshMine = useCallback");
    expect(load).toContain('if (!res.ok) throw new Error("screen catalog");');
    expect(load).toContain("setCatalog(parseScreenCatalog(await res.json()));");
    expect(load).toContain("setCatalogFailed(false);");
    expect(load).toContain("setCatalogFailed(true);");
  });

  it("the render orders the error branch before loading before the empty sentence", () => {
    expect(src.indexOf("{catalogFailed ? (")).toBeLessThan(src.indexOf("catalog === null ? ("));
    expect(src.indexOf("catalog === null ? (")).toBeLessThan(src.indexOf("catalog.mine.length + catalog.pub.length === 0 ? ("));
    expect(src).toContain("onRetry={() => void loadCatalog()}");
    expect(src).toContain('message={t("worldStageBooking.catalogFailed")}');
    expect(src).toContain('t("worldStageBooking.catalogEmpty")');
    expect(src).toContain('t("worldStageBooking.catalogLoading")');
  });
});

describe("mine is a courtesy read: failure leaves the last list standing", () => {
  it("non-ok returns silently; a throw is swallowed under its own comment", () => {
    const mine = slice(src, "const refreshMine = useCallback", "useEffect(() => {");
    expect(mine).toContain("if (!res.ok) return;");
    expect(mine).toContain("setMine(normalizeMyShows(await res.json(), Date.now()));");
    expect(mine).toContain("/* The list is a courtesy read — a failure leaves the last one. */");
    expect(src).toContain("{mine && mine.length > 0 && (");
  });
});

describe("the writes: the booked/cancelled notices land only after the ok", () => {
  it("submit validates before the call and resolves a non-ok refusal before returning", () => {
    const submit = slice(src, "const submit = async () => {", "const cancel = async (show: MyShow) => {");
    expect(submit).toContain("if (startsAtMs === null) {");
    expect(submit).toContain("if (!built.ok) {");
    expect(submit.indexOf("if (!built.ok) {")).toBeLessThan(submit.indexOf("fetch(STAGE_BOOK_PATH"));
    expect(submit).toContain("if (!res.ok) {");
    expect(submit).toContain("const resolved = stageBookingError(res.status, data);");
    expect(submit.indexOf('setNotice(t("worldStageBooking.booked"')).toBeGreaterThan(submit.indexOf("if (!res.ok) {"));
    expect(submit).toContain('setError(t("worldStageBooking.errors.failed"));');
  });

  it("cancel lands its failure line on non-ok and its notice only after the ok", () => {
    const cancel = slice(src, "const cancel = async (show: MyShow) => {", "const pickBtn =");
    expect(cancel).toContain("if (!res.ok) {");
    expect(cancel).toContain('setError(t("worldStageBooking.cancelFailed"));');
    expect(cancel.indexOf('setNotice(t("worldStageBooking.cancelled"')).toBeGreaterThan(cancel.indexOf("if (!res.ok) {"));
  });
});

describe("guests get the pitch, never the form", () => {
  it("the guest branch returns before any member surface", () => {
    expect(src).toContain("if (isGuest) {");
    expect(src.indexOf("if (isGuest) {")).toBeLessThan(src.indexOf("const submit = async () => {"));
    expect(src).toContain('t("worldStageBooking.guestPitch")');
    expect(src).toContain("href={GUEST_SIGN_IN_HREF}");
  });
});
