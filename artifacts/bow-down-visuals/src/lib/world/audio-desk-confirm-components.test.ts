/**
 * audio-desk-confirm-components — Stack-400 (census B items
 * B-01, B-02, B-07, B-21) source-contract pins. The World Audio
 * Desk charged most of its rails by bare fetch with NO credit
 * confirmation — a member inside the World was charged without
 * the confirmation their 2D twin shows. These pins hold the fix:
 * EVERY paid branch of the desk's two runners rides the
 * confirmed-spend seam (confirmedFetch — the SAME CreditConfirm
 * its 2D twins show), at the registry price, and the new B-07 /
 * B-21 benches mount inside the existing Audio Desk.
 *
 * Pin method (the house source-contract style): exact-string
 * checks over AudioDesk.tsx + a STRUCTURAL rule — within each
 * runner's body, the first fetch-ish token is confirmedFetch
 * (never a bare fetch of a charging rail), and every
 * `confirmedFetch(` line sits in source order BEFORE the
 * `res.json()` / data read that consumes its response, so the
 * confirmation always presents before any charge call can land.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/AudioDesk.tsx");
const benches = read("./audio-benches.ts");

/** The slice of `src` between two markers (must both exist). */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `marker ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `marker ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

/** Confirm-before-charge: in a runner body, the confirmed call
 *  must appear, and its response must be consumed only AFTER it —
 *  i.e. the `await res.json()` read for that call comes later in
 *  the source than the call itself (the seam awaits the member's
 *  yes/no before the request is even sent). */
function expectConfirmBeforeData(body: string, callNeedle: string) {
  const callAt = body.indexOf(callNeedle);
  expect(callAt, callNeedle).toBeGreaterThanOrEqual(0);
  const jsonAt = body.indexOf("await res.json()", callAt);
  expect(jsonAt, `${callNeedle} → its res.json()`).toBeGreaterThan(callAt);
}

describe("B-02 — the quick bench's five tools ride confirmedFetch", () => {
  const quick = () => slice(desk, "export function AudioDesk(", "function AudioFullBench(");

  it("the quick runner declares the confirmed seam", () => {
    expect(quick()).toContain("const { confirmedFetch } = useConfirmedApi();");
  });

  it("cleanup + deverb confirm at their registry rails before the job starts", () => {
    const body = slice(quick(), 'if (tool === "cleanup" || tool === "deverb")', 'if (tool === "finish")');
    expect(body).toContain('const path = tool === "cleanup" ? "/api/audio-cleanup" : "/api/deverb";');
    expect(body).toContain('const res = await confirmedFetch(path, { method: "POST", body: form });');
    expect(body).not.toContain("await fetch(path");
    expectConfirmBeforeData(body, "confirmedFetch(path");
    /* a cancelled confirmation stops the run quietly — no charge, no error state */
    expect(body).toContain("if (!res) {");
    expect(body).toContain('setState("idle"); // the member cancelled the credit confirmation');
  });

  it("finish-my-song confirms before its charge", () => {
    const body = slice(quick(), 'if (tool === "finish")', "const isBeat = tool === \"beat\";");
    expect(body).toContain('const res = await confirmedFetch("/api/finish-my-song/complete", {');
    expect(body).not.toContain('await fetch("/api/finish-my-song/complete"');
    expectConfirmBeforeData(body, 'confirmedFetch("/api/finish-my-song/complete"');
  });

  it("beat + sfx confirm before their charge", () => {
    const body = slice(quick(), "const isBeat = tool === \"beat\";", "if (!res.ok || !data.url)");
    expect(body).toContain('const res = await confirmedFetch(isBeat ? "/api/beat/generate" : "/api/generate-sfx", {');
    expect(body).not.toContain("await fetch(isBeat");
    expectConfirmBeforeData(body, "confirmedFetch(isBeat");
  });
});

describe("B-01 — every AUDIO_BENCHES runner branch rides confirmedFetch", () => {
  const full = () => slice(desk, "function AudioFullBench(", "const cost =");

  it("the file benches (master family, stems, tune, lufs, rate-my-mix) confirm", () => {
    const body = slice(full(), "form.append(MASTER_FILE_FIELD, props.file);", "const jobId = audioBenchJobIdOf(data);");
    expect(body).toContain("const res = await confirmedFetch(def.endpoint, { method: \"POST\", body: form });");
    expect(body).not.toContain("await fetch(def.endpoint");
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
  });

  it("the mix (stem-files) branch confirms", () => {
    const body = slice(full(), 'if (def.input === "stem-files")', "if (!props.file) throw");
    expect(body).toContain("const res = await confirmedFetch(def.endpoint, { method: \"POST\", body: form });");
    expect(body).not.toContain("await fetch(def.endpoint");
  });

  it("the text benches (podcast + voiceover) confirm", () => {
    const body = slice(full(), "/* ── text benches ── */", "/* ── URL benches");
    expect(body).toContain("const res = await confirmedFetch(def.endpoint, {");
    expect(body).not.toContain("await fetch(def.endpoint");
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
  });

  it("the URL benches (vocal polish + singing voice) confirm", () => {
    const body = slice(full(), "const body =\n          benchId === \"vocal-polish\"", "const jobId = audioBenchJobIdOf(data);");
    expect(body).toContain("const res = await confirmedFetch(def.endpoint, {");
    expect(body).not.toContain("await fetch(def.endpoint");
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
  });

  it("the hum generate step confirms (analyze stays the free probe it is)", () => {
    const body = slice(full(), "const form = new FormData();\n        for (const [k, v] of humGenerateFields", "const url = humSongUrlOfResponse(data);");
    expect(body).toContain("const res = await confirmedFetch(def.endpoint, { method: \"POST\", body: form });");
    expect(body).not.toContain("await fetch(def.endpoint");
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
  });

  it("no charging rail in either runner is reached by a bare fetch", () => {
    const quickBody = slice(desk, "const run = async () => {", "const sendToEditor");
    expect(quickBody).not.toContain("await fetch(");
    /* the full runner spans from its `run` to the desk's cost
       line (the first `const cost =` after AudioFullBench) */
    const fullAt = desk.indexOf("function AudioFullBench(");
    const fullBody = slice(desk.slice(fullAt), "const run = async () => {", "const cost =");
    /* the only bare fetch left in the full runner is the hum
       ANALYZE probe — a free capability read (the desk's cost
       line for hum prices the GENERATE call), never a charge. */
    const bare = fullBody.match(/await fetch\(/g) ?? [];
    expect(bare).toHaveLength(1);
    const analyze = slice(fullBody, "if (!ref) {", "setHumNote(");
    expect(analyze).toContain("await fetch(def.endpoint");
    expect(analyze).toContain("humAnalyzeFields()");
  });
});

describe("B-07 — the voice-clone bench mounts inside the Audio Desk", () => {
  it("the bench is registered in the desk's own registry at the clone rail", () => {
    expect(benches).toContain('id: "voice-clone"');
    expect(benches).toContain('endpoint: "/api/clone-voice"');
    expect(benches).toContain('cost: () => registryCost("/api/clone-voice")');
    expect(desk).toContain('"voice-clone": "worldAudioDesk.benchVoiceClone",');
  });

  it("the form carries the page's name + sample + consent, and the run confirms at 500", () => {
    expect(desk).toContain('data-testid="world-audio-voice-clone"');
    expect(desk).toContain('data-testid="world-audio-voice-clone-file"');
    expect(desk).toContain('data-testid="world-audio-voice-clone-consent"');
    const body = slice(desk, 'if (benchId === "voice-clone")', "/* ── Stack-400 B-21");
    /* the sample rides the page's upload rail BEFORE the paid call */
    expect(body).toContain("await uploadStemFile(user.id, sample)");
    expect(body.indexOf("uploadStemFile")).toBeLessThan(body.indexOf("confirmedFetch(def.endpoint"));
    expect(body).toContain("buildCloneVoicePayload({ name, sampleUrl })");
    /* the page's 10-second pre-check runs before any charge */
    expect(body).toContain("durationSec < VOICE_CLONE_MIN_SAMPLE_SEC");
    expect(body.indexOf("VOICE_CLONE_MIN_SAMPLE_SEC")).toBeLessThan(body.indexOf("confirmedFetch(def.endpoint"));
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
  });
});

describe("B-21 — the four media-utility benches mount inside the Audio Desk", () => {
  it("all four benches are registered at their pages' rails", () => {
    expect(benches).toContain('id: "sound-match"');
    expect(benches).toContain('endpoint: "/api/sound-finder/match"');
    expect(benches).toContain('id: "fillers"');
    expect(benches).toContain('endpoint: "/api/remove-fillers/analyze"');
    expect(benches).toContain('pollPath: (jobId) => `/api/remove-fillers/analyze/${jobId}`');
    expect(benches).toContain('id: "transcribe-url"');
    expect(benches).toContain('endpoint: "/api/transcribe-url"');
    expect(benches).toContain('id: "translate-captions"');
    expect(benches).toContain('endpoint: "/api/translate-captions"');
  });

  it("sound match confirms at the registry price and renders the page's rows", () => {
    const body = slice(desk, 'if (benchId === "sound-match")', 'if (benchId === "fillers")');
    expect(body).toContain("const res = await confirmedFetch(def.endpoint, {");
    expect(body).toContain("buildSoundMatchPayload({ videoIdea: soundIdea, niche: \"\", platform: \"tiktok\" })");
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
    expect(desk).toContain('data-testid="world-audio-sound-match"');
    expect(desk).toContain("soundMatchesOfResponse(data)");
  });

  it("fillers confirms the analyze, then polls the card's job path", () => {
    const body = slice(desk, 'if (benchId === "fillers")', 'if (benchId === "transcribe-url")');
    expect(body).toContain("const res = await confirmedFetch(def.endpoint, {");
    expect(body).toContain("buildFillerAnalyzePayload({ mediaUrl: mediaUrlInput })");
    expect(body).toContain("startPoll(jobId);");
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
  });

  it("transcribe-url confirms at the length-priced tier, like the page", () => {
    const body = slice(desk, 'if (benchId === "transcribe-url")', 'if (benchId === "translate-captions")');
    expect(body).toContain("await probeMediaDurationSec(mediaUrlInput.trim())");
    expect(body).toContain("overrideCost: transcribeUrlCostForDuration(durationSec)");
    expect(body).toContain('overrideFeature: "Transcribe"');
    expect(body.indexOf("probeMediaDurationSec")).toBeLessThan(body.indexOf("confirmedFetch(def.endpoint"));
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
  });

  it("translate captions confirms at the per-language total, like the suite", () => {
    const body = slice(desk, 'if (benchId === "translate-captions")', "/* ── text benches ── */");
    expect(body).toContain("overrideCost: translateCaptionsCost(captionLangs.length)");
    expect(body).toContain('getCreditCost("/api/translate-captions")!.feature');
    expect(body).toContain("buildTranslateCaptionsPayload({ captions: lines, targetLanguages: captionLangs })");
    expectConfirmBeforeData(body, "confirmedFetch(def.endpoint");
    expect(desk).toContain('data-testid="world-audio-translate-captions"');
    expect(desk).toContain("TRANSLATE_LANGUAGE_CODES.map((code)");
  });

  it("the desk's displayed price for translate follows the chosen languages", () => {
    expect(desk).toContain('benchId === "translate-captions"\n        ? translateCaptionsCost(captionLangs.length)');
  });
});
