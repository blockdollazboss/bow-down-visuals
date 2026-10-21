/**
 * studio-bridge.ts — the meeting point between BroadcastStudio
 * (which owns the Stage + AudioMixer) and the GuestPanel (which owns
 * the backstage). "Bring on stage" must MEAN on air, so promoting a
 * guest in the panel does the whole job here:
 *
 *   putGuestOnStage: a guest source lands in the program scene
 *     (a corner tile the host can move/resize like any source) and
 *     the guest's audio joins the program mixer on its own channel.
 *   takeGuestOffStage: the source leaves every scene and the mixer
 *     channel is removed — demote/remove can never leave a ghost
 *     tile or a hot mic on air.
 *
 * The mixer is created lazily by the studio (camera start), so audio
 * attachments are remembered and applied the moment it registers.
 */
import type { Stage } from "@/lib/stream-kit/stage";
import type { AudioMixer } from "@/lib/stream-kit/audio-mixer";
import { guestFeeds } from "./guest-feeds";

interface StudioHandles {
  stage: Stage | null;
  mixer: AudioMixer | null;
}

const handles: StudioHandles = { stage: null, mixer: null };
const pendingAudio = new Map<string, MediaStream | null>();

export function guestMixerInputId(sessionId: string): string {
  return `guest:${sessionId}`;
}

export function registerStudioStage(stage: Stage): void {
  handles.stage = stage;
}

export function clearStudioStage(stage: Stage): void {
  if (handles.stage === stage) handles.stage = null;
}

export function registerStudioMixer(mixer: AudioMixer): void {
  handles.mixer = mixer;
  for (const [sessionId, stream] of pendingAudio) {
    if (stream) mixer.setInputStream(guestMixerInputId(sessionId), stream);
  }
}

export function clearStudioMixer(mixer: AudioMixer): void {
  if (handles.mixer === mixer) handles.mixer = null;
}

export function studioStage(): Stage | null {
  return handles.stage;
}

/** Feed a guest's audio into the program mix (their current stream,
 *  or null to silence). Remembered until the mixer exists. */
export function attachGuestAudio(sessionId: string, stream: MediaStream | null): void {
  pendingAudio.set(sessionId, stream);
  if (handles.mixer) {
    handles.mixer.setInputStream(guestMixerInputId(sessionId), stream);
  }
}

export function detachGuestAudio(sessionId: string): void {
  pendingAudio.delete(sessionId);
  handles.mixer?.removeInput(guestMixerInputId(sessionId));
}

/** Put a guest on air in the program scene. Idempotent: a guest who
 *  already has a source keeps it (no duplicate tiles). Returns false
 *  only when the studio isn't mounted. */
export function putGuestOnStage(session: { id: string; display_name: string }): boolean {
  const stage = handles.stage;
  if (!stage) return false;
  const program = stage.programScene();
  const existing = program.sources.find((s) => s.type === "guest" && s.guest?.sessionId === session.id);
  if (!existing) {
    const source = stage.addSource(program.id, "guest");
    if (source) {
      stage.updateSource(program.id, source.id, {
        name: session.display_name,
        guest: { sessionId: session.id, name: session.display_name },
      });
    }
  }
  attachGuestAudio(session.id, guestFeeds.streamFor(session.id));
  return true;
}

/** Take a guest off air everywhere: scene sources + mixer channel. */
export function takeGuestOffStage(sessionId: string): void {
  const stage = handles.stage;
  if (stage) {
    for (const scene of stage.scenes) {
      for (const source of [...scene.sources]) {
        if (source.type === "guest" && source.guest?.sessionId === sessionId) {
          stage.removeSource(scene.id, source.id);
        }
      }
    }
  }
  detachGuestAudio(sessionId);
}

/** Panel teardown: every guest source + channel goes (stream end). */
export function clearAllGuestsFromStage(): void {
  const stage = handles.stage;
  if (stage) {
    for (const scene of stage.scenes) {
      for (const source of [...scene.sources]) {
        if (source.type === "guest") stage.removeSource(scene.id, source.id);
      }
    }
  }
  for (const sessionId of [...pendingAudio.keys()]) detachGuestAudio(sessionId);
}
