/**
 * GenerateAudio (the music studio's generation panel) — honest
 * load classification (Stack-400 C-28 components residual,
 * deep-pins tranche 2). This panel has no collection loads: its
 * network life is priced generation actions (confirmedFetch)
 * and job polls. What the standard demands here is that no
 * result state is claimed before the server proves it, and the
 * stems flow is the exemplar:
 *
 * - THE SONG ITSELF is fetched before splitting: a non-ok blob
 *   read throws ("Could not load the song audio for
 *   splitting.") — the split never starts from a song that
 *   didn't load.
 * - THE START: a declined confirmation returns to idle with no
 *   note claimed; 402 / out_of_credits routes to the
 *   out-of-credits state (not a failure, not a success); a start
 *   response without a jobId throws.
 * - THE POLL distinguishes job truth from transport noise: a
 *   job-level failure (non-ok with a failure/not-found message,
 *   or status "failed") stops the loop and throws — with the
 *   refund told in the copy; a transient network error keeps
 *   polling; a 10-minute deadline ends in an honest "it keeps
 *   running on the server" error instead of a fake finish.
 * - THE RESULT: done records stems only from the done payload,
 *   and a done payload carrying no stems throws ("The split
 *   finished but returned no stems.") — done is never painted
 *   over an empty result.
 *
 * NO FIX in this lane — the flows already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./GenerateAudio.tsx");

const stems = panel.slice(panel.indexOf("async function handleStems()"), panel.indexOf("/* ── Mastering"));

describe("the stems flow never starts from an unloaded song", () => {
  it("the song blob read throws on non-ok before the split posts", () => {
    expect(stems).toContain("const songRes = await fetch(lastGenerated.url);");
    expect(stems).toContain('if (!songRes.ok) throw new Error("Could not load the song audio for splitting.");');
    expect(stems.indexOf("if (!songRes.ok) throw")).toBeLessThan(stems.indexOf('confirmedFetch("/api/stems"'));
  });

  it("a declined confirmation idles silently; 402 is out-of-credits, not failure or success", () => {
    expect(stems).toContain('if (!res) { setStemsPhase("idle"); setStemsNote(null); return; } // user cancelled');
    expect(stems).toContain('if (res.status === 402 || start.error === "out_of_credits") {');
    expect(stems).toContain("setOutOfCredits(true);");
  });

  it("a start without a jobId throws", () => {
    expect(stems).toContain("if (!res.ok || !start.jobId) {");
  });
});

describe("the stems poll separates job truth from transport noise", () => {
  it("a job-level failure stops the loop; a transient error keeps polling", () => {
    expect(stems).toContain("if (pollErr instanceof Error && /failed|not found/i.test(pollErr.message)) throw pollErr;");
    expect(stems).toContain("// Job-level failures stop the loop; transient network errors keep polling.");
  });

  it("a failed status throws with the refund told; the deadline never fakes a finish", () => {
    expect(stems).toContain('if (data.status === "failed") throw new Error(apiThrowMessage(data, "Stem split failed — your Visual Bucs were refunded."));');
    expect(stems).toContain('if (!doneData) throw new Error("The stem split is taking longer than usual — it keeps running on the server, try again in a bit.");');
  });

  it("done with no stems throws — the done phase paints only over real stems", () => {
    expect(stems).toContain('if (newStems.length === 0) throw new Error("The split finished but returned no stems.");');
    expect(stems).toContain('setStemsPhase("done");');
    expect(stems.indexOf("newStems.length === 0")).toBeLessThan(stems.indexOf('setStemsPhase("done");'));
  });
});
