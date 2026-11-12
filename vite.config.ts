// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
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
              urlPattern: ({ request, url }) => request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: { cacheName: "pages", networkTimeoutSeconds: 4, expiration: { maxEntries: 30 } },
            },
            {
              urlPattern: ({ url }) => url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/assets/"),
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
