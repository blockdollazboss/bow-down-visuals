/**
 * Wave9VideoBenches (the World wave-9 video benches) — honest
 * load classification (Stack-400 C-28 components residual,
 * deep-pins tranche 2). The benches are priced generation
 * actions (confirmedFetch); the file's one collection read is
 * the camera deck, and it is a disclosed-degradation design:
 *
 * - THE CAMERA DECK READ is a free read on plain fetch ("it
 *   charges nothing, so it never rides the credit-confirm
 *   rail" — written on the code). The deck records only from an
 *   ok response that parses.
 * - ON FAILURE the bench falls back to the BUILT-IN move deck —
 *   static house data, not user data dressed as loaded — and
 *   says so on its face: the loading state renders only while
 *   neither deck nor failure has landed, and the failure state
 *   renders the deckFallback note ("you're on the built-in
 *   moves") above the fallback deck. Nothing claims the full
 *   deck arrived when it didn't.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const benches = read("./Wave9VideoBenches.tsx");

describe("the camera deck: server deck on proof, labeled built-in deck on failure", () => {
  it("the deck records only from an ok response that parses", () => {
    expect(benches).toContain("const parsed = res.ok ? wave9CameraDeckOf(data) : null;");
    expect(benches).toContain("if (parsed) setDeck(parsed);");
    expect(benches).toContain("else setDeckFailed(true);");
  });

  it("loading renders only while neither outcome has landed; failure shows its note", () => {
    expect(benches).toContain("{!deck && !deckFailed && <NativeLoadingState");
    expect(benches).toContain("{deckFailed && <p");
    expect(benches).toContain("t(`${ns}.deckFallback`)");
  });

  it("the fallback is the static built-in move list, never server data", () => {
    expect(benches).toContain("WAVE9_CAMERA_FALLBACK_MOVES.map((id) => ({");
    expect(benches).toContain("it charges\n     nothing, so it never rides the credit-confirm rail.");
  });
});
