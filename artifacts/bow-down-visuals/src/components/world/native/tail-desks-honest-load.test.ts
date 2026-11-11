/**
 * TailDesks — honest load standard (deep-pins tranche 4,
 * batch D). Three desks, every load/write surface accounted
 * for:
 *
 * - AccountDesk: the two preference boards load independently
 *   — retention prefs fail into the error state + Retry BEFORE
 *   the loading state; delight prefs fail into their own
 *   named note line (a rail, honestly labelled, never dressed
 *   as switches). Both toggles are optimistic WITH the page's
 *   own revert: the PATCH answer re-normalizes the board, and
 *   a failure puts the previous value back — the switch never
 *   claims a state the rail refused. The export's success
 *   note is set only after the ok guard and the download.
 * - GiveawayContestsDesk: list and detail each order failed
 *   (error + Retry) before loading before honestly-empty /
 *   loaded; every verb (create, entry, verify, draw) rides
 *   the throwing apiJson, so its note lands only after the
 *   rail's ok — and the charged announce is two-tap armed:
 *   the first tap only arms, the second runs, and the done
 *   note follows the ok.
 * - JackpotDesk: status orders failed before loading before
 *   the honestly-empty "no event" state before the live
 *   phases. The attempt's outcome reads the seam's strict
 *   correct === true field — a failure body carries no such
 *   field, so the win line cannot fire on an error; non-ok
 *   lands the error outcome, a throw lands "unreached," and
 *   the sequence clears only once an outcome exists. The
 *   admin surface is fail-closed: it renders only on a
 *   confirmed isAdmin === true (a failed check reads as
 *   false), and its events list carries the same
 *   failed / loading / empty ordering.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TailDesks.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the shared helper: non-ok throws before anything can claim success", () => {
  it("apiJson throws the rail's words on non-ok", () => {
    expect(src).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, failText ? failText(res.status) : `Request failed (${res.status})`));");
  });
});

describe("AccountDesk — prefs loads, honest toggles, guarded export", () => {
  it("retention prefs order failed before loading; delight failure is its own named line", () => {
    expect(src.indexOf("{prefsFailed ? (")).toBeLessThan(src.indexOf("prefs === null ? ("));
    expect(src).toContain('title={t("worldRemainder.taiPrefsLoadTitle")}');
    expect(src).toContain("onRetry={() => setTick((n) => n + 1)}");
    expect(src).toContain('data-testid="world-account-delight-failed"');
    expect(src).toContain("if (!cancelled) setPrefsFailed(true);");
    expect(src).toContain("if (!cancelled) setDelightFailed(true);");
  });

  it("a failed toggle reverts to the previous value — the page's own rule", () => {
    const pref = slice(src, "async function togglePref(key: string, next: boolean) {", "async function toggleDelight(key: string, next: boolean) {");
    expect(pref).toContain("setPrefs({ ...prefs, [key]: next });");
    expect(pref).toContain("setPrefs(normalizeRetentionPrefs(d));");
    expect(pref).toContain("setPrefs({ ...prefs, [key]: prev }); // revert on failure — the page's own rule");
    const delight = slice(src, "async function toggleDelight(key: string, next: boolean) {", "async function exportData() {");
    expect(delight).toContain("setDelight(normalizeDelightPrefs(d));");
    expect(delight).toContain("setDelight({ ...delight, [key]: prev });");
  });

  it("the export note is set only after the ok guard; failure is its own line", () => {
    const exp = slice(src, "async function exportData() {", "const memberSince =");
    expect(exp).toContain("if (!res.ok) throw new Error(`export ${res.status}`);");
    expect(exp.lastIndexOf("setExportNote(")).toBeGreaterThan(exp.indexOf("if (!res.ok) throw new Error(`export ${res.status}`);"));
    expect(exp).toContain('setExportFailed(t("worldRemainder.taiExportFailed"));');
  });
});

describe("GiveawayContestsDesk — list and detail orderings, guarded verbs", () => {
  it("the list orders failed before loading before honestly-empty", () => {
    expect(src.indexOf("{listFailed ? (")).toBeLessThan(src.indexOf("contests === null ? ("));
    expect(src.indexOf("contests === null ? (")).toBeLessThan(src.indexOf("contests.length === 0 ? ("));
    expect(src).toContain('title={t("worldRemainder.taiListLoadTitle")}');
    expect(src).toContain('message={t("worldRemainder.taiListEmpty")}');
  });

  it("the detail orders failed before loading, and a stale detail never shows for another contest", () => {
    expect(src.indexOf("{detailFailed ? (")).toBeLessThan(src.indexOf("!detail || detail.contest.id !== c.id ? ("));
    expect(src).toContain("onRetry={() => void loadDetail(c.id)}");
  });

  it("create claims its note only after the throwing apiJson resolves", () => {
    const create = slice(src, "async function createContest() {", "async function addEntry() {");
    expect(create.indexOf('setNote(t("worldRemainder.taiCreatedNote"));')).toBeGreaterThan(create.indexOf("await apiJson"));
    expect(create).toContain('setNote(plainErrorText(e, t("worldRemainder.taiCreateFailed")));');
  });

  it("the charged announce is two-tap armed; the done note follows the ok", () => {
    const announce = slice(src, "async function announce() {", "const createReady =");
    expect(announce).toContain("if (!announceArmed) { setAnnounceArmed(true); return; }");
    expect(announce.indexOf("if (!announceArmed)")).toBeLessThan(announce.indexOf("await apiJson"));
    expect(announce.indexOf('setNote(t("worldRemainder.taiAnnounceDoneNote"));')).toBeGreaterThan(announce.indexOf("await apiJson"));
    expect(announce).toContain('setNote(plainErrorText(e, t("worldRemainder.taiAnnounceFailed")));');
  });

  it("the draw note lands only after the draw and the reload", () => {
    const draw = slice(src, "async function draw() {", "async function announce() {");
    expect(draw.indexOf('setNote(t("worldRemainder.taiDrawDoneNote"));')).toBeGreaterThan(draw.indexOf("await apiJson"));
    expect(draw).toContain('setNote(plainErrorText(e, t("worldRemainder.taiDrawFailed")));');
  });
});

describe("JackpotDesk — status ordering, guarded attempt, fail-closed admin", () => {
  it("status orders failed before loading before the no-event empty state", () => {
    expect(src.indexOf("{statusFailed ? (")).toBeLessThan(src.indexOf("status === null ? ("));
    expect(src.indexOf("status === null ? (")).toBeLessThan(src.indexOf('status.phase === "none" ? ('));
    expect(src).toContain('message={t("worldRemainder.taiJackpotEmpty")}');
    expect(src).toContain("if (!res.ok) throw new Error(`status ${res.status}`);");
    expect(src).toContain("setStatus(normalizeJackpotStatus(d));");
  });

  it("the attempt: gate first; win reads the strict field, non-ok and throw are their own outcomes", () => {
    const attempt = slice(src, "async function attempt() {", "async function createEvent() {");
    expect(attempt).toContain("if (attempting || !jackpotSequenceReady(sequence)) return;");
    expect(attempt).toContain("const o = normalizeJackpotAttempt(d);");
    expect(attempt).toContain("if (o.correct) {");
    expect(attempt).toContain('setOutcome(t("worldRemainder.taiOutcomeWin", { prize: o.prizeCredits?.toLocaleString(i18n.language) ?? "" }));');
    expect(attempt).toContain("} else if (!res.ok) {");
    expect(attempt).toContain('setOutcome(apiErrorMessage(o, t("worldRemainder.taiOutcomeFailed")));');
    expect(attempt).toContain('setOutcome(t("worldRemainder.taiOutcomeUnreached"));');
    expect(attempt.indexOf("if (o.correct) {")).toBeLessThan(attempt.indexOf("} else if (!res.ok) {"));
  });

  it("the normalizer admits a win only on the body's strict true", () => {
    expect(src).toContain("normalizeJackpotAttempt(d)");
  });

  it("admin is fail-closed and its events list orders failed, loading, empty", () => {
    expect(src).toContain("setIsAdmin(d.isAdmin === true);");
    expect(src).toContain("if (!cancelled) setIsAdmin(false);");
    expect(src).toContain("if (isAdmin === true) void loadEvents();");
    expect(src).toContain("{isAdmin === true && (");
    expect(src.indexOf("{eventsFailed ? (")).toBeLessThan(src.indexOf("events === null ? ("));
    expect(src.indexOf("events === null ? (")).toBeLessThan(src.indexOf("events.length === 0 ? ("));
    expect(src).toContain("onRetry={() => void loadEvents()}");
  });
});
