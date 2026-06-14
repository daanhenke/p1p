<script setup lang="ts">
defineProps<{
  bannerImage?: string;
  title: string;
  isFinish?: boolean;
}>();
</script>

<template>
  <div class="wizard-main welcome">
    <div
      class="banner"
      :style="bannerImage ? { backgroundImage: `url('${bannerImage}')` } : {}"
    />
    <div class="pane-welcome">
      <h1>{{ title }}</h1>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.wizard-main { display: flex; height: 300px; }
.banner {
  flex: none; width: 200px;
  background: #000080 center center / cover no-repeat;
  box-shadow: inset -1px 0 0 #fff, inset -2px 0 0 #808080;
}
.pane-welcome { flex: 1; background: #fff; padding: 18px 20px; overflow: auto; }
.pane-welcome h1 { font-size: 15px; line-height: 1.35; margin: 0 0 12px; }

@media (max-width: 560px) {
  .banner { width: 132px; }
}
</style>
