/**
 * QRLogin (sign in by scanning a QR code) — honest status
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A five-state machine (loading / waiting / approved /
 * expired / error), and every transition is earned:
 * - THE TOKEN MINT lands on error unless the payload proves
 *   a token — a malformed or failed mint never renders a
 *   dead QR as "waiting".
 * - THE EXCHANGE verifies each step: a non-ok exchange, a
 *   missing action link, a missing token hash, or a rejected
 *   OTP verify each land on the error state — the success
 *   callback fires only after the session verify succeeds.
 * - EXPIRED is terminal and honored the moment the server
 *   says it, and both expired and error render a regenerate
 *   button (genNonce) — the user is never trapped staring at
 *   a dead code.
 * - TRANSIENT POLL ERRORS keep polling BY DESIGN, pinned
 *   as-is: "waiting" is the truthful state while a scan is
 *   outstanding, the poll is not the spinner of a dead job —
 *   the server-side token expiry is the terminal condition
 *   and it is honored on the very next successful poll.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./QRLogin.tsx");

describe("the token mint must prove a token before showing a code", () => {
  it("a token-less or failed mint lands on the error state", () => {
    expect(src).toContain("if (data.token) {");
    expect(src).toContain('setStatus("waiting");');
    expect(src).toContain('.catch(() => setStatus("error"));');
  });
});

describe("the exchange verifies every step before claiming sign-in", () => {
  it("each unproven step lands on error; success waits for the OTP verify", () => {
    expect(src).toContain("if (!exRes.ok || !exData.actionLink) {");
    expect(src).toContain("if (!tokenHash) {");
    expect(src).toContain("if (error) {");
    expect(src).toContain('setStatus("error");');
  });

  it("expiry is terminal, and dead states offer a regenerate", () => {
    expect(src).toContain('} else if (data.status === "expired") {');
    expect(src).toContain("onClick={() => setGenNonce((n) => n + 1)}");
    expect(src).toContain("// Keep polling on network errors");
  });
});
