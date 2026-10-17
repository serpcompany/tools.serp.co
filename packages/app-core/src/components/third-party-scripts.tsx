"use client";

import { useEffect } from "react";

import {
  loadAdSenseScript,
  loadGoogleTagManager,
  whenPageInteractive,
} from "../lib/third-party-scripts";

// The shared layout renders these from the server with the script's URL as a
// prop, so the URL is in the page's HTML (the deploy smoke check reads it)
// without a <link rel="preload"> that would fetch it with the page.

export function GoogleTagManagerScript({ src }: { src: string }) {
  useEffect(() => whenPageInteractive(() => loadGoogleTagManager(src)), [src]);
  return null;
}

export function AdSenseScript({ src }: { src: string }) {
  useEffect(() => whenPageInteractive(() => loadAdSenseScript(src)), [src]);
  return null;
}
