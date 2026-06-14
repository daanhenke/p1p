import type { MusicBackend, MusicTrack } from "./types.js";

export function createWebAudioBackend(): MusicBackend {
  let audio: HTMLAudioElement | null = null;
  let onEnded: (() => void) | null = null;

  function ensure() {
    if (!audio) {
      audio = new Audio();
      audio.loop = false; // looping/advancement is driven by the onEnded callback
      audio.onended = () => onEnded?.();
    }
    return audio;
  }

  return {
    id: "webaudio",
    label: "Web Audio (mp3 / ogg / wav)",

    async play(track: MusicTrack) {
      const el = ensure();
      el.src = track.url;
      el.load();
      await el.play().catch(() => {
        // Autoplay may be blocked — ignore, the mute toggle lets the user kick it off
      });
    },

    stop() {
      audio?.pause();
      if (audio) audio.currentTime = 0;
    },

    setVolume(vol: number) {
      ensure().volume = Math.max(0, Math.min(1, vol));
    },

    setOnEnded(cb: () => void) {
      onEnded = cb;
    },

    dispose() {
      audio?.pause();
      audio = null;
    },
  };
}
