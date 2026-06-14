<script setup lang="ts">
import { ref } from "vue";
import type { MusicTrack, MusicBackendId } from "../music/types.js";
import type { UseMusicReturn } from "../useMusic.js";

const props = defineProps<{
  music: UseMusicReturn;
  tracks: MusicTrack[];
}>();

const open = ref(false);
const selectedBackend = ref<MusicBackendId>("psf");

function playTrack(track: MusicTrack) {
  void props.music.play({ ...track, backend: selectedBackend.value });
}
</script>

<template>
  <div class="music-debug">
    <button type="button" class="toggle-btn" @click="open = !open">🎵 Music Debug</button>
    <div v-if="open" class="panel">
      <div class="panel-head">
        <b>Music Debug</b>
        <button type="button" class="close-btn" @click="open = false">✕</button>
      </div>
      <div class="section">
        <div class="row">
          <span class="lbl">Backend</span>
          <select v-model="selectedBackend">
            <option value="webaudio">WebAudio (mp3 / ogg)</option>
            <option value="psf">PSF (PlayStation)</option>
          </select>
        </div>
        <div class="row">
          <span class="lbl">Status</span>
          <span :class="{ err: music.error.value }">
            {{ music.error.value ?? (music.isPlaying.value ? `▶ ${music.currentTrack.value?.label}` : "stopped") }}
          </span>
        </div>
      </div>
      <div class="tracks">
        <div
          v-for="t in tracks"
          :key="t.id"
          class="track-row"
          :class="{ playing: music.currentTrack.value?.id === t.id }"
          @click="playTrack(t)"
        >
          <span class="indicator">{{ music.currentTrack.value?.id === t.id ? "▶" : "○" }}</span>
          <span class="track-label">{{ t.label }}</span>
          <span class="backend-tag">{{ t.backend ?? "psf" }}</span>
        </div>
      </div>
      <div class="actions">
        <button type="button" @click="music.stop()">■ Stop</button>
        <label class="vol-label">
          Vol
          <input
            type="range" min="0" max="1" step="0.05"
            :value="music.volume.value"
            @input="music.volume.value = +($event.target as HTMLInputElement).value"
          />
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.music-debug { position: fixed; bottom: 12px; left: 12px; z-index: 9999; font-family: monospace; font-size: 11px; }
.toggle-btn {
  background: rgba(0,0,0,0.75); color: #fff;
  border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
  padding: 4px 8px; cursor: pointer; font: inherit; min-height: unset;
}
.panel {
  position: absolute; bottom: 30px; left: 0; width: 320px;
  background: #1a1a2e; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.6);
}
.panel-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; border-bottom: 1px solid #333;
}
.close-btn { background: none; border: none; color: #aaa; cursor: pointer; font: inherit; padding: 0; min-height: unset; }
.close-btn:hover { color: #fff; }
.section { padding: 6px 8px; border-bottom: 1px solid #333; display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; align-items: center; gap: 8px; }
.lbl { width: 60px; color: #888; flex: none; }
.row select { background: #0d0d1a; color: #e0e0e0; border: 1px solid #444; padding: 2px 4px; font: inherit; flex: 1; }
.err { color: #ff6b6b; }
.tracks { max-height: 200px; overflow-y: auto; }
.track-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; }
.track-row:hover { background: rgba(255,255,255,0.07); }
.track-row.playing { background: rgba(100,180,255,0.15); }
.indicator { width: 14px; flex: none; color: #64b4ff; }
.track-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.backend-tag { font-size: 9px; color: #666; background: #222; border-radius: 2px; padding: 1px 4px; flex: none; }
.actions { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-top: 1px solid #333; }
.actions button { background: #333; color: #fff; border: 1px solid #555; padding: 2px 8px; cursor: pointer; font: inherit; min-height: unset; }
.vol-label { display: flex; align-items: center; gap: 4px; flex: 1; color: #888; }
.vol-label input { flex: 1; accent-color: #64b4ff; }
</style>
