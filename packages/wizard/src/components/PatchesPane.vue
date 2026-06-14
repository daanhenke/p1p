<script setup lang="ts">
import type { PatchSpec, PatchSettings } from "../types.js";

const props = defineProps<{
  patches: PatchSpec[];
  enabledIds: Set<string>;
  patchSettings?: PatchSettings;
  allowCustomBins?: boolean;
  customBins?: File[];
}>();
const emit = defineEmits<{
  "update:enabledIds": [Set<string>];
  "update:patchSettings": [PatchSettings];
  "update:customBins": [File[]];
}>();

function toggle(id: string, on: boolean) {
  const s = new Set(props.enabledIds);
  if (on) s.add(id); else s.delete(id);
  emit("update:enabledIds", s);
}

function settingValue(patchId: string, settingId: string, fallback: string): string {
  return props.patchSettings?.[patchId]?.[settingId] ?? fallback;
}
function setSetting(patchId: string, settingId: string, value: string) {
  const next: PatchSettings = { ...(props.patchSettings ?? {}) };
  next[patchId] = { ...(next[patchId] ?? {}), [settingId]: value };
  emit("update:patchSettings", next);
}

function onBinPick(e: Event) {
  const newFiles = Array.from((e.target as HTMLInputElement).files ?? []);
  emit("update:customBins", [...(props.customBins ?? []), ...newFiles]);
}

function removeBin(i: number) {
  const arr = [...(props.customBins ?? [])];
  arr.splice(i, 1);
  emit("update:customBins", arr);
}
</script>

<template>
  <div class="patches-wrap">
    <p class="lead">Optional gameplay tweaks — leave them off for a faithful patch.</p>
    <div class="patches sunken-panel">
      <div v-if="!patches.length && !allowCustomBins" class="muted">No optional patches available.</div>
      <div v-for="p in patches" :key="p.id" class="patch-row">
        <input
          :id="`patch-${p.id}`" type="checkbox"
          :checked="enabledIds.has(p.id)"
          @change="toggle(p.id, ($event.target as HTMLInputElement).checked)"
        />
        <label :for="`patch-${p.id}`">
          <b class="patch-name">{{ p.name }}</b>
          <span v-if="p.description" class="desc">{{ p.description }}</span>
        </label>
      </div>

      <!-- Settings for an enabled patch: one labelled dropdown per knob. -->
      <template v-for="p in patches" :key="`set-${p.id}`">
        <div v-if="enabledIds.has(p.id) && p.settings?.length" class="patch-settings">
          <div v-for="s in p.settings" :key="s.id" class="setting-row">
            <label :for="`setting-${p.id}-${s.id}`" :title="s.description">{{ s.label }}</label>
            <select
              :id="`setting-${p.id}-${s.id}`"
              :value="settingValue(p.id, s.id, s.default)"
              @change="setSetting(p.id, s.id, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="o in s.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>
      </template>

      <template v-if="allowCustomBins">
        <div class="custom-sep" v-if="patches.length">Custom patches</div>
        <div v-for="(f, i) in customBins" :key="i" class="custom-row">
          <span class="custom-name">{{ f.name }}</span>
          <button type="button" class="remove-btn" @click="removeBin(i)">✕</button>
        </div>
        <label class="add-bin-btn">
          <input type="file" accept=".bin" multiple @change="onBinPick" />
          + Add patch .bin…
        </label>
      </template>
    </div>
  </div>
</template>

<style scoped>
.patches-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.lead { margin: 0 0 8px; line-height: 1.5; }
.patches { flex: 1; min-height: 0; overflow: auto; background: #fff; padding: 6px 8px; line-height: 1.4; }
.patch-row { display: flex; align-items: flex-start; gap: 7px; padding: 5px 0; }
.patch-row + .patch-row { border-top: 1px solid #e6e6e6; }
.patch-row input { margin-top: 2px; flex: none; }
/* title on the left, description pinned to the right with a gap between them */
.patch-row label { flex: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 18px; }
.patch-name { flex: none; }
.desc { flex: 1; color: #555; text-align: right; }
.muted { color: #666; }
.patch-settings { padding: 2px 0 7px 24px; border-top: 1px solid #e6e6e6; }
.setting-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.setting-row label { color: #333; min-width: 130px; }
.setting-row select { flex: none; }
.custom-sep { margin: 8px 0 4px; font-weight: bold; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.custom-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 0; }
.custom-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #000080; }
.remove-btn { background: none; border: none; color: #888; cursor: pointer; padding: 0 2px; font-size: 10px; min-height: unset; }
.remove-btn:hover { color: #c00; }
.add-bin-btn {
  display: inline-block; position: relative; margin-top: 6px;
  cursor: pointer; color: #000080; text-decoration: underline;
}
.add-bin-btn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
</style>
