/**
 * audio-mixer.ts — the parity studio's audio mixer.
 *
 * Every sound source gets a channel: a gain (the fader) and an analyser
 * (the meter), summed into a master gain, out to a single
 * MediaStreamAudioDestinationNode — that mixed track is the published
 * stream's audio. Channels today: the mic (the VoiceIsolator's cleaned /
 * effected output, wired in from the BackgroundChanger's output stream)
 * and the screen share's audio when the browser grants it. Adding a
 * channel is addInput + setInputStream; nothing else changes.
 *
 * The graph is rebuilt per input when its stream changes (the kit swaps
 * its audio track when the mic device or noise-cancellation level
 * changes) — setInputStream is cheap and idempotent.
 */

export interface MixerInputState {
  volume: number; // 0..1
  muted: boolean;
}

interface Channel {
  gain: GainNode;
  analyser: AnalyserNode;
  src: MediaStreamAudioSourceNode | null;
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
  volume: number;
  muted: boolean;
}

export type AudioContextFactory = () => AudioContext;

export class AudioMixer {
  ctx: AudioContext;
  private _dest: MediaStreamAudioDestinationNode;
  private _master: GainNode;
  private _masterAnalyser: AnalyserNode;
  private _masterVolume = 1;
  private _masterMuted = false;
  private _channels = new Map<string, Channel>();

  constructor(createContext: AudioContextFactory = () => new AudioContext({ latencyHint: "interactive" })) {
    this.ctx = createContext();
    this._master = this.ctx.createGain();
    this._master.gain.value = 1;
    this._masterAnalyser = this.ctx.createAnalyser();
    this._masterAnalyser.fftSize = 1024;
    this._masterAnalyser.smoothingTimeConstant = 0.55;
    this._dest = this.ctx.createMediaStreamDestination();
    this._master.connect(this._masterAnalyser);
    this._masterAnalyser.connect(this._dest);
  }

  addInput(id: string): void {
    if (this._channels.has(id)) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    gain.connect(analyser);
    analyser.connect(this._master);
    this._channels.set(id, { gain, analyser, src: null, stream: null, track: null, volume: 1, muted: false });
  }

  removeInput(id: string): void {
    const ch = this._channels.get(id);
    if (!ch) return;
    ch.src?.disconnect();
    ch.gain.disconnect();
    ch.analyser.disconnect();
    this._channels.delete(id);
  }

  hasInput(id: string): boolean {
    return this._channels.has(id);
  }

  /**
   * Point a channel at a stream (its first audio track is the source).
   * Rewires when the stream OR its audio track changes — the kit swaps
   * its output track in place when the mic device or NC level changes.
   */
  setInputStream(id: string, stream: MediaStream | null): void {
    if (!this._channels.has(id)) this.addInput(id);
    const ch = this._channels.get(id)!;
    const track = stream?.getAudioTracks()[0] ?? null;
    if (ch.stream === stream && ch.track === track) return;
    ch.src?.disconnect();
    ch.src = null;
    ch.stream = stream;
    ch.track = track;
    if (stream && track) {
      ch.src = this.ctx.createMediaStreamSource(stream);
      ch.src.connect(ch.gain);
    }
  }

  setVolume(id: string, volume: number): void {
    const ch = this._channels.get(id);
    if (!ch) return;
    ch.volume = Math.min(1, Math.max(0, volume));
    if (!ch.muted) ch.gain.gain.value = ch.volume;
  }

  setMuted(id: string, muted: boolean): void {
    const ch = this._channels.get(id);
    if (!ch) return;
    ch.muted = muted;
    ch.gain.gain.value = muted ? 0 : ch.volume;
  }

  getInputState(id: string): MixerInputState | null {
    const ch = this._channels.get(id);
    return ch ? { volume: ch.volume, muted: ch.muted } : null;
  }

  setMasterVolume(volume: number): void {
    this._masterVolume = Math.min(1, Math.max(0, volume));
    if (!this._masterMuted) this._master.gain.value = this._masterVolume;
  }

  setMasterMuted(muted: boolean): void {
    this._masterMuted = muted;
    this._master.gain.value = muted ? 0 : this._masterVolume;
  }

  get masterState(): MixerInputState {
    return { volume: this._masterVolume, muted: this._masterMuted };
  }

  /** Analyser for a channel's meter ('master' for the mix bus). */
  getAnalyser(id: string): AnalyserNode | null {
    if (id === "master") return this._masterAnalyser;
    return this._channels.get(id)?.analyser ?? null;
  }

  /** The mixed output as a stream / single track — the publishable audio. */
  getStream(): MediaStream {
    return this._dest.stream;
  }
  getOutputTrack(): MediaStreamTrack | null {
    return this._dest.stream.getAudioTracks()[0] ?? null;
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);
  }

  async close(): Promise<void> {
    for (const id of [...this._channels.keys()]) this.removeInput(id);
    try {
      await this.ctx.close();
    } catch {
      /* already closed */
    }
  }
}
