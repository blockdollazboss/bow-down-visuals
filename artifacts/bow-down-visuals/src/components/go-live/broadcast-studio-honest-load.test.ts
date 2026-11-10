/**
 * BroadcastStudio — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 2). The studio is a broadcast control
 * surface, not a collection list: its network reads are single-record
 * probes and polls, and its writes are stream actions. This pin
 * covers every load family in the file:
 *
 * - PRE-FLIGHT (loadStatus): the engine status and the Discord
 *   status are recorded ONLY on ok responses. A failed probe leaves
 *   `configured` null, so the "Live streaming isn't switched on yet"
 *   banner — gated on configured === false — can never be painted by
 *   a failure, and the leftover-stream banner renders only from a
 *   proven live_stream payload. Discord readiness only gates the
 *   optional announce action's visibility; no "not linked" claim is
 *   derived from a failed probe.
 * - SETUP PREFILL (/api/live-streams/mine): best-effort by design —
 *   a non-ok or thrown read returns early and the form keeps its
 *   blank default, exactly the pre-feature behavior; nothing
 *   renders as a list here.
 * - LIVE POLL: viewer count / tickets sold record only on ok; a
 *   failed poll keeps the last truthful figures and the next poll
 *   retries.
 * - NOW PLAYING: the DJ library and channel profile record only on
 *   ok; with no catalog or no truthful artist name the reporter is
 *   never created — the overlay is told nothing rather than
 *   something unproven.
 * - VOD WATCH + UPLOAD: the saved note lands only on a proven
 *   vod_url (or the site's own not_saved verdict → failed); a
 *   timed-out watch says "saving", never "saved". The upload chain
 *   throws on any non-ok step and only then records saved.
 *
 * FINDING + FIX IN THIS LANE: endLeftover awaited the end-stream
 * POST and then unconditionally cleared the banner and toasted
 * "Stream ended" — the response was never checked, so a 500 would
 * have announced a stream closed that is still marked live. It now
 * throws on a non-ok response into the existing "Couldn't end it"
 * catch, and the banner + success toast happen only on ok.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const studio = read("./BroadcastStudio.tsx");

const loadStatus = studio.slice(
  studio.indexOf("const loadStatus = useCallback"),
  studio.indexOf("useEffect(() => {\n    WhipTransport.api.getAccessToken"),
);
const endLeftover = studio.slice(
  studio.indexOf("async function endLeftover()"),
  studio.indexOf("async function announce("),
);
const poll = studio.slice(
  studio.indexOf("const poll = setInterval(async () => {"),
  studio.indexOf("}, 10_000);"),
);

describe("pre-flight: probes record only on ok, so failure paints nothing", () => {
  it("engine status records configured/transport/leftover only inside the ok branch", () => {
    expect(loadStatus).toContain('const res = await fetch("/api/live-streams/status", { headers });');
    expect(loadStatus).toContain("if (res.ok) {");
    expect(loadStatus.indexOf("if (res.ok) {")).toBeLessThan(loadStatus.indexOf("setConfigured(d.configured);"));
    expect(loadStatus.indexOf("if (res.ok) {")).toBeLessThan(loadStatus.indexOf("setLeftover(d.live_stream);"));
  });

  it("the not-switched-on banner is gated on a proven false, never on a null probe", () => {
    expect(studio).toContain("const [configured, setConfigured] = useState<boolean | null>(null);");
    expect(studio).toContain("{configured === false && (");
    expect(studio).toContain("Live streaming isn't switched on yet.");
  });

  it("the leftover banner renders only from the proven live_stream payload", () => {
    expect(studio).toContain("{leftover && (");
    expect(studio).toContain("A stream is still marked live:");
  });

  it("discord readiness records only on ok and merely gates the announce action", () => {
    expect(loadStatus).toContain('const dRes = await fetch("/api/discord/status", { headers });');
    expect(loadStatus).toContain("if (dRes.ok) {");
    expect(loadStatus.indexOf("if (dRes.ok) {")).toBeLessThan(loadStatus.indexOf("setDiscordReady(d.configured);"));
    expect(studio).toContain("{discordReady && (phase === \"live\" || recordNote !== null) && (");
  });

  it("a thrown probe is best-effort silence — the Go Live action reports its own errors", () => {
    expect(loadStatus).toContain("/* pre-flight is best-effort; Go Live reports its own errors */");
  });
});

describe("setup prefill: a failed read leaves the historical blank form", () => {
  it("the mine read returns before parsing on a non-ok response", () => {
    expect(studio).toContain('const res = await fetch("/api/live-streams/mine", { headers });');
    expect(studio).toContain("if (!res.ok) return;");
    expect(studio.indexOf("if (!res.ok) return;")).toBeLessThan(studio.indexOf("lastStreamSetup(d.streams)"));
  });

  it("rows still marked live are skipped by the setup picker", () => {
    expect(studio).toContain("rows still marked live are skipped (see studio-setup.ts)");
  });
});

describe("the live poll keeps the last truthful figures on failure", () => {
  it("viewer count and tickets record only inside the ok branch", () => {
    expect(poll).toContain("if (res.ok) {");
    expect(poll.indexOf("if (res.ok) {")).toBeLessThan(poll.indexOf("setViewerCount(d.stream.viewer_count);"));
  });

  it("a thrown poll simply waits for the next tick", () => {
    expect(poll).toContain("/* the next poll retries */");
  });
});

describe("now playing reports nothing it cannot swear to", () => {
  it("catalog and artist record only on ok responses", () => {
    expect(studio).toContain("if (libRes.ok) catalog = parseDjLibrary(await libRes.json());");
    expect(studio).toContain("if (profRes.ok) {");
  });

  it("with no catalog or no truthful name, the reporter is never created", () => {
    expect(studio).toContain("if (cancelled || !artist || catalog.length === 0) return;");
    expect(studio.indexOf("if (cancelled || !artist || catalog.length === 0) return;")).toBeLessThan(
      studio.indexOf("reporter = createNowPlayingReporter("),
    );
  });
});

describe("the replay note is earned, never guessed", () => {
  it("the server-recording watch records saved only on a proven vod_url", () => {
    expect(studio).toContain("if (d.stream.vod_url) {");
    expect(studio).toContain('setRecordNote("saved");');
    expect(studio).toContain('if (site?.vod_state === "not_saved") {');
    expect(studio).toContain('setRecordNote("failed");');
  });

  it("a watch window that runs out says saving, not saved", () => {
    expect(studio).toContain('setRecordNote("saving");');
  });

  it("the upload chain throws on every non-ok step before claiming saved", () => {
    const upload = studio.slice(
      studio.indexOf("if (recording && streamId && user) {"),
      studio.indexOf("} else if (hadRecorder) {"),
    );
    expect(upload).toContain('if (!presign.ok) throw new Error("presign failed");');
    expect(upload).toContain('if (!put.ok) throw new Error("upload failed");');
    expect(upload).toContain('if (!reg.ok) throw new Error("register failed");');
    expect(upload.indexOf('if (!reg.ok) throw new Error("register failed");')).toBeLessThan(
      upload.indexOf('setRecordNote("saved");'),
    );
    expect(upload).toContain('setRecordNote("failed");');
  });
});

describe("end leftover: success is announced only on an ok response (fixed in this lane)", () => {
  it("a non-ok end response throws before the banner clears", () => {
    expect(endLeftover).toContain('if (!res.ok) throw new Error("end leftover failed");');
    expect(endLeftover.indexOf('throw new Error("end leftover failed")')).toBeLessThan(
      endLeftover.indexOf("setLeftover(null);"),
    );
  });

  it("the success toast rides the same ok path; failure lands in the honest catch", () => {
    expect(endLeftover.indexOf("setLeftover(null);")).toBeLessThan(endLeftover.indexOf('title: "Stream ended"'));
    expect(endLeftover).toContain('toast({ title: "Couldn\'t end it", description: "Try again in a moment.", variant: "destructive" });');
  });
});

describe("the discord announce already checked its write — unchanged", () => {
  it("announce throws the server's message on a non-ok response before marking announced", () => {
    const announce = studio.slice(studio.indexOf("async function announce("), studio.indexOf("/* Stream health while live"));
    expect(announce).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Announce failed"));');
    expect(announce.indexOf('throw new Error(apiErrorMessage(data, "Announce failed"))')).toBeLessThan(
      announce.indexOf("setAnnouncedLive(true);"),
    );
  });
});
