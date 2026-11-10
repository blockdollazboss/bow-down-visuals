/**
 * AudioDesk (the World audio station: Library/Stems tabs, the
 * file-tool library strip, the voice benches) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - MY MUSIC (shared by the Library + Stem tabs): the null-state
 *   machine — tracks stay null until an ok response, failure
 *   sets myMusicFailed, and both tabs receive the failed flag so
 *   each renders its own honest state.
 * - THE LIBRARY STRIP: fetchLibrarySongs throws on non-ok (its
 *   lib contract); the strip renders failed → loading (null) →
 *   list, in that order.
 * - THE SINGING GATE fails closed: the configured flag is true
 *   only from an ok status read that says so; a non-ok or thrown
 *   read lands on false ("not set up"), never on assumed-open.
 * - THE HARMONY PROBE is a documented additive capability read —
 *   a miss leaves the bench on server re-validation at generate
 *   time, exactly as its 2D modal treats it.
 *
 * FINDING + FIX (this lane): the two voice pickers (voiceover +
 * singing) could not tell failure from loading. The voiceover
 * read never checked res.ok — a 500 recorded an empty list —
 * and both pickers render their empty option with the label
 * "Voices loading…", so a failed read left the picker claiming
 * to load forever, with no error and no way to know. The reads
 * now throw on non-ok into voicesFailed / singVoicesFailed
 * flags, and the empty option reads "Couldn't load voices."
 * (worldAudioDesk.voicesFailed) when the flag is set. The
 * singing status's fail-closed behavior is unchanged.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./AudioDesk.tsx");

describe("my music: the null-state machine feeds both tabs", () => {
  it("tracks record only on ok; failure sets the flag; success clears it", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("my-music");');
    expect(desk).toContain("setMyMusic(rows);");
    expect(desk).toContain("setMyMusicFailed(false);");
    expect(desk).toContain("if (!cancelled) setMyMusicFailed(true);");
    expect(desk).toContain("const [myMusic, setMyMusic] = useState<MyMusicTrack[] | null>(null);");
  });

  it("both tabs receive the failed flag", () => {
    expect(desk.match(/failed=\{myMusicFailed\}/g)).toHaveLength(2);
  });
});

describe("the library strip renders failed before loading before list", () => {
  it("the loader throws on non-ok and the strip honors the order", () => {
    expect(desk).toContain("const list = await fetchLibrarySongs(getAccessToken);");
    const failedIdx = desk.indexOf("{songsFailed ? (");
    const loadingIdx = desk.indexOf(") : songs === null ? (");
    expect(failedIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeGreaterThan(failedIdx);
    expect(desk).toContain('t("worldAudioDesk.songsLoadFailed")');
  });
});

describe("the singing gate fails closed — unchanged", () => {
  it("configured is true only from an ok read that says so", () => {
    expect(desk).toContain("setSingConfigured(sdata.configured === true);");
    expect(desk).toContain("} else setSingConfigured(false);");
  });
});

describe("FIX: the voice pickers can no longer claim to load forever", () => {
  it("the voiceover read checks res.ok and lands failures on its flag", () => {
    const fx = desk.slice(desk.indexOf('if (benchId === "voiceover" && voices.length === 0)'), desk.indexOf('if (benchId === "singing-voice"'));
    expect(fx).toContain('if (!res.ok) throw new Error("voices");');
    expect(fx).toContain("setVoicesFailed(false);");
    expect(fx).toContain("catch { setVoicesFailed(true);");
  });

  it("the singing voices read flags a non-ok or thrown read", () => {
    expect(desk).toContain("} else setSingVoicesFailed(true);");
    expect(desk).toContain("setSingVoicesFailed(false);");
  });

  it("both pickers swap the loading label for the failure label on their flag", () => {
    expect(desk).toContain('label: voicesFailed ? t("worldAudioDesk.voicesFailed") : t("worldAudioDesk.voicesLoading")');
    expect(desk).toContain('label: singVoicesFailed ? t("worldAudioDesk.voicesFailed") : t("worldAudioDesk.voicesLoading")');
  });
});

describe("the harmony probe is additive by design — unchanged", () => {
  it("a failed probe leaves the bench on server re-validation", () => {
    expect(desk).toContain("/* probe failing is non-fatal — the server re-validates on generate, as the modal treats it */");
    expect(desk).toContain("if (!res?.ok) return;");
  });
});
