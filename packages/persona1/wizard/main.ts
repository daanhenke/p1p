import { createApp, h } from "vue";
import { Wizard } from "@p1p/wizard";
import { PERSONA1_CONFIG, hydratePatchSettings } from "./config.js";

// Pull each patch's settings out of its compiled pack before mounting so the UI can render the knobs.
// hydratePatchSettings never rejects (missing packs leave a patch as a plain toggle), so always mount.
void hydratePatchSettings(PERSONA1_CONFIG).finally(() => {
  createApp({ render: () => h(Wizard, { config: PERSONA1_CONFIG }) }).mount("#app");
});
