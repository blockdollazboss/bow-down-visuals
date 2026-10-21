/**
 * character-voice.ts — "when people talk, they should be talking in
 * a character's voice" (owner's order, 2026-10-16).
 *
 * A character voice profile, applied to the speaker's own mic LIVE,
 * on the send side, before the voice mesh ever sees the stream: the
 * hall hears the character, not the raw microphone. The shaping is
 * Web Audio only — a delay-modulation pitch shift (the same
 * harmonizer pattern the stream kit's voice rack runs, see
 * lib/stream-kit/voice-isolator.ts) plus formant/EQ shaping (peaking
 * bands whose centres scale with the profile's formant ratio, and
 * the profile's own EQ). It is deliberately NOT cloned
 * speech-to-speech: that conversion carries seconds of lag, which
 * kills live conversation, so it is not this module's business.
 *
 * A profile is data: pitch (semitones), a formant ratio, and EQ.
 * Resolution follows the character you STAND AS — the same presence
 * the hall dresses your figure from:
 *   male Palace Guard    → the deep guard profile
 *   female Palace Guard  → her profile
 *   a Creative Vault character → ITS OWN stored shaping profile
 *     (artist_vaults.voice_profile, migration 0142 / audit G4), which
 *     the server resolves from the vault row and rides on the
 *     presence's character ref. A vault character with NO profile
 *     set → the NEUTRAL house profile: it sounds like its speaker,
 *     honestly labelled "yourself". (The vault's cloned voice for
 *     song generation is a different thing — a voice id for the
 *     studio, not shaping numbers, and never converted into one.)
 *   no pick at all → you stand as the guard the hall deals you
 *     (figure.ts deals it deterministically), so you sound like
 *     that guard. The capsule is only that same guard's art still
 *     loading — never a different character.
 *
 * The switch: "Character voice", in the hall's voice cluster,
 * device-remembered, default ON whenever a profile applies —
 * speaking as yourself is always one tap away (owner's law: every
 * automated behaviour ships with an explicit off).
 *
 * Interplay, by construction: the modes (Proximity / Lobby /
 * Deafen) are RECEIVE-side gains in the mesh; shaping is SEND-side
 * and upstream of it, so the two never interact. Deafen and mute
 * still mute the mic track the mesh holds (the shaper's output
 * track — silencing it silences the shaped voice exactly like a raw
 * one). Voice Off still releases everything. Host mute is the
 * server's, untouched. Guests have no voice and no shaping.
 *
 * FAIL OPEN, always: any error building or running the shaping
 * graph hands the mesh the RAW mic stream instead. Character voice
 * may degrade to your own voice; it may never degrade to silence.
 *
 * The lips tap (voice.ts createLocalLevelTap) reads the RAW mic in
 * the page — your real level, pre-shaping — so your figure's lips
 * stay synced to the voice the hall actually hears you make.
 */

import { guardVariantForKey, houseGuardVariantForId } from "./figure";

/* ── Profile data ─────────────────────────────────────────────────── */

export interface CharacterVoiceEqBand {
  type: BiquadFilterType;
  /** Centre (peaking/shelf) frequency, Hz. */
  freqHz: number;
  gainDb: number;
  q: number;
}

export interface CharacterVoiceProfile {
  /** Stable id: "guard-male" | "guard-female" | "neutral". */
  id: string;
  /** Plain words the hall UI speaks: "You sound like …". */
  label: string;
  /** Pitch shift, semitones (negative = deeper). Intelligibility
   *  bound for the house profiles: |pitch| ≤ 6. */
  pitchSemitones: number;
  /** Formant scaling: < 1 a bigger body (bands move down), > 1 a
   *  smaller one. The formant bands' centres multiply by this. */
  formantRatio: number;
  /** Gain (dB) carried by the formant bands — the resonance that
   *  makes the shift read as a body, not just a pitch. */
  formantGainDb: number;
  /** The profile's own EQ, applied after the formant bands. */
  eq: CharacterVoiceEqBand[];
}

/** The neutral house profile: identity — you sound like yourself.
 *  Vault characters resolve here in v1 (see the header), and so
 *  does anything resolution can't name. */
export const NEUTRAL_VOICE_PROFILE: CharacterVoiceProfile = {
  id: "neutral",
  label: "yourself",
  pitchSemitones: 0,
  formantRatio: 1,
  formantGainDb: 0,
  eq: [],
};

/** The male Palace Guard: a big deep body — down a major third,
 *  formants lowered, chest weight in the low shelf, a little mud
 *  taken out of the low mids, the top darkened a touch. */
export const GUARD_MALE_VOICE_PROFILE: CharacterVoiceProfile = {
  id: "guard-male",
  label: "the male palace guard",
  pitchSemitones: -4,
  formantRatio: 0.9,
  formantGainDb: 2,
  eq: [
    { type: "lowshelf", freqHz: 160, gainDb: 3, q: 0.7 },
    { type: "peaking", freqHz: 350, gainDb: -2, q: 1 },
    { type: "highshelf", freqHz: 6000, gainDb: -1, q: 0.7 },
  ],
};

/** The female Palace Guard: a strong, higher guard voice — up a
 *  minor third, formants raised, the low shelf lightened, presence
 *  lifted so she carries across the hall. */
export const GUARD_FEMALE_VOICE_PROFILE: CharacterVoiceProfile = {
  id: "guard-female",
  label: "the female palace guard",
  pitchSemitones: 3,
  formantRatio: 1.1,
  formantGainDb: 1.5,
  eq: [
    { type: "lowshelf", freqHz: 160, gainDb: -1, q: 0.7 },
    { type: "peaking", freqHz: 3200, gainDb: 1.5, q: 0.9 },
    { type: "highshelf", freqHz: 7000, gainDb: 1, q: 0.7 },
  ],
};

/* ── Shaping math (pure — the tests live here) ────────────────────── */

/** Pitch ratio for a semitone shift: 2^(st/12). */
export function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** Vocal-tract formant centres (Hz) the profiles scale: roughly
 *  F1/F2/F3 for a neutral vowel. The shaper realizes the formant
 *  shift as peaking bands at these centres × the profile's ratio —
 *  resonant EQ shaping, honestly not LPC resynthesis. */
export const FORMANT_BASE_FREQS_HZ: readonly number[] = [720, 1080, 2560];

const FORMANT_MIN_HZ = 40;
const FORMANT_MAX_HZ = 12000;

function clampFormantHz(hz: number): number {
  if (!Number.isFinite(hz)) return FORMANT_MIN_HZ;
  return Math.min(FORMANT_MAX_HZ, Math.max(FORMANT_MIN_HZ, hz));
}

/** The formant bands a profile realizes: centres scaled by its
 *  formant ratio (clamped to the audible band), each carrying the
 *  profile's formant gain. A zero-gain profile (neutral) realizes
 *  no bands at all. */
export function formantBandsFor(profile: CharacterVoiceProfile): CharacterVoiceEqBand[] {
  if (!profile || profile.formantGainDb === 0) return [];
  return FORMANT_BASE_FREQS_HZ.map((base) => ({
    type: "peaking" as BiquadFilterType,
    freqHz: clampFormantHz(base * profile.formantRatio),
    gainDb: profile.formantGainDb,
    q: 1.1,
  }));
}

/** Every band the shaper builds for a profile, in chain order:
 *  formant bands first, then the profile's own EQ. */
export function profileBandsFor(profile: CharacterVoiceProfile): CharacterVoiceEqBand[] {
  return [...formantBandsFor(profile), ...profile.eq];
}

/** Identity = nothing to shape: no pitch, no bands. The shaper
 *  bypasses identity profiles even with the switch on — running a
 *  pitch graph at ratio 1 would only add latency and a gain dip. */
export function isIdentityProfile(profile: CharacterVoiceProfile): boolean {
  return profile.pitchSemitones === 0 && profileBandsFor(profile).length === 0;
}

/* ── Resolution: the character you stand as → its voice ───────────── */

/** A shaping profile as stored on a vault row (and as the vault
 *  editor writes it): the profile numbers without an id or label —
 *  those come from the character itself. */
export interface StoredCharacterVoiceProfile {
  pitchSemitones: number;
  formantRatio: number;
  formantGainDb: number;
  eq: CharacterVoiceEqBand[];
}

/** The stored form of a full profile (drop id/label). */
export function storedFormOf(profile: CharacterVoiceProfile): StoredCharacterVoiceProfile {
  return {
    pitchSemitones: profile.pitchSemitones,
    formantRatio: profile.formantRatio,
    formantGainDb: profile.formantGainDb,
    eq: profile.eq.map((b) => ({ ...b })),
  };
}

/** The vault editor's Turbo presets (0142): Deep and Bright are the
 *  house guards' proven numbers; Natural = no profile at all (null),
 *  the character sounds like its speaker. */
export const DEEP_VOICE_PRESET: StoredCharacterVoiceProfile = storedFormOf(GUARD_MALE_VOICE_PROFILE);
export const BRIGHT_VOICE_PRESET: StoredCharacterVoiceProfile = storedFormOf(GUARD_FEMALE_VOICE_PROFILE);

/** A stored profile realized for a character: its id and label come
 *  from the character, so the hall says "You sound like {name}". */
export function profileFromStored(
  characterId: string,
  characterName: string | null | undefined,
  stored: StoredCharacterVoiceProfile,
): CharacterVoiceProfile {
  return {
    id: `vault:${characterId}`,
    label: characterName && characterName.trim() ? characterName.trim() : "your character",
    pitchSemitones: stored.pitchSemitones,
    formantRatio: stored.formantRatio,
    formantGainDb: stored.formantGainDb,
    eq: Array.isArray(stored.eq) ? stored.eq.map((b) => ({ ...b })) : [],
  };
}

export interface CharacterVoiceResolutionInput {
  /** The presence's character id (self.character.id): a house guard
   *  id for a guard pick, the vault row id for a vault character,
   *  null when there is no pick. */
  characterId: string | null | undefined;
  /** The identity key the hall deals a no-pick presence its guard
   *  from — the member's profile slug, else the presence id (the
   *  scene's own key: guardVariantForKey). */
  presenceKey: string | null | undefined;
  /** The vault character's stored shaping profile, carried on the
   *  presence's character ref from the server (0142, G4). Only
   *  consulted for vault characters; guards keep their house
   *  profiles. Null/absent = no set voice. */
  storedProfile?: StoredCharacterVoiceProfile | null;
  /** The character's name — the realized profile's label. */
  characterName?: string | null;
}

/** Whose voice a presence speaks with. Mirrors figure resolution
 *  exactly — what the hall SEES you standing as is what it HEARS. */
export function resolveCharacterVoiceProfile(input: CharacterVoiceResolutionInput): CharacterVoiceProfile {
  const characterId = typeof input.characterId === "string" && input.characterId ? input.characterId : null;
  if (characterId) {
    const variant = houseGuardVariantForId(characterId);
    if (variant === "male") return GUARD_MALE_VOICE_PROFILE;
    if (variant === "female") return GUARD_FEMALE_VOICE_PROFILE;
    /* A vault character WITH a set voice speaks in it (0142, G4);
     * without one it stays neutral, honestly. */
    if (input.storedProfile) {
      return profileFromStored(characterId, input.characterName, input.storedProfile);
    }
    return NEUTRAL_VOICE_PROFILE;
  }
  if (input.presenceKey) {
    return guardVariantForKey(input.presenceKey) === "female"
      ? GUARD_FEMALE_VOICE_PROFILE
      : GUARD_MALE_VOICE_PROFILE;
  }
  return NEUTRAL_VOICE_PROFILE;
}

/* ── Shaping parameters: profile + switch → the graph's orders ────── */

export interface ShapingParams {
  /** True = the raw mic passes untouched (switch off, or an
   *  identity profile): the graph runs dry, never silent. */
  bypass: boolean;
  pitchSemitones: number;
  bands: CharacterVoiceEqBand[];
}

const BYPASS_PARAMS: ShapingParams = { bypass: true, pitchSemitones: 0, bands: [] };

/** The exact parameters the shaper applies for a profile and the
 *  switch — pure, so every branch of the decision is testable
 *  without an AudioContext. */
export function shapingParamsFor(profile: CharacterVoiceProfile, enabled: boolean): ShapingParams {
  if (!enabled || !profile || isIdentityProfile(profile)) return BYPASS_PARAMS;
  return {
    bypass: false,
    pitchSemitones: profile.pitchSemitones,
    bands: profileBandsFor(profile),
  };
}

/* ── Device memory ──────────────────────────────────────────────────
   The switch is a device preference like the character pick and
   the voice mode: localStorage, never account data. Only "off" is
   ever stored — the default is ON, so an absent key means on. */

export const WORLD_CHARACTER_VOICE_STORAGE_KEY = "bdv.worldCharacterVoice";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Default ON — a stored "off" is the only thing that turns the
 *  character voice off, and broken storage never flips it. */
export function loadCharacterVoiceEnabled(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(WORLD_CHARACTER_VOICE_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function storeCharacterVoiceEnabled(enabled: boolean, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (enabled) storage.removeItem(WORLD_CHARACTER_VOICE_STORAGE_KEY);
    else storage.setItem(WORLD_CHARACTER_VOICE_STORAGE_KEY, "off");
  } catch {
    /* private mode etc. — the choice still applies this visit */
  }
}

/* ── The browser shaper (the graph itself) ──────────────────────────
   raw mic → source ─┬→ dry gain ───────────────┬→ destination → mesh
                     └→ HP → pitch → EQ bands → wet gain ─┘
   Dry and wet crossfade on apply(): the output stream's track never
   changes identity, so the mesh, its mute, and its peer connections
   are never disturbed by a profile flip or the switch. */

/**
 * The pitch shifter: the stream kit's delay-modulation harmonizer
 * (lib/stream-kit/voice-isolator.ts), under this module's own
 * processor name so the two never collide on a shared context. Two
 * read taps sweep a 2048-sample window half a period apart under
 * raised-sine windows — a tap is always silent as its delay wraps,
 * so the shift is click-free. Semitones arrive via processorOptions
 * and update live through the port.
 */
const CHARACTER_PITCH_WORKLET_SOURCE = `
class BdvCharacterPitchShift extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.semitones = typeof p.semitones === 'number' ? p.semitones : 0;
    this.size = 16384;
    this.window = 2048;
    this.buffers = [new Float32Array(this.size), new Float32Array(this.size)];
    this.write = 0;
    this.phase = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.semitones === 'number') this.semitones = d.semitones;
    };
  }
  read(buf, delay) {
    let pos = this.write - delay;
    pos = ((pos % this.size) + this.size) % this.size;
    const i0 = Math.floor(pos);
    const i1 = (i0 + 1) % this.size;
    const frac = pos - i0;
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;
    const inCh = input.length;
    const outCh = output.length;
    const frames = input[0].length;
    const ratio = Math.pow(2, this.semitones / 12);
    const step = (1 - ratio) / this.window;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < 2; c++) {
        const src = input[Math.min(c, inCh - 1)];
        this.buffers[c][this.write] = src ? src[i] : 0;
      }
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
      if (this.phase < 0) this.phase += 1;
      const pA = this.phase;
      const pB = pA + 0.5 >= 1 ? pA - 0.5 : pA + 0.5;
      const dA = pA * this.window;
      const dB = pB * this.window;
      const wA = Math.sin(Math.PI * pA);
      const wB = Math.sin(Math.PI * pB);
      for (let c = 0; c < outCh; c++) {
        const buf = this.buffers[Math.min(c, 1)];
        output[c][i] = (this.read(buf, dA) * wA + this.read(buf, dB) * wB) * 0.85;
      }
      this.write = (this.write + 1) % this.size;
    }
    return true;
  }
}
registerProcessor('bdv-character-pitch-shift', BdvCharacterPitchShift);
`;

let characterPitchWorkletPromise: Promise<void> | null = null;

/** Register the pitch worklet on a context (once per page). */
function loadCharacterPitchWorklet(ctx: AudioContext): Promise<void> {
  if (!characterPitchWorkletPromise) {
    const url = URL.createObjectURL(new Blob([CHARACTER_PITCH_WORKLET_SOURCE], { type: "application/javascript" }));
    characterPitchWorkletPromise = ctx.audioWorklet.addModule(url);
  }
  return characterPitchWorkletPromise;
}

export class CharacterVoiceShaper {
  private ctx: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private chainIn: GainNode;
  private bandNodes: BiquadFilterNode[] = [];
  private pitchNode: AudioWorkletNode | null = null;
  private pitchSemitones = 0;
  private bandSpecs: CharacterVoiceEqBand[] = [];
  private dest: MediaStreamAudioDestinationNode;
  private appliedKey: string | null = null;
  private disposed = false;

  private constructor(raw: MediaStream, ctx: AudioContext) {
    this.ctx = ctx;
    this.source = ctx.createMediaStreamSource(raw);
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.chainIn = ctx.createGain();
    this.dest = ctx.createMediaStreamDestination();
    // Start dry: until the first apply() says otherwise, the raw
    // mic is what flows — the graph can only ever ADD shaping.
    this.dryGain.gain.value = 1;
    this.wetGain.gain.value = 0;
    this.source.connect(this.dryGain);
    this.dryGain.connect(this.dest);
    this.source.connect(this.chainIn);
    this.chainIn.connect(this.wetGain);
    this.wetGain.connect(this.dest);
  }

  /** Build a shaper over the raw mic stream. NEVER throws and
   *  never returns a silent stream: any failure (no Web Audio, a
   *  context that won't start, a graph that won't build) returns
   *  null and the caller hands the mesh the raw stream — fail open. */
  static async create(raw: MediaStream, params: ShapingParams): Promise<CharacterVoiceShaper | null> {
    try {
      if (typeof AudioContext === "undefined") return null;
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const shaper = new CharacterVoiceShaper(raw, ctx);
      void ctx.resume().catch(() => undefined);
      shaper.apply(params);
      void shaper.loadPitch();
      return shaper;
    } catch {
      return null;
    }
  }

  /** The stream the mesh sends: shaped when the wet path is up,
   *  the raw mic (via the dry path) whenever it isn't. */
  get outputStream(): MediaStream {
    return this.dest.stream;
  }

  /** Apply new shaping orders (a profile flip, the switch). Cheap
   *  and idempotent: unchanged parameters are a no-op, so the page
   *  may call this on every presence sync. Gains crossfade — no
   *  clicks, no track swaps, no mesh disturbance. */
  apply(params: ShapingParams): void {
    if (this.disposed) return;
    const key = JSON.stringify(params);
    if (key === this.appliedKey) return;
    this.appliedKey = key;
    const t = this.ctx.currentTime;
    this.dryGain.gain.setTargetAtTime(params.bypass ? 1 : 0, t, 0.05);
    this.wetGain.gain.setTargetAtTime(params.bypass ? 0 : 1, t, 0.05);
    this.pitchSemitones = params.pitchSemitones;
    try {
      this.pitchNode?.port.postMessage({ semitones: params.pitchSemitones });
    } catch {
      /* a dead port just leaves the last shift standing */
    }
    this.rebuildBands(params.bands);
  }

  /** Tear the graph down: disconnect, end the generated output
   *  track, close the context. The raw mic stream is the caller's —
   *  it is NOT stopped here. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.source.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
      this.chainIn.disconnect();
      this.pitchNode?.disconnect();
      for (const node of this.bandNodes) node.disconnect();
      this.dest.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* already torn down */
    }
    void this.ctx.close().catch(() => undefined);
  }

  /** Splice the pitch worklet into the wet chain when it registers:
   *  chainIn → pitch → bands → wetGain. Until it lands — and if it
   *  never does — the chain runs EQ-only through a straight wire:
   *  a partial shaping beats a failed one (fail open, again). */
  private async loadPitch(): Promise<void> {
    try {
      if (!this.ctx.audioWorklet) return;
      await loadCharacterPitchWorklet(this.ctx);
      if (this.disposed) return;
      const node = new AudioWorkletNode(this.ctx, "bdv-character-pitch-shift", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { semitones: this.pitchSemitones },
      });
      this.pitchNode = node;
      // Rebuild the wet chain with the pitch stage at its head.
      this.rebuildBands(this.bandSpecs);
    } catch {
      /* no worklet — the EQ-only wire stands */
    }
  }

  /** (Re)build the wet chain's tail: chainIn → [pitch] → bands →
   *  wetGain, from the given band specs. */
  private rebuildBands(bands: CharacterVoiceEqBand[]): void {
    this.bandSpecs = bands;
    try {
      this.chainIn.disconnect();
    } catch {
      /* fresh */
    }
    for (const node of this.bandNodes) {
      try {
        node.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.bandNodes = [];
    if (this.pitchNode) {
      try {
        this.pitchNode.disconnect();
      } catch {
        /* fresh */
      }
    }
    let head: AudioNode = this.chainIn;
    if (this.pitchNode) {
      head.connect(this.pitchNode);
      head = this.pitchNode;
    }
    for (const spec of bands) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = spec.type;
      filter.frequency.value = spec.freqHz;
      filter.gain.value = spec.gainDb;
      filter.Q.value = spec.q;
      head.connect(filter);
      head = filter;
      this.bandNodes.push(filter);
    }
    head.connect(this.wetGain);
  }
}
