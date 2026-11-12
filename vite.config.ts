// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";

// GitHub Pages build (`bun run build:pages`): static files served from /spark-paper-docs/.
// Every other build (Lovable preview/publish) keeps the root path and server output unchanged.
const PAGES = process.env["GITHUB_PAGES"] === "true";
// Custom domain (actes.tech) serves the site from the root; set PAGES_BASE to use a subpath again.
const BASE = PAGES ? (process.env["PAGES_BASE"] || "/") : "/";

// vite-plugin-pwa skips sw.js when the build runs as several environments (client + server).
// Generate it explicitly once the client environment has been written.
const swForClientBuild = (): Plugin => {
  let api: { generateSW?: () => Promise<void> } | undefined;
  return {
    name: "actes:sw-client-build",
    apply: "build",
    applyToEnvironment: (env) => env.name === "client",
    configResolved(cfg) {
      api = cfg.plugins.find((p) => p.name === "vite-plugin-pwa")?.api as typeof api;
    },
    closeBundle: { sequential: true, order: "post", async handler() { await api?.generateSW?.(); } },
  };
};

export default defineConfig({
  ...(PAGES ? { nitro: false as const } : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    ...(PAGES
      ? {
          router: { basepath: BASE.replace(/\/$/, "") },
          pages: [{ path: "/" }],
          prerender: { enabled: true, crawlLinks: true, failOnError: false },
        }
      : {}),
  },
  vite: {
    base: BASE,
    plugins: [
      swForClientBuild(),
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null,
        devOptions: { enabled: false },
        manifest: false,
        filename: "sw.js",
        workbox: {
          globDirectory: "dist/client",
          swDest: "dist/client/sw.js",
          globPatterns: ["**/*.{js,css,woff2,png,svg,ttf,mjs,wasm}"],
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) => request.mode === "navigate" && !url.pathname.includes("/~oauth"),
              handler: "NetworkFirst",
              options: { cacheName: "pages", networkTimeoutSeconds: 4, expiration: { maxEntries: 30 } },
            },
            {
              urlPattern: ({ url }) => url.pathname.includes("/fonts/") || url.pathname.includes("/assets/"),
              handler: "CacheFirst",
              options: { cacheName: "static", expiration: { maxEntries: 200 } },
            },
            {
              urlPattern: ({ url }) => /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || /lovable|cdn/.test(url.hostname) && /\.(png|jpe?g|svg|webp)$/.test(url.pathname),
              handler: "StaleWhileRevalidate",
              options: { cacheName: "external", expiration: { maxEntries: 60 } },
            },
          ],
        },
      }),
    ],
  },
});
