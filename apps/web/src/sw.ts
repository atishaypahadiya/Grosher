/// <reference lib="webworker" />
// The service worker (vite-plugin-pwa injectManifest; built to /sw.js).
//
//   - precaches everything the build emits, so the app works offline after one load
//   - navigations are network-first (4 s), falling back to the precached index.html: an open after a
//     deploy gets the new HTML, never an old shell that points at chunks the server no longer has
//   - a new version takes over at once (skipWaiting + clients.claim) and deletes every other cache
//   - after taking over it asks each open window whether it started (the boot guard in index.html answers);
//     a window that does not answer (an older build's page, stuck on a blank screen) or answers "failed"
//     is reloaded. A window of this build answers "ok" or "booting" and is left alone

import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { cacheNames } from "workbox-core";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

const NETWORK_MS = 4000;
const PING_MS = 3000;

async function shell(): Promise<Response> {
  return (await matchPrecache("index.html")) ?? Response.error();
}

// registered before the precache route, which would otherwise answer "/" from the cache (directoryIndex)
registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), NETWORK_MS);
      try {
        const res = await fetch(request, { signal: ctl.signal });
        // a 5xx from the host is worse than the precached shell
        return res.status < 500 ? res : shell();
      } catch {
        return shell();
      } finally {
        clearTimeout(timer);
      }
    },
    { denylist: [/^\/project(\/|$)/] },
  ),
);

// everything else the build emitted: cache-first from the precache; "/" is never mapped to index.html
precacheAndRoute(self.__WB_MANIFEST, { directoryIndex: "", cleanURLs: false });
cleanupOutdatedCaches();

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== cacheNames.precache) await caches.delete(k);
      await self.clients.claim();
      // not inside activation: a reload of a stuck window is a navigation, and fetches wait for activation
      // to finish, so awaiting it here would deadlock. A message to itself runs once activation is done.
      self.registration.active?.postMessage({ type: "grosher:rescue" });
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "grosher:rescue") event.waitUntil(rescueStuckWindows());
});

/** Windows that never started (an old build's blank page) are reloaded; started ones are left alone. */
async function rescueStuckWindows(): Promise<void> {
  const windows = await self.clients.matchAll({ type: "window" });
  if (!windows.length) return;
  const answers = new Map<string, string>();
  const onMessage = (e: ExtendableMessageEvent) => {
    const src = e.source as WindowClient | null;
    if (src && e.data?.type === "grosher:pong") answers.set(src.id, String(e.data.state));
  };
  self.addEventListener("message", onMessage);
  for (const w of windows) w.postMessage({ type: "grosher:ping" });
  await new Promise((r) => setTimeout(r, PING_MS));
  self.removeEventListener("message", onMessage);
  await Promise.all(
    windows.map(async (w) => {
      const state = answers.get(w.id);
      if (state === "ok" || state === "booting") return;
      try {
        await w.navigate(w.url);
      } catch {
        /* not controlled by this worker, or navigate unsupported: the window's next open is network-first */
      }
    }),
  );
}
