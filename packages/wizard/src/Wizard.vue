<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import type { WizardConfig } from "./types.js";
import type { MusicTrack } from "./music/types.js";
import { useWizard } from "./useWizard.js";
import { useTheme } from "./useTheme.js";
import { useMusic } from "./useMusic.js";
import { initAnalytics, track } from "./analytics.js";

import WizardWindow from "./components/WizardWindow.vue";
import WizardFooter from "./components/WizardFooter.vue";
import WelcomePane from "./components/WelcomePane.vue";
import InteriorPane from "./components/InteriorPane.vue";
import ChangelogPane from "./components/ChangelogPane.vue";
import RomUploadPane from "./components/RomUploadPane.vue";
import PatchesPane from "./components/PatchesPane.vue";
import DestPane from "./components/DestPane.vue";
import ProgressPane from "./components/ProgressPane.vue";
import ThemeSwitcher from "./components/ThemeSwitcher.vue";
import MusicDebugPanel from "./components/MusicDebugPanel.vue";

const props = defineProps<{
  config: WizardConfig;
  devMode?: boolean;
  devTracks?: MusicTrack[];
}>();

useTheme();

const wiz = useWizard(props.config);
const music = useMusic();

// Background music. `autoplay` attempts playback immediately and, if the browser blocks audio until
// a user gesture, retries once on the first interaction. Without autoplay the playlist is armed and
// the title-bar speaker toggle (or any first click) starts it.
const bg = typeof props.config.bgMusic === "string" ? { url: props.config.bgMusic } : props.config.bgMusic;
if (bg) {
  // Normalise to a track list: an explicit `tracks` playlist, else the single `url`.
  const rawTracks = bg.tracks?.length
    ? bg.tracks
    : bg.url
      ? [{ url: bg.url, label: bg.label, backend: bg.backend, psflib: bg.psflib }]
      : [];
  const labelFor = (url: string, label?: string) =>
    label ?? decodeURIComponent(url.split("/").pop() ?? "").replace(/\.[^.]+$/u, "");
  const tracks = rawTracks.map((t, i) => ({
    id: `bg-${i}`, label: labelFor(t.url, t.label), url: t.url, backend: t.backend, psflib: t.psflib,
  }));
  const order = bg.order ?? "sequential";
  const startBg = () => { void music.playPlaylist(tracks, order); };
  if (bg.autoplay && tracks.length) {
    onMounted(() => {
      startBg(); // try immediately (works if the browser permits autoplay)
      const onGesture = () => { startBg(); detach(); };
      const detach = () => { window.removeEventListener("pointerdown", onGesture); window.removeEventListener("keydown", onGesture); };
      window.addEventListener("pointerdown", onGesture);
      window.addEventListener("keydown", onGesture);
      onUnmounted(detach);
    });
  }
}

// Desktop backdrop: teal by default on every theme; a consumer may override with a solid colour
// (bgColor) or a full-bleed image (bgImage). Applied as an inline <body> style so it sits behind
// the centered window regardless of theme.
onMounted(() => {
  const { bgImage, bgColor } = props.config;
  if (bgImage) {
    document.body.style.background = `#000 url("${bgImage}") center center / cover no-repeat fixed`;
  } else if (bgColor) {
    document.body.style.background = bgColor;
  }
});
onUnmounted(() => { document.body.style.background = ""; });

// Optional usage analytics: load the tracker (no-op when unconfigured), then report one "build" event
// per successful build with the version/commit and the patches + settings the user chose.
onMounted(() => initAnalytics(props.config.analytics));
watch(wiz.buildDone, (done) => {
  if (!done) return;
  track("build", {
    version: props.config.version,
    commit: props.config.commit,
    patches: [...wiz.enabledPatches.value],
    settings: wiz.patchSettings.value,
  });
});

const canPickDir = "showDirectoryPicker" in window;

const STEP_META: Record<string, { title: string; description: string }> = {
  changelog:   { title: "Release Notes",             description: "What's changed in each version." },
  roms:        { title: "Select Disc Images",         description: "Choose the ROM files to patch." },
  patches:     { title: "Optional Patches",           description: "Extra tweaks — all optional, off by default." },
  destination: { title: "Choose Destination Location",description: "Select the folder where files will be written." },
  installing:  { title: "Installing",                 description: "Please wait while your disc is patched." },
};

const stepMeta = computed(() => STEP_META[wiz.step.value] ?? { title: "", description: "" });
</script>

<template>
  <WizardWindow :title="config.title" :music="music" @cancel="wiz.restart()">
    <!-- Welcome / Finish: banner + wide right pane -->
    <WelcomePane
      v-if="wiz.step.value === 'welcome' || wiz.step.value === 'finish'"
      :banner-image="config.bannerImage"
      :title="wiz.step.value === 'welcome' ? config.welcomeTitle : 'Setup Complete'"
    >
      <template v-if="wiz.step.value === 'welcome'">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="config.welcomeBody" v-html="config.welcomeBody" />
        <p class="muted">Click <b>Next</b> to continue.</p>
      </template>
      <template v-else>
        <p>{{ wiz.buildDone.value }}</p>
        <p v-if="config.finishBody" class="muted">{{ config.finishBody }}</p>
        <p class="muted">Click <b>Finish</b> to patch another copy.</p>
      </template>
    </WelcomePane>

    <!-- Interior pages -->
    <InteriorPane
      v-else
      :title="stepMeta.title"
      :description="stepMeta.description"
    >
      <ChangelogPane
        v-if="wiz.step.value === 'changelog'"
        :entries="config.changelog ?? []"
      />
      <RomUploadPane
        v-else-if="wiz.step.value === 'roms'"
        :specs="config.roms ?? []"
        :files="wiz.romFiles.value"
        :statuses="wiz.romStatus.value"
        :progress="wiz.romProgress.value"
        @update:files="wiz.romFiles.value = $event"
      />
      <PatchesPane
        v-else-if="wiz.step.value === 'patches'"
        :patches="config.patches ?? []"
        :enabled-ids="wiz.enabledPatches.value"
        :patch-settings="wiz.patchSettings.value"
        :allow-custom-bins="config.allowCustomBins"
        :custom-bins="wiz.customBins.value"
        @update:enabled-ids="wiz.enabledPatches.value = $event"
        @update:patch-settings="wiz.patchSettings.value = $event"
        @update:custom-bins="wiz.customBins.value = $event"
      />
      <DestPane
        v-else-if="wiz.step.value === 'destination'"
        :dest-label="wiz.destLabel.value"
        :can-pick-dir="canPickDir"
        @pick="wiz.pickDest()"
      />
      <ProgressPane
        v-else-if="wiz.step.value === 'installing'"
        :log="wiz.log.value"
        :progress="wiz.progress.value"
        :error="wiz.buildError.value"
        :building="wiz.building.value"
        :done="wiz.buildDone.value"
      />
    </InteriorPane>

    <WizardFooter
      :can-back="wiz.canBack.value"
      :can-next="wiz.canNext.value"
      :next-label="wiz.nextLabel.value"
      :building="wiz.building.value"
      :now-playing="music.isPlaying.value && !music.muted.value && !music.error.value ? music.currentTrack.value?.label : null"
      @back="wiz.back()"
      @next="wiz.next()"
      @cancel="wiz.restart()"
    />
  </WizardWindow>

  <!-- Dev-only overlays -->
  <ThemeSwitcher v-if="devMode" />
  <MusicDebugPanel v-if="devMode" :music="music" :tracks="devTracks ?? []" />
</template>

<style>
/* Desktop chrome — applied globally so consumers' body gets styled */
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; min-height: 100vh; color: #000;
  /* default desktop: Win95/98 teal on every theme. A consumer can override via config.bgImage /
     config.bgColor (applied as an inline style on <body> at mount). */
  background: #008080;
}
#app {
  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
}
::selection { background: #000080; color: #fff; }
code { font-family: inherit; }
.muted { color: #555; }

/* 98.css anchors the checkmark glyph (7px) to the top of the 13px box; centre it vertically. */
body[data-theme="98"] input[type="checkbox"]:checked + label::after { top: 3px; }
</style>
