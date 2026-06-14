import { ref, computed } from "vue";

export function useDrag() {
  const elRef = ref<HTMLElement | null>(null);
  const pos = ref<{ x: number; y: number } | null>(null);
  let drag: { dx: number; dy: number } | null = null;

  function onTitleDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest(".title-bar-controls")) return;
    const r = elRef.value!.getBoundingClientRect();
    pos.value = { x: r.left, y: r.top };
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onMove(e: PointerEvent) {
    if (!drag || !elRef.value) return;
    const w = elRef.value.offsetWidth;
    const x = Math.min(Math.max(e.clientX - drag.dx, 24 - w), window.innerWidth - 24);
    const y = Math.min(Math.max(e.clientY - drag.dy, 0), window.innerHeight - 28);
    pos.value = { x, y };
  }

  function onUp() {
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  const style = computed(() =>
    pos.value ? { position: "fixed" as const, left: pos.value.x + "px", top: pos.value.y + "px", margin: "0" } : {},
  );

  return { elRef, style, onTitleDown };
}
