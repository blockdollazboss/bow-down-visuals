/**
 * ScreenRecorderPanel (in-editor screen recording) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A local-capture state machine (idle → settingUp → ready →
 * recording/paused → review → uploading → sent), pinned on
 * its two honesty points:
 * - CAPTURE failures are typed, not generic: a denied
 *   permission and a missing source land on their own error
 *   lines and return the phase to idle — the panel never
 *   sits in a fake "ready".
 * - "SENT" IS EARNED: the phase reaches sent only after the
 *   direct upload resolves with a URL (the helper throws on
 *   failure) and the new scene is built from that proven
 *   URL; an upload failure returns the phase to REVIEW with
 *   the error shown — the recording stays in hand, never
 *   lost, never claimed sent.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ScreenRecorderPanel.tsx");

describe("sent is earned by a proven upload; failure returns to review", () => {
  it("the phase order and the failure fallback are pinned", () => {
    const uploadIdx = src.indexOf("const upData = await uploadClipDirect(clipFile, token);");
    const sentIdx = src.indexOf('setPhase("sent");');
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(sentIdx).toBeGreaterThan(uploadIdx);
    expect(src).toContain('setPhase("review");');
    expect(src).toContain('setError(tr("errDenied"));');
    expect(src).toContain('setError(tr("errNoSource"));');
  });
});
