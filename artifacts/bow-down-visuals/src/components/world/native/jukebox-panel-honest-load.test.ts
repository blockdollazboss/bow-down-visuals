/**
 * JukeboxPanel — honest load standard (deep-pins tranche 4,
 * batch A). The panel's collection load is the jukebox catalog:
 * guests never call it (the guest branch renders the sign-in
 * line); a failed read raises catalogFailed, and render order is
 * failed copy BEFORE the null/loading line BEFORE the
 * honestly-empty line — a failed catalog can never read as "the
 * catalog is empty." The listening-party writes carry the rest
 * of the standard: booking is gated twice before the call (an
 * unparseable start, then the seam's own body validation), a
 * non-ok booking lands the server's error copy and RETURNS
 * before the booked notice, and a cancel likewise errors before
 * any cancelled notice. Folding a playlist in sets the queue
 * only from a playlist that actually opened with playable
 * songs. The "my parties" read is a courtesy read: its failure
 * leaves the last list in place and never writes a fabricated
 * empty one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./JukeboxPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("catalog load — failed before loading before honestly-empty", () => {
  it("a non-ok catalog throws into catalogFailed; the catalog is set only after ok", () => {
    const body = slice(src, "const [tick, setTick] = useState(0);", "const cur = jukebox?.current ?? null;");
    expect(body).toContain('fetch("/api/world/jukebox-catalog", { headers: await authHeaders() })');
    expect(body).toContain('if (!res.ok) throw new Error("catalog");');
    expect(body).toContain("if (!cancelled) setCatalog(data.catalog);");
    expect(body).toContain("if (!cancelled) setCatalogFailed(true);");
    expect(body.indexOf("setCatalog(data.catalog)")).toBeGreaterThan(body.indexOf('if (!res.ok) throw new Error("catalog");'));
  });

  it("render order is the guest line, then failed, then loading, then empty", () => {
    const body = slice(src, 't("worldAudioDesk.putSongOnHeading")', 'catalogSection(t("worldAudioDesk.yoursSectionLabel"), catalog.mine)');
    expect(body).toContain('t("worldAudioDesk.catalogFailedLine")');
    expect(body).toContain('t("worldAudioDesk.openingCatalog")');
    expect(body).toContain('t("worldAudioDesk.catalogEmptyLine")');
    expect(body.indexOf("catalogFailed ? (")).toBeLessThan(body.indexOf("catalog === null ? ("));
    expect(body.indexOf("catalog === null ? (")).toBeLessThan(body.indexOf("catalog.mine.length + catalog.public.length === 0 ? ("));
  });
});

describe("my parties — a courtesy read that never fabricates an empty list", () => {
  it("a failed refresh returns and leaves the last list untouched", () => {
    const body = slice(src, "const refreshMine = async () => {", "useEffect(() => {\n    if (isGuest) return;\n    let cancelled = false;\n    void refreshMine();");
    expect(body).toContain('fetch("/api/world/events/mine", { headers: await authHeaders() })');
    expect(body).toContain("if (!res.ok) return;");
    expect(body).toContain("setMine(normalizeMyParties(await res.json(), Date.now()));");
    expect(body).toContain("The list is a courtesy read — a failure leaves the last one.");
    expect(body).not.toContain("setMine([])");
    expect(body.indexOf("setMine(normalizeMyParties")).toBeGreaterThan(body.indexOf("if (!res.ok) return;"));
  });
});

describe("party booking — gated before the call, notice only after ok", () => {
  it("a bad start and a seam-refused body both return before any fetch", () => {
    const body = slice(src, "const submit = async () => {", "const cancel = async (party: MyParty) => {");
    expect(body).toContain("const startsAtMs = parsePartyStartInput(startValue);");
    expect(body).toContain("if (startsAtMs === null) {");
    expect(body).toContain("if (!built.ok) {");
    expect(body).toContain("setError(built.error);");
    expect(body.indexOf('fetch("/api/world/events", {')).toBeGreaterThan(body.indexOf("if (!built.ok) {"));
  });

  it("non-ok lands the error copy and returns before the booked notice", () => {
    const body = slice(src, "const submit = async () => {", "const cancel = async (party: MyParty) => {");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("setError(listeningPartyErrorCopy(res.status, data, partyStrings));");
    expect(body).toContain('setNotice(t("worldAudioDesk.bookedNotice"');
    expect(body.indexOf('setNotice(t("worldAudioDesk.bookedNotice"')).toBeGreaterThan(body.indexOf("setError(listeningPartyErrorCopy(res.status, data, partyStrings));"));
    expect(body).toContain('setError(t("worldAudioDesk.bookingDidntLand"));');
  });

  it("a cancel errors on non-ok before any cancelled notice", () => {
    const body = slice(src, "const cancel = async (party: MyParty) => {", "const queueIndex = new Map(queue.map((q, i) => [q.id, i]));");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setError(t("worldAudioDesk.cancelFailedError"));');
    expect(body).toContain('setNotice(t("worldAudioDesk.partyCancelledNotice"');
    expect(body.indexOf('setNotice(t("worldAudioDesk.partyCancelledNotice"')).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
  });
});

describe("playlist fold — the queue is set only from playable songs", () => {
  it("an unopenable playlist and an unplayable fold both error and return first", () => {
    const body = slice(src, "const applyPlaylist = async () => {", "const partyStrings = {");
    expect(body).toContain("const got = await fetchPlaylist(pickedPlaylist);");
    expect(body).toContain("if (!got) {");
    expect(body).toContain('setError(t("worldAudioDesk.playlistOpenError"));');
    expect(body).toContain("if (fold.items.length === 0) {");
    expect(body).toContain('setError(t("worldAudioDesk.playlistNonePlayableError"));');
    expect(body).toContain("setQueue(fold.items);");
    expect(body.indexOf("setQueue(fold.items);")).toBeGreaterThan(body.indexOf("if (fold.items.length === 0) {"));
  });
});
