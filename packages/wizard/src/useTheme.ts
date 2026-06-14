import { ref, watch, onMounted } from "vue";
import type { ThemeId } from "./types.js";

// Each theme is a SELF-CONTAINED stylesheet — never layer them. (98.css, xp.css and 7.css each
// ship their own `.window`/`.title-bar`/scrollbar rules; mixing them produces broken frames.)
import url98 from "98.css?url";
import urlXp from "xp.css?url";
import url7 from "7.css?url";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "98", label: "Windows 98" },
  { id: "xp", label: "Windows XP" },
  { id: "7", label: "Windows 7" },
];

const THEME_URLS: Record<ThemeId, string> = {
  98: url98,
  xp: urlXp,
  7: url7,
};

const current = ref<ThemeId>("98");

function applyTheme(id: ThemeId) {
  let link = document.getElementById("wizard-theme") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = "wizard-theme";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = THEME_URLS[id];
  // Expose the theme on <body> so the wizard's own desktop/frame rules can adapt per theme.
  document.body.dataset.theme = id;
}

export function useTheme() {
  onMounted(() => applyTheme(current.value));
  watch(current, applyTheme);
  return { theme: current, themes: THEMES, setTheme: (id: ThemeId) => { current.value = id; } };
}
