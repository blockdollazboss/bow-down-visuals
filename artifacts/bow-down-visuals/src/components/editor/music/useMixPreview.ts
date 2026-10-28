import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioMixEngine, type EngineSnapshot, type EngineStem, type EngineMaster } from "@/lib/audio-engine";
import { usePlaybackArbiter, MIX_PLAYBACK_ID } from "@/lib/playback-arbiter";
import type { AudioStem, MasterSettings } from "@/lib/editor-settings";

function toEngineStems(stems: AudioStem[]): EngineStem[] {
  return stems
    .filter((s) => s.url)
    .map((s) => ({
      id: s.id,
      url: s.url,
      volume: s.volume,
      pan: s.pan,
      muted: s.muted,
      solo: s.solo,
      startTime: s.startTime,
      trimStart: s.trimStart,
      trimEnd: s.trimEnd,
      effects: s.effects,
      ...(s.fxChain.length > 0 ? { fxChain: s.fxChain } : {}),
    }));
}

function toEngineMaster(master: MasterSettings): EngineMaster {
  return {
    volume: master.volume,
    fadeIn: master.fadeIn,
    fadeOut: master.fadeOut,
    compression: master.compression,
    stereoWidth: master.stereoWidth,
    bassBoost: master.bassBoost,
    eqTone: master.eqTone,
    loudnessTarget: master.loudnessTarget,
    limiter: master.limiter,
  };
}

const INITIAL: EngineSnapshot = {
  playState: "stopped",
  loading: false,
  position: 0,
  duration: 0,
  errors: [],
  ready: false,
  panSupported: true,
};

export interface MixPreview extends EngineSnapshot {
  hasStems: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  toggle: () => void;
}

/** Browser-only multi-track preview playback for the Music Studio. */
export function useMixPreview(stems: AudioStem[], master: MasterSettings): MixPreview {
  const engineRef = useRef<AudioMixEngine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot>(INITIAL);
  const snapRef = useRef<EngineSnapshot>(INITIAL);
  const arbiter = usePlaybackArbiter();

  if (!engineRef.current) engineRef.current = new AudioMixEngine();

  useEffect(() => {
    const engine = engineRef.current!;
    engine.subscribe((s) => {
      snapRef.current = s;
      setSnap(s);
    });
    return () => engine.dispose();
  }, []);

  /* ── Playback arbiter registration ─────────────────────────────────────
   * The mix engine is the editor's second playback engine. Registered
   * with the page's arbiter, it yields (is paused) the moment the master
   * timeline player starts, and starting a mix audition pauses the
   * master in return — the two can never sound at once. Outside the
   * editor there is no arbiter in context and this is a no-op. */
  useEffect(() => {
    if (!arbiter) return;
    return arbiter.register({
      id: MIX_PLAYBACK_ID,
      isPlaying: () => snapRef.current.playState === "playing",
      pause: () => engineRef.current?.pause(),
    });
  }, [arbiter]);

  useEffect(() => {
    if (!arbiter) return;
    if (snap.playState === "playing") arbiter.notifyPlaying(MIX_PLAYBACK_ID);
    else arbiter.notifyStopped(MIX_PLAYBACK_ID);
  }, [snap.playState, arbiter]);

  const engineStems = useMemo(() => toEngineStems(stems), [stems]);
  const engineMaster = useMemo(() => toEngineMaster(master), [master]);

  useEffect(() => {
    engineRef.current?.sync(engineStems, engineMaster);
  }, [engineStems, engineMaster]);

  const play = useCallback(() => {
    void engineRef.current?.play();
  }, []);
  const pause = useCallback(() => engineRef.current?.pause(), []);
  const stop = useCallback(() => engineRef.current?.stop(), []);
  const toggle = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (snap.playState === "playing") engine.pause();
    else void engine.play();
  }, [snap.playState]);

  return {
    ...snap,
    hasStems: engineStems.length > 0,
    play,
    pause,
    stop,
    toggle,
  };
}
