<script setup lang="ts">
import { useTheme } from "../useTheme.js";
const { theme, themes, setTheme } = useTheme();
</script>

<template>
  <div class="theme-switcher">
    <div class="ts-label">Theme</div>
    <div class="ts-btns">
      <button
        v-for="t in themes"
        :key="t.id"
        type="button"
        :class="{ active: theme === t.id }"
        @click="setTheme(t.id)"
      >{{ t.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.theme-switcher {
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  border-radius: 4px;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 11px;
  user-select: none;
}
.ts-label { opacity: 0.7; flex: none; }
.ts-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.ts-btns button {
  background: rgba(255,255,255,0.15);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.35);
  border-radius: 3px;
  padding: 2px 7px;
  font: inherit;
  cursor: pointer;
  min-height: unset;
  min-width: unset;
}
.ts-btns button.active {
  background: rgba(255,255,255,0.85);
  color: #000;
}
</style>
