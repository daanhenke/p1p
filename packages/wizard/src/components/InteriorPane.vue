<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <div class="wizard-main interior">
    <div class="pane-interior">
      <div class="page-head">
        <div>
          <div class="page-title">{{ title }}</div>
          <div class="page-desc">{{ description }}</div>
        </div>
        <div class="page-ico" aria-hidden="true">◆</div>
      </div>
      <div class="hr" />
      <div class="page-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-main { display: flex; height: 300px; }
.pane-interior { flex: 1; display: flex; flex-direction: column; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; background: #fff; padding: 11px 14px; }
.page-title { font-weight: bold; }
.page-desc { color: #333; margin-top: 4px; padding-left: 14px; }
.page-ico { font-size: 24px; color: #000080; line-height: 1; }
.hr { border-top: 1px solid #808080; border-bottom: 1px solid #fff; }
.page-body { padding: 14px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
