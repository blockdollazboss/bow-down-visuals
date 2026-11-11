/**
 * ProducerTagMaker (the producer-tag generator) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE GENERATE gates on ok + the proven tag url: a non-ok
 *   or url-less body lands on the server's own error fields
 *   (detail / message / error), and a thrown request lands
 *   on the network error line — a tag is never presented as
 *   generated before its url exists.
 * - THE VAULT-VOICE READ is an enhancement, pinned as-is:
 *   the "use my vault voice" chip renders ONLY when the
 *   response is ok AND the payload proves available — a
 *   failed read simply doesn't offer the chip, and nothing
 *   anywhere claims the member has no vault voice.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ProducerTagMaker.tsx");

describe("the generate gates success on ok + the proven tag url", () => {
  it("non-ok or a missing url lands on the server's error fields", () => {
    expect(src).toContain("if (!res.ok || !data.url) {");
    expect(src).toContain('setError(data.detail || data.message || data.error || t("producerTag.errorGenerateFailed"));');
    expect(src).toContain('setError(t("producerTag.errorNetwork"));');
  });
});

describe("the vault-voice chip is offered only from a proven payload", () => {
  it("the read sets state only on ok, and the chip gates on available", () => {
    expect(src).toContain("if (res.ok) setVaultVoice((await res.json()) as VaultVoiceInfo);");
    expect(src).toContain("{vaultVoice?.available && (");
  });
});
