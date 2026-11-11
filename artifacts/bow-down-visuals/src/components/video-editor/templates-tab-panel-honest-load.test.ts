/**
 * TemplatesTabPanel — honest load standard (deep-pins tranche
 * 4, batch E). The catalog is the collection load: a non-ok
 * answer throws into the catalog-error panel (which carries its
 * own retry and suppresses the browse grid), the catalog and
 * the server's price are set only from the ok answer — the
 * initial price is the registry-derived constant, overwritten
 * by the rail's figure on the same load that makes the apply
 * CTA reachable — and while the catalog is null the browse
 * phase shows skeleton cards, never an empty grid dressed as a
 * loaded library. Apply is a paid job-poll flow: missing slots
 * are refused by toast before any call, a declined confirmation
 * returns to configure with nothing run, 402 lands its
 * out-of-credits line in the job error, a non-ok start throws
 * to the same error state, and polling starts only from the ok
 * answer's job id. The poll's terminal states are real: done
 * clears the interval and sets the result, failed clears it and
 * surfaces the job's own error back in configure, and even a
 * thrown poll read clears the interval and errors — no outcome
 * ever leaves the panel spinning or fakes a finished render.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TemplatesTabPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the catalog — error panel with retry, skeleton while loading, server price", () => {
  it("a non-ok catalog answer throws; catalog and price are set only from the ok answer", () => {
    const body = slice(src, "const loadCatalog = useCallback(async () => {", "useEffect(() => {\n    loadCatalog();");
    expect(body).toContain("if (!res.ok) throw new Error(t(\"videoTemplates.catalogFailed\"));");
    expect(body.indexOf("setCatalog(data.templates ?? []);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain("if (typeof data.price === \"number\") setPrice(data.price);");
    expect(body).toContain("setCatalogError(plainErrorText(err, t(\"videoTemplates.catalogFailed\")));");
    expect(src).toContain("const [price, setPrice] = useState<number>(VIDEO_TEMPLATE_APPLY_COST ?? 0);");
  });

  it("the error panel suppresses browse and carries the retry; a null catalog renders skeletons, not an empty grid", () => {
    expect(src).toContain("{phase === \"browse\" && !catalogError && (");
    const errorBlock = slice(src, "{catalogError && (", "{/* ── BROWSE ── */}");
    expect(errorBlock).toContain("onClick={loadCatalog}");
    expect(errorBlock).toContain('t("videoTemplates.retry")');
    const browse = slice(src, "{!catalog ? (", "{catalog.map((tpl) => (");
    expect(browse).toContain("animate-pulse");
    expect(src.indexOf("{!catalog ? (")).toBeLessThan(src.indexOf("{catalog.map((tpl) => ("));
  });
});

describe("apply and the poll — the result lands only on the job's done state", () => {
  it("apply refuses missing slots before the call; decline and 402 return to configure; polling starts only from an ok job id", () => {
    const body = slice(src, "async function applyTemplate() {", "/* ── Share (virality) ── */");
    expect(body.indexOf("const missing = selected.slots.filter((s) => !slotUrls[s.key]);")).toBeLessThan(
      body.indexOf("const res = await confirmedFetch(\"/api/video-template/apply\", {"),
    );
    expect(body).toContain("if (!res) {");
    expect(body).toContain("// User cancelled the credit confirmation");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setJobError(apiErrorMessage(data, t(\"videoTemplates.outOfCredits\")));");
    expect(body).toContain("if (!res.ok) {");
    expect(body.indexOf("pollJob(data.jobId);")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain("setJobError(plainErrorText(err, t(\"videoTemplates.renderFailedDefault\")));");
  });

  it("the poll: done sets the result, failed surfaces the job's error, and a thrown read stops the interval — all back in honest states", () => {
    const body = slice(src, "async function pollJob(jobId: string) {", "async function applyTemplate() {");
    expect(body).toContain("if (!res.ok) throw new Error(t(\"videoTemplates.pollFailed\"));");
    expect(body.indexOf("if (job.state === \"done\") {")).toBeLessThan(body.indexOf("} else if (job.state === \"failed\") {"));
    const done = slice(body, "if (job.state === \"done\") {", "} else if (job.state === \"failed\") {");
    expect(done).toContain("setResultUrl(job.result.url);");
    expect(done).toContain("setPhase(\"done\");");
    const failed = slice(body, "} else if (job.state === \"failed\") {", "} catch (err) {");
    expect(failed).toContain("setJobError(apiErrorMessage(job, t(\"videoTemplates.renderFailedDefault\")));");
    expect(failed).toContain("setPhase(\"configure\");");
    expect(body).toContain("setJobError(plainErrorText(err, t(\"videoTemplates.pollFailed\")));");
    expect(body.match(/clearInterval\(pollRef\.current\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("the done phase renders only with a selected template and a result URL", () => {
    expect(src).toContain("{phase === \"done\" && selected && resultUrl && (");
    expect(src).toContain('data-testid="template-result-video"');
  });
});
