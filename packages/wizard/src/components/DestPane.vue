<script setup lang="ts">
defineProps<{
  destLabel: string;
  canPickDir: boolean;
}>();
defineEmits<{ pick: [] }>();
</script>

<template>
  <div class="dest-wrap">
    <p class="lead">Setup writes the patched <code>.bin</code> and <code>.cue</code> to the location below.</p>
    <fieldset class="dest">
      <legend>Destination Folder</legend>
      <div class="dest-row">
        <div class="dest-path sunken-panel" :title="destLabel">{{ destLabel }}</div>
        <button type="button" :disabled="!canPickDir" @click="$emit('pick')">Browse…</button>
      </div>
    </fieldset>
    <p v-if="canPickDir" class="muted dest-note">
      By default both files download to your Downloads folder — or click <b>Browse…</b> to choose a folder.
    </p>
    <p v-else class="muted dest-note">
      Both files will download to your browser's default Downloads folder.
    </p>
  </div>
</template>

<style scoped>
.dest-wrap { display: flex; flex-direction: column; gap: 0; }
.lead { margin: 2px 0 14px; line-height: 1.5; }
.dest { margin: 0; }
.dest-row { display: flex; align-items: stretch; gap: 8px; }
.dest-path { flex: 1; min-width: 0; background: #fff; padding: 5px 8px; line-height: 1.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dest-row button { min-width: 84px; }
.muted { color: #666; }
.dest-note { margin-top: 12px; }
</style>
