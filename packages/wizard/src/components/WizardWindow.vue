<script setup lang="ts">
import { ref } from "vue";
import { useDrag } from "../useDrag.js";
import { useTheme } from "../useTheme.js";
import type { UseMusicReturn } from "../useMusic.js";

defineProps<{
  title: string;
  music?: UseMusicReturn;
}>();
const emit = defineEmits<{ cancel: [] }>();

const { elRef, style, onTitleDown } = useDrag();
const { theme } = useTheme();
const showCancel = ref(false);

function handleClose() {
  showCancel.value = true;
}
</script>

<template>
  <!-- `active` is required by 7.css/xp.css to render the focused-window chrome (colored buttons,
       button hover glow). `data-theme` lets our own frame-inset rules adapt per theme. -->
  <div ref="elRef" class="window active wizard-window" :data-theme="theme" :style="style">
    <div class="title-bar active" @pointerdown="onTitleDown">
      <div class="title-bar-text">{{ title }}</div>
      <div class="title-bar-controls">
        <!-- music mute toggle — only rendered when music is wired -->
        <button
          v-if="music"
          type="button"
          class="music-btn"
          :aria-label="music.muted.value ? 'Unmute' : 'Mute'"
          :title="music.muted.value ? 'Unmute music' : 'Mute music'"
          @click.stop="music.toggleMute()"
        >{{ music.muted.value ? "🔇" : "🔊" }}</button>
        <button aria-label="Minimize" type="button"></button>
        <button aria-label="Close" type="button" @click.stop="handleClose"></button>
      </div>
    </div>

    <div class="wizard-content">
      <slot />
    </div>

    <!-- Exit Setup confirmation -->
    <div v-if="showCancel" class="modal-backdrop" @pointerdown.self="showCancel = false">
      <div class="window active modal" :data-theme="theme">
        <div class="title-bar active">
          <div class="title-bar-text">Exit Setup</div>
          <div class="title-bar-controls">
            <button aria-label="Close" type="button" @click="showCancel = false"></button>
          </div>
        </div>
        <div class="window-body modal-body">
          <p>Setup is not complete. If you exit now, no files will be created.</p>
          <p class="modal-q">Exit Setup?</p>
          <div class="modal-btns">
            <button type="button" @click="showCancel = false; emit('cancel')">Yes</button>
            <button type="button" @click="showCancel = false">No</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-window { width: 560px; max-width: calc(100vw - 32px); user-select: none; }
.title-bar { cursor: move; touch-action: none; }
.title-bar-controls { cursor: default; }

/* The InstallShield content is full-bleed (banner touches the edges). Each theme draws its window
   frame differently, so the content must be inset to not paint over it:
   - 98:    .window has padding:3px — the content already clears the bevel, no inset needed.
   - XP:    .window draws a 3px blue frame via inset shadows — inset the sides by 3px (bottom is
            covered by the window's own 3px bottom padding).
   - 7:     .window has a 1px border + inset highlight — inset by 1px on the sides and bottom.
   - shell: flat 2px bevel via our own padding — no inset needed. */
.wizard-content { display: block; }
.wizard-window[data-theme="xp"] .wizard-content { margin: 0 3px; }
.wizard-window[data-theme="7"] .wizard-content { margin: 0 1px 1px; }

/* XP draws its 3px blue window frame as an inset shadow that overlaps the title bar's top padding,
   leaving the control buttons flush against the top edge. A taller bar with balanced padding (and a
   min-height so the 21px buttons centre cleanly) restores the headroom on top and bottom. */
.wizard-window[data-theme="xp"] .title-bar { min-height: 30px; padding: 5px 5px 4px 4px; }

/* music mute button sits inside title-bar-controls before the standard buttons */
.music-btn {
  font-size: 12px;
  line-height: 1;
  display: flex; align-items: center; justify-content: center;
}

.modal-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,32,0.35);
}
.modal { width: 320px; max-width: calc(100vw - 32px); }
.modal-body { margin: 12px 14px 14px; }
.modal-body p { margin: 0 0 10px; line-height: 1.5; }
.modal-q { font-weight: bold; }
.modal-btns { display: flex; justify-content: center; gap: 8px; margin-top: 16px; }
.modal-btns button { min-width: 80px; }

@media (max-width: 560px) {
  .wizard-window { width: 100%; }
}
</style>
