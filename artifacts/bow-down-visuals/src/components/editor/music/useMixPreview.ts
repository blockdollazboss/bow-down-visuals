import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioMixEngine, type EngineSnapshot, type EngineStem, type EngineMaster } from "@/lib/audio-engine";
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

  if (!engineRef.current) engineRef.current = new AudioMixEngine();

  useEffect(() => {
    const engine = engineRef.current!;
    engine.subscribe(setSnap);
    return () => engine.dispose();
  }, []);

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
