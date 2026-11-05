/* ── Sound bank registration — the rendered bank, lit up ──────────────
 * The owner's sound bank (316 original synthesized sounds, rendered
 * Nov 5, 2026 — ~/workspace/sound-bank-ledger.md) ships as static WAV
 * files under public/sound-bank/ plus the generated manifest in
 * lib/beat-sound-bank-manifest.ts. This module is the one registration
 * call the seam in lib/beat-sounds.ts was built for: AiAudio calls
 * registerBankSounds() once at module load, after which the picker,
 * the transport and the offline render see the real bank — no
 * placeholder rows, no consumer changes.
 *
 * Audio itself stays lazy: registration is metadata only; a bank
 * file is fetched + decoded on first use (ensureBeatSampleBuffer),
 * exactly like a saved library sample.
 */
import { registerBeatSoundManifest, type BeatSoundEntry } from "@/lib/beat-sounds";
import { BANK_SOUND_MANIFEST } from "@/lib/beat-sound-bank-manifest";

export { BANK_SOUND_MANIFEST };

/** How many sounds the bank carries (316 at the Nov 5 render). */
export const BANK_SOUND_COUNT = BANK_SOUND_MANIFEST.length;

/** Register the whole bank into the sound registry. Idempotent —
 *  re-registering an id replaces its entry, so a repeat call (hot
 *  reload, second mount) leaves the bank exactly as it was. Returns
 *  how many entries the registry accepted. */
export function registerBankSounds(): number {
  return registerBeatSoundManifest(BANK_SOUND_MANIFEST);
}

/** Bank entries of one bank category, in manifest order. */
export function bankSoundsByCategory(
  category: NonNullable<BeatSoundEntry["bankCategory"]>,
): typeof BANK_SOUND_MANIFEST {
  return BANK_SOUND_MANIFEST.filter((e) => e.bankCategory === category);
}

/** Category → count for the shipped bank, derived from the manifest
 *  itself (drums 72 · 808 24 · bass 48 · melodic 144 · fx 28). */
export const BANK_CATEGORY_COUNTS: Record<string, number> = (() => {
  const counts: Record<string, number> = {};
  for (const e of BANK_SOUND_MANIFEST) {
    const key = e.bankCategory ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
})();
