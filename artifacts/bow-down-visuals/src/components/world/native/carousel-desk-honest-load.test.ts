/**
 * CarouselDesk (World native) — honest load standard
 * (deep-pins tranche 5). The slides are local state (built
 * on the desk), so there is no list load to fake; the
 * pinned surface is the paid export: a declined
 * confirmation returns silently; 402 is the out-of-credits
 * state; a non-ok answer notes the server's message; and
 * the done line is set only AFTER the render+download loop
 * has actually produced every slide PNG past the ok gate —
 * a mid-loop failure lands in the catch as the export
 * failure note, never as the done line. The hub asset is
 * registered only on that same completed path.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CarouselDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the export — done is the last line of a completed loop", () => {
  it("declined silent; 402 out; !ok notes the server's words; the done line sits after the download loop", () => {
    const body = slice(src, "const handleExport = async () => {", "const slideBg =");
    expect(body).toContain("if (!res) return; // spend confirmation declined — nothing ran");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setNote(apiErrorMessage(data as { message?: string; error?: string }, t("carouselMaker.exportFailed")));');
    expect(body).toContain("await downloadCarouselSlide(canvas, `carousel-slide-${i + 1}.png`, disclosure);");
    expect(body).toContain('setDoneLine(t("carouselMaker.exportDone", { count: slides.length }));');
    expect(body.indexOf("if (!res.ok) {")).toBeLessThan(
      body.indexOf("await downloadCarouselSlide(canvas,"),
    );
    expect(body.indexOf("await downloadCarouselSlide(canvas,")).toBeLessThan(
      body.indexOf('setDoneLine(t("carouselMaker.exportDone"'),
    );
    const catchPart = slice(body, "} catch (err) {", "} finally {");
    expect(catchPart).toContain('setNote(plainErrorText(err, t("carouselMaker.exportFailed")));');
    expect(catchPart).not.toContain("setDoneLine");
  });

  it("the export refuses to start with nothing filled — no charge for an empty deck", () => {
    expect(src).toContain("if (exporting || filledCount === 0) return;");
  });
});
