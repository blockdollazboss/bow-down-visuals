/**
 * LiveBenches — honest load standard (deep-pins tranche 4,
 * batch A). Neither bench has a collection load — the standard
 * lands on their three paid generations (the 200-Buc Show Finder
 * hunt, its 100-Buc pitch draft, and the 75-Buc Guest Questions
 * generation), which all ride the same shape. The form gates
 * refuse before any call; a declined spend confirmation returns
 * from confirmedFetch as null and the bench returns with nothing
 * run and nothing charged; 402 is the named out-of-credits
 * ending; and results are set ONLY after the ok + parse guard —
 * a non-ok answer or an unparseable payload throws into the
 * bench's error state (NativeErrorState with a retry that
 * re-runs the same generation), never onto the screen as a
 * result. The hunt's honestly-empty ending is distinct from
 * failure by the page's own ruling, pinned in the source
 * comment: an empty result set is a SUCCESSFUL hunt that matched
 * nothing and renders the zero-match state — calling it a
 * failure would invite paying for the same hunt twice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveBenches.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("Show Finder hunt — results land only from an ok, parseable answer", () => {
  it("the form gates refuse before the paid call; a decline runs nothing", () => {
    const body = slice(src, "async function findShows() {", "async function draftPitch(index: number, opp: ShowOpportunity) {");
    expect(body).toContain('setFormError(t("shows.errorNeedLocation"));');
    expect(body).toContain('setFormError(t("shows.errorNeedTypes"));');
    expect(body).toContain('setFormError(t("shows.errorNeedGenre"));');
    expect(body.indexOf("confirmedFetch(SHOW_FINDER_PATH, {")).toBeGreaterThan(body.indexOf('setFormError(t("shows.errorNeedGenre"));'));
    expect(body).toContain("if (!res) return; // spend confirmation declined — nothing ran");
  });

  it("402 is its own ending; non-ok or unparseable throws before results are set", () => {
    const body = slice(src, "async function findShows() {", "async function draftPitch(index: number, opp: ShowOpportunity) {");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {');
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("const found = showOpportunitiesOf(data);");
    expect(body).toContain("if (!res.ok || !found) {");
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("shows.errorSearchFailed")));');
    expect(body).toContain("setResults(found.opportunities);");
    expect(body.indexOf("setResults(found.opportunities);")).toBeGreaterThan(body.indexOf("if (!res.ok || !found) {"));
    expect(body).toContain("An empty result set is a SUCCESSFUL hunt that matched");
    expect(body).toContain('setLoadError(plainErrorText(err, t("shows.errorSearchFailed")));');
  });

  it("failure renders the error state with retry; empty renders the zero-match state", () => {
    expect(src).toContain("<NativeErrorState isLight={isLight} message={loadError} onRetry={() => void findShows()} />");
    expect(src).toContain('<NativeEmptyState isLight={isLight} message={t("shows.noMatches")} />');
    expect(src).toContain("{results.length === 0 && (");
  });
});

describe("Show pitch draft — the pitch lands only from an ok, parseable answer", () => {
  it("decline clears the panel and runs nothing; 402 is its own ending", () => {
    const body = slice(src, "async function draftPitch(index: number, opp: ShowOpportunity) {", "function copyPitch() {");
    expect(body).toContain("if (!res) {");
    expect(body).toContain("return; // spend confirmation declined — nothing ran");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {');
  });

  it("non-ok or unparseable throws before the pitch is set; failure retries the draft", () => {
    const body = slice(src, "async function draftPitch(index: number, opp: ShowOpportunity) {", "function copyPitch() {");
    expect(body).toContain("const drafted = showPitchOf(data);");
    expect(body).toContain("if (!res.ok || !drafted) {");
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("shows.errorPitchFailed")));');
    expect(body).toContain("setPitch(drafted.pitch);");
    expect(body.indexOf("setPitch(drafted.pitch);")).toBeGreaterThan(body.indexOf("if (!res.ok || !drafted) {"));
    expect(body).toContain('setPitchError(plainErrorText(err, t("shows.errorPitchFailed")));');
    expect(src).toContain("<NativeErrorState isLight={isLight} message={pitchError} onRetry={() => void draftPitch(i, opp)} />");
  });
});

describe("Guest Questions — the set lands only from an ok, parseable answer", () => {
  it("the form gates refuse before the paid call; a decline runs nothing", () => {
    const body = slice(src, "async function generate() {", "function plainText(): string {");
    expect(body).toContain('setFormError(t("podcast.guestQuestions.errors.guestRequired"));');
    expect(body).toContain('setFormError(t("podcast.guestQuestions.errors.topicRequired"));');
    expect(body.indexOf("confirmedFetch(GUEST_QUESTIONS_PATH, {")).toBeGreaterThan(body.indexOf('setFormError(t("podcast.guestQuestions.errors.topicRequired"));'));
    expect(body).toContain("if (!res) return; // spend confirmation declined — nothing ran");
  });

  it("402 is its own ending; non-ok or unparseable throws before the result is set", () => {
    const body = slice(src, "async function generate() {", "function plainText(): string {");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {');
    expect(body).toContain("const parsed = guestQuestionsOf(data);");
    expect(body).toContain("if (!res.ok || !parsed) {");
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("podcast.guestQuestions.errors.generationFailed")));');
    expect(body).toContain("setResult(parsed);");
    expect(body.indexOf("setResult(parsed);")).toBeGreaterThan(body.indexOf("if (!res.ok || !parsed) {"));
    expect(body).toContain('setLoadError(plainErrorText(err, t("podcast.guestQuestions.errors.generationFailed")));');
  });

  it("before any run the bench shows the honesty note, not a fake result; failure retries", () => {
    expect(src).toContain("{!result && !loading && !loadError && (");
    expect(src).toContain('<NativeEmptyState isLight={isLight} message={t("podcast.guestQuestions.form.honestyNote")} />');
    expect(src).toContain("<NativeErrorState isLight={isLight} message={loadError} onRetry={() => void generate()} />");
  });
});
