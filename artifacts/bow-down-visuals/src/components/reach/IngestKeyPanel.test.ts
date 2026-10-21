/**
 * IngestKeyPanel honesty gate — source pins for the RTMP ingest
 * panel's two states (vitest here is node-env with source pins, per
 * the repo's established split).
 *
 * The contract:
 *  (a) GATE SHUT (the shipped default — LIVE_RTMP_INGEST is opt-in
 *      per deployment because the current hosting routes no RTMP
 *      port): the panel shows ONE plain honest note — streaming from
 *      other software "isn't open yet — it arrives with the launch
 *      setup" — and offers NO minting: every key control (server URL,
 *      create/show key, regenerate, revoke, title) renders only
 *      inside the `ingest.enabled` branch, and the pitch paragraphs
 *      that promise "the server below" are hidden too.
 *  (b) GATE OPEN: the panel is exactly the panel as built — the same
 *      endpoints, the same shown-once key flow.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./IngestKeyPanel.tsx", import.meta.url), "utf8");

const HONEST_OFF_NOTE =
  "Streaming from other software isn't open yet — it arrives with the launch setup. Your built-in studio works today.";

describe("IngestKeyPanel — gate shut state", () => {
  it("carries the plain honest not-open-yet note, verbatim", () => {
    expect(panel).toContain(HONEST_OFF_NOTE);
  });

  it("shows the note only when the server reports the door shut", () => {
    expect(panel).toContain("ingest && !ingest.enabled");
  });

  it("offers no minting while shut: every key control lives inside the enabled branch", () => {
    const enabledBranch = panel.indexOf("ingest && ingest.enabled");
    expect(enabledBranch).toBeGreaterThan(-1);
    for (const control of [
      "Create my key",
      "Show my key",
      "Regenerate key",
      "Revoke key",
      "Server URL",
      "Your stream key</label>",
      "Title for program-started streams",
    ]) {
      const at = panel.indexOf(control);
      expect(at, `"${control}" should exist (gate-open panel unchanged)`).toBeGreaterThan(-1);
      expect(at, `"${control}" must render only inside the enabled branch`).toBeGreaterThan(enabledBranch);
    }
  });

  it("hides the pitch while shut — nothing promises 'the server below' when there is none", () => {
    expect(panel).toContain("(!ingest || ingest.enabled)");
    const pitchGate = panel.indexOf("(!ingest || ingest.enabled)");
    const pitch = panel.indexOf("Point your program at the server below");
    expect(pitch).toBeGreaterThan(pitchGate);
  });
});

describe("IngestKeyPanel — gate open behavior unchanged", () => {
  it("still loads status and drives the same four key doors", () => {
    expect(panel).toContain('"/api/live-streams/ingest-key"');
    expect(panel).toContain('"/api/live-streams/ingest-key/reveal"');
    expect(panel).toContain('"/api/live-streams/ingest-key/regenerate"');
    expect(panel).toContain('"/api/live-streams/ingest-key/revoke"');
  });

  it("still treats the key as shown-once, hash-only on the server", () => {
    expect(panel).toContain("shown only once");
    expect(panel).toContain('data-testid="ingest-key-panel"');
  });
});
