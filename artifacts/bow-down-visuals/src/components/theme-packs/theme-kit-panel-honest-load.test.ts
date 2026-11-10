/**
 * ThemeKitPanel (+ CreatorPacksSection) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 1).
 *
 * THE KIT PANEL's saved-mix read is the C-30 distinction, stated in
 * the file: fetchSavedMix collapses "no mix saved" ({}) and "the
 * read failed" (null) — and a failed read used to ship the DEFAULT
 * mix as if it were the member's own. The panel now tracks the
 * failure apart (savedMixLoadFailed), renders the notice ("Your
 * saved choices couldn't be loaded. The kit may not match your
 * latest picks.") until a read succeeds — downloads included — and
 * a download re-reads and re-flags before building. The kit
 * actions (download / save / reset) each throw on a non-ok
 * response into the panel's error state; done is recorded only on
 * success.
 *
 * THE CREATOR PACKS SECTION's store list is quiet-by-absence (it
 * renders only when a load brought packs; there is no empty copy
 * for it to fake), and its create/buy actions surface failures
 * with the server's message. FIXED IN THIS LANE: create-then-
 * publish never checked the publish response, so a failed publish
 * was still announced as "Your pack is live in the creator store
 * below." The publish now has to be ok before the live message can
 * print; on failure the message says the pack saved as a draft and
 * isn't live yet — which is the world that actually landed.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./ThemeKitPanel.tsx");

describe("the saved-mix read — failed is never silently the default mix", () => {
  it("the read returns null on failure and the saved object on success — distinct answers", () => {
    expect(panel).toContain("if (!res.ok) return null;");
    expect(panel).toContain("return json.mix ?? {};");
  });

  it("the failure is tracked apart and disclosed until a read succeeds", () => {
    expect(panel).toContain("const [savedMixLoadFailed, setSavedMixLoadFailed] = useState(false);");
    expect(panel).toContain("{savedMixLoadFailed ? (");
    expect(panel).toContain("Your saved choices couldn't be loaded. The kit may not match your latest picks.");
  });

  it("a download re-reads the saved mix and re-flags before building", () => {
    expect(panel).toContain("if (saved === null) setSavedMixLoadFailed(true);");
    expect(panel).toContain("else setSavedMixLoadFailed(false);");
  });

  it("the kit actions throw on non-ok into the error state", () => {
    expect(panel).toContain('throw new Error(apiErrorMessage(json, "That download didn\'t build — try again in a moment."));');
    expect(panel).toContain("if (!res.ok) throw new Error(`save failed (${res.status})`);");
    expect(panel).toContain("if (!res.ok) throw new Error(`reset failed (${res.status})`);");
  });
});

describe("the creator packs section — quiet list, truthful actions", () => {
  it("the store list renders only when a load brought packs — no empty copy exists", () => {
    expect(panel).toContain("{packs.length > 0 ? (");
    expect(panel).toContain("if (!res.ok) return;");
  });

  it("create throws the server's message when the pack wasn't created", () => {
    expect(panel).toContain('if (!res.ok || !json?.id) throw new Error(apiErrorMessage(json, "That design hit a snag."));');
  });

  it("FIXED: the publish must be ok before anything claims the pack is live", () => {
    expect(panel).toContain('if (!pub.ok) throw new Error("Your pack saved as a draft below, but publishing hit a snag — it isn\'t live yet.");');
    expect(panel.indexOf("if (!pub.ok) throw")).toBeLessThan(
      panel.indexOf('"Your pack is live in the creator store below."'),
    );
  });

  it("buy throws the server's message on a refused purchase", () => {
    expect(panel).toContain('if (!res.ok) throw new Error(apiErrorMessage(json, "That purchase hit a snag."));');
  });
});
