// Google Tag Manager and AdSense load once the page is interactive: at the
// visitor's first tap, key press or scroll, or THIRD_PARTY_QUIET_MS after the
// load event if none comes first. Loaded with the page, they took a phone's
// bandwidth from the page's own CSS and scripts and ran long tasks while it
// hydrated and answered its first taps (#316). An ad slot doesn't wait: it
// shows only after the visitor acts, so it loads AdSense at once
// (docs/ads.md).

const INTERACTION_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"] as const;

/** How long after the load event the scripts wait for a first interaction. */
export const THIRD_PARTY_QUIET_MS = 5_000;

const waiting = new Set<() => void>();
const requested = new Set<string>();
let armed = false;
let interactive = false;

function release() {
  if (interactive) return;
  interactive = true;
  for (const type of INTERACTION_EVENTS) {
    window.removeEventListener(type, release, true);
  }
  const callbacks = [...waiting];
  waiting.clear();
  for (const callback of callbacks) callback();
}

function arm() {
  armed = true;
  for (const type of INTERACTION_EVENTS) {
    window.addEventListener(type, release, { capture: true, passive: true });
  }
  const startQuietTimer = () => window.setTimeout(release, THIRD_PARTY_QUIET_MS);
  if (document.readyState === "complete") startQuietTimer();
  else window.addEventListener("load", startQuietTimer, { once: true });
}

/**
 * Runs `callback` once the page is interactive, or now if it already is.
 * Returns a function that cancels a callback still waiting.
 */
export function whenPageInteractive(callback: () => void): () => void {
  if (interactive) {
    callback();
    return () => {};
  }
  waiting.add(callback);
  if (!armed) arm();
  return () => {
    waiting.delete(callback);
  };
}

/** Appends `<script async src>` to the head, once per src. */
export function loadScript(src: string, crossOrigin?: "anonymous"): void {
  if (requested.has(src)) return;
  requested.add(src);
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  if (crossOrigin) script.crossOrigin = crossOrigin;
  document.head.appendChild(script);
}

export function adsenseScriptSrc(client: string): string {
  return `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
}

/** Loads AdSense now (an ad slot calls it as it mounts). */
export function loadAdSenseScript(src: string): void {
  loadScript(src, "anonymous");
}

export function googleTagManagerScriptSrc(gtmId: string): string {
  return `https://www.googletagmanager.com/gtm.js?id=${gtmId}`;
}

/** Google's GTM snippet: the gtm.js start event, then the container script. */
export function loadGoogleTagManager(src: string): void {
  if (requested.has(src)) return;
  const tagWindow = window as Window & { dataLayer?: unknown[] };
  tagWindow.dataLayer = tagWindow.dataLayer || [];
  tagWindow.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  loadScript(src);
}
