<script setup lang="ts">
import type { ChangelogEntry } from "../types.js";
defineProps<{ entries: ChangelogEntry[] }>();
</script>

<template>
  <div class="changelog sunken-panel">
    <div v-for="rel in entries" :key="rel.version" class="release">
      <div class="rel-head">
        <b>Version {{ rel.version }}</b>
        <span>{{ rel.date }}</span>
      </div>
      <ul>
        <li v-for="(n, i) in rel.notes" :key="i">{{ n }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.changelog { flex: 1; min-height: 0; overflow: auto; background: #fff; padding: 10px 12px; line-height: 1.45; }
.release { margin-bottom: 13px; }
.release:last-child { margin-bottom: 0; }
.rel-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #c0c0c0; padding-bottom: 3px; margin-bottom: 5px; }
.rel-head span { color: #666; }
.changelog ul { margin: 0; padding-left: 17px; }
.changelog li { margin: 0 0 4px; }
</style>
