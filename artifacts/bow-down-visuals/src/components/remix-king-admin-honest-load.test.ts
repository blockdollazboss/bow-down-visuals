/**
 * RemixKingAdmin — honest load standard (deep-pins tranche 3,
 * batch 4). The admin bench for the monthly Remix the King event.
 *
 * The events load renders in the house order — a loading spinner,
 * then the error card with a Try again wired to the real reload
 * (the retryNonce re-runs the load effect), then the honest empty
 * ("no events" copy) only on a successful read with zero bundles,
 * then the list. The loader treats non-ok AND an unparseable body
 * identically: the seam parse runs only on ok, any other outcome is
 * loadError — a failed read can never dress up as an empty bench.
 *
 * The bench's honesty discipline is structural (its header comment:
 * "The bench never offers a move the rail would refuse"): status
 * buttons come from the rail's own transition table, the splits
 * editor validates with the published-splits contract (unique
 * roles, winner required, sum exactly 100) and create/save REFUSE
 * an invalid draft before any call, the crown is offered only while
 * judging and only behind a confirm, and cancelling — the one
 * irreversible move — goes through a confirm too.
 *
 * Writes pin as-is: create / save-draft / status / shortlist /
 * crown / split-payments all branch on res.ok — the success message
 * and the reload happen only in the ok arm; the else arm surfaces
 * the rail's own error words (railMessage) into actionError, and a
 * thrown fetch lands in the same line. No success is ever claimed
 * over a failed write.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./RemixKingAdmin.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — failure is the error card, never an empty bench", () => {
  it("the loader parses only on ok; every other outcome is loadError", () => {
    const loader = slice(src, "const load = useCallback(async () => {", "useEffect(() => { void load(); }");
    expect(loader).toContain('fetch("/api/admin/remix-king/events", { headers: await authHeaders() })');
    expect(loader).toContain("const parsed = res.ok ? parseRemixAdminEvents(await res.json()) : null;");
    expect(loader).toContain("if (parsed) {");
    expect(loader).toContain("} else {");
    expect(loader).toContain("setLoadError(true)");
    expect(loader.indexOf("setBundles(parsed)")).toBeGreaterThan(loader.indexOf("if (parsed) {"));
    expect(loader).toContain("setLoading(false)");
  });

  it("render order is loading → error → empty → list, retry re-runs the load effect", () => {
    const loadAt = src.indexOf("{loading ? (");
    const errAt = src.indexOf(") : loadError ? (");
    const emptyAt = src.indexOf(") : bundles.length === 0 ? (");
    const listAt = src.indexOf("bundles.map((bundle)");
    expect(loadAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadAt);
    expect(emptyAt).toBeGreaterThan(errAt);
    expect(listAt).toBeGreaterThan(emptyAt);
    expect(src).toContain('t("admin.remixKing.empty")');
    expect(src).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(src).toContain("}, [load, retryNonce]);");
  });
});

describe("the bench never offers a move the rail would refuse", () => {
  it("status buttons come from the rail's transition table; cancel goes through a confirm", () => {
    expect(src).toContain("const targets = remixStatusTargets(ev.status);");
    expect(src).toContain('data-testid="remix-cancel-confirm"');
    expect(src).toContain('onClick={() => void moveStatus(bundle, "cancelled")}');
  });

  it("the crown is offered only while judging, and only behind a confirm", () => {
    expect(src).toContain("remixWinnerAvailable(ev) && entry.status !== \"winner\"");
    expect(src).toContain('data-testid="remix-crown-confirm"');
    expect(src).toContain("onClick={() => void crown(bundle, entry.id)}");
    expect(src).toContain("remixShortlistAvailable(entry)");
  });

  it("create and save REFUSE an invalid splits draft before any call", () => {
    const create = slice(src, "const createEvent = async () => {", "const saveDraft =");
    expect(create).toContain("if (splitDraftError(createDraft.splits)) {");
    expect(create.indexOf('fetch("/api/admin/remix-king/events", {')).toBeGreaterThan(
      create.indexOf("if (splitDraftError(createDraft.splits)) {"),
    );
    const save = slice(src, "const saveDraft = async (bundle: RemixEventBundle) => {", "const moveStatus =");
    expect(save).toContain("if (splitDraftError(draft.splits)) {");
  });
});

describe("writes — the success message and reload live only in the ok arm", () => {
  it("create: ok sets the created message + reloads; else surfaces the rail's words", () => {
    const body = slice(src, "const createEvent = async () => {", "const saveDraft =");
    expect(body).toContain("if (res.ok) {");
    expect(body).toContain('setCreateMsg(t("admin.remixKing.createdMsg"');
    expect(body).toContain("await load();");
    expect(body).toContain('setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));');
  });

  it("status / crown / pay follow the same ok/else discipline", () => {
    const status = slice(src, "const moveStatus = async (", "const toggleShortlist =");
    expect(status).toContain("if (res.ok) {");
    expect(status).toContain("setActionError((await railMessage(res)) ??");
    const crownBody = slice(src, "const crown = async (", "const paySplits =");
    expect(crownBody).toContain("if (res.ok) {");
    expect(crownBody).toContain('setEventMsg((m) => ({ ...m, [bundle.event.id]: t("admin.remixKing.crownedMsg") }))');
    expect(crownBody).toContain("setActionError((await railMessage(res)) ??");
    const pay = slice(src, "const paySplits = async (", "const eventFields = (");
    expect(pay).toContain("if (!/^\\d{4}-(0[1-9]|1[0-2])$/.test(draft.period)");
    expect(pay).toContain("if (res.ok) {");
    expect(pay).toContain('t("admin.remixKing.payDone"');
    expect(pay).toContain("setActionError((await railMessage(res)) ??");
  });

  it("shortlist reloads only on ok; a thrown fetch lands in the same error line", () => {
    const body = slice(src, "const toggleShortlist = async (", "const crown = async (");
    expect(body).toContain("if (res.ok) await load();");
    expect(body).toContain('else setActionError((await railMessage(res)) ?? t("admin.remixKing.actionError"));');
    expect(body).toContain('setActionError(t("admin.remixKing.actionError"));');
  });
});
