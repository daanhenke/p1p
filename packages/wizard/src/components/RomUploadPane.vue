<script setup lang="ts">
import type { RomSpec, RomStatus } from "../types.js";

const props = defineProps<{
  specs: RomSpec[];
  files: Record<string, File | null>;
  statuses?: Record<string, RomStatus>;
  progress?: Record<string, number>;
}>();
const emit = defineEmits<{ "update:files": [Record<string, File | null>] }>();

const statusOf = (id: string): RomStatus => props.statuses?.[id] ?? "unknown";
const pctOf = (id: string): number => Math.round((props.progress?.[id] ?? 0) * 100);

const mb = (n: number) => (n / 1048576).toFixed(0) + " MB";

function set(id: string, f: File | null) {
  emit("update:files", { ...props.files, [id]: f });
}
function onPick(id: string, e: Event) {
  set(id, (e.target as HTMLInputElement).files?.[0] ?? null);
}
function onDrop(id: string, e: DragEvent) {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) set(id, f);
}
</script>

<template>
  <div class="drops">
    <label
      v-for="spec in specs"
      :key="spec.id"
      class="drop sunken-panel"
      :class="{ filled: !!files[spec.id] }"
      @dragover.prevent
      @drop="onDrop(spec.id, $event)"
    >
      <input type="file" :accept="spec.accept" @change="onPick(spec.id, $event)" />
      <div class="tag">
        {{ spec.label }}<em v-if="spec.sublabel">{{ spec.sublabel }}</em>
        <span v-if="spec.optional" class="optional-tag">optional</span>
      </div>
      <div v-if="files[spec.id]" class="name">
        ✔ {{ files[spec.id]!.name }} <span>{{ mb(files[spec.id]!.size) }}</span>
        <div v-if="statusOf(spec.id) === 'checking'" class="verify checking">⏳ verifying image… {{ pctOf(spec.id) }}%</div>
        <div v-else-if="statusOf(spec.id) === 'ok'" class="verify ok">✔ verified — known-good image</div>
        <div v-else-if="statusOf(spec.id) === 'mismatch'" class="verify warn">⚠ unrecognized image — build may still work</div>
      </div>
      <div v-else class="hint">drop <code>{{ spec.hint }}</code></div>
    </label>
  </div>
</template>

<style scoped>
.drops { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.drop { position: relative; display: block; cursor: pointer; background: #fff; padding: 9px 10px; min-height: 72px; }
.drop input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.tag { font-weight: bold; margin-bottom: 5px; }
.tag em { font-weight: normal; font-style: normal; color: #666; margin-left: 4px; }
.optional-tag { font-weight: normal; color: #fff; background: #888; border-radius: 2px; font-size: 9px; padding: 1px 4px; margin-left: 6px; vertical-align: middle; }
.hint { color: #444; line-height: 1.4; }
.name { word-break: break-all; line-height: 1.4; }
.name span { color: #000080; font-weight: bold; }
.verify { margin-top: 3px; font-size: 11px; font-weight: normal; }
.verify.checking { color: #555; }
.verify.ok { color: #137333; }
.verify.warn { color: #a15c00; }
.drop:hover { background: #f3f7ff; }
.drop.filled { background: #e6efff; }
</style>
