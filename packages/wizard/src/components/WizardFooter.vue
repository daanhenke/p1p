<script setup lang="ts">
import { computed } from "vue";
import { useTheme } from "../useTheme.js";

const props = defineProps<{
  canBack: boolean;
  canNext: boolean;
  nextLabel: string;
  building?: boolean;
  nowPlaying?: string | null;
}>();
defineEmits<{ back: []; next: []; cancel: [] }>();

const { theme } = useTheme();

// One repeat of the ticker text (with a trailing gap). The marquee renders two copies and scrolls
// by exactly one copy width, so the loop is seamless.
const GAP = "      ";
const copy = computed(() => (props.nowPlaying ? `♪ ${props.nowPlaying}${GAP}` : ""));

// Win7 scrolls smoothly; every other theme ticks character-by-character (steps == char count, with
// the monospace ticker font this advances exactly one glyph per step — an old LED-display feel).
// Only the duration/timing vary, via CSS variables — the `animation` (and its @keyframes) stay in
// the scoped block so Vue keeps the keyframe name consistent (an inline `animation` would reference
// the un-renamed name and never run).
const tickerStyle = computed(() => {
  if (!props.nowPlaying) return {};
  const chars = copy.value.length;
  // Slightly more ticks than characters → sub-character steps, a finer LED-ticker feel.
  const ticks = Math.round(chars * 1.75);
  return {
    "--ticker-dur": `${Math.max(6, chars * 0.32)}s`,
    "--ticker-timing": theme.value === "7" ? "linear" : `steps(${ticks})`,
  };
});
</script>

<template>
  <div class="wizard-foot">
    <div class="hr" />
    <div class="foot-bar">
      <!-- now-playing ticker: fixed-width, scrolling — opposite the button group; only present while
           a track is actually playing -->
      <div v-if="nowPlaying" class="now-playing">
        <div class="ticker" :style="tickerStyle">
          <span class="ticker-text">{{ copy }}</span>
          <span class="ticker-text" aria-hidden="true">{{ copy }}</span>
        </div>
      </div>
      <div class="foot-btns">
        <button type="button" :disabled="!canBack" @click="$emit('back')">&lt; Back</button>
        <button type="button" :disabled="!canNext" @click="$emit('next')">{{ nextLabel }}</button>
        <button type="button" class="cancel-btn" :disabled="building" @click="$emit('cancel')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-foot { padding-top: 2px; }
.hr { border-top: 1px solid #808080; border-bottom: 1px solid #fff; }
.foot-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; }

/* fixed-width scrolling track-name ticker */
.now-playing {
  flex: none;
  width: 168px;
  overflow: hidden;
  white-space: nowrap;
  font-family: "Courier New", monospace;
  font-size: 11px;
  color: #000080;
}
.ticker {
  display: inline-flex; width: max-content;
  animation: ticker-scroll var(--ticker-dur, 12s) var(--ticker-timing, linear) infinite;
}
.ticker-text { display: inline-block; white-space: pre; }
@keyframes ticker-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}

/* buttons always sit on the right, whether or not the ticker is present */
.foot-btns { display: flex; gap: 6px; margin-left: auto; }
.foot-btns button { min-width: 82px; }
.cancel-btn { margin-left: 8px; }

@media (max-width: 560px) {
  .now-playing { width: 96px; }
}
</style>
