import { ref, watch, onUnmounted } from "vue";
import type { MusicBackend, MusicBackendId, MusicTrack } from "./music/types.js";
import { createWebAudioBackend } from "./music/webaudio.js";
import { createWebpsxBackend } from "./music/webpsx.js";

export type PlayOrder = "sequential" | "shuffle";

const BACKENDS: Record<MusicBackendId, () => MusicBackend> = {
  webaudio: createWebAudioBackend,
  psf: createWebpsxBackend,
};

function inferBackend(url: string): MusicBackendId {
  return url.endsWith(".psf") || url.endsWith(".minipsf") || url.endsWith(".psflib") ? "psf" : "webaudio";
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useMusic(initialTrack?: MusicTrack) {
  const muted = ref(false);
  const volume = ref(0.7);
  const currentTrack = ref<MusicTrack | null>(initialTrack ?? null);
  const isPlaying = ref(false);
  const error = ref<string | null>(null);
  const activeBackendId = ref<MusicBackendId>("webaudio");

  // Playlist state — empty for one-off plays. On track end we advance (or replay a single track).
  let queue: MusicTrack[] = [];
  let queueIdx = 0;

  let backend: MusicBackend = createWebAudioBackend();

  function getBackend(id: MusicBackendId): MusicBackend {
    if (backend.id !== id) {
      backend.dispose();
      backend = BACKENDS[id]();
    }
    return backend;
  }

  function onTrackEnded() {
    if (queue.length > 1) {
      queueIdx = (queueIdx + 1) % queue.length;
      void play(queue[queueIdx]);
    } else if (currentTrack.value) {
      void play(currentTrack.value); // loop a single track
    }
  }

  async function play(track: MusicTrack) {
    error.value = null;
    const bid = track.backend ?? inferBackend(track.url);
    activeBackendId.value = bid;
    const b = getBackend(bid);
    b.setVolume(muted.value ? 0 : volume.value);
    b.setOnEnded(onTrackEnded);
    try {
      await b.play(track);
      currentTrack.value = track;
      isPlaying.value = true;
    } catch (e) {
      error.value = (e as Error).message;
      isPlaying.value = false;
    }
  }

  /** Play a list of tracks back-to-back. With one track it simply loops; `shuffle` randomises. */
  async function playPlaylist(tracks: MusicTrack[], order: PlayOrder = "sequential") {
    if (!tracks.length) return;
    queue = order === "shuffle" ? shuffled(tracks) : tracks.slice();
    queueIdx = 0;
    await play(queue[0]);
  }

  /** Skip to the next track in the current playlist (no-op when not playing a multi-track list). */
  function next() {
    if (queue.length > 1) {
      queueIdx = (queueIdx + 1) % queue.length;
      void play(queue[queueIdx]);
    }
  }

  function stop() {
    queue = [];
    backend.stop();
    isPlaying.value = false;
  }

  function toggleMute() {
    muted.value = !muted.value;
    backend.setVolume(muted.value ? 0 : volume.value);
  }

  watch(volume, (v) => { if (!muted.value) backend.setVolume(v); });

  onUnmounted(() => backend.dispose());

  return { muted, volume, currentTrack, isPlaying, error, activeBackendId, play, playPlaylist, next, stop, toggleMute };
}

export type UseMusicReturn = ReturnType<typeof useMusic>;
