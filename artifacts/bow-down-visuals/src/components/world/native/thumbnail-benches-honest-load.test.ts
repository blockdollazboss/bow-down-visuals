/**
 * ThumbnailBenches — honest load standard (deep-pins tranche 3,
 * batch 5). The Thumbnail Desk's pro benches. There is no collection
 * load here — the load-shaped surface is the panel-payload prefill,
 * and the honesty standard lands on the four charged runs.
 *
 * The prefill pins as the documented defensive parse: an absent,
 * garbage, wrong-kind or unknown-template payload fills NOTHING and
 * the benches open blank (parsePanelPayloadFor + getThumbnailTemplate
 * both gate it) — a handoff can never invent a prompt.
 *
 * The maker's partial-batch truth is the family's flagship pattern
 * and pins in full: a batch that stopped partway comes back NON-OK
 * with the landed variations in the error body — they render as real
 * slots beside failed slots with the refund note (thBatchNote), the
 * failed slots render as "didn't land" placeholders and are NEVER
 * filled from another slot's image (thumbnailBenchSlots), a total
 * failure on an empty bench paints a full row of failed slots with
 * the fresh-batch retry, and a re-run's failure never clears a bench
 * already holding real images. The server's replay note renders
 * verbatim when a re-ask is served the stored batch.
 *
 * Variants / CTR / improve pin as-is: decline returns, non-ok throws
 * the server's words, an empty maker answer and an unreadable CTR
 * body are their own errors, 402 on improve is named, and picking a
 * winner only marks state + writes the page's own handoff key.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ThumbnailBenches.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("prefill — a handoff can never invent a prompt", () => {
  it("the payload parses defensively and an unknown template fills nothing", () => {
    const effect = slice(src, "const payloadAppliedRef = useRef(false);", "const [faceFile, setFaceFile]");
    expect(effect).toContain('parsePanelPayloadFor("thumbnail-desk", panelPayload)');
    expect(effect).toContain('if (!payload || payload.kind !== "thumbnail-template") return;');
    expect(effect).toContain("const tpl = getThumbnailTemplate(payload.templateSlug);");
    expect(effect).toContain("if (!tpl) return;");
    expect(effect.indexOf("setPrompt(tpl.prompt)")).toBeGreaterThan(effect.indexOf("if (!tpl) return;"));
  });
});

describe("the maker — partial truth, never dressed up", () => {
  it("a stopped batch's landed variations render as real slots with the refund note", () => {
    const body = slice(src, "const runMaker = async () => {", "const runVariants = async () => {");
    expect(body).toContain("if (!res) return; // the member cancelled the credit confirmation");
    expect(body).toContain("const partial = thumbnailPartialImagesOfResponse(data);");
    expect(body).toContain("if (partial.length > 0) {");
    expect(body).toContain("setFailedCount(THUMBNAIL_BATCH_SIZE - partial.length)");
    expect(body).toContain('t("worldCreateMedia.thBatchNote"');
    expect(body.indexOf("throw new Error(apiErrorMessage(data,")).toBeGreaterThan(
      body.indexOf("if (partial.length > 0) {"),
    );
  });

  it("an ok answer with zero images is an error; the replay note is captured verbatim", () => {
    const body = slice(src, "const runMaker = async () => {", "const runVariants = async () => {");
    expect(body).toContain("const parsed = thumbnailImagesOfResponse(data);");
    expect(body).toContain('if (parsed.length === 0) throw new Error(t("worldCreateMedia.thErrNoImages"));');
    expect(body).toContain("setReplayNote(thumbnailReplayNoteOfResponse(data))");
    expect(src).toContain('data-testid="world-thumbnail-replay-note"');
  });

  it("a total failure paints failed slots only on an empty bench — a re-run never clears real images", () => {
    const body = slice(src, "const runMaker = async () => {", "const runVariants = async () => {");
    expect(body).toContain("if (!landedThisRun && images.length === 0) setFailedCount(THUMBNAIL_BATCH_SIZE);");
    expect(src).toContain('data-testid="world-thumbnail-failed-slot"');
    expect(src).toContain('t("worldCreateMedia.thDidntLand")');
    expect(src).toContain('data-testid="world-thumbnail-fresh-batch"');
    expect(src).toContain("const slots = thumbnailBenchSlots(images);");
  });
});

describe("variants / CTR / improve — the same checked pattern", () => {
  it("variants: decline returns, non-ok throws, the source freezes at run time", () => {
    const body = slice(src, "const runVariants = async () => {", "const pickWinner = (url: string) => {");
    expect(body).toContain("if (!res) return; // the member cancelled the credit confirmation");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreateMedia.thErrVariants")));');
    expect(body.indexOf("setVariants(thumbnailVariantsOfResponse(data))")).toBeGreaterThan(
      body.indexOf("if (!res.ok) throw"),
    );
    expect(body).toContain("setVariantsSource(selectedUrl);");
  });

  it("CTR: an unreadable prediction body is its own error, never a fake winner", () => {
    const body = slice(src, "const runCtr = async () => {", "const applySuggestions = async (index: number) => {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreateMedia.thErrPredictionLanded")));');
    expect(body).toContain("const parsed = ctrPredictionOfResponse(data);");
    expect(body).toContain('if (!parsed) throw new Error(t("worldCreateMedia.thErrPredictionUnreadable"));');
    expect(body.indexOf("setCtr(parsed)")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(src).toContain('t("worldCreateMedia.thDisclaimerFallback")');
  });

  it("improve: 402 is named, a url-less answer is an error, the winner rides the handoff key", () => {
    const body = slice(src, "const applySuggestions = async (index: number) => {", "\n  return (");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("const url = thumbnailImprovedUrlOfResponse(data);");
    expect(body).toContain('if (!url) throw new Error(t("worldCreateMedia.thErrImprovedNoImage"));');
    expect(body.indexOf("setImprovedUrls((prev) => ({ ...prev, [index]: url }))")).toBeGreaterThan(
      body.indexOf("if (!url) throw"),
    );
    const pick = slice(src, "const pickWinner = (url: string) => {", "const runCtr = async () => {");
    expect(pick).toContain("localStorage.setItem(THUMBNAIL_WINNER_HANDOFF_KEY, url);");
    expect(pick).toContain("/* storage unavailable — the winner still shows on the bench */");
  });
});
