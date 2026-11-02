/**
 * error-truth-5-guard.test.ts — the error-truth guard, round 5 (stack1300).
 *
 * Rounds 1–4 pinned the translator, the toast funnel, failure-vs-empty
 * separation, and the newest surfaces' failure lines. This round closes the
 * mutation family on the pitch / press surfaces: a delete or status update
 * the server REJECTS must say so, in house words, through the surface's own
 * error line — never vanish behind `catch { /* non-fatal *\/ }` while the
 * member believes the thing is gone, and never remove the row locally on an
 * unconfirmed answer.
 *
 * Same harness constraint as rounds 1–4 (vitest node environment, no DOM):
 * the pins assert the source shapes that produce the truthful renders.
 * Non-English strings added this round are agent-drafted — UNREVIEWED.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Slice of a source file between two markers (start inclusive). */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `start marker not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b === -1 ? undefined : b);
}

describe("press-kit page — a refused kit delete is spoken, not swallowed", () => {
  const src = read("pages/press-kit.tsx");
  const del = between(src, "async function handleDelete()", "function copyLink()");

  it("translates the server's refusal through apiErrorMessage with the house fallback", () => {
    expect(del).toMatch(/apiErrorMessage\(data, t\("press-kit\.errors\.deleteFailed"\)\)/);
    expect(del).toMatch(/setError\(/);
  });

  it("names a network failure as a network failure", () => {
    expect(del).toMatch(/setError\(t\("press-kit\.errors\.network"\)\)/);
    expect(del).not.toMatch(/catch \{ \/\* non-fatal \*\/ \}/);
  });

  it("only removes the kit locally after an ok answer", () => {
    expect(del.indexOf("if (!res.ok)")).toBeLessThan(del.indexOf("setKits("));
  });
});

describe("PressReleasePanel — a refused release delete is spoken", () => {
  const src = read("components/PressReleasePanel.tsx");
  const del = between(src, "async function handleDeleteRelease(id: string)", "return (");

  it("translates the server's refusal through apiErrorMessage", () => {
    expect(del).toMatch(/apiErrorMessage\(data, p\("errors\.deleteFailed"\)\)/);
    expect(del).toMatch(/setError\(/);
  });

  it("names a network failure as a network failure", () => {
    expect(del).toMatch(/setError\(p\("errors\.network"\)\)/);
    expect(del).not.toMatch(/catch \{ \/\* non-fatal \*\/ \}/);
  });

  it("only drops the release from the kit after an ok answer", () => {
    expect(del.indexOf("if (!res.ok)")).toBeLessThan(del.indexOf("onKitUpdated("));
  });
});

describe("SyncTab — sheet, brief and pitch mutations fail out loud", () => {
  const src = read("components/sync-pitch/SyncTab.tsx");
  const sheet = between(src, "async function deleteSheet(id: string)", "function shareUrlFor");
  const brief = between(src, "async function deleteBrief(id: string)", "async function loadMatches");
  const upd = between(src, "async function updatePitchStatus(id: string, status: string)", "async function deletePitch");
  const pitch = between(src, "async function deletePitch(id: string)", "/* Handoff:");

  it("deleteSheet throws the translated refusal and speaks it", () => {
    expect(sheet).toMatch(/if \(!res\.ok\) throw new Error\(apiErrorMessage\(data, t\("syncPitch\.deleteFailed"\)\)\)/);
    expect(sheet).toMatch(/setError\(plainErrorText\(err, t\("syncPitch\.deleteFailed"\)\)\)/);
    expect(sheet).not.toMatch(/non-fatal/);
  });

  it("deleteBrief throws the translated refusal and speaks it", () => {
    expect(brief).toMatch(/if \(!res\.ok\) throw new Error\(apiErrorMessage\(data, t\("syncPitch\.deleteFailed"\)\)\)/);
    expect(brief).toMatch(/setError\(plainErrorText\(err, t\("syncPitch\.deleteFailed"\)\)\)/);
    expect(brief).not.toMatch(/non-fatal/);
  });

  it("updatePitchStatus speaks its failure instead of swallowing it", () => {
    expect(upd).toMatch(/setError\(plainErrorText\(err, t\("syncPitch\.updateFailed"\)\)\)/);
    expect(upd).not.toMatch(/non-fatal/);
  });

  it("deletePitch throws the translated refusal and speaks it", () => {
    expect(pitch).toMatch(/if \(!res\.ok\) throw new Error\(apiErrorMessage\(data, t\("syncPitch\.deleteFailed"\)\)\)/);
    expect(pitch).toMatch(/setError\(plainErrorText\(err, t\("syncPitch\.deleteFailed"\)\)\)/);
    expect(pitch).not.toMatch(/non-fatal/);
  });
});

describe("label-pitch playlists tab — deadline and pitch mutations fail out loud", () => {
  const src = read("pages/label-pitch.tsx");
  const updDl = between(src, "async function updateDeadlineStatus(id: string, status: string)", "async function deleteDeadline");
  const delDl = between(src, "async function deleteDeadline(id: string)", "function packetAsText");
  const upd = between(src, "async function updatePitchStatus(id: string, status: string)", "async function deletePitch");
  const pitch = between(src, "async function deletePitch(id: string)", "function addCuratorToTracker");

  it("updateDeadlineStatus throws the translated refusal and speaks it", () => {
    expect(updDl).toMatch(/apiErrorMessage\(data, t\("playlistPitch\.deadlineUpdateFailed"\)\)/);
    expect(updDl).toMatch(/setError\(plainErrorText\(err, t\("playlistPitch\.deadlineUpdateFailed"\)\)\)/);
    expect(updDl).not.toMatch(/non-fatal/);
  });

  it("deleteDeadline throws the translated refusal and speaks it", () => {
    expect(delDl).toMatch(/apiErrorMessage\(data, t\("playlistPitch\.deadlineDeleteFailed"\)\)/);
    expect(delDl).toMatch(/setError\(plainErrorText\(err, t\("playlistPitch\.deadlineDeleteFailed"\)\)\)/);
    expect(delDl).not.toMatch(/non-fatal/);
  });

  it("updatePitchStatus speaks its failure instead of swallowing it", () => {
    expect(upd).toMatch(/setError\(plainErrorText\(err, t\("playlistPitch\.updateFailed"\)\)\)/);
    expect(upd).not.toMatch(/non-fatal/);
  });

  it("deletePitch throws the translated refusal and speaks it", () => {
    expect(pitch).toMatch(/apiErrorMessage\(data, t\("playlistPitch\.deleteFailed"\)\)/);
    expect(pitch).toMatch(/setError\(plainErrorText\(err, t\("playlistPitch\.deleteFailed"\)\)\)/);
    expect(pitch).not.toMatch(/non-fatal/);
  });
});

describe("ContentIdMonitor — detection update and delete failures reach the error line", () => {
  const src = read("components/analytics-hub/ContentIdMonitor.tsx");
  const cycle = between(src, "async function cycleDetectionStatus(d: Detection)", "async function removeDetection");
  const remove = between(src, "async function removeDetection(d: Detection)", "async function logRevenue");

  it("cycleDetectionStatus speaks through plainErrorText", () => {
    expect(cycle).toMatch(/setDetError\(plainErrorText\(err, "Couldn't update the detection\."\)\)/);
    expect(cycle).not.toMatch(/list stays as-is/);
  });

  it("removeDetection speaks through plainErrorText", () => {
    expect(remove).toMatch(/setDetError\(plainErrorText\(err, "Couldn't delete the detection\."\)\)/);
    expect(remove).not.toMatch(/catch \{\s*\/\* non-fatal \*\//);
  });
});

describe("LutImportSection — a refused LUT delete tells the member", () => {
  const src = read("components/editor/sections/LutImportSection.tsx");
  const del = between(src, "async function handleDeleteSaved(id: string)", "async function handlePreview()");

  it("toasts the failure on both the not-ok and the thrown paths", () => {
    const toasts = del.match(/Couldn't delete that LUT — try again\./g) ?? [];
    expect(toasts.length).toBe(2);
    expect(del).toMatch(/variant: "destructive"/);
    expect(del).not.toMatch(/catch \{ \/\* non-fatal \*\/ \}/);
  });

  it("only removes the LUT locally on the ok path", () => {
    expect(del.indexOf('toast({ title: "LUT deleted" })')).toBeGreaterThan(-1);
    expect(del.indexOf("setMyLuts(")).toBeLessThan(del.indexOf('toast({ title: "LUT deleted" })'));
  });
});

describe("round-5 locale keys — present in all ten catalogs", () => {
  const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"];
  const get = (o: Record<string, unknown>, path: string) =>
    path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);

  it.each(LOCALES)("%s carries every round-5 key", (loc) => {
    const j = JSON.parse(read(`locales/${loc}.json`)) as Record<string, unknown>;
    for (const key of [
      "press-kit.errors.deleteFailed",
      "press-kit.pressRelease.errors.deleteFailed",
      "syncPitch.deleteFailed",
      "playlistPitch.deadlineUpdateFailed",
      "playlistPitch.deadlineDeleteFailed",
      "playlistPitch.deleteFailed",
    ]) {
      expect(typeof get(j, key), `${loc} missing ${key}`).toBe("string");
    }
  });
});
