// Optional, self-hosted Umami analytics (cookieless, no third-party vendor). The tracker script and
// website id come from the consumer's WizardConfig.analytics (baked from env at build time); when
// either is missing, analytics is simply off. Pageviews/uniques are tracked by the loaded script; we
// add a single custom "build" event (version, commit, the enabled patches and their settings) on a
// successful build.

import type { AnalyticsConfig } from "./types.js";

/** Inject the Umami tracker once. No-op when unconfigured or already present. */
export function initAnalytics(cfg?: AnalyticsConfig): void {
  if (!cfg?.umamiSrc || !cfg.umamiId) return;
  if (document.querySelector(`script[data-website-id="${cfg.umamiId}"]`)) return;
  const s = document.createElement("script");
  s.defer = true;
  s.src = cfg.umamiSrc;
  s.setAttribute("data-website-id", cfg.umamiId);
  document.head.appendChild(s);
}

type Umami = { track: (name: string, data?: Record<string, unknown>) => void };

/** Fire a custom event if the tracker is loaded; silently does nothing otherwise. */
export function track(name: string, data?: Record<string, unknown>): void {
  (window as unknown as { umami?: Umami }).umami?.track(name, data);
}
