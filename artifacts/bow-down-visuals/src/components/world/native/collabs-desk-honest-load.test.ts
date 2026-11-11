/**
 * CollabsDesk — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 3). The desk rides THREE independent
 * collection loads plus four writes, and already meets the standard;
 * this pin records the machines so they cannot regress:
 *
 * - MY CARD: loading (NativeLoadingState) → failed line OR the
 *   form; a failed read renders the "didn't answer" line — NOT the
 *   "no card yet" copy, which is gated on the seam's explicit
 *   "none" state after a successful read.
 * - BROWSE: failed (NativeErrorState + retry via the tick) →
 *   loading → genuine empty (NativeEmptyState) → cards, in that
 *   source order. A failed browse can never read as "no creators".
 * - REQUESTS: the identical machine on its own tick.
 * - WRITES: save / send / respond throw the server's own message on
 *   non-ok before any success note; the paid match (100 Bucs, the
 *   confirmed rail) separates a declined confirmation (nothing
 *   runs), a 402 (out-of-credits line), a non-ok (server's words),
 *   and a malformed report (shape error) — success is only claimed
 *   from a parsed report.
 * - GUESTS never trigger a load: every effect returns early and the
 *   sign-in pitch renders instead.
 *
 * NO FIX in this lane — the desk already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./CollabsDesk.tsx");

describe("my card: a failed read is its own line, never 'no card yet'", () => {
  it("the loader throws on non-ok and lands the read in the failed state", () => {
    const me = desk.slice(desk.indexOf("/* ── my card ── */"), desk.indexOf("/* ── browse ── */"));
    expect(me).toContain("if (!res.ok) throw new Error(`me ${res.status}`);");
    expect(me).toContain('if (!cancelled) setMeRead({ state: "failed" });');
    expect(me).toContain('if (read.state === "ready") setForm(profileFormFrom(read.profile));');
  });

  it("render order: loading, failed line, then the none-copy inside the loaded branch", () => {
    const loadIdx = desk.indexOf("meRead === null ? (");
    const failIdx = desk.indexOf('meRead.state === "failed" ? (');
    const noneIdx = desk.indexOf('meRead.state === "none" ? (');
    expect(loadIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeGreaterThan(loadIdx);
    expect(noneIdx).toBeGreaterThan(failIdx);
    expect(desk).toContain('t("worldSocialDesk.collabsCardFailed")');
    expect(desk).toContain('t("worldSocialDesk.collabsNoCardYet")');
  });
});

describe("browse + requests: error, loading, empty, list — in that order", () => {
  it("browse: a failed or misshapen read raises profilesFailed; retry bumps the tick", () => {
    const browse = desk.slice(desk.indexOf("/* ── browse ── */"), desk.indexOf("/* ── requests ── */"));
    expect(browse).toContain("if (!res.ok) throw new Error(`profiles ${res.status}`);");
    expect(browse).toContain('if (!parsed) throw new Error("profiles shape");');
    expect(browse).toContain("setProfilesFailed(true);");
    const errIdx = desk.indexOf("profilesFailed ? (");
    const loadIdx = desk.indexOf("profiles === null ? (", errIdx);
    const emptyIdx = desk.indexOf("profiles.length === 0 ? (", loadIdx);
    expect(errIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(errIdx);
    expect(emptyIdx).toBeGreaterThan(loadIdx);
    expect(desk).toContain("onRetry={() => setProfilesTick((n) => n + 1)}");
  });

  it("requests: the same machine on its own state + tick", () => {
    const req = desk.slice(desk.indexOf("/* ── requests ── */"), desk.indexOf("async function saveProfile()"));
    expect(req).toContain("if (!res.ok) throw new Error(`requests ${res.status}`);");
    expect(req).toContain('if (!parsed) throw new Error("requests shape");');
    expect(req).toContain("setRequestsFailed(true);");
    const errIdx = desk.indexOf("requestsFailed ? (");
    const loadIdx = desk.indexOf("requests === null ? (", errIdx);
    const emptyIdx = desk.indexOf("requests.received.length === 0 && requests.sent.length === 0 ? (", loadIdx);
    expect(errIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(errIdx);
    expect(emptyIdx).toBeGreaterThan(loadIdx);
    expect(desk).toContain("onRetry={() => setRequestsTick((n) => n + 1)}");
  });
});

describe("the writes check their answers", () => {
  it("save / send / respond surface the server's message and claim success only after ok", () => {
    const save = desk.slice(desk.indexOf("async function saveProfile()"), desk.indexOf("async function runMatch("));
    expect(save).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSocialDesk.collabsSaveFailedStatus", { status: res.status })));');
    expect(save.indexOf("if (!res.ok) throw")).toBeLessThan(save.indexOf('setProfileNote(t("worldSocialDesk.collabsSavedNote"));'));
    const send = desk.slice(desk.indexOf("async function sendRequest("), desk.indexOf("async function respond("));
    expect(send).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"worldSocialDesk.collabsSendFailedStatus\", { status: res.status })));");
    expect(send.indexOf("if (!res.ok) throw")).toBeLessThan(send.indexOf('setInboxNote(t("worldSocialDesk.collabsRequestSentNote"'));
    const respond = desk.slice(desk.indexOf("async function respond("), desk.indexOf("const myCardReady"));
    expect(respond).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSocialDesk.collabsRespondFailedStatus", { status: res.status })));');
  });

  it("the paid match separates decline, 402, non-ok and bad shape before claiming a report", () => {
    const match = desk.slice(desk.indexOf("async function runMatch("), desk.indexOf("async function sendRequest("));
    expect(match).toContain("overrideCost: COLLAB_MATCH_COST_VB,");
    expect(match).toContain("if (!res) return; // declined the confirmation — nothing charged");
    expect(match).toContain("if (res.status === 402) {");
    expect(match).toContain("setOutOfCredits(true);");
    expect(match).toContain('if (!parsed) throw new Error(t("worldSocialDesk.collabsMatchShapeError"));');
    expect(match.indexOf("if (!parsed) throw")).toBeLessThan(match.indexOf("setMatch(parsed);"));
  });

  it("guests fire no load at all — every effect returns early", () => {
    const guards = desk.split("if (isGuest) return;").length - 1;
    expect(guards).toBe(3);
    const me = desk.slice(desk.indexOf("/* ── my card ── */"), desk.indexOf("/* ── browse ── */"));
    expect(me.indexOf("if (isGuest) return;")).toBeLessThan(me.indexOf("COLLAB_PROFILE_ME_PATH"));
  });
});
