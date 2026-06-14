<script setup lang="ts">
defineProps<{
  log: string[];
  progress: number;
  error?: string | null;
  building: boolean;
  done?: string | null;
}>();
</script>

<template>
  <div class="progress-wrap">
    <div class="status">{{ building ? "Patching disc…" : error ? "Setup failed." : done ? "Done." : "" }}</div>
    <div class="progress-indicator">
      <span class="progress-indicator-bar" :style="{ width: progress + '%' }" />
    </div>
    <pre class="log sunken-panel">{{ log.join("\n") }}</pre>
    <p v-if="error" class="err">⚠ {{ error }}</p>
  </div>
</template>

<style scoped>
.progress-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.status { margin-bottom: 9px; }
.log { margin-top: 12px; flex: 1; min-height: 0; overflow: auto; background: #fff; padding: 7px 8px; font-family: "Courier New", monospace; font-size: 12px; line-height: 1.45; white-space: pre-wrap; user-select: text; }
.err { margin-top: 10px; color: #a00000; line-height: 1.4; }
</style>
