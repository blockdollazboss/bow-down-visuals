/**
 * SponsorPipeline (wave8 page component) — honest load standard
 * (deep-pins tranche 3, batch 7). One board load: signed-out is its
 * own state (no fetch, sign-in prompt); loading spinner; a failed
 * load renders the error panel with a retry wired to the real
 * loadDeals; the empty board renders only from a successful
 * zero-read. patchDeal throws on non-ok AND on a deal-less body, so
 * stage moves and inline edits apply only the server's returned
 * deal. Create prepends only a parsed deal. The follow-up draft
 * (paid): a decline returns with nothing run, 402 is the
 * out-of-credits card message, a subject-less answer is an error —
 * the draft modal opens only from a parsed draft. Mark-paid checks
 * res AND ok AND deal before moving the card, and its posted /
 * no-value messages both derive from the server's answer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SponsorPipeline.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the board load — four states, honestly separated", () => {
  it("signed-out short-circuits; failure lands in the error state; render order holds", () => {
    const loader = slice(src, "async function loadDeals() {", "useEffect(() => {\n    loadDeals();");
    expect(loader).toContain("if (!user) {");
    expect(loader).toContain("setLoading(false);");
    expect(loader).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"wave8.sponsors.errorLoad\")));");
    expect(loader).toContain("setDeals(Array.isArray(data.deals) ? data.deals : []);");
    const loadingAt = src.indexOf("{loading ? (");
    const errorAt = src.indexOf(") : error ? (");
    const emptyAt = src.indexOf(") : deals.length === 0 && !showForm ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(src).toContain("onClick={loadDeals}");
    expect(src).toContain('t("wave8.sponsors.signInPrompt")');
  });
});

describe("the writes — the board moves only on the server's deal", () => {
  it("patchDeal throws on non-ok and on a deal-less body", () => {
    const patch = slice(src, "async function patchDeal(id: string,", "async function handleSave() {");
    expect(patch).toContain("if (!res.ok || !data.deal) throw new Error(apiErrorMessage(data, t(\"wave8.sponsors.errorUpdate\")));");
    expect(patch).toContain("return data.deal;");
  });

  it("create prepends only a parsed deal; the form error carries failures", () => {
    const save = slice(src, "async function handleSave() {", "async function moveStage(deal: Deal, dir: -1 | 1) {");
    expect(save).toContain("if (!res.ok || !data.deal) throw new Error(apiErrorMessage(data, t(\"wave8.sponsors.errorSave\")));");
    expect(save.indexOf("setDeals((prev) => [data.deal!, ...prev]);")).toBeGreaterThan(save.indexOf("if (!res.ok || !data.deal) throw"));
    expect(save).toContain("setFormError(plainErrorText(err, t(\"wave8.sponsors.errorSave\")));");
  });

  it("the follow-up draft: decline runs nothing, 402 is named, a subject-less answer is an error", () => {
    const body = slice(src, "async function handleDraftFollowup(deal: Deal) {", "/* Free: closed → paid");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirm");
    expect(body).toContain("if (res.status === 402) throw new Error(t(\"wave8.sponsors.outOfCredits\"));");
    expect(body).toContain("if (!res.ok || !data.subject) throw new Error(apiErrorMessage(data, t(\"wave8.sponsors.errorDraft\")));");
    expect(body.indexOf("setOpenDraftId(deal.id);")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.subject) throw"));
  });

  it("mark-paid moves the card only on res + ok + deal; posted derives from the answer", () => {
    const body = slice(src, "async function handleMarkPaid(deal: Deal) {", "function startEdit(deal: Deal) {");
    expect(body).toContain("if (!res || !res.ok || !data.deal) {");
    expect(body.indexOf("setDeals((prev) => prev.map((d) => (d.id === deal.id ? data.deal! : d)));")).toBeGreaterThan(
      body.indexOf("if (!res || !res.ok || !data.deal) {"),
    );
    expect(body).toContain("if (data.posted) {");
    expect(body).toContain('t("wave8.sponsors.paidNoValue")');
  });
});
