// Single place that registers the offline service worker. Never in dev/preview/iframes.
// Paths follow the build's base URL ("/" on Lovable, "/spark-paper-docs/" on GitHub Pages).
const BASE = import.meta.env.BASE_URL;
const SW_URL = `${BASE}sw.js`;
const PREVIEW_LABEL = /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/;
const PREVIEW_ROOTS = [".lovable.app", ".gpt-eng.com", ".gptengineer.run"];

function refused(): boolean {
  if (!import.meta.env.PROD) return true;
  try { if (window.self !== window.top) return true; } catch { return true; }
  const h = window.location.hostname.toLowerCase();
  const label = h.split(".")[0] ?? "";
  if (PREVIEW_ROOTS.some((r) => h.endsWith(r)) && (PREVIEW_LABEL.test(label) || /^project--.+-dev$/.test(label))) return true;
  if (h === "id-preview--79d26cdc-f07f-4b7f-a0c0-b5ebd6ee04b3.lovable.app") return true;
  if (h === "id-preview--0573fefc-129b-4cc6-819f-f4abc3de6717.lovable.app") return true;
  for (const d of ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"]) {
    if (h === d || h.endsWith("." + d)) return true;
  }
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

const isOurs = (r: ServiceWorkerRegistration) =>
  [r.active, r.installing, r.waiting].some((w) => w?.scriptURL.endsWith("/sw.js"));

export async function registerOfflineSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (refused()) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.filter(isOurs).map((r) => r.unregister()));
    return;
  }
  try {
    // When a new release takes over, reload once so the page uses the fresh files.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: BASE });
    // Check for a new release on every visit and when the app comes back to the foreground.
    void reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void reg.update().catch(() => {});
    });
    // Warm every tool page so they open offline even if never visited.
    const pages = ["", "edit", "merge", "split", "organize", "compress", "stamp", "pdf-to-images", "pdf-to-excel", "excel-to-pdf", "translate"].map((p) => BASE + p);
    const c = await caches.open("pages");
    await Promise.allSettled(pages.map((p) => c.add(p)));
  } catch (e) {
    console.warn("SW registration failed", e);
  }
}
