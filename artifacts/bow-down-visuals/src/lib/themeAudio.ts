const BASE = import.meta.env.BASE_URL ?? "/";
const AUDIO_SRC = `${BASE}audio/bow-down-visuals-theme.mp3`;

let _instance: HTMLAudioElement | null = null;

export function getThemeAudio(): HTMLAudioElement {
  if (!_instance) {
    _instance = new Audio(AUDIO_SRC);
    _instance.loop = true;
    _instance.preload = "metadata";
    _instance.volume = 0.65;
  }
  return _instance;
}

export { AUDIO_SRC };
