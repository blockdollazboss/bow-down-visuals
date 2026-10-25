/* ─── Signature-sound ASSET MANIFEST (Stack-200 UPGRADES 183) ───────────
   THE ONLY PLACE IN THE CODEBASE THAT NAMES A SOUND FILE.

   Playback is wired BY ROLE — notification / message / success /
   error / sting / ringtone — and every caller (the engine, the bells,
   the World, the toast rail) speaks in roles only. Swapping the asset
   set (the v4 fingerprints, when the owner approves them) is a
   files-only operation: drop the new masters into public/sounds/ and,
   if their names change, update the six lines below. No call site,
   no engine line, no test of the gating logic changes.

   Current set: SET V7, approved by the owner Oct 25, 2026 (supersedes the v2 masters) —
   one royal motif running through all six, copied byte-identical
   from the signature-sounds masters. */

import type { SoundKind } from "./signature-sounds";

export const SIGNATURE_SOUND_ASSETS: Record<SoundKind, string> = {
  notification: "/sounds/signature-notification.wav",
  message: "/sounds/signature-message.wav",
  success: "/sounds/signature-success.wav",
  error: "/sounds/signature-error.wav",
  sting: "/sounds/signature-royal-sting.wav",
  ringtone: "/sounds/signature-ringtone.wav",
};
