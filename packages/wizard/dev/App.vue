<script setup lang="ts">
import Wizard from "../src/Wizard.vue";
import { DUMMY_CONFIG, DEMO_TRACKS } from "./dummyConfig.js";
</script>

<template>
  <Wizard :config="DUMMY_CONFIG" :dev-mode="true" :dev-tracks="DEMO_TRACKS" />
</template>
