// Single place that registers the offline service worker. Never in dev/preview/iframes.
const PREVIEW_LABEL = /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/;
const PREVIEW_ROOTS = [".lovable.app", ".gpt-eng.com", ".gptengineer.run"];

function refused(): boolean {
  if (!import.meta.env.PROD) return true;
  try { if (window.self !== window.top) return true; } catch { return true; }
  const h = window.location.hostname.toLowerCase();
  const label = h.split(".")[0] ?? "";
  if (PREVIEW_ROOTS.some((r) => h.endsWith(r)) && (PREVIEW_LABEL.test(label) || /^project--.+-dev$/.test(label))) return true;
  if (h === "id-preview--79d26cdc-f07f-4b7f-a0c0-b5ebd6ee04b3.lovable.app") return true;
  for (const d of ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"]) {
    if (h === d || h.endsWith("." + d)) return true;
  }
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

export async function registerOfflineSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (refused()) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.filter((r) => r.active?.scriptURL.endsWith("/sw.js") || r.installing?.scriptURL.endsWith("/sw.js") || r.waiting?.scriptURL.endsWith("/sw.js")).map((r) => r.unregister()));
    return;
  }
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    // Warm every tool page so they open offline even if never visited.
    const pages = ["/", "/edit", "/merge", "/split", "/organize", "/pdf-to-excel", "/excel-to-pdf", "/translate"];
    const c = await caches.open("pages");
    await Promise.allSettled(pages.map((p) => c.add(p)));
  } catch (e) {
    console.warn("SW registration failed", e);
  }
}
