/**
 * GamersDesk (World native) — honest load standard
 * (deep-pins tranche 5). No server list load: the desk
 * opens on the page's SAMPLE pack, and the sample is
 * badged as a sample (gamSampleBadge on every pack block)
 * until the first real generation lands — placeholder
 * content is labelled, never dressed as the member's own
 * generation. The generate follows the house law: cancel
 * is silent, out-of-credits is its own state, and the pack
 * is replaced only by a body normalized under res.ok —
 * anything else throws the server's words and the sample
 * (still badged) stays. The copy button's failure is
 * honest too: no copied tick, the line stays to copy by
 * hand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GamersDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the sample — labelled until a real generation replaces it", () => {
  it("the desk boots on the sample with isSample true, and every pack block badges it", () => {
    expect(src).toContain("const [pack, setPack] = useState<GamersIdeaPack>(GAMERS_SAMPLE_PACK);");
    expect(src).toContain("const [isSample, setIsSample] = useState(true);");
    expect(src).toContain("{isSample && (");
    expect(src).toContain('{t("worldDeskRemainder.gamSampleBadge")}');
    expect(src).toContain("{/* the pack — sample until the first real generation lands */}");
  });

  it("generate: cancel silent; out-of-credits own state; the pack swaps only past the normalize gate", () => {
    const body = slice(src, "async function generate() {", "return (");
    expect(body).toContain("if (!res) return; /* the member cancelled the credit confirmation — nothing was sent or charged */");
    expect(body).toContain("if (gamersOutOfCredits(res.status, data)) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("const normalized = res.ok ? normalizeGamersPack(data) : null;");
    expect(body).toContain('if (!normalized) throw new Error(apiErrorMessage(data, t("worldDeskRemainder.gamGenerationFailed")));');
    expect(body).toContain("setPack(normalized);");
    expect(body).toContain("setIsSample(false);");
    expect(body.indexOf('if (!normalized) throw new Error(')).toBeLessThan(body.indexOf("setPack(normalized);"));
    expect(body.indexOf("setPack(normalized);")).toBeLessThan(body.indexOf("setIsSample(false);"));
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain("setError(plainErrorText(e,");
    expect(catchPart).not.toContain("setPack");
    expect(catchPart).not.toContain("setIsSample");
  });

  it("the copy tick is set only after the clipboard write resolves", () => {
    const body = slice(src, "await navigator.clipboard.writeText(text);", "className={`shrink-0 rounded-full");
    expect(body).toContain("setCopied(true);");
    expect(src.indexOf("await navigator.clipboard.writeText(text);")).toBeLessThan(src.indexOf("setCopied(true);"));
  });
});
