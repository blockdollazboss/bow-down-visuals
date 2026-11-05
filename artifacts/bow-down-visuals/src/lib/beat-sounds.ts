/* ── Beat sound registry — what each sequencer track can play (W2-L2) ──
 * The sequencer's nine drum tracks used to be 100% synthesized Web Audio
 * (synthHit/noiseBurst in components/audio-studio/AiAudio.tsx) with no file input anywhere:
 * a sample a creator made or downloaded could not be loaded onto a track.
 *
 * This module is the registry every sound flows through:
 *   • the CURRENT nine synthesized voices, registered as built-in entries
 *     (they wrap the existing synthHit recipes by key — the recipes are
 *     NOT rewritten or moved; playback still calls synthHit for them);
 *   • a "bank" source for the owner's rendered sound bank, registered
 *     from lib/beat-sound-bank.ts (generated manifest: 316 original
 *     synthesized sounds — six drum kits, tuned 808s/basses/melodic
 *     sets, FX — served as static files under /sound-bank/). AiAudio
 *     calls registerBankSounds() once at module load and consumers —
 *     the picker, the transport, the offline render — pick the sounds
 *     up with NO code changes;
 *   • an "upload" source for a signed-in creator's own audio file,
 *     decoded in the browser and held in memory (an object URL +
 *     AudioBuffer in this module). The assignment (the sound id +
 *     display name) persists in the beat project. The bytes persist
 *     too when the file is saved to the creator's sound library
 *     (stack1500 beat persistence: /api/beat-samples stores them in
 *     R2 and lib/beat-sample-library.ts registers the durable
 *     `upload:<sample id>` entries, URL attached, through the manifest
 *     seam below; buffers then load on demand via
 *     ensureBeatSampleBuffer). An upload that was never saved — or
 *     whose bytes can't load in this session — still reports the
 *     honest fallback after a reload and playback uses the track's
 *     built-in synth voice — never a silent dead track.
 *
 * Pure UI = FREE. No charges, no provider calls, no sound generation.
 */

/** The nine sequencer track kinds — the only kinds a track, a built-in
 *  synth voice or a creator upload may carry. */
export type BeatTrackKind =
  | "kick" | "snare" | "clap" | "chat" | "ohat"
  | "b808" | "perc" | "shk" | "crash";

/** Every kind a registry entry may carry: the nine track kinds plus
 *  the bank-only kinds ("bass" | "melodic" | "fx") — they name what a
 *  bank sound is, never a sequencer track. BEAT_TRACK_KINDS below
 *  stays the nine track kinds and every track-indexed helper
 *  (defaults, clamping, fallback) keeps working off it alone. Tuned
 *  808s register as "b808", the 808 track's own kind. */
export type BeatSoundKind = BeatTrackKind | "bass" | "melodic" | "fx";

/** Track order — index i of a beat project grid/mixer/sound array is
 *  BEAT_TRACK_KINDS[i]. Mirrors TRACKS in components/audio-studio/AiAudio.tsx. */
export const BEAT_TRACK_KINDS: BeatTrackKind[] = [
  "kick", "snare", "clap", "chat", "ohat", "b808", "perc", "shk", "crash",
];

export type BeatSoundSource = "synth" | "bank" | "upload";

export interface BeatSoundEntry {
  /** Stable id, namespaced by source: "synth:kick", "bank:…", "upload:…". */
  id: string;
  /** Display name shown in the track sound picker. */
  name: string;
  kind: BeatSoundKind;
  source: BeatSoundSource;
  /** Synth voice key — the TrackId synthHit() switches on. Present iff
   *  source === "synth". Always a track kind. */
  synthKey?: BeatTrackKind;
  /** Audio URL for a sample-backed sound (bank asset or upload object
   *  URL). Present for bank entries; upload entries carry their session
   *  object URL. Sample playback rate/pitch is always 1.0 in this lane. */
  url?: string;
  /** Playback gain multiplier applied on top of step velocity/accent.
   *  Defaults to 1. */
  defaultVolume: number;
  /** Sound-bank metadata (bank entries only): the bank's own category,
   *  so the registered bank keeps its shape — six drum kits, tuned
   *  808/bass/melodic sets, FX — instead of flattening into track
   *  kinds. Absent on synth voices and uploads. */
  bankCategory?: "drums" | "808" | "bass" | "melodic" | "fx";
  /** Drum kit a bank drum belongs to ("core" | "trap" | "drill" |
   *  "boombap" | "afrobeats" | "house"). Bank drums only. */
  kit?: string;
  /** Instrument family of a tuned/FX bank sound ("keys", "sub", …). */
  instrument?: string;
  /** Named note of a tuned bank sound ("C#1", "A4", …). */
  note?: string;
  /** MIDI note number of a tuned bank sound (0–127). */
  midi?: number;
}

export type BeatSoundManifestEntry = Omit<BeatSoundEntry, "defaultVolume"> & {
  defaultVolume?: number;
};

const KIND_SET = new Set<string>([
  ...BEAT_TRACK_KINDS,
  // Bank-only kinds (see BeatSoundKind) — valid on manifest entries,
  // never on a sequencer track.
  "bass", "melodic", "fx",
]);
const SOURCE_SET = new Set<string>(["synth", "bank", "upload"]);
const BANK_CATEGORY_SET = new Set<string>(["drums", "808", "bass", "melodic", "fx"]);

export function isBeatSoundKind(v: unknown): v is BeatSoundKind {
  return typeof v === "string" && KIND_SET.has(v);
}

/* ─── Built-in synthesized voices ────────────────────────────────────────
 * Names are the track names the sequencer already shows. These entries
 * wrap the existing synthHit voices by key; no recipe lives here. */

const BUILTIN_DEFS: Array<{ kind: BeatTrackKind; name: string }> = [
  { kind: "kick", name: "Kick" },
  { kind: "snare", name: "Snare" },
  { kind: "clap", name: "Clap" },
  { kind: "chat", name: "Closed Hat" },
  { kind: "ohat", name: "Open Hat" },
  { kind: "b808", name: "808" },
  { kind: "perc", name: "Perc" },
  { kind: "shk", name: "Shaker" },
  { kind: "crash", name: "Crash" },
];

export const BUILTIN_BEAT_SOUNDS: BeatSoundEntry[] = BUILTIN_DEFS.map((d) => ({
  id: `synth:${d.kind}`,
  name: d.name,
  kind: d.kind,
  source: "synth" as const,
  synthKey: d.kind,
  defaultVolume: 1,
}));

export function defaultSoundIdForKind(kind: BeatTrackKind): string {
  return `synth:${kind}`;
}

/** Built-in synth sound id for a track index (clamped into range). */
export function defaultSoundIdForTrack(trackIndex: number): string {
  const kind = BEAT_TRACK_KINDS[clampTrackIndex(trackIndex)]!;
  return defaultSoundIdForKind(kind);
}

export function clampTrackIndex(trackIndex: number): number {
  if (!Number.isFinite(trackIndex)) return 0;
  return Math.max(0, Math.min(BEAT_TRACK_KINDS.length - 1, Math.floor(trackIndex)));
}

export function kindForTrack(trackIndex: number): BeatTrackKind {
  return BEAT_TRACK_KINDS[clampTrackIndex(trackIndex)]!;
}

/* ─── Registry ───────────────────────────────────────────────────────────
 * Built-ins are immutable and always present. Bank + upload entries are
 * registered at runtime (bank manifest after Nov 5; uploads per session)
 * into a map keyed by id; registering an id that already exists as a
 * non-built-in replaces it, built-in ids can never be shadowed. */

const registered = new Map<string, BeatSoundEntry>();

function normalizeManifestEntry(raw: unknown): BeatSoundEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BeatSoundManifestEntry>;
  if (typeof r.id !== "string" || r.id.trim() === "" || r.id.length > 200) return null;
  if (typeof r.name !== "string" || r.name.trim() === "") return null;
  if (!isBeatSoundKind(r.kind)) return null;
  if (typeof r.source !== "string" || !SOURCE_SET.has(r.source)) return null;
  if (r.source === "synth") {
    // Only the built-ins are synth voices; a manifest may not mint or
    // shadow a synth entry (its recipes live in synthHit, by key).
    return null;
  }
  if (r.source === "bank" && (typeof r.url !== "string" || r.url.trim() === "")) {
    return null; // a bank sound without an audio URL can never play
  }
  const vol =
    typeof r.defaultVolume === "number" && Number.isFinite(r.defaultVolume)
      ? Math.min(1.5, Math.max(0, r.defaultVolume))
      : 1;
  // Bank metadata passes through only when it validates — a malformed
  // optional field is dropped, never a reason to reject the sound.
  const shortText = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" && v.length <= 60 ? v.trim() : undefined;
  return {
    id: r.id.trim(),
    name: r.name.trim().slice(0, 120),
    kind: r.kind,
    source: r.source,
    ...(typeof r.url === "string" && r.url.trim() !== "" ? { url: r.url.trim() } : {}),
    defaultVolume: vol,
    ...(typeof r.bankCategory === "string" && BANK_CATEGORY_SET.has(r.bankCategory)
      ? { bankCategory: r.bankCategory as BeatSoundEntry["bankCategory"] }
      : {}),
    ...(shortText(r.kit) ? { kit: shortText(r.kit) } : {}),
    ...(shortText(r.instrument) ? { instrument: shortText(r.instrument) } : {}),
    ...(shortText(r.note) ? { note: shortText(r.note) } : {}),
    ...(typeof r.midi === "number" && Number.isInteger(r.midi) && r.midi >= 0 && r.midi <= 127
      ? { midi: r.midi }
      : {}),
  };
}

/** Register a manifest of bank (or upload) sounds. Returns how many
 *  entries were accepted. Invalid entries and attempts to shadow a
 *  built-in synth id are skipped, never thrown — a bad bank manifest
 *  must not break the sequencer. This is THE seam the post–Nov 5
 *  rendered bank uses: registerBeatSoundManifest(bankManifest) once at
 *  app/sequencer load, no consumer changes needed. */
export function registerBeatSoundManifest(entries: readonly unknown[]): number {
  let accepted = 0;
  for (const raw of entries ?? []) {
    const entry = normalizeManifestEntry(raw);
    if (!entry) continue;
    if (BUILTIN_BEAT_SOUNDS.some((b) => b.id === entry.id)) continue;
    registered.set(entry.id, entry);
    accepted++;
  }
  return accepted;
}

/** Short alias for the bank's registration call, as named in the lane
 *  brief: registerManifest(manifestEntries). Same function. */
export const registerManifest = registerBeatSoundManifest;

/** Remove one registered (non-built-in) entry + any decoded buffer. */
export function unregisterBeatSound(id: string): boolean {
  sampleBuffers.delete(id);
  return registered.delete(id);
}

/** Test/maintenance helper: drop every registered entry + buffer. */
export function clearRegisteredBeatSounds(): void {
  registered.clear();
  sampleBuffers.clear();
}

export function getBeatSound(id: string | null | undefined): BeatSoundEntry | null {
  if (typeof id !== "string" || id === "") return null;
  return BUILTIN_BEAT_SOUNDS.find((b) => b.id === id) ?? registered.get(id) ?? null;
}

export function isKnownBeatSoundId(id: string | null | undefined): boolean {
  return getBeatSound(id) != null;
}

export function listBeatSounds(): BeatSoundEntry[] {
  return [...BUILTIN_BEAT_SOUNDS, ...registered.values()];
}

export function listBeatSoundsByKind(kind: BeatSoundKind): BeatSoundEntry[] {
  return listBeatSounds().filter((s) => s.kind === kind);
}

export function listBeatSoundsBySource(source: BeatSoundSource): BeatSoundEntry[] {
  return listBeatSounds().filter((s) => s.source === source);
}

/** True once a bank manifest has been registered — AiAudio registers
 *  the rendered bank at module load, so the picker's bank section is
 *  populated wherever the sequencer is; before registration it renders
 *  its bank section honestly empty. */
export function hasBankSounds(): boolean {
  return listBeatSoundsBySource("bank").length > 0;
}

/* ─── Resolution + honest fallback ─────────────────────────────────────── */

export type BeatSoundFallbackReason = "unknown-sound" | "missing-buffer";

export interface ResolvedBeatSound {
  /** The sound that will actually play. */
  entry: BeatSoundEntry;
  /** True when the assigned sound could not play and the track's
   *  built-in synth voice was substituted. */
  fellBack: boolean;
  reason?: BeatSoundFallbackReason;
}

/** Resolve a track's assigned sound id to the entry that should play.
 *  Unknown ids fall back to the track's synth default. Sample-backed
 *  entries (bank/upload) whose decoded buffer is not available in this
 *  session ALSO fall back — with reason "missing-buffer" — so the UI
 *  can say so and the track is never silently dead. Bank entries with a
 *  URL but no buffer yet are playable-in-principle: callers that can
 *  load on demand (ensureBeatSampleBuffer) should do so first; the
 *  synchronous transport treats a not-yet-loaded bank buffer as
 *  missing rather than dropping the hit silently… it plays the synth
 *  fallback for that hit until the buffer lands. */
export function resolveTrackSound(
  soundId: string | null | undefined,
  trackIndex: number,
  hasBuffer: (entry: BeatSoundEntry) => boolean = hasSampleBuffer,
): ResolvedBeatSound {
  const fallbackEntry = BUILTIN_BEAT_SOUNDS[clampTrackIndex(trackIndex)]!;
  const entry = getBeatSound(soundId);
  if (!entry) return { entry: fallbackEntry, fellBack: true, reason: "unknown-sound" };
  if (entry.source === "synth") return { entry, fellBack: false };
  if (!hasBuffer(entry)) return { entry: fallbackEntry, fellBack: true, reason: "missing-buffer" };
  return { entry, fellBack: false };
}

/** The sound id that survives normalization for a track: any non-empty
 *  string id is kept (a bank id saved before its manifest registers on
 *  a later load must not be erased); anything else defaults to the
 *  track's synth voice. Play-time fallback is resolveTrackSound's job. */
export function normalizeTrackSoundId(raw: unknown, trackIndex: number): string {
  if (typeof raw === "string" && raw.trim() !== "" && raw.length <= 200) return raw;
  return defaultSoundIdForTrack(trackIndex);
}

/* ─── Session sample buffers (decoded audio, in memory only) ──────────── */

const sampleBuffers = new Map<string, AudioBuffer>();

export function setSampleBuffer(soundId: string, buffer: AudioBuffer): void {
  sampleBuffers.set(soundId, buffer);
}

export function getSampleBuffer(soundId: string): AudioBuffer | null {
  return sampleBuffers.get(soundId) ?? null;
}

export function hasSampleBuffer(entry: BeatSoundEntry): boolean {
  return sampleBuffers.has(entry.id);
}

/** A region of a buffer to play instead of the whole buffer — the
 *  slice unit (W3b, lib/beat-pads.ts). Seconds, resolved against the
 *  decoded buffer at schedule time. */
export interface BeatSampleRegion {
  offset: number;
  duration: number;
}

/** Schedule one sample hit through the caller's per-track gain path.
 *  The caller owns velocity/accent: it passes a destination whose gain
 *  already carries vel × defaultVolume (the same node synth hits use),
 *  so mixer/velocity behavior is identical for samples and synths.
 *  Playback rate stays 1.0 — no stretch/pitch features in this lane.
 *  With a `region` (a slice), only that span of the buffer plays —
 *  the live transport and the offline render pass the same region, so
 *  a slice sounds identical in playback and in every export. An
 *  invalid region is ignored (the whole buffer plays) rather than
 *  scheduling silence. Returns false when no buffer is available
 *  (caller falls back). */
export function playSampleBuffer(
  ctx: BaseAudioContext,
  entry: BeatSoundEntry,
  t: number,
  dest: AudioNode,
  region?: BeatSampleRegion | null,
): boolean {
  const buffer = sampleBuffers.get(entry.id);
  if (!buffer) return false;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 1.0;
  src.connect(dest);
  if (
    region &&
    Number.isFinite(region.offset) &&
    Number.isFinite(region.duration) &&
    region.offset >= 0 &&
    region.duration > 0 &&
    region.offset < buffer.duration
  ) {
    src.start(t, region.offset, region.duration);
  } else {
    src.start(t);
  }
  return true;
}

/** Load + decode a sample-backed entry's URL into the session buffer
 *  cache (bank sounds on first use). Uploads are decoded directly from
 *  the file instead (registerUploadSound). Failures resolve to null —
 *  callers keep the synth fallback, never a dead track. */
export async function ensureBeatSampleBuffer(
  entry: BeatSoundEntry,
  ctx: BaseAudioContext,
  fetcher: (url: string) => Promise<ArrayBuffer> = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`sample fetch ${res.status}`);
    return res.arrayBuffer();
  },
): Promise<AudioBuffer | null> {
  const existing = sampleBuffers.get(entry.id);
  if (existing) return existing;
  if (!entry.url) return null;
  try {
    const raw = await fetcher(entry.url);
    // decodeAudioData detaches the buffer on some engines — copy first.
    const buffer = await ctx.decodeAudioData(raw.slice(0));
    sampleBuffers.set(entry.id, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/* ─── User uploads (session-scoped) ────────────────────────────────────── */

let uploadCounter = 0;

/** A fresh, collision-free upload sound id for this session. */
export function createUploadSoundId(): string {
  uploadCounter += 1;
  return `upload:${Date.now().toString(36)}-${uploadCounter}`;
}

/** Register a decoded user file as a track-playable upload sound.
 *  The entry + buffer live in this session's memory; the beat project
 *  persists just the id + name (see lib/beat-project.ts). When the
 *  file is saved to the creator's library (lib/beat-sample-library.ts)
 *  the page re-registers the same decoded buffer under the durable
 *  `upload:<sample id>` with its storage URL, so the saved id keeps
 *  playing in-session and rehydrates after a reload. */
export function registerUploadSound(args: {
  id?: string;
  name: string;
  kind: BeatSoundKind;
  buffer: AudioBuffer;
  url?: string;
}): BeatSoundEntry {
  const entry: BeatSoundEntry = {
    id: args.id ?? createUploadSoundId(),
    name: args.name.trim().slice(0, 120) || "My sound",
    kind: args.kind,
    source: "upload",
    ...(args.url ? { url: args.url } : {}),
    defaultVolume: 1,
  };
  registered.set(entry.id, entry);
  sampleBuffers.set(entry.id, args.buffer);
  return entry;
}

/** Decode a user-picked audio file (WAV/MP3/…) and register it as an
 *  upload sound for `kind`. Throws on undecodable files — the caller
 *  surfaces that honestly and leaves the track's sound unchanged. */
export async function decodeAndRegisterUpload(
  file: File,
  kind: BeatSoundKind,
  ctx: BaseAudioContext,
): Promise<BeatSoundEntry> {
  const raw = await file.arrayBuffer();
  const buffer = await ctx.decodeAudioData(raw.slice(0));
  const url = typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(file)
    : undefined;
  return registerUploadSound({
    name: file.name.replace(/\.[a-z0-9]+$/i, "") || file.name,
    kind,
    buffer,
    url,
  });
}

/** Honest post-reload state for a persisted assignment: an upload (or
 *  bank) id whose entry/buffer is not in this session. The project
 *  keeps the assignment; playback falls back and the UI says so. */
export function isUnavailableSampleAssignment(
  soundId: string | null | undefined,
  trackIndex: number,
): boolean {
  if (!soundId || soundId === defaultSoundIdForTrack(trackIndex)) return false;
  const resolved = resolveTrackSound(soundId, trackIndex);
  if (!resolved.fellBack) return false;
  // A sample-backed id (upload:/bank:) that is unknown in this session
  // is the same honest state as a known entry with no buffer yet: the
  // file/bank has not loaded here, so the synth voice is standing in.
  if (resolved.reason === "missing-buffer") return true;
  return soundId.startsWith("upload:") || soundId.startsWith("bank:");
}
