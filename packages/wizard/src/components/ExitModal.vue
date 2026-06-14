<script setup lang="ts">
defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div class="modal-backdrop" @pointerdown.self="$emit('cancel')">
    <div class="window modal">
      <div class="title-bar">
        <div class="title-bar-text">Exit Setup</div>
        <div class="title-bar-controls">
          <button aria-label="Close" type="button" @click="$emit('cancel')"></button>
        </div>
      </div>
      <div class="window-body modal-body">
        <p>Setup is not complete. If you exit now, no files will be created.</p>
        <p class="modal-q">Exit Setup?</p>
        <div class="modal-btns">
          <button type="button" @click="$emit('confirm')">Yes</button>
          <button type="button" @click="$emit('cancel')">No</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 32, 0.35);
}
.modal { width: 320px; max-width: calc(100vw - 32px); }
.modal-body { margin: 12px 14px 14px; }
.modal-body p { margin: 0 0 10px; line-height: 1.5; }
.modal-q { font-weight: bold; }
.modal-btns { display: flex; justify-content: center; gap: 8px; margin-top: 16px; }
.modal-btns button { min-width: 80px; }
</style>
